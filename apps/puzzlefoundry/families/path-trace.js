/**
 * families/path-trace.js — Path Trace engine + play UI
 *
 * Core concept: trace a valid path on a small grid to satisfy a goal under one twist.
 *
 * Cell types: 'empty' | 'wall' | 'start' | 'end' | 'key' | 'mark' | 'colored'
 * Colors: 0=none, 1=red, 2=blue, 3=green, 4=yellow
 *
 * Generation strategy:
 *   Place start and end, run a BFS/DFS to find a valid path that satisfies the
 *   twist, then add walls and obstacles around it. Guarantees solvability.
 */

// ── Difficulty parameters ──────────────────────────────────────────────────
const DIFFICULTY = {
  easy:   { rows: 4, cols: 4, wallDensity: 0.10 },
  medium: { rows: 5, cols: 5, wallDensity: 0.15 },
  hard:   { rows: 5, cols: 6, wallDensity: 0.20 },
};

const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]; // up, down, left, right

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function key(r, c) { return `${r},${c}`; }

function getNeighbors(r, c, rows, cols) {
  return DIRS.map(([dr, dc]) => [r + dr, c + dc])
             .filter(([nr, nc]) => nr >= 0 && nr < rows && nc >= 0 && nc < cols);
}

// ── BFS pathfinder ────────────────────────────────────────────────────────
/**
 * Finds a path from start to end on the grid (ignoring walls for generation).
 * Returns array of [r, c] positions or null.
 */
function bfsPath(grid, start, end, rows, cols) {
  const q = [[...start]];
  const prev = new Map([[key(...start), null]]);

  while (q.length) {
    const [r, c] = q.shift();
    if (r === end[0] && c === end[1]) {
      // Reconstruct path
      const path = [];
      let cur = key(r, c);
      while (cur !== null) {
        const [pr, pc] = cur.split(',').map(Number);
        path.unshift([pr, pc]);
        cur = prev.get(cur);
      }
      return path;
    }
    for (const [nr, nc] of getNeighbors(r, c, rows, cols)) {
      const k = key(nr, nc);
      if (!prev.has(k) && grid[nr][nc] !== 'wall') {
        prev.set(k, key(r, c));
        q.push([nr, nc]);
      }
    }
  }
  return null;
}

// ── Grid builder ──────────────────────────────────────────────────────────
function makeGrid(rows, cols, fillType = 'empty') {
  return Array.from({ length: rows }, () => Array(cols).fill(fillType));
}

function copyGrid(g) {
  return g.map(row => [...row]);
}

// ── Generator ──────────────────────────────────────────────────────────────
export function generate(twist, difficultyKey) {
  const { rows, cols, wallDensity } = DIFFICULTY[difficultyKey] || DIFFICULTY.medium;

  for (let attempt = 0; attempt < 40; attempt++) {
    const grid  = makeGrid(rows, cols, 'empty');
    const extra = {}; // extra puzzle data per twist

    // Place start and end on opposite sides
    const start = [randInt(0, rows - 1), 0];
    const end   = [randInt(0, rows - 1), cols - 1];
    grid[start[0]][start[1]] = 'start';
    grid[end[0]][end[1]]     = 'end';

    // Add walls (not on start/end)
    const totalCells = rows * cols - 2;
    const wallCount  = Math.floor(totalCells * wallDensity);
    let wallsPlaced  = 0;
    let wallAttempts = 0;
    while (wallsPlaced < wallCount && wallAttempts < 200) {
      wallAttempts++;
      const wr = randInt(0, rows - 1);
      const wc = randInt(0, cols - 1);
      if (grid[wr][wc] !== 'empty') continue;
      grid[wr][wc] = 'wall';
      // Check path still exists
      if (!bfsPath(grid, start, end, rows, cols)) {
        grid[wr][wc] = 'empty'; // revert
      } else {
        wallsPlaced++;
      }
    }

    // Twist-specific setup
    if (twist.id === 'exact_turns') {
      const path = bfsPath(grid, start, end, rows, cols);
      if (!path) continue;
      extra.exactSteps = path.length - 1; // steps = cells - 1
    }

    if (twist.id === 'visit_all') {
      const path = bfsPath(grid, start, end, rows, cols);
      if (!path || path.length < 3) continue;
      // Place 1–2 marks on the solution path (not start/end)
      const middle = path.slice(1, -1);
      const markCount = Math.min(2, middle.length);
      const shuffled = [...middle].sort(() => Math.random() - 0.5);
      const marks = shuffled.slice(0, markCount);
      marks.forEach(([r, c]) => { grid[r][c] = 'mark'; });
      extra.marks = marks;
    }

    if (twist.id === 'no_color_repeat') {
      const path = bfsPath(grid, start, end, rows, cols);
      if (!path || path.length < 4) continue;
      // Assign colors to non-start/end cells; solution path visits each color at most once
      const colors = [1, 2, 3, 4];
      const pathCells = path.slice(1, -1);
      // Color a subset of cells; ensure solution path doesn't repeat
      const colorMap = {}; // key → color
      let colorIdx = 0;
      pathCells.forEach(([r, c]) => {
        if (colorIdx < colors.length) {
          colorMap[key(r, c)] = colors[colorIdx++];
          grid[r][c] = 'colored';
        }
      });
      // Color some off-path cells too (distractors), potentially repeating colors
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid[r][c] === 'empty') {
            colorMap[key(r, c)] = colors[randInt(0, colors.length - 1)];
            grid[r][c] = 'colored';
          }
        }
      }
      extra.colorMap = colorMap;
    }

    if (twist.id === 'collect_key') {
      const path = bfsPath(grid, start, end, rows, cols);
      if (!path || path.length < 3) continue;
      // Place key somewhere on the solution path (not start/end)
      const middle = path.slice(1, -1);
      const [kr, kc] = middle[randInt(0, middle.length - 1)];
      grid[kr][kc] = 'key';
      extra.keyPos = [kr, kc];
    }

    return {
      family:     'path-trace',
      twistId:    twist.id,
      grid,
      rows,
      cols,
      start,
      end,
      extra,
    };
  }

  return null;
}

