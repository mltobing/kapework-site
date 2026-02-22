# Portfolio Product + UX Review (2026-02-22)

## 0) Sanity check
- Branch: `work`
- HEAD: `ba373a0bd3e3cc59be92a33a76d2947ab90c9a2d`
- Last 5 commits:
  1. `ba373a0` Merge pull request #14 from mltobing/claude/build-letter-hunt-game-9FURX
  2. `bbe1797` feat: add Word Writer game mode (trace + write sight words)
  3. `0b6ac4f` Merge pull request #13 from mltobing/claude/build-letter-hunt-game-9FURX
  4. `d7c765c` refactor: split monolithic letterhunt.html into modular readysetread/ app
  5. `07dd71d` rebrand letterhunt to Ready, Set, Read! on landing page
- Note: repository has no local `main` branch and no configured `origin`, so strict HEAD-vs-main validation is not possible in this clone.

## 1) PDF principle extraction status
I could not execute this step as requested because there are **no PDF files in this repository or workspace** (`find /workspace -name '*.pdf'` returned no results).

To avoid guessing, sections below use only repo/app evidence.

## 2) Inventory of playable experiences
- Kapework Hub — `/index.html` — `index.html` + `manifest.json` — run: `python3 -m http.server 4173` then open `/`.
- Ready, Set, Read! — `/apps/readysetread/` — `apps/readysetread/index.html`, `shared.js`, `modes/*.js`, `data/*.js` — run static server and open route.
- Make 24 (local copy) — `/apps/make24.html` — `apps/make24.html` — run static server and open route.
- Make 24 (production from manifest) — `https://make24.app` — external deployment target from `manifest.json`.
- Tiltrix — `/apps/tiltrix.html` — `apps/tiltrix.html` — run static server and open route.
- CVC Builder — `/apps/cvcbuilder.html` — `apps/cvcbuilder.html` — run static server and open route.
- TapSum — `/apps/tapsum.html` — `apps/tapsum.html` — run static server and open route.
- BlinkGrid (3x3) — `/apps/blinkgrid.html` — `apps/blinkgrid.html` — run static server and open route.
- BlinkGrid 4x4 — `/apps/blinkgrid4.html` — `apps/blinkgrid4.html` — run static server and open route.
- Rainbow Rules — `/apps/rainbowrules.html` (+ duplicate extensionless `apps/rainbowrules`) — `apps/rainbowrules.html` — run static server and open route.
- Longshot — `/apps/longshot.html` (+ legacy `apps/longshot-fixed.html`) — `apps/longshot.html` — run static server and open route.

## 3) Weighted approach used
- Deepest analysis: Make24 + ReadySetRead.
- Medium: Tiltrix + CVC Builder.
- Fast triage: TapSum, BlinkGrid(s), Rainbow Rules, Longshot, duplicates.

## I. Executive summary
### Strongest today
- **Ready, Set, Read!** has the clearest daily loop and strongest retention architecture: mode cards, per-mode completion, streak display, daily reset, summary stars, collectible cards, and native share/copy fallbacks.
- **Make24** (local implementation and manifest priority) has excellent first-move speed and minimalist arithmetic loop with high replay potential.

### Biggest portfolio risks
- Portfolio fragmentation: duplicates and variants (`rainbowrules` duplicate file, `longshot-fixed`, BlinkGrid split) dilute quality and maintenance.
- Inconsistent route strategy: Make24 points external while local copy exists; Longshot manifest URL mismatch risk (`apps/longshot/` vs html files).
- Some apps still need explicit onboarding by action (especially CVC Builder and Tiltrix motion calibration).

### Top 5 cross-cutting changes
1. Remove duplicate/legacy artifacts from user-facing surface (single canonical route per game).
2. Standardize summary/share pattern across all games (share payload + copy fallback).
3. Add one “first move nudge” line across all games (single sentence, disappears after first action).
4. Normalize streak/state handling pattern (daily cadence, respectful resets, clear persistence semantics).
5. Align manifest URLs with canonical deployed paths and hide non-priority experiments from primary grid.

## II. Portfolio decision matrix
- **Make24 — INVEST**
  - Strong minimal loop and immediate action fit.
  - Distinct hook: arithmetic puzzle with daily identity.
  - High impact for modest polish work (share refinement, trust/accessibility pass).

- **Ready, Set, Read! — INVEST**
  - Strong alignment: low-friction access + clear daily progression.
  - Differentiator: multi-mode literacy practice with card collection and streak.
  - High leverage: simplify mode count and tighten share cadence.

- **Tiltrix — KEEP (targeted improvements)**
  - Fun interaction, but motion setup adds onboarding friction.
  - Hook: tilt-based control novelty.
  - Medium effort for clear gains; avoid feature creep.

