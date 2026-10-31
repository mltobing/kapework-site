import { createClient } from './vendor/supabase.js';
import { createAuthService } from './auth-core.js';

const service = createAuthService({
  createClient, getConfig: () => window.KapeworkConfig,
  location: window.location,
  localStorage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: key => window.localStorage.removeItem(key) },
  sessionStorage: { getItem: key => window.sessionStorage.getItem(key), setItem: (key, value) => window.sessionStorage.setItem(key, value), removeItem: key => window.sessionStorage.removeItem(key) },
  fetch: window.fetch.bind(window),
});
export const { getClient, getState, signInWithGoogle, finishSignIn, signOut, subscribe } = service;