// ── Play UI ────────────────────────────────────────────────────────────────
export function renderPlay(container, puzzle, onComplete) {
  const { grid, rows, cols, start, end, extra, twistId } = puzzle;
  const baseGrid = grid.map(row => [...row]);

  const state = {
    path:        [start],         // array of [r, c]
    hasKey:      false,
    colorsVisited: new Set(),
  };

  function curPos() { return state.path[state.path.length - 1]; }

  function isAdjacent([r1, c1], [r2, c2]) {
    return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
  }

  function isInPath([r, c]) {
    return state.path.some(([pr, pc]) => pr === r && pc === c);
  }

  function render() {
    container.innerHTML = '';

    const instr = el('div', 'pt-instruction');
    instr.textContent = getTwistInstruction(puzzle, state);
    container.appendChild(instr);

    // Step counter / budget display
    if (twistId === 'exact_turns') {
      const steps = state.path.length - 1;
      const budget = extra.exactSteps;
      const info = el('div', 'pt-steps-info');
      info.textContent = `Steps: ${steps} / ${budget}`;
      info.classList.toggle('over-budget', steps > budget);
      container.appendChild(info);
    }

    // Grid
    const gridEl = el('div', 'pt-grid');
    gridEl.style.setProperty('--pt-cols', cols);
    gridEl.style.setProperty('--pt-rows', rows);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cellType = baseGrid[r][c];
        const cell = el('button', `pt-cell pt-cell--${cellType}`);
        const pathIdx = state.path.findIndex(([pr, pc]) => pr === r && pc === c);
        const inPathNow = pathIdx !== -1;
        const isCur = inPathNow && pathIdx === state.path.length - 1;

        if (inPathNow) cell.classList.add('in-path');
        if (isCur) cell.classList.add('current');

        // Color cells
        if (cellType === 'colored' && extra.colorMap) {
          const color = extra.colorMap[key(r, c)];
          if (color) cell.dataset.color = color;
        }

        // Cell content
        const content = getCellContent(cellType, [r, c], state, extra);
        if (content) cell.textContent = content;

        // Path number
        if (inPathNow && !isCur && cellType !== 'start') {
          cell.setAttribute('data-step', pathIdx);
        }

        cell.addEventListener('click', () => onCellTap([r, c]));
        gridEl.appendChild(cell);
      }
    }
    container.appendChild(gridEl);

    // Back/undo step
    if (state.path.length > 1) {
      const backBtn = el('button', 'pt-back-btn');
      backBtn.textContent = '↩ Back';
      backBtn.addEventListener('click', undoStep);
      container.appendChild(backBtn);
    }
  }

  function onCellTap([r, c]) {
    const cur = curPos();

    // Tapping current cell undoes last step
    if (cur[0] === r && cur[1] === c) {
      undoStep();
      return;
    }

    if (!isAdjacent(cur, [r, c])) return;

    const cellType = baseGrid[r][c];
    if (cellType === 'wall') return;
    if (isInPath([r, c]) && !(r === start[0] && c === start[1])) {
      // Can't revisit except start (won't happen in normal flow)
      return;
    }

    // Twist-specific blocking
    if (twistId === 'no_color_repeat' && cellType === 'colored' && extra.colorMap) {
      const color = extra.colorMap[key(r, c)];
      if (state.colorsVisited.has(color)) {
        showBrief(container, `Color ${colorName(color)} already visited!`);
        return;
      }
    }

    // Apply step
    if (twistId === 'collect_key' && cellType === 'key') {
      state.hasKey = true;
    }
    if (twistId === 'no_color_repeat' && cellType === 'colored' && extra.colorMap) {
      const color = extra.colorMap[key(r, c)];
      if (color) state.colorsVisited.add(color);
    }

    state.path.push([r, c]);

    // Check win
    if (r === end[0] && c === end[1]) {
      if (checkWin(state, puzzle)) {
        render();
        setTimeout(() => onComplete({ solved: true, puzzle, steps: state.path.length - 1 }), 300);
        return;
      } else {
        const reason = getFailReason(state, puzzle);
        showBrief(container, reason);
        state.path.pop();
      }
    }

    render();
  }

  function undoStep() {
    if (state.path.length <= 1) return;
    const removed = state.path.pop();
    const removedType = baseGrid[removed[0]][removed[1]];

    // Undo key pickup
    if (twistId === 'collect_key' && removedType === 'key') {
      state.hasKey = false;
    }
    // Undo color visit (rebuild from current path)
    if (twistId === 'no_color_repeat') {
      state.colorsVisited = new Set();
      state.path.forEach(([pr, pc]) => {
        if (extra.colorMap) {
          const color = extra.colorMap[key(pr, pc)];
          if (color) state.colorsVisited.add(color);
        }
      });
    }

    render();
  }

  render();
}

