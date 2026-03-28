/**
 * families/target-forge.js — Target Forge engine + play UI
 *
 * Core concept: combine numbers/tiles to hit an exact target under one twist.
 *
 * Generation strategy:
 *   Build a random expression from N numbers, evaluate it to get the target.
 *   This guarantees solvability without needing a full search solver.
 *
 * Validation strategy:
 *   Player works step-by-step (pick 2 tiles + operator → sub-result).
 *   We track their moves and enforce twist constraints live.
 */

// ── Difficulty parameters ──────────────────────────────────────────────────
const DIFFICULTY = {
  easy:   { numCount: 3, numRange: [1, 9]  },
  medium: { numCount: 4, numRange: [1, 12] },
  hard:   { numCount: 5, numRange: [1, 15] },
};

// ── Operator helpers ───────────────────────────────────────────────────────
const ALL_OPS = ['+', '-', '*', '/'];

function applyOp(a, op, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b !== 0 && a % b === 0 ? a / b : null; // integers only
    default:  return null;
  }
}

function opLabel(op) {
  return op === '*' ? '×' : op === '/' ? '÷' : op;
}

/**
 * Build a random expression from nums using ops, return positive integer result or null.
 * Uses +/- by default (genOps) to guarantee integer intermediates.
 * Ops are sampled with replacement — no "each op once" limit here.
 * (The one_each constraint is enforced on the player side by the UI.)
 */
