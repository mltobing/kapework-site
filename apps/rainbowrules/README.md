# Rainbow Rules

> **Guess the hidden color code** — a daily Mastermind-style puzzle with a Kapework twist.

## Game overview

| Setting    | Value                        |
|------------|------------------------------|
| Slots      | 5                            |
| Colors     | 6 (R O Y G B P)              |
| Max guesses| 6                            |
| Duplicates | Allowed in code and guesses  |

Each day a **Rule Card** reveals a constraint the hidden code obeys. Use it as extra information — your guesses don't need to follow the rule.

**Feedback** is Mastermind-style (count-based, not positional):
- **✓ exact** — right color, right slot
- **↕ misplaced** — right color, wrong slot

**Medals:** Gold ≤ 4 guesses · Silver = 5 · Bronze = 6 · Fail = not solved

## Daily rules (v1)

| ID               | Label               | Constraint                                           |
|------------------|---------------------|------------------------------------------------------|
| `all_different`  | All different       | Every slot shows a different color                   |
| `one_repeat`     | Exactly one repeat  | One color appears twice; all others appear once      |
| `no_adjacent`    | No adjacent match   | No two neighboring slots share the same color        |
| `first_last_match`| First and last match| First and last slots are the same color             |

## File structure

```
apps/rainbowrules/
  index.html          — HTML shell, loads all scripts
  styles.css          — Dark-theme game styles (mobile-first)
  palette.js          — 6-color definitions with accessibility labels
  evaluator.js        — Mastermind-correct duplicate-aware feedback
  rules.js            — Rule definitions + seeded code generators (mulberry32 PRNG)
  storage.js          — localStorage persistence (daily state + lifetime stats)
  game.js             — Daily puzzle generation + in-game state machine
  share.js            — Spoiler-free share text + clipboard/Web Share API
  help.js             — Help modal
  ui.js               — All DOM rendering
  main.js             — Application entry point, wires everything together
  data/
    rules.json          — Rule metadata (reference; data is embedded in rules.js)
    palette-themes.json — Color data (reference; data is embedded in palette.js)
```

## Running locally

No build step. Open `apps/rainbowrules/index.html` via a local server that serves the
repo root (so `/shared/` and `/apps/` paths resolve correctly), e.g.:

```bash
npx serve .
# then visit http://localhost:3000/apps/rainbowrules/
```

## Routing

`rainbowrules.kapework.com` is a **folder app**. The Netlify edge function maps the
subdomain slug `rainbowrules` → `/apps/rainbowrules/index.html` via the default
folder-app convention. No special entry in `SINGLE_FILE` is needed.

## Duplicate handling

`evaluator.js` implements the standard Mastermind two-pass algorithm:

1. **Pass 1** — scan all positions; increment `exact` where `guess[i] === secret[i]`.
2. **Pass 2** — on unmatched positions only, count how many guess colors appear in the
   remaining secret colors (tracking counts to avoid double-counting). That total is
   `misplaced`.

This means a guess of `[R,R,R,R,R]` against a secret of `[R,O,G,B,P]` scores
`exact=1, misplaced=0` — the single matching R is exact, and the extra Rs don't
generate phantom misplaced hits.

## Analytics events

| Event              | When                          |
|--------------------|-------------------------------|
| `game_start`       | On boot                       |
| `first_interaction`| First color tapped            |
| `guess_submit`     | Each valid guess              |
| `solve_success`    | Game won                      |
| `solve_fail`       | 6 guesses exhausted           |
| `medal_earned`     | Any medal awarded             |
| `share_click`      | Share button tapped           |
