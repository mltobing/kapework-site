/**
 * lib/caren-render.js
 *
 * Pure HTML builders for the owner-only Caren reconciliation UI.
 *
 * Split from views/briefing.js and components/caren-compare-modal.js so the
 * two properties that actually matter here can be asserted in DOM-free tests:
 *
 *   1. every field originating in an e-mail is escaped, and
 *   2. no source message id, no Caren URL, and no Caren person id is ever
 *      rendered — the parser discards the URL, and nothing downstream may
 *      reintroduce it.
 *
 * Everything rendered from an expected item or an evidence row is untrusted
 * external data: it came from a Caren notification e-mail, which anyone able
 * to create an appointment can influence. It is displayed, never interpreted,
 * and never followed as an instruction.
 */

import {
  activeCarenItems, carenItemAction, carenItemStatusLabel, carenSummaryBadge,
  deriveCarenSummary, shouldShowCarenSection, CAREN_CAVEAT,
} from './caren-status.js';

/**
 * String-based HTML escape.
 *
 * utils.js's escapeHtml() builds a DOM node, which cannot run under Node —
 * and these builders exist precisely so their escaping can be unit-tested. The
 * two must stay equivalent for the five HTML-significant characters; this one
 * is deliberately the stricter of the two (it also escapes quotes, which
 * matters because these values land inside attributes).
 */
export function escapeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Evidence type, in owner-facing Dutch. */
const EVIDENCE_TYPE_LABELS = {
  updated:  'wijziging',
  reminder: 'herinnering',
  unparsed: 'onleesbaar bericht',
};

export function carenEvidenceTypeLabel(type) {
  return EVIDENCE_TYPE_LABELS[type] ?? EVIDENCE_TYPE_LABELS.unparsed;
}

/**
 * One expected-item row.
 *
 * @param {object} item
 * @param {object} [opts]
 * @param {object|null} [opts.evidence]  matched/candidate evidence, when loaded
 * @param {(iso: string) => string} [opts.formatMoment] Amsterdam formatter
 */
export function renderCarenItemRow(item, { evidence = null, formatMoment = String } = {}) {
  const action = carenItemAction(item.status);
  const isCompare = item.status === 'ambiguous';

  // Matched evidence is described by type and time only — never by message id.
  const evidenceLine = evidence
    ? `<p class="caren-item-evidence">${escapeText(carenEvidenceTypeLabel(evidence.evidence_type))} · ${escapeText(formatMoment(evidence.received_at))}</p>`
    : '';

  const button = action
    ? `<button class="caren-item-action" data-caren-item="${escapeText(item.id)}"
         data-caren-action="${escapeText(action.action ?? 'compare')}"
         ${isCompare ? `data-caren-evidence="${escapeText(item.ambiguous_evidence_id ?? '')}"` : ''}>
         ${escapeText(action.label)}
       </button>`
    : '';

  return `
    <li class="caren-item caren-item--${escapeText(item.status)}">
      <p class="caren-item-summary">${escapeText(item.expected_summary)}</p>
      <p class="caren-item-status">${escapeText(carenItemStatusLabel(item.status))}</p>
      ${evidenceLine}
      ${button}
    </li>
  `;
}

/**
 * The whole Caren section for one briefing card, or '' when there is nothing
 * to show (no active items, or the stage is disabled entirely).
 *
 * @param {Array} items                    expected items for this briefing
 * @param {object} opts
 * @param {{level: string, note: string|null}} opts.freshness
 * @param {Map<string, object>} [opts.evidenceById]
 * @param {(iso: string) => string} [opts.formatMoment]
 */
