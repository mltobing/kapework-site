/**
 * lib/caren-status.js
 *
 * Pure rules for the owner-only Caren reconciliation display: summary
 * derivation, precedence, badge copy, freshness, and safe error copy.
 *
 * Kept out of the views so every rule is unit-testable without a browser, and
 * so the one thing that must never drift — the wording — lives in one place.
 *
 * ---------------------------------------------------------------------------
 * The rule that governs all the copy in this file
 * ---------------------------------------------------------------------------
 * Caren notification e-mails are POSITIVE evidence only. Receiving one proves
 * an appointment existed in Caren when the message was generated. Receiving
 * none proves nothing whatsoever: Caren may not have notified, the mail may
 * have been filtered, or the reconciliation stage may simply not have run.
 *
 * So the copy is "Nog niet gezien in Caren" — not seen *yet*. It is never
 * "Ontbreekt in Caren" or "Niet in Caren", because this feature cannot know
 * that, and an owner acting on a false "missing" would create a duplicate
 * appointment. No deletion is ever inferred: no reliable Caren deletion
 * notification template has been observed.
 *
 * This status is entirely separate from the briefing's own ready/sent/
 * changed_after_sent workflow, which stays a human decision and is never
 * touched by anything here.
 */

// ─── Item statuses (mirrors the ma_caren_expected_items check constraint) ────

export const CAREN_ITEM_STATUSES = [
  'not_seen', 'seen', 'changed_after_seen', 'ambiguous', 'manually_confirmed', 'retired',
];

/** Statuses that count as "the owner is satisfied this is in Caren". */
const SATISFIED = new Set(['seen', 'manually_confirmed']);

/**
 * Retired items describe a cluster the briefing no longer contains. They are
 * kept for audit but never counted, displayed, or acted on.
 */
export function activeCarenItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(item => item && item.status !== 'retired');
}

// ─── Summary derivation ──────────────────────────────────────────────────────

/**
 * Precedence, most urgent first. Read top-down: the first condition that holds
 * wins, so a day with one ambiguous item and four seen ones reports
 * `ambiguous`, not `seen` — the thing needing attention is never averaged away
 * by the things that are fine.
 *
 * `changed_after_seen` outranks `ambiguous` because it is a concrete,
 * actionable divergence (Ma says something different from what Caren
 * confirmed), whereas ambiguous is only "the machine could not decide".
 */
export const CAREN_SUMMARY_PRECEDENCE = [
  'changed_after_seen',
  'ambiguous',
  'partly_seen',
  'seen',
  'not_seen',
];

/**
 * Derive one briefing-level summary from its active expected items.
 *
 * @param {Array|null|undefined} items
 * @returns {'none'|'changed_after_seen'|'ambiguous'|'partly_seen'|'seen'|'not_seen'}
 */
export function deriveCarenSummary(items) {
  const active = activeCarenItems(items);
  if (!active.length) return 'none';

  if (active.some(i => i.status === 'changed_after_seen')) return 'changed_after_seen';
  if (active.some(i => i.status === 'ambiguous'))          return 'ambiguous';

  const satisfied = active.filter(i => SATISFIED.has(i.status)).length;
  if (satisfied === active.length) return 'seen';
  if (satisfied > 0)               return 'partly_seen';
  return 'not_seen';
}

/** Items an owner still has to do something about. */
export function carenItemsNeedingAttention(items) {
  return activeCarenItems(items).filter(
    i => i.status === 'not_seen' || i.status === 'changed_after_seen' || i.status === 'ambiguous',
  );
}

// ─── Badge copy ──────────────────────────────────────────────────────────────

const SUMMARY_BADGES = {
  seen:               { label: 'Gezien in Caren ✓',            cls: 'caren-badge--seen' },
  partly_seen:        { label: 'Gedeeltelijk gezien in Caren', cls: 'caren-badge--partly' },
  not_seen:           { label: 'Nog niet gezien in Caren',     cls: 'caren-badge--not-seen' },
  changed_after_seen: { label: 'Ma is gewijzigd sinds Caren',  cls: 'caren-badge--changed' },
  ambiguous:          { label: 'Controle nodig',               cls: 'caren-badge--ambiguous' },
  stale:              { label: 'Caren-controle niet actueel',  cls: 'caren-badge--stale' },
};

/**
 * The badge for a briefing card's Caren section.
 *
 * A stale or failed reconciliation stage overrides the derived summary, but
 * only in the "nothing confirmed yet" direction: an owner must not read
 * "nog niet gezien" as current when the check last ran two days ago. A summary
 * that is already positive (seen/partly) is still shown as-is — old positive
 * evidence does not become untrue because the stage is late.
 *
 * @param {string} summary — from deriveCarenSummary()
 * @param {{ level: string }} freshness — from carenFreshness()
 */
export function carenSummaryBadge(summary, freshness = { level: 'current' }) {
  if (summary === 'none') return null;
  const stale = freshness.level === 'stale' || freshness.level === 'unavailable';
  if (stale && (summary === 'not_seen' || summary === 'partly_seen')) {
    return SUMMARY_BADGES.stale;
  }
  return SUMMARY_BADGES[summary] ?? SUMMARY_BADGES.not_seen;
}

const ITEM_STATUS_LABELS = {
  not_seen:           'Nog niet gezien in Caren',
  seen:               'Gezien in Caren',
  changed_after_seen: 'Ma is gewijzigd sinds Caren',
  ambiguous:          'Controle nodig',
  manually_confirmed: 'Handmatig bevestigd',
};

export function carenItemStatusLabel(status) {
  return ITEM_STATUS_LABELS[status] ?? ITEM_STATUS_LABELS.not_seen;
}

