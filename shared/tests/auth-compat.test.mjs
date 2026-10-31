import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Substitute only the browser's absolute module import. All adapter behavior
// runs unchanged, with a controllable shared service and auth-lock timer.
const source = (await readFile(new URL('../auth-compat.js', import.meta.url), 'utf8'))
  .replace("import('/shared/auth.js')", 'loadService()');
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(service, loadService = () => Promise.resolve(service)) {
  const timers = [], events = [], window = { dispatchEvent: event => events.push(event.type) };
  vm.runInNewContext(source, { window, loadService, location: { href: 'https://numbercrunch.kapework.com/make36/' },
    setTimeout: callback => timers.push(callback), CustomEvent: class { constructor(type) { this.type = type; } } });
  return { api: window.KapeworkAuthCompat, timers, events };
}

test('missing account configuration preserves guest session and reports unavailable writes', async () => {
  const { api } = harness({ getClient: async () => { throw new Error('not configured'); } });
  assert.equal((await api.auth.getSession()).data.session, null);
  assert.match((await api.rpc('record_solve', {})).error.message, /keep playing/);
});

test('email fallback cannot create an account even when the caller asks to', async () => {
  let options;
  const { api } = harness({ getClient: async () => ({ auth: { signInWithOtp: async input => { options = input; return { error: null }; } } }) });
  await api.auth.signInWithOtp({ email: 'existing@example.test', options: { shouldCreateUser: true, captchaToken: 'test' } });
  assert.equal(options.options.shouldCreateUser, false);
  assert.equal(options.options.captchaToken, 'test');
  assert.equal(options.email, 'existing@example.test');
});

test('Google sign-in delegates return route; other providers cannot bypass it', async () => {
  const calls = [];
  const { api } = harness({ signInWithGoogle: async input => calls.push(input) });
  assert.equal((await api.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '/apps/make24/' } })).error, null);
  assert.equal(calls[0].returnTo, '/apps/make24/');
  assert.ok((await api.auth.signInWithOAuth({ provider: 'github' })).error);
  assert.equal(calls.length, 1);
});

test('Google and sign-out errors expose no raw provider response', async () => {
  const fail = async () => { throw new Error('private account response'); };
  const { api } = harness({ signInWithGoogle: fail, signOut: fail });
  assert.doesNotMatch((await api.auth.signInWithOAuth({ provider: 'google' })).error.message, /private/);
  assert.doesNotMatch((await api.auth.signOut()).error.message, /private/);
});

test('sign-out scope stays owned by the shared service', async () => {
  let args;
  const { api } = harness({ signOut: async (...input) => { args = input; } });
  await api.auth.signOut({ scope: 'global' });
  assert.equal(args.length, 0);
});

test('a failed module load is retryable and a successful module is reused', async () => {
  let loads = 0;
  const service = { getClient: async () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'fixture' } } } }) } }) };
  const { api } = harness(service, async () => { if (++loads === 1) throw new Error('offline'); return service; });
  assert.equal((await api.auth.getSession()).data.session, null);
  assert.equal((await api.auth.getSession()).data.session.user.id, 'fixture');
  await api.auth.getSession();
  assert.equal(loads, 2);
});

test('auth callback runs after the SDK lock and stops after unsubscribe', async () => {
  let sdkCallback, unsubscribed = 0, calls = 0;
  const { api, timers } = harness({ getClient: async () => ({ auth: { onAuthStateChange: callback => {
    sdkCallback = callback; return { data: { subscription: { unsubscribe: () => unsubscribed++ } } };
  } } }) });
  const { data } = api.auth.onAuthStateChange(() => calls++);
  await settle(); sdkCallback('SIGNED_IN', {});
  assert.equal(calls, 0);
  timers.shift()(); await settle(); assert.equal(calls, 1);
  sdkCallback('SIGNED_OUT', null); data.subscription.unsubscribe();
  timers.shift()(); await settle();
  assert.equal(calls, 1); assert.equal(unsubscribed, 1);
});

test('unsubscribe before client readiness prevents a late subscription', async () => {
  let resolveClient, subscriptions = 0;
  const { api } = harness({ getClient: () => new Promise(resolve => { resolveClient = resolve; }) });
  const { data } = api.auth.onAuthStateChange(() => {});
  await settle(); data.subscription.unsubscribe();
  resolveClient({ auth: { onAuthStateChange: () => subscriptions++ } });
  await settle(); assert.equal(subscriptions, 0);
});

test('async listener failure produces a generic event without unhandled rejection', async () => {
  let callback;
  const { api, timers, events } = harness({ getClient: async () => ({ auth: { onAuthStateChange: fn => {
    callback = fn; return { data: { subscription: { unsubscribe() {} } } };
  } } }) });
  api.auth.onAuthStateChange(async () => { throw new Error('private data'); });
  await settle(); callback('SIGNED_IN', {}); timers.shift()(); await settle();
  assert.deepEqual(events, ['kapework-account-error']);
});

test('rejected SDK calls leave guest startup and retry controls usable', async () => {
  const fail = async () => { throw new Error('offline'); };
  const { api } = harness({ getClient: async () => ({ auth: { getSession: fail, signInWithOtp: fail }, rpc: fail }) });
  assert.equal((await api.auth.getSession()).data.session, null);
  assert.ok((await api.auth.signInWithOtp({ email: 'existing@example.test' })).error);
  assert.ok((await api.rpc('record_solve', {})).error);
});