function checkWin(state, puzzle) {
  const { twistId, extra, grid, rows, cols } = puzzle;

  switch (twistId) {
    case 'exact_turns':
      return state.path.length - 1 === extra.exactSteps;

    case 'visit_all':
      return extra.marks.every(([mr, mc]) =>
        state.path.some(([pr, pc]) => pr === mr && pc === mc));

    case 'no_color_repeat':
      return true; // blocking happens on entry; reaching end means success

    case 'collect_key':
      return state.hasKey;

    default:
      return true;
  }
}

function getFailReason(state, puzzle) {
  switch (puzzle.twistId) {
    case 'exact_turns':
      return `Need exactly ${puzzle.extra.exactSteps} steps — you used ${state.path.length - 1}.`;
    case 'visit_all':
      return 'You missed some marked cells.';
    case 'collect_key':
      return 'You need the key first!';
    default:
      return 'Not quite — try again.';
  }
}

function getTwistInstruction(puzzle, state) {
  switch (puzzle.twistId) {
    case 'exact_turns':
      return `Reach the exit in exactly ${puzzle.extra.exactSteps} steps.`;
    case 'visit_all':
      return 'Visit all marked cells (◆) before reaching the exit.';
    case 'no_color_repeat':
      return 'Reach the exit without stepping on the same color twice.';
    case 'collect_key':
      return state.hasKey ? 'Key collected! Now reach the exit.' : 'Collect the key (✦), then reach the exit.';
    default:
      return 'Trace a path from start to exit.';
  }
}

function getCellContent(type, pos, state, extra) {
  switch (type) {
    case 'start': return 'S';
    case 'end':   return 'E';
    case 'key':   return state.hasKey ? '' : '✦';
    case 'mark':  return '◆';
    case 'wall':  return '';
    default:      return '';
  }
}

const COLOR_NAMES = { 1: 'red', 2: 'blue', 3: 'green', 4: 'yellow' };
function colorName(c) { return COLOR_NAMES[c] || 'that color'; }

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function showBrief(container, msg) {
  const existing = container.querySelector('.pt-msg');
  if (existing) existing.remove();
  const msgEl = el('div', 'pt-msg');
  msgEl.textContent = msg;
  container.appendChild(msgEl);
  setTimeout(() => msgEl.remove(), 2500);
}
