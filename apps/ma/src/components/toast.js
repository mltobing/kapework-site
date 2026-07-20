/**
 * components/toast.js
 *
 * A single temporary snackbar/toast, optionally with one action button —
 * used for the Logboek "moved to trash, Ongedaan maken" undo. Appended to
 * <body> (above the bottom nav) and removed on dismiss/timeout/action.
 *
 * Only one toast is shown at a time: opening a new one replaces any current one.
 */

import { escapeHtml } from '../utils.js';

const DEFAULT_DURATION_MS = 6000;

/**
 * @param {string} message
 * @param {object} [opts]
 * @param {string} [opts.actionLabel] — e.g. "Ongedaan maken"
 * @param {() => void} [opts.onAction]
 * @param {number} [opts.durationMs]
 */
export function showToast(message, { actionLabel, onAction, durationMs = DEFAULT_DURATION_MS } = {}) {
  document.getElementById('ma-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'ma-toast';
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    ${actionLabel ? `<button type="button" class="toast-action">${escapeHtml(actionLabel)}</button>` : ''}
  `;

  document.body.appendChild(toast);

  let timer = setTimeout(close, durationMs);

  function close() {
    clearTimeout(timer);
    toast.remove();
  }

  toast.querySelector('.toast-action')?.addEventListener('click', () => {
    close();
    onAction?.();
  });

  return close;
}
