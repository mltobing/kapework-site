/* netlify/functions-tests/_fake-supabase.js
 *
 * A minimal, dependency-free fake of the @supabase/supabase-js client used to
 * exercise the trusted-device / activity Netlify Functions end-to-end without
 * a network call. Kept OUT of netlify/functions/ (test-only, never shipped —
 * see _ma-crypto.test.js for why that split matters for Netlify's bundler).
 *
 * installFakeSupabase() monkeypatches Module._load to intercept
 * `require('@supabase/supabase-js')` and hand back { createClient } backed
 * by a mutable "current fixture" — set a fresh fixture before each test via
 * setFixture(), then require the handler under test as usual.
 */

const Module = require('module');

let currentFixture = null;

function setFixture(fixture) {
  currentFixture = fixture;
}

function makeQueryBuilder(table, tableHandlers) {
  const state = { table, op: 'select', payload: undefined, filters: [], order: null, limit: null, cols: null };
  const builder = {
    select(cols)   { state.cols = cols; return builder; },
    insert(payload){ state.op = 'insert'; state.payload = payload; return builder; },
    update(payload){ state.op = 'update'; state.payload = payload; return builder; },
    eq(col, val)   { state.filters.push({ type: 'eq', col, val }); return builder; },
    neq(col, val)  { state.filters.push({ type: 'neq', col, val }); return builder; },
    is(col, val)   { state.filters.push({ type: 'is', col, val }); return builder; },
    gt(col, val)   { state.filters.push({ type: 'gt', col, val }); return builder; },
    order(col, opts) { state.order = { col, opts }; return builder; },
    limit(n)       { state.limit = n; return builder; },
    maybeSingle()  { return resolveState(); },
    single()       { return resolveState(); },
    then(onFulfilled, onRejected) { return resolveState().then(onFulfilled, onRejected); },
    catch(onRejected) { return resolveState().catch(onRejected); },
  };
  function resolveState() {
    const handler = tableHandlers[table];
    if (!handler) return Promise.resolve({ data: null, error: null });
    return Promise.resolve(handler(state));
  }
  return builder;
}

function fakeCreateClient() {
  if (!currentFixture) throw new Error('setFixture() must be called before the handler uses the client');
  return {
    auth: {
      getUser: async (token) => currentFixture.auth(token),
    },
    from(table) {
      return makeQueryBuilder(table, currentFixture.tables || {});
    },
  };
}

let installed = false;

function installFakeSupabase() {
  if (installed) return;
  installed = true;
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return { createClient: fakeCreateClient };
    }
    return originalLoad.apply(this, arguments);
  };
}

module.exports = { installFakeSupabase, setFixture };