export function renderCarenSection(items, { freshness, evidenceById = new Map(), formatMoment = String } = {}) {
  const active = activeCarenItems(items);
  if (!active.length) return '';

  const summary = deriveCarenSummary(active);
  const badge = carenSummaryBadge(summary, freshness);
  if (!badge) return '';

  const rows = active.map(item => {
    const evidenceId = item.status === 'ambiguous' ? item.ambiguous_evidence_id : item.matched_evidence_id;
    return renderCarenItemRow(item, { evidence: evidenceById.get(evidenceId) ?? null, formatMoment });
  }).join('');

  const note = freshness.note
    ? `<p class="caren-section-note">${escapeText(freshness.note)}</p>`
    : '';

  return `
    <section class="caren-section">
      <div class="caren-section-head">
        <span class="caren-section-label">Caren-controle</span>
        <span class="caren-badge ${escapeText(badge.cls)}">${escapeText(badge.label)}</span>
      </div>
      ${note}
      <ul class="caren-item-list">${rows}</ul>
      <details class="caren-caveat">
        <summary>Hoe werkt deze controle?</summary>
        <p>${escapeText(CAREN_CAVEAT)}</p>
      </details>
    </section>
  `;
}

/**
 * The ambiguous-candidate comparison body: what Ma expects, beside what the
 * Caren e-mail said, so the owner decides — never the machine.
 *
 * Only fields that exist are shown; no placeholder invents a value.
 */
export function renderCarenCompare(item, evidence, { formatMoment = String, formatDay = String } = {}) {
  const rows = [];
  if (evidence.title)            rows.push(['Titel in Caren', evidence.title]);
  if (evidence.appointment_date) rows.push(['Datum', formatDay(evidence.appointment_date)]);
  if (evidence.starts_at)        rows.push(['Begint', formatMoment(evidence.starts_at)]);
  if (evidence.ends_at)          rows.push(['Eindigt', formatMoment(evidence.ends_at)]);
  if (evidence.location)         rows.push(['Locatie', evidence.location]);
  rows.push(['Soort bericht', carenEvidenceTypeLabel(evidence.evidence_type)]);

  const evidenceRows = rows
    .map(([label, value]) => `<div class="caren-compare-row">
        <dt>${escapeText(label)}</dt><dd>${escapeText(value)}</dd>
      </div>`)
    .join('');

  return `
    <div class="caren-compare">
      <section class="caren-compare-side">
        <h3>Ma verwacht</h3>
        <p class="caren-compare-expected">${escapeText(item.expected_summary)}</p>
      </section>
      <section class="caren-compare-side">
        <h3>Caren-melding</h3>
        <dl class="caren-compare-list">${evidenceRows}</dl>
      </section>
      <div class="caren-compare-actions">
        <button class="caren-compare-confirm" data-caren-decision="confirm_candidate">Dit is dezelfde afspraak</button>
        <button class="caren-compare-reject"  data-caren-decision="reject_candidate">Niet dezelfde afspraak</button>
      </div>
    </div>
  `;
}

/**
 * The Caren section a specific viewer should see on a briefing card — the
 * single gate the Briefing view calls.
 *
 * Returns '' for every non-owner. That is presentation, NOT authorization:
 * RLS on ma_caren_expected_items / ma_caren_evidence is owner-SELECT-only and
 * the review RPC re-checks family ownership itself, so a member who bypassed
 * this function would still get nothing from the server. This gate exists so
 * the UI does not render an empty, confusing section to people the feature was
 * never meant for.
 *
 * `available` is false when the enrichment could not be loaded at all — most
 * obviously when migration 014 has not been applied yet. Degrading to no
 * section is deliberate: the briefing text is the point of the page, and
 * optional enrichment must never be able to take it down.
 *
 * @param {Array} items
 * @param {object} opts
 * @param {string|null} opts.accessType
 * @param {boolean} opts.available
 * @param {{level: string, note: string|null}} opts.freshness
 */
export function carenSectionForViewer(items, { accessType, available, freshness, evidenceById, formatMoment } = {}) {
  if (accessType !== 'owner') return '';
  if (!available) return '';
  if (!shouldShowCarenSection(freshness)) return '';
  return renderCarenSection(items, { freshness, evidenceById, formatMoment });
}

/**
 * Today's compact owner signal. Returns null when there is nothing worth
 * interrupting Today for — the Briefing tab holds the full list, and Today
 * must never grow a second one.
 */
export function carenTodayLine(count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return n === 1
    ? '1 Caren-controle voor de komende 7 dagen vraagt aandacht.'
    : `${n} Caren-controles voor de komende 7 dagen vragen aandacht.`;
}
