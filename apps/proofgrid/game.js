/* game.js — Proof Grid v2: board UI, pair clues, no oracle, 2-check limit */

"use strict";

/* ── Symbol encoding ─────────────────────────────────────────
   0 = empty
   1 = hollow circle
   2 = filled circle
   3 = hollow square
   4 = filled square
──────────────────────────────────────────────────────────── */

var SYM_SVG = [
  "",
  '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  '<svg viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="2" fill="currentColor"/></svg>'
];

/* ── Game state ──────────────────────────────────────────── */

var puzzle = null;
var grid = [];        // 4x4 current values (0-4)
var locked = [];      // 4x4 boolean
var cellEls = [];     // 4x4 DOM refs
var won = false;
var checksLeft = 2;

/* ── DOM refs ────────────────────────────────────────────── */
var boardEl   = document.getElementById("board");
var statusEl  = document.getElementById("status");
var checkBtn  = document.getElementById("check-btn");
var checkText = document.getElementById("check-text");
var resetBtn  = document.getElementById("reset-btn");
var helpBtn   = document.getElementById("help-btn");
var helpModal = document.getElementById("help-modal");
var helpClose = document.getElementById("help-close");
var subtitleEl = document.getElementById("subtitle");

/* ── Help modal ──────────────────────────────────────────── */
helpBtn.addEventListener("click", function () { helpModal.hidden = false; });
helpClose.addEventListener("click", function () { helpModal.hidden = true; });
helpModal.addEventListener("click", function (e) {
  if (e.target === helpModal) helpModal.hidden = true;
});

/* ── Load puzzle ─────────────────────────────────────────── */

function loadPuzzle(p) {
  puzzle = p;
  won = false;
  checksLeft = 2;
  grid = [];
  locked = [];
  cellEls = [];
  for (var r = 0; r < 4; r++) {
    grid.push([0, 0, 0, 0]);
    locked.push([false, false, false, false]);
    cellEls.push([null, null, null, null]);
  }

  for (var i = 0; i < p.givens.length; i++) {
    var g = p.givens[i];
    grid[g[0]][g[1]] = g[2];
    locked[g[0]][g[1]] = true;
  }

  buildBoard();
  updateCheckBtn();
  statusEl.textContent = "";
  statusEl.style.color = "";
}

/* ── Build board ─────────────────────────────────────────── */

function clueKey(clue) {
  return clue.orientation + ":" + clue.r + ":" + clue.c;
}

function buildBoard() {
  boardEl.innerHTML = "";

  // Index clues by gap position for fast lookup
  var clueMap = {};
  for (var i = 0; i < puzzle.clues.length; i++) {
    var cl = puzzle.clues[i];
    clueMap[clueKey(cl)] = cl;
  }

  // The board is a CSS grid with 7 columns and 7 rows:
  //   col pattern: cell gap cell gap cell gap cell
  //   row pattern: cell gap cell gap cell gap cell
  // Cells at grid positions (1,1) (1,3) (1,5) (1,7) etc.
  // Horizontal clue gaps at (row, col) where col is even
  // Vertical clue gaps at (row, col) where row is even

  for (var r = 0; r < 4; r++) {
    for (var c = 0; c < 4; c++) {
      // Cell
      var cell = document.createElement("div");
      cell.className = "cell";
      if (locked[r][c]) cell.classList.add("prefilled");
      cell.style.gridRow = (r * 2 + 1).toString();
      cell.style.gridColumn = (c * 2 + 1).toString();
      cell.setAttribute("data-r", r.toString());
      cell.setAttribute("data-c", c.toString());
      cell.addEventListener("click", onCellTap);
      cell.innerHTML = SYM_SVG[grid[r][c]];
      boardEl.appendChild(cell);
      cellEls[r][c] = cell;
    }
  }

  // Horizontal gap clues (between columns)
  for (var r = 0; r < 4; r++) {
    for (var c = 0; c < 3; c++) {
      var key = "h:" + r + ":" + c;
      var gap = document.createElement("div");
      gap.className = "gap gap-h";
      gap.style.gridRow = (r * 2 + 1).toString();
      gap.style.gridColumn = (c * 2 + 2).toString();

      if (clueMap[key]) {
        var mark = document.createElement("div");
        mark.className = "clue-mark clue-h";
        if (clueMap[key].type === "same-shape") {
          mark.classList.add("clue-outline");
        } else {
          mark.classList.add("clue-solid");
        }
        gap.appendChild(mark);
      }

      boardEl.appendChild(gap);
    }
  }

  // Vertical gap clues (between rows)
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 4; c++) {
      var key = "v:" + r + ":" + c;
      var gap = document.createElement("div");
      gap.className = "gap gap-v";
      gap.style.gridRow = (r * 2 + 2).toString();
      gap.style.gridColumn = (c * 2 + 1).toString();

      if (clueMap[key]) {
        var mark = document.createElement("div");
        mark.className = "clue-mark clue-v";
        if (clueMap[key].type === "same-shape") {
          mark.classList.add("clue-outline");
        } else {
          mark.classList.add("clue-solid");
        }
        gap.appendChild(mark);
      }

      boardEl.appendChild(gap);
    }
  }

  // Diagonal intersection gaps (purely empty spacers)
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 3; c++) {
      var spacer = document.createElement("div");
      spacer.className = "gap-corner";
      spacer.style.gridRow = (r * 2 + 2).toString();
      spacer.style.gridColumn = (c * 2 + 2).toString();
      boardEl.appendChild(spacer);
    }
  }
}

