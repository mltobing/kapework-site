/* result-modal.js — Proof Grid 6×6: polished solve result modal */

"use strict";

var PG36ResultModal = (function () {

  var _overlay = null;
  var _onPlayAnother = null;
  var _onShare = null;

  function _formatTime(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60), sec = s % 60;
    return m + 'm' + (sec > 0 ? ' ' + sec + 's' : '');
  }

  function _ensureDOM() {
    if (_overlay) return;
    _overlay = document.getElementById('result-modal6');
    if (!_overlay) return;

    // Close on backdrop tap
    _overlay.addEventListener('click', function (e) {
      if (e.target === _overlay) close();
    });

    // Play Another
    var btnPlayAnother = _overlay.querySelector('#rm6-play-another');
    if (btnPlayAnother) {
      btnPlayAnother.addEventListener('click', function () {
        close();
        if (_onPlayAnother) _onPlayAnother();
      });
    }

    // Share
    var btnShare = _overlay.querySelector('#rm6-share');
    if (btnShare) {
      btnShare.addEventListener('click', function () {
        if (_onShare) _onShare(btnShare);
      });
    }
  }

  /**
   * Show the result modal.
   * @param {object} opts
   *   opts.tier        - 'Perfect' | 'Clean' | 'Solved'
   *   opts.elapsed     - milliseconds
   *   opts.failed      - failed check count
   *   opts.maxChecks   - total checks allowed
   *   opts.streak      - current streak integer
   *   opts.isPractice  - boolean (hides streak / footer for practice)
   *   opts.onPlayAnother - callback
   *   opts.onShare       - callback(btnEl)
   */
  function show(opts) {
    _ensureDOM();
    if (!_overlay) return;

    opts = opts || {};
    _onPlayAnother = opts.onPlayAnother || null;
    _onShare       = opts.onShare || null;

    var tier      = opts.tier || 'Solved';
    var elapsed   = opts.elapsed || 0;
    var failed    = opts.failed || 0;
    var maxChecks = opts.maxChecks || 1;
    var streak    = opts.streak || 1;
    var practice  = !!opts.isPractice;

    _set('#rm6-tier',   tier);
    _set('#rm6-date',   new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    }));
    _set('#rm6-pill',   practice ? 'Expert · Practice' : 'Expert');
    _set('#rm6-time',   _formatTime(elapsed));
    _set('#rm6-checks', failed + '/' + maxChecks);
    _set('#rm6-streak', practice ? '—' : String(streak));

    var footer = _overlay.querySelector('.rm6-footer');
    if (footer) footer.hidden = !!practice;

    _overlay.hidden = false;
  }

  function close() {
    if (_overlay) _overlay.hidden = true;
  }

  function _set(selector, text) {
    var el = _overlay.querySelector(selector);
    if (el) el.textContent = text;
  }

  return { show: show, close: close };

})();
