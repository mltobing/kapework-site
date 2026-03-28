/**
 * families/order-repair.js — Order Repair engine + play UI
 *
 * Core concept: restore a scrambled row to sorted order using only legal swaps.
 *
 * Generation strategy:
 *   Start from the solved (sorted) state, apply N random legal scramble moves,
 *   verify the result is not trivially solved, store scrambled state.
 *   This guarantees solvability by construction.
 *
 * Validation strategy:
 *   Each player swap is checked against the twist rule before applying.
 */

// ── Difficulty parameters ──────────────────────────────────────────────────
const DIFFICULTY = {
  easy:   { rowLen: 4, scrambleMoves: 4  },
  medium: { rowLen: 5, scrambleMoves: 7  },
  hard:   { rowLen: 6, scrambleMoves: 10 },
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isSorted(arr) {
  for (let i = 1; i < arr.length; i++) if (arr[i] < arr[i - 1]) return false;
  return true;
}

// ── Legal-swap predicates (one per twist) ──────────────────────────────────
function isLegal(twist, row, i, j) {
  // Normalise: i < j
  if (i > j) [i, j] = [j, i];
  const n = row.length;

  switch (twist.id) {
    case 'adjacent_only':
      return j === i + 1;

    case 'odd_sum':
      return j === i + 1 && (row[i] + row[j]) % 2 !== 0;

    case 'anchor': {
      // Swap is legal unless it involves the anchor position
      const anchor = twist._anchorPos;
      return i !== anchor && j !== anchor && j === i + 1;
    }

    case 'skip_two':
      return j === i + 2;

    case 'mirror':
      // Any adjacent swap is allowed; mirror is applied automatically
      return j === i + 1;

    default:
      return j === i + 1;
  }
}

/** Apply swap (and mirror effect if needed). Returns new row array. */
function applySwap(twist, row, i, j) {
  if (i > j) [i, j] = [j, i];
  const next = [...row];
  [next[i], next[j]] = [next[j], next[i]];

  if (twist.id === 'mirror') {
    const n = row.length;
    const mi = n - 1 - j;
    const mj = n - 1 - i;
    if (mi !== mj && mi >= 0 && mj < n && !(mi === i && mj === j)) {
      [next[mi], next[mj]] = [next[mj], next[mi]];
    }
  }

  return next;
}

// ── Generator ──────────────────────────────────────────────────────────────
export function generate(twist, difficultyKey) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = _tryGenerate(twist, difficultyKey);
    if (result !== null) return result;
  }
  return null;
}

function _tryGenerate(twist, difficultyKey) {
  const { rowLen, scrambleMoves } = DIFFICULTY[difficultyKey] || DIFFICULTY.medium;

  // Pick a random anchor position for anchor twist
  const anchorPos = randInt(1, rowLen - 2); // not first or last
  const enrichedTwist = { ...twist, _anchorPos: anchorPos };

  // Goal: sorted array [1, 2, 3, ..., n] with random values
  const base = Array.from({ length: rowLen }, (_, i) => i + 1);
  // Add some variety: shuffle the values so it's not always 1-N
  const values = base.map(v => v + randInt(0, 2));

  let row = [...values];
  const goal = [...values].sort((a, b) => a - b);

  // For anchor twist, the anchor position's value in goal must not move —
  // ensure the anchor position in 'goal' is already there in 'row'
  if (twist.id === 'anchor') {
    // Anchor position holds goal[anchorPos] and never moves
    row = [...goal];
  }

  // Pre-check: ensure at least one legal swap exists in the initial state
  const initialLegal = [];
  for (let i = 0; i < row.length - 1; i++) {
    for (let j = i + 1; j < row.length; j++) {
      if (isLegal(enrichedTwist, row, i, j)) initialLegal.push([i, j]);
    }
  }
  if (initialLegal.length === 0) return null; // impossible to make progress

  // Scramble by applying random legal swaps
  for (let m = 0; m < scrambleMoves * 3; m++) {
    const legalPairs = [];
    for (let i = 0; i < row.length - 1; i++) {
      for (let j = i + 1; j < row.length; j++) {
        if (isLegal(enrichedTwist, row, i, j)) {
          legalPairs.push([i, j]);
        }
      }
    }
    if (legalPairs.length === 0) break;
    const [pi, pj] = legalPairs[randInt(0, legalPairs.length - 1)];
    row = applySwap(enrichedTwist, row, pi, pj);
  }

  // If still sorted, force at least one swap
  if (isSorted(row)) {
    for (let i = 0; i < row.length - 1; i++) {
      for (let j = i + 1; j < row.length; j++) {
        if (isLegal(enrichedTwist, row, i, j)) {
          row = applySwap(enrichedTwist, row, i, j);
          break;
        }
      }
      if (!isSorted(row)) break;
    }
  }

  if (isSorted(row)) return null; // trivially solved, try again upstream

  return {
    family:    'order-repair',
    twistId:   twist.id,
    row:       row,
    goal:      goal,
    anchorPos: twist.id === 'anchor' ? anchorPos : null,
    twist:     enrichedTwist,
  };
}

