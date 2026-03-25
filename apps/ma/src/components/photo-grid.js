/**
 * components/photo-grid.js
 *
 * Renders a 3-column photo grid from a list of attachment objects.
 * Each photo is loaded via a Supabase signed URL and tappable to open
 * a full-screen modal.
 */

import { getPhotoUrl }   from '../storage.js';
import { openPhotoModal } from './modal.js';
import { escapeHtml }     from '../utils.js';

/**
 * @param {HTMLElement} container
 * @param {Array}       photos   — flat list from api.fetchPhotos()
 */
export function renderPhotoGrid(container, photos) {
  if (!photos.length) {
    container.innerHTML = '<p class="empty-state">No photos yet.</p>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'photo-grid';

  for (const photo of photos) {
    const item = document.createElement('div');
    item.className = 'photo-grid-item photo-grid-item--loading';
    item.innerHTML = '<div class="photo-grid-placeholder"></div>';

    const caption = photo.ma_posts?.body || photo.ma_posts?.title || '';

    getPhotoUrl(photo.object_path)
      .then(url => {
        item.classList.remove('photo-grid-item--loading');
        item.innerHTML = '';

        const img = document.createElement('img');
        img.src     = url;
        img.alt     = 'Family photo';
        img.loading = 'lazy';
        item.appendChild(img);

        item.addEventListener('click', () => openPhotoModal(url, caption));
      })
      .catch(err => {
        console.warn('[ma/photo-grid] Could not load photo:', err);
        item.remove();
      });

    grid.appendChild(item);
  }

  container.appendChild(grid);
}
