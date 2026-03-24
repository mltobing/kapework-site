/* help.js — Proof Grid 6×6: compact help modal */

"use strict";

var PG36Help = (function () {

  var _overlay = null;

  function _ensureDOM() {
    if (_overlay) return;
    _overlay = document.getElementById('help-modal6');
    if (!_overlay) return;

    var closeBtn = _overlay.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', close);

    _overlay.addEventListener('click', function (e) {
      if (e.target === _overlay) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !_overlay.hidden) close();
    });
  }

  function open() {
    _ensureDOM();
    if (_overlay) _overlay.hidden = false;
  }

  function close() {
    if (_overlay) _overlay.hidden = true;
  }

  return { open: open, close: close };

})();
