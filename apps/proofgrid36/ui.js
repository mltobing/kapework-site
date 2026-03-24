/* ui.js — Proof Grid 6×6: board rendering, symbol SVGs, clue marks */

"use strict";

var PG36UI = (function () {

  var N = 6;

  /* ── Symbol SVGs ─────────────────────────────────────────
   *  Index 0..5 maps directly to the game symbol codes.
   *  -1 = empty cell (no SVG content).
   * ────────────────────────────────────────────────────── */
  var SYMS = [
    // 0 — hollow circle
    '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
    // 1 — filled circle
    '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="currentColor"/></svg>',
    // 2 — hollow square
    '<svg viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
    // 3 — filled square
    '<svg viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="2" fill="currentColor"/></svg>',
    // 4 — hollow triangle
    '<svg viewBox="0 0 32 32"><polygon points="16,5 27,27 5,27" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>',
    // 5 — filled triangle
    '<svg viewBox="0 0 32 32"><polygon points="16,5 27,27 5,27" fill="currentColor" stroke="none"/></svg>'
  ];

  function symSVG(v) {
    return (v >= 0 && v < N) ? SYMS[v] : '';
  }

  /* ── Build board DOM ─────────────────────────────────────
   *
   * The board is an 11×11 CSS grid:
   *   cells at odd grid positions  (1,3,5,7,9,11)
   *   gaps  at even grid positions
   *
   * Returns an object with:
   *   cellEls[r][c] — the DOM element for each cell
   * ────────────────────────────────────────────────────── */
  function buildBoard(boardEl, puzzle, onCellTap) {
    boardEl.innerHTML = '';

    var cellEls = [];
    for (var r = 0; r < N; r++) cellEls.push([null, null, null, null, null, null]);

    // Index clues for fast lookup
    var clueMap = {};
    for (var i = 0; i < puzzle.clues.length; i++) {
      var cl = puzzle.clues[i];
      var key = cl.orientation + ':' + cl.r + ':' + cl.c;
      clueMap[key] = cl;
    }

    // ── Cells
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var cell = document.createElement('div');
        cell.className = 'cell6';
        if (PG36Game.isLocked(r, c)) cell.classList.add('prefilled');
        cell.style.gridRow    = String(r * 2 + 1);
        cell.style.gridColumn = String(c * 2 + 1);
        cell.setAttribute('data-r', String(r));
        cell.setAttribute('data-c', String(c));
        cell.innerHTML = symSVG(PG36Game.getValue(r, c));
        cell.addEventListener('click', onCellTap);
        boardEl.appendChild(cell);
        cellEls[r][c] = cell;
      }
    }

    // ── Horizontal gap clues (between columns in same row)
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N - 1; c++) {
        var key = 'h:' + r + ':' + c;
        var gap = document.createElement('div');
        gap.className = 'gap6 gap6-h';
        gap.style.gridRow    = String(r * 2 + 1);
        gap.style.gridColumn = String(c * 2 + 2);

        if (clueMap[key]) {
          var mark = document.createElement('div');
          mark.className = 'clue6 clue6-h ' +
            (clueMap[key].type === 'same-shape' ? 'clue6-outline' : 'clue6-solid');
          gap.appendChild(mark);
        }

        boardEl.appendChild(gap);
      }
    }

    // ── Vertical gap clues (between rows in same column)
    for (var r = 0; r < N - 1; r++) {
      for (var c = 0; c < N; c++) {
        var key = 'v:' + r + ':' + c;
        var gap = document.createElement('div');
        gap.className = 'gap6 gap6-v';
        gap.style.gridRow    = String(r * 2 + 2);
        gap.style.gridColumn = String(c * 2 + 1);

        if (clueMap[key]) {
          var mark = document.createElement('div');
          mark.className = 'clue6 clue6-v ' +
            (clueMap[key].type === 'same-shape' ? 'clue6-outline' : 'clue6-solid');
          gap.appendChild(mark);
        }

        boardEl.appendChild(gap);
      }
    }

    // ── Intersection spacers
    for (var r = 0; r < N - 1; r++) {
      for (var c = 0; c < N - 1; c++) {
        var sp = document.createElement('div');
        sp.className = 'gap6-corner';
        sp.style.gridRow    = String(r * 2 + 2);
        sp.style.gridColumn = String(c * 2 + 2);
        boardEl.appendChild(sp);
      }
    }

    return { cellEls: cellEls };
  }

  /* ── Update a single cell's symbol ─────────────────────── */
  function updateCell(cellEl, value) {
    cellEl.innerHTML = symSVG(value);
  }

  /* ── Apply win animation to all cells ──────────────────── */
  function applyWinAnimation(cellEls) {
    for (var r = 0; r < N; r++)
      for (var c = 0; c < N; c++) {
        cellEls[r][c].classList.add('win6');
        cellEls[r][c].style.animationDelay = (r * N + c) * 45 + 'ms';
      }
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    symSVG:           symSVG,
    buildBoard:       buildBoard,
    updateCell:       updateCell,
    applyWinAnimation: applyWinAnimation
  };

})();
