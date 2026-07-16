/**
 * components/ride-notices.js
 *
 * The ride-reconciliation strip — rendered at the top of the Today view, ONLY
 * when open notices exist. On the great majority of days everything reconciles
 * and this leaves no trace at all; a permanent (usually empty) tab would just
 * train people to ignore it.
 *
 * Each card surfaces one discrepancy the private irma-sync job found between a
 * forwarded ride e-mail and the mirrored calendar. There is deliberately no
 * "accept": acting on a notice means opening Apple Calendar and entering the
 * event by hand, which is outside this app. The only in-app action is "Negeer".
 *
 * Everything here originates from external e-mail and is untrusted, so every
 * field is escaped. The excerpt is always shown verbatim — it is the trust
 * mechanism, letting a human check the machine's extraction against the original
 * without opening Gmail. It must never be omitted or paraphrased.
 */

import { fetchOpenRideNotices, dismissRideNotice } from '../api.js';
import { getState } from '../state.js';
import { escapeHtml } from '../utils.js';
import { formatDateKeyHeader, formatTime, formatClock } from '../lib/datetime.js';

/**
 * Loads open notices and, if any exist, renders the strip into `container` and
 * wires the dismiss buttons. Leaves `container` empty when there is nothing to
 * reconcile (or when the load fails), so the Today view shows no trace of this
 * feature on quiet days and a reconciliation error never blanks the view.
 *
 * @param {HTMLElement} container
 * @param {{ familyId: string, eventsByUid?: Map<string, object> }} opts
 *   eventsByUid maps ma_calendar_events.external_event_uid → event, used to show the
 *   calendar's own time on a "conflict" card. It is best-effort: if the matched
 *   event is outside the loaded window the headline falls back gracefully.
 */
export async function mountRideNotices(container, { familyId, eventsByUid }) {
  let notices;
  try {
    notices = await fetchOpenRideNotices(familyId);
  } catch (err) {
    console.error('[ma/ride-notices] Failed to load notices:', err);
    container.innerHTML = '';
    return;
  }

  if (!notices.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <section class="ride-notices" aria-label="Ritten om te controleren">
      ${notices.map(n => renderCard(n, eventsByUid)).join('')}
    </section>
  `;
  wire(container);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderCard(notice, eventsByUid) {
  const driverLine = notice.driver
    ? `<p class="ride-notice-driver">Chauffeur: ${escapeHtml(notice.driver)}</p>`
    : '';

  return `
    <article class="ride-notice-card" data-id="${escapeHtml(notice.id)}">
      <div class="ride-notice-head">
        <span class="ride-notice-icon" aria-hidden="true">!</span>
        <h3 class="ride-notice-headline">${headline(notice, eventsByUid)}</h3>
      </div>
      ${driverLine}
      <blockquote class="ride-notice-excerpt">${escapeHtml(notice.excerpt)}</blockquote>
      <div class="ride-notice-actions">
        <button class="ride-notice-dismiss" data-dismiss data-id="${escapeHtml(notice.id)}">
          Negeer
        </button>
      </div>
    </article>
  `;
}

/**
 * The card headline, chosen by match_status. Returns an HTML string whose dynamic
 * parts (date, times, and — for the fallback path — nothing else) are escaped.
 * All dates and times go through the shared Amsterdam helpers, never device-local.
 */
function headline(notice, eventsByUid) {
  const datum = notice.ride_date
    ? escapeHtml(formatDateKeyHeader(notice.ride_date))
    : null;

  switch (notice.match_status) {
    case 'missing':
      return datum
        ? `Rit op ${datum} staat niet in de agenda`
        : 'Rit uit een e-mail staat niet in de agenda';

    case 'conflict': {
      if (notice.kind === 'cancellation') {
        return datum
          ? `Rit op ${datum} is afgezegd, maar staat nog in de agenda`
          : 'Een rit is afgezegd, maar staat nog in de agenda';
      }
      // ride / change conflict: the e-mail's pickup time differs from the calendar.
      const emailTime = notice.pickup_time ? escapeHtml(formatClock(notice.pickup_time)) : null;
      const event = notice.matched_event_uid && eventsByUid
        ? eventsByUid.get(notice.matched_event_uid)
        : null;
      const agendaTime = event ? escapeHtml(formatTime(event.starts_at)) : null;

      if (datum && emailTime && agendaTime) {
        return `Rit op ${datum}: e-mail zegt ${emailTime}, agenda zegt ${agendaTime}`;
      }
      // Never invent a calendar time we don't have: state the e-mail's and flag
      // that the agenda differs. The verbatim excerpt below carries the detail.
      if (datum && emailTime) {
        return `Rit op ${datum}: e-mail zegt ${emailTime}, agenda wijkt af`;
      }
      return datum
        ? `Rit op ${datum}: e-mail en agenda komen niet overeen`
        : 'Rit uit een e-mail komt niet overeen met de agenda';
    }

    case 'unparsed':
      return 'E-mail over een rit die ik niet kon lezen';

    default:
      // 'matched' is auto-resolved and never fetched as open; guard anyway so a
      // stray status can never render an empty headline.
      return datum ? `Rit op ${datum}` : 'E-mail over een rit';
  }
}

// ─── Dismiss ────────────────────────────────────────────────────────────────

function wire(container) {
  container.querySelectorAll('[data-dismiss]').forEach(btn => {
    btn.addEventListener('click', () => dismiss(container, btn));
  });
}

async function dismiss(container, btn) {
  const userId = getState().user?.id ?? null;
  btn.disabled = true;
  try {
    await dismissRideNotice(btn.dataset.id, userId);
  } catch (err) {
    console.error('[ma/ride-notices] Failed to dismiss notice:', err);
    btn.disabled = false;
    btn.textContent = 'Kon niet negeren';
    return;
  }
  // Drop the card; when it was the last one the strip disappears entirely, so a
  // fully reconciled day leaves no footprint.
  btn.closest('.ride-notice-card')?.remove();
  if (!container.querySelector('.ride-notice-card')) {
    container.innerHTML = '';
  }
}