/* ── Input ────────────────────────────────────────────────── */

function onCellTap(e) {
  var cell = e.currentTarget;
  var r = parseInt(cell.getAttribute("data-r"));
  var c = parseInt(cell.getAttribute("data-c"));
  if (won || locked[r][c]) return;

  grid[r][c] = (grid[r][c] + 1) % 5;
  cell.innerHTML = SYM_SVG[grid[r][c]];
  if (navigator.vibrate) navigator.vibrate(6);

  // No oracle feedback — just update check button state
  updateCheckBtn();
}

/* ── Check system (2 checks, no oracle) ──────────────────── */

function isBoardFull() {
  for (var r = 0; r < 4; r++)
    for (var c = 0; c < 4; c++)
      if (grid[r][c] === 0) return false;
  return true;
}

function isBoardCorrect() {
  for (var r = 0; r < 4; r++)
    for (var c = 0; c < 4; c++)
      if (grid[r][c] !== puzzle.solution[r][c]) return false;
  return true;
}

function updateCheckBtn() {
  var full = isBoardFull();
  checkBtn.disabled = !full || checksLeft <= 0 || won;
  checkText.textContent = "Check (" + checksLeft + ")";
}

function onCheck() {
  if (won || checksLeft <= 0 || !isBoardFull()) return;

  if (isBoardCorrect()) {
    won = true;
    statusEl.textContent = "Solved!";
    statusEl.style.color = "var(--ok)";
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++) {
        cellEls[r][c].classList.add("win");
        cellEls[r][c].style.animationDelay = (r * 4 + c) * 60 + "ms";
      }
    updateCheckBtn();
    return;
  }

  // Wrong answer
  checksLeft--;
  if (checksLeft > 0) {
    statusEl.textContent = checksLeft + " check left.";
    statusEl.style.color = "var(--err)";
  } else {
    statusEl.textContent = "No checks left. Keep trying or reset.";
    statusEl.style.color = "var(--err)";
  }
  updateCheckBtn();
}

function onReset() {
  if (won) return;
  for (var r = 0; r < 4; r++)
    for (var c = 0; c < 4; c++) {
      if (!locked[r][c]) grid[r][c] = 0;
      cellEls[r][c].innerHTML = SYM_SVG[grid[r][c]];
      cellEls[r][c].classList.remove("win");
    }
  statusEl.textContent = "";
  statusEl.style.color = "";
  updateCheckBtn();
}

/* ── Wire buttons ────────────────────────────────────────── */
checkBtn.addEventListener("click", onCheck);
resetBtn.addEventListener("click", onReset);

/* ── Init ────────────────────────────────────────────────── */

function init() {
  if (typeof ProofEngine !== "undefined" && ProofEngine.dailyPuzzle) {
    var daily = ProofEngine.dailyPuzzle();
    if (daily) {
      loadPuzzle(daily);
      subtitleEl.textContent = "Daily puzzle \u00b7 " +
        new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return;
    }
  }
}

init();
