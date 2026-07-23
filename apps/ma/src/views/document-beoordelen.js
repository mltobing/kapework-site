/**
 * views/document-beoordelen.js
 *
 * Review/progress screen for one Document Inbox import — owner-only. Polls
 * while queued/processing, shows safe Dutch copy on failure/duplicate, and
 * once ready/completed renders the AI's draft candidates for the owner to
 * edit, reject/restore, select, and approve.
 *
 * Non-negotiable, enforced entirely through the data layer this view calls
 * (see api.js / supabase-migrations/011_ma_document_inbox.sql — never
 * re-implemented here):
 *   - No candidate becomes a Logboek entry except through
 *     approveDocumentCandidates() (the transactional RPC).
 *   - The AI never chose audience — the owner may change a candidate's
 *     audience here, but only while it is still pending/rejected.
 *   - Source excerpt/locator are always rendered read-only.
 */

import {
  fetchDocumentImport, fetchDocumentImportFiles, fetchDocumentCandidates,
  saveDocumentCandidate, approveDocumentCandidates,
} from '../api.js';
import { getImportFileUrl } from '../document-storage.js';
import { startDocumentProcessing } from '../lib/document-process-api.js';
import { navigate, routeParams } from '../router.js';
import { escapeHtml } from '../utils.js';
import { formatDayHeader } from '../lib/datetime.js';
import {
  statusLabel, sourceTypeLabel, errorMessage, isRetryableError, shouldPoll, normalizeCandidateInput,
} from '../lib/document-inbox.js';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 10 * 60 * 1000;

const CANDIDATE_KIND_OPTIONS = [
  { value: 'note',         label: 'Notitie' },
  { value: 'document',     label: 'Document' },
  { value: 'observation',  label: 'Observatie' },
  { value: 'event_report', label: 'Afspraakverslag' },
];
const DATE_BASIS_OPTIONS = [
  { value: 'explicit',          label: 'Expliciete datum' },
  { value: 'relative_resolved', label: 'Herleide datum' },
  { value: 'unclear',           label: 'Onduidelijk' },
];
const DATE_CONFIDENCE_OPTIONS = [
  { value: 'high',   label: 'Hoog' },
  { value: 'medium', label: 'Gemiddeld' },
  { value: 'low',    label: 'Laag' },
];
const AUDIENCE_OPTIONS = [
  { value: 'family',    label: 'Alleen familie' },
  { value: 'care_team', label: 'Familie en zorgteam' },
];
const CANDIDATE_STATUS_LABELS = { pending: 'In afwachting', rejected: 'Afgewezen', approved: 'Goedgekeurd' };

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, user: object|null, accessType: string|null }} state
 */