- **CVC Builder — REWORK**
  - Loop has educational value but too many controls and states up front.
  - Hook exists (sound-first CVC blending), but reward loop is weak.
  - Needs slim MVP loop; medium-high effort.

- **TapSum — KEEP**
  - Clean quick-play number loop with streak and keyboard support.
  - Less differentiated than Make24 but still strong utility.
  - Low maintenance, medium upside if hidden in secondary shelf.

- **BlinkGrid (3x3 + 4x4) — ARCHIVE as separate entries; KEEP one merged version**
  - Minimal and clear, but duplicated entries split traffic.
  - Hook: memory micro-challenge.
  - Merge to one configurable app for better effort-to-impact.

- **Rainbow Rules — REWORK or ARCHIVE**
  - Concept is interesting but rule-stack cognitive load can spike.
  - Hook weaker than top priorities.
  - Keep only if simplified to one clear “aha” path.

- **Longshot — KEEP (secondary)**
  - Daily scarcity + shot limit gives solid retention scaffolding.
  - Hook: constrained word search with archive.
  - Worth keeping but not top portfolio focus.

- **Legacy duplicates (rainbowrules extensionless, longshot-fixed) — KILL/ARCHIVE (non-public)**
  - No user value in duplicates.
  - Increases confusion and maintenance cost.
  - Immediate cleanup win.

## III. Scorecard
Scale: 0 (poor) to 5 (excellent). TTFMM = time-to-first-meaningful-move.

| Game | A | B | C | D | E | F | G | H | I | J | TTFMM | Gestures | Share? | Streak? |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|:---:|:---:|
| Make24 | 5 | 4 | 4 | 4 | 4 | 4 | 3 | 5 | 3 | 3 | ~2–4s | 2 | Y | Y |
| ReadySetRead | 4 | 4 | 4 | 4 | 5 | 5 | 4 | 4 | 3 | 3 | ~4–7s | 2–3 | Y | Y |
| Tiltrix | 3 | 3 | 2 | 3 | 4 | 2 | 1 | 4 | 3 | 2 | ~6–12s | 3 | N | N |
| CVC Builder | 2 | 2 | 2 | 3 | 3 | 2 | 0 | 3 | 3 | 2 | ~8–15s | 2 | N | N |
| TapSum | 4 | 4 | 4 | 4 | 4 | 3 | 1 | 4 | 3 | 3 | ~3–5s | 1 | N | Y |
| BlinkGrid | 4 | 4 | 4 | 3 | 3 | 3 | 0 | 3 | 3 | 3 | ~4–6s | 1 | N | N |
| BlinkGrid 4x4 | 4 | 3 | 4 | 3 | 3 | 3 | 0 | 3 | 3 | 3 | ~4–6s | 1 | N | N |
| Rainbow Rules | 3 | 2 | 3 | 3 | 3 | 2 | 0 | 3 | 3 | 2 | ~5–8s | 1 | N | N |
| Longshot | 4 | 3 | 3 | 4 | 3 | 4 | 4 | 4 | 3 | 3 | ~6–10s | 1 | Y | Y |

## IV. Deep dive — Make24
### 1) Core loop
You are presented with four numbers and combine them with arithmetic operations to make 24. The loop is quick: select numbers/operators, check outcome, iterate, and continue to next puzzle.

### 2) Success vs friction
- Success: immediate puzzle visibility, compact interaction vocabulary, low chrome.
- Friction: local file currently contains markdown fence artifacts near CSS block (risking parse issues depending on browser tolerance); trust/accessibility cues are limited.

### 3) Retention loop
Scarcity (daily puzzle identity), immediate action (solve attempt), reward (streak increment + completion feedback), lightweight status (streak UI), return trigger (next day puzzle number).

### 4) Share loop
Share exists in implementation family and daily score identity supports social sharing; improve by timing prompt exactly at triumph and ensuring spoiler-free concise payload.

### 5) 10 prioritized recommendations
1. Fix CSS fence artifact in `apps/make24.html` to ensure standards-valid rendering.
2. Keep one canonical Make24 route strategy (manifest external vs local) and document it.
3. Add explicit ARIA labels to icon-only controls (undo/hint/archive).
4. Add subtle “first move” hint that self-dismisses after first valid operation.
5. Move sign-in prompt later (post-solve) to avoid pre-play cognitive load.
6. Preserve no-login play as primary path.
7. Ensure high-contrast mode token checks on buttons/secondary text.
8. Add keyboard parity note where available.
9. Add concise failure microcopy (“close, try another operator”).
10. Add one-tap spoiler-free share string with puzzle ID + attempts only.

## IV. Deep dive — Ready, Set, Read!
### 1) Core loop
Home presents daily literacy modes; player picks a mode, completes short rounds (tap/match/write), receives stars + card reveal + streak update, then returns to home collection and repeats another mode.

