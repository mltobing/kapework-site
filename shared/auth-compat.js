/* Shared account adapter for the suite's classic (non-module) game scripts.
 * Auth and refresh tokens remain owned by /shared/auth.js's one client.
 * A missing configuration never prevents local guest gameplay.
 */
(function () {
  'use strict';
  var modulePromise;
  function service() {
    if (!modulePromise) modulePromise = import('/shared/auth.js').catch(function (error) {
      modulePromise = null; throw error;
    });
    return modulePromise;
  }
  async function client() {
    try { return await (await service()).getClient(); } catch (_) { return null; }
  }
  function unavailable() {
    return { data: null, error: { message: 'Account saving is unavailable. You can keep playing on this device.' } };
  }
  async function authCall(method, args) {
    var sb = await client();
    try { return sb ? await sb.auth[method].apply(sb.auth, args) : unavailable(); }
    catch (_) { return unavailable(); }
  }
  window.KapeworkAuthCompat = {
    auth: {
      getSession: async function () {
        var sb = await client();
        try { if (sb) return await sb.auth.getSession(); } catch (_) { /* Keep local gameplay available. */ }
        return { data: { session: null }, error: null };
      },
      signInWithOAuth: async function (options) {
        if (!options || options.provider !== 'google') return unavailable();
        try {
          await (await service()).signInWithGoogle({ returnTo: options.options?.redirectTo || location.href });
          return { data: null, error: null };
        } catch (_) {
          return { data: null, error: { message: 'Google sign-in could not start. Please try again.' } };
        }
      },
      signInWithOtp: function (options) {
        // Email fallback is for existing accounts; public enrolment uses Google.
        return authCall('signInWithOtp', [{ ...options, options: { ...options?.options, shouldCreateUser: false } }]);
      },
      verifyOtp: function (options) { return authCall('verifyOtp', [options]); },
      signOut: async function () {
        try { await (await service()).signOut(); return { error: null }; }
        catch (_) { return { error: { message: 'Sign-out did not finish. Please try again.' } }; }
      },
      onAuthStateChange: function (callback) {
        var stopped = false, subscription;
        client().then(function (sb) {
          if (stopped) return;
          if (!sb) {
            Promise.resolve().then(function () { return callback('INITIAL_SESSION', null); }).catch(function () {
              window.dispatchEvent(new CustomEvent('kapework-account-error'));
            });
            return;
          }
          subscription = sb.auth.onAuthStateChange(function (event, session) {
            // Existing games call other auth methods from their listeners. Do
            // that after the Supabase auth lock is released to avoid deadlock.
            setTimeout(function () {
              if (stopped) return;
              Promise.resolve().then(function () { return callback(event, session); }).catch(function () {
                window.dispatchEvent(new CustomEvent('kapework-account-error'));
              });
            }, 0);
          }).data.subscription;
        }).catch(function () { window.dispatchEvent(new CustomEvent('kapework-account-error')); });
        return { data: { subscription: { unsubscribe: function () {
          stopped = true; if (subscription) subscription.unsubscribe();
        } } } };
      },
    },
    rpc: async function (name, parameters) {
      var sb = await client();
      try { return sb ? await sb.rpc(name, parameters) : unavailable(); }
      catch (_) { return unavailable(); }
    },
  };
}());