export async function mount(container, { familyId, user, accessType }) {
  const importId = routeParams().get('id');

  container.innerHTML = `
    <div class="view-document-beoordelen">
      <div class="view-header view-header--back">
        <button class="dev-back" id="db-back" aria-label="Terug">‹ Terug</button>
        <h1>Document beoordelen</h1>
      </div>
      <div class="dev-body" id="db-body"><div class="section-loading">Laden…</div></div>
    </div>
  `;

  container.querySelector('#db-back').addEventListener('click', () => navigate('documenten'));

  const bodyEl = container.querySelector('#db-body');

  if (!familyId || !user || accessType !== 'owner' || !importId) {
    bodyEl.innerHTML = '<p class="empty-state">Geen toegang.</p>';
    return () => {};
  }

  let pollTimer = null;
  let pollStartedAt = null;
  let destroyed = false;

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function ensurePolling(status) {
    if (!shouldPoll(status)) { stopPolling(); return; }
    if (pollTimer) return;
    pollStartedAt = Date.now();
    pollTimer = setInterval(() => {
      if (Date.now() - pollStartedAt > MAX_POLL_MS) {
        stopPolling();
        const noticeEl = bodyEl.querySelector('#db-timeout-notice');
        if (noticeEl) noticeEl.hidden = false;
        return;
      }
      load();
    }, POLL_INTERVAL_MS);
  }

  async function load() {
    let importRow;
    try {
      importRow = await fetchDocumentImport(importId);
    } catch (err) {
      console.error('[ma/document-beoordelen] Failed to load import:', err);
      if (!destroyed) bodyEl.innerHTML = '<p class="empty-state">Kon dit document niet laden.</p>';
      return;
    }
    if (destroyed) return;
    if (!importRow || importRow.family_id !== familyId) {
      bodyEl.innerHTML = '<p class="empty-state">Document niet gevonden.</p>';
      stopPolling();
      return;
    }
    await render(importRow);
  }

  async function render(importRow) {
    ensurePolling(importRow.status);

    if (importRow.status === 'queued' || importRow.status === 'processing') {
      renderProcessing(bodyEl);
      return;
    }
    if (importRow.status === 'draft' || importRow.status === 'uploaded') {
      renderNotStarted(bodyEl, () => handleStart(importRow));
      return;
    }
    if (importRow.status === 'failed') {
      renderFailed(bodyEl, importRow, () => handleStart(importRow));
      return;
    }
    if (importRow.status === 'duplicate') {
      renderDuplicate(bodyEl, importRow);
      return;
    }
    if (importRow.status === 'cancelled') {
      bodyEl.innerHTML = `<p class="document-processing-status">${escapeHtml(statusLabel('cancelled'))}.</p>`;
      return;
    }
    // ready / completed
    await renderReview(bodyEl, importRow);
  }

  async function handleStart(importRow) {
    try {
      await startDocumentProcessing(familyId, importRow.id);
    } catch (err) {
      console.error('[ma/document-beoordelen] Failed to start processing:', err);
      // The import row's own status (set server-side) is the source of
      // truth from here — reload and let it speak for itself.
    }
    await load();
  }

  async function renderReview(bodyEl, importRow) {
    let files;
    let candidates;
    try {
      [files, candidates] = await Promise.all([
        fetchDocumentImportFiles(importRow.id),
        fetchDocumentCandidates(importRow.id),
      ]);
    } catch (err) {
      console.error('[ma/document-beoordelen] Failed to load review data:', err);
      bodyEl.innerHTML = '<p class="empty-state">Kon de voorstellen niet laden.</p>';
      return;
    }
    if (destroyed) return;

    const selected = new Set();
    const formState = new Map();

    bodyEl.innerHTML = `
      <div class="document-review-header">
        <p class="document-review-label">${escapeHtml(importRow.source_label)}</p>
        <p class="dev-row-meta">${escapeHtml(sourceTypeLabel(importRow.source_type))}${importRow.document_date ? ` · ${escapeHtml(formatDayHeader(importRow.document_date))}` : ''}</p>
        <div class="document-review-files" id="db-files"></div>
        ${importRow.document_summary ? `<p class="document-review-summary">${escapeHtml(importRow.document_summary)}</p>` : ''}
        ${(importRow.document_warnings || []).length ? `
          <ul class="document-review-warnings">
            ${importRow.document_warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}
          </ul>
        ` : ''}
        <p class="dev-row-meta">
          ${importRow.model ? `Model: ${escapeHtml(importRow.model)}` : ''}
          ${(importRow.input_tokens != null || importRow.output_tokens != null)
            ? ` · Tokens: ${importRow.input_tokens ?? '–'} / ${importRow.output_tokens ?? '–'}`
            : ''}
        </p>
      </div>

      ${candidates.length === 0 ? '<p class="empty-state">Geen voorstellen gevonden in dit document.</p>' : ''}
      <div class="document-candidate-list" id="db-candidates"></div>

      ${candidates.length > 0 ? `
        <div class="document-review-actions">
          <button class="btn-primary btn-large" id="db-approve" disabled>Geselecteerde logboekregels plaatsen</button>
        </div>
      ` : ''}
      <div id="db-approve-result"></div>
    `;

    const filesEl = bodyEl.querySelector('#db-files');
    for (const f of files) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-ghost';
      btn.textContent = `Bron openen${files.length > 1 ? ` (${f.sequence_no})` : ''}`;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const url = await getImportFileUrl(f.object_path);
          window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err) {
          console.error('[ma/document-beoordelen] Could not open source:', err);
        } finally {
          btn.disabled = false;
        }
      });
      filesEl.appendChild(btn);
    }

    const listEl = bodyEl.querySelector('#db-candidates');
    const approveBtn = bodyEl.querySelector('#db-approve');
    const resultEl = bodyEl.querySelector('#db-approve-result');

    function updateApproveState() {
      if (approveBtn) approveBtn.disabled = selected.size === 0;
    }

    async function reload() {
      const fresh = await fetchDocumentImport(importRow.id);
      if (destroyed || !fresh) return;
      await renderReview(bodyEl, fresh);
    }

    async function saveCandidate(candidateId, formValues, cardEl) {
      const buttons = cardEl.querySelectorAll('button');
      buttons.forEach((b) => { b.disabled = true; });
      try {
        await saveDocumentCandidate(candidateId, normalizeCandidateInput(formValues));
        return true;
      } catch (err) {
        console.error('[ma/document-beoordelen] Failed to save candidate:', err);
        window.alert('Kon niet opslaan. Probeer het opnieuw.');
        buttons.forEach((b) => { b.disabled = false; });
        return false;
      }
    }

    for (const candidate of candidates) {
      formState.set(candidate.id, {
        eventDate:       candidate.event_date,
        dateBasis:       candidate.date_basis,
        dateConfidence:  candidate.date_confidence,
        kind:            candidate.kind,
        title:           candidate.title,
        body:            candidate.body,
        audience:        candidate.audience,
        tags:            candidate.tags || [],
        status:          candidate.status,
      });

      listEl.appendChild(renderCandidateCard(candidate, {
        onSelectChange: (checked) => {
          if (checked) selected.add(candidate.id); else selected.delete(candidate.id);
          updateApproveState();
        },
        onFieldChange: (patch) => {
          formState.set(candidate.id, { ...formState.get(candidate.id), ...patch });
        },
        onSave: async (cardEl) => {
          const ok = await saveCandidate(candidate.id, formState.get(candidate.id), cardEl);
          if (ok) showCardSavedNotice(cardEl);
        },
        onReject: async (cardEl) => {
          const ok = await saveCandidate(candidate.id, { ...formState.get(candidate.id), status: 'rejected' }, cardEl);
          if (ok) await reload();
        },
        onRestore: async (cardEl) => {
          const ok = await saveCandidate(candidate.id, { ...formState.get(candidate.id), status: 'pending' }, cardEl);
          if (ok) await reload();
        },
      }));
    }

    approveBtn?.addEventListener('click', async () => {
      if (selected.size === 0) return;
      const selectedIds = Array.from(selected);
      const selectedCareTeam = selectedIds.some((id) => (formState.get(id) || {}).audience === 'care_team');
      if (selectedCareTeam) {
        const confirmed = window.confirm('Sommige geselecteerde logboekregels worden zichtbaar voor familie én zorgteam. Doorgaan?');
        if (!confirmed) return;
      }

      approveBtn.disabled = true;
      approveBtn.textContent = 'Bezig…';

      try {
        for (const id of selectedIds) {
          await saveDocumentCandidate(id, normalizeCandidateInput(formState.get(id)));
        }
        const results = await approveDocumentCandidates(importRow.id, selectedIds);
        resultEl.innerHTML = `
          <p class="document-approve-success">
            ${results.length} ${results.length === 1 ? 'logboekregel geplaatst.' : 'logboekregels geplaatst.'}
          </p>
          <div class="document-review-actions">
            <button class="btn-ghost" id="db-view-logboek">Bekijk in Logboek</button>
            <button class="btn-ghost" id="db-continue">Verder beoordelen</button>
          </div>
        `;
        resultEl.querySelector('#db-view-logboek').addEventListener('click', () => navigate('logboek'));
        resultEl.querySelector('#db-continue').addEventListener('click', reload);
      } catch (err) {
        console.error('[ma/document-beoordelen] Approval failed:', err);
        window.alert('Kon niet plaatsen. Probeer het opnieuw.');
        approveBtn.disabled = false;
        approveBtn.textContent = 'Geselecteerde logboekregels plaatsen';
      }
    });

    updateApproveState();
  }

  await load();

  return () => {
    destroyed = true;
    stopPolling();
  };
}