function evalRandomExpression(nums, ops) {
  let tiles = [...nums];

  while (tiles.length > 1) {
    const i = randInt(0, tiles.length - 1);
    let j;
    do { j = randInt(0, tiles.length - 1); } while (j === i);

    // Try ops in random order; pick first that gives a valid, bounded result
    const shuffled = [...ops].sort(() => Math.random() - 0.5);
    let result = null;
    for (const op of shuffled) {
      const r = applyOp(tiles[i], op, tiles[j]);
      if (r === null || !Number.isInteger(r)) continue;
      if (r < -100 || r > 200) continue; // keep intermediate values bounded
      result = r;
      break;
    }
    if (result === null) return null;

    const newVal = result;
    tiles = tiles.filter((_, k) => k !== i && k !== j);
    tiles.push(newVal);
  }
  return tiles[0];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Generator ──────────────────────────────────────────────────────────────
/**
 * generate(twist, difficultyKey) → puzzle object or null
 *
 * Returns: { family, twistId, numbers, target, anchorIdx, checkpoint, allowedOps }
 */
export function generate(twist, difficultyKey) {
  const { numCount, numRange } = DIFFICULTY[difficultyKey] || DIFFICULTY.medium;
  const bannedOps = twist.bannedOps || [];
  const allowedOps = ALL_OPS.filter(op => !bannedOps.includes(op));

  for (let attempt = 0; attempt < 150; attempt++) {
    const numbers = Array.from(
      { length: numCount },
      () => randInt(numRange[0], numRange[1])
    );

    // Generation always uses +/- so we're guaranteed integer results.
    // The player's allowedOps set is typically a superset, giving them multiple paths.
    const genOps = ['+', '-'];

    if (twist.id === 'stepstone') {
      const partial    = numbers.slice(0, Math.ceil(numbers.length / 2));
      const rest       = numbers.slice(Math.ceil(numbers.length / 2));
      const checkpoint = evalRandomExpression(partial, genOps);
      if (checkpoint === null || checkpoint <= 0 || checkpoint > 50) continue;
      const combined   = [...rest, checkpoint];
      const target     = evalRandomExpression(combined, genOps);
      if (target === null || target <= 0 || target > 100) continue;
      return { family: 'target-forge', twistId: twist.id, numbers, target, checkpoint, allowedOps };
    }

    if (twist.id === 'last_tile') {
      const anchorIdx = randInt(0, numbers.length - 1);
      const others    = numbers.filter((_, i) => i !== anchorIdx);
      const partial   = evalRandomExpression(others, genOps);
      if (partial === null) continue;
      // Combine anchor using a safe op
      const op     = genOps[randInt(0, genOps.length - 1)];
      const target = applyOp(partial, op, numbers[anchorIdx]);
      if (target === null || !Number.isInteger(target) || target <= 0 || target > 100) continue;
      return { family: 'target-forge', twistId: twist.id, numbers, target, anchorIdx, allowedOps };
    }

    // Default (lockout, one_each, div_ban, etc.)
    const target = evalRandomExpression(numbers, genOps);
    if (target === null || !Number.isInteger(target) || target <= 0 || target > 100) continue;
    return { family: 'target-forge', twistId: twist.id, numbers, target, allowedOps };
  }

  return null; // generation failed
}

// ── Play UI ────────────────────────────────────────────────────────────────
/**
 * renderPlay(container, puzzle, onComplete)
 *
 * Renders the interactive Target Forge board into container.
 * Calls onComplete({ solved: bool, puzzle }) when done.
 */
export function renderPlay(container, puzzle, onComplete) {
  // State
  const state = {
    tiles:         puzzle.numbers.map((v, i) => ({ id: i, val: v, original: v })),
    selected:      null,   // index into state.tiles
    pendingOp:     null,
    opsUsed:       new Set(),
    history:       [],
    checkpointHit: false,
  };

  function render() {
    container.innerHTML = '';

    // Target display
    const targetRow = el('div', 'tf-target-row');
    if (puzzle.twistId === 'stepstone') {
      const checkEl = el('div', 'tf-checkpoint');
      checkEl.textContent = state.checkpointHit
        ? `✓ Checkpoint ${puzzle.checkpoint} reached`
        : `Checkpoint: ${puzzle.checkpoint}`;
      checkEl.classList.toggle('hit', state.checkpointHit);
      targetRow.appendChild(checkEl);
    }
    const targetEl = el('div', 'tf-target');
    targetEl.innerHTML = `Target <span class="tf-target-num">${puzzle.target}</span>`;
    targetRow.appendChild(targetEl);
    container.appendChild(targetRow);

    // Instruction
    const instr = el('div', 'tf-instruction');
    instr.textContent = getTwistInstruction(puzzle);
    container.appendChild(instr);

    // Tiles
    const tilesEl = el('div', 'tf-tiles');
    state.tiles.forEach((tile, idx) => {
      const t = el('button', 'tf-tile');
      t.textContent = tile.val;
      t.dataset.idx = idx;
      if (state.selected === idx) t.classList.add('selected');
      if (puzzle.twistId === 'last_tile' && tile.id === puzzle.anchorIdx && state.tiles.length > 1) {
        t.classList.add('anchor');
      }
      t.addEventListener('click', () => onTileTap(idx));
      tilesEl.appendChild(t);
    });
    container.appendChild(tilesEl);

    // Operator buttons
    const opsEl = el('div', 'tf-ops');
    puzzle.allowedOps.forEach(op => {
      const btn = el('button', 'tf-op');
      btn.textContent = opLabel(op);
      btn.dataset.op = op;
      if (state.pendingOp === op) btn.classList.add('selected');
      // For one_each: grey out already-used ops
      if (puzzle.twistId === 'one_each' && state.opsUsed.has(op)) {
        btn.classList.add('used');
        btn.disabled = true;
      }
      btn.addEventListener('click', () => onOpTap(op));
      opsEl.appendChild(btn);
    });
    container.appendChild(opsEl);

    // Undo / status
    const ctrlRow = el('div', 'tf-ctrl-row');
    if (state.history.length > 0) {
      const undoBtn = el('button', 'tf-ctrl-btn');
      undoBtn.textContent = '↩ Undo';
      undoBtn.addEventListener('click', doUndo);
      ctrlRow.appendChild(undoBtn);
    }
    container.appendChild(ctrlRow);
  }

  function onTileTap(idx) {
    if (state.selected === null) {
      // First tile selected
      state.selected = idx;
      state.pendingOp = null;
      render();
      return;
    }

    if (state.selected === idx) {
      // Deselect
      state.selected = null;
      state.pendingOp = null;
      render();
      return;
    }

    if (state.pendingOp === null) {
      // Change first selection
      state.selected = idx;
      render();
      return;
    }

    // Both tiles + op ready → compute
    const a = state.tiles[state.selected];
    const b = state.tiles[idx];
    const op = state.pendingOp;

    // last_tile enforcement: if only 2 tiles left, anchor must be the second
    if (puzzle.twistId === 'last_tile' && state.tiles.length === 2) {
      const anchorTile = state.tiles.find(t => t.id === puzzle.anchorIdx);
      if (anchorTile && b.id !== puzzle.anchorIdx) {
        showBrief(container, 'The marked tile must be last!');
        return;
      }
    }

    const result = applyOp(a.val, op, b.val);
    if (result === null) {
      showBrief(container, 'Division must be exact (whole numbers only)');
      return;
    }

    // Save history for undo
    state.history.push({
      tiles:         state.tiles.map(t => ({ ...t })),
      opsUsed:       new Set(state.opsUsed),
      checkpointHit: state.checkpointHit,
    });

    // Apply move
    state.opsUsed.add(op);
    const newTile = { id: a.id, val: result };
    state.tiles = state.tiles.filter((_, k) => k !== state.selected && k !== idx);
    state.tiles.push(newTile);
    state.selected = null;
    state.pendingOp = null;

    // Stepstone checkpoint check
    if (puzzle.twistId === 'stepstone' && result === puzzle.checkpoint) {
      state.checkpointHit = true;
    }

    // Win/fail check
    if (state.tiles.length === 1) {
      checkResult();
      return;
    }

    render();
  }

  function onOpTap(op) {
    if (state.selected === null) return;
    state.pendingOp = state.pendingOp === op ? null : op;
    render();
  }

  function doUndo() {
    if (state.history.length === 0) return;
    const prev = state.history.pop();
    state.tiles         = prev.tiles;
    state.opsUsed       = prev.opsUsed;
    state.checkpointHit = prev.checkpointHit;
    state.selected      = null;
    state.pendingOp     = null;
    render();
  }

  function checkResult() {
    const val = state.tiles[0].val;
    let solved = val === puzzle.target;
    // Stepstone requires checkpoint to have been hit
    if (puzzle.twistId === 'stepstone' && !state.checkpointHit) solved = false;
    onComplete({ solved, puzzle });
  }

  render();
}

function getTwistInstruction(puzzle) {
  switch (puzzle.twistId) {
    case 'lockout':    return 'Combine tiles to hit the target — multiplication is banned.';
    case 'one_each':   return 'Use each operator (+  −  ×  ÷) at most once.';
    case 'last_tile':  return 'The marked tile ★ must be used in your final step.';
    case 'stepstone':  return 'Hit the checkpoint first, then reach the target.';
    case 'div_ban':    return 'Combine tiles to hit the target — division is banned.';
    default:           return 'Combine tiles to hit the target.';
  }
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function showBrief(container, msg) {
  const existing = container.querySelector('.tf-msg');
  if (existing) existing.remove();
  const msgEl = el('div', 'tf-msg');
  msgEl.textContent = msg;
  container.appendChild(msgEl);
  setTimeout(() => msgEl.remove(), 2000);
}
