/**
 * views/compose.js
 *
 * The Logboek compose view — create a new Logboek entry.
 *
 * Flow:
 *   1. Choose type, optional title, body, the date the entry concerns.
 *   2. Optionally attach one or more photos, or a single PDF/document.
 *   3. Optionally add tags and link a nearby calendar event (family only —
 *      care-team users have no calendar access in this PR).
 *   4. Choose visibility (family: defaults to "Alleen familie", may opt into
 *      "Familie en zorgteam" with a confirmation; care team: always
 *      "Familie en zorgteam", fixed, not a misleading selector).
 *   5. Tap "Plaatsen" → createLogboekEntry(), then upload + createAttachment()
 *      for each file. A failed attachment does not leave a misleading
 *      "complete" post — it's surfaced with a retry / skip choice.
 */

import { createLogboekEntry, createAttachment, deleteLogboekEntry, fetchEvents } from '../api.js';
import { uploadFile, deleteObject, validateFile, ALLOWED_IMAGE_TYPES } from '../storage.js';
import { navigate } from '../router.js';
import { escapeHtml } from '../utils.js';
import { todayAms, formatDayHeader, formatTime } from '../lib/datetime.js';
import { COMPOSE_KINDS } from '../lib/logboek-types.js';

const MAX_PHOTOS = 6;

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, user: object|null, accessType: string|null }} state
 */
