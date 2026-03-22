/**
 * evaluator.js — Rainbow Rules Mastermind-correct feedback evaluation
 *
 * evaluate(guess, secret) → { exact, misplaced }
 *
 * Algorithm:
 *   1. Count positions where guess[i] === secret[i]  → exact
 *   2. On the remaining (unmatched) positions, count how many guess colors
 *      appear in the remaining secret colors, respecting counts → misplaced
 *
 * This handles duplicates correctly (Mastermind semantics, not Wordle coloring).
 *
 * Example:
 *   secret = ['R','R','G','B','Y']
 *   guess  = ['R','G','R','B','B']
 *   → exact=2 (R at 0, B at 3), misplaced=2 (G matches secret's G at 2, R matches secret's R at 1)
 */

'use strict';

window.RREvaluator = (function () {

  function evaluate(guess, secret) {
    var exact      = 0;
    var secretLeft = [];
    var guessLeft  = [];

    for (var i = 0; i < secret.length; i++) {
      if (guess[i] === secret[i]) {
        exact++;
      } else {
        secretLeft.push(secret[i]);
        guessLeft.push(guess[i]);
      }
    }

    // Count remaining secret colors
    var counts = {};
    for (var j = 0; j < secretLeft.length; j++) {
      var c = secretLeft[j];
      counts[c] = (counts[c] || 0) + 1;
    }

    // Match remaining guess colors against remaining secret pool
    var misplaced = 0;
    for (var k = 0; k < guessLeft.length; k++) {
      var g = guessLeft[k];
      if (counts[g] > 0) {
        misplaced++;
        counts[g]--;
      }
    }

    return { exact: exact, misplaced: misplaced };
  }

  return { evaluate: evaluate };
})();
