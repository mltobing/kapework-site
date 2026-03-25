/**
 * components/comment-list.js
 *
 * Fetches and renders comments for a post.
 * Includes a reply input for signed-in users.
 * Comments are appended optimistically on submit.
 */

import { fetchComments, addComment } from '../api.js';
import { getState }                  from '../state.js';
import { formatRelative, escapeHtml } from '../utils.js';

/**
 * Renders the comment list (and reply form) into `container`.
 * This is async — it fetches comments from Supabase on mount.
 *
 * @param {HTMLElement} container
 * @param {string}      postId
 */
export async function renderCommentList(container, postId) {
  container.innerHTML = '<div class="section-loading" style="padding:8px 0">Loading replies…</div>';

  let comments = [];
  try {
    comments = await fetchComments(postId);
  } catch (err) {
    console.error('[ma/comment-list] Failed to fetch comments:', err);
    container.innerHTML = '';
    return;
  }

  _render(container, postId, comments);
}

function _render(container, postId, comments) {
  const { user, profile, familyId } = getState();

  const listHtml = comments.map(c => {
    const name = c.ma_profiles?.display_name || 'Family';
    return `
      <div class="comment">
        <span class="comment-author">${escapeHtml(name)}</span>
        <span class="comment-body">${escapeHtml(c.body)}</span>
        <span class="comment-time">${formatRelative(c.created_at)}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="comments-list" id="comments-list-${postId}">${listHtml}</div>
    ${user ? `
      <form class="comment-form" id="comment-form-${postId}">
        <input
          class="comment-input"
          type="text"
          placeholder="Add a reply\u2026"
          maxlength="500"
          autocomplete="off"
        >
        <button type="submit" class="comment-submit">Reply</button>
      </form>
    ` : ''}
  `;

  if (!user) return;

  const form      = container.querySelector(`#comment-form-${postId}`);
  const input     = form.querySelector('.comment-input');
  const submitBtn = form.querySelector('.comment-submit');
  const listEl    = container.querySelector(`#comments-list-${postId}`);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;

    submitBtn.disabled = true;

    try {
      await addComment(postId, familyId, user.id, body);
      input.value = '';

      // Optimistic UI — append immediately
      const commentEl = document.createElement('div');
      commentEl.className = 'comment comment--new';
      commentEl.innerHTML = `
        <span class="comment-author">${escapeHtml(profile?.display_name || 'You')}</span>
        <span class="comment-body">${escapeHtml(body)}</span>
        <span class="comment-time">Just now</span>
      `;
      listEl.appendChild(commentEl);
    } catch (err) {
      console.error('[ma/comment-list] Failed to add reply:', err);
      // Surface inline rather than alert (friendlier on mobile)
      const errEl = document.createElement('p');
      errEl.style.cssText = 'color:var(--danger);font-size:13px;padding:4px 0';
      errEl.textContent   = 'Could not send reply. Please try again.';
      form.appendChild(errEl);
      setTimeout(() => errEl.remove(), 4000);
    } finally {
      submitBtn.disabled = false;
    }
  });
}
