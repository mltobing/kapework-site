/**
 * src/main.js
 *
 * Ma app bootstrap.
 *
 * Sign-in is passwordless by default (magic link) for pre-created accounts only;
 * signup is closed. Email + password is kept as a demoted fallback.
 *
 * Boot flow:
 *   1. Capture any auth params the magic-link redirect left in the URL.
 *   2. Resolve the Supabase session (the client parses redirect tokens on load).
 *   3. Clean the token out of the URL, then route:
 *        no session            → sign-in screen (with an expired-link notice if any)
 *        session, no profile   → one-time name prompt → create ma_profiles row
 *        session, no family    → calm "ask for access" screen
 *        session + membership  → app shell + initial view
 *   4. Re-run on auth state changes (sign-in / sign-out).
 */

import { supabase }                             from './supabase.js';
import { getState, setState }                   from './state.js';
import { currentRoute, onRoute, navigate }      from './router.js';
import { escapeHtml }                           from './utils.js';
import { fetchProfile, fetchFamilyId, createProfile } from './api.js';
import { renderTopbar }                         from './components/topbar.js';
import { renderNav }                            from './components/nav.js';
import { mount as mountToday }                  from './views/today.js';
import { mount as mountBriefing }               from './views/briefing.js';
import { mount as mountFamily }                 from './views/family.js';
import { mount as mountPhotos }                 from './views/photos.js';
import { mount as mountCalendar }               from './views/calendar.js';
import { mount as mountPeople }                 from './views/people.js';
import { mount as mountCompose }                from './views/compose.js';
import { mount as mountDevices }                from './views/devices.js';

const VIEWS = {
  today:    mountToday,
  briefing: mountBriefing,
  family:   mountFamily,
  photos:   mountPhotos,
  calendar: mountCalendar,
  people:   mountPeople,
  compose:  mountCompose,
  devices:  mountDevices,
};

// Where the magic link sends the user back to. Hardcoded to production so a link
// opened from any device lands where the real session lives (closed signup).
const REDIRECT_TO = 'https://ma.kapework.com';

// Seconds the "Stuur inloglink" button stays disabled after a request, to stay
// friendly to the auth rate limit / Resend quota.
const RESEND_COOLDOWN = 60;

// Snapshot of the URL at load, before Supabase's async redirect handling can
// rewrite it — used to detect expired-link errors reliably.
const _initialUrl = { hash: window.location.hash, search: window.location.search };

let _cleanupCurrentView = null;
let _routeUnsubscribe   = null;
let _renderedUserId     = undefined; // guards against redundant re-renders

// ─── URL / redirect helpers ──────────────────────────────────────────────────

