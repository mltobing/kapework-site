/**
 * components/logboek-edit-modal.js
 *
 * "Bewerken" — a focused edit form for a Logboek entry's own text fields:
 * title, description, the date it concerns, and tags. Deliberately does not
 * touch attachments, type, or visibility — editing those isn't asked for here,
 * and audience changes already have their own confirmation flow in compose.js.
 *
 * Full-screen-on-mobile modal, mirroring components/modal.js's open/close
 * pattern (backdrop tap, close button, Escape).
 */

import { escapeHtml } from '../utils.js';
import { updateLogboekEntry } from '../api.js';

/**
 * @param {object} entry — row from ma_posts (see api.LOGBOEK_ENTRY_COLUMNS)
 * @param {string} userId
 * @param {(updatedEntry: object) => void} onSaved
 */
export function openLogboekEditModal(entry, userId, onSaved) {
  document.getElementById('ma-edit-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'ma-edit-modal';
  modal.className = 'edit-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'edit-modal-title');

  modal.innerHTML = `
    <div class="edit-modal-backdrop"></div>
    <div class="edit-modal-content">
      <div class="edit-modal-header">
        <button type="button" class="edit-modal-cancel" id="edit-modal-cancel">Annuleer</button>
        <h2 id="edit-modal-title">Bewerken</h2>
        <button type="button" class="edit-modal-save" id="edit-modal-save">Opslaan</button>
      </div>
      <div class="edit-modal-body">
        <div class="compose-field">
          <label class="compose-label" for="edit-title">Titel (optioneel)</label>
          <input class="compose-title" id="edit-title" type="text" maxlength="120" value="${escapeHtml(entry.title || '')}">
        </div>
        <div class="compose-field">
          <label class="compose-label" for="edit-caption">Beschrijving</label>
          <textarea class="compose-caption" id="edit-caption" maxlength="4000" rows="4">${escapeHtml(entry.body || '')}</textarea>
        </div>
        <div class="compose-field">
          <label class="compose-label" for="edit-date">Datum waar dit over gaat</label>
          <input class="compose-date" id="edit-date" type="date" value="${escapeHtml(entry.event_date || '')}">
        </div>
        <div class="compose-field">
          <label class="compose-label" for="edit-tags">Labels (optioneel, gescheiden door komma's)</label>
          <input class="compose-title" id="edit-tags" type="text" maxlength="200" value="${escapeHtml((entry.tags || []).join(', '))}">
        </div>
        <div id="edit-modal-error" class="compose-error" hidden></div>
      </div>
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

  modal.querySelector('.edit-modal-backdrop').addEventListener('click', close);
  modal.querySelector('#edit-modal-cancel').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const saveBtn = modal.querySelector('#edit-modal-save');
  const errorEl = modal.querySelector('#edit-modal-error');

  saveBtn.addEventListener('click', async () => {
    const title = modal.querySelector('#edit-title').value.trim();
    const body  = modal.querySelector('#edit-caption').value.trim();
    const eventDate = modal.querySelector('#edit-date').value || null;
    const tags = modal.querySelector('#edit-tags').value
      .split(',').map(t => t.trim()).filter(Boolean);

    if (!title && !body) {
      errorEl.textContent = 'Vul een titel of beschrijving in.';
      errorEl.hidden = false;
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Bezig…';
    errorEl.hidden = true;

    try {
      const updated = await updateLogboekEntry(entry.id, { title, body, eventDate, tags }, userId);
      close();
      onSaved(updated);
    } catch (err) {
      console.error('[ma/logboek-edit] Failed to save:', err);
      errorEl.textContent = 'Kon niet opslaan. Probeer het opnieuw.';
      errorEl.hidden = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Opslaan';
    }
  });

  modal.querySelector('#edit-title').focus();
}
