/**
 * views/family.js
 *
 * The Family tab — chronological feed of all family posts with comments.
 * A floating "+" button navigates to the Compose view.
 */

import { fetchPosts }     from '../api.js';
import { renderPostCard } from '../components/post-card.js';
import { navigate }       from '../router.js';

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null }} state
 */
export async function mount(container, { familyId }) {
  container.innerHTML = `
    <div class="view-family">
      <div class="view-header">
        <h1>Family</h1>
      </div>
      <div class="feed-list" id="family-feed">
        <div class="section-loading">Loading\u2026</div>
      </div>
      <button class="fab" id="compose-fab" aria-label="New post">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;

  container.querySelector('#compose-fab')
    .addEventListener('click', () => navigate('compose'));

  const feedEl = container.querySelector('#family-feed');

  if (!familyId) {
    feedEl.innerHTML = '<p class="empty-state">Family not found.</p>';
    return;
  }

  try {
    const posts = await fetchPosts(familyId, { limit: 30 });
    feedEl.innerHTML = '';

    if (!posts.length) {
      feedEl.innerHTML = '<p class="empty-state">No posts yet.\nBe the first to share something!</p>';
      return;
    }

    for (const post of posts) {
      feedEl.appendChild(renderPostCard(post, { showComments: true }));
    }
  } catch (err) {
    console.error('[ma/family] Failed to load feed:', err);
    feedEl.innerHTML = '<p class="empty-state">Could not load posts. Please try again.</p>';
  }
}
