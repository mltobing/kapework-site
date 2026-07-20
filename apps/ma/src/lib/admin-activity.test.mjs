/**
 * Tests for the Beheer "Recente activiteit" mapping module.
 *
 * Run with Node's built-in runner (no dependencies):
 *   node --test apps/ma/src/lib/admin-activity.test.mjs
 *
 * These tests exercise the sentence/icon/actor/bucket mapping using neutral
 * synthetic fixtures only — no real names, emails, or family/user IDs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METADATA_ALLOWLIST,
  actorLabel,
  activitySentence,
  activityIcon,
  activityBucket,
  buildRosterLookup,
} from './admin-activity.js';

function event(overrides = {}) {
  return {
    actor_type: 'user',
    actor_user_id: 'user-aaaa',
    action: 'logboek_created',
    source: 'app',
    metadata: {},
    ma_profiles: { display_name: 'Test Persoon' },
    ...overrides,
  };
}

// ─── activitySentence ───────────────────────────────────────────────────────

test('logboek_created without care_team audience has no visibility suffix', () => {
  const s = activitySentence(event({ metadata: { kind: 'note', audience: 'family' } }));
  assert.equal(s, 'Heeft een notitie toegevoegd.');
});

test('logboek_created with care_team audience appends the visibility suffix', () => {
  const s = activitySentence(event({ metadata: { kind: 'photo', audience: 'care_team' } }));
  assert.equal(s, 'Heeft een foto toegevoegd (familie en zorgteam).');
});

test('logboek_updated / logboek_deleted use the kind label, lowercased', () => {
  assert.equal(
    activitySentence(event({ action: 'logboek_updated', metadata: { kind: 'document' } })),
    'Heeft een document bijgewerkt.',
  );
  assert.equal(
    activitySentence(event({ action: 'logboek_deleted', metadata: { kind: 'observation' } })),
    'Heeft een observatie verwijderd.',
  );
});

test('logboek_audience_changed reports the new audience', () => {
  const s = activitySentence(event({
    action: 'logboek_audience_changed',
    metadata: { kind: 'event_report', from_audience: 'family', to_audience: 'care_team' },
  }));
  assert.equal(s, 'Heeft de zichtbaarheid van een afspraakverslag gewijzigd naar familie en zorgteam.');
});

test('comment_added carries no metadata and needs none', () => {
  assert.equal(activitySentence(event({ action: 'comment_added', metadata: {} })), 'Heeft gereageerd op een logboekregel.');
});

test('attachment_added / attachment_removed use the media type label with a safe fallback', () => {
  assert.equal(
    activitySentence(event({ action: 'attachment_added', metadata: { media_type: 'image' } })),
    'Heeft een foto toegevoegd aan een logboekregel.',
  );
  assert.equal(
    activitySentence(event({ action: 'attachment_removed', metadata: { media_type: 'document' } })),
    'Heeft een document verwijderd van een logboekregel.',
  );
  assert.equal(
    activitySentence(event({ action: 'attachment_added', metadata: { media_type: 'unknown_type' } })),
    'Heeft een bestand toegevoegd aan een logboekregel.',
  );
});

test('briefing_marked_sent / briefing_reopened include the date when present, omit it when absent', () => {
  assert.equal(
    activitySentence(event({ action: 'briefing_marked_sent', metadata: { briefing_date: '2026-07-22' } })),
    'Heeft de briefing voor 2026-07-22 als verzonden gemarkeerd.',
  );
  assert.equal(
    activitySentence(event({ action: 'briefing_marked_sent', metadata: {} })),
    'Heeft de briefing als verzonden gemarkeerd.',
  );
  assert.equal(
    activitySentence(event({ action: 'briefing_reopened', metadata: { briefing_date: '2026-07-22' } })),
    'Heeft de briefing voor 2026-07-22 heropend.',
  );
});

test('ride_notice_dismissed / caregiver_access_* / trusted_device_* are fixed sentences', () => {
  assert.equal(activitySentence(event({ action: 'ride_notice_dismissed', metadata: {} })), 'Heeft een melding van AutoMaatje genegeerd.');
  assert.equal(activitySentence(event({ action: 'caregiver_access_granted', metadata: {} })), 'Heeft een zorgteamlid toegevoegd.');
  assert.equal(activitySentence(event({ action: 'caregiver_access_revoked', metadata: {} })), 'Heeft de toegang van een zorgteamlid ingetrokken.');
  assert.equal(activitySentence(event({ action: 'trusted_device_activated', metadata: {} })), 'Heeft een vertrouwd apparaat gekoppeld.');
  assert.equal(activitySentence(event({ action: 'trusted_device_revoked', metadata: {} })), 'Heeft een vertrouwd apparaat ingetrokken.');
});

test('logboek_trashed / logboek_restored use the kind label, lowercased', () => {
  assert.equal(
    activitySentence(event({ action: 'logboek_trashed', metadata: { kind: 'note' } })),
    'Heeft een notitie naar de prullenbak verplaatst.',
  );
  assert.equal(
    activitySentence(event({ action: 'logboek_restored', metadata: { kind: 'note' } })),
    'Heeft een notitie teruggezet uit de prullenbak.',
  );
});

test('manual_sync_requested is a fixed sentence and carries no metadata', () => {
  assert.equal(
    activitySentence(event({ action: 'manual_sync_requested', metadata: {} })),
    'Heeft een directe agenda-synchronisatie aangevraagd.',
  );
  assert.deepEqual(METADATA_ALLOWLIST.manual_sync_requested, []);
});

test('membership_role_changed distinguishes promotion to owner from any other role change', () => {
  assert.equal(
    activitySentence(event({ action: 'membership_role_changed', metadata: { from_role: 'member', to_role: 'owner' } })),
    'Heeft een familielid beheerdersrechten gegeven.',
  );
  assert.equal(
    activitySentence(event({ action: 'membership_role_changed', metadata: { from_role: 'owner', to_role: 'member' } })),
    'Heeft de rol van een familielid gewijzigd.',
  );
});

test('an unrecognised action falls back to the generic sentence, never throwing', () => {
  assert.equal(
    activitySentence(event({ action: 'some_future_action_not_yet_known', metadata: { anything: 'goes' } })),
    'Er is een systeemactie geregistreerd.',
  );
});

test('a known action with malformed/missing metadata falls back gracefully instead of throwing', () => {
  assert.doesNotThrow(() => activitySentence(event({ action: 'logboek_created', metadata: null })));
  const s = activitySentence(event({ action: 'logboek_created', metadata: null }));
  assert.equal(typeof s, 'string');
});

// ─── METADATA_ALLOWLIST discipline ──────────────────────────────────────────

test('every action with a sentence builder is documented in METADATA_ALLOWLIST', () => {
  // Cross-checks the two hand-maintained tables in admin-activity.js don't
  // drift apart — every action activitySentence() knows about must also be
  // in the allowlist, so the privacy contract stays self-documenting.
  const knownActions = [
    'logboek_created', 'logboek_updated', 'logboek_deleted',
    'logboek_trashed', 'logboek_restored', 'logboek_audience_changed',
    'comment_added', 'attachment_added', 'attachment_removed',
    'briefing_marked_sent', 'briefing_reopened', 'ride_notice_dismissed',
    'caregiver_access_granted', 'caregiver_access_revoked', 'membership_role_changed',
    'trusted_device_activated', 'trusted_device_revoked', 'manual_sync_requested',
  ];
  for (const action of knownActions) {
    assert.ok(Object.prototype.hasOwnProperty.call(METADATA_ALLOWLIST, action), `missing allowlist entry for ${action}`);
  }
});

test('trusted-device metadata allowlist is empty — pairing codes/tokens/labels are never audited', () => {
  assert.deepEqual(METADATA_ALLOWLIST.trusted_device_activated, []);
  assert.deepEqual(METADATA_ALLOWLIST.trusted_device_revoked, []);
});

// ─── activityIcon ───────────────────────────────────────────────────────────

test('activityIcon returns markup for known and unknown actions alike, never throwing', () => {
  const known = activityIcon(event({ action: 'logboek_created' }));
  const unknown = activityIcon(event({ action: 'totally_unknown' }));
  assert.match(known, /^<svg/);
  assert.match(unknown, /^<svg/);
});

test('actions sharing a category resolve to the identical icon markup', () => {
  const created = activityIcon(event({ action: 'logboek_created' }));
  const updated = activityIcon(event({ action: 'logboek_updated' }));
  assert.equal(created, updated);
});

// ─── actorLabel ─────────────────────────────────────────────────────────────

test('a human actor with a resolved profile shows their display name', () => {
  assert.equal(actorLabel(event({ actor_type: 'user', ma_profiles: { display_name: 'Test Persoon' } })), 'Test Persoon');
});

test('a human actor with no resolved profile falls back to a neutral label, never null/undefined', () => {
  assert.equal(actorLabel(event({ actor_type: 'user', ma_profiles: null })), 'Onbekend familielid');
});

test('a system actor never shows a profile name, even if one happens to be present', () => {
  const label = actorLabel(event({
    actor_type: 'system', actor_user_id: null, source: 'irma_sync', action: 'calendar_sync_completed',
    ma_profiles: { display_name: 'Should Never Show' },
  }));
  assert.notEqual(label, 'Should Never Show');
});

test('system actor label heuristically categorises by source/action, defaulting to a generic label', () => {
  assert.equal(actorLabel(event({ actor_type: 'system', source: 'irma_sync', action: 'agenda_sync_ok' })), 'Agenda-sync');
  assert.equal(actorLabel(event({ actor_type: 'system', source: 'irma_sync', action: 'briefing_generated' })), 'Briefing-sync');
  assert.equal(actorLabel(event({ actor_type: 'system', source: 'irma_sync', action: 'ride_mail_checked' })), 'E-mailcontrole');
  assert.equal(actorLabel(event({ actor_type: 'system', source: 'irma_sync', action: 'something_unrecognised' })), 'Systeem');
  assert.equal(actorLabel(event({ actor_type: 'system', source: 'some_other_job', action: 'agenda_sync_ok' })), 'Systeem');
});

test('a missing actor_user_id is treated as a system event even if actor_type says human', () => {
  // Defensive: an event with no actor recorded must never be attributed to a
  // person, regardless of how actor_type was set.
  assert.equal(actorLabel(event({ actor_type: 'user', actor_user_id: null })), 'Systeem');
});

// ─── activityBucket ─────────────────────────────────────────────────────────

const roster = buildRosterLookup([
  { user_id: 'user-aaaa', access_type: 'owner' },
  { user_id: 'user-bbbb', access_type: 'member' },
  { user_id: 'user-cccc', access_type: 'caregiver' },
]);

test('a family member actor buckets as family', () => {
  assert.equal(activityBucket(event({ actor_user_id: 'user-bbbb' }), roster), 'family');
});

test('a caregiver actor buckets as care_team', () => {
  assert.equal(activityBucket(event({ actor_user_id: 'user-cccc' }), roster), 'care_team');
});

test('a system-sourced event buckets as system regardless of roster contents', () => {
  assert.equal(activityBucket(event({ actor_type: 'system', actor_user_id: null }), roster), 'system');
});

test('an actor not present in the roster (e.g. revoked access) buckets as system rather than guessing', () => {
  assert.equal(activityBucket(event({ actor_user_id: 'user-zzzz-unknown' }), roster), 'system');
});

test('activityBucket tolerates an empty/undefined roster without throwing', () => {
  assert.doesNotThrow(() => activityBucket(event({ actor_user_id: 'user-bbbb' }), undefined));
  assert.equal(activityBucket(event({ actor_user_id: 'user-bbbb' }), undefined), 'system');
});

// ─── buildRosterLookup ──────────────────────────────────────────────────────

test('buildRosterLookup sorts owner/member into familyUserIds and caregiver into caregiverUserIds', () => {
  const lookup = buildRosterLookup([
    { user_id: 'u1', access_type: 'owner' },
    { user_id: 'u2', access_type: 'member' },
    { user_id: 'u3', access_type: 'caregiver' },
  ]);
  assert.equal(lookup.familyUserIds.has('u1'), true);
  assert.equal(lookup.familyUserIds.has('u2'), true);
  assert.equal(lookup.familyUserIds.has('u3'), false);
  assert.equal(lookup.caregiverUserIds.has('u3'), true);
});

test('buildRosterLookup tolerates a null/undefined rows argument', () => {
  const lookup = buildRosterLookup(undefined);
  assert.equal(lookup.familyUserIds.size, 0);
  assert.equal(lookup.caregiverUserIds.size, 0);
});
