// Browser-independent auth orchestration. Credentials stay in the SDK's storage;
// return routes contain only a local path, never a session or OAuth response.
export const CALLBACK_PATH = '/shared/auth/callback.html';
const RETURN_KEY = 'kapework:auth:return';
const LEGACY_KEY = 'kapework-myplan-auth';
const MIGRATED_KEY = 'kapework:auth:myplan-migrated';
const MAX_RETURN_AGE = 15 * 60 * 1000;

export function safeReturnPath(value, origin) {
  try {
    if (typeof value !== 'string' || /[\\\u0000-\u001f]/.test(value) || /%(?:5c|00|0a|0d)/i.test(value)) return '/';
    const url = new URL(value, origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.pathname.startsWith('//')
      || url.pathname.startsWith('/shared/auth/')) return '/';
    for (const key of ['code', 'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'error', 'error_description']) url.searchParams.delete(key);
    if (/access_token|refresh_token|provider_token|error_description/.test(url.hash)) url.hash = '';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}

export function createAuthService({ createClient, getConfig, location, localStorage, sessionStorage, fetch, now = Date.now }) {
  let clientPromise, settingsPromise;
  const config = () => getConfig() || {};
  const configured = () => Boolean(config().supabaseUrl && config().supabaseAnonKey);
  const rememberMigration = () => { try { localStorage.setItem(MIGRATED_KEY, '1'); localStorage.removeItem(LEGACY_KEY); } catch { /* SDK persistence reports its own errors. */ } };

  async function getClient() {
    if (!configured()) throw new Error('Account sign-in is unavailable. Your work on this device is safe.');
    if (!clientPromise) clientPromise = (async () => {
      const cfg = config();
      const client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true,
          detectSessionInUrl: location.pathname !== CALLBACK_PATH },
        global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(20000) }) },
      });
      // The callback must exchange its own code before considering a legacy
      // session. An already selected shared account always takes precedence.
      if (location.pathname !== CALLBACK_PATH) {
        const { data, error } = await client.auth.getSession();
        if (error) throw new Error('Sign-in could not be restored. Please try again; your drafts are safe.');
        let legacy;
        try {
          if (!localStorage.getItem(MIGRATED_KEY)) legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
        } catch { /* Malformed or unavailable legacy storage is not an account. */ }
        if (!data.session && legacy?.access_token && legacy?.refresh_token) {
          const result = await client.auth.setSession({ access_token: legacy.access_token, refresh_token: legacy.refresh_token });
          if (!result.error && result.data?.session) rememberMigration();
        } else if (data.session) rememberMigration();
      }
      return client;
    })().catch(error => { clientPromise = null; throw error; });
    return clientPromise;
  }

  async function getSettings() {
    if (!configured()) return { googleEnabled: false };
    if (!settingsPromise) settingsPromise = (async () => {
      const cfg = config();
      const response = await fetch(new URL('/auth/v1/settings', cfg.supabaseUrl).href,
        { headers: { apikey: cfg.supabaseAnonKey }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
      if (!response.ok) throw new Error('Account sign-in could not connect. Please try again.');
      const data = await response.json();
      return { googleEnabled: data.external?.google === true };
    })().catch(error => { settingsPromise = null; throw error; });
    return settingsPromise;
  }

  async function getState() {
    if (!configured()) return { configured: false, googleEnabled: false, session: null };
    const client = await getClient();
    const [{ data, error }, settings] = await Promise.all([client.auth.getSession(), getSettings()]);
    if (error) throw new Error('Please sign in again. Your work on this device is safe.');
    return { configured: true, ...settings, session: data.session };
  }

  async function signInWithGoogle({ returnTo = location.href } = {}) {
    const client = await getClient();
    // Refresh provider readiness on each deliberate attempt; an administrator
    // may have completed setup since the page was opened.
    settingsPromise = null;
    if (!(await getSettings()).googleEnabled) throw new Error('Google sign-in is not available yet. Please try again shortly.');
    const path = safeReturnPath(returnTo, location.origin);
    try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path, createdAt: now() })); }
    catch { throw new Error('Allow website storage to sign in. Your existing work is still here.'); }
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: {
      redirectTo: location.origin + CALLBACK_PATH, scopes: 'openid email profile',
      queryParams: { prompt: 'select_account' }, skipBrowserRedirect: true,
    } });
    if (error || !data?.url) throw new Error('Google sign-in could not start. Please try again.');
    const target = new URL(data.url);
    if (target.origin !== new URL(config().supabaseUrl).origin || target.pathname !== '/auth/v1/authorize')
      throw new Error('Google sign-in returned an unexpected address. Please try again.');
    location.assign(target.href);
  }

  function takeReturnPath() {
    let entry;
    try { entry = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null'); sessionStorage.removeItem(RETURN_KEY); } catch { return '/'; }
    if (!entry || !Number.isFinite(entry.createdAt) || now() < entry.createdAt || now() - entry.createdAt > MAX_RETURN_AGE) return '/';
    return safeReturnPath(entry.path, location.origin);
  }

  async function finishSignIn({ code, error } = {}) {
    const path = takeReturnPath();
    if (error) return { ok: false, path, message: 'Sign-in was cancelled or declined. Your existing work is unchanged.' };
    if (!code) return { ok: false, path, message: 'This sign-in link is incomplete. Return to the app and try Google sign-in again.' };
    try {
      const client = await getClient();
      const result = await client.auth.exchangeCodeForSession(code);
      if (result.error || !result.data?.session) throw new Error('Exchange failed');
      rememberMigration();
      try { sessionStorage.setItem('kapework:auth:completed', '1'); } catch { /* Session itself is already persisted by the SDK. */ }
      return { ok: true, path };
    } catch {
      return { ok: false, path, message: 'This sign-in attempt expired or opened in a different browser. Return to the app and try again in this browser.' };
    }
  }

  async function signOut() {
    const client = await getClient();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw new Error('Sign-out did not finish. Please try again.');
    rememberMigration();
  }

  async function subscribe(callback) {
    const client = await getClient();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      // Never run another auth operation while Supabase holds its auth lock.
      setTimeout(() => callback(session), 0);
    });
    return () => data.subscription.unsubscribe();
  }
  return { getClient, getState, signInWithGoogle, finishSignIn, signOut, subscribe };
}
