/* engine.js — Proof Grid v2: pair-clue model, full enumeration solver, generator */

"use strict";

var ProofEngine = (function () {

  /* ── Symbol helpers (1-4) ──────────────────────────────────
     1 = hollow circle    shape=circle  fill=hollow
     2 = filled circle    shape=circle  fill=filled
     3 = hollow square    shape=square  fill=hollow
     4 = filled square    shape=square  fill=filled
  ──────────────────────────────────────────────────────────── */

  function shape(v) { return v <= 2 ? "circle" : "square"; }
  function fill(v)  { return (v === 1 || v === 3) ? "hollow" : "filled"; }

  /* ── Seeded RNG (Mulberry32) ─────────────────────────────── */

  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dayIndex() {
    return Math.floor(Date.now() / 86400000);
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /* ── Enumerate all valid 4×4 Latin squares over symbols 1-4 ─
     There are exactly 576. We build them once on load.
  ──────────────────────────────────────────────────────────── */

  var ALL_BOARDS = null; // lazily populated

  function enumerateBoards() {
    if (ALL_BOARDS) return ALL_BOARDS;
    ALL_BOARDS = [];
    var grid = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ];

    function canPlace(r, c, v) {
      for (var i = 0; i < c; i++) if (grid[r][i] === v) return false;
      for (var i = 0; i < r; i++) if (grid[i][c] === v) return false;
      return true;
    }

    function solve(pos) {
      if (pos === 16) {
        ALL_BOARDS.push([
          grid[0].slice(), grid[1].slice(),
          grid[2].slice(), grid[3].slice()
        ]);
        return;
      }
      var r = (pos >> 2), c = pos & 3;
      for (var v = 1; v <= 4; v++) {
        if (canPlace(r, c, v)) {
          grid[r][c] = v;
          solve(pos + 1);
          grid[r][c] = 0;
        }
      }
    }

    solve(0);
    return ALL_BOARDS;
  }

  /* ── Pair clue model ────────────────────────────────────────
     A clue sits between two orthogonally adjacent cells.

     Clue object:
       { orientation: "h"|"v", r: number, c: number, type: "same-shape"|"same-fill" }

     For horizontal clues: between cell (r, c) and (r, c+1).  c in [0..2]
     For vertical clues:   between cell (r, c) and (r+1, c).  r in [0..2]
  ──────────────────────────────────────────────────────────── */

  /* All possible gap positions */
  var ALL_H_GAPS = []; // {r, c} for horizontal gaps
  var ALL_V_GAPS = []; // {r, c} for vertical gaps

  (function () {
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 3; c++)
        ALL_H_GAPS.push({ r: r, c: c });
    for (var r = 0; r < 3; r++)
      for (var c = 0; c < 4; c++)
        ALL_V_GAPS.push({ r: r, c: c });
  })();

  /* Check if a board satisfies a single clue */
  function boardSatisfiesClue(board, clue) {
    var r = clue.r, c = clue.c;
    var a, b;
    if (clue.orientation === "h") {
      a = board[r][c]; b = board[r][c + 1];
    } else {
      a = board[r][c]; b = board[r + 1][c];
    }
    if (clue.type === "same-shape") {
      return shape(a) === shape(b);
    } else {
      return fill(a) === fill(b);
    }
  }

  /* Count boards that satisfy all clues + givens. Stop early at maxCount. */
  function countSolutions(clues, givens, maxCount) {
    maxCount = maxCount || 2;
    var boards = enumerateBoards();
    var count = 0;

    boardLoop:
    for (var i = 0; i < boards.length; i++) {
      var b = boards[i];

      // Check givens
      for (var g = 0; g < givens.length; g++) {
        if (b[givens[g][0]][givens[g][1]] !== givens[g][2]) continue boardLoop;
      }

      // Check all clues
      for (var k = 0; k < clues.length; k++) {
        if (!boardSatisfiesClue(b, clues[k])) continue boardLoop;
      }

      count++;
      if (count >= maxCount) return count;
    }

    return count;
  }

  /* Find the unique solution (returns board or null) */
  function findSolution(clues, givens) {
    var boards = enumerateBoards();
    var found = null;
    var count = 0;

    boardLoop:
    for (var i = 0; i < boards.length; i++) {
      var b = boards[i];
      for (var g = 0; g < givens.length; g++) {
        if (b[givens[g][0]][givens[g][1]] !== givens[g][2]) continue boardLoop;
      }
      for (var k = 0; k < clues.length; k++) {
        if (!boardSatisfiesClue(b, clues[k])) continue boardLoop;
      }
      count++;
      if (count > 1) return null; // not unique
      found = b;
    }

    return found;
  }

  /* ── Puzzle generator ────────────────────────────────────── */

  /**
   * Generate a uniquely solvable puzzle.
   * Strategy:
   *   1. Pick a random board from all 576.
   *   2. Extract all true pair-clue relationships from it.
   *   3. Greedily remove clues while maintaining uniqueness.
   *   4. If needed, add 0-2 givens.
   */
  function generatePuzzle(rng) {
    var boards = enumerateBoards();
    var idx = Math.floor(rng() * boards.length);
    var solution = boards[idx];

    // Extract all possible true clues for this board
    var allClues = [];

    for (var i = 0; i < ALL_H_GAPS.length; i++) {
      var g = ALL_H_GAPS[i];
      var a = solution[g.r][g.c], b = solution[g.r][g.c + 1];
      if (shape(a) === shape(b)) {
        allClues.push({ orientation: "h", r: g.r, c: g.c, type: "same-shape" });
      }
      if (fill(a) === fill(b)) {
        allClues.push({ orientation: "h", r: g.r, c: g.c, type: "same-fill" });
      }
    }

    for (var i = 0; i < ALL_V_GAPS.length; i++) {
      var g = ALL_V_GAPS[i];
      var a = solution[g.r][g.c], b = solution[g.r + 1][g.c];
      if (shape(a) === shape(b)) {
        allClues.push({ orientation: "v", r: g.r, c: g.c, type: "same-shape" });
      }
      if (fill(a) === fill(b)) {
        allClues.push({ orientation: "v", r: g.r, c: g.c, type: "same-fill" });
      }
    }

    shuffle(allClues, rng);

    // Start with all clues, greedily remove
    var clues = allClues.slice();
    var givens = [];

    // Try removing each clue one at a time
    for (var pass = 0; pass < 3; pass++) {
      var order = [];
      for (var i = 0; i < clues.length; i++) order.push(i);
      shuffle(order, rng);

      for (var oi = 0; oi < order.length; oi++) {
        var removeIdx = order[oi];
        var candidate = clues.slice();
        candidate.splice(removeIdx, 1);

        if (countSolutions(candidate, givens, 2) === 1) {
          clues = candidate;
          // Re-index order after removal
          for (var j = oi + 1; j < order.length; j++) {
            if (order[j] > removeIdx) order[j]--;
          }
        }
      }
    }

    // If too many clues remain (>10), try adding a given to reduce
    if (clues.length > 10) {
      var cellOrder = [];
      for (var i = 0; i < 16; i++) cellOrder.push(i);
      shuffle(cellOrder, rng);

      for (var ci = 0; ci < cellOrder.length && clues.length > 8; ci++) {
        var cr = cellOrder[ci] >> 2, cc = cellOrder[ci] & 3;
        var newGivens = givens.concat([[cr, cc, solution[cr][cc]]]);

        // Try removing more clues with this given
        var reduced = clues.slice();
        var idxs = [];
        for (var i = 0; i < reduced.length; i++) idxs.push(i);
        shuffle(idxs, rng);

        for (var ri = 0; ri < idxs.length; ri++) {
          var tryRemove = reduced.slice();
          tryRemove.splice(idxs[ri], 1);
          if (countSolutions(tryRemove, newGivens, 2) === 1) {
            reduced = tryRemove;
            for (var j = ri + 1; j < idxs.length; j++) {
              if (idxs[j] > idxs[ri]) idxs[j]--;
            }
          }
        }

        if (reduced.length < clues.length - 1) {
          clues = reduced;
          givens = newGivens;
          break;
        }
      }
    }

    // Final uniqueness assert
    var sols = countSolutions(clues, givens, 2);
    if (sols !== 1) {
      // Fallback: keep all clues
      clues = allClues.slice();
      givens = [];
    }

    return {
      solution: solution,
      clues: clues,
      givens: givens
    };
  }

  /* ── Daily puzzle ────────────────────────────────────────── */

  function dailyPuzzle() {
    var day = dayIndex();
    var seed = Math.imul(day, 2654435761) >>> 0;
    var rng = mulberry32(seed);
    return generatePuzzle(rng);
  }

  /* ── Public API ──────────────────────────────────────────── */

  return {
    generatePuzzle: generatePuzzle,
    dailyPuzzle: dailyPuzzle,
    countSolutions: countSolutions,
    findSolution: findSolution,
    enumerateBoards: enumerateBoards,
    mulberry32: mulberry32,
    dayIndex: dayIndex,
    shape: shape,
    fill: fill
  };

})();
