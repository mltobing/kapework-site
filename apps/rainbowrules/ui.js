/**
 * ui.js — Rainbow Rules DOM rendering
 *
 * Responsibilities:
 *   - Build and update the 6-row guess board
 *   - Render completed rows with color slots + feedback (exact ✓ / misplaced ↕)
 *   - Build the 6-button color tray
 *   - Update the active row as colors are entered
 *   - Show/hide the result bottom sheet
 *   - Render rule card, puzzle number, streak
 *   - Toast notifications
 *   - Shake animation on invalid submit attempt
 *
 * Feedback is count-based (Mastermind style), NOT positional Wordle coloring.
 */

'use strict';

window.RRUI = (function () {

  var P = window.RRPalette;

  var MAX_GUESSES = 6;
  var CODE_LENGTH = 4;

  // DOM refs (set in init)
  var _board     = null;
  var _tray      = null;
  var _deleteBtn = null;
  var _submitBtn = null;
  var _ruleLabel = null;
  var _ruleDesc  = null;
  var _puzzleNum = null;
  var _streakVal = null;
  var _resultEl  = null;
  var _toastEl   = null;

  // Callbacks
  var _onColor  = null;
  var _onDelete = null;
  var _onSubmit = null;
  var _onShare  = null;

  // ── Init ───────────────────────────────────────────────────────────────────

  function init(opts) {
    _onColor  = opts.onColor;
    _onDelete = opts.onDelete;
    _onSubmit = opts.onSubmit;
    _onShare  = opts.onShare;

    _board     = document.getElementById('rr-board');
    _tray      = document.getElementById('rr-tray');
    _deleteBtn = document.getElementById('rr-delete');
    _submitBtn = document.getElementById('rr-submit');
    _ruleLabel = document.getElementById('rr-rule-label');
    _ruleDesc  = document.getElementById('rr-rule-desc');
    _puzzleNum = document.getElementById('rr-puzzle-num');
    _streakVal = document.getElementById('rr-streak-val');
    _resultEl  = document.getElementById('rr-result');
    _toastEl   = document.getElementById('rr-toast');

    _deleteBtn.addEventListener('click', function () { if (_onDelete) _onDelete(); });
    _submitBtn.addEventListener('click', function () { if (_onSubmit) _onSubmit(); });

    _buildBoard();
    _buildTray();
  }

  // ── Board ──────────────────────────────────────────────────────────────────

  function _buildBoard() {
    _board.innerHTML = '';
    for (var r = 0; r < MAX_GUESSES; r++) {
      var row = document.createElement('div');
      row.className  = 'rr-row';
      row.dataset.row = String(r);

      // 5 color slots
      var slotsEl = document.createElement('div');
      slotsEl.className = 'rr-slots';
      for (var s = 0; s < CODE_LENGTH; s++) {
        var slot = document.createElement('div');
        slot.className   = 'rr-slot rr-slot--empty';
        slot.dataset.slot = String(s);
        slotsEl.appendChild(slot);
      }

      // Feedback area (exact + misplaced counters)
      var fbEl = document.createElement('div');
      fbEl.className = 'rr-feedback';
      fbEl.innerHTML =
        '<span class="rr-fb-exact" aria-label="exact">\u25CE</span>' +
        '<span class="rr-fb-miss"  aria-label="misplaced">\u2194</span>';

      row.appendChild(slotsEl);
      row.appendChild(fbEl);
      _board.appendChild(row);
    }
  }

  // ── Tray ───────────────────────────────────────────────────────────────────

  function _buildTray() {
    _tray.innerHTML = '';
    P.COLORS.forEach(function (color) {
      var btn = document.createElement('button');
      btn.className            = 'rr-color-btn';
      btn.style.background     = color.css;
      btn.setAttribute('aria-label', color.name);
      btn.dataset.colorId      = color.id;
      btn.innerHTML            =
        '<span class="rr-color-label" aria-hidden="true">' + color.label + '</span>';
      btn.addEventListener('click', function () {
        if (_onColor) _onColor(color.id);
      });
      _tray.appendChild(btn);
    });
  }

  // ── Slot helpers ───────────────────────────────────────────────────────────

  function _fillSlot(slotEl, colorId) {
    var color = P.byId(colorId);
    if (!color) return;
    slotEl.className        = 'rr-slot rr-slot--filled';
    slotEl.style.background = color.css;
    slotEl.textContent      = color.label;
    slotEl.setAttribute('aria-label', color.name);
  }

  function _clearSlot(slotEl) {
    slotEl.className        = 'rr-slot rr-slot--empty';
    slotEl.style.background = '';
    slotEl.textContent      = '';
    slotEl.removeAttribute('aria-label');
  }

  // ── Full board render ──────────────────────────────────────────────────────
  // Call after every state change. Idempotent.

  function renderBoard(guesses, currentRow, done) {
    var rows = _board.querySelectorAll('.rr-row');

    rows.forEach(function (row, r) {
      var slots = row.querySelectorAll('.rr-slot');
      var fbEl  = row.querySelector('.rr-feedback');
      var exact = fbEl.querySelector('.rr-fb-exact');
      var miss  = fbEl.querySelector('.rr-fb-miss');

      if (r < guesses.length) {
        // ── Completed guess ──────────────────────────────────────────────────
        row.classList.remove('rr-row--active');
        row.classList.add('rr-row--done');
        var g = guesses[r];
        slots.forEach(function (slot, s) { _fillSlot(slot, g.colors[s]); });
        exact.textContent = '\u25CE\u2009' + g.exact;      // ◎ N
        miss.textContent  = '\u2194\u2009' + g.misplaced;  // ↔ N
        exact.setAttribute('title', g.exact + ' right spot');
        miss.setAttribute('title',  g.misplaced + ' right color, wrong spot');

      } else if (r === guesses.length && !done) {
        // ── Active row ───────────────────────────────────────────────────────
        row.classList.add('rr-row--active');
        row.classList.remove('rr-row--done');
        slots.forEach(function (slot, s) {
          if (s < currentRow.length) _fillSlot(slot, currentRow[s]);
          else _clearSlot(slot);
        });
        exact.textContent = '\u25CE';
        miss.textContent  = '\u2194';

      } else {
        // ── Future / empty row ───────────────────────────────────────────────
        row.classList.remove('rr-row--active');
        row.classList.remove('rr-row--done');
        slots.forEach(_clearSlot);
        exact.textContent = '\u25CE';
        miss.textContent  = '\u2194';
      }
    });

    // Button state
    _submitBtn.disabled = (currentRow.length < CODE_LENGTH) || done;
    _deleteBtn.disabled = (currentRow.length === 0) || done;
  }

  // ── Rule card ──────────────────────────────────────────────────────────────

  function renderRuleCard(rule) {
    if (_ruleLabel) _ruleLabel.textContent = rule.label;
    if (_ruleDesc)  _ruleDesc.textContent  = rule.description;
  }

  // ── Meta ───────────────────────────────────────────────────────────────────

  function renderPuzzleNum(n) {
    if (_puzzleNum) _puzzleNum.textContent = '#' + n;
  }

  function renderStreak(n) {
    if (_streakVal) _streakVal.textContent = n;
  }

  // ── Result bottom sheet ────────────────────────────────────────────────────

  var MEDAL_DATA = {
    gold:   { emoji: '\uD83E\uDD47', label: 'Gold',       cls: 'rr-medal--gold'   },
    silver: { emoji: '\uD83E\uDD48', label: 'Silver',     cls: 'rr-medal--silver' },
    bronze: { emoji: '\uD83E\uDD49', label: 'Bronze',     cls: 'rr-medal--bronze' },
    fail:   { emoji: '\uD83D\uDC94', label: 'Not solved', cls: 'rr-medal--fail'   },
  };

  function showResult(opts) {
    // opts: { medal, guessCount, maxGuesses, rule, secret, stats, onShare }
    var md          = MEDAL_DATA[opts.medal] || MEDAL_DATA.fail;
    var countLabel  = opts.medal === 'fail'
      ? opts.guessCount + '/' + opts.maxGuesses + ' \u2014 not solved'
      : opts.guessCount + '/' + opts.maxGuesses;

    var secretHtml = opts.secret.map(function (id) {
      var c = P.byId(id);
      if (!c) return '';
      return '<span class="rr-result-tile" style="background:' + c.css + '" ' +
             'aria-label="' + c.name + '">' + c.label + '</span>';
    }).join('');

    var statsHtml = '';
    if (opts.stats) {
      var s   = opts.stats;
      var avg = s.totalSolved > 0 ? (s.totalGuesses / s.totalSolved).toFixed(1) : '\u2014';
      var pct = s.totalPlayed > 0 ? Math.round((s.totalSolved / s.totalPlayed) * 100) : 0;
      statsHtml = [
        '<div class="rr-stats" aria-label="Your statistics">',
          '<div class="rr-stat"><strong>' + s.streak     + '</strong><span>Streak</span></div>',
          '<div class="rr-stat"><strong>' + s.bestStreak + '</strong><span>Best</span></div>',
          '<div class="rr-stat"><strong>' + s.goldDays   + '</strong><span>Gold</span></div>',
          '<div class="rr-stat"><strong>' + pct + '%</strong><span>Solved</span></div>',
        '</div>',
      ].join('');
    }

    _resultEl.innerHTML = [
      '<div class="rr-result-panel">',
        '<div class="rr-result-medal ' + md.cls + '" aria-label="' + md.label + '">' + md.emoji + '</div>',
        '<div class="rr-result-count">' + countLabel + '</div>',
        '<div class="rr-result-rule">Rule: <strong>' + opts.rule.label + '</strong></div>',
        '<div class="rr-result-answer">',
          '<div class="rr-result-answer-label">The code was</div>',
          '<div class="rr-result-tiles" aria-label="Hidden code">' + secretHtml + '</div>',
        '</div>',
        statsHtml,
        '<button class="rr-share-btn" id="rr-share-btn">Share result</button>',
        '<button class="rr-close-btn" id="rr-close-btn">View board</button>',
      '</div>',
    ].join('');

    document.getElementById('rr-share-btn').addEventListener('click', function () {
      if (opts.onShare) opts.onShare();
    });
    document.getElementById('rr-close-btn').addEventListener('click', function () {
      _resultEl.classList.remove('rr-result-overlay--open');
    });

    _resultEl.classList.add('rr-result-overlay--open');
  }

  function showResultDelayed(opts) {
    setTimeout(function () { showResult(opts); }, 500);
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  var _toastTimer = null;

  function showToast(msg, type) {
    if (!_toastEl) return;
    _toastEl.textContent = msg;
    _toastEl.className   = 'rr-toast rr-toast--' + (type || 'info') + ' rr-toast--show';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      _toastEl.classList.remove('rr-toast--show');
    }, 2200);
  }

  // ── Shake ──────────────────────────────────────────────────────────────────

  function shakeActiveRow() {
    var active = _board.querySelector('.rr-row--active');
    if (!active) return;
    active.classList.add('rr-shake');
    setTimeout(function () { active.classList.remove('rr-shake'); }, 420);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    init:              init,
    renderBoard:       renderBoard,
    renderRuleCard:    renderRuleCard,
    renderPuzzleNum:   renderPuzzleNum,
    renderStreak:      renderStreak,
    showResult:        showResult,
    showResultDelayed: showResultDelayed,
    showToast:         showToast,
    shakeActiveRow:    shakeActiveRow,
  };
})();
