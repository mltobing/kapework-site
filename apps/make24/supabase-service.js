/**
 * supabase-service.js — centralised Supabase client and auth helpers.
 *
 * Owns:
 *   - Client initialisation (createClient, URL, anon key)
 *   - All auth operations (getSession, signIn, signOut, OTP, onAuthStateChange)
 *   - RPC wrapper
 *
 * Exposes a single global: window.make24Db
 *
 * Why the anon key lives here instead of app.js:
 *   Supabase anon keys are designed to be public — RLS policies are the real
 *   security boundary. Having one canonical location makes rotation trivial
 *   and makes it obvious where to look if the key ever needs to change.
 *   If you ever move to a build step, inject these via environment variables
 *   and remove the literals below.
 *
 * Loaded by index.html before app.js and speakeasy.js.
 */
(function () {
    'use strict';

    // ── CONFIGURATION ──────────────────────────────────────────────────────
    // To rotate: update both values here and redeploy. The key below is the
    // Supabase anon (public) key — safe to include in client-side code.
    var SUPABASE_URL = 'https://fimsbfcvavpehryvvcho.supabase.co';
    var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpbXNiZmN2YXZwZWhyeXZ2Y2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzOTEwMDMsImV4cCI6MjA3MDk2NzAwM30.6uAm_bDPN9aetYaKWA7zCvS8XDEVhmKKxA7RA7YK4JQ';

    var _client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // ── SERVICE OBJECT ────────────────────────────────────────────────────
    window.make24Db = {
        /** The Supabase project URL — used by app.js for raw REST fetch calls. */
        url: SUPABASE_URL,

        /** The anon key — used by app.js for Authorization headers. */
        key: SUPABASE_KEY,

        // ── AUTH ───────────────────────────────────────────────────────────

        /** Returns the current session (or null if signed out). */
        getSession: function () {
            return _client.auth.getSession();
        },

        /** Opens the Google OAuth popup and redirects back to redirectTo. */
        signInWithGoogle: function (redirectTo) {
            return _client.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: redirectTo, queryParams: { prompt: 'select_account' } }
            });
        },

        /** Sends a one-time password to the given email address. */
        sendOtp: function (email) {
            return _client.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } });
        },

        /** Verifies the OTP code for the given email. */
        verifyOtp: function (email, token, type) {
            return _client.auth.verifyOtp({ email: email, token: token, type: type });
        },

        /**
         * Signs the user out.
         * Pass { scope: 'local' } to clear only the local session
         * without invalidating the server-side token.
         */
        signOut: function (options) {
            return _client.auth.signOut(options);
        },

        /** Subscribes to auth state changes (sign-in, sign-out, token refresh). */
        onAuthStateChange: function (callback) {
            return _client.auth.onAuthStateChange(callback);
        },

        // ── DATA ───────────────────────────────────────────────────────────

        /** Calls a Supabase RPC (database function). */
        rpc: function (fn, params) {
            return _client.rpc(fn, params);
        },
    };
}());
