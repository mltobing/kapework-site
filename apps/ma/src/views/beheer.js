/**
 * views/beheer.js
 *
 * The Beheer tab — owner-only admin dashboard. Answers, in strict order:
 *   1. Systeemstatus     — four independently-loaded health cards
 *   2. Recente activiteit — owner-only append-only activity timeline
 *   3. Mensen en toegang  — family + care-team roster (read-only in this PR)
 *   4. Apparaten          — compact trusted-device summary + link
 *
 * This is a first-party operational audit, not analytics and not a
 * surveillance feed: no route views, scrolls, photo opens, or keystrokes are
 * ever recorded — see apps/ma/README.md.
 */

import {
  fetchLatestIntegrationRun, fetchCalendarSourceAdminStatus, fetchTomorrowBriefingAdminStatus,
  fetchRideNoticeAdminSummary, fetchAdminActivity, fetchAdminRoster, fetchTrashedLogboekCount,
} from '../api.js';
import { listDevices } from '../lib/devices-api.js';
import { triggerManualSync } from '../lib/sync-api.js';
import { escapeHtml, getInitial } from '../utils.js';
import { formatDayHeader, formatTime, formatRelativeNl } from '../lib/datetime.js';
import {
  actorLabel, activitySentence, activityIcon, activityBucket, buildRosterLookup,
} from '../lib/admin-activity.js';
import { computeAgendaHealth, computeBriefingHealth, computeNoticesHealth } from '../lib/beheer-health.js';
import { navigate } from '../router.js';

const ACTIVITY_PAGE_SIZE = 30;

const ACCESS_TYPE_BADGES = { owner: 'Eigenaar', member: 'Familie', caregiver: 'Zorgteam' };

const ACTIVITY_FILTERS = [
  { bucket: null,        label: 'Alles' },
  { bucket: 'family',    label: 'Familie' },
  { bucket: 'care_team', label: 'Zorgteam' },
  { bucket: 'system',    label: 'Systeem' },
];

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null, accessType: string|null }} state
 */
export async function mount(container, { familyId, accessType }) {
  container.innerHTML = `
    <div class="view-beheer">
      <div class="view-header">
        <h1>Beheer</h1>
      </div>

      <section class="beheer-section">
        <h2 class="section-title">Systeemstatus</h2>
        <div class="beheer-cards">
          <div class="beheer-card" id="card-agenda"><div class="section-loading">Laden…</div></div>
          <div class="beheer-card" id="card-briefing"><div class="section-loading">Laden…</div></div>
          <div class="beheer-card" id="card-notices"><div class="section-loading">Laden…</div></div>
          <div class="beheer-card" id="card-devices"><div class="section-loading">Laden…</div></div>
        </div>
      </section>

      <section class="beheer-section">
        <h2 class="section-title">Recente activiteit</h2>
        <div class="filter-row" id="activity-filters"></div>
        <div id="activity-list"><div class="section-loading">Laden…</div></div>
        <div class="feed-more" id="activity-more" hidden>
          <button class="btn-ghost" id="activity-more-btn">Meer laden</button>
        </div>
      </section>

      <section class="beheer-section">
        <h2 class="section-title">Mensen en toegang</h2>
        <div id="roster-list"><div class="section-loading">Laden…</div></div>
      </section>

      <section class="beheer-section">
        <h2 class="section-title">Apparaten</h2>
        <div id="devices-summary"><div class="section-loading">Laden…</div></div>
      </section>

      <section class="beheer-section">
        <h2 class="section-title">Prullenbak</h2>
        <div id="prullenbak-summary"><div class="section-loading">Laden…</div></div>
      </section>
    </div>
  `;

  if (!familyId || accessType !== 'owner') {
    container.innerHTML = '<p class="empty-state">Geen toegang.</p>';
    return;
  }

  // Devices are read once and shared by the Systeemstatus card and the
  // Apparaten section below, rather than fetched twice.
  let devices = null;
  try {
    devices = await listDevices(familyId);
  } catch (err) {
    console.error('[ma/beheer] Failed to load devices:', err);
  }

  await Promise.allSettled([
    mountAgendaCard(container.querySelector('#card-agenda'), familyId),
    mountBriefingCard(container.querySelector('#card-briefing'), familyId),
    mountNoticesCard(container.querySelector('#card-notices'), familyId),
    mountDevicesCard(container.querySelector('#card-devices'), devices),
  ]);

  mountDevicesSummary(container.querySelector('#devices-summary'), devices);
  mountActivityTimeline(container, familyId);
  mountRoster(container.querySelector('#roster-list'), familyId);
  mountPrullenbakSummary(container.querySelector('#prullenbak-summary'), familyId);
}

