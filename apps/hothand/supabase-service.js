/**
 * supabase-service.js — Supabase client for Hot Hand.
 *
 * Exposes window.hhDb — parallel to make24's window.make24Db but scoped
 * to the Hot Hand app so the two can co-exist on the same origin.
 *
 * The Supabase anon key is intentionally public — RLS policies are the real
 * security boundary. Rotate by updating both values here and redeploying.
 */
(function () {
    'use strict';

    var SUPABASE_URL = 'https://fimsbfcvavpehryvvcho.supabase.co';
    var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpbXNiZmN2YXZwZWhyeXZ2Y2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzOTEwMDMsImV4cCI6MjA3MDk2NzAwM30.6uAm_bDPN9aetYaKWA7zCvS8XDEVhmKKxA7RA7YK4JQ';

    var _client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    window.hhDb = {
        url: SUPABASE_URL,
        key: SUPABASE_KEY,

        getSession: function () {
            return _client.auth.getSession();
        },

        rpc: function (fn, params) {
            return _client.rpc(fn, params);
        },
    };
}());
