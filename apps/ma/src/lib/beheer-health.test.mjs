/**
 * Tests for the Beheer "Systeemstatus" health rules.
 *
 * Run with Node's built-in runner (no dependencies):
 *   node --test apps/ma/src/lib/beheer-health.test.mjs
 *
 * Every instant below is written with an explicit Amsterdam offset (+02:00,
 * CEST/summer) so the 17:00/18:00 boundary checks are unambiguous regardless
 * of the host process's own timezone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAgendaHealth,
  computeBriefingHealth,
  computeNoticesHealth,
} from './beheer-health.js';

const NOW = new Date('2026-07-21T12:00:00+02:00');
const HOUR_MS = 3600_000;
function hoursAgo(n) {
  return new Date(NOW.getTime() - n * HOUR_MS).toISOString();
}

// ─── computeAgendaHealth ────────────────────────────────────────────────────

test('agenda: no run and no source at all → neutral/no_data', () => {
  const h = computeAgendaHealth(null, null, NOW);
  assert.deepEqual(h, { level: 'neutral', reason: 'no_data' });
});

test('agenda: run exists but not failed, no source → neutral/no_data', () => {
  const h = computeAgendaHealth({ calendar_status: 'success' }, null, NOW);
  assert.deepEqual(h, { level: 'neutral', reason: 'no_data' });
});

test('agenda: fresh sync (≤6h) and no failure → green/fresh', () => {
  const h = computeAgendaHealth(
    { calendar_status: 'success' },
    { last_synced_at: hoursAgo(1) },
    NOW,
  );
  assert.deepEqual(h, { level: 'green', reason: 'fresh' });
});

test('agenda: sync exactly at the 6h boundary → still green/fresh', () => {
  const h = computeAgendaHealth(
    { calendar_status: 'success' },
    { last_synced_at: hoursAgo(6) },
    NOW,
  );
  assert.deepEqual(h, { level: 'green', reason: 'fresh' });
});

test('agenda: sync just past 6h → amber/stale', () => {
  const h = computeAgendaHealth(
    { calendar_status: 'success' },
    { last_synced_at: hoursAgo(6.5) },
    NOW,
  );
  assert.deepEqual(h, { level: 'amber', reason: 'stale' });
});

test('agenda: sync exactly at the 12h boundary → still amber/stale', () => {
  const h = computeAgendaHealth(
    { calendar_status: 'success' },
    { last_synced_at: hoursAgo(12) },
    NOW,
  );
  assert.deepEqual(h, { level: 'amber', reason: 'stale' });
});

test('agenda: sync past 12h → red/very_stale', () => {
  const h = computeAgendaHealth(
    { calendar_status: 'success' },
    { last_synced_at: hoursAgo(13) },
    NOW,
  );
  assert.deepEqual(h, { level: 'red', reason: 'very_stale' });
});

test('agenda: run failed but source looks recent (≤6h) → amber/disagreement, not a hard red', () => {
  const h = computeAgendaHealth(
    { calendar_status: 'failed' },
    { last_synced_at: hoursAgo(2) },
    NOW,
  );
  assert.deepEqual(h, { level: 'amber', reason: 'disagreement' });
});

test('agenda: run failed and source is old (>6h) → red/run_failed, not disagreement', () => {
  const h = computeAgendaHealth(
    { calendar_status: 'failed' },
    { last_synced_at: hoursAgo(8) },
    NOW,
  );
  assert.deepEqual(h, { level: 'red', reason: 'run_failed' });
});

test('agenda: run failed with no source at all → red/run_failed', () => {
  const h = computeAgendaHealth({ calendar_status: 'failed' }, null, NOW);
  assert.deepEqual(h, { level: 'red', reason: 'run_failed' });
});

test('agenda: a run in progress → neutral/running, even with a very stale source', () => {
  const h = computeAgendaHealth(
    { status: 'running', finished_at: null, calendar_status: 'pending' },
    { last_synced_at: hoursAgo(30) },
    NOW,
  );
  assert.deepEqual(h, { level: 'neutral', reason: 'running' });
});

test('agenda: a run in progress → neutral/running, even with no source at all', () => {
  const h = computeAgendaHealth({ status: 'running', finished_at: null }, null, NOW);
  assert.deepEqual(h, { level: 'neutral', reason: 'running' });
});

test('agenda: a finished run with status="running" left over (finished_at set) is not treated as running', () => {
  const h = computeAgendaHealth(
    { status: 'running', finished_at: hoursAgo(1), calendar_status: 'success' },
    { last_synced_at: hoursAgo(1) },
    NOW,
  );
  assert.deepEqual(h, { level: 'green', reason: 'fresh' });
});

// ─── computeBriefingHealth ──────────────────────────────────────────────────

test('briefing: missing, before 17:00 → neutral/not_yet_due', () => {
  const h = computeBriefingHealth(null, new Date('2026-07-21T16:59:00+02:00'));
  assert.deepEqual(h, { level: 'neutral', reason: 'not_yet_due' });
});

test('briefing: missing, exactly at 17:00 → amber/missing_after_17', () => {
  const h = computeBriefingHealth(null, new Date('2026-07-21T17:00:00+02:00'));
  assert.deepEqual(h, { level: 'amber', reason: 'missing_after_17' });
});

test('briefing: missing, well after 17:00 → amber/missing_after_17', () => {
  const h = computeBriefingHealth(null, new Date('2026-07-21T20:00:00+02:00'));
  assert.deepEqual(h, { level: 'amber', reason: 'missing_after_17' });
});

test('briefing: status changed_after_sent → red, regardless of time', () => {
  const h = computeBriefingHealth(
    { status: 'changed_after_sent' },
    new Date('2026-07-21T08:00:00+02:00'),
  );
  assert.deepEqual(h, { level: 'red', reason: 'changed_after_sent' });
});

test('briefing: status sent → green, regardless of time', () => {
  const h = computeBriefingHealth({ status: 'sent' }, new Date('2026-07-21T08:00:00+02:00'));
  assert.deepEqual(h, { level: 'green', reason: 'sent' });
});

test('briefing: status ready, before 18:00 → neutral/ready_earlier', () => {
  const h = computeBriefingHealth({ status: 'ready' }, new Date('2026-07-21T17:59:00+02:00'));
  assert.deepEqual(h, { level: 'neutral', reason: 'ready_earlier' });
});

test('briefing: status ready, exactly at 18:00 → amber/ready_not_sent_after_18', () => {
  const h = computeBriefingHealth({ status: 'ready' }, new Date('2026-07-21T18:00:00+02:00'));
  assert.deepEqual(h, { level: 'amber', reason: 'ready_not_sent_after_18' });
});

// ─── computeNoticesHealth ───────────────────────────────────────────────────

test('notices: no status at all → neutral/no_data', () => {
  const h = computeNoticesHealth(null, { openCount: 0 });
  assert.deepEqual(h, { level: 'neutral', reason: 'no_data' });
});

test('notices: disabled → neutral/disabled, even with a nonzero open count', () => {
  const h = computeNoticesHealth({ notices_status: 'disabled' }, { openCount: 3 });
  assert.deepEqual(h, { level: 'neutral', reason: 'disabled' });
});

test('notices: failed → red/check_failed', () => {
  const h = computeNoticesHealth({ notices_status: 'failed' }, { openCount: 0 });
  assert.deepEqual(h, { level: 'red', reason: 'check_failed' });
});

test('notices: misconfigured → red/misconfigured', () => {
  const h = computeNoticesHealth({ notices_status: 'misconfigured' }, { openCount: 0 });
  assert.deepEqual(h, { level: 'red', reason: 'misconfigured' });
});

test('notices: success with no open discrepancies → green/clean', () => {
  const h = computeNoticesHealth({ notices_status: 'success' }, { openCount: 0 });
  assert.deepEqual(h, { level: 'green', reason: 'clean' });
});

test('notices: success with open discrepancies → amber/open_discrepancies', () => {
  const h = computeNoticesHealth({ notices_status: 'success' }, { openCount: 2 });
  assert.deepEqual(h, { level: 'amber', reason: 'open_discrepancies' });
});

test('notices: success with an undefined summary → treated as zero → green/clean', () => {
  const h = computeNoticesHealth({ notices_status: 'success' }, undefined);
  assert.deepEqual(h, { level: 'green', reason: 'clean' });
});
