/**
 * lib/admin-activity.js
 *
 * Turns a raw ma_activity_events row into what Beheer's "Recente activiteit"
 * timeline actually renders: a Dutch sentence, an actor label, an icon
 * category, and which filter bucket (Alles/Familie/Zorgteam/Systeem) it
 * belongs to. Everything here reads plain text out and returns plain text —
 * callers escape it at render time, same as the rest of the app. Nothing
 * here ever renders raw JSON.
 *
 * Every builder reads only the metadata keys documented in
 * METADATA_ALLOWLIST for its action — matches the DB triggers in
 * supabase-migrations/007_ma_admin_dashboard.sql, which never write
 * anything else into `metadata`.
 */

import { kindLabel } from './logboek-types.js';

/** Documents exactly which metadata keys each known action may carry. */
export const METADATA_ALLOWLIST = {
  logboek_created:          ['kind', 'audience', 'tag_count'],
  logboek_updated:          ['kind', 'audience', 'tag_count'],
  logboek_deleted:          ['kind', 'audience'],
  logboek_trashed:          ['kind', 'audience'],
  logboek_restored:         ['kind', 'audience'],
  logboek_audience_changed: ['kind', 'from_audience', 'to_audience'],
  comment_added:            [],
  attachment_added:         ['media_type'],
  attachment_removed:       ['media_type'],
  briefing_marked_sent:     ['briefing_date', 'from_status', 'to_status'],
  briefing_reopened:        ['briefing_date', 'from_status', 'to_status'],
  ride_notice_dismissed:    ['kind', 'ride_date'],
  caregiver_access_granted: [],
  caregiver_access_revoked: [],
  membership_role_changed:  ['from_role', 'to_role'],
  trusted_device_activated: [],
  trusted_device_revoked:   [],
  manual_sync_requested:    [],
};

const MEDIA_TYPE_LABELS = { image: 'foto', document: 'document' };
const AUDIENCE_LABELS   = { family: 'alleen familie', care_team: 'familie en zorgteam' };

function mediaTypeLabel(m) { return MEDIA_TYPE_LABELS[m] ?? 'bestand'; }
function audienceLabel(a)  { return AUDIENCE_LABELS[a] ?? a; }

// ─── Sentence builders — one per known action ────────────────────────────────

const SENTENCE_BUILDERS = {
  logboek_created: (m) => {
    const suffix = m.audience === 'care_team' ? ` (${audienceLabel(m.audience)})` : '';
    return `Heeft een ${kindLabel(m.kind).toLowerCase()} toegevoegd${suffix}.`;
  },
  logboek_updated: (m) => `Heeft een ${kindLabel(m.kind).toLowerCase()} bijgewerkt.`,
  logboek_deleted: (m) => `Heeft een ${kindLabel(m.kind).toLowerCase()} verwijderd.`,
  logboek_trashed: (m) => `Heeft een ${kindLabel(m.kind).toLowerCase()} naar de prullenbak verplaatst.`,
  logboek_restored: (m) => `Heeft een ${kindLabel(m.kind).toLowerCase()} teruggezet uit de prullenbak.`,
  logboek_audience_changed: (m) =>
    `Heeft de zichtbaarheid van een ${kindLabel(m.kind).toLowerCase()} gewijzigd naar ${audienceLabel(m.to_audience)}.`,
  comment_added: () => 'Heeft gereageerd op een logboekregel.',
  attachment_added:   (m) => `Heeft een ${mediaTypeLabel(m.media_type)} toegevoegd aan een logboekregel.`,
  attachment_removed: (m) => `Heeft een ${mediaTypeLabel(m.media_type)} verwijderd van een logboekregel.`,
  briefing_marked_sent: (m) =>
    `Heeft de briefing${m.briefing_date ? ` voor ${m.briefing_date}` : ''} als verzonden gemarkeerd.`,
  briefing_reopened: (m) =>
    `Heeft de briefing${m.briefing_date ? ` voor ${m.briefing_date}` : ''} heropend.`,
  ride_notice_dismissed: () => 'Heeft een melding van AutoMaatje genegeerd.',
  caregiver_access_granted: () => 'Heeft een zorgteamlid toegevoegd.',
  caregiver_access_revoked: () => 'Heeft de toegang van een zorgteamlid ingetrokken.',
  membership_role_changed: (m) =>
    m.to_role === 'owner'
      ? 'Heeft een familielid beheerdersrechten gegeven.'
      : 'Heeft de rol van een familielid gewijzigd.',
  trusted_device_activated: () => 'Heeft een vertrouwd apparaat gekoppeld.',
  trusted_device_revoked:   () => 'Heeft een vertrouwd apparaat ingetrokken.',
  manual_sync_requested:    () => 'Heeft een directe agenda-synchronisatie aangevraagd.',
};

