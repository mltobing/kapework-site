/* generator.js — Proof Grid 6×6: seed-bank + scramble puzzle generation
 *
 * Generation pipeline:
 *   1. Pick a random seed from PG36SeedBank
 *   2. Apply a trait-preserving scramble:
 *        - random row permutation
 *        - random column permutation
 *        - random shape permutation (3! = 6 options)
 *        - random fill permutation  (2! = 2 options)
 *        - optional transpose
 *   3. Extract all valid pair clues from the solved board
 *   4. Greedily remove clues while uniqueness is maintained
 *   5. Accept if clue count is in target band [10, 14]
 *   6. Retry with different seed/scramble if needed
 *
 * Clue mix target: ~12 clues, 7 same-shape, 5 same-fill,
 * with ≥3 horizontal and ≥3 vertical.
 *
 * Public API:
 *   PG36Generator.mulberry32(seed)     → rng function
 *   PG36Generator.dayIndex()          → integer day index
 *   PG36Generator.generatePuzzle(rng) → puzzle object or null
 *   PG36Generator.dailyPuzzle()       → puzzle object
 */

"use strict";

var PG36Generator = (function () {

  var N = 6;
  var TARGET_CLUES = 12;
  var MIN_CLUES    = 10;
  var MAX_CLUES    = 14;
  var NUM_GIVENS   = 2;

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

  /* ── Symbol helpers ───────────────────────────────────────── */
  function shapeOf(v) { return v >> 1; }
  function fillOf(v)  { return v & 1; }

  /* ── Scramble a seed square ───────────────────────────────── *
   *
   * The scramble preserves the shape/fill factorization:
   *   new_symbol = shapePerm[shape(v)] * 2 + fillPerm[fill(v)]
   *
   * This ensures the 6 symbols remain the 3-shape × 2-fill set
   * and clue semantics (same-shape / same-fill) stay valid.
   */
  function scrambleSeed(seedGrid, rng) {
    // Row permutation
    var rowPerm = [0, 1, 2, 3, 4, 5];
    shuffle(rowPerm, rng);

    // Column permutation
    var colPerm = [0, 1, 2, 3, 4, 5];
    shuffle(colPerm, rng);

    // Shape permutation (0,1,2 → circle,square,triangle)
    var shapePerm = [0, 1, 2];
    shuffle(shapePerm, rng);

    // Fill permutation (0,1 → hollow,filled)
    var fillPerm = [0, 1];
    shuffle(fillPerm, rng);

    function remapSymbol(v) {
      return shapePerm[shapeOf(v)] * 2 + fillPerm[fillOf(v)];
    }

    // Build scrambled board
    var result = [];
    for (var r = 0; r < N; r++) result.push([0, 0, 0, 0, 0, 0]);

    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        result[rowPerm[r]][colPerm[c]] = remapSymbol(seedGrid[r][c]);
      }
    }

    // Optional transpose (50% chance)
    if (rng() < 0.5) {
      var transposed = [];
      for (var r = 0; r < N; r++) transposed.push([0, 0, 0, 0, 0, 0]);
      for (var r = 0; r < N; r++)
        for (var c = 0; c < N; c++)
          transposed[c][r] = result[r][c];
      result = transposed;
    }

    return result;
  }

  /* ── Extract all valid clues from a solved board ──────────── */

  function extractAllClues(solution) {
    var clues = [];

    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N - 1; c++) {
        var a = solution[r][c], b = solution[r][c + 1];
        if (shapeOf(a) === shapeOf(b))
          clues.push({ orientation: 'h', r: r, c: c, type: 'same-shape' });
        if (fillOf(a) === fillOf(b))
          clues.push({ orientation: 'h', r: r, c: c, type: 'same-fill' });
      }
    }

    for (var r = 0; r < N - 1; r++) {
      for (var c = 0; c < N; c++) {
        var a = solution[r][c], b = solution[r + 1][c];
        if (shapeOf(a) === shapeOf(b))
          clues.push({ orientation: 'v', r: r, c: c, type: 'same-shape' });
        if (fillOf(a) === fillOf(b))
          clues.push({ orientation: 'v', r: r, c: c, type: 'same-fill' });
      }
    }

    return clues;
  }

  /* ── Distribution quality check ───────────────────────────── */

  function hasGoodDistribution(clues) {
    var hCount = 0, vCount = 0, shapeCount = 0, fillCount = 0;
    for (var i = 0; i < clues.length; i++) {
      if (clues[i].orientation === 'h') hCount++; else vCount++;
      if (clues[i].type === 'same-shape') shapeCount++; else fillCount++;
    }
    // At least 3 in each orientation, at least 2 of each type
    return hCount >= 3 && vCount >= 3 && shapeCount >= 2 && fillCount >= 2;
  }

  /* ── Greedy clue removal ──────────────────────────────────── *
   *
   * Start with all valid clues; greedily remove clues while
   * the puzzle remains uniquely solvable.
   * Stop removing when we reach the target clue count.
   */
  function greedyRemove(clues, givens, rng) {
    var current = clues.slice();

    for (var pass = 0; pass < 3; pass++) {
      var order = [];
      for (var i = 0; i < current.length; i++) order.push(i);
      shuffle(order, rng);

      for (var oi = 0; oi < order.length; oi++) {
        // Don't go below minimum
        if (current.length <= MIN_CLUES) break;

        var removeIdx = order[oi];
        if (removeIdx >= current.length) continue;

        var candidate = current.slice();
        candidate.splice(removeIdx, 1);

        if (PG36Solver.countSolutions(candidate, givens, 2) === 1) {
          current = candidate;
          // Adjust remaining indices
          for (var j = oi + 1; j < order.length; j++) {
            if (order[j] > removeIdx) order[j]--;
          }
          // Stop if we've hit the target
          if (current.length <= TARGET_CLUES) break;
        }
      }

      if (current.length <= TARGET_CLUES) break;
    }

    return current;
  }

  /* ── Attempt to generate one puzzle ─────────────────────── */

  function tryGenerate(rng) {
    var seeds = PG36SeedBank.seeds;
    var seedIdx = Math.floor(rng() * seeds.length);
    var solution = scrambleSeed(seeds[seedIdx].grid, rng);

    // Pick NUM_GIVENS given cells
    var cellOrder = [];
    for (var i = 0; i < N * N; i++) cellOrder.push(i);
    shuffle(cellOrder, rng);
    var givens = [];
    for (var i = 0; i < NUM_GIVENS; i++) {
      var pos = cellOrder[i];
      var gr = Math.floor(pos / N), gc = pos % N;
      givens.push([gr, gc, solution[gr][gc]]);
    }

    var allClues = extractAllClues(solution);
    shuffle(allClues, rng);

    var clues = greedyRemove(allClues, givens, rng);

    if (
      clues.length >= MIN_CLUES &&
      clues.length <= MAX_CLUES &&
      hasGoodDistribution(clues)
    ) {
      return {
        clues: clues,
        givens: givens,
        _solution: solution  // internal — not used for validation
      };
    }

    return null;
  }

  /* ── Main generator ──────────────────────────────────────── */

  function generatePuzzle(rng) {
    // Try up to 30 attempts with the full quality criteria
    for (var attempt = 0; attempt < 30; attempt++) {
      var p = tryGenerate(rng);
      if (p) return p;
    }

    // Fallback: relax distribution check, accept any valid band
    for (var attempt = 0; attempt < 20; attempt++) {
      var seeds = PG36SeedBank.seeds;
      var seedIdx = Math.floor(rng() * seeds.length);
      var solution = scrambleSeed(seeds[seedIdx].grid, rng);

      var cellOrder = [];
      for (var i = 0; i < N * N; i++) cellOrder.push(i);
      shuffle(cellOrder, rng);
      var givens = [];
      for (var i = 0; i < NUM_GIVENS; i++) {
        var pos = cellOrder[i];
        givens.push([Math.floor(pos / N), pos % N, solution[Math.floor(pos / N)][pos % N]]);
      }

      var allClues = extractAllClues(solution);
      shuffle(allClues, rng);
      var clues = greedyRemove(allClues, givens, rng);

      if (clues.length >= MIN_CLUES && clues.length <= MAX_CLUES) {
        return { clues: clues, givens: givens, _solution: solution };
      }
    }

    // Last resort: return with whatever clue count we got
    var seeds = PG36SeedBank.seeds;
    var solution = scrambleSeed(seeds[0].grid, rng);
    var givens = [[0, 0, solution[0][0]], [1, 1, solution[1][1]]];
    var allClues = extractAllClues(solution);
    shuffle(allClues, rng);
    var clues = greedyRemove(allClues, givens, rng);
    return { clues: clues, givens: givens, _solution: solution };
  }

  /* ── Daily puzzle (cached in localStorage) ───────────────── */

  function dailyPuzzle() {
    var day = dayIndex();
    var cacheKey = 'pg36_puzzle_' + day;

    // Try to return cached puzzle (skips generation on revisit)
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && cached.clues && cached.givens) return cached;
    } catch (e) {}

    var seed = Math.imul(day + 31337, 2654435761) >>> 0;
    var rng = mulberry32(seed);
    var puzzle = generatePuzzle(rng);

    // Cache without _solution (keeps localStorage small)
    try {
      var toCache = { clues: puzzle.clues, givens: puzzle.givens };
      localStorage.setItem(cacheKey, JSON.stringify(toCache));
      // Clean up yesterday's cache
      localStorage.removeItem('pg36_puzzle_' + (day - 1));
    } catch (e) {}

    return puzzle;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    mulberry32:     mulberry32,
    dayIndex:       dayIndex,
    generatePuzzle: generatePuzzle,
    dailyPuzzle:    dailyPuzzle,
    scrambleSeed:   scrambleSeed
  };

})();
