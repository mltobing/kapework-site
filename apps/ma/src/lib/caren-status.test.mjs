/**
 * Tests for the owner-only Caren reconciliation rules.
 *
 * Two of these guard promises rather than mechanics:
 *
 *   - the wording never claims an appointment is *missing* from Caren. The
 *     feature only ever sees positive evidence; "no e-mail arrived" is
 *     indistinguishable from "Caren did not notify" and from "the check never
 *     ran". An owner acting on a false "ontbreekt" would create a duplicate
 *     appointment in a live care system.
 *   - a `not_seen` is only presented as current when a recent successful
 *     stage actually looked.
 *
 * Run with Node's built-in runner:
 *   node --test apps/ma/src/lib/caren-status.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAREN_CAVEAT,
  CAREN_SUMMARY_PRECEDENCE,
  activeCarenItems,
  carenAttentionIsActionable,
  carenErrorCode,
  carenErrorText,
  carenFreshness,
  carenItemAction,
  carenItemStatusLabel,
  carenItemsNeedingAttention,
  carenSummaryBadge,
  deriveCarenSummary,
  shouldShowCarenSection,
} from './caren-status.js';

const item = (status, over = {}) => ({ id: `i-${status}`, status, ...over });
const CURRENT = { level: 'current', note: null };

// ─── Summary derivation ──────────────────────────────────────────────────────

test('no items at all is "none", not "not_seen"', () => {
  assert.equal(deriveCarenSummary([]), 'none');
  assert.equal(deriveCarenSummary(null), 'none');
  // A day whose only item is retired has nothing left to reconcile.
  assert.equal(deriveCarenSummary([item('retired')]), 'none');
});

test('all items seen or manually confirmed is "seen"', () => {
  assert.equal(deriveCarenSummary([item('seen')]), 'seen');
  assert.equal(deriveCarenSummary([item('seen'), item('manually_confirmed')]), 'seen');
});

test('some satisfied and some not is "partly_seen"', () => {
  assert.equal(deriveCarenSummary([item('seen'), item('not_seen')]), 'partly_seen');
  assert.equal(deriveCarenSummary([item('manually_confirmed'), item('not_seen')]), 'partly_seen');
});

test('nothing satisfied is "not_seen"', () => {
  assert.equal(deriveCarenSummary([item('not_seen'), item('not_seen')]), 'not_seen');
});

test('any changed_after_seen wins over everything else', () => {
  assert.equal(
    deriveCarenSummary([item('seen'), item('seen'), item('changed_after_seen')]),
    'changed_after_seen',
  );
  assert.equal(
    deriveCarenSummary([item('changed_after_seen'), item('ambiguous')]),
    'changed_after_seen',
  );
});

test('any ambiguous outranks partly_seen, seen and not_seen', () => {
  assert.equal(deriveCarenSummary([item('seen'), item('ambiguous')]), 'ambiguous');
  assert.equal(deriveCarenSummary([item('not_seen'), item('ambiguous')]), 'ambiguous');
});

test('the documented precedence order holds end to end', () => {
  // Build one day containing every status, then remove them most-urgent first
  // and assert the summary steps down exactly the documented ladder.
  assert.deepEqual(CAREN_SUMMARY_PRECEDENCE, [
    'changed_after_seen', 'ambiguous', 'partly_seen', 'seen', 'not_seen',
  ]);

  const all = [item('changed_after_seen'), item('ambiguous'), item('seen'), item('not_seen')];
  assert.equal(deriveCarenSummary(all), 'changed_after_seen');
  assert.equal(deriveCarenSummary(all.slice(1)), 'ambiguous');
  assert.equal(deriveCarenSummary(all.slice(2)), 'partly_seen');
  assert.equal(deriveCarenSummary(all.slice(2, 3)), 'seen');
  assert.equal(deriveCarenSummary(all.slice(3)), 'not_seen');
});

test('retired items are excluded from every count', () => {
  assert.deepEqual(activeCarenItems([item('seen'), item('retired')]).map(i => i.status), ['seen']);
  assert.equal(deriveCarenSummary([item('seen'), item('retired')]), 'seen');
  assert.equal(carenItemsNeedingAttention([item('retired'), item('not_seen')]).length, 1);
});

test('items needing attention are exactly not_seen, changed_after_seen and ambiguous', () => {
  const items = [
    item('seen'), item('manually_confirmed'), item('retired'),
    item('not_seen'), item('changed_after_seen'), item('ambiguous'),
  ];
  assert.deepEqual(
    carenItemsNeedingAttention(items).map(i => i.status).sort(),
    ['ambiguous', 'changed_after_seen', 'not_seen'],
  );
});

// ─── Wording ─────────────────────────────────────────────────────────────────

test('nothing ever claims an appointment is missing from Caren', () => {
  const FORBIDDEN = /ontbreek|niet in caren|staat niet/i;

  for (const summary of ['seen', 'partly_seen', 'not_seen', 'changed_after_seen', 'ambiguous']) {
    const badge = carenSummaryBadge(summary, CURRENT);
    assert.doesNotMatch(badge.label, FORBIDDEN, summary);
  }
  for (const status of ['not_seen', 'seen', 'changed_after_seen', 'ambiguous', 'manually_confirmed']) {
    assert.doesNotMatch(carenItemStatusLabel(status), FORBIDDEN, status);
    const action = carenItemAction(status);
    if (action) assert.doesNotMatch(action.label, FORBIDDEN, status);
  }
  for (const code of ['caren_unavailable', 'caren_stale', 'caren_invalid_item',
                      'caren_invalid_evidence', 'caren_review_failed']) {
    assert.doesNotMatch(carenErrorText(code), FORBIDDEN, code);
  }
  assert.doesNotMatch(CAREN_CAVEAT, /ontbreek\w*\s+in\s+caren/i);
});

test('the not-seen wording is "Nog niet gezien in Caren"', () => {
  assert.equal(carenSummaryBadge('not_seen', CURRENT).label, 'Nog niet gezien in Caren');
  assert.equal(carenItemStatusLabel('not_seen'), 'Nog niet gezien in Caren');
});

test('the caveat states that absence is not evidence and deletion is undetectable', () => {
  assert.match(CAREN_CAVEAT, /positieve signalen/i);
  assert.match(CAREN_CAVEAT, /geen e-mail betekent niet automatisch/i);
  assert.match(CAREN_CAVEAT, /verwijderingen kunnen hiermee niet betrouwbaar/i);
});

test('a summary of "none" produces no badge at all', () => {
  assert.equal(carenSummaryBadge('none', CURRENT), null);
});

// ─── Freshness ───────────────────────────────────────────────────────────────

const NOW = new Date('2026-07-25T12:00:00Z');
const runAt = (iso, caren_status = 'success') => ({ caren_status, finished_at: iso });

test('a successful check within six hours is current', () => {
  assert.equal(carenFreshness(runAt('2026-07-25T09:00:00Z'), NOW).level, 'current');
  assert.equal(carenFreshness(runAt('2026-07-25T06:00:00Z'), NOW).level, 'current');
});

test('six to twelve hours old is aging, with a mild note', () => {
  const f = carenFreshness(runAt('2026-07-25T02:00:00Z'), NOW);
  assert.equal(f.level, 'aging');
  assert.match(f.note, /enkele uren oud/i);
});

test('older than twelve hours is stale', () => {
  assert.equal(carenFreshness(runAt('2026-07-24T20:00:00Z'), NOW).level, 'stale');
});

test('a failed or misconfigured stage is stale regardless of age', () => {
  assert.equal(carenFreshness(runAt('2026-07-25T11:59:00Z', 'failed'), NOW).level, 'stale');
  assert.equal(carenFreshness(runAt('2026-07-25T11:59:00Z', 'misconfigured'), NOW).level, 'stale');
});

test('no run, or a skipped stage, is unavailable', () => {
  assert.equal(carenFreshness(null, NOW).level, 'unavailable');
  assert.equal(carenFreshness({ caren_status: 'skipped' }, NOW).level, 'unavailable');
  assert.equal(carenFreshness({ caren_status: 'pending' }, NOW).level, 'unavailable');
});

test('a disabled stage hides the section entirely rather than alarming anyone', () => {
  const f = carenFreshness({ caren_status: 'disabled' }, NOW);
  assert.equal(f.level, 'disabled');
  assert.equal(shouldShowCarenSection(f), false);
  assert.equal(shouldShowCarenSection(CURRENT), true);
});

test('a stale check replaces an unconfirmed summary with "niet actueel"', () => {
  const stale = { level: 'stale', note: 'x' };
  assert.equal(carenSummaryBadge('not_seen', stale).label,    'Caren-controle niet actueel');
  assert.equal(carenSummaryBadge('partly_seen', stale).label, 'Caren-controle niet actueel');
});

test('a stale check does not retract evidence that was actually seen', () => {
  // Old positive evidence does not become untrue because the stage is late.
  const stale = { level: 'stale', note: 'x' };
  assert.equal(carenSummaryBadge('seen', stale).label, 'Gezien in Caren ✓');
  assert.equal(carenSummaryBadge('changed_after_seen', stale).label, 'Ma is gewijzigd sinds Caren');
});

test('Today only nudges when the check is genuinely recent', () => {
  assert.equal(carenAttentionIsActionable({ level: 'current' }), true);
  assert.equal(carenAttentionIsActionable({ level: 'aging' }), true);
  assert.equal(carenAttentionIsActionable({ level: 'stale' }), false);
  assert.equal(carenAttentionIsActionable({ level: 'unavailable' }), false);
  assert.equal(carenAttentionIsActionable({ level: 'disabled' }), false);
});

// ─── Actions ─────────────────────────────────────────────────────────────────

test('each status offers exactly the documented owner action', () => {
  assert.equal(carenItemAction('not_seen').label, 'Markeer handmatig als in Caren');
  assert.equal(carenItemAction('not_seen').action, 'manual_confirm');
  assert.equal(carenItemAction('changed_after_seen').label, 'Bevestig de nieuwe versie handmatig');
  assert.equal(carenItemAction('ambiguous').label, 'Vergelijk');
  assert.equal(carenItemAction('seen').label, 'Heropen controle');
  assert.equal(carenItemAction('manually_confirmed').action, 'reopen');
});

test('manual confirmation uses the exact confirmation sentence', () => {
  assert.equal(carenItemAction('not_seen').confirm, 'Ik bevestig dat deze afspraak in Caren staat.');
});

test('only the ambiguous flow involves an evidence id', () => {
  assert.equal(carenItemAction('ambiguous').needsEvidence, true);
  for (const status of ['not_seen', 'changed_after_seen', 'seen', 'manually_confirmed']) {
    assert.equal(carenItemAction(status).needsEvidence, false, status);
  }
});

// ─── Error copy ──────────────────────────────────────────────────────────────

test('known RPC failures map to their controlled copy', () => {
  assert.equal(carenErrorCode(new Error('caren_invalid_item')), 'caren_invalid_item');
  assert.equal(carenErrorCode(new Error('caren_invalid_evidence')), 'caren_invalid_evidence');
  // An authorisation failure is reported as "cannot be changed", not as a
  // hint about who is allowed to do what.
  assert.equal(carenErrorCode(new Error('caren_review_unauthorised')), 'caren_invalid_item');
});

test('a raw database error never reaches the owner', () => {
  const err = new Error('duplicate key value violates unique constraint "ma_caren_expected_items_pkey"');
  assert.equal(carenErrorCode(err), 'caren_review_failed');
  const text = carenErrorText(carenErrorCode(err));
  assert.equal(text, 'Kon de Caren-controle niet opslaan. Probeer het opnieuw.');
  assert.doesNotMatch(text, /constraint|null|pkey|PGRST|IMAP|select/i);
});

test('an unknown error code still yields safe copy', () => {
  assert.equal(carenErrorText('something_unexpected'), 'Kon de Caren-controle niet opslaan. Probeer het opnieuw.');
  assert.equal(carenErrorCode(undefined), 'caren_review_failed');
  assert.equal(carenErrorCode({}), 'caren_review_failed');
});
