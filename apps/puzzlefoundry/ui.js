/**
 * ui.js — Puzzle Foundry screen manager
 *
 * Manages transitions between the 4 screens:
 *   pack → detail → play → result
 *
 * Each screen is a div with class pf-screen; only one is active at a time.
 */

import { generatePack, instantiatePuzzle } from './generator.js';
import { saveLastPack, saveRecentSeed }     from './storage.js';
import { renderPlay as renderTargetForge }  from './families/target-forge.js';
import { renderPlay as renderOrderRepair }  from './families/order-repair.js';
import { renderPlay as renderPathTrace }    from './families/path-trace.js';
import { FAMILIES }                         from './seeds.js';

// ── State ──────────────────────────────────────────────────────────────────
let currentPack       = [];
let selectedSeed      = null;
let selectedDifficulty = 'medium';
let currentPuzzle     = null;

// ── Screen refs ────────────────────────────────────────────────────────────
let screens;

export function init() {
  screens = {
    pack:   document.getElementById('screen-pack'),
    detail: document.getElementById('screen-detail'),
    play:   document.getElementById('screen-play'),
    result: document.getElementById('screen-result'),
  };

  // Wire static buttons
  document.getElementById('btn-refresh-pack').addEventListener('click', refreshPack);
  document.getElementById('btn-back-to-pack').addEventListener('click', () => showScreen('pack'));
  document.getElementById('btn-back-to-detail').addEventListener('click', () => showScreen('detail'));
  document.getElementById('btn-reset-play').addEventListener('click', startPlay);
  document.getElementById('btn-play').addEventListener('click', startPlay);

  // Difficulty buttons
  document.querySelectorAll('.pf-diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDifficulty = btn.dataset.diff;
      document.querySelectorAll('.pf-diff-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Result actions
  document.getElementById('btn-remix').addEventListener('click', remixSeed);
  document.getElementById('btn-try-another').addEventListener('click', () => {
    showScreen('pack');
  });
  document.getElementById('btn-result-refresh').addEventListener('click', () => {
    refreshPack();
    showScreen('pack');
  });

  // Initial pack
  refreshPack();
}

// ── Screen switching ───────────────────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('active', k === name);
  });
}

// ── Pack screen ────────────────────────────────────────────────────────────
function refreshPack() {
  currentPack = generatePack();
  saveLastPack(currentPack);
  renderPackScreen();
  showScreen('pack');

  if (window.KapeworkAnalytics) {
    KapeworkAnalytics.track('puzzle_foundry_pack_generated');
  }
}

function renderPackScreen() {
  const grid = document.getElementById('seed-grid');
  grid.innerHTML = '';

  currentPack.forEach(seed => {
    const card = buildSeedCard(seed);
    card.addEventListener('click', () => openSeed(seed));
    grid.appendChild(card);
  });
}

function buildSeedCard(seed) {
  const { familyMeta } = seed;
  const card = document.createElement('button');
  card.className = 'pf-seed-card';
  card.style.setProperty('--family-color',     familyMeta.color);
  card.style.setProperty('--family-color-dim', familyMeta.colorDim);

  card.innerHTML = `
    <div class="pf-seed-family">
      <div class="pf-family-badge">${familyMeta.badge}</div>
      <div class="pf-family-label">${familyMeta.label}</div>
    </div>
    <div class="pf-seed-name">${escHtml(seed.name)}</div>
    <div class="pf-seed-hook">${escHtml(seed.hook)}</div>
    <div class="pf-seed-tags">${seed.tags.map(t => `<span class="pf-tag">${escHtml(t)}</span>`).join('')}</div>
  `;
  return card;
}

// ── Detail screen ──────────────────────────────────────────────────────────
function openSeed(seed) {
  selectedSeed = seed;
  selectedDifficulty = 'medium';

  const { familyMeta } = seed;
  const card = document.getElementById('detail-card');
  card.style.setProperty('--family-color',     familyMeta.color);
  card.style.setProperty('--family-color-dim', familyMeta.colorDim);

  document.getElementById('detail-badge').textContent       = familyMeta.badge;
  document.getElementById('detail-family-label').textContent = familyMeta.label;
  document.getElementById('detail-name').textContent         = seed.name;
  document.getElementById('detail-hook').textContent         = seed.hook;

  const tagsEl = document.getElementById('detail-tags');
  tagsEl.innerHTML = seed.tags.map(t => `<span class="pf-tag">${escHtml(t)}</span>`).join('');

  // Reset difficulty selector
  document.querySelectorAll('.pf-diff-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.diff === 'medium');
  });

  showScreen('detail');

  if (window.KapeworkAnalytics) {
    KapeworkAnalytics.track('puzzle_foundry_seed_opened', { seed_id: seed.id });
  }
}