function parseAuthParams(fragment) {
  return new URLSearchParams(String(fragment).replace(/^[#?]/, ''));
}

/** Returns an error code if the redirect came back as an expired/used link. */
function readAuthErrorFromUrl() {
  const h = parseAuthParams(_initialUrl.hash);
  const q = parseAuthParams(_initialUrl.search);
  return h.get('error_code') || q.get('error_code') || h.get('error') || q.get('error') || null;
}

function urlHasAuthParams() {
  const both = window.location.hash + window.location.search;
  return /(access_token|refresh_token|error_code|[#&?]error=|[?&]code=|[#&]type=)/.test(both);
}

/** Strip auth tokens/errors from the URL so nothing lands in history or a screenshot. */
function cleanAuthParamsFromUrl() {
  if (!urlHasAuthParams()) return;
  history.replaceState(null, document.title, window.location.pathname);
}

// ─── Sign-in screen (magic link primary, password secondary) ──────────────────

/**
 * @param {HTMLElement} appEl
 * @param {{ notice?: string }} [opts]
 */
function renderSignIn(appEl, { notice } = {}) {
  appEl.innerHTML = `
    <div class="auth-screen">
      <div class="auth-content">
        <div class="auth-logo">Ma</div>
        <p class="auth-tagline">Voor de familie</p>

        ${notice ? `<div class="auth-notice">${escapeHtml(notice)}</div>` : ''}

        <form class="auth-form" id="magic-form" novalidate>
          <div class="field">
            <label for="magic-email">E-mailadres</label>
            <input
              type="email" id="magic-email" name="email"
              autocomplete="email" inputmode="email"
              placeholder="naam@voorbeeld.nl" required
            >
          </div>
          <div id="magic-msg" class="auth-message" hidden></div>
          <button type="submit" class="btn-primary btn-large" id="magic-btn">
            Stuur inloglink
          </button>
        </form>

        <button type="button" class="auth-toggle" id="to-password">
          Inloggen met wachtwoord
        </button>

        <form class="auth-form" id="password-form" novalidate hidden>
          <div class="field">
            <label for="pw-email">E-mailadres</label>
            <input
              type="email" id="pw-email" name="email"
              autocomplete="email" inputmode="email"
              placeholder="naam@voorbeeld.nl" required
            >
          </div>
          <div class="field">
            <label for="pw-password">Wachtwoord</label>
            <input
              type="password" id="pw-password" name="password"
              autocomplete="current-password" placeholder="••••••••" required
            >
          </div>
          <div id="pw-error" class="auth-error" hidden></div>
          <button type="submit" class="btn-primary btn-large" id="pw-btn">
            Inloggen
          </button>
        </form>

        <button type="button" class="auth-toggle" id="to-magic" hidden>
          Inloggen met inloglink
        </button>

        <p class="auth-note">Privé-app voor de familie.</p>
      </div>
    </div>
  `;

  wireMagicForm(appEl);
  wirePasswordForm(appEl);
  wireAuthToggle(appEl);
}

function wireAuthToggle(appEl) {
  const magicForm = appEl.querySelector('#magic-form');
  const pwForm    = appEl.querySelector('#password-form');
  const toPw      = appEl.querySelector('#to-password');
  const toMagic   = appEl.querySelector('#to-magic');

  toPw.addEventListener('click', () => {
    magicForm.hidden = true;
    toPw.hidden      = true;
    pwForm.hidden    = false;
    toMagic.hidden   = false;
    pwForm.querySelector('#pw-email').focus();
  });

  toMagic.addEventListener('click', () => {
    pwForm.hidden    = true;
    toMagic.hidden   = true;
    magicForm.hidden = false;
    toPw.hidden      = false;
    magicForm.querySelector('#magic-email').focus();
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function wireMagicForm(appEl) {
  const form  = appEl.querySelector('#magic-form');
  const input = appEl.querySelector('#magic-email');
  const btn   = appEl.querySelector('#magic-btn');
  const msg   = appEl.querySelector('#magic-msg');

  function showMessage(text, kind /* 'success' | 'error' */) {
    msg.textContent = text;
    msg.className   = kind === 'success' ? 'auth-message auth-success' : 'auth-message auth-error';
    msg.hidden      = false;
  }

  function startCooldown() {
    let remaining = RESEND_COOLDOWN;
    btn.disabled = true;
    btn.textContent = `Opnieuw over ${remaining}s`;
    const timer = setInterval(() => {
      // The screen may have been replaced (sign-in completed) — bail cleanly.
      if (!btn.isConnected) { clearInterval(timer); return; }
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = 'Stuur inloglink';
      } else {
        btn.textContent = `Opnieuw over ${remaining}s`;
      }
    }, 1000);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!EMAIL_RE.test(email)) {
      showMessage('Vul een geldig e-mailadres in.', 'error');
      return;
    }

    btn.disabled   = true;
    btn.textContent = 'Versturen…';
    msg.hidden     = true;

    const outcome = await requestMagicLink(email);

    if (outcome === 'ok') {
      // Success and closed-signup/unknown-address look identical to the user —
      // never reveal whether an address exists.
      showMessage('Check je e-mail voor de inloglink.', 'success');
      startCooldown();
    } else {
      showMessage('Er ging iets mis. Probeer het later opnieuw.', 'error');
      btn.disabled = false;
      btn.textContent = 'Stuur inloglink';
    }
  });
}

/**
 * Requests a magic link. Returns 'ok' for both a real send and the closed-signup
 * / unknown-address rejection (indistinguishable by design); 'error' only for
 * genuine transient failures (network, rate limit, server) that are safe to
 * surface generically without leaking whether the address exists.
 */
async function requestMagicLink(email) {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,        // closed signup — required
        emailRedirectTo:  REDIRECT_TO,
      },
    });
    if (!error) return 'ok';
    // 429 = rate limit, 5xx = server trouble → generic error. Everything else
    // (closed signup, unknown user: 400/422/403) is shown as success.
    const status = error.status ?? 0;
    if (status === 429 || status >= 500) return 'error';
    return 'ok';
  } catch (err) {
    console.error('[ma/auth] Magic link request failed:', err);
    return 'error';
  }
}

function wirePasswordForm(appEl) {
  const form   = appEl.querySelector('#password-form');
  const emailI = appEl.querySelector('#pw-email');
  const pwI    = appEl.querySelector('#pw-password');
  const btn    = appEl.querySelector('#pw-btn');
  const errEl  = appEl.querySelector('#pw-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = emailI.value.trim();
    const password = pwI.value;
    if (!email || !password) return;

    btn.disabled    = true;
    btn.textContent = 'Inloggen…';
    errEl.hidden    = true;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = 'Inloggen mislukt. Controleer je gegevens.';
      errEl.hidden      = false;
      btn.disabled      = false;
      btn.textContent   = 'Inloggen';
    }
    // On success, onAuthStateChange fires and routes automatically.
  });
}

