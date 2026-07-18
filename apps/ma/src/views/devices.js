/**
 * views/devices.js
 *
 * The Apparaten screen — a signed-in family member sets up and manages the care
 * recipient's trusted "Vandaag" devices. Reached from the top-bar menu, not the
 * bottom navigation (it is rarely needed and must not crowd the six core tabs).
 *
 * Setup produces a one-time link + six-digit code (shown once). Management lists
 * each device with its status and a one-tap Intrekken (revoke). No raw device
 * token is ever visible here — only the server holds it, hashed.
 */

import { createPairing, listDevices, revokeDevice } from '../lib/devices-api.js';
import { getState } from '../state.js';
import { escapeHtml } from '../utils.js';
import { navigate } from '../router.js';
import { formatDayHeader, formatTime } from '../lib/datetime.js';

const LABEL_SUGGESTIONS = ['Laptop woonkamer', 'Telefoon', 'Tablet'];

export async function mount(container, { familyId }) {
  container.innerHTML = `
    <div class="view-devices">
      <div class="view-header view-header--back">
        <button class="dev-back" id="dev-back" aria-label="Terug">‹ Terug</button>
        <h1>Apparaten</h1>
      </div>
      <div class="dev-body">
        <p class="dev-intro">
          Stel een eenvoudig apparaat in dat alleen <strong>Vandaag</strong> laat zien —
          zonder in te loggen. Handig voor een vaste tablet, telefoon of laptop.
        </p>
        <div id="dev-setup"></div>
        <h2 class="section-title">Gekoppelde apparaten</h2>
        <div id="dev-list"><div class="section-loading">Laden…</div></div>
      </div>
    </div>
  `;

  container.querySelector('#dev-back').addEventListener('click', () => navigate('today'));

  const setupEl = container.querySelector('#dev-setup');
  const listEl  = container.querySelector('#dev-list');

  if (!familyId) {
    listEl.innerHTML = '<p class="empty-state">Familie niet gevonden.</p>';
    return;
  }

  renderSetupIdle(setupEl, familyId, () => loadList(listEl, familyId));
  await loadList(listEl, familyId);
}

// ─── Device list ──────────────────────────────────────────────────────────────

function deviceStatus(d) {
  if (d.revoked_at) return { key: 'revoked', label: 'Ingetrokken' };
  if (new Date(d.expires_at) <= new Date()) return { key: 'expired', label: 'Verlopen' };
  return { key: 'active', label: 'Actief' };
}

async function loadList(listEl, familyId) {
  try {
    const devices = await listDevices(familyId);
    if (!devices.length) {
      listEl.innerHTML = '<p class="empty-state">Nog geen apparaten gekoppeld.</p>';
      return;
    }
    listEl.innerHTML = devices.map(renderDeviceRow).join('');
    listEl.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.addEventListener('click', () => onRevoke(btn, familyId, listEl));
    });
  } catch (err) {
    console.error('[ma/devices] list failed:', err);
    listEl.innerHTML = '<p class="empty-state">Kon de apparaten niet laden.</p>';
  }
}

function renderDeviceRow(d) {
  const st = deviceStatus(d);
  const lastSeen = d.last_seen_at
    ? `Laatst gebruikt: ${escapeHtml(formatDayHeader(d.last_seen_at))} om ${escapeHtml(formatTime(d.last_seen_at))}`
    : 'Nog niet gebruikt';
  const paired = `Gekoppeld: ${escapeHtml(formatDayHeader(d.created_at))}`;
  const canRevoke = st.key === 'active';

  return `
    <article class="dev-row">
      <div class="dev-row-main">
        <p class="dev-row-label">${escapeHtml(d.label)}</p>
        <span class="dev-badge dev-badge--${st.key}">${escapeHtml(st.label)}</span>
      </div>
      <p class="dev-row-meta">${paired}</p>
      <p class="dev-row-meta">${lastSeen}</p>
      ${canRevoke
        ? `<button class="dev-revoke" data-revoke data-id="${escapeHtml(d.id)}">Intrekken</button>`
        : ''}
    </article>
  `;
}

async function onRevoke(btn, familyId, listEl) {
  if (!window.confirm('Dit apparaat kan Vandaag dan niet meer laten zien. Doorgaan?')) return;
  btn.disabled = true;
  try {
    await revokeDevice(familyId, btn.dataset.id);
    await loadList(listEl, familyId);
  } catch (err) {
    console.error('[ma/devices] revoke failed:', err);
    btn.disabled = false;
    btn.textContent = 'Kon niet intrekken';
  }
}

// ─── Setup flow ───────────────────────────────────────────────────────────────