// ── Play screen ────────────────────────────────────────────────────────────
function startPlay() {
  if (!selectedSeed) return;

  saveRecentSeed(selectedSeed);

  const puzzle = instantiatePuzzle(selectedSeed.twist, selectedDifficulty);
  if (!puzzle) {
    // Generation failed — show brief error and stay on detail screen
    const btn = document.getElementById('btn-play');
    const orig = btn.textContent;
    btn.textContent = 'Try again';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; startPlay(); }, 800);
    return;
  }

  currentPuzzle = puzzle;
  renderPlayScreen(puzzle);
  showScreen('play');

  if (window.KapeworkAnalytics) {
    KapeworkAnalytics.track('puzzle_foundry_play_started', {
      seed_id:    selectedSeed.id,
      family:     puzzle.family,
      twist:      puzzle.twistId,
      difficulty: selectedDifficulty,
    });
  }
}

function renderPlayScreen(puzzle) {
  // Set header
  document.getElementById('play-title').textContent       = selectedSeed.name;
  document.getElementById('play-family-line').textContent = selectedSeed.familyMeta.label + ' · ' + capFirst(selectedDifficulty);

  const board = document.getElementById('play-board');
  board.innerHTML = '';

  const renderers = {
    [FAMILIES.TARGET_FORGE]: renderTargetForge,
    [FAMILIES.ORDER_REPAIR]:  renderOrderRepair,
    [FAMILIES.PATH_TRACE]:    renderPathTrace,
  };

  const renderer = renderers[puzzle.family];
  if (!renderer) {
    board.textContent = 'Unknown family.';
    return;
  }

  renderer(board, puzzle, onPuzzleComplete);
}

function onPuzzleComplete({ solved, puzzle, ...extras }) {
  showResultScreen(solved, puzzle, extras);

  if (window.KapeworkAnalytics) {
    KapeworkAnalytics.track(solved ? 'puzzle_foundry_solved' : 'puzzle_foundry_failed', {
      seed_id: selectedSeed?.id,
      family:  puzzle.family,
      twist:   puzzle.twistId,
    });
  }
}

// ── Result screen ──────────────────────────────────────────────────────────
function showResultScreen(solved, puzzle, extras) {
  document.getElementById('result-icon').textContent  = solved ? '✓' : '✕';
  document.getElementById('result-title').textContent = solved ? 'Solved!' : 'Not quite';
  document.getElementById('result-sub').textContent   = solved
    ? getSuccessLine(puzzle, extras)
    : 'Give it another try.';

  // Style icon
  const icon = document.getElementById('result-icon');
  icon.style.color = solved ? 'var(--success)' : 'var(--danger)';

  showScreen('result');
}

function getSuccessLine(puzzle, extras) {
  if (puzzle.family === FAMILIES.ORDER_REPAIR && extras.moves !== undefined) {
    return `Sorted in ${extras.moves} move${extras.moves !== 1 ? 's' : ''}.`;
  }
  if (puzzle.family === FAMILIES.PATH_TRACE && extras.steps !== undefined) {
    return `Path traced in ${extras.steps} step${extras.steps !== 1 ? 's' : ''}.`;
  }
  return 'Well done.';
}

// ── Remix ──────────────────────────────────────────────────────────────────
function remixSeed() {
  if (!selectedSeed) return;

  if (window.KapeworkAnalytics) {
    KapeworkAnalytics.track('puzzle_foundry_remixed', { seed_id: selectedSeed.id });
  }

  // Re-instantiate a new puzzle from same seed + difficulty
  const puzzle = instantiatePuzzle(selectedSeed.twist, selectedDifficulty);
  if (!puzzle) { startPlay(); return; } // fallback: re-trigger full start
  currentPuzzle = puzzle;
  renderPlayScreen(puzzle);
  showScreen('play');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