// ─── First sign-in: name prompt → create profile ─────────────────────────────

/**
 * Renders the one-time "what should we call you" screen and resolves with the
 * created ma_profiles row once saved. Never rejects — errors are shown inline so
 * the user can retry.
 * @returns {Promise<object|null>}
 */
function promptForProfile(appEl, user) {
  return new Promise((resolve) => {
    appEl.innerHTML = `
      <div class="auth-screen">
        <div class="auth-content">
          <div class="auth-logo">Ma</div>
          <p class="auth-tagline">Hoe mogen we je noemen?</p>
          <form class="auth-form" id="name-form" novalidate>
            <div class="field">
              <label for="display-name">Naam</label>
              <input
                type="text" id="display-name" name="display_name"
                autocomplete="name" maxlength="60" placeholder="Voornaam" required
              >
            </div>
            <div id="name-error" class="auth-error" hidden></div>
            <button type="submit" class="btn-primary btn-large" id="name-btn">
              Opslaan
            </button>
          </form>
        </div>
      </div>
    `;

    const form  = appEl.querySelector('#name-form');
    const input = appEl.querySelector('#display-name');
    const btn   = appEl.querySelector('#name-btn');
    const errEl = appEl.querySelector('#name-error');
    input.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const displayName = input.value.trim();
      if (!displayName) {
        errEl.textContent = 'Vul je naam in.';
        errEl.hidden = false;
        return;
      }

      btn.disabled    = true;
      btn.textContent = 'Opslaan…';
      errEl.hidden    = true;

      try {
        const profile = await createProfile({ userId: user.id, displayName });
        resolve(profile);
      } catch (err) {
        console.error('[ma/auth] Failed to create profile:', err);
        // If a row already existed (e.g. created by hand), recover by loading it
        // instead of dead-ending on a duplicate-key error.
        try {
          const existing = await fetchProfile(user.id);
          if (existing) { resolve(existing); return; }
        } catch (_) { /* fall through to inline error */ }
        errEl.textContent = 'Kon je naam niet opslaan. Probeer het opnieuw.';
        errEl.hidden      = false;
        btn.disabled      = false;
        btn.textContent   = 'Opslaan';
      }
    });
  });
}

// ─── No-membership state ──────────────────────────────────────────────────────

function renderNoMembership(appEl) {
  appEl.innerHTML = `
    <div class="auth-screen">
      <div class="auth-content">
        <div class="auth-logo">Ma</div>
        <div class="no-family-screen">
          <h2>Je account is aangemaakt.</h2>
          <p>Vraag de beheerder om je toegang te geven. Je hoeft verder niets te doen.</p>
        </div>
        <button type="button" class="auth-toggle" id="signout-btn">Uitloggen</button>
      </div>
    </div>
  `;
  appEl.querySelector('#signout-btn').addEventListener('click', handleSignOut);
}

/** Calm fallback when profile/membership can't be loaded (e.g. network). */
function renderLoadError(appEl) {
  appEl.innerHTML = `
    <div class="auth-screen">
      <div class="auth-content">
        <div class="auth-logo">Ma</div>
        <div class="no-family-screen">
          <h2>Er ging iets mis</h2>
          <p>We konden je gegevens niet laden. Ververs de pagina om het opnieuw te proberen.</p>
        </div>
        <button type="button" class="auth-toggle" id="signout-btn">Uitloggen</button>
      </div>
    </div>
  `;
  appEl.querySelector('#signout-btn').addEventListener('click', handleSignOut);
}

// ─── App shell ────────────────────────────────────────────────────────────────

