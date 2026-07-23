/**
 * components/appointment-notices.js
 *
 * The provider-appointment reconciliation strip — a second, independent
 * mail-reconciliation surface alongside components/ride-notices.js. Each card
 * surfaces one discrepancy the private irma-sync job found between a direct
 * provider confirmation e-mail and the mirrored calendar. Same shape and same
 * safety rules as ride-notices.js: no "accept" beyond the owner-confirmed
 * "Toevoegen aan agenda" flow, every external field escaped, the excerpt
 * always verbatim.
 *
 * Placement (brief §14): callers are responsible for *which* notices reach
 * this component — Agenda passes every open notice; Today passes only
 * overdue-or-within-7-days ones (via `filter`), so six future confirmations
 * never overwhelm the daily view.
 */

import { fetchOpenAppointmentNotices, dismissAppointmentNotice } from '../api.js';
import { getState } from '../state.js';
import { escapeHtml } from '../utils.js';
import { formatDateKeyHeader } from '../lib/datetime.js';
import { openCalendarWriteModal } from './calendar-write-modal.js';

const ADD_ELIGIBLE_MATCH_STATUSES = new Set(['missing', 'unparsed']);

/**
 * Loads open provider-appointment notices and, if any exist, renders the
 * strip into `container`. Leaves `container` empty when there is nothing to
 * reconcile (or when the load fails) — a reconciliation error never blanks
 * the rest of the view.
 *
 * @param {HTMLElement} container
 * @param {{ familyId: string, accessType?: string|null, filter?: (notice) => boolean }} opts
 */
export async function mountAppointmentNotices(container, opts) {
  const { familyId, filter } = opts;
  let notices;
  try {
    notices = await fetchOpenAppointmentNotices(familyId);
  } catch (err) {
    console.error('[ma/appointment-notices] Failed to load notices:', err);
    container.innerHTML = '';
    return;
  }

  if (typeof filter === 'function') notices = notices.filter(filter);

  if (!notices.length) {
    container.innerHTML = '';
    return;
  }

  const isOwner = opts.accessType === 'owner';

  container.innerHTML = `
    <section class="ride-notices" aria-label="Afspraken om te controleren">
      ${notices.map(n => renderCard(n, isOwner)).join('')}
    </section>
  `;
  wire(container, notices, opts);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderCard(notice, isOwner) {
  const practitionerLine = notice.practitioner
    ? `<p class="ride-notice-driver">Behandelaar: ${escapeHtml(notice.practitioner)}</p>`
    : '';
  const providerLine = notice.provider_label
    ? `<p class="ride-notice-driver">${escapeHtml(notice.provider_label)}</p>`
    : '';
  const canAdd = isOwner && ADD_ELIGIBLE_MATCH_STATUSES.has(notice.match_status);

  return `
    <article class="ride-notice-card" data-id="${escapeHtml(notice.id)}">
      <div class="ride-notice-head">
        <span class="ride-notice-icon" aria-hidden="true">!</span>
        <h3 class="ride-notice-headline">${headline(notice)}</h3>
      </div>
      ${providerLine}
      ${practitionerLine}
      <blockquote class="ride-notice-excerpt">${escapeHtml(notice.excerpt)}</blockquote>
      <div class="ride-notice-actions">
        ${canAdd ? `<button class="ride-notice-add" data-add data-id="${escapeHtml(notice.id)}">Toevoegen aan agenda</button>` : ''}
        <button class="ride-notice-dismiss" data-dismiss data-id="${escapeHtml(notice.id)}">
          Negeer
        </button>
      </div>
    </article>
  `;
}

/** The card headline, chosen by match_status (brief §14) — dates always via the shared Amsterdam helper. */
function headline(notice) {
  const datum = notice.appointment_date ? escapeHtml(formatDateKeyHeader(notice.appointment_date)) : null;

  switch (notice.match_status) {
    case 'missing':
      return datum
        ? `Afspraak op ${datum} staat niet in de agenda`
        : 'Afspraak uit een e-mail staat niet in de agenda';
    case 'conflict':
      return datum
        ? `Afspraak op ${datum}: e-mail en agenda komen niet overeen`
        : 'Afspraak uit een e-mail komt niet overeen met de agenda';
    case 'unparsed':
      return 'E-mail over een afspraak die ik niet betrouwbaar kon lezen';
    default:
      // 'matched' is auto-resolved and never fetched as open; guard anyway.
      return datum ? `Afspraak op ${datum}` : 'E-mail over een afspraak';
  }
}

// ─── Dismiss / Toevoegen aan agenda ──────────────────────────────────────────

function wire(container, notices, opts) {
  container.querySelectorAll('[data-dismiss]').forEach(btn => {
    btn.addEventListener('click', () => dismiss(container, btn));
  });
  container.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const notice = notices.find(n => n.id === btn.dataset.id);
      if (!notice) return;
      openCalendarWriteModal({
        familyId: opts.familyId,
        sourceKind: 'appointment_notice',
        notice,
        onResolved: () => mountAppointmentNotices(container, opts),
      });
    });
  });
}

async function dismiss(container, btn) {
  const userId = getState().user?.id ?? null;
  btn.disabled = true;
  try {
    await dismissAppointmentNotice(btn.dataset.id, userId);
  } catch (err) {
    console.error('[ma/appointment-notices] Failed to dismiss notice:', err);
    btn.disabled = false;
    btn.textContent = 'Kon niet negeren';
    return;
  }
  btn.closest('.ride-notice-card')?.remove();
  if (!container.querySelector('.ride-notice-card')) {
    container.innerHTML = '';
  }
}
