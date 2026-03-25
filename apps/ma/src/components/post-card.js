/**
 * components/post-card.js
 *
 * Renders a single post as a DOM element.
 * Photo URLs are loaded asynchronously after the card is inserted into the DOM
 * (because they require a Supabase signed-URL fetch).
 *
 * If showComments is true, a comment thread is appended below the post body.
 */

import { formatRelative, escapeHtml, getInitial } from '../utils.js';
import { getPhotoUrl }                             from '../storage.js';
import { renderCommentList }                       from './comment-list.js';

/**
 * @param {object}  post            — row from ma_posts with nested profile + attachments
 * @param {object}  [opts]
 * @param {boolean} [opts.showComments=false]
 * @returns {HTMLElement}
 */
export function renderPostCard(post, { showComments = false } = {}) {
  const profile     = post.ma_profiles ?? {};
  const attachments = post.ma_attachments ?? [];
  const photo       = attachments.find(a => a.mime_type?.startsWith('image/') || a.object_path);

  const card = document.createElement('article');
  card.className = 'post-card';

  card.innerHTML = `
    <div class="post-header">
      <div class="post-avatar">${escapeHtml(getInitial(profile.display_name))}</div>
      <div class="post-meta">
        <span class="post-author">${escapeHtml(profile.display_name || 'Family')}</span>
        ${profile.relationship
          ? `<span class="post-relationship">${escapeHtml(profile.relationship)}</span>`
          : ''}
        <span class="post-time">${formatRelative(post.created_at)}</span>
      </div>
    </div>
    ${photo ? '<div class="post-photo post-photo--loading"><div class="photo-placeholder"></div></div>' : ''}
    <div class="post-content">
      ${post.title ? `<h3 class="post-title">${escapeHtml(post.title)}</h3>` : ''}
      ${post.body  ? `<p  class="post-body">${escapeHtml(post.body)}</p>`   : ''}
    </div>
    ${showComments ? `<div class="post-comments" id="post-comments-${post.id}"></div>` : ''}
  `;

  // Load photo signed URL asynchronously
  if (photo) {
    const photoEl = card.querySelector('.post-photo');
    getPhotoUrl(photo.object_path)
      .then(url => {
        photoEl.classList.remove('post-photo--loading');
        const img = document.createElement('img');
        img.src   = url;
        img.alt   = 'Family photo';
        img.loading = 'lazy';
        photoEl.innerHTML = '';
        photoEl.appendChild(img);
      })
      .catch(err => {
        console.warn('[ma/post-card] Could not load photo:', err);
        photoEl.remove();
      });
  }

  // Mount comment thread if requested
  if (showComments) {
    const commentsEl = card.querySelector(`#post-comments-${post.id}`);
    renderCommentList(commentsEl, post.id);
  }

  return card;
}
