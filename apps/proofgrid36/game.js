/* game.js — Proof Grid 6×6: game state, daily puzzle, check logic */

"use strict";

/*
 * Symbol encoding  (0-5)
 *   0 = hollow circle    shapeIndex=0, fillIndex=0
 *   1 = filled circle    shapeIndex=0, fillIndex=1
 *   2 = hollow square    shapeIndex=1, fillIndex=0
 *   3 = filled square    shapeIndex=1, fillIndex=1
 *   4 = hollow triangle  shapeIndex=2, fillIndex=0
 *   5 = filled triangle  shapeIndex=2, fillIndex=1
 *
 *   shapeIndex = floor(v / 2)
 *   fillIndex  = v % 2
 */

var PG36Game = (function () {

  var N = 6;
  var MAX_CHECKS = 1;   // 6×6 expert mode: 1 check only

  /* ── State ─────────────────────────────────────────────── */
  var puzzle      = null;
  var grid        = [];     // N×N current values (−1 = empty)
  var locked      = [];     // N×N boolean (given cells)
  var won         = false;
  var checksLeft  = MAX_CHECKS;
  var failedChecks = 0;
  var startTime   = null;
  var isPractice  = false;
  var firstInteraction = false;

  /* ── Load ───────────────────────────────────────────────── */

  function load(p, practice) {
    puzzle    = p;
    won       = false;
    checksLeft = MAX_CHECKS;
    failedChecks = 0;
    firstInteraction = false;
    startTime = Date.now();
    isPractice = !!practice;

    grid   = [];
    locked = [];
    for (var r = 0; r < N; r++) {
      grid.push([-1, -1, -1, -1, -1, -1]);
      locked.push([false, false, false, false, false, false]);
    }

    for (var i = 0; i < p.givens.length; i++) {
      var g = p.givens[i];
      grid[g[0]][g[1]] = g[2];
      locked[g[0]][g[1]] = true;
    }

    // Persist progress so a page reload can restore the board
    if (!isPractice) _persistProgress();
  }

  /* ── Cell interaction ──────────────────────────────────── */

  function tapCell(r, c) {
    if (won || locked[r][c]) return false;

    if (!firstInteraction) {
      firstInteraction = true;
      _track('first_interaction');
    }

    grid[r][c] = (grid[r][c] + 1) % N;
    if (!isPractice) _persistProgress();
    return true;
  }

  function getValue(r, c) { return grid[r][c]; }
  function isLocked(r, c) { return locked[r][c]; }

  /* ── Check ─────────────────────────────────────────────── */

  function isBoardFull() {
    for (var r = 0; r < N; r++)
      for (var c = 0; c < N; c++)
        if (grid[r][c] === -1) return false;
    return true;
  }

  /**
   * Attempt a check.
   * Returns: { full: bool, correct: bool, checksLeft: int }
   */
  function check() {
    if (won || checksLeft <= 0) return { full: isBoardFull(), correct: false, checksLeft: checksLeft };

    var full = isBoardFull();
    if (!full) return { full: false, correct: false, checksLeft: checksLeft };

    _track('check_used', { checks_remaining: checksLeft - 1 });

    var correct = PG36Solver.validateBoard(grid, puzzle.clues, puzzle.givens);

    if (correct) {
      won = true;
      var elapsed = startTime ? Date.now() - startTime : 0;
      var tier = _getResultTier(failedChecks);
      var streak = isPractice ? 1 : PG36Storage.recordAndGetStreak();

      _track('solve_success', {
        tier:         tier,
        checks_failed: failedChecks,
        time_ms:      elapsed,
        clue_count:   puzzle.clues ? puzzle.clues.length : 0
      });

      if (!isPractice) PG36Storage.clearProgress();

      return {
        full:     true,
        correct:  true,
        checksLeft: checksLeft,
        tier:     tier,
        elapsed:  elapsed,
        streak:   streak
      };
    }

    // Wrong
    failedChecks++;
    checksLeft--;
    if (!isPractice) _persistProgress();

    return { full: true, correct: false, checksLeft: checksLeft };
  }

  /* ── Reset ─────────────────────────────────────────────── */

  function reset() {
    if (won) return;
    for (var r = 0; r < N; r++)
      for (var c = 0; c < N; c++)
        if (!locked[r][c]) grid[r][c] = -1;
    if (!isPractice) _persistProgress();
    _track('reset_used');
  }

  /* ── Accessors ─────────────────────────────────────────── */

  function getPuzzle()     { return puzzle; }
  function getWon()        { return won; }
  function getChecksLeft() { return checksLeft; }
  function getMaxChecks()  { return MAX_CHECKS; }
  function getIsPractice() { return isPractice; }
  function getStartTime()  { return startTime; }

  /* ── Helpers ────────────────────────────────────────────── */

  function _getResultTier(failed) {
    if (failed === 0) return 'Perfect';
    if (failed === 1) return 'Clean';
    return 'Solved';
  }

  function _track(name, props) {
    if (window.KapeworkAnalytics) window.KapeworkAnalytics.track(name, props);
  }

  /* ── Progress persistence ──────────────────────────────── */

  function _persistProgress() {
    PG36Storage.saveProgress({
      grid:        grid,
      checksLeft:  checksLeft,
      failedChecks: failedChecks,
      won:         won,
      startTime:   startTime
    });
  }

  /**
   * Attempt to restore in-progress state from localStorage.
   * Returns true if progress was restored (no need to re-render from scratch).
   */
  function restoreProgress(p) {
    var saved = PG36Storage.loadProgress();
    if (!saved || saved.won) return false;

    puzzle       = p;
    grid         = saved.grid;
    checksLeft   = saved.checksLeft;
    failedChecks = saved.failedChecks;
    won          = false;
    startTime    = saved.startTime || Date.now();
    isPractice   = false;
    firstInteraction = true;

    // Rebuild locked from givens
    locked = [];
    for (var r = 0; r < N; r++) {
      locked.push([false, false, false, false, false, false]);
    }
    for (var i = 0; i < p.givens.length; i++) {
      var g = p.givens[i];
      locked[g[0]][g[1]] = true;
    }

    return true;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    N:               N,
    load:            load,
    tapCell:         tapCell,
    getValue:        getValue,
    isLocked:        isLocked,
    isBoardFull:     isBoardFull,
    check:           check,
    reset:           reset,
    getPuzzle:       getPuzzle,
    getWon:          getWon,
    getChecksLeft:   getChecksLeft,
    getMaxChecks:    getMaxChecks,
    getIsPractice:   getIsPractice,
    getStartTime:    getStartTime,
    restoreProgress: restoreProgress
  };

})();