// ─── Health helpers ──────────────────────────────────────────────────────────

function healthBadge(level, text) {
  return `<span class="beheer-health beheer-health--${level}">${escapeHtml(text)}</span>`;
}

// ─── Card: Agenda-synchronisatie (status + owner-only manual refresh) ────────
// Approximately how often the automatic cycle runs — used only to show an
// honest, clearly-approximate "next scheduled sync" time (this repo doesn't
// own the schedule itself; see supabase-migrations/009_ma_calendar_manual_sync.sql).
const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 60_000;
// How long to poll ma_integration_runs after a manual request before giving
// up and showing a "this can take a few minutes" message instead of a result.
const SYNC_POLL_TIMEOUT_MS = 90_000;
const SYNC_POLL_INTERVAL_MS = 4000;
const SYNC_COOLDOWN_TICK_MS = 1000;

async function mountAgendaCard(el, familyId) {
  el.innerHTML = '<h3 class="beheer-card-title">Agenda-synchronisatie</h3><div class="section-loading">Laden…</div>';
  await refreshAgendaCard(el, familyId);
}

async function refreshAgendaCard(el, familyId) {
  let run = null;
  let source = null;
  try {
    [run, source] = await Promise.all([
      fetchLatestIntegrationRun(familyId),
      fetchCalendarSourceAdminStatus(familyId),
    ]);
  } catch (err) {
    console.error('[ma/beheer] Agenda card failed:', err);
    el.innerHTML = '<h3 class="beheer-card-title">Agenda-synchronisatie</h3><p class="empty-state">Kon dit niet laden.</p>';
    return;
  }
  renderAgendaCard(el, familyId, run, source);
}

function renderAgendaCard(el, familyId, run, source) {
  const lastSyncedAt = source?.last_synced_at ?? null;
  const { level, reason } = computeAgendaHealth(run, source);

  const LEVEL_LABEL = { neutral: reason === 'running' ? 'Bezig' : 'Geen gegevens', green: 'In orde', amber: 'Controleren', red: 'Aandacht nodig' };
  const AGENDA_TEXT = {
    no_data:      'Nog geen gegevens.',
    running:      'Bezig met bijwerken…',
    disagreement: 'Controleren — bronnen spreken elkaar tegen.',
    run_failed:   'De agenda kon niet worden bijgewerkt.',
    fresh:        'Agenda is bijgewerkt.',
    stale:        'Agenda is bijgewerkt.',
    very_stale:   'De agenda kon niet worden bijgewerkt.',
  };
  const statusText = AGENDA_TEXT[reason];
  const isFailure = reason === 'run_failed' || reason === 'very_stale';

  const sourceLine = source?.label
    ? `<p class="beheer-card-line beheer-card-line--muted">Bron: ${escapeHtml(source.label)}</p>` : '';
  const lastSuccessLine = lastSyncedAt
    ? `<p class="beheer-card-line beheer-card-line--muted">${isFailure ? 'Laatst betrouwbare gegevens' : 'Laatst succesvol bijgewerkt'}: ${escapeHtml(formatDayHeader(lastSyncedAt))} om ${escapeHtml(formatTime(lastSyncedAt))}</p>`
    : '';
  const lastAttemptLine = run?.started_at
    ? `<p class="beheer-card-line beheer-card-line--muted">Laatste synchronisatiepoging: ${escapeHtml(formatDayHeader(run.started_at))} om ${escapeHtml(formatTime(run.started_at))}</p>`
    : '';
  const nextSyncLine = lastSyncedAt
    ? `<p class="beheer-card-line beheer-card-line--muted">Volgende automatische synchronisatie rond ${escapeHtml(formatTime(new Date(new Date(lastSyncedAt).getTime() + AUTO_SYNC_INTERVAL_MS)))}</p>`
    : '';
  const errorLine = (run?.calendar_status === 'failed' && run?.error_stage)
    ? `<p class="beheer-card-line beheer-card-line--muted">Foutmelding: ${escapeHtml(run.error_stage)}</p>` : '';
  const countsLine = run ? countsLineHtml(run) : '';

  el.innerHTML = `
    <h3 class="beheer-card-title">Agenda-synchronisatie</h3>
    ${healthBadge(level, LEVEL_LABEL[level] ?? level)}
    <p class="beheer-card-line">${escapeHtml(statusText)}</p>
    ${sourceLine}
    ${lastSuccessLine}
    ${lastAttemptLine}
    ${reason !== 'running' ? nextSyncLine : ''}
    ${errorLine}
    ${countsLine}
    <div class="sync-actions">
      <button type="button" class="btn-primary" id="sync-trigger-btn">Agenda nu bijwerken</button>
      <p class="sync-trigger-help">Haalt de nieuwste afspraken op uit de gekoppelde kalender. De automatische synchronisatie blijft actief.</p>
      <p class="sync-trigger-status" id="sync-trigger-status" hidden></p>
    </div>
  `;

  wireSyncTrigger(el, familyId, { alreadyRunning: reason === 'running' });
}

