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
var failedChecks = 0;
var firstInteraction = false;
var startTime = null;   // timestamp of loadPuzzle
var isPracticeMode = false;
var APP_SLUG = window.KAPEWORK_APP_SLUG || "motif";

/* ── Analytics helper ────────────────────────────────────── */

function track(eventName, props) {
  if (window.KapeworkAnalytics) {
    window.KapeworkAnalytics.trackEvent(eventName, APP_SLUG, props);
  }
}

/* ── DOM refs ────────────────────────────────────────────── */
var boardEl    = document.getElementById("board");
var statusEl   = document.getElementById("status");
var checkBtn   = document.getElementById("check-btn");
var checkText  = document.getElementById("check-text");
var resetBtn   = document.getElementById("reset-btn");
var helpModal  = document.getElementById("help-modal");
var helpClose  = document.getElementById("help-close");
var subtitleEl = document.getElementById("subtitle");

/* ── Result modal DOM refs ───────────────────────────────── */
var resultModal       = document.getElementById("result-modal");
var resultTierEl      = document.getElementById("result-tier");
var resultDateEl      = document.getElementById("result-date");
var resultPillEl      = document.getElementById("result-pill");
var resultTimeEl      = document.getElementById("result-time");
var resultChecksEl    = document.getElementById("result-checks");
var resultStreakEl    = document.getElementById("result-streak");
var resultPlayAnother = document.getElementById("result-play-another");
var resultShare       = document.getElementById("result-share");
var resultHardMode    = document.getElementById("result-hard-mode");

/* ── Help modal — exposed for the shell's "How to play" item ─ */

window.openHelpModal = function () {
  helpModal.hidden = false;
};

helpClose.addEventListener("click", function () { helpModal.hidden = true; });
helpModal.addEventListener("click", function (e) {
  if (e.target === helpModal) helpModal.hidden = true;
});

/* ── Streak helpers ──────────────────────────────────────── */

function getLocalDateStr() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function loadStreakData() {
  try { return JSON.parse(localStorage.getItem('motif_streak') || 'null') || {}; }
  catch (e) { return {}; }
}

function saveStreakData(data) {
  try { localStorage.setItem('motif_streak', JSON.stringify(data)); } catch (e) {}
}

function recordAndGetStreak() {
  var today = getLocalDateStr();
  var data = loadStreakData();

  // Already recorded today — return stored streak
  if (data.lastDate === today) return data.count || 1;

  var newCount = 1;
  if (data.lastDate) {
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var yd = yesterday.getFullYear() + '-' +
      String(yesterday.getMonth() + 1).padStart(2, '0') + '-' +
      String(yesterday.getDate()).padStart(2, '0');
    if (data.lastDate === yd) newCount = (data.count || 1) + 1;
  }

  saveStreakData({ lastDate: today, count: newCount });
  return newCount;
}

/* ── Time / difficulty helpers ───────────────────────────── */

function formatTime(ms) {
  var s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60), sec = s % 60;
  return m + 'm' + (sec > 0 ? ' ' + sec + 's' : '');
}

function getDifficultyLabel() {
  if (!puzzle) return 'Medium';
  return puzzle.clues.length <= 5 ? 'Hard' : 'Medium';
}

function getResultTier(failed) {
  if (failed === 0) return 'Perfect';
  if (failed === 1) return 'Clean';
  return 'Solved';
}

/* ── Result modal ────────────────────────────────────────── */

function showResultModal(tier, elapsedMs, failed, streak) {
  resultTierEl.textContent = tier;
  resultDateEl.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });
  resultPillEl.textContent = getDifficultyLabel();
  resultTimeEl.textContent = formatTime(elapsedMs);
  resultChecksEl.textContent = failed + '/2';
  resultStreakEl.textContent = streak;
  resultModal.hidden = false;
}

resultModal.addEventListener("click", function (e) {
  if (e.target === resultModal) resultModal.hidden = true;
});

