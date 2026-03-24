# Proof Grid 6×6

**Public title:** Proof Grid 6×6
**Route:** `proofgrid36.kapework.com` → `/apps/proofgrid36/`
**Difficulty:** Expert (hard mode expansion of the 4×4 daily)

---

## What it is

Proof Grid 6×6 is the expert mode expansion of Proof Grid. The grid grows to 6×6, and a third shape (triangle) is added:

| Symbol | Code | Shape | Fill |
|--------|------|-------|------|
| Hollow Circle | 0 | circle | hollow |
| Filled Circle | 1 | circle | filled |
| Hollow Square | 2 | square | hollow |
| Filled Square | 3 | square | filled |
| Hollow Triangle | 4 | triangle | hollow |
| Filled Triangle | 5 | triangle | filled |

**Board rule:** every row and column contains all 6 symbols exactly once.

**Clue types:** identical to the 4×4 game:
- Outline capsule = same shape
- Solid capsule = same fill

**Checks:** 1 (expert mode — no oracle feedback).

---

## Architecture

```
apps/proofgrid36/
  index.html          — shell, modals, script tags
  styles.css          — all styling (6×6 board + modals)
  seed-bank.js        — inline seed bank (from data/seed-bank-6x6.json)
  solver.js           — backtracking uniqueness solver (early exit at 2)
  generator.js        — seed-bank + scramble pipeline, daily puzzle
  storage.js          — localStorage (progress, streak)
  share.js            — spoiler-free share text
  game.js             — game state, check logic
  ui.js               — board DOM rendering, SVG symbols
  help.js             — help modal controller
  result-modal.js     — result modal controller
  main.js             — entry point, wires everything together
  data/
    seed-bank-6x6.json  — authoritative seed data (offline vendor copy)
```

No build step. All vanilla JS, no frameworks.

---

## Generation math

### Step 1 — Seed bank

The seed bank (`data/seed-bank-6x6.json`) contains 8 Latin squares of order 6. These come from two confirmed isotopy classes:

**Class A — abelian group (Z₃×Z₂ ≅ Z₆):**
- `z3xz2-algebraic` — canonical Z₃×Z₂ Cayley table (specified in brief)
- `z6-cyclic` — Z₆ circulant: entry[i][j] = (i+j) mod 6
- `z3xz2-rowperm` — Z₃×Z₂ with row permutation [2,0,4,1,5,3]
- `z3xz2-colperm` — Z₃×Z₂ with column permutation [3,1,5,0,4,2]
- `back-circulant` — back-circulant: entry[i][j] = (j−i+6) mod 6

**Class B — non-abelian group (S₃ / D₃):**
- `s3-dihedral` — S₃ Cayley table (r³=e, s²=e, srs=r⁻¹)
- `s3-relabeled` — S₃ with symbol permutation [0,3,1,4,2,5]
- `s3-rowperm` — S₃ with row permutation [3,1,4,0,5,2]

**TODO:** Vendor additional seeds from [McKay's order-6 Latin-square database](https://users.cecs.anu.edu.au/~bdm/data/latin.html) to cover more of the 12 known isotopy classes of order-6 Latin squares. The current bank covers 2 isotopy classes.

### Step 2 — Scramble

For each generated puzzle, the generator applies a trait-preserving scramble to a randomly-chosen seed:
1. Random row permutation (6!)
2. Random column permutation (6!)
3. Random shape permutation (3!) — permutes {circle, square, triangle}
4. Random fill permutation (2!) — permutes {hollow, filled}
5. Optional transpose (50% chance)

Symbol relabeling: `new_v = shapePerm[floor(v/2)] * 2 + fillPerm[v % 2]`

This preserves the 3-shape × 2-fill factorization so clue semantics remain correct.

### Step 3 — Clue reduction

After scrambling:
1. Extract all valid pair-clues from the solved board
2. Greedily remove clues while uniqueness is maintained (solver early-exit at 2)
3. Accept if clue count is in [10, 14] with good directional/type distribution
4. Retry up to 30× with different seeds/scrambles

**Target:** 12 clues, ≥3 horizontal, ≥3 vertical, ≥2 same-shape, ≥2 same-fill.

### Step 4 — Uniqueness solver

`solver.js` implements backtracking with:
- Row/column all-different constraints (bitmasks)
- Per-cell clue index for forward checking
- Early exit at 2 solutions

---

## Daily puzzle

- Keyed to `dayIndex = floor(Date.now() / 86400000)`
- Seed: `mulberry32((day + 31337) * 2654435761 >>> 0)`
- Cached in localStorage as `pg36_puzzle_{day}` (avoids re-generation on reload)
- All players on the same calendar day get the same puzzle (UTC-based)

---

## Running locally

No build step. Serve the repo root with any static server:

```sh
npx serve .
# then open http://localhost:3000/apps/proofgrid36/
```

Or use the Netlify CLI:

```sh
netlify dev
# then open http://proofgrid36.localhost:8888/
```

---

## Links

- 4×4 daily: `proofgrid.kapework.com`
- 6×6 expert: `proofgrid36.kapework.com` (this app)
