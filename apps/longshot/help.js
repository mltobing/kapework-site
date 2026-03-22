/**
 * help.js — Longshot v2 help modal
 */

'use strict';

function buildHelpModal() {
  var overlay = document.createElement('div');
  overlay.id        = 'ls-help-overlay';
  overlay.className = 'ls-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'How to play');
  overlay.hidden    = true;

  var box = document.createElement('div');
  box.className = 'ls-modal';

  box.innerHTML = [
    '<h2>How to play</h2>',
    '<ul class="ls-help-list">',
    '  <li><strong>Tap letters</strong> to trace a word on the 4×4 board.</li>',
    '  <li>Letters must be <strong>adjacent</strong> (8 directions). Each tile can only be used once per word.</li>',
    '  <li>Words must be <strong>5+ letters</strong>, common English words only — no proper nouns.</li>',
    '  <li>You get <strong>3 valid shots</strong> per day. Invalid words do not use a shot.</li>',
    '  <li>Tap the <strong>last letter again</strong> to undo it.</li>',
    '</ul>',
    '<div class="ls-help-medals">',
    '  <div class="ls-medal-row"><span class="ls-medal ls-medal--bronze">🥉</span><span>Bronze — best word is 5 letters</span></div>',
    '  <div class="ls-medal-row"><span class="ls-medal ls-medal--silver">🥈</span><span>Silver — best word is 6 letters</span></div>',
    '  <div class="ls-medal-row"><span class="ls-medal ls-medal--gold">🥇</span><span>Gold — best word is 7+ letters</span></div>',
    '</div>',
    '<p class="ls-help-tip">There is one hidden <strong>Longshot</strong> word on every board (8+ letters when possible). Find it for ultimate bragging rights!</p>',
    '<button id="ls-help-close" class="ls-btn ls-btn--primary" style="width:100%;margin-top:12px">Got it</button>',
  ].join('');

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeHelp();
  });

  document.getElementById('ls-help-close').addEventListener('click', closeHelp);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeHelp();
  });
}

function openHelp() {
  var el = document.getElementById('ls-help-overlay');
  if (el) { el.hidden = false; el.focus(); }
  if (window.KapeworkAnalytics) window.KapeworkAnalytics.track('help_open');
}

function closeHelp() {
  var el = document.getElementById('ls-help-overlay');
  if (el) el.hidden = true;
}

window.LongshotHelp = { buildHelpModal: buildHelpModal, openHelp: openHelp, closeHelp: closeHelp };
