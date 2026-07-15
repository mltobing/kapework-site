/**
 * components/event-card.js
 *
 * Renders a single calendar event as a DOM element.
 * Events are read-only — the source of truth is the family iCloud calendar.
 *
 * All dates and times are rendered in Europe/Amsterdam (see src/lib/datetime.js),
 * so an event reads the same for every viewer regardless of their device timezone.
 */

import { escapeHtml } from '../utils.js';
import { formatTime, dayNumberAms, monthShortAms } from '../lib/datetime.js';

/**
 * @param {object}  event          — row from ma_calendar_events
 * @param {object}  [opts]
 * @param {boolean} [opts.past=false] — de-emphasise an event that has already ended
 * @returns {HTMLElement}
 */
export function renderEventCard(event, { past = false } = {}) {
  const card = document.createElement('div');
  card.className = past ? 'event-card event-card--past' : 'event-card';

  const dayNum    = dayNumberAms(event.starts_at);
  const monthAbbr = monthShortAms(event.starts_at);
  const timeStr   = event.all_day ? 'Hele dag' : formatTime(event.starts_at);

  const locationHtml = event.location ? `
    <div class="event-location">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"
              stroke="currentColor" stroke-width="2"/>
        <circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/>
      </svg>
      ${escapeHtml(event.location)}
    </div>
  ` : '';

  const notesHtml = event.notes
    ? `<p class="event-notes">${escapeHtml(event.notes)}</p>`
    : '';

  const linkHtml = event.external_url
    ? `<a class="event-link" href="${escapeHtml(event.external_url)}" target="_blank" rel="noopener noreferrer">
         Open in Calendar ↗
       </a>`
    : '';

  card.innerHTML = `
    <div class="event-date-badge">
      <span class="event-date-day">${dayNum}</span>
      <span class="event-date-month">${escapeHtml(monthAbbr)}</span>
    </div>
    <div class="event-details">
      <h3 class="event-title">${escapeHtml(event.title)}</h3>
      <div class="event-time">${escapeHtml(timeStr)}</div>
      ${locationHtml}
      ${notesHtml}
      ${linkHtml}
    </div>
  `;

  return card;
}
