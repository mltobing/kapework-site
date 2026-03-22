/**
 * game.js — Rainbow Rules game state and daily puzzle generation
 *
 * Daily puzzle:
 *   - Deterministic from the local date (same puzzle for all players on the same day)
 *   - Seeded PRNG → picks one rule from the rule set → generates a valid 4-color code
 *   - Puzzle epoch: 2026-03-22 = puzzle #1
 *
 * Game state:
 *   - 6 max guesses, 4 slots each
 *   - Tracks completed guesses (with exact/misplaced feedback) and the current active row
 *   - Medals: Gold ≤ 4 guesses, Silver = 5, Bronze = 6, Fail = not solved
 */

'use strict';

window.RRGame = (function () {

  var RULES       = window.RRRules;
  var EVAL        = window.RREvaluator;

  var MAX_GUESSES = 6;
  var CODE_LENGTH = 4;

  // ── Daily puzzle ───────────────────────────────────────────────────────────

  var EPOCH_Y = 2026, EPOCH_M = 2, EPOCH_D = 22; // 2026-03-22 (month is 0-indexed for Date.UTC)

  function dateToPuzzleNum(dateKey) {
    var parts   = dateKey.split('-');
    var epochMs = Date.UTC(EPOCH_Y, EPOCH_M, EPOCH_D);
    var dayMs   = Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
    return Math.max(1, Math.floor((dayMs - epochMs) / 86400000) + 1);
  }

  function dateToSeed(dateKey) {
    var parts = dateKey.split('-');
    var y = +parts[0], m = +parts[1], d = +parts[2];
    // Spread seed so adjacent dates differ significantly
    return ((y * 372 + m * 31 + d) * 0x9e3779b9) >>> 0;
  }

  function getDailyPuzzle(dateKey) {
    var seed  = dateToSeed(dateKey);
    var rand  = RULES.makePRNG(seed);

    // Choose rule for today
    var ruleIdx = Math.floor(rand() * RULES.RULES.length);
    var rule    = RULES.RULES[ruleIdx];

    // Generate a code satisfying the rule
    var secret = rule.generate(rand);

    return {
      puzzleNum: dateToPuzzleNum(dateKey),
      rule:      rule,
      secret:    secret,
    };
  }

  // ── Game state ─────────────────────────────────────────────────────────────

  var _puzzle     = null;
  var _guesses    = [];   // [{ colors: [], exact: n, misplaced: n }]
  var _currentRow = [];   // colors entered so far in the active row
  var _done       = false;
  var _won        = false;

  function init(puzzle, savedState) {
    _puzzle     = puzzle;
    _guesses    = [];
    _currentRow = [];
    _done       = false;
    _won        = false;

    if (savedState && Array.isArray(savedState.guesses)) {
      _guesses = savedState.guesses;
      _done    = !!savedState.done;
      _won     = !!savedState.won;
    }
  }

  function pushColor(colorId) {
    if (_done) return false;
    if (_currentRow.length >= CODE_LENGTH) return false;
    _currentRow.push(colorId);
    return true;
  }

  function deleteColor() {
    if (_done) return false;
    if (_currentRow.length === 0) return false;
    _currentRow.pop();
    return true;
  }

  function submitGuess() {
    if (_done) return { ok: false, reason: 'Game is already over.' };
    if (_currentRow.length < CODE_LENGTH) {
      return { ok: false, reason: 'Fill all 4 slots first.' };
    }

    var colors = _currentRow.slice();
    var fb     = EVAL.evaluate(colors, _puzzle.secret);
    var guess  = { colors: colors, exact: fb.exact, misplaced: fb.misplaced };

    _guesses.push(guess);
    _currentRow = [];

    if (fb.exact === CODE_LENGTH) {
      _done = _won = true;
    } else if (_guesses.length >= MAX_GUESSES) {
      _done = true;
      _won  = false;
    }

    return { ok: true, guess: guess, done: _done, won: _won };
  }

  function getMedal() {
    if (!_done)  return null;
    if (!_won)   return 'fail';
    var n = _guesses.length;
    if (n <= 4)  return 'gold';
    if (n === 5) return 'silver';
    return 'bronze';
  }

  function getState() {
    return { guesses: _guesses, done: _done, won: _won };
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  function getPuzzle()     { return _puzzle; }
  function getGuesses()    { return _guesses; }
  function getCurrentRow() { return _currentRow.slice(); }
  function isDone()        { return _done; }
  function isWon()         { return _won; }

  return {
    MAX_GUESSES:     MAX_GUESSES,
    CODE_LENGTH:     CODE_LENGTH,
    getDailyPuzzle:  getDailyPuzzle,
    dateToPuzzleNum: dateToPuzzleNum,
    init:            init,
    pushColor:       pushColor,
    deleteColor:     deleteColor,
    submitGuess:     submitGuess,
    getMedal:        getMedal,
    getState:        getState,
    getPuzzle:       getPuzzle,
    getGuesses:      getGuesses,
    getCurrentRow:   getCurrentRow,
    isDone:          isDone,
    isWon:           isWon,
  };
})();
