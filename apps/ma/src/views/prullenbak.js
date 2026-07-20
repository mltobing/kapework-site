/**
 * views/prullenbak.js
 *
 * Beheer → Prullenbak — owner-only trash view for soft-deleted Logboek
 * entries. RLS (migration 008) already returns nothing here for a non-owner;
 * the route itself is also owner-only (ROUTE_ACCESS in main.js), matching the
 * same double-enforcement pattern as Apparaten/Beheer.
 *
 * Reached from a link on Beheer's "Prullenbak" summary card, not the bottom
 * nav — same pattern as Apparaten.
 */

import { fetchTrashedLogboekEntries, restoreLogboekEntry, permanentlyDeleteLogboekEntry } from '../api.js';
import { escapeHtml } from '../utils.js';
import { navigate } from '../router.js';
import { formatDayHeader, formatTime, formatRelativeNl } from '../lib/datetime.js';
import { kindLabel } from '../lib/logboek-types.js';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, accessType: string|null }} state
 */
export async function mount(container, { familyId, accessType }) {
  container.innerHTML = `
    <div class="view-prullenbak">
      <div class="view-header view-header--back">
        <button class="dev-back" id="prullenbak-back" aria-label="Terug">‹ Terug</button>
        <h1>Prullenbak</h1>
      </div>
      <div class="dev-body">
        <p class="dev-intro">
          Verwijderde logboekregels blijven hier ongeveer 30 dagen staan voor je ze terugzet
          of definitief verwijdert.
        </p>
        <input
          type="search" class="logboek-search-input" id="prullenbak-search"
          placeholder="Zoeken in de prullenbak…" aria-label="Zoeken in de prullenbak"
        >
        <div id="prullenbak-list"><div class="section-loading">Laden…</div></div>
        <div class="feed-more" id="prullenbak-more" hidden>
          <button class="btn-ghost" id="prullenbak-more-btn">Meer laden</button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#prullenbak-back').addEventListener('click', () => navigate('beheer'));

  const listEl   = container.querySelector('#prullenbak-list');
  const moreEl   = container.querySelector('#prullenbak-more');
  const moreBtn  = container.querySelector('#prullenbak-more-btn');
  const searchEl = container.querySelector('#prullenbak-search');

  if (!familyId || accessType !== 'owner') {
    listEl.innerHTML = '<p class="empty-state">Geen toegang.</p>';
    moreEl.hidden = true;
    searchEl.hidden = true;
    return;
  }

  let offset = 0;
  let loading = false;
  let search = null;

  async function reload() {
    offset = 0;
    listEl.innerHTML = '<div class="section-loading">Laden…</div>';
    moreEl.hidden = true;
    await loadPage(true);
  }

  async function loadPage(reset) {
    if (loading) return;
    loading = true;
    moreBtn.disabled = true;
    moreBtn.textContent = 'Laden…';

    try {
      const entries = await fetchTrashedLogboekEntries(familyId, { limit: PAGE_SIZE, offset, search });

      if (reset) listEl.innerHTML = '';

      if (reset && !entries.length) {
        listEl.innerHTML = search
          ? '<p class="empty-state">Geen logboekitems gevonden.\nPas uw zoekopdracht aan.</p>'
          : '<p class="empty-state">De prullenbak is leeg.</p>';
        moreEl.hidden = true;
        return;
      }

      for (const entry of entries) {
        listEl.appendChild(renderTrashRow(entry, { onRestore, onPermanentDelete }));
      }

      offset += entries.length;
      moreEl.hidden = entries.length < PAGE_SIZE;
    } catch (err) {
      console.error('[ma/prullenbak] Failed to load trashed entries:', err);
      if (reset) listEl.innerHTML = '<p class="empty-state">Kon de prullenbak niet laden.</p>';
      moreEl.hidden = true;
    } finally {
      loading = false;
      moreBtn.disabled = false;
      moreBtn.textContent = 'Meer laden';
    }
  }

  let debounceTimer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      search = searchEl.value.trim() || null;
      reload();
    }, SEARCH_DEBOUNCE_MS);
  });

  moreBtn.addEventListener('click', () => loadPage(false));

  async function onRestore(entry, rowEl) {
    rowEl.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const ok = await restoreLogboekEntry(entry.id);
      if (!ok) throw new Error('not_restored');
      rowEl.remove();
      if (!listEl.children.length) {
        listEl.innerHTML = '<p class="empty-state">De prullenbak is leeg.</p>';
      }
    } catch (err) {
      console.error('[ma/prullenbak] Restore failed:', err);
      rowEl.querySelectorAll('button').forEach(b => b.disabled = false);
      window.alert('Kon niet terugzetten. Probeer het opnieuw.');
    }
  }

  async function onPermanentDelete(entry, rowEl) {
    if (!window.confirm('Deze logboekregel definitief verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
    if (!window.confirm('Weet je het zeker? De inhoud is dan echt weg.')) return;

    rowEl.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const ok = await permanentlyDeleteLogboekEntry(entry.id);
      if (!ok) throw new Error('not_deleted');
      rowEl.remove();
      if (!listEl.children.length) {
        listEl.innerHTML = '<p class="empty-state">De prullenbak is leeg.</p>';
      }
    } catch (err) {
      console.error('[ma/prullenbak] Permanent delete failed:', err);
      rowEl.querySelectorAll('button').forEach(b => b.disabled = false);
      window.alert('Kon niet definitief verwijderen. Probeer het opnieuw.');
    }
  }

  await loadPage(true);
}

function renderTrashRow(entry, { onRestore, onPermanentDelete }) {
  const row = document.createElement('article');
  row.className = 'trash-row';

  const preview = entry.title || entry.body || kindLabel(entry.kind);
  const authorName    = entry.author?.display_name  || 'Onbekend';
  const deletedByName = entry.deleter?.display_name || 'Onbekend';

  row.innerHTML = `
    <div class="trash-row-main">
      <span class="entry-type-badge">${escapeHtml(kindLabel(entry.kind))}</span>
      <p class="trash-row-preview">${escapeHtml(truncate(preview, 140))}</p>
    </div>
    <p class="dev-row-meta">Auteur: ${escapeHtml(authorName)}</p>
    <p class="dev-row-meta">
      Verwijderd: ${escapeHtml(formatDayHeader(entry.deleted_at))} om ${escapeHtml(formatTime(entry.deleted_at))}
      (${escapeHtml(formatRelativeNl(entry.deleted_at))}) door ${escapeHtml(deletedByName)}
    </p>
    <div class="trash-row-actions">
      <button type="button" class="btn-ghost" data-action="restore">Herstellen</button>
      <button type="button" class="btn-ghost trash-row-danger" data-action="delete">Definitief verwijderen</button>
    </div>
  `;

  row.querySelector('[data-action="restore"]').addEventListener('click', () => onRestore(entry, row));
  row.querySelector('[data-action="delete"]').addEventListener('click', () => onPermanentDelete(entry, row));

  return row;
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