const FALLBACK_SENTENCE = 'Er is een systeemactie geregistreerd.';

/** Icon category per action — several actions share one category/icon. */
const ICON_CATEGORY = {
  logboek_created: 'logboek', logboek_updated: 'logboek', logboek_deleted: 'logboek',
  logboek_trashed: 'logboek', logboek_restored: 'logboek',
  logboek_audience_changed: 'logboek',
  comment_added: 'comment',
  attachment_added: 'attachment', attachment_removed: 'attachment',
  briefing_marked_sent: 'briefing', briefing_reopened: 'briefing',
  ride_notice_dismissed: 'ride',
  caregiver_access_granted: 'care_team', caregiver_access_revoked: 'care_team',
  membership_role_changed: 'membership',
  trusted_device_activated: 'device', trusted_device_revoked: 'device',
  manual_sync_requested: 'system',
};

function iconWrap(inner) {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">${inner}</svg>`;
}

const ICONS = {
  logboek: iconWrap('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  comment: iconWrap('<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 1 1 8.5-8.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  attachment: iconWrap('<path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95L10.13 17.1a2 2 0 0 1-2.83-2.83l8.49-8.48" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  briefing: iconWrap('<rect x="8" y="3" width="8" height="4" rx="1" stroke="currentColor" stroke-width="2"/><path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  ride: iconWrap('<path d="M5 17h14M5 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm14 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM5 17V9l2-5h10l2 5v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  care_team: iconWrap('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>'),
  membership: iconWrap('<circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  device: iconWrap('<rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" stroke-width="2"/><line x1="10" y1="18" x2="14" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  system: iconWrap('<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
};

/**
 * Best-effort label for a system-sourced ('irma_sync') summary event, based
 * on source/action — the private irma-sync job's exact action vocabulary
 * lives outside this repo, so this degrades gracefully to "Systeem" for
 * anything it doesn't recognise rather than guessing wrong.
 */
function systemSourceLabel(source, action) {
  if (source !== 'irma_sync') return 'Systeem';
  const a = String(action || '');
  if (/calendar|agenda/.test(a)) return 'Agenda-sync';
  if (/briefing/.test(a))        return 'Briefing-sync';
  if (/mail|notice|ride/.test(a)) return 'E-mailcontrole';
  return 'Systeem';
}

/**
 * The actor label shown before the sentence — a real display name for a
 * human actor (resolved via the ma_profiles join already present on the
 * fetchAdminActivity row), or a system-source label for an automated one.
 * @param {object} event — row from api.fetchAdminActivity()
 */
export function actorLabel(event) {
  if (event.actor_type === 'system' || !event.actor_user_id) {
    return systemSourceLabel(event.source, event.action);
  }
  return event.ma_profiles?.display_name || 'Onbekend familielid';
}

/**
 * The Dutch sentence describing what happened, built only from the
 * documented safe metadata for that action.
 * @param {object} event
 */
export function activitySentence(event) {
  const builder = SENTENCE_BUILDERS[event.action];
  if (!builder) return FALLBACK_SENTENCE;
  try {
    return builder(event.metadata || {});
  } catch (err) {
    console.error('[ma/admin-activity] Failed to build sentence for', event.action, err);
    return FALLBACK_SENTENCE;
  }
}

/** Icon markup (already-safe inline SVG) for an event's category. */
export function activityIcon(event) {
  const category = ICON_CATEGORY[event.action] ?? 'system';
  return ICONS[category] ?? ICONS.system;
}

/**
 * Which filter bucket an event belongs to. ma_activity_events has no
 * actor-role column, so this cross-references the roster fetched separately
 * (api.fetchAdminRoster) rather than requiring a second query per event.
 * @param {object} event
 * @param {{ familyUserIds: Set<string>, caregiverUserIds: Set<string> }} roster
 * @returns {'family'|'care_team'|'system'}
 */
export function activityBucket(event, roster) {
  if (event.actor_type === 'system' || !event.actor_user_id) return 'system';
  if (roster?.caregiverUserIds?.has(event.actor_user_id)) return 'care_team';
  if (roster?.familyUserIds?.has(event.actor_user_id)) return 'family';
  return 'system';
}

/** Builds the { familyUserIds, caregiverUserIds } lookup activityBucket() needs. */
export function buildRosterLookup(rosterRows) {
  const familyUserIds    = new Set();
  const caregiverUserIds = new Set();
  for (const row of rosterRows ?? []) {
    if (row.access_type === 'caregiver') caregiverUserIds.add(row.user_id);
    else familyUserIds.add(row.user_id);
  }
  return { familyUserIds, caregiverUserIds };
}
