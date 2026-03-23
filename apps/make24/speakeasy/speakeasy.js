/**
 * speakeasy.js — "After Hours" sequence-run mode for Make24
 *
 * Gated behind isRegistered(). Zero modifications to app.js or style.css.
 * A MutationObserver watches the victory card to inject:
 *   1. 🔑 key button (top-right of victory card + header topbar)
 *   2. "Try Speakeasy →" button (below Share/Challenge in victory actions)
 *
 * Sequence-Run Mode:
 *   - Pre-computes all integers in [ORDER_MIN..ORDER_MAX] achievable from
 *     today's 4 digits using exact rational arithmetic (+−×÷, all digits once).
 *   - Sorts targets by difficulty (hardest last).
 *   - Presents one target at a time with a SECONDS_PER_TARGET countdown.
 *   - Timer bar (4px) shows remaining time: cyan→gold→pulsing red.
 *   - Solved chips row shows progress through the sequence.
 *   - End screen shows all targets with found/missed chips.
 *   - Mid-game state saved to localStorage for resume if player exits early.
 *   - Uses window.currentPuzzle (from app.js) to support archive puzzle play.
 *
 * ─── TUNE THESE CONSTANTS ────────────────────────────────────────────
 *   ORDER_MIN           = 1    smallest integer that counts as a target
 *   ORDER_MAX           = 24   largest  integer that counts as a target
 *   SECONDS_PER_TARGET  = 40   seconds per target
 * ─────────────────────────────────────────────────────────────────────
 *
 * Storage keys (never collide with base-game keys):
 *   make24_speakeasy_state       — JSON of in-progress game state
 *   make24_afterhours_introSeen  — "1" once intro has been shown
 *
 * Solution plans are represented as expression trees:
 *   ExprNode = { type:'leaf', id:number, value:number }
 *            | { type:'op', op:string, left:ExprNode, right:ExprNode, r:Rat }
 *   Where Rat = { n:number, d:number } (reduced fraction, d > 0).
 *
 * Console debug helper:
 *   window.make24DebugSetRegistered(true/false)
 */
