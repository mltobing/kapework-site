/**
 * game.js — Longshot v2 core game logic
 *
 * Responsible for:
 * - Tracking the current tile selection path
 * - Validating word submissions against the board's allowed word set
 * - Managing shot count and game completion
 * - Deriving medal results
 *
 * No DOM access — pure game state.
 */

'use strict';

var MAX_SHOTS = 3;
var MIN_WORD_LENGTH = 5;

// ── State ─────────────────────────────────────────────────────────────────────
var _board   = null;   // board object from board-bank
var _lexicon = null;   // Set of common words (loaded at runtime)
var _path    = [];     // array of tile indices forming current selection
var _shots   = [];     // array of valid submitted words (max 3)
var _done    = false;

// ── Init ──────────────────────────────────────────────────────────────────────
function init(board, savedState, lexiconSet) {
  _board   = board;
  _lexicon = lexiconSet || null;
  _path    = [];

  if (savedState && savedState.shots) {
    _shots = savedState.shots.slice(0, MAX_SHOTS);
    _done  = savedState.done || (_shots.length >= MAX_SHOTS);
  } else {
    _shots = [];
    _done  = false;
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────────
function isAdjacent(idxA, idxB) {
  var rA = idxA >> 2, cA = idxA & 3;
  var rB = idxB >> 2, cB = idxB & 3;
  return Math.abs(rA - rB) <= 1 && Math.abs(cA - cB) <= 1 && idxA !== idxB;
}

function inPath(idx) {
  return _path.indexOf(idx) !== -1;
}

function canSelect(idx) {
  if (_done) return false;
  if (inPath(idx)) {
    // Allow tapping last tile again to undo
    return idx === _path[_path.length - 1];
  }
  if (_path.length === 0) return true;
  return isAdjacent(_path[_path.length - 1], idx);
}

// Returns true if tile was added, false if it was already at end (undo handled separately)
function selectTile(idx) {
  if (_done) return false;
  if (inPath(idx)) {
    // Tapping last tile = undo
    if (idx === _path[_path.length - 1]) {
      _path.pop();
      return true;
    }
    return false; // tile already in path, not last → ignore
  }
  if (_path.length > 0 && !isAdjacent(_path[_path.length - 1], idx)) return false;
  _path.push(idx);
  return true;
}

function clearPath() {
  _path = [];
}

function getCurrentWord() {
  if (!_board) return '';
  return _path.map(function(i) { return _board.grid[i]; }).join('').toLowerCase();
}

function getPath() {
  return _path.slice();
}

// ── Submission ────────────────────────────────────────────────────────────────
// Returns { valid: bool, reason: string, word: string }
//
// Validation order:
//   1. Too short (< 5 letters)
//   2. Already submitted this run
//   3. Not in the common-word lexicon
//
// Path validity is already enforced by tile selection — if the word was built
// by tapping tiles in the grid, every step was adjacency-checked in real time.
function submitWord() {
  var word = getCurrentWord();

  if (word.length < MIN_WORD_LENGTH) {
    return { valid: false, reason: 'Too short — 5+ letters only', word: word };
  }

  if (_shots.indexOf(word) !== -1) {
    return { valid: false, reason: 'Already submitted this run', word: word };
  }

  // Lexicon check — validate against the common-word list loaded at runtime.
  // This is the trust-first approach: any word the player can trace + is
  // in the common English lexicon is accepted.
  var inLexicon = _lexicon ? _lexicon.has(word) : false;
  if (!inLexicon) {
    return { valid: false, reason: 'Not in our word list', word: word };
  }

  // Valid word — consume a shot
  _shots.push(word);
  _path = [];

  if (_shots.length >= MAX_SHOTS) {
    _done = true;
  }

  return { valid: true, reason: '', word: word };
}

// ── Medal ─────────────────────────────────────────────────────────────────────
// Returns 'none' | 'bronze' | 'silver' | 'gold'
function getMedal() {
  if (_shots.length === 0) return 'none';
  var best = _shots.reduce(function(max, w) { return Math.max(max, w.length); }, 0);
  var m = _board.medals;
  if (best >= m.gold)   return 'gold';
  if (best >= m.silver) return 'silver';
  if (best >= m.bronze) return 'bronze';
  return 'none';
}

function getBestWord() {
  if (_shots.length === 0) return '';
  return _shots.reduce(function(best, w) { return w.length > best.length ? w : best; }, '');
}

function getBestLength() {
  if (_shots.length === 0) return 0;
  return _shots.reduce(function(max, w) { return Math.max(max, w.length); }, 0);
}

// ── State snapshot (for persistence) ─────────────────────────────────────────
function getState() {
  return {
    boardId: _board ? _board.id : null,
    shots:   _shots.slice(),
    done:    _done,
    medal:   _done ? getMedal() : null,
  };
}

function isDone()     { return _done; }
function getShots()   { return _shots.slice(); }
function getBoard()   { return _board; }
function shotsLeft()  { return MAX_SHOTS - _shots.length; }

window.LongshotGame = {
  init:           init,
  canSelect:      canSelect,
  selectTile:     selectTile,
  clearPath:      clearPath,
  getCurrentWord: getCurrentWord,
  getPath:        getPath,
  submitWord:     submitWord,
  getMedal:       getMedal,
  getBestWord:    getBestWord,
  getBestLength:  getBestLength,
  getState:       getState,
  isDone:         isDone,
  getShots:       getShots,
  getBoard:       getBoard,
  shotsLeft:      shotsLeft,
  MAX_SHOTS:      MAX_SHOTS,
};
