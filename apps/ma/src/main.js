/**
 * src/main.js
 *
 * Ma app bootstrap.
 *
 * Flow:
 *   1. Read current Supabase session (from localStorage — persisted by default)
 *   2. If no session   → render sign-in screen
 *   3. If session      → load profile + family, then render app shell + initial view
 *   4. Listen for auth state changes (sign-in / sign-out) and re-render accordingly
 *
 * The app shell is: Topbar + scrollable view container + bottom nav.
 * Views are mounted into the view container and cleaned up on each tab change.
 */

import { supabase }                   from './supabase.js';
import { getState, setState }         from './state.js';
import { currentRoute, navigate, onRoute } from './router.js';
import { escapeHtml }                 from './utils.js';
import { fetchProfile, fetchFamilyId } from './api.js';
import { renderTopbar }               from './components/topbar.js';
import { renderNav }                  from './components/nav.js';
import { mount as mountToday }        from './views/today.js';
import { mount as mountFamily }       from './views/family.js';
import { mount as mountPhotos }       from './views/photos.js';
import { mount as mountCalendar }     from './views/calendar.js';
import { mount as mountPeople }       from './views/people.js';
import { mount as mountCompose }      from './views/compose.js';

const VIEWS = {
  today:    mountToday,
  family:   mountFamily,
  photos:   mountPhotos,
  calendar: mountCalendar,
  people:   mountPeople,
  compose:  mountCompose,
};

let _cleanupCurrentView = null;
let _routeUnsubscribe   = null;

// ─── Auth screen ─────────────────────────────────────────────────────────────

function renderSignIn(appEl) {
  appEl.innerHTML = `
    <div class="auth-screen">
      <div class="auth-content">
        <div class="auth-logo">Ma</div>
        <p class="auth-tagline">Family memories, photos, and notes</p>
        <form class="auth-form" id="signin-form" novalidate>
          <div class="field">
            <label for="email">Email address</label>
            <input
              type="email" id="email" name="email"
              autocomplete="email" inputmode="email"
              placeholder="your@email.com" required
            >
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input
              type="password" id="password" name="password"
              autocomplete="current-password"
              placeholder="••••••••" required
            >
          </div>
          <div id="signin-error" class="auth-error" hidden></div>
          <button type="submit" class="btn-primary btn-large" id="signin-btn">
            Sign in
          </button>
        </form>
        <p class="auth-note">This is a private family app.</p>
      </div>
    </div>
  `;

  const form   = appEl.querySelector('#signin-form');
  const btn    = appEl.querySelector('#signin-btn');
  const errEl  = appEl.querySelector('#signin-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = appEl.querySelector('#email').value.trim();
    const password = appEl.querySelector('#password').value;
    if (!email || !password) return;

    btn.disabled    = true;
    btn.textContent = 'Signing in\u2026';
    errEl.hidden    = true;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = error.message || 'Sign in failed. Please try again.';
      errEl.hidden      = false;
      btn.disabled      = false;
      btn.textContent   = 'Sign in';
    }
    // On success, onAuthStateChange fires and re-renders the app automatically.
  });
}

// ─── No-family message ───────────────────────────────────────────────────────

function renderNoFamily(appEl) {
  // Still show the topbar so user can sign out
  appEl.innerHTML = `
    <div class="app-shell">
      <div class="topbar" id="topbar"></div>
      <main class="view-container">
        <div class="no-family-screen">
          <h2>Not connected yet</h2>
          <p>
            You're signed in, but not linked to a family group yet.<br>
            Please ask a family member to add your account.
          </p>
        </div>
      </main>
    </div>
  `;
  renderTopbar(appEl.querySelector('#topbar'), { onSignOut: handleSignOut });
}

// ─── App shell ───────────────────────────────────────────────────────────────

async function renderApp(appEl, user) {
  // Load profile and family membership in parallel
  let profile  = null;
  let familyId = null;

  try {
    [profile, familyId] = await Promise.all([
      fetchProfile(user.id),
      fetchFamilyId(user.id),
    ]);
  } catch (err) {
    console.error('[ma] Failed to load profile/family:', err);
  }

  setState({ user, profile, familyId });

  if (!familyId) {
    renderNoFamily(appEl);
    return;
  }

  // Build the app shell skeleton
  appEl.innerHTML = `
    <div class="app-shell">
      <div class="topbar"       id="topbar"></div>
      <main class="view-container" id="view-container"></main>
      <nav class="bottom-nav"   id="bottom-nav"></nav>
    </div>
  `;

  const topbarEl    = appEl.querySelector('#topbar');
  const viewEl      = appEl.querySelector('#view-container');
  const navEl       = appEl.querySelector('#bottom-nav');

  renderTopbar(topbarEl, { onSignOut: handleSignOut });
  renderNav(navEl, currentRoute());

  // Route listener — swap views on tab change
  if (_routeUnsubscribe) _routeUnsubscribe();
  _routeUnsubscribe = onRoute(async (route) => {
    renderNav(navEl, route);
    await switchView(viewEl, route);
  });

  // Mount the initial view
  await switchView(viewEl, currentRoute());
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

// ─── Sign out ────────────────────────────────────────────────────────────────

async function handleSignOut() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error('[ma] Sign out error:', err);
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function init() {
  const appEl     = document.getElementById('app');
  const loadingEl = document.getElementById('app-loading');

  // Resolve existing session before first paint
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('[ma] Failed to get session:', sessionError);
  }

  loadingEl?.remove();

  if (session?.user) {
    await renderApp(appEl, session.user);
  } else {
    renderSignIn(appEl);
  }

  // Keep in sync with auth changes (sign in / sign out / token refresh)
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (_routeUnsubscribe) {
      _routeUnsubscribe();
      _routeUnsubscribe = null;
    }
    if (_cleanupCurrentView) {
      _cleanupCurrentView();
      _cleanupCurrentView = null;
    }
    setState({ user: null, profile: null, familyId: null });

    if (session?.user) {
      appEl.innerHTML = '';
      await renderApp(appEl, session.user);
    } else {
      appEl.innerHTML = '';
      renderSignIn(appEl);
    }
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
            The app could not start.<br>Please refresh the page.
          </p>
        </div>
      </div>
    `;
  }
});
