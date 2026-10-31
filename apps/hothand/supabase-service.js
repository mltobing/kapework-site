/* Hot Hand keeps guest play and uses the suite's single account client. */
(function () {
  'use strict';
  var config = window.KapeworkConfig || {};
  var client = window.KapeworkAuthCompat;
  window.hhDb = {
    url: config.supabaseUrl || '',
    key: config.supabaseAnonKey || '',
    getSession: function () { return client.auth.getSession(); },
    rpc: function (name, parameters) { return client.rpc(name, parameters); },
  };
}());
