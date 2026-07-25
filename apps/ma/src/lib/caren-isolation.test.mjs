/**
 * Structural guarantees the Caren feature makes about the rest of the app.
 *
 * These are asserted against source text because the modules involved
 * (views/briefing.js, api.js) import the browser Supabase client over a
 * network URL and cannot be imported by a Node test. They are checked here
 * rather than left to code review because each one encodes an incident:
 *
 *   - the Logboek incident: embedding an optional relationship in a core
 *     select made one unavailable table blank an entire page. fetchBriefings()
 *     must therefore never mention a Caren table, and the Briefing view must
 *     load the enrichment through allSettled;
 *   - the shared-column-list trap: adding caren_status to
 *     INTEGRATION_RUN_COLUMNS would break every Beheer run query until
 *     migration 014 is applied;
 *   - the "no deletion inference" rule, which is a promise about a live care
 *     system and must not be softened by a stray string anywhere in the app.
 *
 * Run with Node's built-in runner:
 *   node --test apps/ma/src/lib/caren-isolation.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MA_ROOT = fileURLToPath(new URL('../../', import.meta.url)); // apps/ma/
const SRC_ROOT = path.join(MA_ROOT, 'src');

const read = (rel) => readFileSync(path.join(SRC_ROOT, rel), 'utf8');

/**
 * Source with comments removed. These files document the rules they follow —
 * caren-status.js literally spells out the phrases that must never be shown —
 * so a scan of raw source would match its own explanation. Only shipped code
 * and copy are checked.
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The body of a named exported function, up to the next top-level `}`. */
function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `end of ${name} not found`);
  return source.slice(start, end);
}

// ─── fetchBriefings stays independent of Caren ───────────────────────────────

test('fetchBriefings never selects or embeds a Caren table', () => {
  const body = functionBody(read('api.js'), 'fetchBriefings');
  assert.doesNotMatch(body, /caren_expected|caren_evidence|caren_match_reviews/,
    'Caren must not be embedded in the core briefing select — an unavailable ' +
    'relationship would blank the whole Briefing page (see the Logboek incident)');
  // The briefing's own caren_text column is a generated text, not a Caren table.
  assert.match(body, /caren_text/);
});

test('the shared integration-run column list does not carry caren_status', () => {
  const source = read('api.js');
  const listStart = source.indexOf('const INTEGRATION_RUN_COLUMNS');
  const listEnd = source.indexOf('`;', listStart);
  const list = source.slice(listStart, listEnd);
  assert.doesNotMatch(list, /caren_status/,
    'caren_status arrives with migration 014; adding it here would break every ' +
    'Beheer run query until that migration is applied. fetchLatestCarenRun() ' +
    'selects it separately for exactly this reason.');
});

test('fetchLatestCarenRun selects only the three columns it needs', () => {
  const body = functionBody(read('api.js'), 'fetchLatestCarenRun');
  assert.match(body, /select\('id, finished_at, caren_status'\)/);
});

test('no Caren API function selects a stored message id, URL or person id', () => {
  const source = withoutComments(read('api.js'));
  const carenBlock = source.slice(source.indexOf('CAREN_EXPECTED_ITEM_COLUMNS'));
  assert.doesNotMatch(carenBlock, /source_message_id/,
    'evidence identity is never exposed to the browser');
  assert.doesNotMatch(carenBlock, /caren\.nl|person_id|calendar_url/);
});

// ─── The Briefing view isolates the enrichment ───────────────────────────────

test('the Briefing view loads Caren through allSettled, not a bare await chain', () => {
  const source = read('views/briefing.js');
  assert.match(source, /Promise\.allSettled\(\[\s*\n\s*fetchCarenExpectedItems/,
    'a rejected Caren fetch must not reject the pair and abort the render');
});

test('the Briefing view renders briefing text before it touches Caren', () => {
  const source = read('views/briefing.js');
  const briefingsFetch = source.indexOf('await fetchBriefings(');
  const carenLoad = source.indexOf('await loadCarenEnrichment()');
  assert.ok(briefingsFetch !== -1 && carenLoad !== -1);
  assert.ok(briefingsFetch < carenLoad, 'briefings must be loaded first');
  // And a briefings failure returns before Caren is ever attempted.
  assert.match(source, /Kon de briefings niet laden[\s\S]{0,80}return;/);
});

test('the Briefing view gates Caren behind the shared viewer helper', () => {
  const source = read('views/briefing.js');
  assert.match(source, /carenSectionForViewer\(/);
  assert.match(source, /accessType,/);
});

test('the send toggle still calls only the briefing status endpoints', () => {
  const source = read('views/briefing.js');
  const toggle = source.slice(source.indexOf('async function toggleSent'));
  assert.match(toggle, /reopenBriefing\(briefing\.id\)/);
  assert.match(toggle, /markBriefingSent\(briefing\.id, userId\)/);
  // Nothing about Caren may touch the ready/sent/changed_after_sent workflow.
  assert.doesNotMatch(toggle.slice(0, toggle.indexOf('\n}')), /caren/i);
});

test('no Caren review path writes to ma_briefings', () => {
  const source = read('views/briefing.js');
  const carenAction = source.slice(
    source.indexOf('async function onCarenAction'),
    source.indexOf('function showCarenError'),
  );
  assert.doesNotMatch(carenAction, /markBriefingSent|reopenBriefing|ma_briefings/);
});

// ─── App-wide copy rules ─────────────────────────────────────────────────────

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

test('no app source claims an appointment is missing from Caren', () => {
  // "Ontbreekt in Caren" / "Niet in Caren" would be a claim this feature
  // cannot support: it sees positive evidence only, and no e-mail is not
  // evidence of absence. An owner acting on a false claim would duplicate an
  // appointment in a live care system.
  const FORBIDDEN = [
    /ontbreekt in caren/i,
    /niet in caren\b/i,
    /staat niet in caren/i,
    /verwijderd uit caren/i,
  ];
  for (const file of walk(SRC_ROOT)) {
    if (!/\.(js|mjs)$/.test(file) || file.endsWith('.test.mjs')) continue;
    const contents = withoutComments(readFileSync(file, 'utf8'));
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(contents, pattern, `${path.relative(MA_ROOT, file)} matches ${pattern}`);
    }
  }
});

test('the Briefing empty state no longer claims an hourly sync', () => {
  const source = read('views/briefing.js');
  assert.doesNotMatch(source, /draait elk uur/);
  assert.match(source, /draait elke drie uur en kan door een beheerder handmatig worden gestart/);
});

test('Today carries a compact Caren count only, never a Caren list', () => {
  const source = read('views/today.js');
  assert.match(source, /carenTodayLine\(/);
  // renderCarenSection is the full per-item list; it belongs on Briefing only.
  assert.doesNotMatch(source, /renderCarenSection|carenSectionForViewer/);
  // And it is owner-gated at the call site as well as in the lib.
  assert.match(source, /accessType === 'owner'[\s\S]{0,120}renderCarenSignal/);
});
