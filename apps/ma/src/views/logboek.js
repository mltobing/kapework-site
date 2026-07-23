/**
 * views/logboek.js
 *
 * The Logboek tab — a chronological, filterable timeline of family notes,
 * photos, documents, observations and appointment reports. Replaces the old
 * separate Family and Photos tabs; "Foto's" is now a filter chip here, not
 * a second top-level destination.
 *
 * Care-team users see the same timeline, but RLS already limits them to
 * `audience = 'care_team'` entries, so no audience filter is shown to them.
 *
 * Loads incrementally ("Meer laden") rather than fetching the whole archive.
 * An entry's own author may edit or trash it; the family owner may also
 * trash (but not edit) anyone's entry — see components/logboek-entry.js.
 */

import { fetchLogboekEntries, fetchLogboekAuthors, softDeleteLogboekEntry, restoreLogboekEntry } from '../api.js';
import { renderLogboekEntry }    from '../components/logboek-entry.js';
import { openLogboekEditModal }  from '../components/logboek-edit-modal.js';
import { showToast }             from '../components/toast.js';
import { navigate }              from '../router.js';
import { KIND_FILTERS, AUDIENCE_FILTERS } from '../lib/logboek-types.js';
import { validateSortOption }    from '../lib/document-inbox.js';

const SORT_OPTIONS = [
  { sort: 'event_date', label: 'Datum gebeurtenis' },
  { sort: 'created_at', label: 'Recent toegevoegd' },
];

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, accessType: string|null, user: object|null }} state
 */
