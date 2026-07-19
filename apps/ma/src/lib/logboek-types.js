/**
 * lib/logboek-types.js
 *
 * Shared entry-type / audience metadata for the Logboek — used by the
 * timeline, the compose flow, and the entry card so labels/icons/filters
 * stay in one place.
 *
 * kind covers every value ma_posts.kind currently allows (see
 * supabase-migrations/006_ma_logboek_care_team.sql). 'voice', 'prompt' and
 * 'today' predate the Logboek and have no dedicated filter chip — they still
 * render in "Alles" via the generic fallback so no existing row disappears.
 */

export const KIND_LABELS = {
  note:          'Notitie',
  photo:         "Foto",
  document:      'Document',
  observation:   'Observatie',
  event_report:  'Afspraakverslag',
};

const FALLBACK_KIND_LABEL = 'Notitie';

export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? FALLBACK_KIND_LABEL;
}

/** Filter chips shown above the timeline. `kind: null` means "Alles". */
export const KIND_FILTERS = [
  { kind: null,          label: 'Alles' },
  { kind: 'note',        label: 'Notities' },
  { kind: 'photo',       label: "Foto's" },
  { kind: 'document',    label: 'Documenten' },
  { kind: 'observation', label: 'Observaties' },
  { kind: 'event_report',label: 'Afspraakverslagen' },
];

/** Compose-screen type choices (legacy kinds are never author-selectable). */
export const COMPOSE_KINDS = [
  { kind: 'note',         label: 'Notitie' },
  { kind: 'photo',        label: 'Foto' },
  { kind: 'document',     label: 'Document' },
  { kind: 'observation',  label: 'Observatie' },
  { kind: 'event_report', label: 'Afspraakverslag' },
];

export const AUDIENCE_LABELS = {
  family:    'Alleen familie',
  care_team: 'Met zorgteam',
};

/** Audience filter chips shown to family users only (care team see care_team only). */
export const AUDIENCE_FILTERS = [
  { audience: null,        label: 'Alles' },
  { audience: 'family',    label: 'Alleen familie' },
  { audience: 'care_team', label: 'Met zorgteam' },
];

function iconWrap(inner) {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">${inner}</svg>`;
}

const KIND_ICONS = {
  note: iconWrap(`
    <path d="M4 4h16v16H4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <line x1="8" y1="9" x2="16" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="8" y1="17" x2="12" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  `),
  photo: iconWrap(`
    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
    <polyline points="21,15 16,10 5,21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  document: iconWrap(`
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  `),
  observation: iconWrap(`
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
  `),
  event_report: iconWrap(`
    <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
    <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2"/>
    <path d="M9 15l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  `),
};

const FALLBACK_ICON = KIND_ICONS.note;

export function kindIcon(kind) {
  return KIND_ICONS[kind] ?? FALLBACK_ICON;
}