// ── Play UI ────────────────────────────────────────────────────────────────
export function renderPlay(container, puzzle, onComplete) {
  const state = {
    row:      [...puzzle.row],
    selected: null,
    moves:    0,
  };

  function render() {
    container.innerHTML = '';

    // Goal row
    const goalSection = el('div', 'or-goal-section');
    const goalLabel = el('div', 'or-goal-label');
    goalLabel.textContent = 'Goal';
    goalSection.appendChild(goalLabel);
    const goalRow = el('div', 'or-row');
    puzzle.goal.forEach(v => {
      const t = el('div', 'or-tile goal-tile');
      t.textContent = v;
      goalRow.appendChild(t);
    });
    goalSection.appendChild(goalRow);
    container.appendChild(goalSection);

    // Instruction
    const instr = el('div', 'or-instruction');
    instr.textContent = getTwistInstruction(puzzle);
    container.appendChild(instr);

    // Live row
    const liveLabel = el('div', 'or-live-label');
    liveLabel.textContent = `Moves: ${state.moves}`;
    container.appendChild(liveLabel);

    const liveRow = el('div', 'or-row');
    state.row.forEach((v, idx) => {
      const t = el('button', 'or-tile live-tile');
      t.textContent = v;
      t.dataset.idx = idx;
      if (state.selected === idx) t.classList.add('selected');
      if (puzzle.twistId === 'anchor' && idx === puzzle.anchorPos) t.classList.add('anchored');
      // Highlight tiles that match goal position
      if (v === puzzle.goal[idx]) t.classList.add('correct');
      t.addEventListener('click', () => onTileTap(idx));
      liveRow.appendChild(t);
    });
    container.appendChild(liveRow);

    // Mirror indicator
    if (puzzle.twistId === 'mirror') {
      const note = el('div', 'or-mirror-note');
      note.textContent = 'Swaps are mirrored.';
      container.appendChild(note);
    }
  }

  function onTileTap(idx) {
    if (state.selected === null) {
      // Anchor can't be selected
      if (puzzle.twistId === 'anchor' && idx === puzzle.anchorPos) {
        showBrief(container, 'This tile is anchored and cannot move.');
        return;
      }
      state.selected = idx;
      render();
      return;
    }

    if (state.selected === idx) {
      state.selected = null;
      render();
      return;
    }

    const a = Math.min(state.selected, idx);
    const b = Math.max(state.selected, idx);

    if (!isLegal(puzzle.twist, state.row, a, b)) {
      const reason = getIllegalReason(puzzle.twistId, state.row, a, b);
      showBrief(container, reason);
      state.selected = null;
      render();
      return;
    }

    state.row = applySwap(puzzle.twist, state.row, a, b);
    state.selected = null;
    state.moves++;

    if (isSorted(state.row) && arraysEqual(state.row, puzzle.goal)) {
      render();
      setTimeout(() => onComplete({ solved: true, puzzle, moves: state.moves }), 300);
      return;
    }

    render();
  }

  render();
}

function getTwistInstruction(puzzle) {
  switch (puzzle.twistId) {
    case 'adjacent_only': return 'Tap two tiles to swap them — adjacent only.';
    case 'odd_sum':       return 'You may only swap neighbors whose sum is odd.';
    case 'anchor':        return 'Sort the row — the ★ tile is fixed.';
    case 'skip_two':      return 'You may only swap tiles exactly two apart.';
    case 'mirror':        return 'Each swap triggers its mirror automatically.';
    default:              return 'Tap two tiles to swap them.';
  }
}

function getIllegalReason(twistId, row, i, j) {
  switch (twistId) {
    case 'adjacent_only': return 'Only adjacent tiles can be swapped.';
    case 'odd_sum':       return `Sum ${row[i] + row[j]} is even — swap not allowed.`;
    case 'anchor':        return 'Anchored tile cannot move.';
    case 'skip_two':      return 'You may only swap tiles exactly 2 apart.';
    default:              return 'Swap not allowed.';
  }
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function showBrief(container, msg) {
  const existing = container.querySelector('.or-msg');
  if (existing) existing.remove();
  const msgEl = el('div', 'or-msg');
  msgEl.textContent = msg;
  container.appendChild(msgEl);
  setTimeout(() => msgEl.remove(), 2000);
}
