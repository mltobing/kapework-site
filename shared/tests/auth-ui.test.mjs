import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// A small DOM fixture exercises user-visible auth states without a browser or
// provider. Only the service import is replaced; render/actions are production.
const source = (await readFile(new URL('../auth-ui.js', import.meta.url), 'utf8'))
  .replace("import { getState, signInWithGoogle, signOut, subscribe } from './auth.js';", 'const { getState, signInWithGoogle, signOut, subscribe } = service;')
  .replaceAll('export ', '') + '\nglobalThis.ui = { openAccount, bindAccountTriggers };';
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  let subscriber;
  const state = { configured: true, googleEnabled: true, session: null };
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.open = false; this.isConnected = true; }
    set textContent(text) { this.text = text; this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(' '); }
    set innerHTML(_) { throw new Error('Unsafe HTML rendering'); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    matches(selector) { return selector === this.tag || selector === '[data-kw-account]' && 'kwAccount' in this.dataset || selector === 'link[data-kw-auth-style]' && this.tag === 'link' && 'kwAuthStyle' in this.dataset; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    closest() { return null; }
    showModal() { this.open = true; }
    close() { this.open = false; for (const callback of this.listeners.close || []) callback(); }
    focus() { document.activeElement = this; }
    async click() { for (const callback of this.listeners.click || []) await callback({ preventDefault() {} }); }
  }
  const document = new Element('document'); document.head = new Element('head'); document.body = new Element('body');
  document.append(document.head, document.body); document.createElement = tag => new Element(tag);
  const trigger = new Element('button'); trigger.dataset.kwAccount = ''; document.body.append(trigger); document.activeElement = trigger;
  const service = { getState: async () => state, signInWithGoogle: async () => {}, signOut: async () => { state.session = null; }, subscribe: async callback => { subscriber = callback; return () => {}; }, ...overrides };
  const context = vm.createContext({ document, service, location: { href: 'https://create.kapework.com/' } });
  vm.runInContext(source, context);
  return { state, document, trigger, ui: context.ui, notify: session => subscriber(session), dialog: () => document.querySelector('dialog'),
    button: label => document.querySelector('dialog').querySelectorAll('button').find(node => node.textContent === label) };
}

test('Google is optional and uses the current app return route', async () => {
  let options;
  const f = fixture({ signInWithGoogle: async input => { options = input; } });
  await f.ui.openAccount();
  assert.ok(f.button('Continue without signing in'));
  await f.button('Continue with Google').click();
  assert.equal(options.returnTo, 'https://create.kapework.com/');
  assert.equal(f.dialog().querySelector('a').href, 'https://kapework.com/privacy/');
});

test('unconfigured provider shows guest action without a broken Google button', async () => {
  const f = fixture(); f.state.googleEnabled = false;
  await f.ui.openAccount();
  assert.equal(f.button('Continue with Google'), undefined);
  assert.match(f.dialog().textContent, /not available on this deployment/);
  await f.button('Continue without signing in').click();
  assert.equal(f.dialog().open, false); assert.equal(f.document.activeElement, f.trigger);
});

test('connection failure is retryable and is not described as provider configuration', async () => {
  let failed = true;
  const f = fixture({ getState: async () => { if (failed) throw new Error('offline'); return f.state; } });
  await f.ui.openAccount();
  assert.match(f.dialog().textContent, /could not connect/);
  assert.doesNotMatch(f.dialog().textContent, /not available on this deployment/);
  failed = false; await f.button('Try again').click();
  assert.ok(f.button('Continue with Google'));
});

test('account identity renders only as text and sign-out failure preserves it', async () => {
  const f = fixture({ signOut: async () => { throw new Error('private provider details'); } });
  f.state.session = { user: { email: '<img src=x onerror=alert(1)>@example.test' } };
  await f.ui.openAccount();
  assert.match(f.dialog().textContent, /<img src=x/);
  assert.equal(f.dialog().querySelectorAll('img').length, 0);
  await f.button('Sign out here').click();
  assert.match(f.dialog().textContent, /Sign-out did not finish/);
  assert.doesNotMatch(f.dialog().textContent, /private provider details/);
  assert.ok(f.button('Sign out here'));
});

test('session changes update visible account triggers and successful sign-out', async () => {
  const f = fixture(); await settle();
  assert.equal(f.trigger.textContent, 'Sign in');
  f.state.session = { user: { email: 'fixture@example.test' } }; f.notify(f.state.session);
  assert.equal(f.trigger.textContent, 'Account');
  await f.ui.openAccount(); await f.button('Sign out here').click();
  assert.equal(f.trigger.textContent, 'Sign in');
  assert.match(f.dialog().textContent, /Signed out on this site/);
});

test('failed Google startup restores the action without exposing provider data', async () => {
  const f = fixture({ signInWithGoogle: async () => { throw new Error('private token'); } });
  await f.ui.openAccount(); await f.button('Continue with Google').click();
  assert.equal(f.button('Continue with Google').disabled, false);
  assert.match(f.dialog().textContent, /Your local work is still here/);
  assert.doesNotMatch(f.dialog().textContent, /private token/);
});
