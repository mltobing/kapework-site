/**
 * apps/ma/vandaag/src/trusted.js
 *
 * The care recipient's read-only "Vandaag" display and its pairing flow.
 *
 * This is a SEPARATE entry point from the family app. It never imports main.js,
 * never touches Supabase Auth, and knows nothing about the family beyond the one
 * sanitized Today payload the server returns for a valid device cookie. Its only
 * credential is the HttpOnly cookie, which JavaScript here can neither read nor
 * write — every request just sends it via `credentials: 'include'`.
 *
 * States:
 *   - valid cookie   → large, calm Today display; auto-refreshes.
 *   - no cookie      → "Dit apparaat instellen": a one-tap link button (when an
 *                      activation fragment is present) or a six-digit code input.
 *   - revoked/expired→ next refresh returns 401 → falls back to the setup screen.
 */

import { computeTodayState } from '../../src/lib/today-state.js';
import { formatDateKeyHeader, formatTime } from '../../src/lib/datetime.js';
import { escapeHtml } from '../../src/utils.js';

const FN_TODAY    = '/.netlify/functions/ma-today';
const FN_ACTIVATE = '/.netlify/functions/ma-device-activate';
const REFRESH_MS  = 60 * 1000;

const app = document.getElementById('vandaag');

// Last successful sanitized payload, kept in memory only (never persisted): if a
// refresh fails while the display is open we can keep showing it behind a clear
// stale badge, without ever writing family text to device storage.
let lastPayload = null;
let lastFetchMs = 0;
let refreshTimer = null;

// ─── Networking ───────────────────────────────────────────────────────────────

async function fetchToday() {
  const res = await fetch(FN_TODAY, { method: 'GET', credentials: 'include', cache: 'no-store' });
  if (res.status === 401) return { status: 'unauthorized' };
  if (!res.ok) return { status: 'error' };
  return { status: 'ok', payload: await res.json() };
}

async function activate(bodyObj) {
  const res = await fetch(FN_ACTIVATE, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  });
  return res.ok;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
  const fragToken = readAndStripFragmentToken();

  const result = await fetchToday();
  if (result.status === 'ok') {
    showDisplay(result.payload);
    return;
  }
  // Not yet paired (or revoked): show setup. A fragment token becomes a one-tap
  // activation; otherwise the six-digit code path.
  showSetup({ fragToken });
}

/** Read #token=… from the URL, then scrub it from history immediately. */
function readAndStripFragmentToken() {
  const m = /[#&]token=([^&]+)/.exec(window.location.hash || '');
  const token = m ? decodeURIComponent(m[1]) : null;
  if (window.location.hash) {
    history.replaceState(null, document.title, window.location.pathname + window.location.search);
  }
  return token;
}

// ─── Today display ─────────────────────────────────────────────────────────────

function showDisplay(payload) {
  lastPayload = payload;
  lastFetchMs = Date.now();
  renderDisplay({ offline: false });
  startRefreshLoop();
}

function startRefreshLoop() {
  stopRefreshLoop();
  refreshTimer = setInterval(refresh, REFRESH_MS);
  window.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', refresh);
}

function stopRefreshLoop() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  window.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', refresh);
}

function onVisible() {
  if (document.visibilityState === 'visible') refresh();
}

async function refresh() {
  const result = await fetchToday();
  if (result.status === 'ok') {
    lastPayload = result.payload;
    lastFetchMs = Date.now();
    renderDisplay({ offline: false });
  } else if (result.status === 'unauthorized') {
    // Revoked or expired — stop refreshing and return to setup.
    stopRefreshLoop();
    lastPayload = null;
    showSetup({ fragToken: null });
  } else if (lastPayload) {
    // Transient outage: keep the last payload behind a clear stale badge.
    renderDisplay({ offline: true });
  }
}

function renderDisplay({ offline }) {
  const payload = lastPayload;
  // When offline we cannot trust freshness, so force the engine to treat data as
  // stale (suppresses any "go now" cue) regardless of the cached sync time.
  const state = computeTodayState({
    events: payload.events || [],
    now: Date.now(),
    calendarLastSyncedAt: offline ? null : payload.calendarLastSyncedAt,
  });

  const stale = offline || state.stale;
  const updated = `Laatst bijgewerkt om ${escapeHtml(formatTime(lastFetchMs))}`;

  app.innerHTML = `
    <div class="vandaag-screen">
      <h1 class="vandaag-date">${escapeHtml(formatDateKeyHeader(payload.dateKey))}</h1>

      <section class="vandaag-now${stale ? ' vandaag-now--stale' : ''}">
        <p class="vandaag-now-headline">${escapeHtml(state.nu.headline)}</p>
        ${state.nu.detail ? `<p class="vandaag-now-detail">${escapeHtml(state.nu.detail)}</p>` : ''}
      </section>

      ${renderEventsList(state.schedule)}
      ${payload.briefingText ? `<section class="vandaag-note">${escapeHtml(payload.briefingText)}</section>` : ''}

      <footer class="vandaag-foot">
        ${offline ? '<p class="vandaag-offline">Geen verbinding — dit is de laatst bekende informatie.</p>' : ''}
        ${stale && !offline ? '<p class="vandaag-offline">De informatie is misschien niet actueel.</p>' : ''}
        <p class="vandaag-updated">${updated}</p>
      </footer>
    </div>
  `;
}

