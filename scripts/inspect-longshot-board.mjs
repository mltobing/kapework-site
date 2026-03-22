#!/usr/bin/env node
/**
 * inspect-longshot-board.mjs — diagnostic tool for Longshot board/word validation
 *
 * Usage:
 *   node scripts/inspect-longshot-board.mjs                       # list all boards
 *   node scripts/inspect-longshot-board.mjs --board <id>          # show board grid
 *   node scripts/inspect-longshot-board.mjs --board <id> --word <word>
 *                                                                  # test a word
 *   node scripts/inspect-longshot-board.mjs --word <word>         # test on all boards
 *   node scripts/inspect-longshot-board.mjs --date <YYYY-MM-DD>   # which board for date
 *
 * Board <id> is the 1-based board ID from board-bank.json.
 *
 * The tool checks three independent conditions:
 *   1. Is the word in the common-word lexicon (common-words.txt)?
 *   2. Does the word appear in the board's precomputed allowed list?
 *   3. Can the word be traced via 8-way adjacency on this grid (live DFS)?
 *
 * Since runtime validation now uses (1) + live path-tracing by the player,
 * the key check for "will this word be accepted?" is: (1) only.
 * Conditions (2) and (3) are shown for diagnostics / board-bank quality checks.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..');
const BANK_FILE  = join(REPO_ROOT, 'apps/longshot/data/board-bank.json');
const WORDS_FILE = join(REPO_ROOT, 'apps/longshot/data/common-words.txt');

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadBank() {
  return JSON.parse(readFileSync(BANK_FILE, 'utf8'));
}

function loadLexicon() {
  const raw = readFileSync(WORDS_FILE, 'utf8');
  const set = new Set();
  for (const line of raw.split('\n')) {
    const w = line.trim().toLowerCase();
    if (w.length >= 5 && /^[a-z]+$/.test(w)) set.add(w);
  }
  return set;
}

function isAdjacent(a, b) {
  const rA = a >> 2, cA = a & 3;
  const rB = b >> 2, cB = b & 3;
  return Math.abs(rA - rB) <= 1 && Math.abs(cA - cB) <= 1 && a !== b;
}

function findPaths(grid, word) {
  // Returns all valid tile-index paths that spell <word>.
  const target = word.toLowerCase();
  const paths  = [];

  function dfs(pos, usedMask, path) {
    if (path.length === target.length) {
      paths.push(path.slice());
      return;
    }
    const needed = target[path.length];
    for (let next = 0; next < 16; next++) {
      if (usedMask & (1 << next)) continue;
      if (grid[next].toLowerCase() !== needed) continue;
      if (path.length > 0 && !isAdjacent(path[path.length - 1], next)) continue;
      path.push(next);
      dfs(next, usedMask | (1 << next), path);
      path.pop();
    }
  }

  // Start from every tile that matches the first letter
  for (let i = 0; i < 16; i++) {
    if (grid[i].toLowerCase() === target[0]) {
      dfs(i, 1 << i, [i]);
    }
  }

  return paths;
}

function boardDateKey(bank, dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return bank[Math.abs(hash) % bank.length];
}

function printGrid(grid) {
  console.log('\n  Grid (row-major):');
  for (let row = 0; row < 4; row++) {
    const cells = [];
    for (let col = 0; col < 4; col++) {
      const idx = row * 4 + col;
      cells.push(`[${grid[idx]}](${idx})`);
    }
    console.log('    ' + cells.join('  '));
  }
  console.log();
}

function pathLabel(grid, path) {
  return path.map(i => {
    const r = i >> 2, c = i & 3;
    return `${grid[i]}(r${r}c${c}=${i})`;
  }).join(' → ');
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdListBoards(bank) {
  console.log(`\nBoard bank: ${bank.length} boards\n`);
  console.log('  ID   Grid                 Featured         Words  MaxLen');
  console.log('  ─────────────────────────────────────────────────────────');
  for (const b of bank) {
    const grid  = b.grid.join('');
    const feat  = b.featured.padEnd(12);
    const words = String(b.allowed.length).padStart(5);
    console.log(`  ${String(b.id).padStart(2)}   ${grid}   ${feat}   ${words}   ${b.maxLen}`);
  }
  console.log();
}

function cmdShowBoard(bank, id) {
  const board = bank.find(b => b.id === id);
  if (!board) {
    console.error(`Board ID ${id} not found in bank (IDs: ${bank.map(b => b.id).join(', ')})`);
    process.exit(1);
  }
  console.log(`\nBoard #${board.id}`);
  printGrid(board.grid);
  console.log(`  Featured: ${board.featured.toUpperCase()}`);
  console.log(`  Top words: ${board.topWords.join(', ')}`);
  console.log(`  Medals: bronze≥${board.medals.bronze}, silver≥${board.medals.silver}, gold≥${board.medals.gold}`);
  console.log(`  Allowed words (${board.allowed.length}): ${board.allowed.slice(0, 20).join(', ')}${board.allowed.length > 20 ? ', …' : ''}`);
}

function cmdTestWord(bank, lexicon, word, boardId) {
  const target  = word.toLowerCase();
  const boards  = boardId ? bank.filter(b => b.id === boardId) : bank;

  if (boards.length === 0) {
    console.error(`No boards found${boardId ? ` for ID ${boardId}` : ''}`);
    process.exit(1);
  }

  const inLexicon = lexicon.has(target);
  console.log(`\nWord: "${target.toUpperCase()}" (${target.length} letters)`);
  console.log(`  In lexicon (common-words.txt): ${inLexicon ? '✓ YES' : '✗ NO — will be rejected'}`);
  if (target.length < 5) {
    console.log('  Too short — 5+ letters required');
  }
  console.log();

  for (const board of boards) {
    const inAllowed = board.allowed.includes(target);
    const paths     = findPaths(board.grid, target);
    const traceable = paths.length > 0;

    console.log(`  Board #${board.id} [${board.grid.join('')}]`);
    printGrid(board.grid);
    console.log(`    In board.allowed (precomputed): ${inAllowed ? '✓ YES' : '✗ NO'}`);
    console.log(`    Live DFS traceable: ${traceable ? `✓ YES (${paths.length} path${paths.length > 1 ? 's' : ''})` : '✗ NO'}`);

    if (traceable) {
      for (let i = 0; i < Math.min(paths.length, 3); i++) {
        console.log(`      Path ${i + 1}: ${pathLabel(board.grid, paths[i])}`);
      }
      if (paths.length > 3) console.log(`      … and ${paths.length - 3} more`);
    }

    if (inLexicon && traceable) {
      console.log(`    ✅ ACCEPTED — in lexicon AND traceable`);
    } else if (!inLexicon && traceable) {
      console.log(`    ⚠️  REJECTED — traceable but NOT in lexicon`);
      console.log(`       Fix: add "${target}" to common-words.txt and re-run build scripts`);
    } else if (inLexicon && !traceable) {
      console.log(`    ⚠️  REJECTED — in lexicon but NOT traceable on this board`);
    } else {
      console.log(`    ✗ REJECTED — not in lexicon AND not traceable`);
    }
    console.log();
  }
}

function cmdDateBoard(bank, dateStr) {
  const board = boardDateKey(bank, dateStr);
  console.log(`\nDate ${dateStr} → Board #${board.id}`);
  printGrid(board.grid);
  console.log(`  Featured: ${board.featured.toUpperCase()}`);
  console.log(`  Top words: ${board.topWords.join(', ')}`);
}

// ── CLI arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--board' && argv[i + 1]) { args.board = parseInt(argv[++i], 10); }
    else if (argv[i] === '--word'  && argv[i + 1]) { args.word  = argv[++i]; }
    else if (argv[i] === '--date'  && argv[i + 1]) { args.date  = argv[++i]; }
  }
  return args;
}

function main() {
  const bank    = loadBank();
  const lexicon = loadLexicon();
  const args    = parseArgs(process.argv.slice(2));

  if (args.date) {
    cmdDateBoard(bank, args.date);
    if (args.word) cmdTestWord(bank, lexicon, args.word, null);
    return;
  }

  if (args.word && args.board) {
    cmdTestWord(bank, lexicon, args.word, args.board);
    return;
  }

  if (args.word) {
    cmdTestWord(bank, lexicon, args.word, null);
    return;
  }

  if (args.board) {
    cmdShowBoard(bank, args.board);
    return;
  }

  cmdListBoards(bank);
  console.log('Usage:');
  console.log('  node scripts/inspect-longshot-board.mjs                        # list boards');
  console.log('  node scripts/inspect-longshot-board.mjs --board <id>           # show board');
  console.log('  node scripts/inspect-longshot-board.mjs --word <word>          # test on all');
  console.log('  node scripts/inspect-longshot-board.mjs --board <id> --word <w># test on one');
  console.log('  node scripts/inspect-longshot-board.mjs --date YYYY-MM-DD      # date lookup');
}

main();
