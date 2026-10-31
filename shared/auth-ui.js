import { getState, signInWithGoogle, signOut, subscribe } from './auth.js';

let dialog, message, body, actions, lastFocus, pending = false, subscribed = false;
const bound = new WeakSet();
const triggers = new Set();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function ensureStyles() {
  if (document.querySelector('link[data-kw-auth-style]')) return;
  const link = element('link'); link.rel = 'stylesheet'; link.href = '/shared/auth-ui.css';
  link.dataset.kwAuthStyle = ''; document.head.append(link);
}
function showMessage(text) { message.textContent = text; message.hidden = !text; }
function button(text, action, primary = false) {
  const node = element('button', text, primary ? 'kw-auth-primary' : 'kw-auth-secondary');
  node.type = 'button'; node.addEventListener('click', action); return node;
}
function updateTriggers(session) {
  for (const trigger of triggers) {
    if (!trigger.isConnected) { triggers.delete(trigger); continue; }
    if (trigger.dataset.kwAccount === 'menu') continue;
    trigger.textContent = session ? 'Account' : 'Sign in';
    trigger.setAttribute('aria-label', session ? 'Your Kapework account' : 'Sign in to Kapework');
  }
}
function ensureDialog() {
  ensureStyles();
  if (dialog) return;
  dialog = element('dialog', '', 'kw-auth-dialog');
  dialog.setAttribute('aria-labelledby', 'kw-auth-heading');
  const heading = element('h2', 'Your Kapework account'); heading.id = 'kw-auth-heading';
  const header = element('div', '', 'kw-auth-heading');
  header.append(heading, button('Close', () => dialog.close()));
  body = element('div', '', 'kw-auth-body');
  message = element('p', '', 'kw-auth-message'); message.setAttribute('role', 'status'); message.hidden = true;
  actions = element('div', '', 'kw-auth-actions');
  const privacy = element('p', '', 'kw-auth-note');
  const privacyLink = element('a', 'Privacy'); privacyLink.href = 'https://kapework.com/privacy/';
  privacy.append(privacyLink);
  dialog.append(header, body, message, actions, privacy); document.body.append(dialog);
  dialog.addEventListener('close', () => { pending = false; lastFocus?.focus?.({ preventScroll: true }); });
}
async function paint() {
  let state, failed = false;
  try { state = await getState(); }
  catch { failed = true; }
  if (!dialog?.open) return;
  body.replaceChildren(); actions.replaceChildren();
  if (failed) {
    body.append(element('p', 'Your account could not connect. Your local work is still here. Please try again.'));
    actions.append(button('Try again', () => { showMessage(''); return paint(); }, true));
    actions.append(button('Continue without signing in', () => dialog.close()));
    return;
  }
  updateTriggers(state.session);
  if (state.session) {
    body.append(element('p', `Signed in as ${state.session.user?.email || 'your Kapework account'}.`));
    body.append(element('p', 'Apps with account saving can use this account. Other apps keep working on this device.', 'kw-auth-note'));
    actions.append(button('Sign out here', async () => {
      if (pending) return; pending = true;
      actions.querySelectorAll('button').forEach(node => { node.disabled = true; });
      try { await signOut(); showMessage('Signed out on this site.'); await paint(); }
      catch { showMessage('Sign-out did not finish. Please try again.'); actions.querySelectorAll('button').forEach(node => { node.disabled = false; }); }
      finally { pending = false; }
    }));
  } else {
    body.append(element('p', 'One Kapework account, with your Google sign-in. You can also keep using these apps without an account.'));
    body.append(element('p', 'Sign-in is remembered for this site in this browser. Another Kapework address may ask you to sign in again.', 'kw-auth-note'));
    if (state.configured && state.googleEnabled) {
      actions.append(button('Continue with Google', async () => {
        if (pending) return; pending = true; showMessage('Opening Google sign-in…');
        actions.querySelectorAll('button').forEach(node => { node.disabled = true; });
        try { await signInWithGoogle({ returnTo: location.href }); }
        catch { pending = false; showMessage('Google sign-in could not start. Your local work is still here. Please try again.'); actions.querySelectorAll('button').forEach(node => { node.disabled = false; }); }
      }, true));
    } else {
      body.append(element('p', 'Google sign-in is not available on this deployment yet. You can continue without signing in.', 'kw-auth-note'));
    }
  }
  actions.append(button(state.session ? 'Done' : 'Continue without signing in', () => dialog.close()));
}

export async function openAccount() {
  ensureDialog(); lastFocus = document.activeElement; showMessage('');
  if (!dialog.open) dialog.showModal();
  body.replaceChildren(element('p', 'Opening your account…')); actions.replaceChildren();
  await paint();
}

export function bindAccountTriggers(root = document) {
  ensureStyles();
  root.querySelectorAll('[data-kw-account]').forEach(trigger => {
    if (bound.has(trigger)) return;
    bound.add(trigger); triggers.add(trigger);
    trigger.addEventListener('click', event => {
      event.preventDefault();
      // Existing Make game menus use this class; their document click handler
      // also closes them, but close before moving focus into the dialog.
      trigger.closest('.more-menu')?.classList.remove('show');
      openAccount();
    });
  });
  getState().then(state => updateTriggers(state.session)).catch(() => {});
  if (!subscribed) {
    subscribed = true;
    subscribe(session => { updateTriggers(session); if (dialog?.open && !pending) paint(); }).catch(() => { subscribed = false; });
  }
}

bindAccountTriggers();
