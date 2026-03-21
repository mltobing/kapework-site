/* shared/kapework-shell.js — Kapework shared ellipsis menu + feedback modal
 *
 * Usage A — full shell with ⋮ button:
 *   KapeworkShell.init({
 *     appSlug:  'proofgrid',          // required
 *     mountId:  'kw-shell-mount',     // id of element to inject ⋮ button into
 *     menuItems: [                    // items above the always-present Feedback row
 *       {
 *         id:      'how-to-play',
 *         icon:    '<svg .../>',      // SVG string, 18×18
 *         label:   'How to play',
 *         onClick: function() { ... }
 *       }
 *     ]
 *   });
 *
 * Usage B — feedback modal only (app has its own menu):
 *   KapeworkShell.init({ appSlug: 'prim4' });
 *   // Then wire your own button: KapeworkShell.openFeedback()
 *
 * Requires: KapeworkAnalytics must be loaded first (for track()).
 * Requires: /shared/kapework-shell.css loaded in <head>.
 */
(function () {
  'use strict';

  // ── SVG icons ──────────────────────────────────────────────────────────────
  var ICON_MORE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  var ICON_FEEDBACK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  // ── State ──────────────────────────────────────────────────────────────────
  var _appSlug = 'unknown';
  var _menuOpen = false;
  var _feedbackOpen = false;
  var _menuEl = null;
  var _backdropEl = null;
  var _moreBtn = null;
  var _feedbackOverlay = null;
  var _feedbackTextarea = null;
  var _feedbackEmail = null;
  var _feedbackSendBtn = null;
  var _toastEl = null;
  var _toastTimer = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function track(eventName) {
    if (window.KapeworkAnalytics) {
      window.KapeworkAnalytics.track(eventName);
    }
  }

  function showToast(msg) {
    if (!_toastEl) return;
    _toastEl.textContent = msg;
    _toastEl.classList.add('kw-toast--show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      _toastEl.classList.remove('kw-toast--show');
    }, 2800);
  }

  // ── Menu open / close ──────────────────────────────────────────────────────
  function openMenu() {
    if (!_menuEl || _menuOpen) return;
    _menuOpen = true;
    _menuEl.classList.add('kw-menu--open');
    if (_moreBtn) _moreBtn.setAttribute('aria-expanded', 'true');
    if (_backdropEl) _backdropEl.style.display = 'block';
    track('menu_open');
  }

  function closeMenu() {
    if (!_menuEl || !_menuOpen) return;
    _menuOpen = false;
    _menuEl.classList.remove('kw-menu--open');
    if (_moreBtn) _moreBtn.setAttribute('aria-expanded', 'false');
    if (_backdropEl) _backdropEl.style.display = 'none';
  }

  // ── Feedback modal open / close ────────────────────────────────────────────
  function openFeedback() {
    closeMenu();
    _feedbackOpen = true;
    _feedbackOverlay.classList.add('kw-modal--open');
    _feedbackTextarea.value = '';
    _feedbackEmail.value = '';
    _feedbackSendBtn.disabled = false;
    _feedbackSendBtn.textContent = 'Send';
    setTimeout(function () { _feedbackTextarea.focus(); }, 180);
    track('feedback_open');
  }

  function closeFeedback() {
    if (!_feedbackOpen) return;
    _feedbackOpen = false;
    _feedbackOverlay.classList.remove('kw-modal--open');
  }

  // ── Feedback submit ────────────────────────────────────────────────────────
  function submitFeedback() {
    var message = _feedbackTextarea.value.trim();
    if (!message) {
      _feedbackTextarea.focus();
      return;
    }

    _feedbackSendBtn.disabled = true;
    _feedbackSendBtn.textContent = 'Sending…';

    var deviceId = window.KapeworkAnalytics
      ? window.KapeworkAnalytics.getDeviceId()
      : null;

    var payload = {
      message:  message,
      email:    _feedbackEmail.value.trim() || null,
      app_slug: _appSlug,
      url:      location.href,
      device_id: deviceId
    };

    fetch('/.netlify/functions/submit-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        track('feedback_submit');
        closeFeedback();
        showToast('Thanks for your feedback!');
      })
      .catch(function () {
        _feedbackSendBtn.disabled = false;
        _feedbackSendBtn.textContent = 'Send';
        showToast('Could not send — please try again.');
      });
  }

  // ── Build feedback modal + toast (always built) ────────────────────────────
  function buildFeedbackInfra() {
    // Feedback modal
    _feedbackOverlay = document.createElement('div');
    _feedbackOverlay.className = 'kw-modal-overlay';
    _feedbackOverlay.setAttribute('role', 'dialog');
    _feedbackOverlay.setAttribute('aria-modal', 'true');
    _feedbackOverlay.setAttribute('aria-label', 'Send feedback');

    var modal = document.createElement('div');
    modal.className = 'kw-modal';

    var h2 = document.createElement('h2');
    h2.textContent = 'Send feedback';
    modal.appendChild(h2);

    _feedbackTextarea = document.createElement('textarea');
    _feedbackTextarea.className = 'kw-feedback-textarea';
    _feedbackTextarea.placeholder = "What's confusing? Bugs? Ideas?";
    _feedbackTextarea.setAttribute('rows', '4');
    modal.appendChild(_feedbackTextarea);

    _feedbackEmail = document.createElement('input');
    _feedbackEmail.type = 'email';
    _feedbackEmail.className = 'kw-feedback-email';
    _feedbackEmail.placeholder = 'Your email (optional, for a reply)';
    _feedbackEmail.setAttribute('autocomplete', 'email');
    _feedbackEmail.setAttribute('autocapitalize', 'off');
    modal.appendChild(_feedbackEmail);

    _feedbackSendBtn = document.createElement('button');
    _feedbackSendBtn.className = 'kw-feedback-send';
    _feedbackSendBtn.textContent = 'Send';
    _feedbackSendBtn.addEventListener('click', submitFeedback);
    modal.appendChild(_feedbackSendBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'kw-feedback-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeFeedback);
    modal.appendChild(closeBtn);

    _feedbackOverlay.appendChild(modal);

    _feedbackOverlay.addEventListener('click', function (e) {
      if (e.target === _feedbackOverlay) closeFeedback();
    });

    document.body.appendChild(_feedbackOverlay);

    // Toast
    _toastEl = document.createElement('div');
    _toastEl.className = 'kw-toast';
    document.body.appendChild(_toastEl);

    // Escape key closes both
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenu();
        closeFeedback();
      }
    });
  }

  // ── Build ⋮ button + dropdown (only when mountEl provided) ─────────────────
  function buildMenuButton(mountEl, menuItems) {
    // Wrapper (keeps ⋮ + dropdown together for positioning)
    var root = document.createElement('div');
    root.className = 'kw-shell-root';

    // ⋮ button
    _moreBtn = document.createElement('button');
    _moreBtn.className = 'kw-more-btn';
    _moreBtn.setAttribute('aria-label', 'More options');
    _moreBtn.setAttribute('aria-expanded', 'false');
    _moreBtn.setAttribute('aria-haspopup', 'true');
    _moreBtn.innerHTML = ICON_MORE;
    root.appendChild(_moreBtn);

    // Dropdown menu
    _menuEl = document.createElement('div');
    _menuEl.className = 'kw-menu';
    _menuEl.setAttribute('role', 'menu');

    // Caller-supplied items
    (menuItems || []).forEach(function (item) {
      var btn = document.createElement('button');
      btn.className = 'kw-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = (item.icon || '') + '<span>' + item.label + '</span>';
      btn.addEventListener('click', function () {
        closeMenu();
        if (item.onClick) item.onClick();
      });
      _menuEl.appendChild(btn);
    });

    // Always-present Feedback item
    var fbBtn = document.createElement('button');
    fbBtn.className = 'kw-menu-item';
    fbBtn.setAttribute('role', 'menuitem');
    fbBtn.innerHTML = ICON_FEEDBACK + '<span>Send feedback</span>';
    fbBtn.addEventListener('click', openFeedback);
    _menuEl.appendChild(fbBtn);

    root.appendChild(_menuEl);
    mountEl.appendChild(root);

    // Backdrop (closes menu on outside tap)
    _backdropEl = document.createElement('div');
    _backdropEl.className = 'kw-backdrop';
    _backdropEl.style.display = 'none';
    _backdropEl.addEventListener('click', closeMenu);
    document.body.appendChild(_backdropEl);

    // Wire ⋮ button
    _moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_menuOpen) { closeMenu(); } else { openMenu(); }
    });
  }

  // ── Public init ────────────────────────────────────────────────────────────
  function init(config) {
    _appSlug = config.appSlug || 'unknown';

    buildFeedbackInfra();

    if (config.mountId) {
      var mountEl = document.getElementById(config.mountId);
      if (mountEl) {
        buildMenuButton(mountEl, config.menuItems || []);
      } else {
        console.warn('KapeworkShell: mount element #' + config.mountId + ' not found');
      }
    }
  }

  window.KapeworkShell = { init: init, openFeedback: openFeedback };
}());
