# Kapework Site Organizational & Structural Review (excluding Make24)

Date: 2026-02-16
Scope: repository-wide review with focused recommendations for Tiltrix, TapSum, and BlinkGrid.

## Executive summary

The repository is currently optimized for speed of shipping single-file web apps, which works well for rapid prototyping, but there are now clear signs of scale pressure:

- duplicated app variants and naming drift,
- repeated platform/integration code (Supabase + device IDs),
- one-file HTML/CSS/JS architecture for every game,
- inconsistent linking and app entrypoint conventions.

A lightweight “modular static apps” structure would preserve deployment simplicity while dramatically improving maintainability.

## Repository-level observations

1. **Single-file app pattern everywhere**  
   Most games are full HTML documents with embedded styles and scripts in one file (`tiltrix.html`, `tapsum.html`, `blinkgrid.html`, etc.), which is fast to create but hard to diff/test/reuse as the number of apps grows.

2. **Duplicate or near-duplicate artifacts exist**  
   - `apps/longshot.html` and `apps/longshot-fixed.html` coexist, each very large.
   - `apps/rainbowrules` (no extension) and `apps/rainbowrules.html` both exist.

3. **Manifest/app URL mismatch risk**  
   `manifest.json` points `longshot` to `apps/longshot/` while the repo includes `apps/longshot.html` and `apps/longshot-fixed.html`.

4. **Shared config repeated in many files**  
   Supabase URL/anon key and the same local device ID key are duplicated across root and multiple games.

5. **No explicit project documentation for architecture conventions**  
   There is currently no contributor-facing structure guide for naming, app lifecycle, folder organization, or shared utilities.

## High-impact structural improvements (global)

1. **Introduce a tiny shared layer** (no framework required)
   - `shared/config.js` for Supabase URL + anon key + common keys.
   - `shared/storage.js` for device ID and local storage helpers.
   - `shared/supabase.js` for lazy client creation + common score APIs.
   - `shared/ui.css` for reusable tokens/components (pill/button/panel).

2. **Move to per-app folders while staying static-host friendly**
   - Example: `apps/tapsum/index.html`, `apps/tapsum/main.js`, `apps/tapsum/styles.css`.
   - Keep app pages deployable as static files, but split logic by concern.

3. **Enforce naming/version policy for variants**
   - Replace “fixed” and extensionless clones with explicit channels:
     - `apps/longshot/index.html` (current stable)
     - `apps/longshot-next/index.html` (experimental)
   - Document promotion/deprecation flow.

4. **Add a repository health checklist script**
   - Validate every `manifest.json` URL points to an existing local file/folder or approved external domain.
   - Detect duplicate slugs, duplicate file basenames, and extensionless HTML files.

5. **Create `CONTRIBUTING.md` for app architecture**
   - Required sections per game (state, render, input, persistence, analytics).
   - Accessibility and keyboard support checklist.
   - Release checklist (manifest + smoke test + screenshot + changelog).

## Focus: Tiltrix

### What is working
- Core game and tilt-control code are separated into two IIFEs, which is already a good boundary.
- Includes calibration flow and fallback tap controls.

### Structural improvements
1. **Split engine from input adapters**
   - `tiltrix-engine.js`: board logic, piece movement, scoring, rendering.
   - `tiltrix-input-touch.js`: tap/canvas controls.
   - `tiltrix-input-motion.js`: orientation + motion permissions/calibration.

2. **Introduce explicit state object + reducer-style transitions**
   Current mutable globals are manageable now, but future features (pause, levels, ghosts, accessibility toggles) become safer with centralized state transitions.

3. **Create an input abstraction contract**
   Define actions (`MOVE_LEFT`, `MOVE_RIGHT`, `ROTATE_CW`, `SOFT_DROP_ON`, etc.) and let each input source dispatch actions; this avoids hidden coupling between motion handlers and game internals.

4. **Lifecycle management for sensor listeners**
   Add attach/detach methods so listeners can be disabled on game over, pause, or tab hide; this avoids stale event processing and eases testing.

5. **Responsive canvas strategy**
   Current size rules are basic. Prefer explicit scaling strategy (logical board size vs device pixel ratio) to improve clarity and rendering consistency.

## Focus: TapSum

### What is working
- Clear separation of UI sections and game mechanics.
- Keyboard controls and feedback are already present.

### Structural improvements
1. **Refactor into modules by responsibility**
   - `round-generator.js`: solvable round generation.
   - `selection-controller.js`: picks, sum updates, and win/loss conditions.
   - `score-service.js`: local best + global best read/write.
   - `audio-service.js`: ambience management and teardown.

2. **Formalize game state machine**
   Add explicit phases: `idle`, `playing`, `won`, `transitioning`. This reduces edge-case bugs (e.g., rapid input during delayed round transition).

3. **Extract shared Supabase score logic**
   TapSum and Rainbow Rules use very similar score upsert/global fetch patterns; shared helper avoids repeated error handling and schema drift.

4. **Deterministic round testing hook**
   Add optional seeded RNG input so generation and puzzle quality can be verified with repeatable tests.

5. **Accessibility refinement**
   Keep numeric keyboard mapping, but add role/state attributes updates for selected cells and clearer live-region status messages for screen-reader consistency.

## Focus: BlinkGrid (3x3 + 4x4)

### What is working
- Game loop is concise and understandable.
- Daily/endless mode model is simple and effective.

### Structural improvements
1. **Unify BlinkGrid and BlinkGrid4 into one parametrized engine**
   The two files are mostly the same logic. A single engine with config (`gridSize`, `dailyRounds`, difficulty ramp) will reduce duplication and bug divergence.

2. **Separate layout concerns from gameplay logic**
   `blinkgrid4.html` currently contains overlapping body/wrap style definitions in the same stylesheet; consolidate through shared CSS tokens/layout classes.

3. **Introduce versioned difficulty profiles**
   Keep difficulty settings in JSON/config objects (e.g., `classic`, `kids`, `expert`) instead of hardcoded formulas in each file.

4. **Create reusable game shell component**
   Daily/endless controls, score bar, reset row, and message banner can be shared among memory games.

5. **State reset consistency**
   Encapsulate `start`, `nextRound`, and `endGame` transitions through a small central state update function to avoid mode-specific regressions as features grow.

## Suggested phased plan

### Phase 1 (1-2 sessions)
- Fix manifest URL consistency and remove/rename duplicate legacy files.
- Add `CONTRIBUTING.md` + repository structure doc.
- Add simple manifest validation script.

### Phase 2 (2-4 sessions)
- Extract shared Supabase/device helpers.
- Modularize TapSum first (lowest risk to prove pattern).
- Parameterize BlinkGrid 3x3/4x4 into one code path.

### Phase 3 (3-5 sessions)
- Modularize Tiltrix into engine + input adapters.
- Add lightweight app smoke tests (Playwright or simple headless checks).
- Establish release branch policy for app variants.

## Priority quick wins

1. Fix `longshot` manifest URL target inconsistency.
2. Consolidate duplicate Rainbow Rules artifact naming.
3. Centralize Supabase constants in one shared file.
4. Merge BlinkGrid variants into one configurable implementation.
5. Split Tiltrix motion controls into detachable module.