function countsLineHtml(run) {
  const parts = [`${run.events_seen} afspraken bekeken`];
  if (run.events_created)   parts.push(`${run.events_created} nieuw`);
  if (run.events_updated)   parts.push(`${run.events_updated} gewijzigd`);
  if (run.events_cancelled) parts.push(`${run.events_cancelled} geannuleerd`);
  return `<p class="beheer-card-line beheer-card-line--muted">${escapeHtml(parts.join(' · '))}</p>`;
}

// ─── Owner-only manual sync trigger ────────────────────────────────────────

function wireSyncTrigger(el, familyId, { alreadyRunning }) {
  const btn    = el.querySelector('#sync-trigger-btn');
  const status = el.querySelector('#sync-trigger-status');

  function showStatus(text) {
    status.textContent = text;
    status.hidden = false;
  }

  if (alreadyRunning) {
    btn.disabled = true;
    btn.textContent = 'Bezig met bijwerken…';
    pollForCompletion(el, familyId, new Date());
    return;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Bezig met bijwerken…';
    status.hidden = true;

    const requestedAt = new Date();
    let result;
    try {
      result = await triggerManualSync(familyId);
    } catch (err) {
      console.error('[ma/beheer] Manual sync trigger failed:', err);
      btn.disabled = false;
      btn.textContent = 'Agenda nu bijwerken';
      showStatus('Kon niet bijwerken. Probeer het opnieuw.');
      return;
    }

    if (result.status === 'cooldown') {
      showStatus('Net bijgewerkt.');
      startCooldownCountdown(btn, result.retryAfterSeconds || 60);
      return;
    }

    if (result.status === 'already_running' || result.status === 'queued') {
      showStatus('Bezig met bijwerken…');
      pollForCompletion(el, familyId, requestedAt);
      return;
    }
  });
}

function startCooldownCountdown(btn, seconds) {
  let remaining = seconds;
  btn.textContent = `Opnieuw over ${remaining}s`;
  const timer = setInterval(() => {
    if (!btn.isConnected) { clearInterval(timer); return; }
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = 'Agenda nu bijwerken';
    } else {
      btn.textContent = `Opnieuw over ${remaining}s`;
    }
  }, SYNC_COOLDOWN_TICK_MS);
}

/**
 * Polls the family's latest integration run until one that started at/after
 * `requestedAt` finishes, or SYNC_POLL_TIMEOUT_MS elapses. Re-renders the
 * whole card on completion so status/badge/counts/next-sync all update
 * without a full page refresh. Never throws — a poll failure just stops
 * polling silently (the card still updates next time Beheer loads).
 */
