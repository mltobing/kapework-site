/* solver.js — Proof Grid 6×6: backtracking uniqueness solver
 *
 * Uses row/column all-different + pair-clue constraints.
 * Stops as soon as maxCount solutions are found (early exit at 2).
 *
 * Public API:
 *   PG36Solver.countSolutions(clues, givens, maxCount) → number
 *   PG36Solver.validateBoard(board, clues, givens)     → boolean
 */

"use strict";

var PG36Solver = (function () {

  var N = 6;

  /* ── Symbol helpers ──────────────────────────────────────
     v in 0..5
     shape = floor(v / 2)  → 0=circle, 1=square, 2=triangle
     fill  = v % 2         → 0=hollow, 1=filled
  ──────────────────────────────────────────────────────── */
  function shapeOf(v) { return v >> 1; }
  function fillOf(v)  { return v & 1; }

  function satisfiesClue(a, b, type) {
    if (type === 'same-shape') return shapeOf(a) === shapeOf(b);
    return fillOf(a) === fillOf(b);
  }

  /* ── Count solutions (backtracking) ─────────────────────
   *
   * State:
   *   grid[r][c]    = current value (-1 if unset)
   *   rowUsed[r]    = bitmask of values placed in row r
   *   colUsed[c]    = bitmask of values placed in col c
   *
   * Pruning:
   *   - row/col all-different (via bitmasks)
   *   - pair-clue forward checking: whenever both cells in a
   *     clue pair are filled, verify the clue immediately
   *
   * Traversal: row-major order, skipping given cells.
   * Branching: tries values 0..5 in order.
   *
   * MRV (most-constrained-variable) heuristic is not applied
   * to keep code simple; row-major order combined with the
   * pair-clue pruning is fast enough for 6×6 + ~12 clues.
   */
  function countSolutions(clues, givens, maxCount) {
    maxCount = maxCount || 2;

    var grid = [];
    var rowUsed = [0, 0, 0, 0, 0, 0];
    var colUsed = [0, 0, 0, 0, 0, 0];

    for (var r = 0; r < N; r++) {
      grid.push([-1, -1, -1, -1, -1, -1]);
    }

    // Apply givens
    for (var g = 0; g < givens.length; g++) {
      var gr = givens[g][0], gc = givens[g][1], gv = givens[g][2];
      grid[gr][gc] = gv;
      rowUsed[gr] |= (1 << gv);
      colUsed[gc] |= (1 << gv);
    }

    // Pre-process clue list: for each clue, store resolved cell coords
    var clueList = [];
    for (var k = 0; k < clues.length; k++) {
      var cl = clues[k];
      var rA = cl.r, cA = cl.c;
      var rB = cl.orientation === 'h' ? cl.r     : cl.r + 1;
      var cB = cl.orientation === 'h' ? cl.c + 1 : cl.c;
      clueList.push({ rA: rA, cA: cA, rB: rB, cB: cB, type: cl.type });
    }

    // Build per-cell clue index for fast forward checking
    // cellClues[r][c] = array of clue objects that involve (r,c)
    var cellClues = [];
    for (var r = 0; r < N; r++) {
      cellClues.push([[], [], [], [], [], []]);
    }
    for (var k = 0; k < clueList.length; k++) {
      var cl = clueList[k];
      cellClues[cl.rA][cl.cA].push(cl);
      cellClues[cl.rB][cl.cB].push(cl);
    }

    var count = 0;

    function solve(pos) {
      if (count >= maxCount) return;

      // Advance past given/filled cells
      while (pos < N * N && grid[Math.floor(pos / N)][pos % N] !== -1) {
        pos++;
      }

      if (pos === N * N) {
        count++;
        return;
      }

      var r = Math.floor(pos / N), c = pos % N;
      var used = rowUsed[r] | colUsed[c];

      for (var v = 0; v < N; v++) {
        if (used & (1 << v)) continue;  // row or col already has v

        // Forward-check clues involving (r, c)
        var ok = true;
        var involved = cellClues[r][c];
        for (var i = 0; i < involved.length; i++) {
          var cl = involved[i];
          // Find the other cell
          var otherR = (cl.rA === r && cl.cA === c) ? cl.rB : cl.rA;
          var otherC = (cl.rA === r && cl.cA === c) ? cl.cB : cl.cA;
          var otherV = grid[otherR][otherC];
          if (otherV === -1) continue;  // other cell not yet filled
          if (!satisfiesClue(v, otherV, cl.type)) { ok = false; break; }
        }

        if (!ok) continue;

        grid[r][c] = v;
        rowUsed[r] |= (1 << v);
        colUsed[c] |= (1 << v);

        solve(pos + 1);

        grid[r][c] = -1;
        rowUsed[r] &= ~(1 << v);
        colUsed[c] &= ~(1 << v);

        if (count >= maxCount) return;
      }
    }

    solve(0);
    return count;
  }

  /* ── Rule-based board validation ─────────────────────────
   * Returns true if the board satisfies ALL constraints:
   *   - Each cell value is 0..5
   *   - Each row contains 0..5 exactly once
   *   - Each column contains 0..5 exactly once
   *   - All pair clues satisfied
   *   - All givens match
   * Does NOT compare against a stored solution.
   */
  function validateBoard(board, clues, givens) {
    var ALL_BITS = (1 << N) - 1; // 0b111111 = 63

    // Check values in range
    for (var r = 0; r < N; r++)
      for (var c = 0; c < N; c++) {
        var v = board[r][c];
        if (v < 0 || v >= N) return false;
      }

    // Check rows
    for (var r = 0; r < N; r++) {
      var seen = 0;
      for (var c = 0; c < N; c++) {
        var bit = 1 << board[r][c];
        if (seen & bit) return false;
        seen |= bit;
      }
      if (seen !== ALL_BITS) return false;
    }

    // Check columns
    for (var c = 0; c < N; c++) {
      var seen = 0;
      for (var r = 0; r < N; r++) {
        var bit = 1 << board[r][c];
        if (seen & bit) return false;
        seen |= bit;
      }
      if (seen !== ALL_BITS) return false;
    }

    // Check givens
    for (var g = 0; g < givens.length; g++) {
      if (board[givens[g][0]][givens[g][1]] !== givens[g][2]) return false;
    }

    // Check pair clues
    for (var k = 0; k < clues.length; k++) {
      var cl = clues[k];
      var a, b;
      if (cl.orientation === 'h') {
        a = board[cl.r][cl.c]; b = board[cl.r][cl.c + 1];
      } else {
        a = board[cl.r][cl.c]; b = board[cl.r + 1][cl.c];
      }
      if (!satisfiesClue(a, b, cl.type)) return false;
    }

    return true;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    countSolutions: countSolutions,
    validateBoard:  validateBoard,
    shapeOf:        shapeOf,
    fillOf:         fillOf
  };

})();
