# Puzzle Foundry

**Tagline:** Fresh puzzle sparks. Tap one and play.

## What it is

Puzzle Foundry is a player-facing puzzle seed lab inside Kapework.
It shows 8 seed cards per session. Each card is a distinct puzzle concept ("seed").
Tapping a card launches a real, immediately playable puzzle — not a text description.

The core loop is:
1. Browse 8 seed cards
2. Tap one you like
3. Choose Easy / Medium / Hard
4. Play the puzzle
5. Remix (same seed, new instance) or try another seed

## Why player-facing, not text-only

This is a puzzle game, not a brainstorming tool. Every visible seed card maps to
a working generator and validator. No card is shown unless its family engine can
produce a real puzzle from it.

## The 3 v1 families

### Target Forge (`families/target-forge.js`)
A number-expression puzzle. Combine tiles using arithmetic to hit an exact target
under one twist (e.g., multiplication banned, each operator at most once, etc.).

Twists: lockout, one_each, last_tile, stepstone, div_ban

### Order Repair (`families/order-repair.js`)
A reorder/sort puzzle. Restore a scrambled row to sorted order using only legal
swaps defined by the twist (adjacent only, odd-sum neighbors, skip-two, mirror, anchor).

Twists: adjacent_only, odd_sum, anchor, skip_two, mirror

### Path Trace (`families/path-trace.js`)
A small-grid path puzzle. Trace from start to exit satisfying the twist condition
(exact step count, visit all marked cells, no color repeat, collect key first).

Twists: exact_turns, visit_all, no_color_repeat, collect_key

## How the seed generator works

`generator.js`:
1. All 14 twists (across 3 families) are scored with a simple heuristic + random jitter
2. Pack composition constraints are enforced: max 3 from any family, all 3 families present
3. 8 cards are selected and returned as metadata (no puzzle is instantiated yet)
4. On tap + difficulty selection, the family engine generates a puzzle on demand

Generation is deterministic + procedural. No LLM is called at any point.

Each family uses a "generate from solution" strategy: build a valid solution first,
then derive the puzzle state from it. This guarantees solvability without a search solver.

## Why no runtime AI dependency

- Seed definitions are curated static data
- Puzzle instantiation is pure browser JS (no network call)
- All family engines use procedural generation + built-in validators
- Pack scoring is heuristic code, not model inference
- Works fully offline after first page load

## Known v1 limitations

- Target Forge does not validate "one_each" constraint server-side — it relies on
  the UI disabling already-used operator buttons
- Order Repair "mirror" twist for odd-length arrays can occasionally produce trivially
  solved positions; the generator retries, but the puzzle may be slightly simpler
- Path Trace "no_color_repeat" grid coloring uses a fixed 4-color palette; large grids
  on hard difficulty may have limited non-repeating paths
- No share/copy functionality yet (v1.1)
- No persistent favorites or streak tracking (v1.1)

## How to run locally

This is a static Netlify site. No build step required for the app itself.

```bash
# From repo root
npx netlify-cli dev
# or just open apps/puzzlefoundry/index.html directly in a browser
# (ES modules require a server — use any local HTTP server)
python3 -m http.server 8080
# then visit http://localhost:8080/apps/puzzlefoundry/
```

## Route

- URL: `https://puzzlefoundry.kapework.com/`
- Served from: `/apps/puzzlefoundry/index.html`
- Listed in: `apps/braingym/index.html`
- Subdomain alias must be registered in Netlify dashboard (not in this repo)
