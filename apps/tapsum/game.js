/**
 * game.js — main controller.
 * Owns: state, timer, run lifecycle, interaction handling.
 * Delegates all DOM work to ui.js.
 */

import {
  BOARDS_PER_RUN, LIVES, BOARD_TIME, OVER_PENALTY,
  BASE_SCORE, SPEED_BONUS_MAX, CHAIN_MULTIPLIERS,
} from './constants.js';
import { generateBoard }                                          from './board.js';
import { getBestScore, saveBestScore, getTodayBest, saveTodayBest, pushToCloud } from './storage.js';
import { toggleAmbience }                                         from './audio.js';
import * as UI                                                    from './ui.js';

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

function freshState() {
  return {
    phase:     'idle',   // 'idle' | 'playing' | 'result'
    boardNum:  0,
    lives:     LIVES,
    score:     0,
    chain:     0,        // consecutive exact hits
    bestChain: 0,
    exactHits: 0,
    timeLeft:  BOARD_TIME,
    target:    0,
    cells:     [],       // [{ val, selected }]
    picks:     [],       // indices of selected cells
    won:       false,    // blocks interaction during board transitions
  };
}

let state = freshState();
let timerInterval = null;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function calcBoardScore(timeLeft, chainBeforeWin) {
  const speedBonus = Math.round((timeLeft / BOARD_TIME) * SPEED_BONUS_MAX);
  const idx        = Math.min(chainBeforeWin, CHAIN_MULTIPLIERS.length - 1);
  return Math.round((BASE_SCORE + speedBonus) * CHAIN_MULTIPLIERS[idx]);
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function startTimer() {
  stopTimer();
  state.timeLeft = BOARD_TIME;
  UI.renderTimer(BOARD_TIME);

  timerInterval = setInterval(() => {
    if (state.phase !== 'playing') { stopTimer(); return; }
    // Use toFixed(1) to avoid floating-point drift accumulating over 100 ticks
    state.timeLeft = parseFloat((state.timeLeft - 0.1).toFixed(1));
    UI.renderTimer(state.timeLeft);
    if (state.timeLeft <= 0) { stopTimer(); onTimeout(); }
  }, 100);
}

// ---------------------------------------------------------------------------
// Board lifecycle
// ---------------------------------------------------------------------------

function loadBoard() {
  const { target, cells } = generateBoard();
  state.target = target;
  state.cells  = cells;
  state.picks  = [];
  state.won    = false;

  UI.renderTarget(target);
  UI.renderBoard(cells, onTap);
  UI.renderSum([], cells, target);
  UI.clearToast();
  startTimer();
}

function nextBoard() {
  if (state.phase !== 'playing') return; // guard against race conditions
  state.boardNum += 1;
  if (state.boardNum > BOARDS_PER_RUN || state.lives <= 0) { endRun(); return; }
  UI.renderProgress(state.boardNum);
  loadBoard();
}

// ---------------------------------------------------------------------------
// Win / timeout / skip
// ---------------------------------------------------------------------------

function onWin() {
  stopTimer();
  state.won = true;

  const chainBefore  = state.chain;       // multiplier applied to this board
  state.chain       += 1;
  state.exactHits   += 1;
  if (state.chain > state.bestChain) state.bestChain = state.chain;

  const pts        = calcBoardScore(state.timeLeft, chainBefore);
  state.score     += pts;

  if (navigator.vibrate) navigator.vibrate([18, 30, 18]);
  UI.flashCells('hit');
  UI.renderChain(state.chain);
  UI.renderScore(state.score);

  // Toast: show multiplier if one was applied
  const idx  = Math.min(chainBefore, CHAIN_MULTIPLIERS.length - 1);
  const mult = CHAIN_MULTIPLIERS[idx];
  UI.showToast(mult > 1 ? `+${pts} ×${mult}` : `+${pts}`, 'ok');

  setTimeout(nextBoard, 700);
}

function onTimeout() {
  state.won    = true; // block further taps during transition
  state.chain  = 0;
  state.lives -= 1;

  if (navigator.vibrate) navigator.vibrate(50);
  UI.flashCells('over');
  UI.renderLives(state.lives);
  UI.renderChain(0);
  UI.showToast("Time's up! −1 life", 'err');

  if (state.lives <= 0) { setTimeout(endRun, 800); }
  else                  { setTimeout(nextBoard, 950); }
}

function onSkip() {
  if (state.won || state.phase !== 'playing') return;
  stopTimer();
  state.won    = true;
  state.chain  = 0;
  state.lives -= 1;

  UI.renderLives(state.lives);
  UI.renderChain(0);
  UI.showToast('Skipped — −1 life', 'err');

  if (state.lives <= 0) { setTimeout(endRun, 700); }
  else                  { setTimeout(nextBoard, 600); }
}

// ---------------------------------------------------------------------------
// Run management
// ---------------------------------------------------------------------------

function startRun() {
  state          = freshState();
  state.phase    = 'playing';
  state.boardNum = 1;

  UI.showPhase('playing');
  UI.renderLives(LIVES);
  UI.renderProgress(1);
  UI.renderScore(0);
  UI.renderChain(0);
  loadBoard();
}

function endRun() {
  stopTimer();
  state.phase = 'result';

  const allBoardsDone = state.boardNum > BOARDS_PER_RUN;
  const prevBest      = getBestScore();
  const isNewBest     = state.score > prevBest;
  const finalBest     = isNewBest ? state.score : prevBest;

  if (isNewBest) {
    saveBestScore(state.score);
    pushToCloud(state.score); // non-critical, fire-and-forget
  }
  saveTodayBest(state.score);

  UI.showPhase('result');
  UI.renderResult(state, finalBest, getTodayBest(), isNewBest, allBoardsDone);
}

// ---------------------------------------------------------------------------
// Tap handler
// ---------------------------------------------------------------------------

function onTap(i) {
  if (state.won || state.phase !== 'playing') return;

  const c = state.cells[i];
  c.selected = !c.selected;
  if (c.selected) { state.picks.push(i); }
  else            { state.picks = state.picks.filter(x => x !== i); }

  UI.updateCellSelection(state.cells);
  const s = UI.renderSum(state.picks, state.cells, state.target);

  if (s === state.target) {
    onWin();
  } else if (s > state.target) {
    if (navigator.vibrate) navigator.vibrate(14);
    // Auto-revert the offending tap
    c.selected = false;
    state.picks = state.picks.filter(x => x !== i);
    UI.updateCellSelection(state.cells);
    UI.renderSum(state.picks, state.cells, state.target);
    // Time penalty
    state.timeLeft = Math.max(0.5, state.timeLeft - OVER_PENALTY);
    UI.renderTimer(state.timeLeft);
    UI.flashTimerPenalty();
    UI.showToast(`Over! −${OVER_PENALTY}s`, 'err');
  } else {
    UI.clearToast();
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

const lastHitByVal = {};

window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
  if (state.phase !== 'playing' || state.won) return;

  if (e.key >= '1' && e.key <= '9') {
    const d     = parseInt(e.key, 10);
    const start = (lastHitByVal[d] ?? -1) + 1;
    const order = [...Array(9).keys()];
    const perm  = order.slice(start).concat(order.slice(0, start));
    for (const i of perm) {
      if (state.cells[i].val === d) { lastHitByVal[d] = i; onTap(i); return; }
    }
    return;
  }

  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    if (!state.picks.length) return;
    const i = state.picks[state.picks.length - 1];
    state.cells[i].selected = false;
    state.picks.pop();
    UI.updateCellSelection(state.cells);
    UI.renderSum(state.picks, state.cells, state.target);
    return;
  }

  if (e.key === 'Escape') {
    state.picks.forEach(i => { state.cells[i].selected = false; });
    state.picks = [];
    UI.updateCellSelection(state.cells);
    UI.renderSum(state.picks, state.cells, state.target);
  }
});

// ---------------------------------------------------------------------------
// Button listeners
// ---------------------------------------------------------------------------

document.getElementById('clear').addEventListener('click', () => {
  if (state.won || state.phase !== 'playing') return;
  state.picks.forEach(i => { state.cells[i].selected = false; });
  state.picks = [];
  UI.updateCellSelection(state.cells);
  UI.renderSum(state.picks, state.cells, state.target);
  UI.clearToast();
});

document.getElementById('skip').addEventListener('click', onSkip);
document.getElementById('start').addEventListener('click', startRun);
document.getElementById('replay').addEventListener('click', startRun);

document.getElementById('share-btn').addEventListener('click', async () => {
  const text = UI.buildShareText(state);
  try {
    if (navigator.share)             { await navigator.share({ title: 'TapSum', text }); return; }
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); UI.showToast('Copied!', 'ok'); return; }
  } catch { /* noop */ }
  UI.showToast('Share not available on this device', 'err');
});

document.getElementById('ambience').addEventListener('click', e => {
  toggleAmbience(e.currentTarget);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

UI.renderIdleBest(getBestScore());
UI.showPhase('idle');