resultPlayAnother.addEventListener("click", function () {
  resultModal.hidden = true;
  var rng = ProofEngine.mulberry32((Date.now() ^ 0xdeadbeef) >>> 0);
  var practice = ProofEngine.generatePuzzle(rng);
  if (practice) {
    isPracticeMode = true;
    loadPuzzle(practice);
    subtitleEl.textContent = "Practice board";
    track('practice_start');
  }
});

resultShare.addEventListener("click", function () {
  var day = ProofEngine.dayIndex();
  var tier = resultTierEl.textContent;
  var failed = parseInt(resultChecksEl.textContent, 10) || 0;
  var timeStr = resultTimeEl.textContent;
  var text =
    'Motif #' + day + '\n' +
    tier + '\n' +
    failed + '/2 checks \u00b7 ' + timeStr + '\n' +
    'motif.kapework.com';

  if (navigator.share) {
    navigator.share({ text: text }).catch(function () {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function () {
      resultShare.textContent = 'Copied!';
      setTimeout(function () { resultShare.textContent = 'Share'; }, 2000);
    }).catch(function () {});
  }
  track('share_result', { tier: tier });
  if (window.KapeworkAnalytics) window.KapeworkAnalytics.primaryAction('share', { tier: tier }, APP_SLUG);
});

resultHardMode.addEventListener("click", function () {
  track('hard_mode_click');
  window.location.href = 'https://motif6x6.kapework.com/';
});

/* ── Load puzzle ─────────────────────────────────────────── */

function loadPuzzle(p) {
  puzzle = p;
  won = false;
  checksLeft = 2;
  failedChecks = 0;
  firstInteraction = false;
  startTime = Date.now();
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

  track('game_start');
  if (window.KapeworkAnalytics) window.KapeworkAnalytics.runStart(null, APP_SLUG);
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

  if (!firstInteraction) {
    firstInteraction = true;
    track('first_interaction');
    if (window.KapeworkAnalytics) window.KapeworkAnalytics.firstInteraction(null, APP_SLUG);
  }

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
  // Rule-based validation: accept any board satisfying all constraints
  return ProofEngine.validateBoard(grid, puzzle.clues, puzzle.givens);
}

function updateCheckBtn() {
  var full = isBoardFull();
  checkBtn.disabled = !full || checksLeft <= 0 || won;
  checkText.textContent = "Check (" + checksLeft + ")";
}

function onCheck() {
  if (won || checksLeft <= 0 || !isBoardFull()) return;

  track('check_used', { checks_remaining: checksLeft - 1 });

  if (isBoardCorrect()) {
    won = true;
    var elapsed = startTime ? Date.now() - startTime : 0;
    var tier = getResultTier(failedChecks);

    // Win animation
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++) {
        cellEls[r][c].classList.add("win");
        cellEls[r][c].style.animationDelay = (r * 4 + c) * 60 + "ms";
      }

    updateCheckBtn();
    track('solve_success', { tier: tier, checks_failed: failedChecks, time_ms: elapsed });
    if (window.KapeworkAnalytics) window.KapeworkAnalytics.runEnd({ outcome: 'win', tier: tier, checks_failed: failedChecks }, APP_SLUG);

    // Streak only counts for the daily, not practice
    var streak = isPracticeMode ? 1 : recordAndGetStreak();

    // Show result modal after animation settles
    setTimeout(function () {
      showResultModal(tier, elapsed, failedChecks, streak);
    }, 1200);

    return;
  }

  // Wrong answer
  failedChecks++;
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
  track('reset_used');
}

/* ── Wire buttons ────────────────────────────────────────── */
checkBtn.addEventListener("click", onCheck);
resetBtn.addEventListener("click", onReset);

/* ── Init ────────────────────────────────────────────────── */

function init() {
  if (typeof ProofEngine !== "undefined" && ProofEngine.dailyPuzzle) {
    var daily = ProofEngine.dailyPuzzle();
    if (daily) {
      isPracticeMode = false;
      loadPuzzle(daily);
      subtitleEl.textContent = "Daily symbol logic \u00b7 " +
        new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return;
    }
  }
}

init();
