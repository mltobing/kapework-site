/**
 * views/document-verwerken.js
 *
 * "Nieuw document verwerken" — owner-only. Three mutually exclusive source
 * modes (pasted text / one PDF / up to six photos-or-scans), a visibility
 * choice, and an explicit consent checkbox before anything is sent for
 * processing. On submit: create the import row, upload the immutable source
 * snapshot(s), mark the import uploaded, ask the server to start processing,
 * then hand off to the review/progress screen — which is the single source
 * of truth for what actually happened next (see document-beoordelen.js).
 *
 * Non-negotiable: nothing here calls Anthropic directly, and nothing here
 * ever claims "verwerking gestart" unless the upload itself actually
 * succeeded — see showUploadError() below.
 */

import { createDocumentImport, createDocumentImportFile, markDocumentImportUploaded } from '../api.js';
import {
  validateImportSource, uploadImportFile, deleteImportObject,
  MAX_PASTED_TEXT_CHARS, MAX_IMPORT_IMAGES,
} from '../document-storage.js';
import { startDocumentProcessing } from '../lib/document-process-api.js';
import { navigate } from '../router.js';
import { escapeHtml } from '../utils.js';

const CONSENT_TEXT = 'Ik begrijp dat dit bronmateriaal voor verwerking naar de geconfigureerde Claude API wordt gestuurd. De voorstellen worden pas na mijn controle in het Logboek geplaatst.';
const CARE_TEAM_NOTICE = 'Goedgekeurde logboekregels worden zichtbaar voor familie en zorgteam. Het oorspronkelijke bronbestand blijft alleen zichtbaar voor beheerders.';

const MODES = [
  { mode: 'pasted_text', label: 'Tekst plakken' },
  { mode: 'pdf',         label: 'PDF uploaden' },
  { mode: 'images',      label: "Foto's/scans uploaden" },
];

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, user: object|null, accessType: string|null }} state
 */
