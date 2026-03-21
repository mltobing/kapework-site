/* engine.js — Proof Grid: solver, generator, daily puzzle */

"use strict";

const ProofEngine = (function () {

  /* ── Symbol helpers ──────────────────────────────────────── */

  function shape(v) { return v <= 2 ? "circle" : "square"; }
  function fill(v)  { return (v === 1 || v === 3) ? "hollow" : "filled"; }

  /* Build symbol from shape + fill */
  function fromShapeFill(sh, fi) {
    if (sh === "circle" && fi === "hollow") return 1;
    if (sh === "circle" && fi === "filled") return 2;
    if (sh === "square" && fi === "hollow") return 3;
    if (sh === "square" && fi === "filled") return 4;
    return 0;
  }

  /* ── Seeded RNG (Mulberry32) ─────────────────────────────── */

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dayIndex() {
    // Days since epoch, UTC
    return Math.floor(Date.now() / 86400000);
  }

  /* Shuffle array in place using given rng */
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ── Latin square generator ──────────────────────────────── */

  /**
   * Generate a random 4x4 Latin square with symbols 1-4.
   * Uses shuffled backtracking for variety.
   */
  function generateLatinSquare(rng) {
    const grid = Array.from({ length: 4 }, () => Array(4).fill(0));

    function canPlace(r, c, v) {
      for (let i = 0; i < 4; i++) {
        if (grid[r][i] === v) return false;
        if (grid[i][c] === v) return false;
      }
      return true;
    }

    function solve(pos) {
      if (pos === 16) return true;
      const r = Math.floor(pos / 4);
      const c = pos % 4;
      const order = shuffle([1, 2, 3, 4], rng);
      for (const v of order) {
        if (canPlace(r, c, v)) {
          grid[r][c] = v;
          if (solve(pos + 1)) return true;
          grid[r][c] = 0;
        }
      }
      return false;
    }

    solve(0);
    return grid;
  }

  /* ── Solver (for uniqueness checking) ────────────────────── */

  /**
   * Solve a puzzle given constraints. Returns number of solutions found (stops at 2).
   * constraints: { rowClues, colClues, prefilled }
   * solution: the known solution (to verify against)
   */
  function countSolutions(constraints, maxCount) {
    maxCount = maxCount || 2;
    const grid = Array.from({ length: 4 }, () => Array(4).fill(0));
    const fixed = Array.from({ length: 4 }, () => Array(4).fill(false));

    // Place prefilled
    for (const [r, c, v] of constraints.prefilled) {
      grid[r][c] = v;
      fixed[r][c] = true;
    }

    let count = 0;

    function valid(r, c, v) {
      // Row uniqueness
      for (let i = 0; i < 4; i++) {
        if (i !== c && grid[r][i] === v) return false;
      }
      // Column uniqueness
      for (let i = 0; i < 4; i++) {
        if (i !== r && grid[i][c] === v) return false;
      }
      // Row shape clue
      const rc = constraints.rowClues[r];
      if (rc && shape(v) !== rc[c]) return false;
      // Column fill clue
      const cc = constraints.colClues[c];
      if (cc && fill(v) !== cc[r]) return false;

      return true;
    }

    function solve(pos) {
      if (count >= maxCount) return;
      if (pos === 16) { count++; return; }
      const r = Math.floor(pos / 4);
      const c = pos % 4;
      if (fixed[r][c]) {
        solve(pos + 1);
        return;
      }
      for (let v = 1; v <= 4; v++) {
        if (valid(r, c, v)) {
          grid[r][c] = v;
          solve(pos + 1);
          grid[r][c] = 0;
        }
      }
    }

    solve(0);
    return count;
  }

  /* ── Puzzle generator ────────────────────────────────────── */

  /**
   * Generate a puzzle from a Latin square solution.
   * Strategy:
   *   1. Randomly select 2-3 row clues and 2-3 column clues
   *   2. Check if unique with just clues
   *   3. If not unique, add 1-2 prefilled cells
   *   4. Verify uniqueness again
   */
  function generatePuzzle(rng) {
    const solution = generateLatinSquare(rng);

    // Extract shape/fill data from solution
    const rowShapes = solution.map(row => row.map(v => shape(v)));
    const colFills = [];
    for (let c = 0; c < 4; c++) {
      colFills.push([0, 1, 2, 3].map(r => fill(solution[r][c])));
    }

    // Try different clue combinations
    for (let attempt = 0; attempt < 50; attempt++) {
      // Pick 2-3 row clues
      const rowIndices = shuffle([0, 1, 2, 3], rng);
      const numRowClues = 2 + Math.floor(rng() * 2); // 2 or 3
      const rowClues = [null, null, null, null];
      for (let i = 0; i < numRowClues; i++) {
        rowClues[rowIndices[i]] = rowShapes[rowIndices[i]];
      }

      // Pick 2-3 column clues
      const colIndices = shuffle([0, 1, 2, 3], rng);
      const numColClues = 2 + Math.floor(rng() * 2); // 2 or 3
      const colClues = [null, null, null, null];
      for (let i = 0; i < numColClues; i++) {
        colClues[colIndices[i]] = colFills[colIndices[i]];
      }

      // Check uniqueness with no prefilled
      let constraints = { rowClues, colClues, prefilled: [] };
      let sols = countSolutions(constraints, 2);

      if (sols === 1) {
        return { solution, rowClues, colClues, prefilled: [] };
      }

      // Try adding 1 prefilled cell
      if (sols > 1) {
        const cellOrder = shuffle(
          Array.from({ length: 16 }, (_, i) => [Math.floor(i / 4), i % 4]),
          rng
        );

        for (const [r, c] of cellOrder) {
          const prefilled = [[r, c, solution[r][c]]];
          constraints = { rowClues, colClues, prefilled };
          sols = countSolutions(constraints, 2);
          if (sols === 1) {
            return { solution, rowClues, colClues, prefilled };
          }
        }

        // Try 2 prefilled cells
        for (let i = 0; i < cellOrder.length; i++) {
          for (let j = i + 1; j < Math.min(i + 6, cellOrder.length); j++) {
            const prefilled = [
              [cellOrder[i][0], cellOrder[i][1], solution[cellOrder[i][0]][cellOrder[i][1]]],
              [cellOrder[j][0], cellOrder[j][1], solution[cellOrder[j][0]][cellOrder[j][1]]],
            ];
            constraints = { rowClues, colClues, prefilled };
            sols = countSolutions(constraints, 2);
            if (sols === 1) {
              return { solution, rowClues, colClues, prefilled };
            }
          }
        }
      }
    }

    // Fallback: return with more clues (all rows + all cols, no prefill)
    return {
      solution,
      rowClues: rowShapes,
      colClues: colFills,
      prefilled: [],
    };
  }

  /* ── Daily puzzle ────────────────────────────────────────── */

  function dailyPuzzle() {
    const day = dayIndex();
    const seed = day * 2654435761; // Knuth multiplicative hash
    const rng = mulberry32(seed);
    return generatePuzzle(rng);
  }

  /* ── Public API ──────────────────────────────────────────── */

  return {
    generatePuzzle,
    dailyPuzzle,
    countSolutions,
    generateLatinSquare,
    mulberry32,
    dayIndex,
  };

})();
