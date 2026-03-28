/**
 * ui.js — all DOM reads and writes live here.
 * game.js calls these functions; it never touches the DOM directly.
 */

import { LIVES, BOARDS_PER_RUN, BOARD_TIME, CHAIN_MULTIPLIERS } from './constants.js';

const $ = id => document.getElementById(id);

// DOM refs resolved once at module load (module is deferred, so DOM is ready).
const D = {
  grid:           $('grid'),
  target:         $('target'),
  sumLine:        $('sumline'),
  expr:           $('expr'),
  delta:          $('delta'),
  toast:          $('toast'),
  lives:          $('lives'),
  progress:       $('progress'),
  score:          $('score'),
  chain:          $('chain'),
  mult:           $('mult'),
  timerBar:       $('timer-bar'),
  timerTrack:     $('timer-track'),
  gamePanel:      $('game-panel'),
  resultPanel:    $('result-panel'),
  idlePanel:      $('idle-panel'),
  resultHeader:   $('result-header'),
  resultScore:    $('result-score'),
  resultBoards:   $('result-boards'),
  resultChainStat:$('result-chain-stat'),
  resultBest:     $('result-best'),
  idleBest:       $('idle-best'),
};

// ---------------------------------------------------------------------------
// Phase switching
// ---------------------------------------------------------------------------

export function showPhase(phase) {
  D.idlePanel.classList.toggle('hidden', phase !== 'idle');
  D.gamePanel.classList.toggle('hidden', phase !== 'playing');
  D.resultPanel.classList.toggle('hidden', phase !== 'result');
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export function renderLives(lives) {
  const full  = Math.max(0, lives);
  const empty = Math.max(0, LIVES - lives);
  D.lives.textContent = '❤️'.repeat(full) + '🖤'.repeat(empty);
}

export function renderProgress(boardNum) {
  D.progress.textContent = `${boardNum}/${BOARDS_PER_RUN}`;
}

export function renderScore(score) {
  D.score.textContent = String(score);
}

/**
 * Renders chain count and the multiplier that will apply to the next board.
 */
export function renderChain(chain) {
  D.chain.textContent = String(chain);
  const idx  = Math.min(chain, CHAIN_MULTIPLIERS.length - 1);
  const mult = CHAIN_MULTIPLIERS[idx];
  D.mult.textContent = mult > 1 ? `×${mult}` : '';
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

export function renderTimer(timeLeft) {
  const pct = timeLeft / BOARD_TIME;
  D.timerBar.style.width = `${Math.max(0, pct * 100)}%`;
  const cls = timeLeft <= 3 ? 'danger' : timeLeft <= 5 ? 'warn' : '';
  D.timerBar.className = 'timer-bar' + (cls ? ` ${cls}` : '');
}

export function flashTimerPenalty() {
  D.timerTrack.classList.add('penalty-flash');
  setTimeout(() => D.timerTrack.classList.remove('penalty-flash'), 350);
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function renderTarget(target) {
  D.target.textContent = String(target);
}

export function renderBoard(cells, onTap) {
  D.grid.innerHTML = '';
  cells.forEach((c, idx) => {
    const el = document.createElement('div');
    el.className = 'cell';
    el.textContent = c.val;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', () => onTap(idx));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(idx); }
    });
    D.grid.appendChild(el);
  });
}

export function updateCellSelection(cells) {
  const cellEls = D.grid.querySelectorAll('.cell');
  cells.forEach((c, i) => cellEls[i].classList.toggle('sel', c.selected));
}

/**
 * Updates the sum display. Returns the current running total.
 */
export function renderSum(picks, cells, target) {
  const s     = picks.reduce((a, i) => a + cells[i].val, 0);
  const expr  = picks.map(i => cells[i].val).join(' + ');
  const delta = target - s;

  D.expr.textContent    = expr;
  D.sumLine.textContent = `Total ${s}`;
  D.delta.classList.remove('exact', 'over');

  if (s === 0)        { D.delta.textContent = `Need ${target}`; }
  else if (delta > 0) { D.delta.textContent = `Need ${delta}`; }
  else if (delta < 0) { D.delta.textContent = `Over by ${Math.abs(delta)}`; D.delta.classList.add('over'); }
  else                { D.delta.textContent = 'Exact ✓'; D.delta.classList.add('exact'); }

  return s;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function showToast(msg, type = '') {
  D.toast.textContent = msg;
  D.toast.className   = 'toast' + (type ? ` ${type}` : '');
}

export function clearToast() {
  D.toast.textContent = '';
  D.toast.className   = 'toast';
}

export function flashCells(type) {
  const cellEls = D.grid.querySelectorAll('.cell');
  cellEls.forEach(el => el.classList.add(type));
  setTimeout(() => cellEls.forEach(el => el.classList.remove(type)), 220);
}

// ---------------------------------------------------------------------------
// Result screen
// ---------------------------------------------------------------------------

export function renderResult(state, bestAllTime, todayBest, isNewBest, allBoardsDone) {
  const { score, exactHits, bestChain, lives } = state;
  const livesLost = LIVES - Math.max(0, lives);
  const livesStr  = livesLost === 0
    ? 'All lives intact'
    : livesLost === 1 ? '1 life lost' : `${livesLost} lives lost`;

  const isPerfect = allBoardsDone && lives === LIVES;
  D.resultHeader.textContent = isPerfect ? '✦ Perfect Run' : allBoardsDone ? 'Run Complete' : 'Lives Out';

  D.resultScore.textContent = String(score);
  D.resultBoards.innerHTML  = `<strong>${exactHits}</strong>/${BOARDS_PER_RUN} boards cleared · ${livesStr}`;
  D.resultChainStat.innerHTML = `Best chain: <strong>${bestChain}</strong>`;

  if (isNewBest) {
    D.resultBest.textContent = `New best! ${bestAllTime} pts`;
    D.resultBest.className   = 'result-best new-best';
  } else {
    D.resultBest.textContent = `Best: ${bestAllTime} pts · Today: ${todayBest} pts`;
    D.resultBest.className   = 'result-best';
  }

  // Keep idle screen in sync for next play
  D.idleBest.textContent = String(bestAllTime);
}

export function renderIdleBest(score) {
  D.idleBest.textContent = String(score);
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

export function buildShareText({ score, exactHits, bestChain, lives }) {
  const livesLeft = '❤️'.repeat(Math.max(0, lives)) + '🖤'.repeat(Math.max(0, LIVES - lives));
  return [
    'TapSum',
    `⭐ ${score} pts`,
    `🎯 ${exactHits}/${BOARDS_PER_RUN} boards`,
    `🔥 Chain ×${bestChain}`,
    livesLeft,
    location.origin + location.pathname,
  ].join('\n');
}
