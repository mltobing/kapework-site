/**
 * Tests for src/lib/logboek-feed.js — the resilient Logboek feed orchestrator.
 *
 * This is the regression coverage that would have caught both PR #122 (which
 * embedded ma_post_sources directly on the ma_posts select, so one missing
 * relationship blanked the whole feed) and the failure that PR #123's fix
 * alone did not resolve (a stale-deployed client can still send the old
 * embedded shape): a core-query failure must always propagate, but a
 * hydration failure — whatever its cause — must never blank the feed.
 *
 * Run: node --test apps/ma/src/lib/logboek-feed.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLogboekFeedPage, hydrateLogboekEntries } from './logboek-feed.js';

const ROW_A = { id: 'post-a', author_id: 'author-1' };
const ROW_B = { id: 'post-b', author_id: 'author-2' };

function okFetchers(overrides = {}) {
  return {
    fetchCorePage: async () => [ROW_A, ROW_B],
    fetchProfiles: async (ids) => new Map(ids.map((id) => [id, { display_name: `Profile ${id}` }])),
    fetchAttachments: async (ids) => new Map(ids.map((id) => [id, [{ id: `att-${id}` }]])),
    fetchProvenance: async (ids) => new Map(ids.map((id) => [id, { source_label: `Source ${id}` }])),
    ...overrides,
  };
}

function throwing(label) {
  return async () => { throw new Error(`${label} unavailable`); };
}

// ─── Core query is authoritative ─────────────────────────────────────────────

test('core query failure propagates — a broken core query is a hard failure', async () => {
  const deps = okFetchers({ fetchCorePage: throwing('core') });
  await assert.rejects(
    () => loadLogboekFeedPage({ ...deps, sort: 'created_at' }),
    /core unavailable/,
  );
});

test('core query has no relationship embeds — fetchCorePage is called with just the sort mode', async () => {
  const calls = [];
  const deps = okFetchers({
    fetchCorePage: async (sort) => { calls.push(sort); return [ROW_A]; },
  });
  await loadLogboekFeedPage({ ...deps, sort: 'created_at' });
  assert.deepEqual(calls, ['created_at']);
});

// ─── Hydration failures never blank the feed ─────────────────────────────────

test('profile hydration failure still returns entries', async () => {
  const deps = okFetchers({ fetchProfiles: throwing('profiles') });
  const { entries } = await loadLogboekFeedPage({ ...deps, sort: 'created_at' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].ma_profiles, null);
});

test('attachment hydration failure still returns entries', async () => {
  const deps = okFetchers({ fetchAttachments: throwing('attachments') });
  const { entries } = await loadLogboekFeedPage({ ...deps, sort: 'created_at' });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].ma_attachments, []);
});

test('provenance hydration failure still returns entries', async () => {
  const deps = okFetchers({ fetchProvenance: throwing('provenance') });
  const { entries } = await loadLogboekFeedPage({ ...deps, sort: 'created_at' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].ma_post_sources, null);
});

test('all three hydration lookups failing at once still returns entries, not an empty feed', async () => {
  const deps = okFetchers({
    fetchProfiles: throwing('profiles'),
    fetchAttachments: throwing('attachments'),
    fetchProvenance: throwing('provenance'),
  });
  const { entries } = await loadLogboekFeedPage({ ...deps, sort: 'created_at' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].ma_profiles, null);
  assert.deepEqual(entries[0].ma_attachments, []);
  assert.equal(entries[0].ma_post_sources, null);
});

test('successful hydration attaches profile, attachments, and provenance per entry', async () => {
  const { entries } = await loadLogboekFeedPage({ ...okFetchers(), sort: 'created_at' });
  assert.equal(entries[0].ma_profiles.display_name, 'Profile author-1');
  assert.deepEqual(entries[0].ma_attachments, [{ id: 'att-post-a' }]);
  assert.equal(entries[0].ma_post_sources.source_label, 'Source post-a');
});

// ─── Sort fallback ────────────────────────────────────────────────────────────

test('event_date sort failure triggers exactly one created_at fallback and sets the flag', async () => {
  let calls = 0;
  const deps = okFetchers({
    fetchCorePage: async (sort) => {
      calls += 1;
      if (sort === 'event_date') throw new Error('event_date order unavailable');
      return [ROW_A];
    },
  });
  const { entries, usedSortFallback } = await loadLogboekFeedPage({ ...deps, sort: 'event_date' });
  assert.equal(calls, 2);
  assert.equal(usedSortFallback, true);
  assert.equal(entries.length, 1);
});

test('created_at sort failure does not retry — no infinite retry, failure propagates', async () => {
  let calls = 0;
  const deps = okFetchers({
    fetchCorePage: async () => { calls += 1; throw new Error('created_at order unavailable'); },
  });
  await assert.rejects(() => loadLogboekFeedPage({ ...deps, sort: 'created_at' }));
  assert.equal(calls, 1);
});

test('event_date sort failing twice in a row (fallback also fails) propagates rather than looping', async () => {
  let calls = 0;
  const deps = okFetchers({
    fetchCorePage: async () => { calls += 1; throw new Error('nothing works'); },
  });
  await assert.rejects(() => loadLogboekFeedPage({ ...deps, sort: 'event_date' }));
  assert.equal(calls, 2); // one event_date attempt, one created_at fallback attempt — then stop
});

test('event_date sort succeeding on the first try never falls back', async () => {
  let calls = 0;
  const deps = okFetchers({
    fetchCorePage: async (sort) => { calls += 1; return [ROW_A]; },
  });
  const { usedSortFallback } = await loadLogboekFeedPage({ ...deps, sort: 'event_date' });
  assert.equal(calls, 1);
  assert.equal(usedSortFallback, false);
});

// ─── ID handling ──────────────────────────────────────────────────────────────

test('hydration lookups are deduplicated — repeated author/post ids are only requested once', async () => {
  const rows = [
    { id: 'post-a', author_id: 'author-1' },
    { id: 'post-b', author_id: 'author-1' },
  ];
  const profileCalls = [];
  const attachmentCalls = [];
  const entries = await hydrateLogboekEntries(rows, {
    fetchProfiles: async (ids) => { profileCalls.push(ids); return new Map(); },
    fetchAttachments: async (ids) => { attachmentCalls.push(ids); return new Map(); },
    fetchProvenance: async () => new Map(),
  });
  assert.deepEqual(profileCalls, [['author-1']]);
  assert.deepEqual(attachmentCalls, [['post-a', 'post-b']]);
  assert.equal(entries.length, 2);
});

test('an empty page never calls hydration lookups with empty-but-truthy work', async () => {
  const entries = await hydrateLogboekEntries([], {
    fetchProfiles: async (ids) => { assert.deepEqual(ids, []); return new Map(); },
    fetchAttachments: async (ids) => { assert.deepEqual(ids, []); return new Map(); },
    fetchProvenance: async (ids) => { assert.deepEqual(ids, []); return new Map(); },
  });
  assert.deepEqual(entries, []);
});

// ─── Single-entry hydration (create/update) ──────────────────────────────────

test('hydrateLogboekEntries hydrates a single freshly-created row even when provenance is unavailable', async () => {
  const deps = okFetchers({ fetchProvenance: throwing('provenance') });
  const [entry] = await hydrateLogboekEntries([ROW_A], deps);
  assert.equal(entry.id, 'post-a');
  assert.equal(entry.ma_profiles.display_name, 'Profile author-1');
  assert.equal(entry.ma_post_sources, null);
});
