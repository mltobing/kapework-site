/**
 * components/logboek-entry.js
 *
 * Renders a single Logboek entry as a DOM element: type icon/label, title/body,
 * event date (falling back to creation date), author, attachments, tags,
 * audience badge, optional linked calendar event, pinned state, and comments.
 *
 * Photo attachments load their signed URL asynchronously after the card is
 * inserted into the DOM; PDFs render as a tappable document chip that opens
 * a freshly-signed URL only when tapped (never pre-fetched).
 */

import { escapeHtml, getInitial } from '../utils.js';
import { formatRelativeNl, formatDateKeyHeader, formatDayHeader } from '../lib/datetime.js';
import { getFileUrl }                from '../storage.js';
import { openPhotoModal }            from './modal.js';
import { renderLogboekComments }     from './logboek-comments.js';
import { kindLabel, kindIcon, AUDIENCE_LABELS } from '../lib/logboek-types.js';
import { formatProvenance }          from '../lib/document-inbox.js';

/**
 * @param {object}  entry           — row from ma_posts with nested profile + attachments
 * @param {object}  [opts]
 * @param {boolean} [opts.showAudienceBadge=true] — care-team viewers already know it's care_team
 * @param {string|null} [opts.currentUserId] — signed-in user, to decide "Bewerken" (author-only)
 * @param {boolean} [opts.isOwner=false]     — family owner may "Verwijderen" any entry, not just their own
 * @param {(entry: object) => void} [opts.onEdit]
 * @param {(entry: object) => void} [opts.onDelete]
 * @returns {HTMLElement}
 */
export function renderLogboekEntry(entry, {
  showAudienceBadge = true, currentUserId = null, isOwner = false, onEdit, onDelete,
} = {}) {
  const profile     = entry.ma_profiles ?? {};
  const attachments = entry.ma_attachments ?? [];
  const images      = attachments.filter(a => a.mime_type?.startsWith('image/'));
  const documents    = attachments.filter(a => !a.mime_type?.startsWith('image/'));
  const tags        = entry.tags ?? [];
  // PostgREST embeds a unique-FK relationship as a single object, but stay
  // defensive in case a future query shape returns it as a one-element array.
  const postSource   = Array.isArray(entry.ma_post_sources) ? entry.ma_post_sources[0] : entry.ma_post_sources;
  const provenance   = formatProvenance(postSource);

  const isAuthor  = Boolean(currentUserId) && entry.author_id === currentUserId;
  const canEdit   = isAuthor && typeof onEdit === 'function';
  const canDelete = (isAuthor || isOwner) && typeof onDelete === 'function';

  const entryDateLabel = entry.event_date
    ? formatDateKeyHeader(entry.event_date)
    : formatDayHeader(entry.created_at);

  const card = document.createElement('article');
  card.className = 'entry-card';
  card.dataset.entryId = entry.id;

  card.innerHTML = `
    <div class="entry-header">
      <div class="post-avatar">${escapeHtml(getInitial(profile.display_name))}</div>
      <div class="post-meta">
        <span class="post-author">${escapeHtml(profile.display_name || 'Familie')}</span>
        ${profile.relationship
          ? `<span class="post-relationship">${escapeHtml(profile.relationship)}</span>`
          : ''}
        <span class="post-time">${escapeHtml(entryDateLabel)} · ${formatRelativeNl(entry.created_at)}</span>
      </div>
      <span class="entry-type-badge">${kindIcon(entry.kind)}${escapeHtml(kindLabel(entry.kind))}</span>
      ${(canEdit || canDelete) ? `
        <div class="entry-menu">
          <button type="button" class="entry-menu-btn" aria-label="Meer opties" aria-haspopup="menu" aria-expanded="false">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="4"  r="1.6" fill="currentColor"/>
              <circle cx="10" cy="10" r="1.6" fill="currentColor"/>
              <circle cx="10" cy="16" r="1.6" fill="currentColor"/>
            </svg>
          </button>
          <div class="entry-menu-dropdown" role="menu" hidden>
            ${canEdit   ? '<button type="button" class="entry-menu-item" role="menuitem" data-action="edit">Bewerken</button>' : ''}
            ${canDelete ? '<button type="button" class="entry-menu-item entry-menu-item--danger" role="menuitem" data-action="delete">Verwijderen</button>' : ''}
          </div>
        </div>
      ` : ''}
    </div>

    <div class="entry-badges">
      ${entry.pinned ? '<span class="entry-badge entry-badge--pinned">📌 Vastgezet</span>' : ''}
      ${showAudienceBadge ? `<span class="entry-badge entry-badge--audience-${entry.audience}">${escapeHtml(AUDIENCE_LABELS[entry.audience] ?? AUDIENCE_LABELS.family)}</span>` : ''}
      ${entry.linked_event_uid ? '<span class="entry-badge entry-badge--event">Gekoppeld aan agenda</span>' : ''}
    </div>

    ${images.length ? '<div class="entry-photos" id="entry-photos"></div>' : ''}

    <div class="post-content">
      ${entry.title ? `<h3 class="post-title">${escapeHtml(entry.title)}</h3>` : ''}
      ${entry.body  ? `<p  class="post-body">${escapeHtml(entry.body)}</p>`   : ''}
    </div>

    ${documents.length ? `<div class="entry-documents" id="entry-documents"></div>` : ''}

    ${tags.length ? `
      <div class="entry-tags">
        ${tags.map(t => `<span class="entry-tag">#${escapeHtml(t)}</span>`).join('')}
      </div>
    ` : ''}

    ${provenance ? `<p class="entry-provenance">${escapeHtml(provenance)}</p>` : ''}

    <div class="post-comments" id="post-comments-${entry.id}"></div>
  `;

  if (images.length) {
    const photosEl = card.querySelector('#entry-photos');
    for (const img of images) mountPhoto(photosEl, img);
  }

  if (documents.length) {
    const docsEl = card.querySelector('#entry-documents');
    for (const doc of documents) mountDocument(docsEl, doc);
  }

  const commentsEl = card.querySelector(`#post-comments-${entry.id}`);
  renderLogboekComments(commentsEl, entry.id);

  if (canEdit || canDelete) wireEntryMenu(card, entry, { onEdit, onDelete });

  return card;
}

