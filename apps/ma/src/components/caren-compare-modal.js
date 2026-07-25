/**
 * components/caren-compare-modal.js
 *
 * The owner-only "Vergelijk" dialog for an ambiguous Caren match: Ma's
 * expected item beside the Caren notification the matcher considered but could
 * not confidently accept.
 *
 * An ambiguous match is always resolved by a human. The matcher deliberately
 * refuses to guess, and no model is involved anywhere in the Caren path — the
 * two templates are parsed deterministically, and a candidate that does not
 * clear the automatic threshold lands here instead of being accepted quietly.
 *
 * Everything shown comes from an e-mail and is escaped by lib/caren-render.js.
 * No source message id, no Caren URL and no Caren person id is rendered.
 */

import { renderCarenCompare } from '../lib/caren-render.js';

/**
 * @param {object} item      the ambiguous expected item
 * @param {object} evidence  the candidate evidence row
 * @param {object} opts
 * @param {(decision: 'confirm_candidate'|'reject_candidate') => Promise<void>} opts.onDecision
 * @param {(iso: string) => string} opts.formatMoment
 * @param {(key: string) => string} opts.formatDay
 */
export function openCarenCompareModal(item, evidence, { onDecision, formatMoment, formatDay }) {
  document.getElementById('ma-caren-compare')?.remove();

  const modal = document.createElement('div');
  modal.id        = 'ma-caren-compare';
  modal.className = 'caren-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Caren-melding vergelijken');

  modal.innerHTML = `
    <div class="caren-modal-backdrop"></div>
    <div class="caren-modal-content">
      <button class="caren-modal-close" aria-label="Sluiten">×</button>
      ${renderCarenCompare(item, evidence, { formatMoment, formatDay })}
      <p class="caren-modal-error" hidden></p>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  const errorEl = modal.querySelector('.caren-modal-error');

  function close() {
    modal.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  modal.querySelectorAll('[data-caren-decision]').forEach(btn => {
    btn.addEventListener('click', async () => {
      modal.querySelectorAll('[data-caren-decision]').forEach(b => { b.disabled = true; });
      errorEl.hidden = true;
      try {
        await onDecision(btn.dataset.carenDecision);
        close();
      } catch (err) {
        // Controlled copy only — a raw PostgREST error is never shown.
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        modal.querySelectorAll('[data-caren-decision]').forEach(b => { b.disabled = false; });
      }
    });
  });

  modal.querySelector('.caren-modal-close').addEventListener('click', close);
  modal.querySelector('.caren-modal-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
}
