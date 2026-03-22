/**
 * ui.js — Longshot v2 DOM rendering and interaction
 *
 * Handles:
 * - Rendering the 4×4 letter board
 * - Tile selection interactions (tap / mouse)
 * - Current word display
 * - Shot slots display
 * - Medal progress bar
 * - Toast notifications
 * - Results overlay
 */

'use strict';

// ── DOM refs (populated in init) ──────────────────────────────────────────────
var _tileEls     = [];
var _wordEl      = null;
var _shotsEl     = null;
var _submitBtn   = null;
var _clearBtn    = null;
var _hintEl      = null;
var _medalEl     = null;
var _streakEl    = null;
var _toastEl     = null;
var _toastTimer  = null;
var _resultEl    = null;
var _puzzleNumEl = null;

// ── Callbacks (wired from main.js) ────────────────────────────────────────────
var _onTileSelect = null;
var _onSubmit     = null;
var _onClear      = null;
var _onShare      = null;

// ── Init ──────────────────────────────────────────────────────────────────────
function init(opts) {
  _onTileSelect = opts.onTileSelect;
  _onSubmit     = opts.onSubmit;
  _onClear      = opts.onClear;
  _onShare      = opts.onShare;

  _wordEl      = document.getElementById('ls-word');
  _shotsEl     = document.getElementById('ls-shots');
  _submitBtn   = document.getElementById('ls-submit');
  _clearBtn    = document.getElementById('ls-clear');
  _medalEl     = document.getElementById('ls-medal');
  _streakEl    = document.getElementById('ls-streak');
  _toastEl     = document.getElementById('ls-toast');
  _resultEl    = document.getElementById('ls-result');
  _puzzleNumEl = document.getElementById('ls-puzzle-num');

  if (_submitBtn) _submitBtn.addEventListener('click', function() { if (_onSubmit) _onSubmit(); });
  if (_clearBtn)  _clearBtn.addEventListener('click', function()  { if (_onClear)  _onClear();  });
}

// ── Board rendering ───────────────────────────────────────────────────────────
function buildBoard(grid) {
  var boardEl = document.getElementById('ls-board');
  if (!boardEl) return;

  boardEl.innerHTML = '';
  _tileEls = [];

  for (var i = 0; i < 16; i++) {
    var btn = document.createElement('button');
    btn.className    = 'ls-tile';
    btn.textContent  = grid[i].toUpperCase();
    btn.setAttribute('aria-label', grid[i].toUpperCase());
    btn.dataset.idx  = i;

    (function(idx) {
      btn.addEventListener('click', function() {
        if (_onTileSelect) _onTileSelect(idx);
      });
    })(i);

    boardEl.appendChild(btn);
    _tileEls.push(btn);
  }
}

// ── Tile state updates ────────────────────────────────────────────────────────
var TILE_NORMAL   = 'ls-tile';
var TILE_SELECTED = 'ls-tile ls-tile--selected';
var TILE_LAST     = 'ls-tile ls-tile--selected ls-tile--last';
var TILE_DISABLED = 'ls-tile ls-tile--disabled';

function updateTiles(path, done) {
  if (!_tileEls.length) return;
  for (var i = 0; i < 16; i++) {
    var el  = _tileEls[i];
    var pos = path.indexOf(i);
    if (done) {
      el.className = TILE_DISABLED;
    } else if (pos === -1) {
      el.className = TILE_NORMAL;
    } else if (pos === path.length - 1) {
      el.className = TILE_LAST;
    } else {
      el.className = TILE_SELECTED;
    }
    // Show position number in selected tiles
    el.textContent = '';
    if (pos !== -1 && !done) {
      var num = document.createElement('span');
      num.className = 'ls-tile-num';
      num.textContent = pos + 1;
      el.appendChild(num);
    }
    var letter = document.createElement('span');
    letter.textContent = _tileEls[i].dataset && _tileEls[i].dataset.letter
      ? _tileEls[i].dataset.letter
      : el.getAttribute('aria-label') || '';
    el.appendChild(letter);
  }
}

// Simpler update: just set class + content without numbers (cleaner look)
function renderTiles(grid, path, done) {
  if (!_tileEls.length) return;
  for (var i = 0; i < 16; i++) {
    var el  = _tileEls[i];
    var pos = path.indexOf(i);

    if (done) {
      el.className = TILE_DISABLED;
    } else if (pos === -1) {
      el.className = TILE_NORMAL;
    } else if (pos === path.length - 1) {
      el.className = TILE_LAST;
    } else {
      el.className = TILE_SELECTED;
    }

    el.textContent = grid[i].toUpperCase();
  }
}

// ── Word display ──────────────────────────────────────────────────────────────
function renderWord(word) {
  if (!_wordEl) return;
  if (word.length === 0) {
    _wordEl.textContent = '';
    _wordEl.className   = 'ls-word ls-word--empty';
  } else {
    _wordEl.textContent = word.toUpperCase();
    _wordEl.className   = word.length >= 5 ? 'ls-word ls-word--valid' : 'ls-word';
  }

  // Enable/disable submit
  if (_submitBtn) _submitBtn.disabled = word.length < 5;
  if (_clearBtn)  _clearBtn.style.visibility = word.length > 0 ? 'visible' : 'hidden';
}

// ── Shot slots ────────────────────────────────────────────────────────────────
function renderShots(shots, maxShots) {
  if (!_shotsEl) return;
  _shotsEl.innerHTML = '';
  for (var i = 0; i < maxShots; i++) {
    var slot = document.createElement('div');
    slot.className = 'ls-shot-slot';
    if (i < shots.length) {
      slot.className += ' ls-shot-slot--used';
      slot.textContent = shots[i].toUpperCase();
    } else {
      slot.className += ' ls-shot-slot--empty';
      var circle = document.createElement('span');
      circle.className = 'ls-shot-dot';
      slot.appendChild(circle);
    }
    _shotsEl.appendChild(slot);
  }
}