function renderShell(appEl, user, profile, familyId) {
  appEl.innerHTML = `
    <div class="app-shell">
      <div class="topbar"       id="topbar"></div>
      <main class="view-container" id="view-container"></main>
      <nav class="bottom-nav"   id="bottom-nav"></nav>
    </div>
  `;

  const topbarEl = appEl.querySelector('#topbar');
  const viewEl   = appEl.querySelector('#view-container');
  const navEl    = appEl.querySelector('#bottom-nav');

  renderTopbar(topbarEl, { onSignOut: handleSignOut, onDevices: () => navigate('devices') });
  renderNav(navEl, currentRoute());

  if (_routeUnsubscribe) _routeUnsubscribe();
  _routeUnsubscribe = onRoute(async (route) => {
    renderNav(navEl, route);
    await switchView(viewEl, route);
  });

  return switchView(viewEl, currentRoute());
}

async function switchView(container, route) {
  if (_cleanupCurrentView) {
    _cleanupCurrentView();
    _cleanupCurrentView = null;
  }
  container.innerHTML = '';

  const mountFn = VIEWS[route] ?? VIEWS.today;
  const state   = getState();

  try {
    const cleanup = await mountFn(container, state);
    _cleanupCurrentView = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    console.error(`[ma] Error mounting view "${route}":`, err);
    container.innerHTML = `
      <div class="view-error">
        <p>Something went wrong loading this page. Please try again.</p>
      </div>
    `;
  }
}

// ─── Post-auth routing ────────────────────────────────────────────────────────

async function routeAfterAuth(appEl, user) {
  setState({ user, profile: null, familyId: null });

  // 1. Profile — create it on first sign-in if missing.
  let profile = null;
  try {
    profile = await fetchProfile(user.id);
  } catch (err) {
    console.error('[ma] Failed to load profile:', err);
    renderLoadError(appEl);
    return;
  }

  if (!profile) {
    profile = await promptForProfile(appEl, user);
    if (!profile) return; // signed out mid-prompt; auth listener handles it
  }

  // 2. Membership — a user can be authenticated but not yet granted access.
  let familyId = null;
  try {
    familyId = await fetchFamilyId(user.id);
  } catch (err) {
    console.error('[ma] Failed to load membership:', err);
    renderLoadError(appEl);
    return;
  }

  setState({ user, profile, familyId });

  if (!familyId) {
    renderNoMembership(appEl);
    return;
  }

  await renderShell(appEl, user, profile, familyId);
}

// ─── Sign out ────────────────────────────────────────────────────────────────

async function handleSignOut() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error('[ma] Sign out error:', err);
  }
}

// ─── Render dispatch ──────────────────────────────────────────────────────────

function teardownShell() {
  if (_routeUnsubscribe)   { _routeUnsubscribe();   _routeUnsubscribe = null; }
  if (_cleanupCurrentView) { _cleanupCurrentView(); _cleanupCurrentView = null; }
}

async function showForSession(appEl, session) {
  const uid = session?.user?.id ?? null;
  if (uid === _renderedUserId) return; // no real change — avoid re-render churn
  _renderedUserId = uid;

  teardownShell();
  setState({ user: null, profile: null, familyId: null });
  appEl.innerHTML = '';

  if (session?.user) {
    cleanAuthParamsFromUrl();
    await routeAfterAuth(appEl, session.user);
  } else {
    renderSignIn(appEl);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
  const appEl     = document.getElementById('app');
  const loadingEl = document.getElementById('app-loading');

  const linkError = readAuthErrorFromUrl();

  let session = null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
  } catch (err) {
    console.error('[ma] Failed to get session:', err);
  }

  loadingEl?.remove();

  if (linkError && !session?.user) {
    // Expired or already-used magic link — never a blank screen.
    cleanAuthParamsFromUrl();
    _renderedUserId = null;
    renderSignIn(appEl, { notice: 'Deze link is verlopen. Vraag een nieuwe inloglink aan.' });
  } else {
    await showForSession(appEl, session);
  }

  // Keep in sync with auth changes (magic-link completion, sign-in, sign-out).
  supabase.auth.onAuthStateChange((_event, session) => {
    showForSession(appEl, session);
  });
}

init().catch(err => {
  console.error('[ma] Fatal init error:', err);
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.innerHTML = `
      <div class="auth-screen">
        <div class="auth-content">
          <div class="auth-logo">Ma</div>
          <p style="text-align:center; color: var(--danger); margin-top: 2rem; line-height: 1.6;">
            De app kon niet starten.<br>Ververs de pagina.
          </p>
        </div>
      </div>
    `;
  }
});
