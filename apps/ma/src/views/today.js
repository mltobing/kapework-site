/**
 * views/today.js
 *
 * The signed-in Today tab — only what needs attention *today*, in Amsterdam time,
 * so it reads identically from Amsterdam, New York, or Jakarta.
 *
 * Structure (order is strict):
 *   1. Header        — today's full Dutch date in Amsterdam
 *   2. Nu            — one deterministic "what now" card (today-state engine)
 *   3. Vandaag       — today's events in time order; completed ones de-emphasized
 *   4. Ritten        — urgent/overdue ride-reconciliation notices for today only
 *   5. Vanavond      — a prompt when tomorrow's briefing is ready and needs sending
 *
 * The next-seven-days list lives in Agenda; recent posts live in the family feed.
 * Neither belongs on Today.
 */

import { fetchEvents, fetchCalendarLastSyncedAt, fetchBriefings } from '../api.js';
import { renderEventCard }   from '../components/event-card.js';
import { mountRideNotices }  from '../components/ride-notices.js';
import { sanitizeEventForState } from '../lib/event-derive.js';
import { computeTodayState } from '../lib/today-state.js';
import { navigate } from '../router.js';
import { escapeHtml } from '../utils.js';
import {
  amsDateKey, todayAms, addDaysKey, formatDateKeyHeader, isPast,
} from '../lib/datetime.js';

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null }} state
 */
export async function mount(container, { familyId }) {
  const todayKey = todayAms();

  container.innerHTML = `
    <div class="view-today">
      <div class="today-header">
        <h1 class="today-date">${formatDateKeyHeader(todayKey)}</h1>
      </div>

      <!-- Nu — the single "what now" card, filled once events load. -->
      <div id="today-now"></div>

      <section class="today-section">
        <h2 class="section-title">Vandaag</h2>
        <div id="today-vandaag"><div class="section-loading">Laden…</div></div>
      </section>

      <!-- Ride-reconciliation: only today-relevant/overdue notices, else empty. -->
      <div id="today-notices"></div>

      <!-- Vanavond versturen: only when tomorrow's briefing is ready. -->
      <div id="today-tonight"></div>
    </div>
  `;

  const nowEl      = container.querySelector('#today-now');
  const vandaagEl  = container.querySelector('#today-vandaag');
  const noticesEl  = container.querySelector('#today-notices');
  const tonightEl  = container.querySelector('#today-tonight');

  if (!familyId) {
    vandaagEl.innerHTML = '<p class="empty-state">Geen afspraken vandaag</p>';
    return;
  }

  // Each source is isolated: one failing must not blank the whole screen.
  const [eventsResult, syncResult, briefingsResult] = await Promise.allSettled([
    fetchEvents(familyId, { limit: 60 }),
    fetchCalendarLastSyncedAt(familyId),
    fetchBriefings(familyId, { limit: 7 }),
  ]);

  renderNow(eventsResult, syncResult, nowEl);
  renderTodayEvents(eventsResult, todayKey, vandaagEl);
  renderTonight(briefingsResult, todayKey, tonightEl);

  // Today-relevant notices only: undated (unparsed) or with a ride_date today or
  // earlier (overdue). Future rides surface on their own day, not here.
  await mountRideNotices(noticesEl, {
    familyId,
    eventsByUid: buildEventsByUid(eventsResult),
    filter: (n) => !n.ride_date || n.ride_date <= todayKey,
  });
}

/** Map ma_calendar_events.external_event_uid → event, for matching conflict notices. */
function buildEventsByUid(eventsResult) {
  const map = new Map();
  if (eventsResult.status === 'fulfilled') {
    for (const ev of eventsResult.value ?? []) {
      if (ev.external_event_uid) map.set(ev.external_event_uid, ev);
    }
  }
  return map;
}

// ─── Nu — deterministic current-state card ───────────────────────────────────

function renderNow(eventsResult, syncResult, nowEl) {
  if (eventsResult.status === 'rejected') {
    // The Nu card is best-effort; a failed events load is already surfaced in the
    // Vandaag section below, so keep this quiet rather than doubling the error.
    nowEl.innerHTML = '';
    return;
  }

  const events   = (eventsResult.value ?? []).map(sanitizeEventForState);
  const lastSync = syncResult.status === 'fulfilled' ? syncResult.value : null;
  const s = computeTodayState({ events, now: Date.now(), calendarLastSyncedAt: lastSync });

  nowEl.innerHTML = `
    <section class="today-now${s.stale ? ' today-now--stale' : ''}">
      <p class="today-now-headline">${escapeHtml(s.nu.headline)}</p>
      ${s.nu.detail ? `<p class="today-now-detail">${escapeHtml(s.nu.detail)}</p>` : ''}
      ${s.staleNotice ? `<p class="today-now-stale">${escapeHtml(s.staleNotice)}</p>` : ''}
    </section>
  `;
}

// ─── Vandaag — today's events, completed ones de-emphasized ───────────────────

function renderTodayEvents(eventsResult, todayKey, vandaagEl) {
  if (eventsResult.status === 'rejected') {
    console.error('[ma/today] Events error:', eventsResult.reason);
    vandaagEl.innerHTML = '<p class="empty-state">Afspraken konden niet worden geladen.</p>';
    return;
  }

  const events = eventsResult.value ?? [];
  const todayEvents = events.filter(e => amsDateKey(e.starts_at) === todayKey);

  vandaagEl.innerHTML = '';
  if (!todayEvents.length) {
    vandaagEl.innerHTML = '<p class="empty-state">Geen afspraken vandaag</p>';
    return;
  }

  for (const event of todayEvents) {
    // Completed timed events are de-emphasized, not removed. All-day events are
    // never treated as "past" (they have no clock time to be past).
    const past = !event.all_day && isPast(event.ends_at ?? event.starts_at);
    vandaagEl.appendChild(renderEventCard(event, { past }));
  }
}

// ─── Vanavond versturen — prompt to send tomorrow's briefing ─────────────────

function renderTonight(briefingsResult, todayKey, tonightEl) {
  if (briefingsResult.status !== 'fulfilled') { tonightEl.innerHTML = ''; return; }

  const tomorrowKey = addDaysKey(todayKey, 1);
  const briefing = (briefingsResult.value ?? []).find(
    b => b.briefing_date === tomorrowKey && b.status === 'ready',
  );
  if (!briefing) { tonightEl.innerHTML = ''; return; }

  // Surface only — the copy/review/send flow stays in the Briefing tab; nothing
  // is ever sent automatically.
  tonightEl.innerHTML = `
    <section class="today-tonight">
      <p class="today-tonight-head">Vanavond versturen</p>
      <p class="today-tonight-body">De briefing voor morgen staat klaar om te versturen.</p>
      <button class="today-tonight-btn" id="today-tonight-btn">Bekijk en verstuur</button>
    </section>
  `;
  tonightEl.querySelector('#today-tonight-btn')
    .addEventListener('click', () => navigate('briefing'));
}
