/**
 * views/today.js
 *
 * The Today tab — the app's home screen.
 *
 * Shows:
 *   • Today's date and a time-of-day greeting
 *   • The 2 most recent family posts (pinned posts shown first if any)
 *   • The next 3 upcoming calendar events
 */

import { fetchPosts, fetchPinnedPosts, fetchEvents } from '../api.js';
import { renderPostCard }  from '../components/post-card.js';
import { renderEventCard } from '../components/event-card.js';
import { todayDate, getGreeting } from '../utils.js';

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null }} state
 */
export async function mount(container, { familyId }) {
  container.innerHTML = `
    <div class="view-today">
      <div class="today-header">
        <p class="today-greeting">${getGreeting()}</p>
        <h1 class="today-date">${todayDate()}</h1>
      </div>

      <section class="today-section">
        <h2 class="section-title">Recent</h2>
        <div id="today-posts"><div class="section-loading">Loading\u2026</div></div>
      </section>

      <section class="today-section">
        <h2 class="section-title">Coming up</h2>
        <div id="today-events"><div class="section-loading">Loading\u2026</div></div>
      </section>
    </div>
  `;

  if (!familyId) {
    container.querySelector('#today-posts').innerHTML  = '';
    container.querySelector('#today-events').innerHTML = '';
    return;
  }

  // Fetch posts and events in parallel
  const [postsResult, eventsResult] = await Promise.allSettled([
    loadRecentPosts(familyId),
    fetchEvents(familyId, { limit: 3 }),
  ]);

  // ── Posts ──
  const postsEl = container.querySelector('#today-posts');
  if (postsResult.status === 'fulfilled' && postsResult.value.length) {
    postsEl.innerHTML = '';
    for (const post of postsResult.value.slice(0, 2)) {
      postsEl.appendChild(renderPostCard(post));
    }
  } else if (postsResult.status === 'rejected') {
    console.error('[ma/today] Posts error:', postsResult.reason);
    postsEl.innerHTML = '<p class="empty-state">Could not load posts.</p>';
  } else {
    postsEl.innerHTML = '<p class="empty-state">No posts yet.</p>';
  }

  // ── Events ──
  const eventsEl = container.querySelector('#today-events');
  if (eventsResult.status === 'fulfilled' && eventsResult.value.length) {
    eventsEl.innerHTML = '';
    for (const event of eventsResult.value) {
      eventsEl.appendChild(renderEventCard(event));
    }
  } else if (eventsResult.status === 'rejected') {
    console.error('[ma/today] Events error:', eventsResult.reason);
    eventsEl.innerHTML = '<p class="empty-state">Could not load events.</p>';
  } else {
    eventsEl.innerHTML = '<p class="empty-state">No upcoming events.</p>';
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
