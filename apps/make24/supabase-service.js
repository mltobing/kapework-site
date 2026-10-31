/* Make 24's compatibility service uses the suite's shared account client.
 * Public connection values are supplied by shared/config.js at build time.
 */
(function () {
  'use strict';
  var config = window.KapeworkConfig || {};
  var client = window.KapeworkAuthCompat;
  window.make24Db = {
    url: config.supabaseUrl || '',
    key: config.supabaseAnonKey || '',
    getSession: function () { return client.auth.getSession(); },
    signInWithGoogle: function (redirectTo) {
      return client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo } });
    },
    sendOtp: function (email) {
      return client.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
    },
    verifyOtp: function (email, token, type) {
      return client.auth.verifyOtp({ email: email, token: token, type: type });
    },
    signOut: function () { return client.auth.signOut(); },
    onAuthStateChange: function (callback) { return client.auth.onAuthStateChange(callback); },
    rpc: function (name, parameters) { return client.rpc(name, parameters); },
  };
}());