### 2) Ultra-minimalism success vs leaks
- Success: clear card-based mode launcher, visible streak, single-screen mode entry, tight completion summary.
- Leaks: 5 modes on home can raise choice load for first-time users; writing modes include multiple buttons/check states that increase interface density.

### 3) Retention analysis (scarcity→action→reward→streak→return)
- Scarcity: per-day completion states and reset behavior.
- Action: complete short rounds per mode.
- Reward: stars + collectible card reveal + audio/confetti cues.
- Streak/stat: global streak tracked in persistent storage and shown on home/game/summary.
- Return trigger: daily done states reset by date and streak continuity pressure.

### 4) Share loop analysis
- Shared object: stars + mode + date + streak + app URL.
- Spoiler-free quality: good (no content answers exposed).
- Friction: share only at summary; could improve with “copied” confidence and per-mode celebratory timing.

### 5) 10 prioritized recommendations
1. Reduce home decision load: feature 2 primary modes, tuck others under “More modes”.
2. Keep mode cards but simplify copy to one sentence each.
3. In writing modes, collapse check/next controls into one progressive CTA where possible.
4. Add “continue where I left off” chip on home when a mode is in-progress.
5. Standardize round-dot meaning across all modes.
6. Add optional “quiet mode” toggle persisted in localStorage.
7. Improve trust/accessibility: larger minimum tap targets and stronger text contrast in muted labels.
8. Show next return trigger explicitly after completion (“New cards tomorrow”).
9. Trigger share CTA only on 3-star outcomes by default; keep copy fallback.
10. Add tiny session-length indicator on each mode card (e.g., “~2 min”).

## V. Medium dives
### Tiltrix — 5 prioritized minimalist improvements
1. Replace setup sentence with one action-first line: “Tilt to move, tap sides to rotate; press Restart anytime.”
2. Auto-hide tilt onboarding after first piece move.
3. Add deterministic fallback controls as first-class (not secondary) for non-motion devices.
4. Add one short “fairness” cue for speed increase thresholds.
5. Keep canvas clean; avoid adding extra HUD panels.

Viral/share ideas (without complexity):
- End-run text share: lines cleared + score + one emoji grade.
- “Almost there” share at near-best threshold (optional, non-intrusive).

### CVC Builder — diagnosis
Why it feels like “needs much work”:
- Too many controls before first success (mode select + slot selection + letter bank + multiple action buttons).
- Reward loop is diluted between Daily and Free play semantics.
- “Aha” can be delayed because correctness requires explicit check flow after composition.

Recommendation: **REWORK (not kill yet)** with tight MVP loop.

Minimal MVP rework plan (and what to delete):
1. Default to Daily on load; hide Free play behind secondary link.
2. Remove manual active-slot toggling; auto-advance C→V→C.
3. Keep only 3 buttons: Hear word, Clear, Submit.
4. Convert hint to optional long-press on Hear word (remove extra hint button).
5. Show immediate letter-sound feedback on each placement.
6. Auto-submit when all three slots filled (with undo affordance).
7. Keep stars + best only; postpone profile abstractions.
8. Cap daily to 3 words initially for faster reward.
9. Add end summary with one shareable line.
10. Remove non-essential explanatory text blocks.

## VI. Fast triage (everything else)
### TapSum — KEEP (secondary)
Strong instant-play arithmetic puzzle with streak/best/global and keyboard mapping. It is clean but overlaps with Make24’s math niche; position as secondary. Salvage: streak row, global-best pattern, keyboard affordance copy.

### BlinkGrid + BlinkGrid4 — merge and keep one
Both are clear micro-memory games with Daily/Endless toggles. Keep one configurable implementation; archive duplicate listing. Salvage: seeded daily RNG pattern and concise mode selector.

### Rainbow Rules — REWORK or ARCHIVE
Interesting rule-memory mechanic but comprehension burden rises quickly, which can conflict with minimalist clarity. Keep only if first 30 seconds are reworked to one unmistakable interaction model. Salvage: pill HUD and compact feedback banner.

### Longshot — KEEP (secondary)
Daily seed + 3 shots + archive already forms a strong retention/share foundation. Keep out of primary focus but maintain. Salvage: archive UX, spoiler-safe share button timing, streak semantics.

### Legacy/duplicate artifacts — ARCHIVE/KILL
`apps/rainbowrules` (extensionless duplicate) and `apps/longshot-fixed.html` should be removed from active footprint to reduce confusion and maintenance.

## 6) Optional implementation quick wins
No code changes applied in this review pass to avoid accidental architectural drift. Suggested low-risk diffs for next pass:
1. Manifest cleanup + canonical route normalization.
2. Remove duplicate files from user-facing routes.
3. Add one-line first-move helper text consistency pattern across priority apps.