export async function mount(container, { familyId, user, accessType }) {
  const isCareTeam = accessType === 'caregiver';

  // ── DOM scaffold ──────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="view-compose">
      <div class="compose-header">
        <button class="compose-cancel" id="compose-cancel">Annuleer</button>
        <h2>Nieuwe logboekregel</h2>
        <button class="compose-post-btn" id="compose-post-btn" disabled>Plaatsen</button>
      </div>

      <div class="compose-body">
        <div class="compose-field">
          <label class="compose-label">Type</label>
          <div class="filter-row" id="compose-kind-chips"></div>
        </div>

        <div class="compose-field">
          <label class="compose-label" for="compose-title">Titel (optioneel)</label>
          <input class="compose-title" id="compose-title" type="text" maxlength="120" placeholder="Titel">
        </div>

        <div class="compose-field">
          <label class="compose-label" for="compose-caption">Beschrijving</label>
          <textarea
            class="compose-caption" id="compose-caption"
            placeholder="Schrijf iets…"
            maxlength="4000"
            rows="4"
          ></textarea>
        </div>

        <div class="compose-field">
          <label class="compose-label" for="compose-date">Datum waar dit over gaat</label>
          <input class="compose-date" id="compose-date" type="date" value="${escapeHtml(todayAms())}">
        </div>

        <div class="compose-field">
          <label class="compose-label">Foto's of document</label>
          <div class="compose-photo-area" id="compose-photo-area">
            <input type="file" accept="${[...ALLOWED_IMAGE_TYPES, 'application/pdf'].join(',')}" id="photo-file-input" multiple hidden>
            <button class="compose-photo-btn" id="photo-pick-btn" type="button">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                <polyline points="21,15 16,10 5,21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>Foto's of een document toevoegen</span>
            </button>
          </div>
          <div class="compose-file-list" id="compose-file-list"></div>
        </div>

        <div class="compose-field">
          <label class="compose-label" for="compose-tags">Labels (optioneel, gescheiden door komma's)</label>
          <input class="compose-title" id="compose-tags" type="text" maxlength="200" placeholder="bijv. medicatie, wandeling">
        </div>

        ${isCareTeam ? '' : `
          <div class="compose-field" id="compose-event-field">
            <label class="compose-label" for="compose-event">Koppel aan agenda-item (optioneel)</label>
            <select class="compose-title" id="compose-event">
              <option value="">Geen</option>
            </select>
          </div>
        `}

        <div class="compose-field">
          <label class="compose-label">Zichtbaarheid</label>
          ${isCareTeam ? `
            <p class="compose-visibility-fixed">Zichtbaar voor familie en zorgteam</p>
          ` : `
            <div class="compose-visibility">
              <label class="compose-radio">
                <input type="radio" name="audience" value="family" checked>
                Alleen familie
              </label>
              <label class="compose-radio">
                <input type="radio" name="audience" value="care_team">
                Familie en zorgteam
              </label>
            </div>
          `}
        </div>
      </div>

      <div id="compose-error"    class="compose-error"    hidden></div>
      <div id="compose-progress" class="compose-progress" hidden>Bezig met plaatsen…</div>
    </div>
  `;

  // ── Element refs ──────────────────────────────────────────────────────────
  const titleEl    = container.querySelector('#compose-title');
  const captionEl  = container.querySelector('#compose-caption');
  const dateEl     = container.querySelector('#compose-date');
  const tagsEl     = container.querySelector('#compose-tags');
  const eventEl    = container.querySelector('#compose-event');
  const fileListEl = container.querySelector('#compose-file-list');
  const postBtn    = container.querySelector('#compose-post-btn');
  const errorEl    = container.querySelector('#compose-error');
  const progressEl = container.querySelector('#compose-progress');

  let selectedKind  = 'note';
  let selectedFiles = [];

  // ── Type chips ───────────────────────────────────────────────────────────
  const kindChipsEl = container.querySelector('#compose-kind-chips');
  kindChipsEl.innerHTML = COMPOSE_KINDS.map(k => `
    <button type="button" class="filter-chip ${k.kind === selectedKind ? 'filter-chip--active' : ''}" data-kind="${k.kind}">
      ${escapeHtml(k.label)}
    </button>
  `).join('');
  kindChipsEl.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedKind = btn.dataset.kind;
      kindChipsEl.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('filter-chip--active'));
      btn.classList.add('filter-chip--active');
    });
  });

  // ── Nearby calendar events (family only) ────────────────────────────────
  if (eventEl && familyId) {
    try {
      const events = await fetchEvents(familyId, { limit: 40 });
      for (const ev of events) {
        const opt = document.createElement('option');
        opt.value = ev.external_event_uid;
        opt.textContent = `${formatDayHeader(ev.starts_at)} ${ev.all_day ? '' : formatTime(ev.starts_at)} — ${ev.title}`;
        eventEl.appendChild(opt);
      }
    } catch (err) {
      console.error('[ma/compose] Failed to load calendar events for linking:', err);
      // Non-fatal — linking is optional; leave the "Geen" option only.
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function updatePostBtn() {
    postBtn.disabled = !selectedFiles.length && !captionEl.value.trim() && !titleEl.value.trim();
  }

  function showFileError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    setTimeout(() => { errorEl.hidden = true; }, 4000);
  }

  function renderFileList() {
    fileListEl.innerHTML = selectedFiles.map((f, i) => `
      <div class="compose-file-chip">
        <span>${f.type === 'application/pdf' ? '📄' : '🖼️'} ${escapeHtml(f.name)}</span>
        <button type="button" class="compose-file-remove" data-index="${i}" aria-label="Verwijder bestand">✕</button>
      </div>
    `).join('');
    fileListEl.querySelectorAll('.compose-file-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(Number(btn.dataset.index), 1);
        renderFileList();
        updatePostBtn();
      });
    });
  }

  function addFiles(files) {
    // A PDF must always be the sole attachment — never mixed with photos,
    // and never more than one. Photos may be added up to MAX_PHOTOS as long
    // as no PDF is already selected.
    for (const file of files) {
      try {
        validateFile(file);
      } catch (err) {
        showFileError(err.message);
        continue;
      }

      const isPdf         = file.type === 'application/pdf';
      const alreadyHasPdf = selectedFiles.some(f => f.type === 'application/pdf');

      if (isPdf && selectedFiles.length > 0) {
        showFileError('Een document kan alleen los toegevoegd worden, niet samen met andere bestanden.');
        continue;
      }
      if (!isPdf && alreadyHasPdf) {
        showFileError('Een document kan alleen los toegevoegd worden, niet samen met foto’s.');
        continue;
      }
      if (!isPdf && selectedFiles.length >= MAX_PHOTOS) {
        showFileError(`Maximaal ${MAX_PHOTOS} foto's per logboekregel.`);
        continue;
      }

      selectedFiles.push(file);
    }
    renderFileList();
    updatePostBtn();
  }

  // ── Event bindings ────────────────────────────────────────────────────────

  container.querySelector('#compose-cancel')
    .addEventListener('click', () => navigate('logboek'));

  captionEl.addEventListener('input', updatePostBtn);
  titleEl.addEventListener('input', updatePostBtn);

  const fileInput = container.querySelector('#photo-file-input');
  container.querySelector('#photo-pick-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    addFiles(Array.from(e.target.files ?? []));
    fileInput.value = '';
  });

  // ── Submit ────────────────────────────────────────────────────────────────

  postBtn.addEventListener('click', async () => {
    const title = titleEl.value.trim();
    const body  = captionEl.value.trim();
    if (!selectedFiles.length && !body && !title) return;
    if (!familyId || !user) {
      errorEl.textContent = 'Niet verbonden met een familie. Log opnieuw in.';
      errorEl.hidden = false;
      return;
    }

    const audience = isCareTeam
      ? 'care_team'
      : (container.querySelector('input[name="audience"]:checked')?.value ?? 'family');

    if (audience === 'care_team') {
      const confirmed = window.confirm(
        'Deze logboekregel wordt zichtbaar voor het zorgteam, naast de familie. Doorgaan?',
      );
      if (!confirmed) return;
    }

    const tags = (tagsEl.value || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    postBtn.disabled   = true;
    progressEl.hidden  = false;
    errorEl.hidden     = true;

    let entry;
    try {
      entry = await createLogboekEntry({
        familyId,
        authorId: user.id,
        kind: selectedKind,
        title: title || null,
        body: body || null,
        eventDate: dateEl.value || null,
        audience,
        tags,
        linkedEventUid: eventEl?.value || null,
      });
    } catch (err) {
      console.error('[ma/compose] Failed to create entry:', err);
      errorEl.textContent = 'Kon niet plaatsen. Probeer het opnieuw.';
      errorEl.hidden      = false;
      postBtn.disabled    = false;
      progressEl.hidden   = true;
      return;
    }

    // Entry exists — from here on, a failure must not silently drop an
    // attachment or leave the user stuck; offer a real retry/skip choice.
    if (selectedFiles.length) {
      const failed = await uploadAttachments(entry.id, familyId, user.id, selectedFiles, progressEl);
      if (failed.length) {
        showAttachmentRecovery(container, entry, failed, familyId, user.id);
        return;
      }
    }

    progressEl.hidden = true;
    navigate('logboek');
  });
}