function pollForCompletion(el, familyId, requestedAt) {
  const deadline = Date.now() + SYNC_POLL_TIMEOUT_MS;
  const status = el.querySelector('#sync-trigger-status');

  async function tick() {
    if (!el.isConnected) return; // view was left — stop polling
    if (Date.now() > deadline) {
      if (status) { status.textContent = 'Verzoek verzonden. Dit kan een paar minuten duren.'; status.hidden = false; }
      const btn = el.querySelector('#sync-trigger-btn');
      if (btn) { btn.disabled = false; btn.textContent = 'Agenda nu bijwerken'; }
      return;
    }

    let run = null;
    try {
      run = await fetchLatestIntegrationRun(familyId);
    } catch (err) {
      console.error('[ma/beheer] Poll for sync completion failed:', err);
      return;
    }

    const startedAfterRequest = run?.started_at && new Date(run.started_at) >= requestedAt;
    if (startedAfterRequest && run.finished_at) {
      const total = (run.events_created || 0) + (run.events_updated || 0) + (run.events_cancelled || 0);
      const summary = total === 0
        ? 'Agenda is al actueel.'
        : `Agenda bijgewerkt: ${[
            run.events_updated ? `${run.events_updated} gewijzigd` : null,
            run.events_created ? `${run.events_created} toegevoegd` : null,
            run.events_cancelled ? `${run.events_cancelled} geannuleerd` : null,
          ].filter(Boolean).join(', ')}.`;

      let source = null;
      try { source = await fetchCalendarSourceAdminStatus(familyId); } catch { /* card still renders without it */ }
      renderAgendaCard(el, familyId, run, source);
      const freshStatus = el.querySelector('#sync-trigger-status');
      if (freshStatus) { freshStatus.textContent = summary; freshStatus.hidden = false; }
      return;
    }

    setTimeout(tick, SYNC_POLL_INTERVAL_MS);
  }

  setTimeout(tick, SYNC_POLL_INTERVAL_MS);
}

// ─── Card: Briefings ───────────────────────────────────────────────────────────

async function mountBriefingCard(el, familyId) {
  el.innerHTML = '<h3 class="beheer-card-title">Briefings</h3><div class="section-loading">Laden…</div>';
  let briefing = null;
  try {
    briefing = await fetchTomorrowBriefingAdminStatus(familyId);
  } catch (err) {
    console.error('[ma/beheer] Briefing card failed:', err);
    el.innerHTML = '<h3 class="beheer-card-title">Briefings</h3><p class="empty-state">Kon dit niet laden.</p>';
    return;
  }

  const { level, reason } = computeBriefingHealth(briefing);

  const BRIEFING_TEXT = {
    missing_after_17:        'Nog geen briefing voor morgen.',
    not_yet_due:              'Nog geen briefing voor morgen — kan nog komen.',
    changed_after_sent:       'Verzonden, maar de agenda is daarna gewijzigd.',
    sent: briefing?.sent_at
      ? `Verzonden ${formatRelativeNl(briefing.sent_at)}${briefing.ma_profiles?.display_name ? ` door ${briefing.ma_profiles.display_name}` : ''}`
      : 'Verzonden.',
    ready_not_sent_after_18: 'Klaar, nog niet verzonden.',
    ready_earlier:           'Klaar voor vanavond.',
  };
  const statusText = BRIEFING_TEXT[reason];

  const LEVEL_LABEL = { neutral: 'Geen actie nodig', green: 'Verzonden', amber: 'Controleren', red: 'Aandacht nodig' };

  el.innerHTML = `
    <h3 class="beheer-card-title">Briefings</h3>
    ${healthBadge(level, LEVEL_LABEL[level] ?? level)}
    <p class="beheer-card-line">${escapeHtml(statusText)}</p>
    <button class="btn-ghost beheer-card-link" id="briefing-card-link">Naar Briefing</button>
  `;
  el.querySelector('#briefing-card-link').addEventListener('click', () => navigate('briefing'));
}

// ─── Card: AutoMaatje / ride mail ───────────────────────────────────────────────

async function mountNoticesCard(el, familyId) {
  el.innerHTML = '<h3 class="beheer-card-title">AutoMaatje</h3><div class="section-loading">Laden…</div>';
  let run = null;
  let summary = null;
  try {
    [run, summary] = await Promise.all([
      fetchLatestIntegrationRun(familyId),
      fetchRideNoticeAdminSummary(familyId),
    ]);
  } catch (err) {
    console.error('[ma/beheer] AutoMaatje card failed:', err);
    el.innerHTML = '<h3 class="beheer-card-title">AutoMaatje</h3><p class="empty-state">Kon dit niet laden.</p>';
    return;
  }

  const { level, reason } = computeNoticesHealth(run, summary);

  const NOTICES_TEXT = {
    no_data:             'Nog geen gegevens.',
    disabled:            'Uitgeschakeld.',
    check_failed:        'Laatste controle mislukt.',
    misconfigured:       'Verkeerd geconfigureerd.',
    open_discrepancies:  `${summary.openCount} openstaande ${summary.openCount === 1 ? 'melding' : 'meldingen'}`,
    clean:               'Gecontroleerd, niets openstaand.',
  };
  const statusText = NOTICES_TEXT[reason];

  const seenLine = run
    ? `<p class="beheer-card-line beheer-card-line--muted">${escapeHtml(`${run.mail_messages_seen} berichten gezien · ${run.mail_extract_calls} keer geanalyseerd`)}</p>`
    : '';
  const newestLine = summary?.newestReceivedAt
    ? `<p class="beheer-card-line beheer-card-line--muted">Nieuwste melding ${escapeHtml(formatRelativeNl(summary.newestReceivedAt))}</p>`
    : '';

  el.innerHTML = `
    <h3 class="beheer-card-title">AutoMaatje</h3>
    ${healthBadge(level, level === 'neutral' ? 'Uitgeschakeld' : level === 'green' ? 'In orde' : level === 'amber' ? 'Controleren' : 'Aandacht nodig')}
    <p class="beheer-card-line">${escapeHtml(statusText)}</p>
    ${seenLine}
    ${newestLine}
    ${summary?.openCount > 0 ? '<button class="btn-ghost beheer-card-link" id="notices-card-link">Naar Vandaag</button>' : ''}
  `;
  el.querySelector('#notices-card-link')?.addEventListener('click', () => navigate('today'));
}

