/* game.js — Proof Grid: board UI, input, conflict check, win detect */

"use strict";

/* ── Symbol encoding ─────────────────────────────────────────
   Each cell is 0-4:
     0 = empty
     1 = hollow circle
     2 = filled circle
     3 = hollow square
     4 = filled square

   Shape:  circle (1,2)  or square (3,4)
   Fill:   hollow (1,3)  or filled (2,4)
──────────────────────────────────────────────────────────── */

const SYM = {
  EMPTY: 0,
  HOLLOW_CIRCLE: 1,
  FILLED_CIRCLE: 2,
  HOLLOW_SQUARE: 3,
  FILLED_SQUARE: 4,
};

const SYM_COUNT = 4; // 1..4

function symShape(v) { return v <= 2 ? "circle" : "square"; }
function symFill(v)  { return (v === 1 || v === 3) ? "hollow" : "filled"; }

/* SVG markup for each symbol */
const SYM_SVG = {
  0: "",
  1: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  2: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="currentColor"/></svg>',
  3: '<svg viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  4: '<svg viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="2" fill="currentColor"/></svg>',
};

/* ── Puzzle data ─────────────────────────────────────────── */

// Sample puzzle for initial testing
// Solution:
//   row0: 1 3 2 4  (HC HS FC FS)
//   row1: 4 2 3 1  (FS FC HS HC)
//   row2: 2 4 1 3  (FC FS HC HS)
//   row3: 3 1 4 2  (HS HC FS FC)

const SAMPLE_PUZZLE = {
  solution: [
    [1, 3, 2, 4],
    [4, 2, 3, 1],
    [2, 4, 1, 3],
    [3, 1, 4, 2],
  ],
  // Row shape clues: array of 4; null = no clue, else array of "circle"|"square"
  rowClues: [
    ["circle", "square", "circle", "square"],
    ["square", "circle", "square", "circle"],
    null,
    null,
  ],
  // Column fill clues: array of 4; null = no clue, else array of "hollow"|"filled"
  colClues: [
    null,
    ["hollow", "filled", "filled", "hollow"],
    ["filled", "hollow", "hollow", "filled"],
    null,
  ],
  // Prefilled cells: [row, col, value]
  prefilled: [[2, 0, 2]],
};

/* ── Game state ──────────────────────────────────────────── */

let puzzle = null;    // current puzzle object
let grid = [];        // 4x4 array of current cell values (0-4)
let locked = [];      // 4x4 boolean: true if prefilled
let cellEls = [];     // 4x4 DOM elements
let won = false;

/* ── DOM refs ────────────────────────────────────────────── */
const colCluesEl = document.getElementById("col-clues");
const gridAreaEl = document.querySelector(".grid-area");
const statusEl   = document.getElementById("status");
const checkBtn   = document.getElementById("check-btn");
const resetBtn   = document.getElementById("reset-btn");
const helpBtn    = document.getElementById("help-btn");
const helpModal  = document.getElementById("help-modal");
const helpClose  = document.getElementById("help-close");
const subtitleEl = document.getElementById("subtitle");

/* ── Help modal ──────────────────────────────────────────── */
helpBtn.addEventListener("click", () => { helpModal.hidden = false; });
helpClose.addEventListener("click", () => { helpModal.hidden = true; });
helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) helpModal.hidden = true;
});

/* ── Build board ─────────────────────────────────────────── */

function loadPuzzle(p) {
  puzzle = p;
  won = false;
  grid = Array.from({ length: 4 }, () => Array(4).fill(0));
  locked = Array.from({ length: 4 }, () => Array(4).fill(false));
  cellEls = Array.from({ length: 4 }, () => []);

  // Apply prefilled
  for (const [r, c, v] of p.prefilled) {
    grid[r][c] = v;
    locked[r][c] = true;
  }

  buildBoard();
  statusEl.textContent = "";
}

function buildBoard() {
  // Clear previous
  colCluesEl.innerHTML = '<div class="clue-corner"></div>';
  gridAreaEl.innerHTML = "";

  // Column clues
  for (let c = 0; c < 4; c++) {
    const wrap = document.createElement("div");
    wrap.className = "col-clue-cell";
    const clue = puzzle.colClues[c];
    for (let r = 0; r < 4; r++) {
      const pip = document.createElement("div");
      pip.className = "col-clue-pip";
      if (clue) {
        pip.classList.add(clue[r]); // "hollow" or "filled"
      } else {
        pip.classList.add("none");
      }
      wrap.appendChild(pip);
    }
    colCluesEl.appendChild(wrap);
  }

  // Grid rows
  for (let r = 0; r < 4; r++) {
    const rowDiv = document.createElement("div");
    rowDiv.className = "grid-row";

    // Row clue strip
    const strip = document.createElement("div");
    strip.className = "row-clue-strip";
    const rClue = puzzle.rowClues[r];
    for (let c = 0; c < 4; c++) {
      const pip = document.createElement("div");
      pip.className = "row-clue-pip";
      if (rClue) {
        pip.classList.add(rClue[c]); // "circle" or "square"
      } else {
        pip.classList.add("none");
      }
      strip.appendChild(pip);
    }
    rowDiv.appendChild(strip);

    // Cells
    for (let c = 0; c < 4; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      if (locked[r][c]) cell.classList.add("prefilled");
      cell.addEventListener("click", () => onCellTap(r, c));
      rowDiv.appendChild(cell);
      cellEls[r][c] = cell;
    }

    gridAreaEl.appendChild(rowDiv);
  }

  renderAll();
}

