/**
 * views/photos.js
 *
 * The Photos tab — a 3-column grid of all family photos.
 * Tapping a photo opens a full-screen lightbox.
 */

import { fetchPhotos }      from '../api.js';
import { renderPhotoGrid }  from '../components/photo-grid.js';

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null }} state
 */
export async function mount(container, { familyId }) {
  container.innerHTML = `
    <div class="view-photos">
      <div class="view-header">
        <h1>Photos</h1>
      </div>
      <div id="photos-content">
        <div class="section-loading">Loading photos\u2026</div>
      </div>
    </div>
  `;

  const contentEl = container.querySelector('#photos-content');

  if (!familyId) {
    contentEl.innerHTML = '<p class="empty-state">Family not found.</p>';
    return;
  }

  try {
    const photos = await fetchPhotos(familyId);
    contentEl.innerHTML = '';
    renderPhotoGrid(contentEl, photos);
  } catch (err) {
    console.error('[ma/photos] Failed to load photos:', err);
    contentEl.innerHTML = '<p class="empty-state">Could not load photos. Please try again.</p>';
  }
}