// ─── Status-specific renders ──────────────────────────────────────────────────

function renderProcessing(bodyEl) {
  bodyEl.innerHTML = `
    <p class="document-processing-status">Document wordt verwerkt…</p>
    <p class="dev-row-meta" id="db-timeout-notice" hidden>De verwerking loopt mogelijk nog. Kijk over enkele minuten opnieuw.</p>
  `;
}

function renderNotStarted(bodyEl, onStart) {
  bodyEl.innerHTML = `
    <p class="document-processing-status">Dit document is nog niet verwerkt.</p>
    <button class="btn-primary" id="db-start">Verwerking starten</button>
  `;
  const btn = bodyEl.querySelector('#db-start');
  btn.addEventListener('click', () => { btn.disabled = true; onStart(); });
}

function renderFailed(bodyEl, importRow, onRetry) {
  bodyEl.innerHTML = `
    <p class="document-processing-status document-processing-status--error">${escapeHtml(errorMessage(importRow.error_code))}</p>
    ${isRetryableError(importRow.error_code) ? '<button class="btn-primary" id="db-retry">Opnieuw proberen</button>' : ''}
  `;
  const btn = bodyEl.querySelector('#db-retry');
  btn?.addEventListener('click', () => { btn.disabled = true; onRetry(); });
}