(function () {
    'use strict';

    // ============================================================
    // CONSTANTS — tune here
    // ============================================================
    const ORDER_MIN           = 1;
    const ORDER_MAX           = 24;
    const SECONDS_PER_TARGET  = 40;   // seconds per target
    const RESET_MS            = 600;  // delay before board resets after expression resolves
    const STEP_MS             = 700;  // ms between highlight and apply in demo animation

    const STATE_KEY   = 'make24_speakeasy_state';
    const INTRO_KEY   = 'make24_afterhours_introSeen';
    const SLOT_CLASSES = ['spk-slot-top', 'spk-slot-left', 'spk-slot-right', 'spk-slot-bottom'];

    // ── ACCESS MODEL ─────────────────────────────────────────────────
    const TRIAL_DAYS_MAX            = 3;
    const SUPPORT_PRICE_USD         = 10;
    const LEMONSQUEEZY_CHECKOUT_URL = 'REPLACE_ME';
    const LEMONSQUEEZY_PRODUCT_ID   = 0;

    const TRIAL_DAYS_KEY  = 'make24_afterhours_trial_days';
    const UNLOCKED_KEY    = 'make24_afterhours_unlocked';
    const LICENSE_KEY_KEY = 'make24_afterhours_license_key';

    // ── FEATURE FLAGS ─────────────────────────────────────────────────
    const HARD_MODE_PAYWALL_ENABLED = false;
    const SUPPORT_ENABLED = false;
    const SUPPORT_URL     = '';
    const SUPPORT_LABEL   = 'Support';
    const FEEDBACK_EMAIL  = 'martin@kapework.com';
    const ENABLE_COMPARISON_LINE = true;
    const MIN_COMPARISON_SAMPLE  = 10;

    // ============================================================
    // GATE + ACCESS MODEL
    // ============================================================
    let _registeredFromAuth = false;
    const _devMode = new URLSearchParams(window.location.search).get('dev') === '1';

    function checkUrlParam() {
        try { return new URLSearchParams(window.location.search).get('speakeasy') === '1'; }
        catch (e) { console.error('[Speakeasy] checkUrlParam failed:', e); return false; }
    }

    async function refreshAuthState() {
        try {
            if (window.make24Db) {
                const { data: { session } } = await window.make24Db.getSession();
                if (session) _registeredFromAuth = true;
            }
        } catch (e) { console.error('[Speakeasy] refreshAuthState failed:', e); }
    }

    function isUnlocked() {
        if (checkUrlParam()) return true;
        if (localStorage.getItem('make24_registered') === '1') return true;
        if (_registeredFromAuth) return true;
        return localStorage.getItem(UNLOCKED_KEY) === '1';
    }

    // ── TRIAL HELPERS ────────────────────────────────────────────────
    function getLocalDayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function getTrialDays() {
        try { return new Set(JSON.parse(localStorage.getItem(TRIAL_DAYS_KEY) || '[]')); }
        catch (e) { console.error('[Speakeasy] getTrialDays parse failed:', e); return new Set(); }
    }

    function addTrialDay(dayKey) {
        const days = getTrialDays();
        days.add(dayKey);
        localStorage.setItem(TRIAL_DAYS_KEY, JSON.stringify([...days]));
    }

    function trialUsedCount() { return getTrialDays().size; }

    function canEnterAfterHoursToday() {
        if (!HARD_MODE_PAYWALL_ENABLED) return true;
        return isUnlocked() || trialUsedCount() < TRIAL_DAYS_MAX;
    }

    function afterHoursStatus() {
        return { unlocked: isUnlocked(), used: trialUsedCount(), max: TRIAL_DAYS_MAX };
    }

    function isTodaySolved() {
        try {
            const saved   = JSON.parse(localStorage.getItem('make24_v5') || '{}');
            // Check active puzzle first (supports archive), fall back to today
            const active  = (window.currentPuzzle && window.currentPuzzle.puzzleNum > 0)
                ? window.currentPuzzle.puzzleNum
                : (window.getTodayPuzzleNumber ? window.getTodayPuzzleNumber() : null);
            return active !== null && !!saved?.history?.[active]?.completed;
        } catch (e) { console.error('[Speakeasy] isTodaySolved failed:', e); return false; }
    }

    function getTodayPuzzleNum() {
        if (window.getTodayPuzzleNumber) return window.getTodayPuzzleNumber();
        const epoch = new Date('2025-01-01T00:00:00Z');
        const now   = new Date();
        const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.floor((local - epoch) / 86400000) + 1;
    }

    window.make24DebugSetRegistered = function (val) {
        if (val) {
            localStorage.setItem('make24_registered', '1');
            _registeredFromAuth = true;
            console.log('[Speakeasy] Unlock ON (legacy dev backdoor). Solve today\'s puzzle to see 🔑.');
        } else {
            localStorage.removeItem('make24_registered');
            _registeredFromAuth = false;
            console.log('[Speakeasy] Unlock OFF.');
        }
    };

    // ============================================================
    // RATIONAL ARITHMETIC
    // ============================================================
    function gcd(a, b) {
        a = Math.abs(a); b = Math.abs(b);
        while (b) { const t = b; b = a % b; a = t; }
        return a || 1;
    }

    function rat(n, d) {
        if (d === 0) return null;
        const g = gcd(Math.abs(n), Math.abs(d));
        const s = d < 0 ? -1 : 1;
        return { n: s * n / g, d: s * d / g };
    }

    // ============================================================
    // SOLVER WITH EXPRESSION TREES
    // ============================================================
    function allResults(nodes) {
        if (nodes.length === 1) return [nodes[0]];
        const out = [];
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i], b = nodes[j];
                const ar = a.r, br = b.r;
                const rest = nodes.filter((_, k) => k !== i && k !== j);

                const push = (op, r, la, lb) => {
                    if (r) {
                        const combined = { r, tree: { type: 'op', op, left: la.tree, right: lb.tree, r } };
                        for (const res of allResults([combined, ...rest])) out.push(res);
                    }
                };

                push('+', rat(ar.n * br.d + br.n * ar.d, ar.d * br.d), a, b);
                push('-', rat(ar.n * br.d - br.n * ar.d, ar.d * br.d), a, b);
                push('-', rat(br.n * ar.d - ar.n * br.d, br.d * ar.d), b, a);
                push('*', rat(ar.n * br.n, ar.d * br.d), a, b);
                if (br.n !== 0) push('/', rat(ar.n * br.d, ar.d * br.n), a, b);
                if (ar.n !== 0) push('/', rat(br.n * ar.d, br.d * ar.n), b, a);
            }
        }
        return out;
    }

    const _solutionCache = {};

    function computeSolutions(digits, min, max) {
        const key = [...digits].sort((a, b) => a - b).join(',');
        if (_solutionCache[key]) return _solutionCache[key];

        const leaves = digits.map((d, i) => ({
            r:    rat(d, 1),
            tree: { type: 'leaf', id: i, value: d }
        }));

        const solutions = new Map();
        for (const { r, tree } of allResults(leaves)) {
            if (r && r.d === 1 && r.n >= min && r.n <= max && Number.isFinite(r.n) && !solutions.has(r.n)) {
                solutions.set(r.n, tree);
            }
        }

        _solutionCache[key] = solutions;
        return solutions;
    }

    // ============================================================
    // DIFFICULTY SCORING
    // Count how many distinct solution expressions reach each target.
    // Fewer solutions = harder. Tie-break by target value (higher = harder).
    // ============================================================
    function computeDifficulty(digits, min, max) {
        const leaves = digits.map((d, i) => ({
            r:    rat(d, 1),
            tree: { type: 'leaf', id: i, value: d }
        }));

        const counts = new Map();
        for (const { r } of allResults(leaves)) {
            if (r && r.d === 1 && r.n >= min && r.n <= max && Number.isFinite(r.n)) {
                counts.set(r.n, (counts.get(r.n) || 0) + 1);
            }
        }
        return counts; // Map<integer, solutionCount>
    }

    function sortByDifficulty(targets, difficultyCounts) {
        return [...targets].sort((a, b) => {
            const ca = difficultyCounts.get(a) || 0;
            const cb = difficultyCounts.get(b) || 0;
            // More solutions = easier, so easier first (ascending by count).
            // Tie-break: lower number first.
            if (ca !== cb) return cb - ca;
            return a - b;
        });
    }

    // Star rating: 1-3 stars based on solution count
    function difficultyStars(count) {
        if (count >= 8) return 1;
        if (count >= 3) return 2;
        return 3;
    }

    // ============================================================
    // EXPRESSION RENDERING
    // ============================================================
    const OP_STR = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };

    function treeToExpr(node) {
        if (node.type === 'leaf') return String(node.value);
        const op = OP_STR[node.op] || node.op;
        const l  = node.left.type  === 'op' ? `(${treeToExpr(node.left)})`  : treeToExpr(node.left);
        const r  = node.right.type === 'op' ? `(${treeToExpr(node.right)})` : treeToExpr(node.right);
        return `${l} ${op} ${r}`;
    }

    function treeToSteps(tree) {
        let nextId = 4;
        const steps = [];
        function walk(node) {
            if (node.type === 'leaf') return node.id;
            const aId     = walk(node.left);
            const bId     = walk(node.right);
            const resultId = nextId++;
            steps.push({ aId, bId, op: node.op, resultId });
            return resultId;
        }
        walk(tree);
        return steps;
    }

    // ============================================================
    // ROUND ENGINE  (pure functions)
    // ============================================================
    function calc(a, op, b) {
        switch (op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return b === 0 ? null : a / b;
        }
        return null;
    }

    function createRound(digits) {
        return {
            cards:    digits.map((v, i) => ({ value: v, slot: i, used: false })),
            selected: [],
            history:  []
        };
    }

    function roundSelectCard(round, cardIdx) {
        const card = round.cards[cardIdx];
        if (!card || card.used) return round;
        const sel = [...round.selected];
        const pos = sel.indexOf(cardIdx);
        if (pos !== -1) { sel.splice(pos, 1); }
        else if (sel.length < 2) { sel.push(cardIdx); }
        return { ...round, selected: sel };
    }

    function roundSelectTwo(round, aIdx, bIdx) {
        return { ...round, selected: [aIdx, bIdx] };
    }

    function roundApplyOp(round, op) {
        if (round.selected.length !== 2) return null;
        const [i, j] = round.selected;
        const result = calc(round.cards[i].value, op, round.cards[j].value);
        if (result === null) return null;
        const snapshot = round.cards.map(c => ({ ...c }));
        const newCards = round.cards.map(c => ({ ...c }));
        newCards[i].used = true;
        newCards[j].used = true;
        newCards.push({ value: result, slot: newCards[i].slot, used: false });
        return { cards: newCards, selected: [], history: [...round.history, snapshot] };
    }

    function roundUndo(round) {
        if (round.history.length === 0) return round;
        const prev = round.history[round.history.length - 1];
        return { cards: prev.map(c => ({ ...c })), selected: [], history: round.history.slice(0, -1) };
    }

    function roundRemaining(round) { return round.cards.filter(c => !c.used); }
    function roundGetValue(round)  {
        const r = roundRemaining(round);
        return r.length === 1 ? r[0].value : null;
    }

    // ============================================================
    // TODAY'S DIGITS
    // ============================================================
    function getTodayDigits() {
        try {
            const pNum = getTodayPuzzleNum();
            return window.generatePuzzle ? window.generatePuzzle(pNum) : [2, 3, 4, 4];
        } catch (e) { console.error('[Speakeasy] getDigitsForPuzzle failed:', e); return [2, 3, 4, 4]; }
    }

    // ============================================================
    // FORMAT HELPERS
    // ============================================================
    function makeNumberNode(n) {
        if (window.formatNumberHTML) return window.formatNumberHTML(n);
        return document.createTextNode(Number.isInteger(n) ? String(n) : n.toFixed(2));
    }

    // ============================================================
    // SHARE
    // ============================================================

    // Stub — returns null until backend supports Hard Mode percentile
    // TODO: wire to real data when record_speakeasy_solve returns percentile
    function getHardModePercentile() { return null; }

    function buildHardModeShareText(puzzleNum, solved, total) {
        const pub = (window.APP_CONFIG && window.APP_CONFIG.publicUrl) || 'make24.app';
        let text = `\uD83E\uDDE0 Make24 Hard Mode\n\n`;
        text += solved === total
            ? `\uD83C\uDF0A Perfect! All ${total} targets solved\n`
            : `\uD83C\uDF0A Filled ${solved}/${total} targets\n`;

        if (ENABLE_COMPARISON_LINE) {
            const pData = getHardModePercentile();
            if (pData && pData.percentile != null && pData.total_players >= MIN_COMPARISON_SAMPLE && pData.percentile >= 50) {
                text += `\uD83C\uDFC5 Better than ${pData.percentile}% of players today\n`;
            }
        }

        text += `\nCan you beat it?\n${pub}`;
        return text;
    }

    function shareText(text) {
        // Copy first (silent), then open native share sheet if available
        navigator.clipboard.writeText(text).catch(() => {});
        if (navigator.share) {
            navigator.share({ text }).catch(() => {});
        }
        if (window.showToast) window.showToast('Copied!');
    }

    function clipText(text) {
        navigator.clipboard.writeText(text).then(
            () => { if (window.showToast) window.showToast('Copied!'); },
            () => { if (window.showToast) window.showToast('Copied!'); }
        );
    }

    // ============================================================
    // OVERLAY INFRASTRUCTURE
    // ============================================================
    let _overlay = null;

    function ensureOverlay() {
        if (_overlay) return _overlay;
        _overlay = document.createElement('div');
        _overlay.id        = 'spkOverlay';
        _overlay.className = 'spk-overlay';
        document.body.appendChild(_overlay);
        return _overlay;
    }

    function showOverlay(buildFn) {
        const el = ensureOverlay();
        el.innerHTML = '';
        el.className = 'spk-overlay spk-visible';
        buildFn(el);
    }

    function hideOverlay() {
        if (!_overlay) return;
        _overlay.classList.remove('spk-visible');
        setTimeout(() => { if (_overlay) _overlay.innerHTML = ''; }, 350);
    }

    // ============================================================
    // DIAMOND BOARD RENDERER
    // ============================================================
    function renderBoard(el, round) {
        SLOT_CLASSES.forEach((cls, slotIdx) => {
            const slotEl = el.querySelector('.' + cls);
            if (!slotEl) return;

            const card        = [...round.cards].reverse().find(c => c.slot === slotIdx && !c.used);
            const cardIdx     = card ? round.cards.indexOf(card) : -1;
            const existing    = slotEl.querySelector('.card');
            const existingIdx = existing ? parseInt(existing.dataset.cardIdx, 10) : -1;

            if (!card) { slotEl.innerHTML = ''; return; }

            const isFirst  = round.selected[0] === cardIdx;
            const isSecond = round.selected[1] === cardIdx;
            const cls2     = 'card' + (isFirst ? ' selected first' : '') + (isSecond ? ' selected second' : '');

            if (existingIdx === cardIdx) {
                existing.className = cls2;
            } else {
                slotEl.innerHTML = '';
                const cardEl = document.createElement('div');
                cardEl.className      = cls2;
                cardEl.dataset.cardIdx = cardIdx;
                cardEl.appendChild(makeNumberNode(card.value));
                slotEl.appendChild(cardEl);
            }
        });

        const opOverlay = el.querySelector('.spk-op-overlay');
        if (opOverlay) opOverlay.classList.toggle('spk-op-show', round.selected.length === 2);

        const undoBtn = el.querySelector('.spk-undo-btn');
        if (undoBtn) undoBtn.style.visibility = round.history.length > 0 ? 'visible' : 'hidden';
    }

    // ============================================================
    // ARENA WIRING  (event delegation on the main game arena)
    // ============================================================
    function wireArena(el, getRound, setRound, onResolve) {
        const arena = el.querySelector('.spk-arena');
        if (!arena) return;

        arena.addEventListener('pointerdown', (e) => {
            const cardEl = e.target.closest('[data-card-idx]');
            const opBtn  = e.target.closest('[data-op]');
            const undoEl = e.target.closest('[data-action="undo"]');
            const opOvl  = e.target.closest('.spk-op-overlay');

            if (undoEl) {
                e.preventDefault();
                setRound(roundUndo(getRound()));
                renderBoard(el, getRound());
                return;
            }
            if (cardEl) {
                e.preventDefault();
                setRound(roundSelectCard(getRound(), parseInt(cardEl.dataset.cardIdx, 10)));
                renderBoard(el, getRound());
                return;
            }
            if (opBtn) {
                e.preventDefault();
                const next = roundApplyOp(getRound(), opBtn.dataset.op);
                if (!next) return;
                setRound(next);
                renderBoard(el, getRound());
                if (roundRemaining(next).length === 1) onResolve(next);
                return;
            }
            if (opOvl && !opBtn) {
                e.preventDefault();
                const r = getRound();
                setRound({ ...r, selected: [] });
                renderBoard(el, getRound());
            }
        });
    }

    // ============================================================
    // MID-GAME STATE PERSISTENCE
    // ============================================================
    function saveGameState(puzzleNum, targetsList, solvedList, currentIdx, elapsedMs) {
        const state = {
            puzzleNum,
            targetsList,
            solvedList,
            currentIdx,
            elapsedMs
        };
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }

    function loadGameState() {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.error('[Speakeasy] loadGameState failed:', e);
            return null;
        }
    }

    function clearGameState() {
        localStorage.removeItem(STATE_KEY);
    }

    // ============================================================
    // SUPABASE SYNC
    // ============================================================
    async function syncToSupabase(puzzleNum, targetsList, solvedList, totalTimeSec) {
        if (!window.make24Db) return;
        try {
            const saved = JSON.parse(localStorage.getItem('make24_v5') || '{}');
            const deviceIdKey = 'make24_device_id_' + window.location.hostname;
            const deviceId = saved.deviceId || localStorage.getItem(deviceIdKey) || localStorage.getItem('make24_device_id');
            if (!deviceId) {
                console.warn('[Speakeasy] syncToSupabase skipped: missing device id.');
                return;
            }

            // Route through the canonical record_solve path (same as Normal mode).
            // record_speakeasy_solve does not write to the expected table.
            // record_solve already accepts p_is_speakeasy for Hard Mode identification.
            const isPerfect = solvedList.length === targetsList.length;
            console.log('[Speakeasy] calling record_solve with p_is_speakeasy: true, deviceId:', deviceId, 'puzzleNum:', puzzleNum);
            const result = await window.make24Db.rpc('record_solve', {
                p_device_id:    deviceId,
                p_puzzle_num:   puzzleNum,
                p_solved:       isPerfect,
                p_moves:        solvedList.length,
                p_solve_time:   totalTimeSec,
                p_operators:    [],
                p_undos:        0,
                p_is_speakeasy: true
            });

            if (result.error) {
                console.error('[Speakeasy] record_solve error:', result.error);
            } else {
                console.log('[Speakeasy] synced to Supabase:', result.data);
            }
        } catch (e) {
            console.error('[Speakeasy] syncToSupabase failed:', e);
        }
    }

    // ============================================================
    // INTRO SCREEN  (shown once on first launch)
    // ============================================================
    function showIntro(totalTargets, onStart) {
        showOverlay((el) => {
            el.classList.add('spk-overlay-center');
            el.innerHTML = `
<div class="spk-intro-card">
  <div class="spk-intro-icon">\uD83C\uDF78</div>
  <div class="spk-intro-title">Hard Mode</div>
  <div class="spk-intro-body">Make every number from 1\u2013${ORDER_MAX}, one at a time. ${SECONDS_PER_TARGET}s per target.</div>
  <div class="spk-intro-tag">${totalTargets} targets today</div>
  <button class="spk-btn spk-btn-primary spk-intro-start">Let's go</button>
</div>`;
            el.querySelector('.spk-intro-start').addEventListener('click', () => {
                localStorage.setItem(INTRO_KEY, '1');
                onStart();
            });
        });
    }

    // ============================================================
    // DEMO ANIMATION  (plays solution steps on the mini board)
    // ============================================================
    function playDemoAnimation(miniEl, digits, steps, timeouts, onDone) {
        let demoRound      = createRound([...digits]);
        const idToCardIdx  = { 0: 0, 1: 1, 2: 2, 3: 3 };
        let stepIdx        = 0;
        const opDisplay    = miniEl.querySelector('.spk-sol-op-display');

        // Suppress the interactive operator overlay during demo
        const opOverlay = miniEl.querySelector('.spk-op-overlay');
        if (opOverlay) opOverlay.style.display = 'none';

        renderBoard(miniEl, demoRound);

        function showOp(op) {
            if (!opDisplay) return;
            opDisplay.textContent = OP_STR[op] || op;
            opDisplay.classList.add('visible');
        }
        function hideOp() {
            if (!opDisplay) return;
            opDisplay.classList.remove('visible');
        }

        function runStep() {
            if (stepIdx >= steps.length) { hideOp(); onDone(); return; }
            const step = steps[stepIdx++];
            const aIdx = idToCardIdx[step.aId];
            const bIdx = idToCardIdx[step.bId];

            // 1. Highlight the two selected cards
            demoRound = roundSelectTwo(demoRound, aIdx, bIdx);
            renderBoard(miniEl, demoRound);

            // 2. Show the operator symbol in center after a short pause
            const t1 = setTimeout(() => {
                showOp(step.op);
            }, 350);
            timeouts.push(t1);

            // 3. Apply the operation and hide the operator
            const t2 = setTimeout(() => {
                hideOp();
                const next = roundApplyOp(demoRound, step.op);
                if (!next) { onDone(); return; }
                demoRound = next;
                idToCardIdx[step.resultId] = demoRound.cards.length - 1;
                renderBoard(miniEl, demoRound);

                const t3 = setTimeout(runStep, 500);
                timeouts.push(t3);
            }, STEP_MS);
            timeouts.push(t2);
        }

        const t0 = setTimeout(runStep, 300);
        timeouts.push(t0);
    }

    // ============================================================
    // SOLUTION MODAL  (tapped from end screen on a missed target)
    // ============================================================
    function showSolutionModal(gameScreen, n, tree, digits) {
        const expr  = treeToExpr(tree);
        const steps = treeToSteps(tree);

        const modal = document.createElement('div');
        modal.className = 'spk-solution-modal';
        modal.innerHTML = `
<div class="spk-sol-card">
  <div class="spk-sol-heading">How to make <span class="spk-sol-n">${n}</span></div>
  <div class="spk-sol-board" style="display:none">
    <div class="spk-diamond-grid">
      <div class="spk-slot spk-slot-top"></div>
      <div class="spk-slot spk-slot-left"></div>
      <div class="spk-sol-op-display"></div>
      <div class="spk-slot spk-slot-right"></div>
      <div class="spk-slot spk-slot-bottom"></div>
    </div>
  </div>
  <div class="spk-sol-expr">${expr}</div>
  <div class="spk-sol-actions">
    <button class="spk-btn spk-btn-primary spk-sol-watch">Watch</button>
    <button class="spk-btn spk-btn-ghost   spk-sol-close">Close</button>
  </div>
</div>`;

        gameScreen.appendChild(modal);

        const boardEl  = modal.querySelector('.spk-sol-board');
        const watchBtn = modal.querySelector('.spk-sol-watch');
        const closeBtn = modal.querySelector('.spk-sol-close');

        let demoTimeouts = [];
        let demoRunning  = false;

        function stopDemo() {
            demoTimeouts.forEach(clearTimeout);
            demoTimeouts    = [];
            demoRunning     = false;
            watchBtn.disabled    = false;
            watchBtn.textContent = 'Watch again';
        }

        watchBtn.addEventListener('click', () => {
            if (demoRunning) return;
            boardEl.style.display = '';
            demoRunning          = true;
            watchBtn.disabled    = true;
            watchBtn.textContent = 'Playing\u2026';
            demoTimeouts         = [];
            renderBoard(boardEl, createRound([...digits]));
            playDemoAnimation(boardEl, digits, steps, demoTimeouts, () => {
                demoRunning          = false;
                watchBtn.disabled    = false;
                watchBtn.textContent = 'Watch again';
                // Hide the board after a brief pause so user sees the final state
                const tHide = setTimeout(() => { boardEl.style.display = 'none'; }, 1200);
                demoTimeouts.push(tHide);
            });
        });

        closeBtn.addEventListener('click', () => { stopDemo(); modal.remove(); });

        modal.addEventListener('click', (e) => {
            if (!e.target.closest('.spk-sol-card')) { stopDemo(); modal.remove(); }
        });
    }

    // ============================================================
    // CONFETTI  (reuses app's #confetti container)
    // ============================================================
    function _launchConfetti() {
        const container = document.getElementById('confetti');
        if (!container) return;
        const colors = ['#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#fbbf24'];
        for (let i = 0; i < 60; i++) {
            const p = document.createElement('div');
            p.className = 'confetti';
            p.style.left            = (Math.random() * 100) + '%';
            p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            p.style.animation       = `confetti-fall ${1.5 + Math.random()}s ease-out forwards`;
            p.style.animationDelay  = (Math.random() * 0.6) + 's';
            p.style.borderRadius    = Math.random() > 0.5 ? '50%' : '2px';
            p.style.width           = (6 + Math.random() * 8) + 'px';
            p.style.height          = (6 + Math.random() * 8) + 'px';
            container.appendChild(p);
        }
        setTimeout(() => { container.innerHTML = ''; }, 3200);
    }

    // ============================================================
    // END SCREEN
    // ============================================================
    function _showEndScreen(screen, targetsList, solvedSet, solutionsByTarget, digits, puzzleNum) {
        const total     = targetsList.length;
        const solved    = solvedSet.size;
        const isPerfect = solved === total;

        // Title classification
        let heading, headingClass;
        if (isPerfect)      { heading = 'Perfect';    headingClass = 'spk-heading-perfect'; }
        else if (solved > 0) { heading = 'Time\u2019s up'; headingClass = 'spk-heading-partial'; }
        else                 { heading = 'Time\u2019s up'; headingClass = 'spk-heading-none'; }

        const chipsHTML = targetsList.map(n => {
            if (solvedSet.has(n)) {
                return `<span class="spk-chip spk-chip-found">${n}</span>`;
            }
            const hasSol = solutionsByTarget.has(n);
            return `<span class="spk-chip spk-chip-missed${hasSol ? ' spk-chip-tappable' : ''}"
                         data-missed="${n}"
                         title="${hasSol ? 'Tap to see solution' : ''}">${n}</span>`;
        }).join('');

        // Streak from main game state
        const streak = (window.gameState && window.gameState.streak) || 0;
        const dateStr = (typeof formatPuzzleDateLong === 'function') ? formatPuzzleDateLong(puzzleNum) : '';

        screen.innerHTML = `
<div class="spk-result${isPerfect ? ' spk-result-perfect' : ''}">
  <div class="spk-result-badge ${headingClass}">${heading}</div>
  ${dateStr ? `<div class="spk-result-date">${dateStr}</div>` : ''}
  <div class="spk-result-stats-row">
    <div class="spk-result-stat-item">
      <span class="spk-result-stat-value">${solved}/${total}</span>
      <span class="spk-result-stat-label">solved</span>
    </div>
    ${streak > 0 ? `<div class="spk-result-stat-item">
      <span class="spk-result-stat-value">${streak}</span>
      <span class="spk-result-stat-label">streak</span>
    </div>` : ''}
  </div>
  ${!isPerfect && solved > 0 ? '<div class="spk-result-hint">Tap a missed number to see its solution.</div>' : ''}
  <div class="spk-result-book" id="spkResultBook">${chipsHTML}</div>
  <div class="spk-result-actions">
    <button class="spk-btn spk-btn-primary" id="spkBackBtn">Close</button>
    <button class="spk-btn spk-btn-share"   id="spkShareBtn">Share</button>
  </div>
</div>`;

        // Tap missed chip → solution modal
        screen.querySelector('#spkResultBook').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-missed]');
            if (!chip) return;
            const n    = parseInt(chip.dataset.missed, 10);
            const tree = solutionsByTarget.get(n);
            if (tree) showSolutionModal(screen, n, tree, digits);
        });

        screen.querySelector('#spkShareBtn').addEventListener('click', () => {
            shareText(buildHardModeShareText(puzzleNum, solved, total));
            if (typeof gtag !== 'undefined') {
                gtag('event', 'result_shared', {
                    puzzle_num: puzzleNum,
                    is_speakeasy: true,
                    targets_solved: solved,
                    targets_total: total
                });
            }
        });
        screen.querySelector('#spkBackBtn').addEventListener('click', hideOverlay);
    }

    // ============================================================
    // CHIPS ROW RENDERER
    // ============================================================
    function renderChips(chipsRow, targetsList, solvedSet, currentIdx) {
        chipsRow.innerHTML = targetsList.map((n, i) => {
            if (solvedSet.has(n)) {
                return `<span class="spk-seq-chip spk-seq-chip-done">${n}</span>`;
            }
            if (i === currentIdx) {
                return `<span class="spk-seq-chip spk-seq-chip-active">${n}</span>`;
            }
            if (i < currentIdx) {
                // Skipped (timer ran out on this one)
                return `<span class="spk-seq-chip spk-seq-chip-missed">${n}</span>`;
            }
            return `<span class="spk-seq-chip spk-seq-chip-pending">${n}</span>`;
        }).join('');
    }

    // ============================================================
    // SEQUENCE-RUN GAME SCREEN
    // ============================================================
    function startSequenceRun(digits, targetsList, solutionsByTarget, difficultyCounts, puzzleNum, resumeState) {
        if (typeof trackEvent === 'function') {
            trackEvent('speakeasy_started', puzzleNum, true);
        }
        const totalTargets = targetsList.length;

        let solvedSet  = new Set(resumeState ? resumeState.solvedList : []);
        let currentIdx = resumeState ? resumeState.currentIdx : 0;
        let round      = createRound([...digits]);
        let timerStart = null;
        let rafId      = null;
        let finished   = false;
        let fbTimer    = null;
        let totalElapsedBefore = resumeState ? resumeState.elapsedMs : 0;

        // Skip already-completed indices at start
        while (currentIdx < totalTargets && solvedSet.has(targetsList[currentIdx])) {
            currentIdx++;
        }

        if (currentIdx >= totalTargets || solvedSet.size === totalTargets) {
            // All done already (edge case from resume)
            finished = true;
            clearGameState();
            showOverlay((el) => {
                el.innerHTML = '<div class="spk-game-screen"></div>';
                const screen = el.querySelector('.spk-game-screen');
                _showEndScreen(screen, targetsList, solvedSet, solutionsByTarget, digits, puzzleNum);
            });
            return;
        }

        showOverlay((el) => {
            const currentTarget = targetsList[currentIdx];
            const stars = difficultyStars(difficultyCounts.get(currentTarget) || 0);
            const starsStr = '\u2605'.repeat(stars) + '\u2606'.repeat(3 - stars);

            el.innerHTML = `
<div class="spk-game-screen">
  <div class="spk-topbar">
    <button class="spk-back-btn" aria-label="Exit Hard Mode">&#8249;</button>
    <span class="spk-badge">HARD MODE</span>
    <div class="spk-topbar-right">
      <span class="spk-stars" id="spkStars">${starsStr}</span>
      <span class="spk-topbar-progress" id="spkProgress">${solvedSet.size}/${totalTargets}</span>
    </div>
  </div>
  <div class="spk-target-row">
    <span class="spk-target-label">Make</span>
    <span class="spk-target-number" id="spkTargetNum">${currentTarget}</span>
  </div>
  <div class="spk-timer-bar-track">
    <div class="spk-timer-bar-fill" id="spkTimerFill"></div>
  </div>
  <div class="spk-arena" id="spkArena">
    <div class="spk-diamond-grid">
      <div class="spk-slot spk-slot-top"></div>
      <div class="spk-slot spk-slot-left"></div>
      <div class="spk-slot spk-slot-right"></div>
      <div class="spk-slot spk-slot-bottom"></div>
    </div>
    <div class="spk-undo-row">
      <button class="spk-undo-btn" style="visibility:hidden" data-action="undo">&#8630; Undo</button>
    </div>
    <div class="spk-inline-fb" id="spkFb"></div>
    <div class="spk-op-overlay">
      <div class="operators-grid">
        <button class="op-btn" data-op="+">+</button>
        <button class="op-btn" data-op="-">&#8722;</button>
        <button class="op-btn" data-op="*">&times;</button>
        <button class="op-btn" data-op="/">&divide;</button>
      </div>
    </div>
  </div>
  <div class="spk-chips-row" id="spkChips"></div>
</div>`;

            const gameScreen  = el.querySelector('.spk-game-screen');
            const targetNumEl = el.querySelector('#spkTargetNum');
            const timerFillEl = el.querySelector('#spkTimerFill');
            const chipsRow    = el.querySelector('#spkChips');
            const progressEl  = el.querySelector('#spkProgress');
            const starsEl     = el.querySelector('#spkStars');
            const fbEl        = el.querySelector('#spkFb');

            renderChips(chipsRow, targetsList, solvedSet, currentIdx);

            el.querySelector('.spk-back-btn').addEventListener('click', () => {
                finished = true;
                cancelAnimationFrame(rafId);
                clearTimeout(fbTimer);
                if (_removeKbHandler) _removeKbHandler();
                if (window.currentPuzzle) window.currentPuzzle.isSpeakeasy = false;
                // Save mid-game state
                const elapsed = totalElapsedBefore + (timerStart ? Date.now() - timerStart : 0);
                saveGameState(puzzleNum, targetsList, [...solvedSet], currentIdx, elapsed);
                hideOverlay();
            });

            function showFb(msg, cls) {
                if (fbTimer) clearTimeout(fbTimer);
                fbEl.textContent = msg;
                fbEl.className   = 'spk-inline-fb spk-fb-' + cls + ' spk-fb-show';
                fbTimer = setTimeout(() => fbEl.classList.remove('spk-fb-show'), 900);
            }

            function advanceTarget() {
                currentIdx++;
                // Skip any already-solved
                while (currentIdx < totalTargets && solvedSet.has(targetsList[currentIdx])) {
                    currentIdx++;
                }

                if (currentIdx >= totalTargets || solvedSet.size === totalTargets) {
                    // Game complete!
                    finishGame(true);
                    return;
                }

                // Update UI for new target
                const newTarget = targetsList[currentIdx];
                targetNumEl.textContent = newTarget;
                progressEl.textContent = `${solvedSet.size}/${totalTargets}`;
                const s = difficultyStars(difficultyCounts.get(newTarget) || 0);
                starsEl.textContent = '\u2605'.repeat(s) + '\u2606'.repeat(3 - s);
                renderChips(chipsRow, targetsList, solvedSet, currentIdx);

                // Reset timer for new target
                totalElapsedBefore += (Date.now() - timerStart);
                timerStart = Date.now();

                // Reset board — must update both _round and round
                _round = createRound([...digits]);
                round  = _round;
                renderBoard(el, round);
            }

            function finishGame(completed) {
                finished = true;
                cancelAnimationFrame(rafId);
                clearTimeout(fbTimer);
                if (_removeKbHandler) _removeKbHandler();
                clearGameState();
                if (window.currentPuzzle) window.currentPuzzle.isSpeakeasy = false;

                const totalElapsed = totalElapsedBefore + (timerStart ? Date.now() - timerStart : 0);
                const totalTimeSec = Math.round(totalElapsed / 1000);

                // Sync to Supabase
                syncToSupabase(puzzleNum, targetsList, [...solvedSet], totalTimeSec);

                // GA event
                if (typeof gtag !== 'undefined') {
                    gtag('event', 'puzzle_solved', {
                        puzzle_num: puzzleNum,
                        is_speakeasy: true,
                        targets_solved: solvedSet.size,
                        targets_total: totalTargets,
                        solve_time: totalTimeSec,
                        is_perfect: solvedSet.size === totalTargets
                    });
                }

                if (solvedSet.size === totalTargets) {
                    _launchConfetti();
                    setTimeout(() => {
                        _showEndScreen(gameScreen, targetsList, solvedSet, solutionsByTarget, digits, puzzleNum);
                    }, 1200);
                } else {
                    _showEndScreen(gameScreen, targetsList, solvedSet, solutionsByTarget, digits, puzzleNum);
                }
            }

            let _round = round;
            wireArena(
                el,
                () => _round,
                (r) => { _round = r; round = r; },
                (resolved) => {
                    if (finished) return;
                    const val = roundGetValue(resolved);
                    const currentTarget = targetsList[currentIdx];

                    if (val !== null && Number.isInteger(val) && val === currentTarget) {
                        // Correct! Mark as solved
                        solvedSet.add(val);
                        showFb('\u2713 ' + val, 'new');
                        progressEl.textContent = `${solvedSet.size}/${totalTargets}`;
                        renderChips(chipsRow, targetsList, solvedSet, currentIdx);

                        // Save state
                        const elapsed = totalElapsedBefore + (Date.now() - timerStart);
                        saveGameState(puzzleNum, targetsList, [...solvedSet], currentIdx, elapsed);

                        // After brief delay, advance to next
                        setTimeout(() => {
                            if (finished) return;
                            advanceTarget();
                        }, RESET_MS);
                    } else if (val !== null && Number.isInteger(val) && solutionsByTarget.has(val) && val !== currentTarget) {
                        // Valid target but not the current one
                        showFb('Need ' + currentTarget + ', not ' + val, 'dupe');
                        setTimeout(() => {
                            if (finished) return;
                            _round = createRound([...digits]);
                            round  = _round;
                            renderBoard(el, _round);
                        }, RESET_MS);
                    } else if (val !== null && !Number.isInteger(val)) {
                        showFb('Not an integer', 'bad');
                        setTimeout(() => {
                            if (finished) return;
                            _round = createRound([...digits]);
                            round  = _round;
                            renderBoard(el, _round);
                        }, RESET_MS);
                    } else {
                        // Wrong value
                        showFb(val + ' \u2260 ' + currentTarget, 'bad');
                        setTimeout(() => {
                            if (finished) return;
                            _round = createRound([...digits]);
                            round  = _round;
                            renderBoard(el, _round);
                        }, RESET_MS);
                    }
                }
            );

            // ── Keyboard shortcuts (mirrors app.js keyboard handler) ──
            let spkKeyBuffer = '';
            let spkKeyTimeout = null;

            function spkClearBuffer() {
                spkKeyBuffer = '';
                if (spkKeyTimeout) { clearTimeout(spkKeyTimeout); spkKeyTimeout = null; }
            }

            function spkGetActiveTiles() {
                return _round.cards.filter(c => !c.used);
            }

            function spkFindCardIndex(value) {
                for (let i = 0; i < _round.cards.length; i++) {
                    if (!_round.cards[i].used && _round.cards[i].value === value && !_round.selected.includes(i)) return i;
                }
                for (let i = 0; i < _round.cards.length; i++) {
                    if (!_round.cards[i].used && _round.cards[i].value === value) return i;
                }
                return -1;
            }

            function spkCommitBuffer() {
                spkKeyTimeout = null;
                const num = parseInt(spkKeyBuffer, 10);
                spkKeyBuffer = '';
                if (isNaN(num)) return;
                const idx = spkFindCardIndex(num);
                if (idx !== -1) {
                    _round = roundSelectCard(_round, idx);
                    round = _round;
                    renderBoard(el, _round);
                    if (_round.selected.length === 2) {
                        // Show operators overlay
                        const opOverlay = el.querySelector('.spk-op-overlay');
                        if (opOverlay) opOverlay.classList.add('spk-op-show');
                    }
                }
            }

            function spkHandleKeydown(e) {
                if (finished) return;
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                // Check for solution modal open
                if (el.querySelector('.spk-solution-modal')) return;

                const key = e.key;

                // Digit keys
                if (key >= '0' && key <= '9') {
                    e.preventDefault();
                    spkKeyBuffer += key;
                    if (spkKeyTimeout) { clearTimeout(spkKeyTimeout); spkKeyTimeout = null; }

                    const activeTiles = spkGetActiveTiles();
                    const num = parseInt(spkKeyBuffer, 10);
                    const hasExact = activeTiles.some(t => t.value === num);
                    const hasLonger = activeTiles.some(t => {
                        const vs = String(t.value);
                        return vs.startsWith(spkKeyBuffer) && vs.length > spkKeyBuffer.length;
                    });

                    if (hasExact && !hasLonger) {
                        spkKeyBuffer = '';
                        const idx = spkFindCardIndex(num);
                        if (idx !== -1) {
                            _round = roundSelectCard(_round, idx);
                            round = _round;
                            renderBoard(el, _round);
                            if (_round.selected.length === 2) {
                                const opOverlay = el.querySelector('.spk-op-overlay');
                                if (opOverlay) opOverlay.classList.add('spk-op-show');
                            }
                        }
                    } else if (hasExact || hasLonger) {
                        spkKeyTimeout = setTimeout(spkCommitBuffer, 600);
                    } else {
                        spkKeyBuffer = '';
                    }
                    return;
                }

                // Operator keys
                const opMap = { '+': '+', '-': '-', '*': '*', 'x': '*', 'X': '*', '/': '/' };
                if (opMap[key]) {
                    e.preventDefault();
                    if (spkKeyBuffer) { if (spkKeyTimeout) clearTimeout(spkKeyTimeout); spkCommitBuffer(); }
                    if (_round.selected.length === 2) {
                        const next = roundApplyOp(_round, opMap[key]);
                        if (next) {
                            _round = next;
                            round = _round;
                            renderBoard(el, _round);
                            if (roundRemaining(next).length === 1) {
                                // Trigger resolve check (same as wireArena op handler)
                                const val = roundGetValue(next);
                                const currentTarget = targetsList[currentIdx];
                                if (val !== null && Number.isInteger(val) && val === currentTarget) {
                                    solvedSet.add(val);
                                    showFb('\u2713 ' + val, 'new');
                                    progressEl.textContent = `${solvedSet.size}/${totalTargets}`;
                                    renderChips(chipsRow, targetsList, solvedSet, currentIdx);
                                    const elapsed = totalElapsedBefore + (Date.now() - timerStart);
                                    saveGameState(puzzleNum, targetsList, [...solvedSet], currentIdx, elapsed);
                                    setTimeout(() => { if (!finished) advanceTarget(); }, RESET_MS);
                                } else if (val !== null && Number.isInteger(val) && solutionsByTarget.has(val) && val !== currentTarget) {
                                    showFb('Need ' + currentTarget + ', not ' + val, 'dupe');
                                    setTimeout(() => { if (!finished) { _round = createRound([...digits]); round = _round; renderBoard(el, _round); } }, RESET_MS);
                                } else if (val !== null && !Number.isInteger(val)) {
                                    showFb('Not an integer', 'bad');
                                    setTimeout(() => { if (!finished) { _round = createRound([...digits]); round = _round; renderBoard(el, _round); } }, RESET_MS);
                                } else {
                                    showFb(val + ' \u2260 ' + currentTarget, 'bad');
                                    setTimeout(() => { if (!finished) { _round = createRound([...digits]); round = _round; renderBoard(el, _round); } }, RESET_MS);
                                }
                            }
                        }
                    }
                    return;
                }

                // Undo
                if (key === 'Backspace' || key === 'z' || key === 'Z') {
                    e.preventDefault();
                    spkClearBuffer();
                    _round = roundUndo(_round);
                    round = _round;
                    renderBoard(el, _round);
                    return;
                }

                // Escape — deselect
                if (key === 'Escape') {
                    spkClearBuffer();
                    _round = { ..._round, selected: [] };
                    round = _round;
                    renderBoard(el, _round);
                    return;
                }
            }

            document.addEventListener('keydown', spkHandleKeydown);

            // Store cleanup ref so finishGame / back can remove it
            const _removeKbHandler = () => {
                document.removeEventListener('keydown', spkHandleKeydown);
                spkClearBuffer();
            };

            // Render initial board and start timer
            requestAnimationFrame(() => {
                renderBoard(el, round);
                timerStart = Date.now();
                rafId = requestAnimationFrame(tick);
            });

            function tick() {
                if (finished) return;
                const elapsed   = Date.now() - timerStart;
                const targetMs  = SECONDS_PER_TARGET * 1000;
                const remaining = targetMs - elapsed;
                const pct       = Math.max(0, remaining / targetMs);

                // Update timer bar
                timerFillEl.style.transform = `scaleX(${pct.toFixed(4)})`;

                // Color transitions
                timerFillEl.classList.toggle('spk-timer-warn', remaining < 15000 && remaining >= 5000);
                timerFillEl.classList.toggle('spk-timer-danger', remaining < 5000);

                if (remaining <= 0) {
                    // Time's up for this target — skip to next
                    renderChips(chipsRow, targetsList, solvedSet, currentIdx);

                    currentIdx++;
                    while (currentIdx < totalTargets && solvedSet.has(targetsList[currentIdx])) {
                        currentIdx++;
                    }

                    if (currentIdx >= totalTargets) {
                        finishGame(false);
                        return;
                    }

                    // Update UI for new target
                    const newTarget = targetsList[currentIdx];
                    targetNumEl.textContent = newTarget;
                    progressEl.textContent = `${solvedSet.size}/${totalTargets}`;
                    const s = difficultyStars(difficultyCounts.get(newTarget) || 0);
                    starsEl.textContent = '\u2605'.repeat(s) + '\u2606'.repeat(3 - s);
                    renderChips(chipsRow, targetsList, solvedSet, currentIdx);

                    // Reset timer
                    totalElapsedBefore += targetMs;
                    timerStart = Date.now();

                    // Reset board
                    _round = createRound([...digits]);
                    round  = _round;
                    renderBoard(el, _round);

                    // Reset timer bar visuals
                    timerFillEl.classList.remove('spk-timer-warn', 'spk-timer-danger');
                    timerFillEl.style.transform = 'scaleX(1)';
                }

                rafId = requestAnimationFrame(tick);
            }
        });
    }

    // ============================================================
    // LAUNCH  (direct entry — no selection screen)
    // ============================================================
    function launchAfterHours() {
        if (!canEnterAfterHoursToday()) {
            showPaywallModal();
            return;
        }
        if (HARD_MODE_PAYWALL_ENABLED && !isUnlocked()) addTrialDay(getLocalDayKey());

        // Use the currently-active puzzle when available (supports archive play).
        // window.currentPuzzle is the module-level variable in app.js.
        const activePuzzle = (window.currentPuzzle && window.currentPuzzle.puzzleNum > 0)
            ? window.currentPuzzle : null;
        if (activePuzzle) activePuzzle.isSpeakeasy = true;
        const puzzleNum = activePuzzle ? activePuzzle.puzzleNum : getTodayPuzzleNum();
        const digits    = (activePuzzle && activePuzzle.numbers && activePuzzle.numbers.length === 4)
            ? [...activePuzzle.numbers]
            : getTodayDigits();

        const solutionsByTarget = computeSolutions(digits, ORDER_MIN, ORDER_MAX);
        const difficultyCounts  = computeDifficulty(digits, ORDER_MIN, ORDER_MAX);
        const allTargets        = [...solutionsByTarget.keys()];
        const targetsList       = sortByDifficulty(allTargets, difficultyCounts);

        console.log(`[HardMode] puzzle #${puzzleNum} digits: ${digits.join(',')} \u2192 ${targetsList.length} targets in [${ORDER_MIN}..${ORDER_MAX}]:`, targetsList);

        if (targetsList.length === 0) {
            showOverlay((el) => {
                el.classList.add('spk-overlay-center');
                el.innerHTML = `
<div class="spk-intro-card">
  <div class="spk-intro-title">No targets</div>
  <div class="spk-intro-body">No achievable targets for today\u2019s digits.</div>
  <button class="spk-btn spk-btn-ghost spk-intro-close">Close</button>
</div>`;
                el.querySelector('.spk-intro-close').addEventListener('click', hideOverlay);
                el.addEventListener('click', (e) => { if (e.target === el) hideOverlay(); });
            });
            return;
        }

        // Check for resumable in-progress state for this specific puzzle
        const saved = loadGameState();
        if (saved && saved.puzzleNum === puzzleNum) {
            startSequenceRun(digits, saved.targetsList, solutionsByTarget, difficultyCounts, puzzleNum, saved);
            return;
        }

        const introSeen = localStorage.getItem(INTRO_KEY) === '1';
        if (!introSeen) {
            showIntro(targetsList.length, () =>
                startSequenceRun(digits, targetsList, solutionsByTarget, difficultyCounts, puzzleNum, null));
        } else {
            startSequenceRun(digits, targetsList, solutionsByTarget, difficultyCounts, puzzleNum, null);
        }
    }

    // ============================================================
    // LICENSE KEY VALIDATION  (Lemon Squeezy)
    // ============================================================
    async function validateLicenseKey(key) {
        if (_devMode && key === 'TEST-KEY-1234') return true;

        const body    = `license_key=${encodeURIComponent(key)}`;
        const headers = { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };

        async function tryUrl(url) {
            const res  = await fetch(url, { method: 'POST', headers, body });
            const data = await res.json();
            if (!data.valid) return false;
            if (LEMONSQUEEZY_PRODUCT_ID && data.meta?.product_id !== LEMONSQUEEZY_PRODUCT_ID) return false;
            return true;
        }

        try {
            return await tryUrl('https://api.lemonsqueezy.com/v1/licenses/validate');
        } catch (err) {
            if (err instanceof TypeError) {
                return await tryUrl('/api/ls/validate');
            }
            throw err;
        }
    }

    // ============================================================
    // PAYWALL MODAL
    // ============================================================
    function showPaywallModal() {
        const status = afterHoursStatus();
        showOverlay((el) => {
            el.classList.add('spk-overlay-center');
            el.innerHTML = `
<div class="spk-intro-card">
  <div class="spk-intro-icon">\uD83D\uDD11</div>
  <div class="spk-intro-title">Hard Mode</div>
  <div class="spk-intro-body">You\u2019ve had a ${status.max}-day preview. Support Make24 to keep Hard Mode.</div>
  <div class="spk-paywall-actions">
    <button class="spk-btn spk-btn-primary spk-paywall-support">Support $${SUPPORT_PRICE_USD}</button>
    <button class="spk-btn spk-btn-ghost   spk-paywall-code">Enter code</button>
    <button class="spk-btn spk-paywall-dismiss">Not now</button>
  </div>
</div>`;

            el.querySelector('.spk-paywall-support').addEventListener('click', () => {
                window.open(LEMONSQUEEZY_CHECKOUT_URL, '_blank', 'noopener');
            });
            el.querySelector('.spk-paywall-code').addEventListener('click', () => {
                hideOverlay();
                showLicenseEntryModal();
            });
            el.querySelector('.spk-paywall-dismiss').addEventListener('click', hideOverlay);
            el.addEventListener('click', (e) => { if (e.target === el) hideOverlay(); });
        });
    }

    // ============================================================
    // LICENSE ENTRY MODAL
    // ============================================================
    function showLicenseEntryModal(prefillKey) {
        showOverlay((el) => {
            el.classList.add('spk-overlay-center');
            el.innerHTML = `
<div class="spk-intro-card">
  <div class="spk-intro-title">Enter your code</div>
  <input class="spk-license-input" id="spkLicenseInput" type="text"
         placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false">
  <div class="spk-license-status" id="spkLicenseStatus"></div>
  <div class="spk-paywall-actions">
    <button class="spk-btn spk-btn-primary spk-license-submit">Unlock</button>
    <button class="spk-btn spk-btn-ghost   spk-license-back">Back</button>
  </div>
</div>`;

            const input  = el.querySelector('#spkLicenseInput');
            const status = el.querySelector('#spkLicenseStatus');
            const submit = el.querySelector('.spk-license-submit');

            if (prefillKey) input.value = prefillKey;
            setTimeout(() => input.focus(), 80);

            async function attemptUnlock() {
                const key = input.value.trim();
                if (!key) { input.focus(); return; }
                submit.disabled    = true;
                status.textContent = 'Checking\u2026';
                status.className   = 'spk-license-status';
                try {
                    const valid = await validateLicenseKey(key);
                    if (valid) {
                        localStorage.setItem(UNLOCKED_KEY,    '1');
                        localStorage.setItem(LICENSE_KEY_KEY, key);
                        status.textContent = '\u2713 Unlocked!';
                        status.classList.add('spk-status-ok');
                        setTimeout(() => { hideOverlay(); launchAfterHours(); }, 900);
                    } else {
                        status.textContent = 'Invalid code \u2014 check and try again.';
                        status.classList.add('spk-status-err');
                        submit.disabled = false;
                    }
                } catch (e) {
                    console.error('[Speakeasy] license validation failed:', e);
                    status.textContent = 'Network error \u2014 check your connection.';
                    status.classList.add('spk-status-err');
                    submit.disabled = false;
                }
            }

            submit.addEventListener('click', attemptUnlock);
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptUnlock(); });
            el.querySelector('.spk-license-back').addEventListener('click', () => {
                hideOverlay();
                showPaywallModal();
            });
            el.addEventListener('click', (e) => { if (e.target === el) hideOverlay(); });
        });
    }

    // ============================================================
    // SETTINGS — AFTER HOURS SECTION
    // ============================================================
    function renderSettingsAhSection() {
        const container = document.getElementById('settingsAhSection');
        if (!container) return;

        const s = afterHoursStatus();

        let ahHTML = '';
        if (HARD_MODE_PAYWALL_ENABLED && (s.unlocked || s.used > 0)) {
            const statusLine = s.unlocked
                ? 'Hard Mode: <strong>Unlocked \u2713</strong>'
                : `Hard Mode: Preview (${s.used}/${s.max} days used)`;
            ahHTML = `
<div class="settings-section-title">Hard Mode</div>
<div class="spk-settings-ah">
  <p class="spk-settings-ah-status">${statusLine}</p>
  ${!s.unlocked ? `
  <div class="spk-settings-ah-btns">
    <button class="email-send-btn" id="spkSettingsSupportBtn">Support $${SUPPORT_PRICE_USD}</button>
    <button class="otp-verify-btn" id="spkSettingsCodeBtn">Enter code</button>
  </div>` : ''}
</div>`;
        }

        const supportHTML = (SUPPORT_ENABLED && SUPPORT_URL) ? `
<div class="spk-settings-support-row">
  <button class="email-send-btn spk-settings-support-btn">${SUPPORT_LABEL}</button>
</div>` : '';

        const feedbackHTML = `
<div class="settings-section-title">Feedback</div>
<div class="spk-settings-feedback-row">
  <button class="email-send-btn" id="spkFeedbackBtn">Send feedback</button>
</div>`;

        container.innerHTML = ahHTML + supportHTML + feedbackHTML;

        if (HARD_MODE_PAYWALL_ENABLED && !s.unlocked && s.used > 0) {
            container.querySelector('#spkSettingsSupportBtn')?.addEventListener('click', () => {
                document.getElementById('settingsModal')?.classList.remove('show');
                window.open(LEMONSQUEEZY_CHECKOUT_URL, '_blank', 'noopener');
            });
            container.querySelector('#spkSettingsCodeBtn')?.addEventListener('click', () => {
                document.getElementById('settingsModal')?.classList.remove('show');
                showLicenseEntryModal();
            });
        }

        if (SUPPORT_ENABLED && SUPPORT_URL) {
            container.querySelector('.spk-settings-support-btn')?.addEventListener('click', () => {
                window.open(SUPPORT_URL, '_blank', 'noopener');
            });
        }

        container.querySelector('#spkFeedbackBtn').addEventListener('click', () => {
            document.getElementById('settingsModal')?.classList.remove('show');
            showFeedbackModal();
        });
    }

    // ============================================================
    // DEV HARNESS
    // ============================================================
    function showDevPanel() {
        if (!_devMode) return;
        if (document.getElementById('spkDevPanel')) return;

        const panel = document.createElement('div');
        panel.id        = 'spkDevPanel';
        panel.className = 'spk-dev-panel';
        panel.innerHTML = `
<div class="spk-dev-title">\u2699 Hard Mode Dev</div>
<button id="devSolve">Simulate daily solve</button>
<button id="devTrialReset">Reset trial (0 days)</button>
<button id="devTrialFull">Exhaust trial (3 days)</button>
<button id="devToggleUnlock">Toggle unlock</button>
<button id="devResetSpeakeasy">Reset speakeasy state</button>
<div class="spk-dev-meta">
  Checkout: ${LEMONSQUEEZY_CHECKOUT_URL}<br>
  Product ID: ${LEMONSQUEEZY_PRODUCT_ID}<br>
  Test code: <b>TEST-KEY-1234</b>
</div>`;
        document.body.appendChild(panel);

        panel.querySelector('#devSolve').addEventListener('click', () => {
            try {
                const saved = JSON.parse(localStorage.getItem('make24_v5') || '{}');
                const today = getTodayPuzzleNum();
                if (!saved.history) saved.history = {};
                saved.history[today] = Object.assign(
                    { moves: 3, solveTime: 30, undos: 0 },
                    saved.history[today] || {},
                    { completed: true }
                );
                localStorage.setItem('make24_v5', JSON.stringify(saved));
            } catch (e) { console.error('[Speakeasy] dev solve inject failed:', e); }
            location.reload();
        });
        panel.querySelector('#devTrialReset').addEventListener('click', () => {
            localStorage.removeItem(TRIAL_DAYS_KEY);
            location.reload();
        });
        panel.querySelector('#devTrialFull').addEventListener('click', () => {
            localStorage.setItem(TRIAL_DAYS_KEY,
                JSON.stringify(['2020-01-01', '2020-01-02', '2020-01-03']));
            location.reload();
        });
        panel.querySelector('#devToggleUnlock').addEventListener('click', () => {
            if (localStorage.getItem(UNLOCKED_KEY) === '1') {
                localStorage.removeItem(UNLOCKED_KEY);
            } else {
                localStorage.setItem(UNLOCKED_KEY, '1');
            }
            location.reload();
        });
        panel.querySelector('#devResetSpeakeasy').addEventListener('click', () => {
            localStorage.removeItem(STATE_KEY);
            location.reload();
        });
    }

    // ============================================================
    // FEEDBACK MODAL
    // ============================================================
    function showFeedbackModal() {
        showOverlay((el) => {
            el.classList.add('spk-overlay-center');
            el.innerHTML = `
<div class="spk-intro-card spk-feedback-card">
  <div class="spk-intro-title">Send feedback</div>
  <textarea class="spk-feedback-textarea" id="spkFeedbackText"
            placeholder="What\u2019s confusing? Bugs? Ideas?" rows="5"></textarea>
  <input class="spk-feedback-email" id="spkFeedbackEmail" type="email"
         placeholder="Your email (optional, for a reply)" autocomplete="email">
  <div class="spk-paywall-actions">
    <button class="spk-btn spk-btn-primary spk-feedback-send">Send</button>
    <button class="spk-btn spk-btn-ghost   spk-feedback-copy">Copy</button>
    <button class="spk-btn spk-paywall-dismiss spk-feedback-close">Close</button>
  </div>
</div>`;

            const textarea = el.querySelector('#spkFeedbackText');
            const emailEl  = el.querySelector('#spkFeedbackEmail');
            setTimeout(() => textarea.focus(), 80);

            function buildBody() {
                const msg   = textarea.value.trim();
                const reply = emailEl.value.trim();
                const day   = getLocalDayKey();
                const ua  = navigator.userAgent.slice(0, 120);
                const res = `${screen.width}x${screen.height}@${window.devicePixelRatio}x`;
                const parts = [msg];
                if (reply) parts.push(`\nReply to: ${reply}`);
                parts.push(`\n---\nDay: ${day}\nScreen: ${res}\nUA: ${ua}`);
                return parts.join('\n');
            }

            el.querySelector('.spk-feedback-send').addEventListener('click', () => {
                const body    = buildBody();
                const subject = encodeURIComponent('Make24 feedback');
                const enc     = encodeURIComponent(body);
                window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${enc}`;
            });

            el.querySelector('.spk-feedback-copy').addEventListener('click', () => {
                const text = buildBody();
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text).then(
                        () => { if (window.showToast) window.showToast('Copied!'); },
                        () => _fallbackCopy(text)
                    );
                } else {
                    _fallbackCopy(text);
                }
            });

            el.querySelector('.spk-feedback-close').addEventListener('click', hideOverlay);
            el.addEventListener('click', (e) => { if (e.target === el) hideOverlay(); });
        });
    }

    function _fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value    = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
        if (window.showToast) window.showToast('Copied!');
    }

    // ============================================================
    // KEY INJECTION + "HARD MODE" BUTTON
    // ============================================================

    // "🔑 Hard Mode" button injected into victory actions
    function injectTrySpeakeasyButton() {
        if (!isTodaySolved()) return;
        const actionsEl = document.querySelector('.victory-actions');
        if (!actionsEl) return;
        if (document.getElementById('spkTryBtn')) return;

        const btn = document.createElement('button');
        btn.id        = 'spkTryBtn';
        btn.className = 'btn btn-hardmode';
        const icon = document.createElement('span');
        icon.className = 'btn-hardmode-icon';
        icon.textContent = '\uD83D\uDD11';
        icon.setAttribute('aria-hidden', 'true');
        btn.appendChild(icon);
        const label = document.createElement('span');
        label.textContent = 'Hard Mode';
        btn.appendChild(label);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            launchAfterHours();
        });
        actionsEl.appendChild(btn);
    }

    // Placement A: header top-bar, inserted after #streakDisplay
    function injectTopbarKey() {
        if (!isTodaySolved()) return;
        if (document.getElementById('spkTopbarKeyBtn')) return;
        const streakEl = document.getElementById('streakDisplay');
        if (!streakEl) return;

        const btn = document.createElement('button');
        btn.id        = 'spkTopbarKeyBtn';
        btn.className = 'spk-key-topbar';
        btn.setAttribute('aria-label', 'Hard Mode');
        btn.setAttribute('title', 'Hard Mode');
        btn.textContent = '\uD83D\uDD11';
        btn.addEventListener('click', launchAfterHours);
        streakEl.insertAdjacentElement('afterend', btn);
    }

    // ============================================================
    // OBSERVER  (watches #victoryBackdrop — zero changes to app.js)
    // ============================================================
    function observeVictoryCard() {
        const backdrop = document.getElementById('victoryBackdrop');
        if (!backdrop) return;
        let wasVisible = false;
        const obs = new MutationObserver(() => {
            const visible = backdrop.classList.contains('show');
            if (visible && !wasVisible) {
                wasVisible = true;
                injectTrySpeakeasyButton();
                injectTopbarKey();
            }
            if (!visible && wasVisible) {
                wasVisible = false;
                const t = document.getElementById('spkTryBtn');
                if (t) t.remove();
            }
        });
        obs.observe(backdrop, { attributes: true, attributeFilter: ['class'] });
    }

    // ============================================================
    // INIT
    // ============================================================
    async function init() {
        refreshAuthState().catch(() => {});

        const setup = () => {
            observeVictoryCard();
            injectTopbarKey();

            const settingsModal = document.getElementById('settingsModal');
            if (settingsModal) {
                new MutationObserver(() => {
                    if (settingsModal.classList.contains('show')) renderSettingsAhSection();
                }).observe(settingsModal, { attributes: true, attributeFilter: ['class'] });
            }

            // Auto-fill license key from URL
            const qp      = new URLSearchParams(window.location.search);
            const hashKey = (window.location.hash.match(/[#&]key=([^&]+)/) || [])[1];
            const urlKey  = qp.get('license_key') || (hashKey ? decodeURIComponent(hashKey) : null);
            if (urlKey && !isUnlocked()) {
                setTimeout(() => showLicenseEntryModal(urlKey), 600);
            }

            showDevPanel();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup);
        } else {
            setup();
        }
    }

    init();
})();
