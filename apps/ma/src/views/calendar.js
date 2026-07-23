/**
 * views/calendar.js
 *
 * The Calendar tab — read-only agenda of upcoming family events.
 * Events come from ma_calendar_events (mirrored from the family iCloud calendar).
 * Grouped into: Today · This week · Coming up.
 *
 * No editing — Apple Calendar remains the source of truth.
 */

import { fetchEvents, fetchCalendarLastSyncedAt } from '../api.js';
import { renderEventCard } from '../components/event-card.js';
import { mountAppointmentNotices } from '../components/appointment-notices.js';
import { amsDateKey, todayAms, addDaysKey, formatDayHeader, formatTime, monthsAheadISO } from '../lib/datetime.js';

// Matches the private irma-sync job's CALENDAR_LOOKAHEAD_MONTHS \u2014 the Agenda
// view is the one place in this app that needs the wide mirror horizon;
// Today/Briefing/compose keep their narrow, task-focused windows untouched
// (brief \u00a7B4). A bounded date range + real pagination, not an unbounded
// lifetime history or a single oversized limit.
const CALENDAR_LOOKAHEAD_MONTHS = 6;
const PAGE_SIZE = 60;

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, accessType?: string|null }} state
 */
export async function mount(container, { familyId, accessType }) {
  container.innerHTML = `
    <div class="view-calendar">
      <div class="view-header">
        <h1>Calendar</h1>
      </div>
      <p class="calendar-sync-line" id="calendar-sync-line" hidden></p>
      <!-- Provider appointment notices: the full open list, near the top. -->
      <div id="calendar-appointment-notices"></div>
      <div id="calendar-content">
        <div class="section-loading">Loading events\u2026</div>
      </div>
      <div class="feed-more" id="calendar-more" hidden>
        <button class="btn-ghost" id="calendar-more-btn">Meer laden</button>
      </div>
    </div>
  `;

  const contentEl = container.querySelector('#calendar-content');
  const syncLineEl = container.querySelector('#calendar-sync-line');
  const appointmentNoticesEl = container.querySelector('#calendar-appointment-notices');
  const moreEl = container.querySelector('#calendar-more');
  const moreBtn = container.querySelector('#calendar-more-btn');

  if (!familyId) {
    contentEl.innerHTML = '<p class="empty-state">Family not found.</p>';
    return;
  }

  mountAppointmentNotices(appointmentNoticesEl, { familyId, accessType })
    .catch(err => console.error('[ma/calendar] Failed to load appointment notices:', err));

  // Small, nontechnical freshness cue for every authenticated user \u2014 not an
  // admin dashboard, just "is this roughly current." Full sync health/history
  // and the manual-refresh action live in Beheer (owner-only).
  fetchCalendarLastSyncedAt(familyId)
    .then(lastSyncedAt => {
      if (!lastSyncedAt) return;
      syncLineEl.textContent = `Laatst bijgewerkt: ${formatDayHeader(lastSyncedAt)} om ${formatTime(lastSyncedAt)}`;
      syncLineEl.hidden = false;
    })
    .catch(err => console.error('[ma/calendar] Failed to load last-synced time:', err));

  const to = monthsAheadISO(CALENDAR_LOOKAHEAD_MONTHS);
  let allEvents = [];
  let offset = 0;

  async function loadPage() {
    const page = await fetchEvents(familyId, { to, limit: PAGE_SIZE, offset });
    allEvents = allEvents.concat(page);
    offset += page.length;
    moreEl.hidden = page.length < PAGE_SIZE;
  }

  try {
    await loadPage();
    render();
  } catch (err) {
    console.error('[ma/calendar] Failed to load events:', err);
    contentEl.innerHTML = '<p class="empty-state">Could not load events. Please try again.</p>';
    return;
  }

  moreBtn.addEventListener('click', async () => {
    moreBtn.disabled = true;
    moreBtn.textContent = 'Laden\u2026';
    try {
      await loadPage();
      render();
    } catch (err) {
      console.error('[ma/calendar] Failed to load more events:', err);
    } finally {
      moreBtn.disabled = false;
      moreBtn.textContent = 'Meer laden';
    }
  });

  function render() {
    contentEl.innerHTML = '';

    if (!allEvents.length) {
      contentEl.innerHTML = '<p class="empty-state">No upcoming events.</p>';
      return;
    }

    const groups = groupByTime(allEvents);

    for (const [label, groupEvents] of groups) {
      if (!groupEvents.length) continue;

      const section = document.createElement('section');
      section.className = 'event-group';
      section.innerHTML = `<h2 class="section-title">${label}</h2>`;

      for (const event of groupEvents) {
        section.appendChild(renderEventCard(event));
      }

      contentEl.appendChild(section);
    }

    // Show "no groups had events" fallback (all past?)
    if (!contentEl.children.length) {
      contentEl.innerHTML = '<p class="empty-state">No upcoming events.</p>';
    }
  }
}

/**
 * Groups events into Today / This week / Coming up buckets.
 * Boundaries follow the Amsterdam calendar day, so an event never lands in the
 * wrong bucket because the viewer is in a different timezone.
 *
 * @param {Array} events — sorted ascending by starts_at
 * @returns {Array<[string, Array]>}
 */
function groupByTime(events) {
  const todayKey    = todayAms();
  const tomorrowKey = addDaysKey(todayKey, 1);
  const weekEndKey  = addDaysKey(todayKey, 7);

  const today    = [];
  const thisWeek = [];
  const later    = [];

  for (const event of events) {
    // YYYY-MM-DD keys compare chronologically as plain strings.
    const key = amsDateKey(event.starts_at);
    if (key < tomorrowKey)     today.push(event);
    else if (key < weekEndKey) thisWeek.push(event);
    else                       later.push(event);
  }

  return [
    ['Today',       today],
    ['This week',   thisWeek],
    ['Coming up',   later],
  ];
}
