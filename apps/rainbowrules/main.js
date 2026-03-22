/**
 * main.js — Rainbow Rules application entry point
 *
 * Wires together: game, ui, storage, share, help, analytics, KapeworkShell.
 */

'use strict';

(function () {

  var G  = window.RRGame;
  var UI = window.RRUI;
  var ST = window.RRStorage;
  var SH = window.RRShare;
  var HP = window.RRHelp;

  var _dateKey = '';
  var _puzzle  = null;

  // ── Analytics helper ───────────────────────────────────────────────────────

  function track(name, props) {
    if (window.KapeworkAnalytics) {
      window.KapeworkAnalytics.track(name, props || {});
    }
  }

  // ── Sync UI → current game state ───────────────────────────────────────────

  function sync() {
    UI.renderBoard(G.getGuesses(), G.getCurrentRow(), G.isDone());
  }

  // ── Color tapped ───────────────────────────────────────────────────────────

  function onColor(colorId) {
    if (G.isDone()) return;

    var isFirstInput = (G.getGuesses().length === 0 && G.getCurrentRow().length === 0);
    var ok = G.pushColor(colorId);
    if (!ok) return;

    if (isFirstInput) track('first_interaction', { puzzle_num: _puzzle.puzzleNum });
    sync();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  function onDelete() {
    if (G.isDone()) return;
    G.deleteColor();
    sync();
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  function onSubmit() {
    if (G.isDone()) return;

    var result = G.submitGuess();

    if (!result.ok) {
      UI.showToast(result.reason, 'warn');
      UI.shakeActiveRow();
      return;
    }

    track('guess_submit', {
      guess_num: G.getGuesses().length,
      exact:     result.guess.exact,
      misplaced: result.guess.misplaced,
    });

    ST.saveDailyState(_dateKey, G.getState());
    sync();

    if (result.done) {
      finishGame(result.won);
    }
  }

  // ── Share ──────────────────────────────────────────────────────────────────

  function onShare() {
    track('share_click', { puzzle_num: _puzzle.puzzleNum });
    SH.share(
      _puzzle.puzzleNum,
      G.getMedal(),
      G.getGuesses().length,
      G.MAX_GUESSES,
      _puzzle.rule.label,
      function () { UI.showToast('Copied!', 'ok'); }
    );
  }

  // ── Game completion ────────────────────────────────────────────────────────

  function finishGame(won) {
    var medal      = G.getMedal();
    var guessCount = G.getGuesses().length;
    var stats      = ST.recordCompletion(_dateKey, medal, guessCount);

    ST.saveDailyState(_dateKey, G.getState());

    track(won ? 'solve_success' : 'solve_fail', {
      medal:      medal,
      guesses:    guessCount,
      puzzle_num: _puzzle.puzzleNum,
      rule:       _puzzle.rule.id,
    });
    if (medal && medal !== 'fail') {
      track('medal_earned', { medal: medal });
    }

    UI.renderStreak(stats.streak);

    UI.showResultDelayed({
      medal:      medal,
      guessCount: guessCount,
      maxGuesses: G.MAX_GUESSES,
      rule:       _puzzle.rule,
      secret:     _puzzle.secret,
      stats:      stats,
      onShare:    onShare,
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  function boot() {
    _dateKey = ST.todayKey();
    _puzzle  = G.getDailyPuzzle(_dateKey);

    // Restore saved state for today if available
    var saved = ST.loadDailyState(_dateKey);
    G.init(_puzzle, saved);

    // Init UI (attaches event listeners)
    UI.init({
      onColor:  onColor,
      onDelete: onDelete,
      onSubmit: onSubmit,
      onShare:  onShare,
    });

    // Initial render
    UI.renderPuzzleNum(_puzzle.puzzleNum);
    UI.renderRuleCard(_puzzle.rule);
    UI.renderStreak(ST.loadStats().streak);
    HP.buildModal();
    sync();

    // Analytics
    if (window.KapeworkAnalytics) {
      window.KapeworkAnalytics.init('rainbowrules');
      track('game_start', {
        puzzle_num: _puzzle.puzzleNum,
        rule:       _puzzle.rule.id,
      });
    }

    // Shared shell (⋮ menu with How to play + feedback)
    if (window.KapeworkShell) {
      window.KapeworkShell.init({
        appSlug:  'rainbowrules',
        mountId:  'kw-shell-mount',
        menuItems: [
          {
            id:    'how-to-play',
            icon:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            label: 'How to play',
            onClick: function () { HP.openHelp(); },
          },
        ],
      });
    }

    // If already completed today, show result immediately
    if (G.isDone()) {
      var stats = ST.loadStats();
      setTimeout(function () {
        UI.showResult({
          medal:      G.getMedal(),
          guessCount: G.getGuesses().length,
          maxGuesses: G.MAX_GUESSES,
          rule:       _puzzle.rule,
          secret:     _puzzle.secret,
          stats:      stats,
          onShare:    onShare,
        });
      }, 200);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

})();