export async function mount(container, { familyId, accessType, user }) {
  const isCareTeam = accessType === 'caregiver';
  const isOwner    = accessType === 'owner';
  const currentUserId = user?.id ?? null;

  container.innerHTML = `
    <div class="view-logboek">
      <div class="view-header">
        <h1>Logboek</h1>
        ${isOwner ? `
          <div class="logboek-header-actions">
            <button type="button" class="btn-ghost" id="logboek-documents-new">Documenten verwerken</button>
            <button type="button" class="btn-ghost logboek-documents-link" id="logboek-documents-inbox">Document-inbox</button>
          </div>
        ` : ''}
      </div>

      <div class="logboek-search-row">
        <input
          type="search" class="logboek-search-input" id="logboek-search"
          placeholder="Zoeken in het logboek…" aria-label="Zoeken in het logboek"
        >
        <button type="button" class="btn-ghost logboek-filters-toggle" id="logboek-filters-toggle" aria-expanded="false">
          Filters
        </button>
      </div>

      <div class="logboek-filters-panel" id="logboek-filters-panel" hidden>
        <div class="compose-field">
          <label class="compose-label" for="logboek-filter-author">Auteur</label>
          <select class="compose-title" id="logboek-filter-author">
            <option value="">Alle auteurs</option>
          </select>
        </div>
        <div class="logboek-filter-dates">
          <div class="compose-field">
            <label class="compose-label" for="logboek-filter-from">Van</label>
            <input class="compose-date" id="logboek-filter-from" type="date">
          </div>
          <div class="compose-field">
            <label class="compose-label" for="logboek-filter-to">Tot</label>
            <input class="compose-date" id="logboek-filter-to" type="date">
          </div>
        </div>
        <button type="button" class="btn-ghost" id="logboek-filters-reset">Wis filters</button>
      </div>

      <div class="logboek-sort-row">
        <span class="logboek-sort-label">Sorteren:</span>
        <div class="filter-row" id="logboek-sort" role="tablist" aria-label="Sorteren"></div>
      </div>

      <div class="filter-row" id="filter-kind" role="tablist" aria-label="Filter op type"></div>
      ${isCareTeam ? '' : '<div class="filter-row filter-row--chips" id="filter-audience" role="tablist" aria-label="Filter op zichtbaarheid"></div>'}

      <div class="feed-list" id="logboek-feed">
        <div class="section-loading">Laden…</div>
      </div>
      <div class="feed-more" id="logboek-more" hidden>
        <button class="btn-ghost" id="logboek-more-btn">Meer laden</button>
      </div>

      <button class="fab" id="compose-fab" aria-label="Nieuwe logboekregel">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;

  container.querySelector('#compose-fab')
    .addEventListener('click', () => navigate('compose'));

  if (isOwner) {
    container.querySelector('#logboek-documents-new')
      .addEventListener('click', () => navigate('document-verwerken'));
    container.querySelector('#logboek-documents-inbox')
      .addEventListener('click', () => navigate('documenten'));
  }

  const feedEl  = container.querySelector('#logboek-feed');
  const moreEl  = container.querySelector('#logboek-more');
  const moreBtn = container.querySelector('#logboek-more-btn');

  if (!familyId) {
    feedEl.innerHTML = '<p class="empty-state">Familie niet gevonden.</p>';
    return;
  }

  const filterState = {
    kind: null, audience: null, authorId: null, search: null, dateFrom: null, dateTo: null,
    sort: validateSortOption('event_date'),
  };
  let offset = 0;
  let loading = false;

  renderSortChips(container.querySelector('#logboek-sort'), filterState.sort, (sort) => {
    filterState.sort = validateSortOption(sort);
    reload();
  });

  renderKindChips(container.querySelector('#filter-kind'), filterState.kind, (kind) => {
    filterState.kind = kind;
    reload();
  });

  const audienceEl = container.querySelector('#filter-audience');
  if (audienceEl) {
    renderAudienceChips(audienceEl, filterState.audience, (audience) => {
      filterState.audience = audience;
      reload();
    });
  }

  // ── Search + filters ────────────────────────────────────────────────────
  const searchInput  = container.querySelector('#logboek-search');
  const filtersToggle = container.querySelector('#logboek-filters-toggle');
  const filtersPanel  = container.querySelector('#logboek-filters-panel');
  const authorSelect  = container.querySelector('#logboek-filter-author');
  const fromInput     = container.querySelector('#logboek-filter-from');
  const toInput        = container.querySelector('#logboek-filter-to');
  const resetBtn       = container.querySelector('#logboek-filters-reset');

  let searchDebounceTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      filterState.search = searchInput.value.trim() || null;
      reload();
    }, SEARCH_DEBOUNCE_MS);
  });

  filtersToggle.addEventListener('click', () => {
    const expanded = filtersToggle.getAttribute('aria-expanded') === 'true';
    filtersToggle.setAttribute('aria-expanded', String(!expanded));
    filtersPanel.hidden = expanded;
  });

  authorSelect.addEventListener('change', () => {
    filterState.authorId = authorSelect.value || null;
    reload();
  });
  fromInput.addEventListener('change', () => {
    filterState.dateFrom = fromInput.value || null;
    reload();
  });
  toInput.addEventListener('change', () => {
    filterState.dateTo = toInput.value || null;
    reload();
  });
  resetBtn.addEventListener('click', () => {
    searchInput.value = '';
    authorSelect.value = '';
    fromInput.value = '';
    toInput.value = '';
    Object.assign(filterState, { authorId: null, search: null, dateFrom: null, dateTo: null });
    reload();
  });

  fetchLogboekAuthors(familyId)
    .then(authors => {
      for (const a of authors) {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.displayName;
        authorSelect.appendChild(opt);
      }
    })
    .catch(err => console.error('[ma/logboek] Failed to load author filter list:', err));

  moreBtn.addEventListener('click', () => loadPage(false));

  function entryOpts() {
    return {
      showAudienceBadge: !isCareTeam,
      currentUserId,
      isOwner,
      onEdit: handleEdit,
      onDelete: handleDelete,
    };
  }

  function handleEdit(entry) {
    openLogboekEditModal(entry, currentUserId, (updated) => {
      const existing = feedEl.querySelector(`[data-entry-id="${CSS.escape(entry.id)}"]`);
      const merged = { ...entry, ...updated };
      const freshCard = renderLogboekEntry(merged, entryOpts());
      if (existing) existing.replaceWith(freshCard);
    });
  }

  async function handleDelete(entry) {
    if (!window.confirm('Deze notitie naar de prullenbak verplaatsen?')) return;

    const cardEl = feedEl.querySelector(`[data-entry-id="${CSS.escape(entry.id)}"]`);
    const parent = cardEl?.parentElement ?? feedEl;
    const nextSibling = cardEl?.nextSibling ?? null;

    let ok = false;
    try {
      ok = await softDeleteLogboekEntry(entry.id);
    } catch (err) {
      console.error('[ma/logboek] Failed to move entry to trash:', err);
      window.alert('Kon de notitie niet verwijderen. Probeer het opnieuw.');
      return;
    }
    if (!ok) {
      window.alert('Kon de notitie niet verwijderen. Probeer het opnieuw.');
      return;
    }

    cardEl?.remove();
    if (!feedEl.children.length) {
      feedEl.innerHTML = '<p class="empty-state">Geen logboekitems gevonden.\nPas uw zoekopdracht of filters aan.</p>';
    }

    showToast('Deze notitie is naar de prullenbak verplaatst.', {
      actionLabel: 'Ongedaan maken',
      onAction: async () => {
        let restored = false;
        try {
          restored = await restoreLogboekEntry(entry.id);
        } catch (err) {
          console.error('[ma/logboek] Failed to restore entry:', err);
          window.alert('Kon niet ongedaan maken. Ververs de pagina.');
          return;
        }
        if (!restored) {
          window.alert('Kon niet ongedaan maken. Ververs de pagina.');
          return;
        }
        feedEl.querySelector('.empty-state')?.remove();
        const restoredCard = renderLogboekEntry(entry, entryOpts());
        if (nextSibling && nextSibling.parentElement === parent) {
          parent.insertBefore(restoredCard, nextSibling);
        } else {
          parent.appendChild(restoredCard);
        }
      },
    });
  }

  async function reload() {
    offset = 0;
    feedEl.innerHTML = '<div class="section-loading">Laden…</div>';
    moreEl.hidden = true;
    await loadPage(true);
  }

  async function loadPage(reset) {
    if (loading) return;
    loading = true;
    moreBtn.disabled = true;
    moreBtn.textContent = 'Laden…';

    try {
      const entries = await fetchLogboekEntries(familyId, {
        limit: PAGE_SIZE,
        offset,
        kind: filterState.kind,
        audience: filterState.audience,
        authorId: filterState.authorId,
        search: filterState.search,
        dateFrom: filterState.dateFrom,
        dateTo: filterState.dateTo,
        sort: filterState.sort,
      });

      if (reset) feedEl.innerHTML = '';

      if (reset && !entries.length) {
        const hasFilters = filterState.kind || filterState.audience || filterState.authorId
          || filterState.search || filterState.dateFrom || filterState.dateTo;
        feedEl.innerHTML = hasFilters
          ? '<p class="empty-state">Geen logboekitems gevonden.\nPas uw zoekopdracht of filters aan.</p>'
          : '<p class="empty-state">Nog niets in het logboek.\nVoeg de eerste notitie of foto toe.</p>';
        moreEl.hidden = true;
        return;
      }

      for (const entry of entries) {
        feedEl.appendChild(renderLogboekEntry(entry, entryOpts()));
      }

      offset += entries.length;
      moreEl.hidden = entries.length < PAGE_SIZE;
    } catch (err) {
      console.error('[ma/logboek] Failed to load entries:', err);
      if (reset) feedEl.innerHTML = '<p class="empty-state">Kon het logboek niet laden. Probeer het opnieuw.</p>';
      moreEl.hidden = true;
    } finally {
      loading = false;
      moreBtn.disabled = false;
      moreBtn.textContent = 'Meer laden';
    }
  }

  await loadPage(true);
}

function renderSortChips(container, active, onSelect) {
  container.innerHTML = SORT_OPTIONS.map((o) => `
    <button class="filter-chip ${o.sort === active ? 'filter-chip--active' : ''}" data-sort="${o.sort}">
      ${o.label}
    </button>
  `).join('');

  container.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('filter-chip--active'));
      btn.classList.add('filter-chip--active');
      onSelect(btn.dataset.sort);
    });
  });
}

function renderKindChips(container, active, onSelect) {
  container.innerHTML = KIND_FILTERS.map(f => `
    <button class="filter-chip ${f.kind === active ? 'filter-chip--active' : ''}" data-kind="${f.kind ?? ''}">
      ${f.label}
    </button>
  `).join('');

  container.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('filter-chip--active'));
      btn.classList.add('filter-chip--active');
      onSelect(btn.dataset.kind || null);
    });
  });
}

function renderAudienceChips(container, active, onSelect) {
  container.innerHTML = AUDIENCE_FILTERS.map(f => `
    <button class="filter-chip ${f.audience === active ? 'filter-chip--active' : ''}" data-audience="${f.audience ?? ''}">
      ${f.label}
    </button>
  `).join('');

  container.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('filter-chip--active'));
      btn.classList.add('filter-chip--active');
      onSelect(btn.dataset.audience || null);
    });
  });
}
