#!/usr/bin/env node
/**
 * build-longshot-board-bank.mjs
 *
 * Generates (or regenerates) apps/longshot/data/board-bank.json.
 *
 * Usage:
 *   node scripts/build-longshot-board-bank.mjs
 *
 * How it works:
 *   1. Loads common-words.txt (one word per line, 5+ letters).
 *   2. Iterates over the curated SEED_GRIDS list below.
 *   3. For each 4×4 grid, runs DFS path-finding to find all valid traceable
 *      words using 8-direction adjacency, no tile reuse.
 *   4. Picks the featured Longshot word (longest), derives medal thresholds,
 *      assembles the full board entry.
 *   5. Writes board-bank.json — the single source of truth for runtime
 *      validation. The game never re-derives allowed words at runtime.
 *
 * To add more boards: append 16-char strings to SEED_GRIDS and re-run.
 * Board grids are row-major: positions 0-3 = row 0, 4-7 = row 1, etc.
 * Adjacency: 8-direction, tiles may not be reused within one word.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..');
const WORDS_FILE = join(REPO_ROOT, 'apps/longshot/data/common-words.txt');
const OUT_FILE   = join(REPO_ROOT, 'apps/longshot/data/board-bank.json');

// ── Load dictionary ──────────────────────────────────────────────────────────
function loadWords() {
  const raw = readFileSync(WORDS_FILE, 'utf8');
  const set = new Set();
  for (const line of raw.split('\n')) {
    const w = line.trim().toLowerCase();
    if (w.length >= 5 && /^[a-z]+$/.test(w)) set.add(w);
  }
  return set;
}

// ── Path-finding: find all valid traceable words on a 4×4 grid ───────────────
function findAllWords(grid16, wordSet) {
  // Prefix set for early DFS termination
  const prefixSet = new Set();
  for (const w of wordSet) {
    for (let i = 1; i <= w.length; i++) prefixSet.add(w.slice(0, i));
  }

  const found = new Set();

  function dfs(idx, usedMask, current) {
    const next = current + grid16[idx].toLowerCase();
    if (!prefixSet.has(next)) return;
    const newMask = usedMask | (1 << idx);
    if (next.length >= 5 && wordSet.has(next)) found.add(next);
    const row = Math.floor(idx / 4);
    const col = idx % 4;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr, nc = col + dc;
        if (nr < 0 || nr > 3 || nc < 0 || nc > 3) continue;
        const ni = nr * 4 + nc;
        if (newMask & (1 << ni)) continue;
        dfs(ni, newMask, next);
      }
    }
  }

  for (let i = 0; i < 16; i++) dfs(i, 0, '');
  return [...found];
}

// ── Analyse word list → pick featured word + derive medal thresholds ──────────
function analyseWords(words) {
  const sorted = [...words].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const featured = sorted[0] || '';
  const topWords  = sorted.slice(0, 10);
  const maxLen    = featured.length;
  // Bronze = best ≥5, Silver = best ≥6, Gold = best ≥7
  return { featured, topWords, maxLen, medals: { bronze: 5, silver: 6, gold: 7 } };
}

// ── Curated seed grids ────────────────────────────────────────────────────────
// Each string is exactly 16 chars, row-major (ABCD EFGH IJKL MNOP).
// Featured long words and their verified adjacency paths are noted below.
//
// Adjacency rule: position idx = (row, col) where row = idx>>2, col = idx&3.
// Two positions are adjacent iff |Δrow|≤1 AND |Δcol|≤1 (8-direction).
const SEED_GRIDS = [
  // ── STRANGLE (8) ──────────────────────────────────────────────────────────
  // Row0:S T R I  Row1:P O U A  Row2:D C H N  Row3:E L G W
  // STRANGLE: S(0,0)→T(0,1)→R(0,2)→A(1,3)→N(2,3)→G(3,2)→L(3,1)→E(3,0)
  //   R(0,2)→A(1,3): Δrow=1,Δcol=1 ✓  A(1,3)→N(2,3): Δrow=1,Δcol=0 ✓
  //   N(2,3)→G(3,2): Δrow=1,Δcol=1 ✓  G(3,2)→L(3,1): Δcol=1 ✓  L→E ✓
  'STRIPOUADCHNELGW',

  // ── REACHING (8) + TEACHING (8) ───────────────────────────────────────────
  // Row0:R E A C  Row1:S T L H  Row2:B O I N  Row3:F D G W
  // REACHING: R(0,0)→E(0,1)→A(0,2)→C(0,3)→H(1,3)→I(2,2)→N(2,3)→G(3,2) ✓
  // TEACHING: T(1,1)→E(0,1)→A(0,2)→C(0,3)→H(1,3)→I(2,2)→N(2,3)→G(3,2) ✓
  'REACSTLHBOINFDGW',

  // ── STRANGLE (8) alternate layout ─────────────────────────────────────────
  // Row0:S T R A  Row1:E L G N  Row2:P O U D  Row3:C H I F
  // STRANGLE: S(0,0)→T(0,1)→R(0,2)→A(0,3)→N(1,3)→G(1,2)→L(1,1)→E(1,0) ✓
  'STRAELGNPOUDCHIF',

  // ── READING (7) ───────────────────────────────────────────────────────────
  // Row0:R E A D  Row1:S T I N  Row2:L O C G  Row3:P H F W
  // READING: R(0,0)→E(0,1)→A(0,2)→D(0,3)→I(1,2)→N(1,3)→G(2,3) ✓
  //   D(0,3)→I(1,2): Δrow=1,Δcol=1 ✓  I(1,2)→N(1,3): Δcol=1 ✓  N(1,3)→G(2,3): Δrow=1 ✓
  'READSTINLOCGPHFW',

  // ── HEARING (7) ───────────────────────────────────────────────────────────
  // Row0:H E A R  Row1:S T I N  Row2:L O C G  Row3:P D F W
  // HEARING: H(0,0)→E(0,1)→A(0,2)→R(0,3)→I(1,2)→N(1,3)→G(2,3) ✓
  //   R(0,3)→I(1,2): Δrow=1,Δcol=1 ✓
  'HEARSTINLOCGPDFW',

  // ── SHARING (7) ───────────────────────────────────────────────────────────
  // Row0:S H A R  Row1:E T I N  Row2:L O C G  Row3:P D F W
  // SHARING: S(0,0)→H(0,1)→A(0,2)→R(0,3)→I(1,2)→N(1,3)→G(2,3) ✓
  'SHARETINLOCGPDFW',

  // ── TRADING (7) ───────────────────────────────────────────────────────────
  // Row0:T R A D  Row1:S E I N  Row2:L O G C  Row3:P H F W
  // TRADING: T(0,0)→R(0,1)→A(0,2)→D(0,3)→I(1,2)→N(1,3)→G(2,2) ✓
  //   N(1,3)→G(2,2): Δrow=1,Δcol=1 ✓
  'TRADSEINLOGCPHFW',

  // ── LEADING (7) ───────────────────────────────────────────────────────────
  // Row0:L E A D  Row1:S T I N  Row2:O R C G  Row3:P H F W
  // LEADING: L(0,0)→E(0,1)→A(0,2)→D(0,3)→I(1,2)→N(1,3)→G(2,3) ✓
  'LEADSTINORCGPHFW',

  // ── WEARING (7) ───────────────────────────────────────────────────────────
  // Row0:W E A R  Row1:S T I N  Row2:L O C G  Row3:P D H F
  // WEARING: W(0,0)→E(0,1)→A(0,2)→R(0,3)→I(1,2)→N(1,3)→G(2,3) ✓
  'WEARSTINLOCGPDHF',

  // ── STRANGE (7) ───────────────────────────────────────────────────────────
  // Row0:S T R A  Row1:L O G N  Row2:P U E D  Row3:C H I F
  // STRANGE: S(0,0)→T(0,1)→R(0,2)→A(0,3)→N(1,3)→G(1,2)→E(2,2) ✓
  //   A(0,3)→N(1,3): Δrow=1 ✓  N(1,3)→G(1,2): Δcol=1 ✓  G(1,2)→E(2,2): Δrow=1 ✓
  'STRALOGNPUEDCHIF',

  // ── HOLDING (7) ───────────────────────────────────────────────────────────
  // Row0:H O L D  Row1:A R I N  Row2:S T G E  Row3:P C F W
  // HOLDING: H(0,0)→O(0,1)→L(0,2)→D(0,3)→I(1,2)→N(1,3)→G(2,2) ✓
  //   D(0,3)→I(1,2): Δrow=1,Δcol=1 ✓  N(1,3)→G(2,2): Δrow=1,Δcol=1 ✓
  'HOLDARINSTGEPCFW',

  // ── SECTION (7) ───────────────────────────────────────────────────────────
  // Row0:S E C T  Row1:A R O I  Row2:L D N H  Row3:P F G W
  // SECTION: S(0,0)→E(0,1)→C(0,2)→T(0,3)→I(1,3)→O(1,2)→N(2,2) ✓
  //   T(0,3)→I(1,3): Δrow=1 ✓  I(1,3)→O(1,2): Δcol=1 ✓  O(1,2)→N(2,2): Δrow=1 ✓
  'SECTAROILDNHPFGW',

  // ── HEADING (7) ───────────────────────────────────────────────────────────
  // Row0:H E A D  Row1:S T I N  Row2:L O C G  Row3:P R F W
  // HEADING: H(0,0)→E(0,1)→A(0,2)→D(0,3)→I(1,2)→N(1,3)→G(2,3) ✓
  'HEADSTINLOCGPRFW',

  // ── SEATING (7) ───────────────────────────────────────────────────────────
  // Row0:S E A T  Row1:R L O I  Row2:P D G N  Row3:C H F W
  // SEATING: S(0,0)→E(0,1)→A(0,2)→T(0,3)→I(1,3)→N(2,3)→G(2,2) ✓
  //   T(0,3)→I(1,3): Δrow=1 ✓  I(1,3)→N(2,3): Δrow=1 ✓  N(2,3)→G(2,2): Δcol=1 ✓
  'SEATLROIDPGNCHFW',
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Loading dictionary…');
  const wordSet = loadWords();
  console.log(`  ${wordSet.size} words loaded (5+ letters)`);

  const bank = [];

  for (let i = 0; i < SEED_GRIDS.length; i++) {
    const gridStr = SEED_GRIDS[i].toUpperCase().replace(/\s/g, '');
    if (gridStr.length !== 16) {
      console.warn(`  Board ${i + 1}: wrong length (${gridStr.length}) — skipping`);
      continue;
    }

    const grid  = gridStr.split('');
    process.stdout.write(`  Board ${i + 1} [${gridStr}] … `);

    const words = findAllWords(grid, wordSet);
    const info  = analyseWords(words);

    if (words.length === 0) {
      console.log('NO VALID WORDS — skipped');
      continue;
    }

    bank.push({
      id:       i + 1,
      grid:     grid,
      allowed:  words.sort(),
      featured: info.featured,
      topWords: info.topWords,
      medals:   info.medals,
      maxLen:   info.maxLen,
    });

    console.log(`${words.length} words, best="${info.featured}" (${info.maxLen})`);
  }

  console.log(`\nWriting ${bank.length} boards → ${OUT_FILE}`);
  writeFileSync(OUT_FILE, JSON.stringify(bank, null, 2), 'utf8');
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
