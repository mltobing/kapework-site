/**
 * main.js — Longshot v2 application entry point
 *
 * Wires together: board-bank, game, ui, storage, share, help, analytics, shell.
 */

'use strict';

var G  = window.LongshotGame;
var UI = window.LongshotUI;
var BB = window.LongshotBoardBank;
var ST = window.LongshotStorage;
var SH = window.LongshotShare;
var HP = window.LongshotHelp;
var LX = window.LongshotLexicon;

var _dateKey = '';
var _board   = null;

// ── Analytics helper ──────────────────────────────────────────────────────────
function track(name, props) {
  if (window.KapeworkAnalytics) window.KapeworkAnalytics.track(name, props);
}

// ── Full UI sync from game state ──────────────────────────────────────────────
function syncUI() {
  var path  = G.getPath();
  var word  = G.getCurrentWord();
  var shots = G.getShots();
  var done  = G.isDone();

  UI.renderTiles(_board.grid, path, done);
  UI.renderWord(word);
  UI.renderShots(shots, G.MAX_SHOTS);
  UI.renderMedal(G.getMedal());
}

// ── Tile selection ────────────────────────────────────────────────────────────
function onTileSelect(idx) {
  if (G.isDone()) return;

  var wasEmpty = G.getPath().length === 0;
  var changed  = G.selectTile(idx);

  if (!changed) {
    UI.showToast('Not adjacent', 'warn');
    return;
  }

  if (wasEmpty && G.getPath().length === 1) {
    track('first_interaction');
  }

  syncUI();
}

// ── Submit ────────────────────────────────────────────────────────────────────
function onSubmit() {
  if (G.isDone()) return;

  var result = G.submitWord();

  if (result.valid) {
    var shots = G.getShots();
    track('word_submit_valid', { word_length: result.word.length, shot_num: shots.length });

    syncUI();
    ST.saveDailyState(_dateKey, G.getState());

    if (G.isDone()) {
      finishGame();
    } else {
      var left = G.shotsLeft();
      UI.showToast(result.word.toUpperCase() + ' +' + result.word.length, 'ok');
    }
  } else {
    track('word_submit_invalid', { reason: result.reason, word_length: result.word.length });
    UI.shakeWord();
    UI.showToast(result.reason, 'err');
  }
}

// ── Clear path ────────────────────────────────────────────────────────────────
function onClear() {
  G.clearPath();
  syncUI();
}

// ── Game completion ───────────────────────────────────────────────────────────
function finishGame() {
  var shots  = G.getShots();
  var medal  = G.getMedal();
  var streak = ST.recordCompletion(_dateKey);

  ST.saveDailyState(_dateKey, G.getState());

  track('run_complete', { medal: medal, best_length: G.getBestLength(), shots: shots.length });
  if (medal !== 'none') track('medal_earned', { medal: medal });

  UI.renderStreak(streak);
  syncUI();

  setTimeout(function() {
    UI.showResults({
      shots:    shots,
      medal:    medal,
      featured: _board.featured,
      topWords: _board.topWords,
      boardNum: _board.puzzleNumber,
      streak:   streak,
      onShare:  onShare,
      onClose:  function() { syncUI(); },
    });
  }, 400);
}

// ── Share ─────────────────────────────────────────────────────────────────────
function onShare() {
  track('share_click');
  SH.share(G.getShots(), G.getMedal(), _board.puzzleNumber, function() {
    UI.showToast('Copied to clipboard!', 'ok');
  });
}

// ── App boot ──────────────────────────────────────────────────────────────────
async function boot() {
  _dateKey = ST.todayKey();

  // Load board and lexicon in parallel
  var _lexicon;
  try {
    var results = await Promise.all([
      BB.loadBoard(_dateKey),
      LX.loadLexicon(),
    ]);
    _board   = results[0];
    _lexicon = results[1];
  } catch (e) {
    document.getElementById('ls-loading').textContent = 'Failed to load today\'s board.';
    console.error('Board load failed:', e);
    return;
  }

  document.getElementById('ls-loading').hidden = true;
  document.getElementById('ls-app').hidden     = false;

  // Restore or init game state
  var saved = ST.loadDailyState(_dateKey);
  if (saved && saved.boardId !== _board.id) saved = null; // board changed — reset
  G.init(_board, saved, _lexicon);

  // Init UI (sets DOM refs + event listeners) before any render calls
  UI.init({
    onTileSelect: onTileSelect,
    onSubmit:     onSubmit,
    onClear:      onClear,
    onShare:      onShare,
  });

  // Build board + initial render
  UI.buildBoard(_board.grid);
  UI.renderPuzzleNum(_board.puzzleNumber);
  UI.renderStreak(ST.loadStreak());
  HP.buildHelpModal();

  syncUI();

  // Analytics + shell
  if (window.KapeworkAnalytics) {
    window.KapeworkAnalytics.init('longshot');
    track('game_start', { board_id: _board.id, puzzle_num: _board.puzzleNumber });
  }

  if (window.KapeworkShell) {
    window.KapeworkShell.init({
      appSlug:  'longshot',
      mountId:  'kw-shell-mount',
      menuItems: [{
        id:    'how-to-play',
        icon:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        label: 'How to play',
        onClick: function() {
          HP.openHelp();
        },
      }],
    });
  }

  // If already completed today, show the result immediately
  if (G.isDone()) {
    var streak = ST.loadStreak();
    setTimeout(function() {
      UI.showResults({
        shots:    G.getShots(),
        medal:    G.getMedal(),
        featured: _board.featured,
        topWords: _board.topWords,
        boardNum: _board.puzzleNumber,
        streak:   streak,
        onShare:  onShare,
        onClose:  function() {},
      });
    }, 200);
  }
}

document.addEventListener('DOMContentLoaded', boot);
