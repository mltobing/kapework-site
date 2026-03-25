/**
 * views/compose.js
 *
 * The Compose view — create a new family post.
 *
 * Flow:
 *   1. Optionally pick a photo from the device library
 *   2. Optionally write a caption
 *   3. Tap "Post" → createPost(), uploadPhoto(), createAttachment()
 *   4. Navigate back to Family feed on success
 *
 * Kept intentionally simple — one main task per screen.
 */

import { createPost, createAttachment } from '../api.js';
import { uploadPhoto }                  from '../storage.js';
import { navigate }                     from '../router.js';

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, user: object|null }} state
 */
export async function mount(container, { familyId, user }) {
  // ── DOM scaffold ──────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="view-compose">
      <div class="compose-header">
        <button class="compose-cancel" id="compose-cancel">Cancel</button>
        <h2>New Post</h2>
        <button class="compose-post-btn" id="compose-post-btn" disabled>Post</button>
      </div>

      <div class="compose-body">
        <!-- Photo picker area — re-rendered in place when a file is chosen -->
        <div class="compose-photo-area" id="compose-photo-area">
          <input type="file" accept="image/*" id="photo-file-input" hidden>
          <button class="compose-photo-btn" id="photo-pick-btn" type="button">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
              <polyline points="21,15 16,10 5,21"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Add a photo</span>
          </button>
        </div>

        <textarea
          class="compose-caption" id="compose-caption"
          placeholder="Write something\u2026"
          maxlength="1000"
          rows="4"
        ></textarea>
      </div>

      <div id="compose-error"    class="compose-error"    hidden></div>
      <div id="compose-progress" class="compose-progress" hidden>Posting\u2026</div>
    </div>
  `;

  // ── Element refs ──────────────────────────────────────────────────────────
  const photoArea   = container.querySelector('#compose-photo-area');
  const fileInput   = container.querySelector('#photo-file-input');
  const captionEl   = container.querySelector('#compose-caption');
  const postBtn     = container.querySelector('#compose-post-btn');
  const errorEl     = container.querySelector('#compose-error');
  const progressEl  = container.querySelector('#compose-progress');

  let selectedFile = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function updatePostBtn() {
    postBtn.disabled = !selectedFile && !captionEl.value.trim();
  }

  function showPhotoPreview(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      photoArea.innerHTML = `
        <div class="compose-photo-preview">
          <img src="${e.target.result}" alt="Preview">
          <button class="compose-photo-remove" id="photo-remove-btn" aria-label="Remove photo" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <line x1="18" y1="6"  x2="6"  y2="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
              <line x1="6"  y1="6"  x2="18" y2="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      `;

      photoArea.querySelector('#photo-remove-btn').addEventListener('click', () => {
        selectedFile = null;
        showPhotoPicker();
        updatePostBtn();
      });
    };
    reader.readAsDataURL(file);
  }

  function showPhotoPicker() {
    photoArea.innerHTML = `
      <input type="file" accept="image/*" id="photo-file-input" hidden>
      <button class="compose-photo-btn" id="photo-pick-btn" type="button">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
          <polyline points="21,15 16,10 5,21"
                    stroke="currentColor" stroke-width="1.5"
                    stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Add a photo</span>
      </button>
    `;
    bindPickerEvents();
  }

  function bindPickerEvents() {
    const pickBtn = photoArea.querySelector('#photo-pick-btn');
    const input   = photoArea.querySelector('#photo-file-input') || fileInput;

    pickBtn.addEventListener('click', () => input.click());

    input.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      selectedFile = file;
      showPhotoPreview(file);
      updatePostBtn();
    });
  }

  // ── Event bindings ────────────────────────────────────────────────────────

  container.querySelector('#compose-cancel')
    .addEventListener('click', () => navigate('family'));

  captionEl.addEventListener('input', updatePostBtn);

  bindPickerEvents();

  // ── Submit ────────────────────────────────────────────────────────────────

  postBtn.addEventListener('click', async () => {
    const caption = captionEl.value.trim();
    if (!selectedFile && !caption) return;
    if (!familyId || !user) {
      errorEl.textContent = 'Not connected to a family. Please sign in again.';
      errorEl.hidden = false;
      return;
    }

    postBtn.disabled   = true;
    progressEl.hidden  = false;
    errorEl.hidden     = true;

    try {
      // 1. Create the post record
      const post = await createPost({
        familyId,
        authorId: user.id,
        kind:     selectedFile ? 'photo' : 'note',
        body:     caption || null,
      });

      // 2. Upload photo and record attachment if one was chosen
      if (selectedFile) {
        const objectPath = await uploadPhoto(familyId, post.id, selectedFile);
        await createAttachment({
          postId:     post.id,
          familyId,
          uploaderId: user.id,
          objectPath,
          mimeType:   selectedFile.type,
        });
      }

      navigate('family');
    } catch (err) {
      console.error('[ma/compose] Failed to create post:', err);
      errorEl.textContent = 'Could not post. Please try again.';
      errorEl.hidden      = false;
      postBtn.disabled    = false;
    } finally {
      progressEl.hidden = true;
    }
  });
}