function renderSetupIdle(setupEl, familyId, onCreated) {
  setupEl.innerHTML = `
    <button class="btn-primary btn-large" id="dev-new">Nieuw apparaat instellen</button>
  `;
  setupEl.querySelector('#dev-new').addEventListener('click', () => {
    renderSetupForm(setupEl, familyId, onCreated);
  });
}

function renderSetupForm(setupEl, familyId, onCreated) {
  setupEl.innerHTML = `
    <div class="dev-card">
      <label class="dev-field-label" for="dev-label">Naam van het apparaat</label>
      <input class="dev-input" id="dev-label" type="text" maxlength="80"
             list="dev-label-list" placeholder="Laptop woonkamer" value="Laptop woonkamer">
      <datalist id="dev-label-list">
        ${LABEL_SUGGESTIONS.map(s => `<option value="${escapeHtml(s)}"></option>`).join('')}
      </datalist>
      <div id="dev-form-error" class="dev-error" hidden></div>
      <div class="dev-card-actions">
        <button class="dev-ghost" id="dev-cancel">Annuleer</button>
        <button class="btn-primary" id="dev-make">Maak koppeling</button>
      </div>
    </div>
  `;

  setupEl.querySelector('#dev-cancel')
    .addEventListener('click', () => renderSetupIdle(setupEl, familyId, onCreated));
  setupEl.querySelector('#dev-make')
    .addEventListener('click', () => makePairing(setupEl, familyId, onCreated));
}

async function makePairing(setupEl, familyId, onCreated) {
  const input = setupEl.querySelector('#dev-label');
  const btn   = setupEl.querySelector('#dev-make');
  const errEl = setupEl.querySelector('#dev-form-error');
  const label = (input.value || '').trim() || 'Apparaat';

  btn.disabled = true;
  btn.textContent = 'Bezig…';
  errEl.hidden = true;

  try {
    const pairing = await createPairing(familyId, label);
    renderPairingResult(setupEl, familyId, label, pairing, onCreated);
    onCreated(); // a device may already exist; refresh the list opportunistically
  } catch (err) {
    console.error('[ma/devices] create pairing failed:', err);
    errEl.textContent = 'Kon geen koppeling maken. Probeer het opnieuw.';
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Maak koppeling';
  }
}

function renderPairingResult(setupEl, familyId, label, pairing, onCreated) {
  const { activationUrl, code } = pairing;
  setupEl.innerHTML = `
    <div class="dev-card dev-card--result">
      <p class="dev-result-title">Koppeling klaar voor “${escapeHtml(label)}”</p>
      <p class="dev-result-help">
        Open onderstaande link op het apparaat, óf ga naar
        <strong>ma.kapework.com/vandaag</strong> en typ de code.
        De koppeling verloopt over 15 minuten.
      </p>

      <p class="dev-result-codelabel">Code</p>
      <p class="dev-result-code">${escapeHtml(code)}</p>

      <div class="dev-card-actions dev-card-actions--wrap">
        <button class="btn-primary" id="dev-share">Deel link</button>
        <button class="dev-ghost" id="dev-copy">Kopieer link</button>
        <button class="dev-ghost" id="dev-again">Nieuwe code</button>
      </div>
      <p id="dev-copy-msg" class="dev-copy-msg" hidden>Gekopieerd ✓</p>
      <button class="dev-ghost dev-done" id="dev-done">Klaar</button>
    </div>
  `;

  const msg = setupEl.querySelector('#dev-copy-msg');
  const flash = () => { msg.hidden = false; setTimeout(() => { msg.hidden = true; }, 1500); };

  setupEl.querySelector('#dev-share').addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Vandaag instellen', url: activationUrl }); } catch { /* cancelled */ }
    } else {
      await copyText(activationUrl); flash();
    }
  });
  setupEl.querySelector('#dev-copy').addEventListener('click', async () => {
    await copyText(activationUrl); flash();
  });
  // "Nieuwe code" regenerates a fresh one-time pairing (invalidating the old one
  // is unnecessary — it simply expires in 15 minutes).
  setupEl.querySelector('#dev-again')
    .addEventListener('click', () => regenerate(setupEl, familyId, label, onCreated));
  setupEl.querySelector('#dev-done')
    .addEventListener('click', () => renderSetupIdle(setupEl, familyId, onCreated));
}

async function regenerate(setupEl, familyId, label, onCreated) {
  try {
    const pairing = await createPairing(familyId, label);
    renderPairingResult(setupEl, familyId, label, pairing, onCreated);
  } catch (err) {
    console.error('[ma/devices] regenerate failed:', err);
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (err) { console.error('[ma/devices] clipboard failed:', err); }
}
