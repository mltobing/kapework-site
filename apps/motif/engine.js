/* engine.js — Proof Grid v2.1: sparse puzzles, rule-based validation */

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

  /* ── Enumerate all valid 4×4 Latin squares (576 total) ───── */

  var ALL_BOARDS = null;

  function enumerateBoards() {
    if (ALL_BOARDS) return ALL_BOARDS;
    ALL_BOARDS = [];
    var grid = [
      [0, 0, 0, 0], [0, 0, 0, 0],
      [0, 0, 0, 0], [0, 0, 0, 0]
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
     { orientation: "h"|"v", r, c, type: "same-shape"|"same-fill" }
     h clue: between (r,c) and (r,c+1)
     v clue: between (r,c) and (r+1,c)
  ──────────────────────────────────────────────────────────── */

  var ALL_H_GAPS = [];
  var ALL_V_GAPS = [];

  (function () {
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 3; c++)
        ALL_H_GAPS.push({ r: r, c: c });
    for (var r = 0; r < 3; r++)
      for (var c = 0; c < 4; c++)
        ALL_V_GAPS.push({ r: r, c: c });
  })();

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

  /* Count boards satisfying clues + givens. Stops at maxCount. */
  function countSolutions(clues, givens, maxCount) {
    maxCount = maxCount || 2;
    var boards = enumerateBoards();
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
      if (count >= maxCount) return count;
    }
    return count;
  }

  /* ── Rule-based board validation ─────────────────────────── */

  /**
   * Validate a player's board against the puzzle rules.
   * Returns true if the board satisfies ALL constraints:
   *   - Latin square (each row & col has symbols 1-4 exactly once)
   *   - All pair clues satisfied
   *   - All givens match
   * Does NOT compare against a stored canonical solution.
   */
  function validateBoard(board, clues, givens) {
    // Check every cell is 1-4
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++) {
        var v = board[r][c];
        if (v < 1 || v > 4) return false;
      }

    // Check rows: each symbol 1-4 exactly once
    for (var r = 0; r < 4; r++) {
      var seen = 0;
      for (var c = 0; c < 4; c++) {
        var bit = 1 << board[r][c];
        if (seen & bit) return false;
        seen |= bit;
      }
      if (seen !== 0x1e) return false; // bits 1-4 set = 0b11110
    }

    // Check columns
    for (var c = 0; c < 4; c++) {
      var seen = 0;
      for (var r = 0; r < 4; r++) {
        var bit = 1 << board[r][c];
        if (seen & bit) return false;
        seen |= bit;
      }
      if (seen !== 0x1e) return false;
    }

    // Check givens
    for (var g = 0; g < givens.length; g++) {
      if (board[givens[g][0]][givens[g][1]] !== givens[g][2]) return false;
    }

    // Check pair clues
    for (var k = 0; k < clues.length; k++) {
      if (!boardSatisfiesClue(board, clues[k])) return false;
    }

    return true;
  }

  /* ── Generator: sparse puzzles (5-6 clues + 1 given) ─────── */

  /**
   * Quality check for clue distribution:
   *   - at least 2 horizontal
   *   - at least 2 vertical
   *   - at least 2 same-shape
   *   - at least 2 same-fill
   */
  function hasGoodDistribution(clues) {
    var hCount = 0, vCount = 0, shapeCount = 0, fillCount = 0;
    for (var i = 0; i < clues.length; i++) {
      if (clues[i].orientation === "h") hCount++; else vCount++;
      if (clues[i].type === "same-shape") shapeCount++; else fillCount++;
    }
    return hCount >= 2 && vCount >= 2 && shapeCount >= 2 && fillCount >= 2;
  }

  /**
   * Generate a puzzle targeting exactly `targetClues` clues + 1 given.
   * Returns puzzle object or null if this target is not achievable
   * with good distribution for the chosen board+given.
   */
  function tryGenerate(rng, targetClues) {
    var boards = enumerateBoards();
    var boardIdx = Math.floor(rng() * boards.length);
    var solution = boards[boardIdx];

    // Pick 1 given cell
    var cellOrder = [];
    for (var i = 0; i < 16; i++) cellOrder.push(i);
    shuffle(cellOrder, rng);

    for (var gi = 0; gi < cellOrder.length; gi++) {
      var gr = cellOrder[gi] >> 2, gc = cellOrder[gi] & 3;
      var givens = [[gr, gc, solution[gr][gc]]];

      // Extract all true clues for this board
      var allClues = [];

      for (var i = 0; i < ALL_H_GAPS.length; i++) {
        var g = ALL_H_GAPS[i];
        var a = solution[g.r][g.c], b = solution[g.r][g.c + 1];
        if (shape(a) === shape(b))
          allClues.push({ orientation: "h", r: g.r, c: g.c, type: "same-shape" });
        if (fill(a) === fill(b))
          allClues.push({ orientation: "h", r: g.r, c: g.c, type: "same-fill" });
      }

      for (var i = 0; i < ALL_V_GAPS.length; i++) {
        var g = ALL_V_GAPS[i];
        var a = solution[g.r][g.c], b = solution[g.r + 1][g.c];
        if (shape(a) === shape(b))
          allClues.push({ orientation: "v", r: g.r, c: g.c, type: "same-shape" });
        if (fill(a) === fill(b))
          allClues.push({ orientation: "v", r: g.r, c: g.c, type: "same-fill" });
      }

      shuffle(allClues, rng);

      // Greedy removal: start with all, remove as many as possible
      var clues = allClues.slice();

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
            for (var j = oi + 1; j < order.length; j++) {
              if (order[j] > removeIdx) order[j]--;
            }
          }
        }
      }

      // Check if we hit the target
      if (clues.length === targetClues && hasGoodDistribution(clues)) {
        return {
          clues: clues,
          givens: givens,
          _solution: solution // internal only, NOT used for checking
        };
      }
    }

    return null;
  }

  /**
   * Main generator entry point.
   * Tries target=5 first (multiple attempts), falls back to target=6.
   */
  function generatePuzzle(rng) {
    // Try 5-clue puzzles first (harder)
    for (var attempt = 0; attempt < 40; attempt++) {
      var p = tryGenerate(rng, 5);
      if (p) return p;
    }

    // Fall back to 6-clue puzzles
    for (var attempt = 0; attempt < 40; attempt++) {
      var p = tryGenerate(rng, 6);
      if (p) return p;
    }

    // Last resort: accept any clue count with good distribution
    var boards = enumerateBoards();
    var solution = boards[Math.floor(rng() * boards.length)];
    var givens = [[0, 0, solution[0][0]]];

    var allClues = [];
    for (var i = 0; i < ALL_H_GAPS.length; i++) {
      var g = ALL_H_GAPS[i];
      var a = solution[g.r][g.c], b = solution[g.r][g.c + 1];
      if (shape(a) === shape(b))
        allClues.push({ orientation: "h", r: g.r, c: g.c, type: "same-shape" });
      if (fill(a) === fill(b))
        allClues.push({ orientation: "h", r: g.r, c: g.c, type: "same-fill" });
    }
    for (var i = 0; i < ALL_V_GAPS.length; i++) {
      var g = ALL_V_GAPS[i];
      var a = solution[g.r][g.c], b = solution[g.r + 1][g.c];
      if (shape(a) === shape(b))
        allClues.push({ orientation: "v", r: g.r, c: g.c, type: "same-shape" });
      if (fill(a) === fill(b))
        allClues.push({ orientation: "v", r: g.r, c: g.c, type: "same-fill" });
    }

    shuffle(allClues, rng);
    var clues = allClues.slice();

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
          for (var j = oi + 1; j < order.length; j++) {
            if (order[j] > removeIdx) order[j]--;
          }
        }
      }
    }

    return {
      clues: clues,
      givens: givens,
      _solution: solution
    };
  }

  /* ── Daily puzzle ────────────────────────────────────────── */

  function dailyPuzzle() {
    var day = dayIndex();
    // v2.1 seed offset to invalidate old cached puzzles
    var seed = Math.imul(day + 7777, 2654435761) >>> 0;
    var rng = mulberry32(seed);
    return generatePuzzle(rng);
  }

  /* ── Public API ──────────────────────────────────────────── */

  return {
    generatePuzzle: generatePuzzle,
    dailyPuzzle: dailyPuzzle,
    countSolutions: countSolutions,
    validateBoard: validateBoard,
    enumerateBoards: enumerateBoards,
    mulberry32: mulberry32,
    dayIndex: dayIndex,
    shape: shape,
    fill: fill
  };

})();
