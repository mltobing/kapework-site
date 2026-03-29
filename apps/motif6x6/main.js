/* main.js — Proof Grid 6×6: entry point, wires all modules together */

"use strict";

(function () {

  /* ── DOM refs ─────────────────────────────────────────── */
  var boardEl     = document.getElementById('board6');
  var statusEl    = document.getElementById('status6');
  var checkBtn    = document.getElementById('check-btn6');
  var checkText   = document.getElementById('check-text6');
  var resetBtn    = document.getElementById('reset-btn6');
  var subtitleEl  = document.getElementById('subtitle6');

  /* ── Board state ────────────────────────────────────────── */
  var cellEls = null;

  /* ── Analytics shortcut ─────────────────────────────────── */
  function track(name, props) {
    if (window.KapeworkAnalytics) window.KapeworkAnalytics.track(name, props);
  }

  /* ── Load a puzzle into the board ─────────────────────── */
  function loadPuzzle(puzzle, practice) {
    PG36Game.load(puzzle, practice);
    var built = PG36UI.buildBoard(boardEl, puzzle, onCellTap);
    cellEls = built.cellEls;
    updateCheckBtn();
    statusEl.textContent = '';
    statusEl.style.color = '';
    track('game_start');
    if (window.KapeworkAnalytics) window.KapeworkAnalytics.runStart();
  }

  /* ── Cell tap ───────────────────────────────────────────── */
  function onCellTap(e) {
    var cell = e.currentTarget;
    var r = parseInt(cell.getAttribute('data-r'), 10);
    var c = parseInt(cell.getAttribute('data-c'), 10);

    var changed = PG36Game.tapCell(r, c);
    if (!changed) return;

    PG36UI.updateCell(cellEls[r][c], PG36Game.getValue(r, c));
    if (navigator.vibrate) navigator.vibrate(6);
    updateCheckBtn();
  }

  /* ── Check button ───────────────────────────────────────── */
  function updateCheckBtn() {
    var full = PG36Game.isBoardFull();
    checkBtn.disabled = !full || PG36Game.getChecksLeft() <= 0 || PG36Game.getWon();
    checkText.textContent =
      'Check (' + PG36Game.getChecksLeft() + ')';
  }

  checkBtn.addEventListener('click', function () {
    var result = PG36Game.check();

    if (result.correct) {
      // Win animation
      PG36UI.applyWinAnimation(cellEls);
      updateCheckBtn();

      // Show result modal after animation
      setTimeout(function () {
        var puzzle = PG36Game.getPuzzle();
        PG36ResultModal.show({
          tier:       result.tier,
          elapsed:    result.elapsed,
          failed:     result.failed || (PG36Game.getMaxChecks() - result.checksLeft),
          maxChecks:  PG36Game.getMaxChecks(),
          streak:     result.streak,
          isPractice: PG36Game.getIsPractice(),
          onPlayAnother: function () {
            var rng = PG36Generator.mulberry32((Date.now() ^ 0xc0ffee) >>> 0);
            var p = PG36Generator.generatePuzzle(rng);
            loadPuzzle(p, true);
            subtitleEl.textContent = 'Practice board';
            track('practice_start');
            if (window.KapeworkAnalytics) window.KapeworkAnalytics.runStart();
          },
          onShare: function (btn) {
            var text = PG36Share.buildText({
              dayIndex:  PG36Generator.dayIndex(),
              tier:      result.tier,
              failed:    result.failed || (PG36Game.getMaxChecks() - result.checksLeft),
              maxChecks: PG36Game.getMaxChecks(),
              timeMs:    result.elapsed
            });
            PG36Share.share(text, btn);
            track('share_result', { tier: result.tier });
            if (window.KapeworkAnalytics) window.KapeworkAnalytics.primaryAction('share', { tier: result.tier });
          }
        });
      }, 1400);

      return;
    }

    // Wrong
    if (!result.full) {
      statusEl.textContent = 'Fill all cells first.';
      statusEl.style.color = 'var(--err)';
      return;
    }

    if (result.checksLeft > 0) {
      statusEl.textContent = result.checksLeft + ' check left.';
      statusEl.style.color = 'var(--err)';
    } else {
      statusEl.textContent = 'No checks left. Keep trying or reset.';
      statusEl.style.color = 'var(--err)';
    }
    updateCheckBtn();
  });

  /* ── Reset button ───────────────────────────────────────── */
  resetBtn.addEventListener('click', function () {
    if (PG36Game.getWon()) return;
    PG36Game.reset();

    // Re-render all non-locked cells
    var N = PG36Game.N;
    for (var r = 0; r < N; r++)
      for (var c = 0; c < N; c++) {
        cellEls[r][c].classList.remove('win6');
        if (!PG36Game.isLocked(r, c)) {
          PG36UI.updateCell(cellEls[r][c], PG36Game.getValue(r, c));
        }
      }

    statusEl.textContent = '';
    statusEl.style.color = '';
    updateCheckBtn();
  });

  /* ── Help modal ─────────────────────────────────────────── */
  window.openHelpModal6 = function () { PG36Help.open(); };

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    var puzzle = PG36Generator.dailyPuzzle();

    // Attempt to restore in-progress daily
    var restored = PG36Game.restoreProgress(puzzle);
    if (restored) {
      var built = PG36UI.buildBoard(boardEl, puzzle, onCellTap);
      cellEls = built.cellEls;
      updateCheckBtn();
    } else {
      loadPuzzle(puzzle, false);
    }

    subtitleEl.textContent = 'Expert symbol logic \u00b7 ' +
      new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    track('game_start');
    if (window.KapeworkAnalytics) window.KapeworkAnalytics.runStart();
  }

  init();

})();