function renderDuplicate(bodyEl, importRow) {
  bodyEl.innerHTML = `
    <p class="document-processing-status">Dit document is al eerder verwerkt.</p>
    ${importRow.duplicate_of ? '<button class="btn-ghost" id="db-open-existing">Bekijk het eerder verwerkte document</button>' : ''}
  `;
  bodyEl.querySelector('#db-open-existing')?.addEventListener('click', () => {
    navigate('document-beoordelen', { id: importRow.duplicate_of });
  });
}

// ─── Candidate card ───────────────────────────────────────────────────────────

function candidateStatusLabel(status) {
  return CANDIDATE_STATUS_LABELS[status] ?? status;
}

function optionsHtml(options, current) {
  return options.map((o) => `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
}

function renderCandidateCard(candidate, { onSelectChange, onFieldChange, onSave, onReject, onRestore }) {
  const isPending  = candidate.status === 'pending';
  const isRejected = candidate.status === 'rejected';
  const editable   = isPending || isRejected;

  const card = document.createElement('article');
  card.className = 'document-candidate-card';
  card.dataset.candidateId = candidate.id;

  card.innerHTML = `
    <div class="document-candidate-header">
      ${isPending ? '<input type="checkbox" class="document-candidate-select" aria-label="Selecteren">' : ''}
      <span class="entry-badge document-candidate-status document-candidate-status--${candidate.status}">${escapeHtml(candidateStatusLabel(candidate.status))}</span>
    </div>

    <div class="compose-field">
      <label class="compose-label">Datum</label>
      <input type="date" class="compose-date" data-field="eventDate" value="${candidate.event_date ?? ''}" ${editable ? '' : 'disabled'}>
    </div>

    <div class="compose-field">
      <label class="compose-label">Datumbasis</label>
      <select class="compose-title" data-field="dateBasis" ${editable ? '' : 'disabled'}>${optionsHtml(DATE_BASIS_OPTIONS, candidate.date_basis)}</select>
    </div>

    <div class="compose-field">
      <label class="compose-label">Betrouwbaarheid datum</label>
      <select class="compose-title" data-field="dateConfidence" ${editable ? '' : 'disabled'}>${optionsHtml(DATE_CONFIDENCE_OPTIONS, candidate.date_confidence)}</select>
    </div>

    <div class="compose-field">
      <label class="compose-label">Type</label>
      <select class="compose-title" data-field="kind" ${editable ? '' : 'disabled'}>${optionsHtml(CANDIDATE_KIND_OPTIONS, candidate.kind)}</select>
    </div>

    <div class="compose-field">
      <label class="compose-label">Titel</label>
      <input type="text" class="compose-title" data-field="title" maxlength="120" value="${escapeHtml(candidate.title || '')}" ${editable ? '' : 'disabled'}>
    </div>

    <div class="compose-field">
      <label class="compose-label">Beschrijving</label>
      <textarea class="compose-caption" data-field="body" rows="4" maxlength="4000" ${editable ? '' : 'disabled'}>${escapeHtml(candidate.body || '')}</textarea>
    </div>

    <div class="compose-field">
      <label class="compose-label">Zichtbaarheid</label>
      <select class="compose-title" data-field="audience" ${editable ? '' : 'disabled'}>${optionsHtml(AUDIENCE_OPTIONS, candidate.audience)}</select>
    </div>

    <div class="compose-field">
      <label class="compose-label">Labels (gescheiden door komma's)</label>
      <input type="text" class="compose-title" data-field="tags" maxlength="300" value="${escapeHtml((candidate.tags || []).join(', '))}" ${editable ? '' : 'disabled'}>
    </div>

    ${candidate.source_locator ? `<p class="dev-row-meta">Locatie in bron: ${escapeHtml(candidate.source_locator)}</p>` : ''}
    ${candidate.source_excerpt ? `<blockquote class="document-candidate-excerpt">${escapeHtml(candidate.source_excerpt)}</blockquote>` : ''}
    ${(candidate.warnings || []).length ? `
      <ul class="document-candidate-warnings">
        ${candidate.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}
      </ul>
    ` : ''}
    ${candidate.follow_up ? `<p class="document-candidate-followup"><strong>Mogelijke opvolging:</strong> ${escapeHtml(candidate.follow_up)}</p>` : ''}

    <div class="document-candidate-actions">
      ${editable ? '<button type="button" class="btn-ghost" data-action="save">Concept opslaan</button>' : ''}
      ${isPending ? '<button type="button" class="btn-ghost" data-action="reject">Afwijzen</button>' : ''}
      ${isRejected ? '<button type="button" class="btn-ghost" data-action="restore">Herstellen</button>' : ''}
    </div>
  `;

  const checkbox = card.querySelector('.document-candidate-select');
  checkbox?.addEventListener('change', () => onSelectChange(checkbox.checked));

  function currentFormValues() {
    const get = (field) => card.querySelector(`[data-field="${field}"]`)?.value ?? '';
    return {
      eventDate:      get('eventDate') || null,
      dateBasis:      get('dateBasis'),
      dateConfidence: get('dateConfidence'),
      kind:           get('kind'),
      title:          get('title'),
      body:           get('body'),
      audience:       get('audience'),
      tags:           get('tags').split(',').map((t) => t.trim()).filter(Boolean),
      status:         candidate.status,
    };
  }

  card.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('input', () => onFieldChange(currentFormValues()));
    el.addEventListener('change', () => onFieldChange(currentFormValues()));
  });

  // Ambiguous dates stay ambiguous in the UI too — picking 'Onduidelijk'
  // clears and disables the date field rather than silently keeping a date
  // that will be dropped on save anyway.
  const dateBasisEl = card.querySelector('[data-field="dateBasis"]');
  const eventDateEl = card.querySelector('[data-field="eventDate"]');
  function syncDateDisabled() {
    if (!editable) return;
    const unclear = dateBasisEl.value === 'unclear';
    eventDateEl.disabled = unclear;
    if (unclear) eventDateEl.value = '';
  }
  dateBasisEl?.addEventListener('change', syncDateDisabled);
  syncDateDisabled();

  card.querySelector('[data-action="save"]')?.addEventListener('click', () => onSave(card));
  card.querySelector('[data-action="reject"]')?.addEventListener('click', () => onReject(card));
  card.querySelector('[data-action="restore"]')?.addEventListener('click', () => onRestore(card));

  return card;
}

function showCardSavedNotice(cardEl) {
  cardEl.querySelector('.document-candidate-saved')?.remove();
  const notice = document.createElement('span');
  notice.className = 'document-candidate-saved';
  notice.textContent = 'Opgeslagen';
  cardEl.querySelector('.document-candidate-actions')?.appendChild(notice);
  setTimeout(() => notice.remove(), 2000);
}
