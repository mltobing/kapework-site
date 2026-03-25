/**
 * components/modal.js
 *
 * Full-screen photo lightbox.
 * Appended to <body> on open; removed on close.
 * Supports:  backdrop tap, close button, Escape key.
 */

import { escapeHtml } from '../utils.js';

/**
 * Opens a photo in a full-screen modal.
 * @param {string} url
 * @param {string} [caption]
 */
export function openPhotoModal(url, caption = '') {
  // Remove any existing modal
  document.getElementById('ma-photo-modal')?.remove();

  const modal = document.createElement('div');
  modal.id        = 'ma-photo-modal';
  modal.className = 'photo-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', caption || 'Photo');

  modal.innerHTML = `
    <div class="photo-modal-backdrop"></div>
    <div class="photo-modal-content">
      <button class="photo-modal-close" aria-label="Close photo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <line x1="18" y1="6"  x2="6"  y2="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="6"  y1="6"  x2="18" y2="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </button>
      <img class="photo-modal-img" src="${escapeHtml(url)}" alt="${escapeHtml(caption || 'Family photo')}">
      ${caption ? `<p class="photo-modal-caption">${escapeHtml(caption)}</p>` : ''}
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  function close() {
    modal.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  modal.querySelector('.photo-modal-close').addEventListener('click', close);
  modal.querySelector('.photo-modal-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
}
