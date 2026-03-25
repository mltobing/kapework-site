/**
 * views/calendar.js
 *
 * The Calendar tab — read-only agenda of upcoming family events.
 * Events come from ma_calendar_events (mirrored from the family iCloud calendar).
 * Grouped into: Today · This week · Coming up.
 *
 * No editing — Apple Calendar remains the source of truth.
 */

import { fetchEvents }     from '../api.js';
import { renderEventCard } from '../components/event-card.js';

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null }} state
 */
export async function mount(container, { familyId }) {
  container.innerHTML = `
    <div class="view-calendar">
      <div class="view-header">
        <h1>Calendar</h1>
      </div>
      <div id="calendar-content">
        <div class="section-loading">Loading events\u2026</div>
      </div>
    </div>
  `;

  const contentEl = container.querySelector('#calendar-content');

  if (!familyId) {
    contentEl.innerHTML = '<p class="empty-state">Family not found.</p>';
    return;
  }

  try {
    const events = await fetchEvents(familyId, { limit: 60 });
    contentEl.innerHTML = '';

    if (!events.length) {
      contentEl.innerHTML = '<p class="empty-state">No upcoming events.</p>';
      return;
    }

    const groups = groupByTime(events);

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
  } catch (err) {
    console.error('[ma/calendar] Failed to load events:', err);
    contentEl.innerHTML = '<p class="empty-state">Could not load events. Please try again.</p>';
  }
}

/**
 * Groups events into Today / This week / Coming up buckets.
 * Boundaries are in local time (correct for calendar display).
 *
 * @param {Array} events — sorted ascending by starts_at
 * @returns {Array<[string, Array]>}
 */
function groupByTime(events) {
  const now      = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const weekEnd  = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

  const today    = [];
  const thisWeek = [];
  const later    = [];

  for (const event of events) {
    const start = new Date(event.starts_at);
    if (start < midnight)       today.push(event);
    else if (start < weekEnd)   thisWeek.push(event);
    else                        later.push(event);
  }

  return [
    ['Today',       today],
    ['This week',   thisWeek],
    ['Coming up',   later],
  ];
}
