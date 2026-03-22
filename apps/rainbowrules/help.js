/**
 * help.js — Rainbow Rules compact help modal
 *
 * Explains: 5-color code, exact vs misplaced, the Rule Card mechanic.
 * No long tutorial — just what's needed to start playing.
 */

'use strict';

window.RRHelp = (function () {

  var _modal = null;

  function buildModal() {
    if (_modal) return;

    var overlay = document.createElement('div');
    overlay.className = 'rr-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'How to play Rainbow Rules');

    overlay.innerHTML = [
      '<div class="rr-modal">',
        '<button class="rr-modal-close" aria-label="Close help">&times;</button>',
        '<h2 class="rr-modal-title">How to Play</h2>',
        '<div class="rr-modal-body">',
          '<p>Guess the hidden <strong>5-color code</strong> in 6 tries.</p>',
          '<p>Tap colors to fill the active row, then hit <strong>Submit</strong>.</p>',
          '<div class="rr-help-rows">',
            '<div class="rr-help-row">',
              '<span class="rr-help-badge rr-help-exact">2 exact</span>',
              '<span>Right color, right slot.</span>',
            '</div>',
            '<div class="rr-help-row">',
              '<span class="rr-help-badge rr-help-miss">1 misplaced</span>',
              '<span>Right color, wrong slot.</span>',
            '</div>',
          '</div>',
          '<p>Each day a <strong>Rule Card</strong> tells you a constraint the hidden code obeys. Your guesses don\u2019t need to follow the rule \u2014 use it as a clue!</p>',
          '<p class="rr-help-note">Duplicates are allowed in the hidden code and in your guesses. Feedback counts are exact, not positional.</p>',
        '</div>',
      '</div>',
    ].join('');

    overlay.querySelector('.rr-modal-close').addEventListener('click', closeHelp);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeHelp();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _modal && _modal.classList.contains('rr-modal-overlay--open')) {
        closeHelp();
      }
    });

    document.body.appendChild(overlay);
    _modal = overlay;
  }

  function openHelp() {
    if (!_modal) buildModal();
    _modal.classList.add('rr-modal-overlay--open');
  }

  function closeHelp() {
    if (_modal) _modal.classList.remove('rr-modal-overlay--open');
  }

  return {
    buildModal: buildModal,
    openHelp:   openHelp,
    closeHelp:  closeHelp,
  };
})();
