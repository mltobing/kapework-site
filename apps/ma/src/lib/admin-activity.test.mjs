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

test('appointment_notice_dismissed is a fixed sentence', () => {
  assert.equal(
    activitySentence(event({ action: 'appointment_notice_dismissed', metadata: { kind: 'confirmation', appointment_date: '2026-07-22' } })),
    'Heeft een melding over een afspraak genegeerd.',
  );
});

test('calendar_write_requested names the source kind and adds an item count only when there is more than one', () => {
  assert.equal(
    activitySentence(event({ action: 'calendar_write_requested', metadata: { source_kind: 'ride_notice', event_count: 1 } })),
    'Heeft gevraagd om een rit toe te voegen aan de agenda.',
  );
  assert.equal(
    activitySentence(event({ action: 'calendar_write_requested', metadata: { source_kind: 'ride_notice', event_count: 2 } })),
    'Heeft gevraagd om een rit toe te voegen aan de agenda (2 items).',
  );
  assert.equal(
    activitySentence(event({ action: 'calendar_write_requested', metadata: { source_kind: 'appointment_notice', event_count: 1 } })),
    'Heeft gevraagd om een afspraak toe te voegen aan de agenda.',
  );
});

test('calendar_write_completed maps success/partial/failed to distinct safe Dutch copy', () => {
  assert.equal(
    activitySentence(event({ action: 'calendar_write_completed', metadata: { result: 'success', event_count: 2 } })),
    'Heeft 2 items aan de agenda toegevoegd.',
  );
  assert.equal(
    activitySentence(event({ action: 'calendar_write_completed', metadata: { result: 'success', event_count: 1 } })),
    'Heeft 1 item aan de agenda toegevoegd.',
  );
  assert.equal(
    activitySentence(event({ action: 'calendar_write_completed', metadata: { result: 'partial', event_count: 2 } })),
    'Heeft de agenda gedeeltelijk bijgewerkt; niet alles kon worden toegevoegd.',
  );
  assert.equal(
    activitySentence(event({ action: 'calendar_write_completed', metadata: { result: 'failed', event_count: 0 } })),
    'Kon niet toevoegen aan de agenda.',
  );
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

// ─── calendar_changed / briefings_generated / ride_notices_changed / pipeline_attention ──

test('calendar_changed allowlist is exactly created/updated/cancelled', () => {
  assert.deepEqual(METADATA_ALLOWLIST.calendar_changed, ['created', 'updated', 'cancelled']);
});

test('calendar_changed builds a natural Dutch sentence with only non-zero parts, correct singular/plural', () => {
  assert.equal(
    activitySentence(event({ action: 'calendar_changed', metadata: { created: 1, updated: 2, cancelled: 1 } })),
    'Heeft de agenda bijgewerkt: 1 afspraak toegevoegd, 2 afspraken gewijzigd en 1 afspraak geannuleerd.',
  );
  assert.equal(
    activitySentence(event({ action: 'calendar_changed', metadata: { created: 1, updated: 0, cancelled: 0 } })),
    'Heeft de agenda bijgewerkt: 1 afspraak toegevoegd.',
  );
  assert.equal(
    activitySentence(event({ action: 'calendar_changed', metadata: { created: 2, updated: 3, cancelled: 0 } })),
    'Heeft de agenda bijgewerkt: 2 afspraken toegevoegd en 3 afspraken gewijzigd.',
  );
});

test('calendar_changed with every count zero falls back to a calm "checked, nothing changed" sentence', () => {
  assert.equal(
    activitySentence(event({ action: 'calendar_changed', metadata: { created: 0, updated: 0, cancelled: 0 } })),
    'Heeft de agenda gecontroleerd; geen wijzigingen gevonden.',
  );
  assert.equal(
    activitySentence(event({ action: 'calendar_changed', metadata: {} })),
    'Heeft de agenda gecontroleerd; geen wijzigingen gevonden.',
  );
});

test('briefings_generated: singular, plural, and zero/malformed fallback', () => {
  assert.equal(
    activitySentence(event({ action: 'briefings_generated', metadata: { updated: 1 } })),
    'Heeft 1 briefing bijgewerkt.',
  );
  assert.equal(
    activitySentence(event({ action: 'briefings_generated', metadata: { updated: 3 } })),
    'Heeft 3 briefings bijgewerkt.',
  );
  assert.equal(
    activitySentence(event({ action: 'briefings_generated', metadata: { updated: 0 } })),
    'Heeft de briefings gecontroleerd.',
  );
  assert.equal(
    activitySentence(event({ action: 'briefings_generated', metadata: {} })),
    'Heeft de briefings gecontroleerd.',
  );
});

test('ride_notices_changed builds a natural Dutch sentence with only non-zero parts, correct singular/plural', () => {
  assert.equal(
    activitySentence(event({ action: 'ride_notices_changed', metadata: { written: 1, superseded: 2, auto_resolved: 1 } })),
    'Heeft AutoMaatje bijgewerkt: 1 melding toegevoegd, 2 meldingen vervangen en 1 melding automatisch opgelost.',
  );
  assert.equal(
    activitySentence(event({ action: 'ride_notices_changed', metadata: { written: 1 } })),
    'Heeft AutoMaatje bijgewerkt: 1 melding toegevoegd.',
  );
});

test('ride_notices_changed with every count zero falls back to a calm "checked" sentence', () => {
  assert.equal(
    activitySentence(event({ action: 'ride_notices_changed', metadata: {} })),
    'Heeft AutoMaatje gecontroleerd.',
  );
});

test('pipeline_attention maps every required status/error_stage combination to safe Dutch copy, never the raw stage', () => {
  assert.equal(
    activitySentence(event({ action: 'pipeline_attention', metadata: { status: 'partial', error_stage: 'notices' } })),
    'De agenda en briefings zijn bijgewerkt, maar de AutoMaatje-controle vraagt aandacht.',
  );
  assert.equal(
    activitySentence(event({ action: 'pipeline_attention', metadata: { status: 'partial', error_stage: 'something_unrecognised' } })),
    'De synchronisatie is gedeeltelijk voltooid en vraagt aandacht.',
  );
  for (const stage of ['fetch', 'mirror', 'touch_source']) {
    assert.equal(
      activitySentence(event({ action: 'pipeline_attention', metadata: { status: 'failed', error_stage: stage } })),
      'De agenda-synchronisatie is mislukt.',
    );
  }
  for (const stage of ['load_briefings', 'briefings']) {
    assert.equal(
      activitySentence(event({ action: 'pipeline_attention', metadata: { status: 'failed', error_stage: stage } })),
      'De briefing-synchronisatie is mislukt.',
    );
  }
  assert.equal(
    activitySentence(event({ action: 'pipeline_attention', metadata: { status: 'failed', error_stage: 'notices' } })),
    'De AutoMaatje-controle is mislukt.',
  );
  assert.equal(
    activitySentence(event({ action: 'pipeline_attention', metadata: { status: 'failed', error_stage: 'something_unrecognised' } })),
    'De synchronisatie is mislukt.',
  );
  assert.equal(
    activitySentence(event({ action: 'pipeline_attention', metadata: { status: 'unknown_status' } })),
    'De synchronisatie is mislukt.',
  );
});

test('pipeline_attention never renders the raw error_stage value in its output', () => {
  const s = activitySentence(event({
    action: 'pipeline_attention',
    metadata: { status: 'partial', error_stage: 'some_raw_internal_stage_name' },
  }));
  assert.ok(!s.includes('some_raw_internal_stage_name'));
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
    'appointment_notice_dismissed', 'calendar_write_requested', 'calendar_write_completed',
    'caregiver_access_granted', 'caregiver_access_revoked', 'membership_role_changed',
    'trusted_device_activated', 'trusted_device_revoked', 'manual_sync_requested',
    'calendar_changed', 'briefings_generated', 'ride_notices_changed', 'pipeline_attention',
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