/**
 * The one owner action offered per item status, or null when there is nothing
 * useful to do. `action` is the RPC action name; `needsEvidence` marks the one
 * flow that must pass the candidate evidence id.
 */
const ITEM_ACTIONS = {
  not_seen:           { label: 'Markeer handmatig als in Caren',  action: 'manual_confirm', needsEvidence: false,
                        confirm: 'Ik bevestig dat deze afspraak in Caren staat.' },
  changed_after_seen: { label: 'Bevestig de nieuwe versie handmatig', action: 'manual_confirm', needsEvidence: false,
                        confirm: 'Ik bevestig dat deze afspraak in Caren staat.' },
  ambiguous:          { label: 'Vergelijk', action: null, needsEvidence: true, confirm: null },
  seen:               { label: 'Heropen controle', action: 'reopen', needsEvidence: false,
                        confirm: 'Weet je zeker dat je deze controle wilt heropenen?' },
  manually_confirmed: { label: 'Heropen controle', action: 'reopen', needsEvidence: false,
                        confirm: 'Weet je zeker dat je deze controle wilt heropenen?' },
};

export function carenItemAction(status) {
  return ITEM_ACTIONS[status] ?? null;
}

export const CAREN_CAVEAT =
  'Caren-e-mails zijn positieve signalen. Geen e-mail betekent niet automatisch ' +
  'dat een afspraak ontbreekt, en verwijderingen kunnen hiermee niet betrouwbaar ' +
  'worden vastgesteld.';

// ─── Freshness ───────────────────────────────────────────────────────────────

const HOUR_MS = 3600_000;
const CAREN_CURRENT_HOURS = 6;
const CAREN_STALE_HOURS   = 12;

/**
 * How much to trust a `not_seen` right now, from the latest integration run.
 *
 * The distinction matters because "no evidence" and "we have not looked" are
 * indistinguishable in the stored data. Only a recent successful stage makes
 * `not_seen` meaningful; otherwise the absence of evidence says nothing about
 * Caren and everything about the pipeline.
 *
 * @param {{ caren_status?: string, finished_at?: string|null }|null} run
 * @param {Date} [now]
 * @returns {{ level: 'current'|'aging'|'stale'|'unavailable'|'disabled', note: string|null }}
 */
export function carenFreshness(run, now = new Date()) {
  if (!run || !run.caren_status || run.caren_status === 'skipped') {
    return { level: 'unavailable', note: 'De Caren-controle is nog niet uitgevoerd.' };
  }
  if (run.caren_status === 'disabled') {
    return { level: 'disabled', note: null };
  }
  if (run.caren_status === 'failed' || run.caren_status === 'misconfigured') {
    return { level: 'stale', note: 'De laatste Caren-controle is niet gelukt.' };
  }
  if (run.caren_status !== 'success' || !run.finished_at) {
    // 'pending': a run is in flight and has not reported yet.
    return { level: 'unavailable', note: 'De Caren-controle is bezig.' };
  }

  const ageHours = (now.getTime() - new Date(run.finished_at).getTime()) / HOUR_MS;
  if (!Number.isFinite(ageHours) || ageHours < 0) {
    return { level: 'unavailable', note: 'De Caren-controle is nog niet uitgevoerd.' };
  }
  if (ageHours <= CAREN_CURRENT_HOURS) return { level: 'current', note: null };
  if (ageHours <= CAREN_STALE_HOURS) {
    return { level: 'aging', note: 'De Caren-controle is enkele uren oud.' };
  }
  return { level: 'stale', note: 'De Caren-controle is niet recent bijgewerkt.' };
}

/**
 * Whether the reconciliation should be shown at all. A disabled stage means
 * the feature was never configured — Beheer says so once; the Briefing tab
 * stays clean rather than showing an empty section to every owner.
 */
export function shouldShowCarenSection(freshness) {
  return freshness.level !== 'disabled';
}

/**
 * Whether "N controles vragen aandacht" may be shown (Today's compact signal).
 * Suppressed unless the check is genuinely current: nudging an owner about
 * appointments "not seen" by a stage that last succeeded yesterday is noise
 * at best and misleading at worst.
 */
export function carenAttentionIsActionable(freshness) {
  return freshness.level === 'current' || freshness.level === 'aging';
}

// ─── Safe error copy ─────────────────────────────────────────────────────────

/**
 * One controlled mapping from an error to owner-facing Dutch. Raw SQL,
 * PostgREST and IMAP errors are never rendered — they leak schema and,
 * potentially, payload.
 */
const CAREN_ERROR_COPY = {
  caren_unavailable:      'De Caren-controle is tijdelijk niet beschikbaar.',
  caren_stale:            'De Caren-controle is niet recent bijgewerkt.',
  caren_invalid_item:     'Deze Caren-controle kan niet meer worden gewijzigd.',
  caren_invalid_evidence: 'De voorgestelde Caren-melding is niet meer beschikbaar.',
  caren_review_failed:    'Kon de Caren-controle niet opslaan. Probeer het opnieuw.',
};

export function carenErrorText(code) {
  return CAREN_ERROR_COPY[code] ?? CAREN_ERROR_COPY.caren_review_failed;
}

/**
 * Map a thrown error to one of the controlled codes above by looking for a
 * known marker the RPC raises. Anything unrecognised — including every
 * database or network error — becomes the generic "could not save" message,
 * never the original text.
 */
export function carenErrorCode(err) {
  const raw = typeof err?.message === 'string' ? err.message : '';
  for (const code of ['caren_invalid_item', 'caren_invalid_evidence', 'caren_review_unauthorised']) {
    if (raw.includes(code)) {
      return code === 'caren_review_unauthorised' ? 'caren_invalid_item' : code;
    }
  }
  return 'caren_review_failed';
}