// ── Medal progress ────────────────────────────────────────────────────────────
var MEDAL_LABELS = { bronze: '🥉 Bronze', silver: '🥈 Silver', gold: '🥇 Gold', none: '' };

function renderMedal(medal) {
  if (!_medalEl) return;
  _medalEl.textContent = medal !== 'none' ? MEDAL_LABELS[medal] || '' : '';
  _medalEl.className   = 'ls-medal ls-medal--' + (medal || 'none');
}

// ── Streak ────────────────────────────────────────────────────────────────────
function renderStreak(n) {
  if (!_streakEl) return;
  _streakEl.textContent = n || 0;
}

// ── Puzzle number ─────────────────────────────────────────────────────────────
function renderPuzzleNum(n) {
  if (!_puzzleNumEl) return;
  _puzzleNumEl.textContent = '#' + n;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type) {
  if (!_toastEl) return;
  _toastEl.textContent = msg;
  _toastEl.className   = 'ls-toast ls-toast--' + (type || 'info') + ' ls-toast--show';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() {
    _toastEl.classList.remove('ls-toast--show');
  }, 2600);
}

// ── Shake animation on invalid submit ────────────────────────────────────────
function shakeWord() {
  if (!_wordEl) return;
  _wordEl.classList.remove('ls-shake');
  void _wordEl.offsetWidth; // reflow
  _wordEl.classList.add('ls-shake');
  setTimeout(function() { _wordEl.classList.remove('ls-shake'); }, 300);
}

// ── Results screen ────────────────────────────────────────────────────────────
function showResults(opts) {
  // opts: { shots, medal, featured, topWords, boardNum, streak, onShare, onClose }
  if (!_resultEl) return;

  var shots     = opts.shots || [];
  var medal     = opts.medal || 'none';
  var featured  = opts.featured || '';
  var topWords  = opts.topWords || [];
  var boardNum  = opts.boardNum || 0;
  var streak    = opts.streak || 0;

  var best      = shots.reduce(function(mx, w) { return Math.max(mx, w.length); }, 0);
  var medalLabel = { gold: '🥇 Gold', silver: '🥈 Silver', bronze: '🥉 Bronze', none: '—' }[medal] || '—';
  var foundLongshot = shots.indexOf(featured) !== -1;

  var missedWords = topWords.filter(function(w) {
    return shots.indexOf(w) === -1 && w !== featured;
  }).slice(0, 4);

  var html = [
    '<div class="ls-result-inner">',
    '  <h2 class="ls-result-title">Longshot #' + boardNum + '</h2>',
    '  <div class="ls-result-medal">' + medalLabel + '</div>',
    '  <div class="ls-result-stat">Best word: <strong>' + best + ' letters</strong></div>',
    '  <div class="ls-result-shots">',
  ];

  shots.forEach(function(w) {
    var isBest = w.length === best;
    html.push('    <div class="ls-result-word' + (isBest ? ' ls-result-word--best' : '') + '">' + w.toUpperCase() + '</div>');
  });

  html.push('  </div>');

  // Featured longshot word
  if (featured) {
    html.push('  <div class="ls-result-longshot">');
    if (foundLongshot) {
      html.push('    <div class="ls-result-longshot-label ls-result-longshot--found">You found the Longshot! 🎯</div>');
      html.push('    <div class="ls-result-longshot-word">' + featured.toUpperCase() + '</div>');
    } else {
      html.push('    <div class="ls-result-longshot-label">The Longshot word was:</div>');
      html.push('    <div class="ls-result-longshot-word">' + featured.toUpperCase() + '</div>');
    }
    html.push('  </div>');
  }

  // Other top words
  if (missedWords.length > 0) {
    html.push('  <div class="ls-result-also">');
    html.push('    <div class="ls-result-also-label">Also on the board:</div>');
    html.push('    <div class="ls-result-also-words">');
    missedWords.forEach(function(w) {
      html.push('      <span class="ls-result-also-word">' + w.toUpperCase() + '</span>');
    });
    html.push('    </div>');
    html.push('  </div>');
  }

  // Streak
  if (streak > 0) {
    html.push('  <div class="ls-result-streak">🔥 ' + streak + '-day streak</div>');
  }

  // Buttons
  html.push('  <div class="ls-result-actions">');
  html.push('    <button id="ls-result-share" class="ls-btn ls-btn--primary">Share</button>');
  html.push('    <button id="ls-result-close" class="ls-btn ls-btn--muted">Close</button>');
  html.push('  </div>');
  html.push('</div>');

  _resultEl.innerHTML = html.join('\n');
  _resultEl.hidden = false;

  var shareBtn = document.getElementById('ls-result-share');
  var closeBtn = document.getElementById('ls-result-close');

  if (shareBtn && opts.onShare) shareBtn.addEventListener('click', opts.onShare);
  if (closeBtn && opts.onClose) closeBtn.addEventListener('click', function() {
    _resultEl.hidden = true;
    if (opts.onClose) opts.onClose();
  });
}

function hideResults() {
  if (_resultEl) _resultEl.hidden = true;
}

window.LongshotUI = {
  init:          init,
  buildBoard:    buildBoard,
  renderTiles:   renderTiles,
  renderWord:    renderWord,
  renderShots:   renderShots,
  renderMedal:   renderMedal,
  renderStreak:  renderStreak,
  renderPuzzleNum: renderPuzzleNum,
  showToast:     showToast,
  shakeWord:     shakeWord,
  showResults:   showResults,
  hideResults:   hideResults,
};