// ─── Card: Vertrouwde apparaten ─────────────────────────────────────────────────

function deviceIsActive(d) {
  return !d.revoked_at && new Date(d.expires_at) > new Date();
}

async function mountDevicesCard(el, devices) {
  el.innerHTML = '<h3 class="beheer-card-title">Vertrouwde apparaten</h3><div class="section-loading">Laden…</div>';
  if (devices === null) {
    el.innerHTML = '<h3 class="beheer-card-title">Vertrouwde apparaten</h3><p class="empty-state">Kon dit niet laden.</p>';
    return;
  }

  const active  = devices.filter(deviceIsActive);
  const revoked = devices.filter(d => d.revoked_at);

  const rows = active.map(d => `
    <div class="beheer-device-row">
      <span class="beheer-device-label">${escapeHtml(d.label)}</span>
      <span class="beheer-device-meta">${d.last_seen_at ? `Laatst gezien ${escapeHtml(formatRelativeNl(d.last_seen_at))}` : 'Nog niet gebruikt'}</span>
    </div>
  `).join('');

  el.innerHTML = `
    <h3 class="beheer-card-title">Vertrouwde apparaten</h3>
    ${healthBadge('neutral', `${active.length} actief${revoked.length ? ` · ${revoked.length} ingetrokken` : ''}`)}
    ${rows || '<p class="beheer-card-line beheer-card-line--muted">Nog geen apparaten gekoppeld.</p>'}
    <button class="btn-ghost beheer-card-link" id="devices-card-link">Apparaten beheren</button>
  `;
  el.querySelector('#devices-card-link').addEventListener('click', () => navigate('devices'));
}

function mountDevicesSummary(el, devices) {
  if (devices === null) {
    el.innerHTML = '<p class="empty-state">Kon apparaten niet laden.</p>';
    return;
  }
  const active = devices.filter(deviceIsActive).length;
  el.innerHTML = `
    <p class="beheer-card-line">${active} ${active === 1 ? 'vertrouwd apparaat' : 'vertrouwde apparaten'} actief.</p>
    <button class="btn-primary" id="devices-summary-link">Apparaten beheren</button>
  `;
  el.querySelector('#devices-summary-link').addEventListener('click', () => navigate('devices'));
}

// ─── Prullenbak (Logboek trash) ─────────────────────────────────────────────────

async function mountPrullenbakSummary(el, familyId) {
  let count = 0;
  try {
    count = await fetchTrashedLogboekCount(familyId);
  } catch (err) {
    console.error('[ma/beheer] Failed to load trash count:', err);
    el.innerHTML = '<p class="empty-state">Kon dit niet laden.</p>';
    return;
  }

  el.innerHTML = `
    <p class="beheer-card-line">
      ${count === 0 ? 'De prullenbak is leeg.' : `${count} verwijderde ${count === 1 ? 'logboekregel' : 'logboekregels'}.`}
    </p>
    <button class="btn-primary" id="prullenbak-summary-link">Prullenbak beheren</button>
  `;
  el.querySelector('#prullenbak-summary-link').addEventListener('click', () => navigate('prullenbak'));
}

// ─── Recente activiteit ────────────────────────────────────────────────────────