export async function mount(container, { familyId, user, accessType }) {
  container.innerHTML = `
    <div class="view-document-verwerken">
      <div class="view-header view-header--back">
        <button class="dev-back" id="dv-back" aria-label="Terug">‹ Terug</button>
        <h1>Nieuw document verwerken</h1>
      </div>
      <div class="dev-body">
        <div class="compose-field">
          <label class="compose-label">Bron</label>
          <div class="filter-row" id="dv-mode-chips"></div>
        </div>

        <div id="dv-source-area"></div>

        <div class="compose-field">
          <label class="compose-label" for="dv-label">Naam van document</label>
          <input class="compose-title" id="dv-label" type="text" maxlength="200" placeholder="Bijvoorbeeld: Verslag huisarts">
        </div>

        <div class="compose-field">
          <label class="compose-label" for="dv-date">Datum van document (optioneel)</label>
          <input class="compose-date" id="dv-date" type="date">
        </div>

        <div class="compose-field">
          <label class="compose-label">Zichtbaarheid</label>
          <div class="compose-visibility">
            <label class="compose-radio">
              <input type="radio" name="dv-audience" value="family" checked>
              Alleen familie
            </label>
            <label class="compose-radio">
              <input type="radio" name="dv-audience" value="care_team">
              Familie en zorgteam
            </label>
          </div>
        </div>

        <label class="compose-radio dv-consent">
          <input type="checkbox" id="dv-consent">
          ${escapeHtml(CONSENT_TEXT)}
        </label>

        <div id="dv-error" class="compose-error" hidden></div>
        <div id="dv-progress" class="compose-progress" hidden>Bezig met uploaden…</div>

        <button class="btn-primary btn-large" id="dv-submit" disabled>Verwerking starten</button>
      </div>
    </div>
  `;

  container.querySelector('#dv-back').addEventListener('click', () => navigate('documenten'));

  if (!familyId || !user || accessType !== 'owner') {
    container.querySelector('.dev-body').innerHTML = '<p class="empty-state">Geen toegang.</p>';
    return;
  }

  const sourceAreaEl = container.querySelector('#dv-source-area');
  const labelEl      = container.querySelector('#dv-label');
  const dateEl        = container.querySelector('#dv-date');
  const consentEl     = container.querySelector('#dv-consent');
  const submitBtn      = container.querySelector('#dv-submit');
  const errorEl        = container.querySelector('#dv-error');
  const progressEl     = container.querySelector('#dv-progress');

  let mode = 'pasted_text';
  let pastedText = '';
  let selectedFiles = [];

  renderModeChips(container.querySelector('#dv-mode-chips'), mode, (next) => {
    mode = next;
    pastedText = '';
    selectedFiles = [];
    renderSourceArea();
    updateSubmitState();
  });

  function renderSourceArea() {
    if (mode === 'pasted_text') {
      sourceAreaEl.innerHTML = `
        <div class="compose-field">
          <label class="compose-label" for="dv-text">Geplakte tekst</label>
          <textarea class="compose-caption" id="dv-text" rows="8" maxlength="${MAX_PASTED_TEXT_CHARS}" placeholder="Plak hier de tekst…"></textarea>
        </div>
      `;
      const textEl = sourceAreaEl.querySelector('#dv-text');
      textEl.value = pastedText;
      textEl.addEventListener('input', () => {
        pastedText = textEl.value;
        updateSubmitState();
      });
    } else if (mode === 'pdf') {
      sourceAreaEl.innerHTML = `
        <div class="compose-field">
          <label class="compose-label">PDF-bestand</label>
          <input type="file" accept="application/pdf" id="dv-file-input">
          <div class="compose-file-list" id="dv-file-list"></div>
        </div>
      `;
      wireFileInput({ multiple: false });
    } else {
      sourceAreaEl.innerHTML = `
        <div class="compose-field">
          <label class="compose-label">Foto's of scans (max ${MAX_IMPORT_IMAGES})</label>
          <input type="file" accept="image/jpeg,image/png,image/webp" id="dv-file-input" multiple>
          <div class="compose-file-list" id="dv-file-list"></div>
        </div>
      `;
      wireFileInput({ multiple: true });
    }
  }

  function wireFileInput({ multiple }) {
    const fileInput = sourceAreaEl.querySelector('#dv-file-input');
    fileInput.addEventListener('change', () => {
      const chosen = Array.from(fileInput.files ?? []);
      selectedFiles = multiple ? chosen.slice(0, MAX_IMPORT_IMAGES) : chosen.slice(0, 1);
      renderFileList();
      updateSubmitState();
    });
  }

  function renderFileList() {
    const listEl = sourceAreaEl.querySelector('#dv-file-list');
    if (!listEl) return;
    listEl.innerHTML = selectedFiles.map((f, i) => `
      <div class="compose-file-chip">
        <span>${f.type === 'application/pdf' ? '📄' : '🖼️'} ${escapeHtml(f.name)}</span>
        <button type="button" class="compose-file-remove" data-index="${i}" aria-label="Verwijder bestand">✕</button>
      </div>
    `).join('');
    listEl.querySelectorAll('.compose-file-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(Number(btn.dataset.index), 1);
        renderFileList();
        updateSubmitState();
      });
    });
  }

  function updateSubmitState() {
    const hasSource = mode === 'pasted_text' ? pastedText.trim().length > 0 : selectedFiles.length > 0;
    submitBtn.disabled = !hasSource || !consentEl.checked;
  }

  consentEl.addEventListener('change', updateSubmitState);
  renderSourceArea();
  updateSubmitState();

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function defaultSourceLabel() {
    if (mode === 'pasted_text') return 'Geplakte tekst';
    if (mode === 'pdf') return selectedFiles[0]?.name || 'Document';
    return selectedFiles.length === 1 ? selectedFiles[0].name : `Foto's/scans (${selectedFiles.length})`;
  }

  submitBtn.addEventListener('click', async () => {
    errorEl.hidden = true;

    try {
      validateImportSource(mode, { text: pastedText, files: selectedFiles });
    } catch (err) {
      showError(err.message);
      return;
    }

    const audience = container.querySelector('input[name="dv-audience"]:checked')?.value ?? 'family';
    if (audience === 'care_team') {
      const confirmed = window.confirm(CARE_TEAM_NOTICE + '\n\nDoorgaan?');
      if (!confirmed) return;
    }

    submitBtn.disabled = true;
    progressEl.hidden = false;

    const sourceLabel = (labelEl.value || '').trim() || defaultSourceLabel();
    const documentDate = dateEl.value || null;

    let importRow;
    try {
      importRow = await createDocumentImport({
        familyId, createdBy: user.id, audience, sourceType: mode, sourceLabel, documentDate,
      });
    } catch (err) {
      console.error('[ma/document-verwerken] Failed to create import:', err);
      showError('Kon niet starten. Probeer het opnieuw.');
      submitBtn.disabled = false;
      progressEl.hidden = true;
      return;
    }

    const blobs = mode === 'pasted_text'
      ? [{ blob: new Blob([pastedText], { type: 'text/plain' }), mimeType: 'text/plain', name: null }]
      : selectedFiles.map((f) => ({ blob: f, mimeType: f.type, name: f.name }));

    const uploadedPaths = [];
    let uploadFailed = false;

    for (let i = 0; i < blobs.length; i++) {
      const { blob, mimeType, name } = blobs[i];
      progressEl.textContent = blobs.length > 1 ? `Bezig met uploaden… (${i + 1}/${blobs.length})` : 'Bezig met uploaden…';
      try {
        const objectPath = await uploadImportFile(familyId, importRow.id, blob, mimeType);
        uploadedPaths.push(objectPath);
        await createDocumentImportFile({
          importId: importRow.id, familyId, uploadedBy: user.id, sequenceNo: i + 1,
          objectPath, mimeType, sizeBytes: blob.size, originalFilename: name,
        });
      } catch (err) {
        console.error('[ma/document-verwerken] Upload failed:', err);
        uploadFailed = true;
        break;
      }
    }

    if (uploadFailed) {
      // Best-effort cleanup of whatever did make it to Storage; the draft
      // import row itself is left in place (there is no browser-facing
      // delete for it) — never claim processing started.
      for (const path of uploadedPaths) {
        try { await deleteImportObject(path); } catch (cleanupErr) {
          console.error('[ma/document-verwerken] Cleanup of uploaded object failed:', cleanupErr);
        }
      }
      showError('Uploaden is mislukt. Probeer het opnieuw.');
      submitBtn.disabled = false;
      progressEl.hidden = true;
      return;
    }

    try {
      await markDocumentImportUploaded(importRow.id);
    } catch (err) {
      console.error('[ma/document-verwerken] Failed to mark import uploaded:', err);
      showError('Uploaden is mislukt. Probeer het opnieuw.');
      submitBtn.disabled = false;
      progressEl.hidden = true;
      return;
    }

    try {
      await startDocumentProcessing(familyId, importRow.id);
    } catch (err) {
      console.error('[ma/document-verwerken] Failed to start processing:', err);
      // The import row's own status (server-set) reflects what really
      // happened — the review screen is the source of truth from here.
    }

    progressEl.hidden = true;
    navigate('document-beoordelen', { id: importRow.id });
  });
}

function renderModeChips(container, active, onSelect) {
  container.innerHTML = MODES.map((m) => `
    <button type="button" class="filter-chip ${m.mode === active ? 'filter-chip--active' : ''}" data-mode="${m.mode}">
      ${escapeHtml(m.label)}
    </button>
  `).join('');
  container.querySelectorAll('.filter-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-chip').forEach((b) => b.classList.remove('filter-chip--active'));
      btn.classList.add('filter-chip--active');
      onSelect(btn.dataset.mode);
    });
  });
}