/* ── Render ───────────────────────────────────────────────── */

function renderAll() {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      cellEls[r][c].innerHTML = SYM_SVG[grid[r][c]];
    }
  }
}

/* ── Input ────────────────────────────────────────────────── */

function onCellTap(r, c) {
  if (won || locked[r][c]) return;
  // Cycle: 0 → 1 → 2 → 3 → 4 → 0
  grid[r][c] = (grid[r][c] + 1) % 5;
  cellEls[r][c].innerHTML = SYM_SVG[grid[r][c]];
  if (navigator.vibrate) navigator.vibrate(6);
  clearHighlights();
  checkConflicts();
}

/* ── Conflict checking ───────────────────────────────────── */

function clearHighlights() {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      cellEls[r][c].classList.remove("conflict", "correct", "win");
}

function checkConflicts() {
  let hasConflict = false;
  const conflicts = Array.from({ length: 4 }, () => Array(4).fill(false));

  // Check rows for duplicate symbols
  for (let r = 0; r < 4; r++) {
    const seen = {};
    for (let c = 0; c < 4; c++) {
      const v = grid[r][c];
      if (v === 0) continue;
      if (seen[v] !== undefined) {
        conflicts[r][c] = true;
        conflicts[r][seen[v]] = true;
        hasConflict = true;
      } else {
        seen[v] = c;
      }
    }
  }

  // Check columns for duplicate symbols
  for (let c = 0; c < 4; c++) {
    const seen = {};
    for (let r = 0; r < 4; r++) {
      const v = grid[r][c];
      if (v === 0) continue;
      if (seen[v] !== undefined) {
        conflicts[r][c] = true;
        conflicts[seen[v]][c] = true;
        hasConflict = true;
      } else {
        seen[v] = r;
      }
    }
  }

  // Check row shape clues
  for (let r = 0; r < 4; r++) {
    const clue = puzzle.rowClues[r];
    if (!clue) continue;
    for (let c = 0; c < 4; c++) {
      const v = grid[r][c];
      if (v === 0) continue;
      if (symShape(v) !== clue[c]) {
        conflicts[r][c] = true;
        hasConflict = true;
      }
    }
  }

  // Check column fill clues
  for (let c = 0; c < 4; c++) {
    const clue = puzzle.colClues[c];
    if (!clue) continue;
    for (let r = 0; r < 4; r++) {
      const v = grid[r][c];
      if (v === 0) continue;
      if (symFill(v) !== clue[r]) {
        conflicts[r][c] = true;
        hasConflict = true;
      }
    }
  }

  // Apply conflict classes
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      cellEls[r][c].classList.toggle("conflict", conflicts[r][c]);

  return hasConflict;
}

/* ── Win detection ───────────────────────────────────────── */

function checkWin() {
  // All cells filled?
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (grid[r][c] === 0) return false;

  // No conflicts?
  if (checkConflicts()) return false;

  // Matches solution?
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (grid[r][c] !== puzzle.solution[r][c]) return false;

  return true;
}

function onCheck() {
  if (won) return;

  // Check if all filled
  let empty = 0;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (grid[r][c] === 0) empty++;

  if (empty > 0) {
    statusEl.textContent = `${empty} cell${empty > 1 ? "s" : ""} still empty.`;
    statusEl.style.color = "var(--muted)";
    return;
  }

  if (checkWin()) {
    won = true;
    statusEl.textContent = "Solved!";
    statusEl.style.color = "var(--ok)";
    clearHighlights();
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        cellEls[r][c].classList.add("win");
        cellEls[r][c].style.animationDelay = `${(r * 4 + c) * 60}ms`;
      }
  } else {
    statusEl.textContent = "Not quite — check the highlighted cells.";
    statusEl.style.color = "var(--err)";
    checkConflicts();
  }
}

function onReset() {
  won = false;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (!locked[r][c]) grid[r][c] = 0;
  clearHighlights();
  renderAll();
  statusEl.textContent = "";
}

/* ── Wire buttons ────────────────────────────────────────── */
checkBtn.addEventListener("click", onCheck);
resetBtn.addEventListener("click", onReset);

/* ── Init ────────────────────────────────────────────────── */

function init() {
  // Use generated daily puzzle if engine is available, else sample
  if (typeof ProofEngine !== "undefined" && ProofEngine.dailyPuzzle) {
    const daily = ProofEngine.dailyPuzzle();
    if (daily) {
      loadPuzzle(daily);
      subtitleEl.textContent = "Daily puzzle · " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return;
    }
  }
  loadPuzzle(SAMPLE_PUZZLE);
}

init();