/** Wires the compact "⋯" overflow menu: open/close, outside click, Escape, actions. */
function wireEntryMenu(card, entry, { onEdit, onDelete }) {
  const menuBtn  = card.querySelector('.entry-menu-btn');
  const dropdown = card.querySelector('.entry-menu-dropdown');

  function closeMenu() {
    dropdown.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  function openMenu() {
    dropdown.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    dropdown.querySelector('.entry-menu-item')?.focus();
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.hidden ? openMenu() : closeMenu();
  });

  document.addEventListener('click', (e) => {
    if (!card.contains(e.target)) closeMenu();
  });
  dropdown.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMenu(); menuBtn.focus(); }
  });

  dropdown.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
    closeMenu();
    onEdit(entry);
  });
  dropdown.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
    closeMenu();
    onDelete(entry);
  });
}

function mountPhoto(container, attachment) {
  const wrap = document.createElement('div');
  wrap.className = 'entry-photo entry-photo--loading';
  wrap.innerHTML = '<div class="photo-placeholder"></div>';
  container.appendChild(wrap);

  getFileUrl(attachment.object_path)
    .then(url => {
      wrap.classList.remove('entry-photo--loading');
      const img = document.createElement('img');
      img.src     = url;
      img.alt     = 'Foto bij logboekregel';
      img.loading = 'lazy';
      wrap.innerHTML = '';
      wrap.appendChild(img);
      wrap.addEventListener('click', () => openPhotoModal(url, ''));
    })
    .catch(err => {
      console.warn('[ma/logboek-entry] Could not load photo:', err);
      wrap.remove();
    });
}

function mountDocument(container, attachment) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'entry-document';
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    <span>Document openen</span>
  `;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const url = await getFileUrl(attachment.object_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.warn('[ma/logboek-entry] Could not open document:', err);
    } finally {
      btn.disabled = false;
    }
  });
  container.appendChild(btn);
}