async function mountActivityTimeline(container, familyId) {
  const filtersEl = container.querySelector('#activity-filters');
  const listEl    = container.querySelector('#activity-list');
  const moreEl     = container.querySelector('#activity-more');
  const moreBtn    = container.querySelector('#activity-more-btn');

  let rosterLookup = { familyUserIds: new Set(), caregiverUserIds: new Set() };
  try {
    rosterLookup = buildRosterLookup(await fetchAdminRoster(familyId));
  } catch (err) {
    console.error('[ma/beheer] Failed to load roster for activity filtering:', err);
  }

  let activeBucket = null;
  let offset = 0;
  let allRows = [];
  let loading = false;

  filtersEl.innerHTML = ACTIVITY_FILTERS.map(f => `
    <button class="filter-chip ${f.bucket === activeBucket ? 'filter-chip--active' : ''}" data-bucket="${f.bucket ?? ''}">
      ${escapeHtml(f.label)}
    </button>
  `).join('');
  filtersEl.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      activeBucket = btn.dataset.bucket || null;
      filtersEl.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('filter-chip--active'));
      btn.classList.add('filter-chip--active');
      renderFiltered();
    });
  });

  moreBtn.addEventListener('click', () => loadPage());

  function renderFiltered() {
    const filtered = activeBucket
      ? allRows.filter(row => activityBucket(row, rosterLookup) === activeBucket)
      : allRows;

    if (!filtered.length) {
      listEl.innerHTML = '<p class="empty-state">Nog geen activiteit.</p>';
      return;
    }

    listEl.innerHTML = filtered.map(row => `
      <div class="activity-row">
        <span class="activity-icon">${activityIcon(row)}</span>
        <div class="activity-body">
          <p class="activity-line">
            <span class="activity-time">${escapeHtml(formatTime(row.occurred_at))} · ${escapeHtml(formatDayHeader(row.occurred_at))}</span>
          </p>
          <p class="activity-sentence"><strong>${escapeHtml(actorLabel(row))}</strong> ${escapeHtml(activitySentence(row))}</p>
        </div>
      </div>
    `).join('');
  }

  async function loadPage() {
    if (loading) return;
    loading = true;
    moreBtn.disabled = true;
    moreBtn.textContent = 'Laden…';
    try {
      const page = await fetchAdminActivity(familyId, { limit: ACTIVITY_PAGE_SIZE, offset });
      allRows = allRows.concat(page);
      offset += page.length;
      moreEl.hidden = page.length < ACTIVITY_PAGE_SIZE;
      renderFiltered();
    } catch (err) {
      console.error('[ma/beheer] Failed to load activity:', err);
      listEl.innerHTML = '<p class="empty-state">Kon de activiteit niet laden.</p>';
    } finally {
      loading = false;
      moreBtn.disabled = false;
      moreBtn.textContent = 'Meer laden';
    }
  }

  await loadPage();
}

// ─── Mensen en toegang ──────────────────────────────────────────────────────────

async function mountRoster(el, familyId) {
  let rows = [];
  try {
    rows = await fetchAdminRoster(familyId);
  } catch (err) {
    console.error('[ma/beheer] Failed to load roster:', err);
    el.innerHTML = '<p class="empty-state">Kon de lijst niet laden.</p>';
    return;
  }

  if (!rows.length) {
    el.innerHTML = '<p class="empty-state">Niemand gevonden.</p>';
    return;
  }

  el.innerHTML = rows.map(r => `
    <div class="person-card">
      <div class="person-avatar person-avatar--initial">${escapeHtml(getInitial(r.display_name))}</div>
      <div class="person-info">
        <h3 class="person-name">
          ${escapeHtml(r.display_name || 'Onbekend')}
          <span class="roster-badge roster-badge--${r.access_type}">${escapeHtml(ACCESS_TYPE_BADGES[r.access_type] ?? r.access_type)}</span>
          ${r.access_status === 'revoked' ? '<span class="roster-badge roster-badge--revoked">Ingetrokken</span>' : ''}
        </h3>
        ${r.relationship ? `<p class="person-relationship">${escapeHtml(r.relationship)}</p>` : ''}
        <p class="roster-meta">${r.last_seen_at ? `Laatst actief ${escapeHtml(formatRelativeNl(r.last_seen_at))}` : 'Nog niet actief geweest'}</p>
        <p class="roster-meta">${r.last_meaningful_action_at ? `Laatste actie ${escapeHtml(formatRelativeNl(r.last_meaningful_action_at))}` : 'Nog geen acties'}</p>
      </div>
    </div>
  `).join('');
}
