/**
 * views/documenten.js
 *
 * Document-inbox — owner-only. Lists every Document Inbox import for the
 * family, newest first, with a calm Dutch status and the right next action
 * per status. Reached from Logboek's "Documenten verwerken" entry point, not
 * the bottom navigation (see ROUTE_ACCESS in main.js — owner-only, same bar
 * as Beheer/Apparaten/Prullenbak).
 *
 * This view never shows source content, candidate text, or a raw error
 * code — only metadata (label, type, date, status, counts) and safe Dutch
 * copy (see lib/document-inbox.js).
 */

import { fetchDocumentImports } from '../api.js';
import { startDocumentProcessing } from '../lib/document-process-api.js';
import { escapeHtml } from '../utils.js';
import { navigate } from '../router.js';
import { formatDayHeader, formatTime } from '../lib/datetime.js';
import { statusLabel, sourceTypeLabel, errorMessage } from '../lib/document-inbox.js';

const PAGE_SIZE = 20;

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, accessType: string|null }} state
 */
export async function mount(container, { familyId, accessType }) {
  container.innerHTML = `
    <div class="view-documenten">
      <div class="view-header view-header--back">
        <button class="dev-back" id="documenten-back" aria-label="Terug">‹ Terug</button>
        <h1>Document-inbox</h1>
      </div>
      <div class="dev-body">
        <p class="dev-intro">
          Plak tekst, upload één PDF, of upload een aantal foto's/scans. Claude stelt
          concept-logboekregels voor; er komt pas iets in het Logboek nadat je het hebt
          gecontroleerd en goedgekeurd.
        </p>
        <button class="btn-primary btn-large" id="documenten-new">Nieuw document verwerken</button>
        <div id="documenten-list"><div class="section-loading">Laden…</div></div>
        <div class="feed-more" id="documenten-more" hidden>
          <button class="btn-ghost" id="documenten-more-btn">Meer laden</button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#documenten-back').addEventListener('click', () => navigate('logboek'));
  container.querySelector('#documenten-new').addEventListener('click', () => navigate('document-verwerken'));

  const listEl  = container.querySelector('#documenten-list');
  const moreEl  = container.querySelector('#documenten-more');
  const moreBtn = container.querySelector('#documenten-more-btn');

  if (!familyId || accessType !== 'owner') {
    listEl.innerHTML = '<p class="empty-state">Geen toegang.</p>';
    moreEl.hidden = true;
    return;
  }

  let offset = 0;
  let loading = false;

  async function loadPage(reset) {
    if (loading) return;
    loading = true;
    moreBtn.disabled = true;
    moreBtn.textContent = 'Laden…';

    try {
      const imports = await fetchDocumentImports(familyId, { limit: PAGE_SIZE, offset });

      if (reset) listEl.innerHTML = '';

      if (reset && !imports.length) {
        listEl.innerHTML = '<p class="empty-state">Nog geen documenten verwerkt.\nTik op "Nieuw document verwerken" om te beginnen.</p>';
        moreEl.hidden = true;
        return;
      }

      for (const imp of imports) {
        listEl.appendChild(renderImportRow(imp, { onStart: (row) => handleStart(imp, row) }));
      }

      offset += imports.length;
      moreEl.hidden = imports.length < PAGE_SIZE;
    } catch (err) {
      console.error('[ma/documenten] Failed to load imports:', err);
      if (reset) listEl.innerHTML = '<p class="empty-state">Kon de document-inbox niet laden.</p>';
      moreEl.hidden = true;
    } finally {
      loading = false;
      moreBtn.disabled = false;
      moreBtn.textContent = 'Meer laden';
    }
  }

  async function handleStart(imp, rowEl) {
    const btn = rowEl.querySelector('[data-action]');
    if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }
    try {
      await startDocumentProcessing(familyId, imp.id);
    } catch (err) {
      console.error('[ma/documenten] Failed to start processing:', err);
      // The import row's own status (set server-side, e.g. 'failed' with
      // dispatch_failed) is the source of truth — always open the review
      // screen afterward rather than guessing here.
    }
    navigate('document-beoordelen', { id: imp.id });
  }

  moreBtn.addEventListener('click', () => loadPage(false));
  await loadPage(true);
}

function renderImportRow(imp, { onStart }) {
  const row = document.createElement('article');
  row.className = 'trash-row';

  const created = `${formatDayHeader(imp.created_at)} om ${formatTime(imp.created_at)}`;
  const meta = [];
  meta.push(sourceTypeLabel(imp.source_type));
  if (typeof imp.candidate_count === 'number' && ['ready', 'completed'].includes(imp.status)) {
    meta.push(`${imp.candidate_count} ${imp.candidate_count === 1 ? 'voorstel' : 'voorstellen'}`);
  }
  if (imp.input_tokens != null || imp.output_tokens != null) {
    meta.push(`tokens: ${imp.input_tokens ?? '–'} / ${imp.output_tokens ?? '–'}`);
  }

  row.innerHTML = `
    <div class="trash-row-main">
      <span class="entry-type-badge">${escapeHtml(statusLabel(imp.status))}</span>
      <p class="trash-row-preview">${escapeHtml(imp.source_label)}</p>
    </div>
    <p class="dev-row-meta">${escapeHtml(meta.join(' · '))}</p>
    <p class="dev-row-meta">Toegevoegd: ${escapeHtml(created)}</p>
    ${imp.status === 'failed' && imp.error_code ? `<p class="dev-row-meta document-row-error">${escapeHtml(errorMessage(imp.error_code))}</p>` : ''}
    <div class="trash-row-actions" id="document-row-actions"></div>
  `;

  const actionsEl = row.querySelector('#document-row-actions');
  actionsEl.appendChild(renderAction(imp, { onStart }));

  return row;
}

function renderAction(imp, { onStart }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-ghost';

  switch (imp.status) {
    case 'draft':
    case 'uploaded':
      btn.textContent = 'Verwerking starten';
      btn.dataset.action = 'start';
      btn.addEventListener('click', () => onStart(btn.closest('.trash-row')));
      return btn;
    case 'queued':
    case 'processing':
      btn.textContent = 'Voortgang bekijken';
      btn.addEventListener('click', () => navigate('document-beoordelen', { id: imp.id }));
      return btn;
    case 'ready':
      btn.textContent = 'Beoordelen';
      btn.addEventListener('click', () => navigate('document-beoordelen', { id: imp.id }));
      return btn;
    case 'completed':
      btn.textContent = 'Bekijk beoordeling';
      btn.addEventListener('click', () => navigate('document-beoordelen', { id: imp.id }));
      return btn;
    case 'failed':
      btn.textContent = 'Opnieuw proberen';
      btn.dataset.action = 'start';
      btn.addEventListener('click', () => onStart(btn.closest('.trash-row')));
      return btn;
    case 'duplicate':
      btn.textContent = 'Open bestaand document';
      btn.addEventListener('click', () => navigate('document-beoordelen', { id: imp.duplicate_of || imp.id }));
      return btn;
    case 'cancelled':
    default: {
      const span = document.createElement('span');
      span.className = 'dev-row-meta';
      span.textContent = 'Geen actie beschikbaar.';
      return span;
    }
  }
}
