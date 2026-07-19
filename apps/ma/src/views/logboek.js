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
 */

import { fetchLogboekEntries }   from '../api.js';
import { renderLogboekEntry }    from '../components/logboek-entry.js';
import { navigate }              from '../router.js';
import { KIND_FILTERS, AUDIENCE_FILTERS } from '../lib/logboek-types.js';

const PAGE_SIZE = 20;

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, accessType: string|null }} state
 */
export async function mount(container, { familyId, accessType }) {
  const isCareTeam = accessType === 'caregiver';

  container.innerHTML = `
    <div class="view-logboek">
      <div class="view-header">
        <h1>Logboek</h1>
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

  const feedEl  = container.querySelector('#logboek-feed');
  const moreEl  = container.querySelector('#logboek-more');
  const moreBtn = container.querySelector('#logboek-more-btn');

  if (!familyId) {
    feedEl.innerHTML = '<p class="empty-state">Familie niet gevonden.</p>';
    return;
  }

  const filterState = { kind: null, audience: null };
  let offset = 0;
  let loading = false;

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

  moreBtn.addEventListener('click', () => loadPage(false));

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
      });

      if (reset) feedEl.innerHTML = '';

      if (reset && !entries.length) {
        feedEl.innerHTML = '<p class="empty-state">Nog niets in het logboek.\nVoeg de eerste notitie of foto toe.</p>';
        moreEl.hidden = true;
        return;
      }

      for (const entry of entries) {
        feedEl.appendChild(renderLogboekEntry(entry, { showAudienceBadge: !isCareTeam }));
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
