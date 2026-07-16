/**
 * views/today.js
 *
 * The Today tab — the app's home screen, built around the day of the person the
 * family is caring for. Everything is rendered in Europe/Amsterdam, so the view
 * reads identically whether it is opened from Amsterdam, New York, or Jakarta.
 *
 * Structure (order is strict):
 *   1. Header      — today's date in Amsterdam (Dutch day header)
 *   2. Vandaag     — all of today's events (Amsterdam), always shown, even if empty
 *   3. Binnenkort  — the next 7 days, grouped by Amsterdam date, empty days omitted
 *   4. Berichten   — the most recent family posts
 */

import { fetchPosts, fetchPinnedPosts, fetchEvents } from '../api.js';
import { renderPostCard }  from '../components/post-card.js';
import { renderEventCard } from '../components/event-card.js';
import { mountRideNotices } from '../components/ride-notices.js';
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

      <!-- Ride-reconciliation strip: populated only when open notices exist. -->
      <div id="today-notices"></div>

      <section class="today-section">
        <h2 class="section-title">Vandaag</h2>
        <div id="today-vandaag"><div class="section-loading">Laden…</div></div>
      </section>

      <section class="today-section">
        <h2 class="section-title">Binnenkort</h2>
        <div id="today-binnenkort"><div class="section-loading">Laden…</div></div>
      </section>

      <section class="today-section">
        <h2 class="section-title">Berichten</h2>
        <div id="today-posts"><div class="section-loading">Laden…</div></div>
      </section>
    </div>
  `;

  const vandaagEl    = container.querySelector('#today-vandaag');
  const binnenkortEl = container.querySelector('#today-binnenkort');
  const postsEl      = container.querySelector('#today-posts');
  const noticesEl    = container.querySelector('#today-notices');

  if (!familyId) {
    vandaagEl.innerHTML    = '<p class="empty-state">Geen afspraken vandaag</p>';
    binnenkortEl.innerHTML = '<p class="empty-state">Geen afspraken de komende dagen</p>';
    postsEl.innerHTML      = '';
    return;
  }

  // Fetch events and posts in parallel; one failing must not blank the other.
  const [eventsResult, postsResult] = await Promise.allSettled([
    fetchEvents(familyId, { limit: 60 }),
    loadRecentPosts(familyId),
  ]);

  renderSchedule(eventsResult, todayKey, vandaagEl, binnenkortEl);
  renderPosts(postsResult, postsEl);

  // Ride-reconciliation strip. It runs its own query and stays empty on quiet
  // days, so it renders after the schedule and never blocks or blanks it. The
  // events already loaded above let a "conflict" card show the calendar's own
  // time alongside the e-mail's.
  await mountRideNotices(noticesEl, { familyId, eventsByUid: buildEventsByUid(eventsResult) });
}

/** Map ma_calendar_events.external_uid → event, for matching conflict notices. */
function buildEventsByUid(eventsResult) {
  const map = new Map();
  if (eventsResult.status === 'fulfilled') {
    for (const ev of eventsResult.value ?? []) {
      if (ev.external_uid) map.set(ev.external_uid, ev);
    }
  }
  return map;
}

// ─── Schedule (Vandaag + Binnenkort) ─────────────────────────────────────────

function renderSchedule(eventsResult, todayKey, vandaagEl, binnenkortEl) {
  if (eventsResult.status === 'rejected') {
    console.error('[ma/today] Events error:', eventsResult.reason);
    vandaagEl.innerHTML    = '<p class="empty-state">Afspraken konden niet worden geladen.</p>';
    binnenkortEl.innerHTML = '';
    return;
  }

  const events    = eventsResult.value ?? [];
  const weekEndKey = addDaysKey(todayKey, 7);

  // Bucket by Amsterdam date. Events arrive sorted ascending by starts_at,
  // so each day's list — and the day order — is already in time order.
  const todayEvents = [];
  const upcoming    = new Map(); // dateKey -> events[]

  for (const event of events) {
    const key = amsDateKey(event.starts_at);
    if (key === todayKey) {
      todayEvents.push(event);
    } else if (key > todayKey && key <= weekEndKey) {
      if (!upcoming.has(key)) upcoming.set(key, []);
      upcoming.get(key).push(event);
    }
  }

  // ── Vandaag — always rendered, even when empty ──
  vandaagEl.innerHTML = '';
  if (todayEvents.length) {
    for (const event of todayEvents) {
      const past = isPast(event.ends_at ?? event.starts_at);
      vandaagEl.appendChild(renderEventCard(event, { past }));
    }
  } else {
    vandaagEl.innerHTML = '<p class="empty-state">Geen afspraken vandaag</p>';
  }

  // ── Binnenkort — only days that actually have events ──
  binnenkortEl.innerHTML = '';
  if (upcoming.size) {
    for (const [key, dayEvents] of upcoming) {
      const group = document.createElement('div');
      group.className = 'today-day-group';
      group.innerHTML = `<h3 class="today-day-header">${formatDateKeyHeader(key)}</h3>`;
      for (const event of dayEvents) {
        group.appendChild(renderEventCard(event));
      }
      binnenkortEl.appendChild(group);
    }
  } else {
    binnenkortEl.innerHTML = '<p class="empty-state">Geen afspraken de komende dagen</p>';
  }
}

// ─── Berichten (recent posts) ────────────────────────────────────────────────

function renderPosts(postsResult, postsEl) {
  if (postsResult.status === 'fulfilled' && postsResult.value.length) {
    postsEl.innerHTML = '';
    for (const post of postsResult.value.slice(0, 2)) {
      postsEl.appendChild(renderPostCard(post));
    }
  } else if (postsResult.status === 'rejected') {
    console.error('[ma/today] Posts error:', postsResult.reason);
    postsEl.innerHTML = '<p class="empty-state">Berichten konden niet worden geladen.</p>';
  } else {
    postsEl.innerHTML = '<p class="empty-state">Nog geen berichten.</p>';
  }
}

/**
 * Returns pinned posts first, then recent posts, deduplicated, up to 3.
 */
async function loadRecentPosts(familyId) {
  const [pinned, recent] = await Promise.all([
    fetchPinnedPosts(familyId, { limit: 2 }),
    fetchPosts(familyId, { limit: 4 }),
  ]);

  const seen = new Set();
  const posts = [];

  for (const p of [...pinned, ...recent]) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      posts.push(p);
    }
    if (posts.length >= 3) break;
  }

  return posts;
}
