/**
 * ui.js — Puzzle Foundry screen manager
 *
 * Manages transitions between the 4 screens:
 *   pack → detail → play → result
 */

import { generatePack, instantiatePuzzle } from './generator.js';
import { saveLastPack, loadLastPack, saveRecentSeed } from './storage.js';
import { renderPlay as renderTargetForge }  from './families/target-forge.js';
import { renderPlay as renderOrderRepair }  from './families/order-repair.js';
import { renderPlay as renderPathTrace }    from './families/path-trace.js';
import { FAMILIES }                         from './seeds.js';

// ── State ──────────────────────────────────────────────────────────────────
let currentPack        = [];
let selectedSeed       = null;
let selectedDifficulty = 'medium';
let currentPuzzle      = null;  // stored so Reset can re-render the same puzzle

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

  // Reset re-renders the current puzzle from scratch (same numbers/layout, fresh state)
  document.getElementById('btn-reset-play').addEventListener('click', () => {
    if (currentPuzzle) renderPlayScreen(currentPuzzle);
  });

  document.getElementById('btn-play').addEventListener('click', startPlay);

  // Difficulty buttons
  document.querySelectorAll('.pf-diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDifficulty = btn.dataset.diff;
      document.querySelectorAll('.pf-diff-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Result actions
  document.getElementById('btn-try-again').addEventListener('click', () => {
    // Replay the exact same puzzle instance
    if (currentPuzzle) renderPlayScreen(currentPuzzle);
    showScreen('play');
  });
  document.getElementById('btn-remix').addEventListener('click', remixSeed);
  document.getElementById('btn-try-another').addEventListener('click', () => showScreen('pack'));
  document.getElementById('btn-result-refresh').addEventListener('click', () => {
    refreshPack();
  });

  // Restore last pack from localStorage, or generate a fresh one
  const saved = loadLastPack();
  if (saved && saved.length === 8) {
    currentPack = saved;
    renderPackScreen();
  } else {
    refreshPack();
  }
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

  currentPack.forEach((seed, i) => {
    const card = buildSeedCard(seed);
    // Stagger entrance
    card.style.animationDelay = `${i * 40}ms`;
    card.classList.add('pf-card-enter');
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
      <div class="pf-family-label">${escHtml(familyMeta.label)}</div>
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

  document.getElementById('detail-badge').textContent        = familyMeta.badge;
  document.getElementById('detail-family-label').textContent = familyMeta.label;
  document.getElementById('detail-name').textContent         = seed.name;
  document.getElementById('detail-hook').textContent         = seed.hook;

  const tagsEl = document.getElementById('detail-tags');
  tagsEl.innerHTML = seed.tags.map(t => `<span class="pf-tag">${escHtml(t)}</span>`).join('');

  // Reset difficulty selector to medium
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
    // Generation failed (rare) — pulse the button and retry once
    const btn = document.getElementById('btn-play');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    setTimeout(() => {
      btn.textContent = 'Play';
      btn.disabled = false;
      startPlay();
    }, 600);
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
  document.getElementById('play-title').textContent       = selectedSeed.name;
  document.getElementById('play-family-line').textContent =
    selectedSeed.familyMeta.label + ' · ' + capFirst(selectedDifficulty);

  const board = document.getElementById('play-board');
  board.innerHTML = '';

  const renderers = {
    [FAMILIES.TARGET_FORGE]: renderTargetForge,
    [FAMILIES.ORDER_REPAIR]:  renderOrderRepair,
    [FAMILIES.PATH_TRACE]:    renderPathTrace,
  };

  const renderer = renderers[puzzle.family];
  if (renderer) {
    renderer(board, puzzle, onPuzzleComplete);
  }
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
  const box  = document.getElementById('result-box');
  const icon = document.getElementById('result-icon');

  icon.textContent = solved ? '✓' : '✕';
  icon.className   = solved ? 'pf-result-icon pf-result-icon--solved' : 'pf-result-icon pf-result-icon--failed';

  document.getElementById('result-title').textContent = solved ? 'Solved!' : 'Not quite';
  document.getElementById('result-sub').textContent   = solved
    ? getSuccessLine(puzzle, extras)
    : 'Give it another try, or try a different seed.';

  // Box styling
  box.className = solved ? 'pf-result-box pf-result-box--solved' : 'pf-result-box pf-result-box--failed';

  // Button visibility: on fail show "Try again" as primary; on success show "Remix"
  document.getElementById('btn-try-again').hidden = solved;
  document.getElementById('btn-remix').hidden     = !solved;

  showScreen('result');
}

function getSuccessLine(puzzle, extras) {
  switch (puzzle.family) {
    case FAMILIES.TARGET_FORGE:
      return `Target ${puzzle.target} reached!`;
    case FAMILIES.ORDER_REPAIR:
      return extras.moves !== undefined
        ? `Sorted in ${extras.moves} move${extras.moves !== 1 ? 's' : ''}.`
        : 'Row sorted!';
    case FAMILIES.PATH_TRACE:
      return extras.steps !== undefined
        ? `Path traced in ${extras.steps} step${extras.steps !== 1 ? 's' : ''}.`
        : 'Path complete!';
    default:
      return 'Well done.';
  }
}

// ── Remix ──────────────────────────────────────────────────────────────────
function remixSeed() {
  if (!selectedSeed) return;

  if (window.KapeworkAnalytics) {
    KapeworkAnalytics.track('puzzle_foundry_remixed', { seed_id: selectedSeed.id });
  }

  const puzzle = instantiatePuzzle(selectedSeed.twist, selectedDifficulty);
  if (!puzzle) { startPlay(); return; }
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