/**
 * Uploads each file and records its ma_attachments row. Returns the subset
 * that failed (upload or metadata step) so the caller can offer recovery.
 * On a metadata failure after a successful upload, the orphaned object is
 * cleaned up best-effort.
 */
async function uploadAttachments(postId, familyId, uploaderId, files, progressEl) {
  const failed = [];
  for (const file of files) {
    progressEl.textContent = `Bezig met uploaden… (${file.name})`;
    let objectPath;
    try {
      objectPath = await uploadFile(familyId, postId, file);
    } catch (err) {
      console.error('[ma/compose] Upload failed:', err);
      failed.push(file);
      continue;
    }
    try {
      await createAttachment({ postId, familyId, uploaderId, objectPath, mimeType: file.type });
    } catch (err) {
      console.error('[ma/compose] Attachment metadata failed, cleaning up orphaned object:', err);
      try { await deleteObject(objectPath); } catch (cleanupErr) {
        console.error('[ma/compose] Could not clean up orphaned object:', cleanupErr);
      }
      failed.push(file);
    }
  }
  return failed;
}

/**
 * Shown when the entry itself saved but one or more attachments didn't.
 * Never leaves a misleading "complete" post silently — the user explicitly
 * chooses to retry the failed files or continue without them.
 */
function showAttachmentRecovery(container, entry, failedFiles, familyId, uploaderId) {
  const progressEl = container.querySelector('#compose-progress');
  const errorEl    = container.querySelector('#compose-error');
  progressEl.hidden = true;

  errorEl.hidden = false;
  errorEl.innerHTML = `
    <p>De logboekregel is opgeslagen, maar ${failedFiles.length === 1 ? 'een bijlage kon' : 'sommige bijlagen konden'} niet worden geüpload.</p>
    <div class="compose-recovery-actions">
      <button class="btn-ghost" id="recovery-retry">Probeer opnieuw</button>
      <button class="btn-ghost" id="recovery-skip">Doorgaan zonder bijlage</button>
      <button class="btn-ghost" id="recovery-delete">Verwijder deze regel</button>
    </div>
  `;

  container.querySelector('#recovery-skip')
    .addEventListener('click', () => navigate('logboek'));

  container.querySelector('#recovery-delete').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await deleteLogboekEntry(entry.id);
    } catch (err) {
      console.error('[ma/compose] Failed to delete incomplete entry:', err);
    }
    navigate('logboek');
  });

  container.querySelector('#recovery-retry').addEventListener('click', async (e) => {
    e.target.disabled = true;
    progressEl.hidden = false;
    errorEl.hidden = true;
    const stillFailed = await uploadAttachments(entry.id, familyId, uploaderId, failedFiles, progressEl);
    if (stillFailed.length) {
      showAttachmentRecovery(container, entry, stillFailed, familyId, uploaderId);
    } else {
      progressEl.hidden = true;
      navigate('logboek');
    }
  });
}