function renderEventsList(schedule) {
  const items = [...schedule.timed, ...schedule.allDay];
  if (!items.length) return '';

  const rows = schedule.timed.map(ev => `
    <li class="vandaag-event${ev.past ? ' vandaag-event--past' : ''}${ev.current ? ' vandaag-event--now' : ''}">
      <span class="vandaag-event-time">${escapeHtml(formatTime(ev.startsAt))}</span>
      <span class="vandaag-event-body">
        <span class="vandaag-event-title">${escapeHtml(ev.title || 'Afspraak')}</span>
        ${ev.location ? `<span class="vandaag-event-loc">${escapeHtml(ev.location)}</span>` : ''}
      </span>
    </li>
  `).join('');

  const allDayRows = schedule.allDay.map(ev => `
    <li class="vandaag-event vandaag-event--allday">
      <span class="vandaag-event-time">Hele dag</span>
      <span class="vandaag-event-body">
        <span class="vandaag-event-title">${escapeHtml(ev.title || 'Afspraak')}</span>
      </span>
    </li>
  `).join('');

  return `<ul class="vandaag-events">${rows}${allDayRows}</ul>`;
}

// ─── Setup / pairing ────────────────────────────────────────────────────────────

function showSetup({ fragToken }) {
  if (fragToken) {
    renderLinkActivation(fragToken);
  } else {
    renderCodeEntry();
  }
}

function renderLinkActivation(token) {
  app.innerHTML = `
    <div class="vandaag-setup">
      <h1 class="vandaag-setup-title">Dit apparaat instellen</h1>
      <p class="vandaag-setup-text">Tik op de knop om dit apparaat te gebruiken voor Vandaag.</p>
      <button class="vandaag-btn" id="v-activate">Dit apparaat gebruiken voor Vandaag</button>
      <p class="vandaag-setup-error" id="v-error" hidden></p>
      <button class="vandaag-link" id="v-use-code">Ik heb een code</button>
    </div>
  `;
  app.querySelector('#v-activate').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Bezig…';
    const ok = await activate({ token });
    if (ok) { const r = await fetchToday(); if (r.status === 'ok') { showDisplay(r.payload); return; } }
    showError('Instellen is niet gelukt. Vraag om een nieuwe link of gebruik een code.');
    btn.disabled = false; btn.textContent = 'Dit apparaat gebruiken voor Vandaag';
  });
  app.querySelector('#v-use-code').addEventListener('click', () => renderCodeEntry());
}

function renderCodeEntry() {
  app.innerHTML = `
    <div class="vandaag-setup">
      <h1 class="vandaag-setup-title">Dit apparaat instellen</h1>
      <p class="vandaag-setup-text">Typ de zescijferige code die u van de familie kreeg.</p>
      <input class="vandaag-code-input" id="v-code" inputmode="numeric" autocomplete="one-time-code"
             maxlength="6" pattern="[0-9]*" placeholder="000000" aria-label="Code">
      <p class="vandaag-setup-error" id="v-error" hidden></p>
      <button class="vandaag-btn" id="v-koppel">Koppelen</button>
    </div>
  `;
  const input = app.querySelector('#v-code');
  input.focus();
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
  app.querySelector('#v-koppel').addEventListener('click', async (e) => {
    const code = input.value.trim();
    if (code.length !== 6) { showError('Vul de zescijferige code in.'); return; }
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Bezig…';
    const ok = await activate({ code });
    if (ok) { const r = await fetchToday(); if (r.status === 'ok') { showDisplay(r.payload); return; } }
    showError('De code klopt niet of is verlopen. Vraag om een nieuwe code.');
    btn.disabled = false; btn.textContent = 'Koppelen';
  });
}

function showError(text) {
  const el = app.querySelector('#v-error');
  if (el) { el.textContent = text; el.hidden = false; }
}

init().catch(err => {
  console.error('[vandaag] init failed:', err);
  app.innerHTML = `
    <div class="vandaag-setup">
      <h1 class="vandaag-setup-title">Vandaag</h1>
      <p class="vandaag-setup-text">Er ging iets mis. Ververs de pagina.</p>
    </div>
  `;
});
