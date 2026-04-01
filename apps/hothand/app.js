/**
 * app.js — Hot Hand standalone game
 *
 * One fixed hand. Many targets. Beat the clock.
 *
 * Extracted from make24/speakeasy/speakeasy.js and adapted for
 * standalone use. No dependency on make24/app.js at runtime.
 *
 * Sections:
 *   1. Constants
 *   2. Puzzle engine  (puzzle numbers, digits)
 *   3. Rational arithmetic + solver
 *   4. Difficulty scoring
 *   5. Expression rendering
 *   6. Round engine  (pure functions)
 *   7. Board renderer
 *   8. Arena wiring
 *   9. State persistence
 *  10. Supabase sync
 *  11. Confetti + Toast
 *  12. Solution modal + demo animation
 *  13. End screen
 *  14. Intro screen
 *  15. Game loop
 *  16. Calendar / archive
 *  17. Lobby
 *  18. Keyboard handler
 *  19. Init
 */

'use strict';

// ============================================================
// 1. CONSTANTS
// ============================================================
const ORDER_MIN          = 1;
const ORDER_MAX          = 24;
const SECONDS_PER_TARGET = 40;
const RESET_MS           = 600;  // delay after board resolves before advancing
const STEP_MS            = 700;  // demo animation step delay

const EPOCH_DATE            = '2025-01-01T00:00:00Z';
const PUZZLE_SEED_MULT      = 12345;

const STORAGE_HISTORY  = 'hothand_history';   // { [puzzleNum]: { solved, total, timeSec } }
const STORAGE_RUN      = 'hothand_run';        // in-progress run state
const STORAGE_INTRO    = 'hothand_intro_seen'; // '1' once seen
const DEVICE_ID_KEY    = 'hothand_device_id_' + window.location.hostname;

const SLOT_CLASSES = ['hh-slot-top', 'hh-slot-left', 'hh-slot-right', 'hh-slot-bottom'];
const OP_STR       = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };

// ============================================================
// 2. PUZZLE ENGINE
// ============================================================
const VALID_PUZZLES = [[5,6,7,9],[1,6,8,9],[4,8,9,9],[1,5,8,9],[2,3,4,7],[1,7,8,8],[3,6,7,8],[4,6,6,7],[2,5,6,7],[1,3,3,4],[1,4,4,6],[1,1,6,9],[2,4,6,9],[1,5,6,7],[1,3,4,4],[1,1,5,8],[1,3,7,8],[2,4,4,6],[3,3,4,4],[2,3,5,8],[2,3,4,4],[1,1,3,4],[3,4,6,8],[1,3,8,8],[6,8,8,9],[6,6,6,6],[4,6,6,9],[4,5,5,8],[1,5,7,8],[1,1,6,6],[2,6,6,6],[1,4,8,8],[4,4,4,6],[1,2,6,9],[2,4,4,7],[5,5,9,9],[1,4,5,9],[5,5,5,6],[1,2,4,5],[2,2,2,7],[3,5,7,8],[2,5,5,8],[1,2,3,8],[3,4,5,7],[5,7,8,9],[1,4,6,8],[1,3,3,6],[2,2,2,9],[3,3,7,9],[3,3,6,7],[1,3,4,8],[1,1,4,4],[1,4,4,9],[2,2,3,4],[1,4,5,6],[1,2,5,9],[1,1,1,8],[2,3,3,9],[3,4,9,9],[2,5,8,9],[4,4,6,9],[2,2,7,8],[4,5,5,7],[3,6,6,6],[1,2,6,8],[2,6,6,7],[2,6,6,8],[1,2,5,6],[2,6,7,8],[2,4,6,7],[3,3,3,4],[5,5,5,9],[3,8,9,9],[3,4,4,7],[2,2,4,7],[3,7,7,8],[3,3,3,6],[3,6,7,9],[4,6,6,6],[1,2,6,7],[1,1,4,8],[3,4,6,9],[2,3,9,9],[2,2,3,8],[5,5,8,8],[1,1,8,8],[2,2,5,9],[3,3,3,9],[3,7,7,7],[3,3,6,8],[5,5,8,9],[4,6,9,9],[1,4,4,5],[4,4,5,5],[6,6,6,8],[3,7,8,8],[3,9,9,9],[2,5,6,8],[3,3,4,6],[6,6,7,9],[2,4,5,5],[1,5,8,8],[1,1,3,8],[2,2,3,5],[1,3,5,6],[1,6,6,8],[1,4,5,7],[2,4,5,8],[1,2,2,6],[2,4,7,7],[2,2,3,9],[3,3,3,5],[1,5,6,9],[2,2,5,6],[1,4,5,5],[2,8,9,9],[5,6,6,9],[3,5,8,9],[1,4,6,9],[2,5,7,8],[3,6,8,8],[4,5,5,9],[1,2,3,5],[3,4,7,9],[5,5,6,7],[2,4,6,8],[4,5,8,8],[4,7,7,7],[2,4,7,8],[1,2,5,5],[4,5,6,8],[3,6,7,7],[1,3,4,7],[2,3,4,8],[1,3,7,7],[2,3,4,5],[2,2,2,4],[1,3,3,5],[1,2,3,4],[2,2,6,8],[3,3,5,7],[1,2,4,9],[1,1,2,8],[5,6,6,8],[3,6,6,7],[1,3,8,9],[1,3,6,7],[1,1,2,6],[4,5,6,7],[1,2,5,7],[2,4,5,6],[2,4,7,9],[1,1,2,9],[6,8,8,8],[1,2,3,6],[1,1,5,7],[6,6,6,9],[3,7,9,9],[3,6,6,9],[3,6,6,8],[1,3,5,8],[2,3,6,9],[1,2,4,8],[2,3,5,7],[2,5,5,7],[3,3,9,9],[4,4,5,6],[2,2,5,7],[1,8,8,8],[2,4,5,7],[4,5,7,7],[1,6,9,9],[1,1,4,7],[1,7,8,9],[1,3,4,9],[3,3,5,5],[1,2,8,8],[5,6,9,9],[1,3,4,5],[6,8,9,9],[3,5,6,6],[2,2,4,9],[3,5,5,9],[4,4,8,8],[2,3,3,7],[4,4,4,8],[6,7,8,9],[1,3,6,6],[3,3,6,6],[4,4,7,9],[1,1,2,7],[4,7,7,8],[3,3,4,9],[1,6,6,9],[2,2,4,5],[1,2,8,9],[3,4,4,5],[1,5,9,9],[2,4,4,9],[2,3,3,5],[3,6,8,9],[2,4,6,6],[3,4,5,8],[3,3,4,5],[1,2,3,7],[2,2,6,9],[2,3,8,9],[2,3,7,7],[2,5,5,9],[1,2,6,6],[1,2,2,5],[5,8,8,8],[3,4,5,6],[1,4,5,8],[1,3,6,8],[4,6,6,8],[3,3,8,9],[2,2,3,6],[2,4,8,9],[3,3,7,8],[1,8,8,9],[4,5,7,9],[7,8,8,9],[5,8,8,9],[2,7,8,8],[1,4,4,7],[3,3,3,7],[3,5,8,8],[1,2,7,7],[1,3,3,9],[2,5,8,8],[1,2,4,7],[2,3,4,9],[2,7,8,9],[1,3,9,9],[2,2,5,8],[3,3,3,8],[3,7,7,9],[4,5,8,9],[5,6,8,8],[2,3,3,3],[1,2,5,8],[2,3,5,9],[1,2,2,7],[1,4,6,6],[3,8,8,8],[4,5,9,9],[3,5,5,6],[1,4,6,7],[3,3,7,7],[4,4,5,8],[1,1,3,5],[1,1,5,5],[1,2,3,3],[1,5,5,6],[1,6,8,8],[1,3,5,7],[1,3,7,9],[2,2,4,4],[1,6,6,6],[3,3,8,8],[1,1,4,9],[1,2,3,9],[2,5,6,6],[5,5,6,8],[3,5,6,8],[4,4,4,9],[2,7,7,8],[3,5,5,8],[4,5,7,8],[2,3,7,8],[2,3,8,8],[3,4,6,6],[3,4,4,6],[4,4,4,5],[4,6,8,9],[2,3,7,9],[3,8,8,9],[4,4,7,8],[1,4,7,9],[4,6,8,8],[2,2,4,6],[6,6,8,9],[3,3,4,7],[5,6,7,8],[1,5,5,9],[1,1,3,6],[4,6,7,9],[3,6,9,9],[4,7,8,8],[2,2,2,8],[1,2,7,8],[4,4,4,4],[2,4,4,5],[4,8,8,9],[2,5,6,9],[1,4,7,8],[4,6,7,7],[2,3,4,6],[5,5,7,7],[1,1,3,7],[2,2,6,6],[3,3,5,6],[5,5,6,6],[4,6,7,8],[2,2,8,9],[2,4,4,8],[4,7,8,9],[1,2,2,4],[2,3,6,6],[4,4,7,7],[3,5,7,9],[3,4,4,9],[2,4,5,9],[1,5,7,9],[2,6,6,9],[6,6,8,8],[2,2,8,8],[1,4,4,4],[4,5,6,6],[4,4,8,9],[3,7,8,9],[3,4,7,8],[3,5,9,9],[6,7,9,9],[1,7,7,9],[3,4,4,8],[3,4,4,4],[5,7,8,8],[3,5,5,7],[2,5,7,7],[1,3,6,9],[2,2,6,7],[5,5,5,5],[3,3,4,8],[4,7,9,9],[5,6,7,7],[2,8,8,9],[3,4,8,9],[3,3,3,3],[1,4,7,7],[2,3,6,8],[1,5,6,8],[1,4,4,8],[2,2,5,5],[3,3,5,9],[2,5,7,9],[2,4,8,8],[2,2,2,5],[2,4,4,4],[2,6,8,9],[1,7,9,9],[1,3,5,9],[2,3,3,6],[2,6,9,9],[4,4,6,8],[2,3,5,5],[2,2,7,7],[3,5,6,9],[2,6,8,8],[2,3,5,6],[4,5,5,6],[1,3,3,7],[5,6,6,7],[5,5,7,8],[5,6,6,6],[1,2,4,4],[1,4,8,9],[4,5,5,5],[2,3,6,7],[2,2,3,3],[1,1,4,6],[4,4,4,7],[2,3,3,8],[3,4,5,5],[2,4,9,9],[2,2,3,7],[4,5,6,9],[1,5,6,6],[1,1,3,9],[2,2,4,8],[3,3,6,9],[3,4,7,7],[2,8,8,8],[1,1,6,8],[1,6,7,9],[5,7,7,9],[3,5,6,7],[2,2,2,3],[1,5,5,5],[1,2,2,8],[1,2,2,9],[4,4,5,7],[1,3,3,3],[1,3,4,6],[1,2,7,9],[3,4,5,9],[2,6,7,9],[1,1,5,6],[1,1,4,5],[1,3,3,8],[4,8,8,8],[1,2,4,6],[5,6,8,9]];

function mulberry32(seed) {
    return function () {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function getPuzzleNumber(localDate) {
    const epoch = new Date(EPOCH_DATE);
    return Math.floor((localDate - epoch) / 86400000) + 1;
}

function getDateFromPuzzleNumber(num) {
    const epoch = new Date(EPOCH_DATE);
    return new Date(epoch.getTime() + (num - 1) * 86400000);
}

function getTodayPuzzleNumber() {
    const now = new Date();
    const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return getPuzzleNumber(local);
}

function generatePuzzle(puzzleNum) {
    const idx      = (puzzleNum - 1) % VALID_PUZZLES.length;
    const base     = VALID_PUZZLES[idx];
    const rng      = mulberry32(puzzleNum * PUZZLE_SEED_MULT);
    const shuffled = [...base];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function formatPuzzleDateShort(puzzleNum) {
    const d = getDateFromPuzzleNumber(puzzleNum);
    try {
        return d.toLocaleDateString(navigator.language || 'en', {
            month: 'short', day: 'numeric', timeZone: 'UTC'
        });
    } catch (e) {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
    }
}

function formatPuzzleDateLong(puzzleNum) {
    const d = getDateFromPuzzleNumber(puzzleNum);
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ============================================================
// 3. RATIONAL ARITHMETIC + SOLVER
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

    const leaves = digits.map((d, i) => ({ r: rat(d, 1), tree: { type: 'leaf', id: i, value: d } }));
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
// 4. DIFFICULTY SCORING
// ============================================================
function computeDifficulty(digits, min, max) {
    const leaves = digits.map((d, i) => ({ r: rat(d, 1), tree: { type: 'leaf', id: i, value: d } }));
    const counts = new Map();
    for (const { r } of allResults(leaves)) {
        if (r && r.d === 1 && r.n >= min && r.n <= max && Number.isFinite(r.n)) {
            counts.set(r.n, (counts.get(r.n) || 0) + 1);
        }
    }
    return counts;
}

function sortByDifficulty(targets, difficultyCounts) {
    return [...targets].sort((a, b) => {
        const ca = difficultyCounts.get(a) || 0;
        const cb = difficultyCounts.get(b) || 0;
        if (ca !== cb) return cb - ca; // more solutions = easier = first
        return a - b;
    });
}

function difficultyStars(count) {
    if (count >= 8) return 1;
    if (count >= 3) return 2;
    return 3;
}

// ============================================================
// 5. EXPRESSION RENDERING
// ============================================================
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
// 6. ROUND ENGINE  (pure functions — no DOM)
// ============================================================
function calcOp(a, op, b) {
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
    }
    return null;
}

function createRound(digits) {
    return { cards: digits.map((v, i) => ({ value: v, slot: i, used: false })), selected: [], history: [] };
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
    const result = calcOp(round.cards[i].value, op, round.cards[j].value);
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
// 7. BOARD RENDERER
// ============================================================
function makeNumberNode(n) {
    // For integers (the only case Hot Hand produces), a text node is enough.
    return document.createTextNode(Number.isInteger(n) ? String(n) : n.toFixed(2));
}

function renderBoard(containerEl, round) {
    SLOT_CLASSES.forEach((cls, slotIdx) => {
        const slotEl = containerEl.querySelector('.' + cls);
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
            cardEl.className       = cls2;
            cardEl.dataset.cardIdx = cardIdx;
            cardEl.appendChild(makeNumberNode(card.value));
            slotEl.appendChild(cardEl);
        }
    });

    const opOverlay = containerEl.querySelector('.hh-op-overlay');
    if (opOverlay) opOverlay.classList.toggle('hh-op-show', round.selected.length === 2);

    const undoBtn = containerEl.querySelector('.hh-undo-btn');
    if (undoBtn) undoBtn.style.visibility = round.history.length > 0 ? 'visible' : 'hidden';
}

// ============================================================
// 8. ARENA WIRING
// ============================================================
function wireArena(containerEl, getRound, setRound, onResolve) {
    const arena = containerEl.querySelector('.hh-arena');
    if (!arena) return;

    arena.addEventListener('pointerdown', (e) => {
        const cardEl = e.target.closest('[data-card-idx]');
        const opBtn  = e.target.closest('[data-op]');
        const undoEl = e.target.closest('[data-action="undo"]');
        const opOvl  = e.target.closest('.hh-op-overlay');

        if (undoEl) {
            e.preventDefault();
            setRound(roundUndo(getRound()));
            renderBoard(containerEl, getRound());
            return;
        }
        if (cardEl) {
            e.preventDefault();
            setRound(roundSelectCard(getRound(), parseInt(cardEl.dataset.cardIdx, 10)));
            renderBoard(containerEl, getRound());
            return;
        }
        if (opBtn) {
            e.preventDefault();
            const next = roundApplyOp(getRound(), opBtn.dataset.op);
            if (!next) return;
            setRound(next);
            renderBoard(containerEl, next);
            if (roundRemaining(next).length === 1) onResolve(next);
            return;
        }
        if (opOvl && !opBtn) {
            e.preventDefault();
            const r = getRound();
            setRound({ ...r, selected: [] });
            renderBoard(containerEl, getRound());
        }
    });
}

// ============================================================
// 9. STATE PERSISTENCE
// ============================================================
function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '{}'); }
    catch (e) { console.error('[HotHand] loadHistory failed:', e); return {}; }
}

function saveHistory(history) {
    try { localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history)); }
    catch (e) { console.error('[HotHand] saveHistory failed:', e); }
}

function recordResult(puzzleNum, solved, total, timeSec) {
    const h = loadHistory();
    h[puzzleNum] = { solved, total, timeSec, ts: Date.now() };
    saveHistory(h);
}

function saveRunState(puzzleNum, targetsList, solvedList, currentIdx, elapsedMs) {
    try {
        localStorage.setItem(STORAGE_RUN, JSON.stringify({
            puzzleNum, targetsList, solvedList, currentIdx, elapsedMs
        }));
    } catch (e) { console.error('[HotHand] saveRunState failed:', e); }
}

function loadRunState() {
    try {
        const raw = localStorage.getItem(STORAGE_RUN);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { console.error('[HotHand] loadRunState failed:', e); return null; }
}

function clearRunState() { localStorage.removeItem(STORAGE_RUN); }

function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = 'hh_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
}

// ============================================================
// 10. SUPABASE SYNC
// ============================================================
async function syncResult(puzzleNum, solvedList, targetsList, totalTimeSec) {
    if (!window.hhDb) return;
    try {
        const deviceId = getDeviceId();
        const isPerfect = solvedList.length === targetsList.length;
        await window.hhDb.rpc('record_solve', {
            p_device_id:    deviceId,
            p_puzzle_num:   puzzleNum,
            p_solved:       isPerfect,
            p_moves:        solvedList.length,
            p_solve_time:   totalTimeSec,
            p_operators:    [],
            p_undos:        0,
            p_is_speakeasy: true
        });
    } catch (e) {
        console.error('[HotHand] syncResult failed:', e);
    }
}

// ============================================================
// 11. CONFETTI + TOAST
// ============================================================
function launchConfetti() {
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

let _toastTimer = null;
function showToast(msg) {
    let el = document.getElementById('hhToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'hhToast';
        el.className = 'hh-toast';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('hh-toast-show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('hh-toast-show'), 1800);
}


// ============================================================
// 12. SOLUTION MODAL + DEMO ANIMATION
// ============================================================
function playDemoAnimation(miniEl, digits, steps, timeouts, onDone) {
    let demoRound     = createRound([...digits]);
    const idToCardIdx = { 0: 0, 1: 1, 2: 2, 3: 3 };
    let stepIdx       = 0;
    const opDisplay   = miniEl.querySelector('.hh-sol-op-display');

    const opOverlay = miniEl.querySelector('.hh-op-overlay');
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

        demoRound = roundSelectTwo(demoRound, aIdx, bIdx);
        renderBoard(miniEl, demoRound);

        const t1 = setTimeout(() => { showOp(step.op); }, 350);
        timeouts.push(t1);

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

function showSolutionModal(gameScreenEl, n, tree, digits) {
    const expr  = treeToExpr(tree);
    const steps = treeToSteps(tree);

    const modal = document.createElement('div');
    modal.className = 'hh-solution-modal';
    modal.innerHTML = `
<div class="hh-sol-card">
  <div class="hh-sol-heading">How to make <span class="hh-sol-n">${n}</span></div>
  <div class="hh-sol-board" style="display:none">
    <div class="hh-diamond-grid">
      <div class="hh-slot hh-slot-top"></div>
      <div class="hh-slot hh-slot-left"></div>
      <div class="hh-sol-op-display"></div>
      <div class="hh-slot hh-slot-right"></div>
      <div class="hh-slot hh-slot-bottom"></div>
    </div>
  </div>
  <div class="hh-sol-expr">${expr}</div>
  <div class="hh-sol-actions">
    <button class="hh-btn hh-btn-primary hh-sol-watch">Watch</button>
    <button class="hh-btn hh-btn-ghost   hh-sol-close">Close</button>
  </div>
</div>`;

    gameScreenEl.appendChild(modal);

    const boardEl  = modal.querySelector('.hh-sol-board');
    const watchBtn = modal.querySelector('.hh-sol-watch');
    const closeBtn = modal.querySelector('.hh-sol-close');
    let demoTimeouts = [];
    let demoRunning  = false;

    function stopDemo() {
        demoTimeouts.forEach(clearTimeout);
        demoTimeouts         = [];
        demoRunning          = false;
        watchBtn.disabled    = false;
        watchBtn.textContent = 'Watch again';
    }

    watchBtn.addEventListener('click', () => {
        if (demoRunning) return;
        boardEl.style.display = '';
        demoRunning           = true;
        watchBtn.disabled     = true;
        watchBtn.textContent  = 'Playing\u2026';
        demoTimeouts          = [];
        renderBoard(boardEl, createRound([...digits]));
        playDemoAnimation(boardEl, digits, steps, demoTimeouts, () => {
            demoRunning          = false;
            watchBtn.disabled    = false;
            watchBtn.textContent = 'Watch again';
            const tHide = setTimeout(() => { boardEl.style.display = 'none'; }, 1200);
            demoTimeouts.push(tHide);
        });
    });

    closeBtn.addEventListener('click', () => { stopDemo(); modal.remove(); });
    modal.addEventListener('click', (e) => {
        if (!e.target.closest('.hh-sol-card')) { stopDemo(); modal.remove(); }
    });
}

// ============================================================
// 13. END SCREEN
// ============================================================
function showEndScreen(gameScreenEl, targetsList, solvedSet, solutionsByTarget, digits, puzzleNum, totalTimeSec) {
    const total     = targetsList.length;
    const solved    = solvedSet.size;
    const isPerfect = solved === total;

    let badge, badgeClass;
    if (isPerfect)      { badge = 'Perfect!';    badgeClass = 'hh-result-badge-perfect'; }
    else if (solved > 0) { badge = "Time\u2019s up"; badgeClass = 'hh-result-badge-partial'; }
    else                 { badge = "Time\u2019s up"; badgeClass = 'hh-result-badge-none';    }

    const dateStr = formatPuzzleDateLong(puzzleNum);
    const mins = Math.floor(totalTimeSec / 60);
    const secs = totalTimeSec % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    const chipsHTML = targetsList.map(n => {
        if (solvedSet.has(n)) return `<span class="hh-chip-found">\u2713\u202f${n}</span>`;
        const hasSol = solutionsByTarget.has(n);
        return `<span class="hh-chip hh-chip-missed${hasSol ? ' hh-chip-tappable' : ''}"
                     data-missed="${n}">${n}</span>`;
    }).join('');

    gameScreenEl.innerHTML = `
<div class="hh-result${isPerfect ? ' hh-result-perfect' : ''}">
  <div class="hh-result-icon">${isPerfect ? '\uD83D\uDD25' : '\uD83D\uDD25'}</div>
  <div class="hh-result-badge ${badgeClass}">${badge}</div>
  <div class="hh-result-date">${dateStr}</div>
  <div class="hh-result-stats-row">
    <div class="hh-result-stat-item">
      <span class="hh-result-stat-value">${solved}/${total}</span>
      <span class="hh-result-stat-label">solved</span>
    </div>
    <div class="hh-result-stat-item">
      <span class="hh-result-stat-value">${timeStr}</span>
      <span class="hh-result-stat-label">time</span>
    </div>
  </div>
  ${!isPerfect && solved > 0 ? '<div class="hh-result-hint">Tap a missed number to see its solution.</div>' : ''}
  <div class="hh-result-book" id="hhResultBook">${chipsHTML}</div>
  <div class="hh-result-actions">
    <button class="hh-btn hh-btn-ghost"  id="hhResultClose">Close</button>
    <button class="hh-btn hh-btn-share"  id="hhResultShare">Share</button>
  </div>
</div>`;

    gameScreenEl.querySelector('#hhResultBook').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-missed]');
        if (!chip) return;
        const n    = parseInt(chip.dataset.missed, 10);
        const tree = solutionsByTarget.get(n);
        if (tree) showSolutionModal(gameScreenEl, n, tree, digits);
    });

    gameScreenEl.querySelector('#hhResultShare').addEventListener('click', () => {
        const text = buildShareText(puzzleNum, solved, total);
        navigator.clipboard.writeText(text).catch(() => {});
        if (navigator.share) navigator.share({ text }).catch(() => {});
        showToast('Copied!');
    });

    gameScreenEl.querySelector('#hhResultClose').addEventListener('click', showLobby);
}

function buildShareText(puzzleNum, solved, total) {
    const dateStr = formatPuzzleDateShort(puzzleNum);
    const emoji   = solved === total ? '\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25' : '\uD83D\uDD25';
    return `${emoji} Hot Hand \u2014 ${dateStr}\n\n${solved}/${total} targets\n\nhttps://kapework.com/apps/hothand/`;
}

// ============================================================
// 14. INTRO SCREEN  (shown once on first launch)
// ============================================================
function showIntro(totalTargets, onStart) {
    const overlay = document.createElement('div');
    overlay.className = 'hh-modal-overlay hh-modal-center';
    overlay.innerHTML = `
<div class="hh-modal" style="border-radius:20px;max-width:340px">
  <div class="hh-intro-card" style="border-radius:20px;border:none;padding:32px 28px 28px">
    <div class="hh-intro-icon">\uD83D\uDD25</div>
    <div class="hh-intro-title">Hot Hand</div>
    <div class="hh-intro-body">One fixed hand. Complete as many targets as you can before time runs out. ${SECONDS_PER_TARGET}s per target.</div>
    <div class="hh-intro-tag">${totalTargets} targets today</div>
    <button class="hh-btn hh-btn-primary hh-intro-start" style="width:auto;padding:12px 40px">Let&rsquo;s go</button>
  </div>
</div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('.hh-intro-start').addEventListener('click', () => {
        overlay.remove();
        localStorage.setItem(STORAGE_INTRO, '1');
        onStart();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); onStart(); }
    });
}

// ============================================================
// 15. GAME LOOP
// ============================================================

// Active game state (module-level so keyboard handler can reach it)
let _gameActive    = false;
let _round         = null;
let _finished      = false;
let _rafId         = null;
let _fbTimer       = null;
let _removeKbHandler = null;

// Current run context (set at game start)
let _puzzleNum         = 0;
let _digits            = [];
let _targetsList       = [];
let _solutionsByTarget = null;
let _difficultyCounts  = null;
let _solvedSet         = null;
let _currentIdx        = 0;
let _timerStart        = null;
let _totalElapsedBefore = 0;
let _isArchive         = false;

function renderChips(chipsRow, targetsList, solvedSet, currentIdx) {
    chipsRow.innerHTML = targetsList.map((n, i) => {
        if (solvedSet.has(n)) {
            return `<span class="hh-chip hh-chip-done" data-chip="${n}">\u2713\u202f${n}</span>`;
        }
        if (i === currentIdx) {
            return `<span class="hh-chip hh-chip-active" data-chip="${n}">${n}</span>`;
        }
        if (i < currentIdx) {
            return `<span class="hh-chip hh-chip-missed" data-chip="${n}">${n}</span>`;
        }
        return `<span class="hh-chip hh-chip-pending" data-chip="${n}">${n}</span>`;
    }).join('');
}

function updateProgressFill(solved, total) {
    const fill = document.getElementById('hhProgressFill');
    if (fill) fill.style.width = total > 0 ? (solved / total * 100) + '%' : '0%';
}

function popChip(n) {
    // Briefly animate the chip that just completed
    const chip = document.querySelector(`.hh-chip[data-chip="${n}"]`);
    if (!chip) return;
    chip.classList.add('hh-chip-pop');
    chip.addEventListener('animationend', () => chip.classList.remove('hh-chip-pop'), { once: true });
}

function triggerTargetHit(targetNumEl) {
    // Green flash + sparkle on the target number
    targetNumEl.classList.add('hh-target-hit');
    targetNumEl.addEventListener('animationend', () => targetNumEl.classList.remove('hh-target-hit'), { once: true });

    const burst = document.createElement('div');
    burst.className = 'hh-burst';
    targetNumEl.parentElement.style.position = 'relative';
    targetNumEl.parentElement.appendChild(burst);
    setTimeout(() => burst.remove(), 500);
}

function startRun(puzzleNum, digits, targetsList, solutionsByTarget, difficultyCounts, resumeState) {
    _gameActive         = true;
    _finished           = false;
    _puzzleNum          = puzzleNum;
    _digits             = digits;
    _targetsList        = targetsList;
    _solutionsByTarget  = solutionsByTarget;
    _difficultyCounts   = difficultyCounts;
    _solvedSet          = new Set(resumeState ? resumeState.solvedList : []);
    _currentIdx         = resumeState ? resumeState.currentIdx : 0;
    _totalElapsedBefore = resumeState ? resumeState.elapsedMs : 0;

    // Skip solved indices
    while (_currentIdx < targetsList.length && _solvedSet.has(targetsList[_currentIdx])) {
        _currentIdx++;
    }

    const gameEl = document.getElementById('hhGame');
    gameEl.style.display = 'flex';
    document.getElementById('hhLobby').style.display = 'none';

    const totalTargets  = targetsList.length;
    const currentTarget = targetsList[_currentIdx];
    const stars         = difficultyStars(difficultyCounts.get(currentTarget) || 0);
    const starsStr      = '\u2605'.repeat(stars) + '\u2606'.repeat(3 - stars);

    gameEl.innerHTML = `
<div class="hh-topbar">
  <button class="hh-back-btn" id="hhBackBtn" aria-label="Exit">&lsaquo;</button>
  <span class="hh-badge">HOT HAND</span>
  <div class="hh-topbar-right">
    <span class="hh-stars" id="hhStars">${starsStr}</span>
    <span class="hh-topbar-progress" id="hhProgress">${_solvedSet.size}/${totalTargets}</span>
  </div>
</div>
<div class="hh-target-row">
  <span class="hh-target-label">Make</span>
  <span class="hh-target-number" id="hhTargetNum">${currentTarget}</span>
</div>
<div class="hh-timer-bar-track">
  <div class="hh-timer-bar-fill" id="hhTimerFill"></div>
</div>
<div class="hh-arena" id="hhArena">
  <div class="hh-diamond-grid">
    <div class="hh-slot hh-slot-top"></div>
    <div class="hh-slot hh-slot-left"></div>
    <div class="hh-slot hh-slot-right"></div>
    <div class="hh-slot hh-slot-bottom"></div>
  </div>
  <div class="hh-undo-row">
    <button class="hh-undo-btn" style="visibility:hidden" data-action="undo">&#8630; Undo</button>
  </div>
  <div class="hh-inline-fb" id="hhFb"></div>
  <div class="hh-op-overlay" id="hhOpOverlay">
    <div class="operators-grid">
      <button class="op-btn" data-op="+">+</button>
      <button class="op-btn" data-op="-">&#8722;</button>
      <button class="op-btn" data-op="*">&times;</button>
      <button class="op-btn" data-op="/">&divide;</button>
    </div>
  </div>
</div>
<div class="hh-progress-track"><div class="hh-progress-fill" id="hhProgressFill"></div></div>
<div class="hh-chips-row" id="hhChips"></div>`;

    const targetNumEl = gameEl.querySelector('#hhTargetNum');
    const timerFillEl = gameEl.querySelector('#hhTimerFill');
    const chipsRow    = gameEl.querySelector('#hhChips');
    const progressEl  = gameEl.querySelector('#hhProgress');
    const starsEl     = gameEl.querySelector('#hhStars');
    const fbEl        = gameEl.querySelector('#hhFb');

    renderChips(chipsRow, targetsList, _solvedSet, _currentIdx);
    updateProgressFill(_solvedSet.size, totalTargets);

    gameEl.querySelector('#hhBackBtn').addEventListener('click', () => {
        _finished = true;
        cancelAnimationFrame(_rafId);
        clearTimeout(_fbTimer);
        if (_removeKbHandler) { _removeKbHandler(); _removeKbHandler = null; }
        const elapsed = _totalElapsedBefore + (_timerStart ? Date.now() - _timerStart : 0);
        saveRunState(_puzzleNum, _targetsList, [..._solvedSet], _currentIdx, elapsed);
        showLobby();
    });

    function showFb(msg, cls) {
        if (_fbTimer) clearTimeout(_fbTimer);
        fbEl.textContent = msg;
        fbEl.className   = 'hh-inline-fb hh-fb-' + cls + ' hh-fb-show';
        _fbTimer = setTimeout(() => fbEl.classList.remove('hh-fb-show'), 900);
    }

    function advanceTarget() {
        _currentIdx++;
        while (_currentIdx < totalTargets && _solvedSet.has(_targetsList[_currentIdx])) {
            _currentIdx++;
        }

        if (_currentIdx >= totalTargets || _solvedSet.size === totalTargets) {
            finishRun();
            return;
        }

        const newTarget = _targetsList[_currentIdx];
        targetNumEl.textContent = newTarget;
        progressEl.textContent  = `${_solvedSet.size}/${totalTargets}`;
        const s = difficultyStars(_difficultyCounts.get(newTarget) || 0);
        starsEl.textContent = '\u2605'.repeat(s) + '\u2606'.repeat(3 - s);
        renderChips(chipsRow, _targetsList, _solvedSet, _currentIdx);

        _totalElapsedBefore += (Date.now() - _timerStart);
        _timerStart = Date.now();

        _round = createRound([..._digits]);
        renderBoard(gameEl, _round);

        // Reset timer bar
        timerFillEl.classList.remove('hh-timer-warn', 'hh-timer-danger');
        timerFillEl.style.transform = 'scaleX(1)';
    }

    function finishRun() {
        _finished = true;
        _gameActive = false;
        cancelAnimationFrame(_rafId);
        clearTimeout(_fbTimer);
        if (_removeKbHandler) { _removeKbHandler(); _removeKbHandler = null; }
        clearRunState();

        const totalElapsed = _totalElapsedBefore + (_timerStart ? Date.now() - _timerStart : 0);
        const totalTimeSec = Math.round(totalElapsed / 1000);

        recordResult(_puzzleNum, _solvedSet.size, totalTargets, totalTimeSec);
        syncResult(_puzzleNum, [..._solvedSet], _targetsList, totalTimeSec);

        if (_solvedSet.size === totalTargets) {
            launchConfetti();
            setTimeout(() => {
                showEndScreen(gameEl, _targetsList, _solvedSet, _solutionsByTarget, _digits, _puzzleNum, totalTimeSec);
            }, 1200);
        } else {
            showEndScreen(gameEl, _targetsList, _solvedSet, _solutionsByTarget, _digits, _puzzleNum, totalTimeSec);
        }
    }

    _round = createRound([..._digits]);

    wireArena(gameEl, () => _round, (r) => { _round = r; }, (resolved) => {
        if (_finished) return;
        const val           = roundGetValue(resolved);
        const currentTarget = _targetsList[_currentIdx];

        if (val !== null && Number.isInteger(val) && val === currentTarget) {
            _solvedSet.add(val);
            triggerTargetHit(targetNumEl);
            showFb('\u2713 ' + val, 'new');
            progressEl.textContent = `${_solvedSet.size}/${totalTargets}`;
            renderChips(chipsRow, _targetsList, _solvedSet, _currentIdx);
            updateProgressFill(_solvedSet.size, totalTargets);
            setTimeout(() => { popChip(val); }, 20); // after DOM updates

            const elapsed = _totalElapsedBefore + (Date.now() - _timerStart);
            saveRunState(_puzzleNum, _targetsList, [..._solvedSet], _currentIdx, elapsed);

            setTimeout(() => { if (!_finished) advanceTarget(); }, RESET_MS);

        } else if (val !== null && Number.isInteger(val) && _solutionsByTarget.has(val) && val !== currentTarget) {
            showFb('Need ' + currentTarget + ', not ' + val, 'dupe');
            setTimeout(() => {
                if (!_finished) { _round = createRound([..._digits]); renderBoard(gameEl, _round); }
            }, RESET_MS);
        } else if (val !== null && !Number.isInteger(val)) {
            showFb('Not an integer', 'bad');
            setTimeout(() => {
                if (!_finished) { _round = createRound([..._digits]); renderBoard(gameEl, _round); }
            }, RESET_MS);
        } else {
            showFb(val + ' \u2260 ' + currentTarget, 'bad');
            setTimeout(() => {
                if (!_finished) { _round = createRound([..._digits]); renderBoard(gameEl, _round); }
            }, RESET_MS);
        }
    });

    _removeKbHandler = wireKeyboard(gameEl, () => _round, (r) => { _round = r; }, () => _finished, () => _targetsList[_currentIdx], showFb, advanceTarget);

    requestAnimationFrame(() => {
        renderBoard(gameEl, _round);
        _timerStart = Date.now();
        _rafId = requestAnimationFrame(tick);
    });

    function tick() {
        if (_finished) return;
        const elapsed   = Date.now() - _timerStart;
        const targetMs  = SECONDS_PER_TARGET * 1000;
        const remaining = targetMs - elapsed;
        const pct       = Math.max(0, remaining / targetMs);

        timerFillEl.style.transform = `scaleX(${pct.toFixed(4)})`;
        timerFillEl.classList.toggle('hh-timer-warn',   remaining < 15000 && remaining >= 5000);
        timerFillEl.classList.toggle('hh-timer-danger', remaining < 5000);

        if (remaining <= 0) {
            renderChips(chipsRow, _targetsList, _solvedSet, _currentIdx);

            _currentIdx++;
            while (_currentIdx < totalTargets && _solvedSet.has(_targetsList[_currentIdx])) {
                _currentIdx++;
            }

            if (_currentIdx >= totalTargets) { finishRun(); return; }

            const newTarget = _targetsList[_currentIdx];
            targetNumEl.textContent = newTarget;
            progressEl.textContent  = `${_solvedSet.size}/${totalTargets}`;
            const s = difficultyStars(_difficultyCounts.get(newTarget) || 0);
            starsEl.textContent = '\u2605'.repeat(s) + '\u2606'.repeat(3 - s);
            renderChips(chipsRow, _targetsList, _solvedSet, _currentIdx);

            _totalElapsedBefore += targetMs;
            _timerStart = Date.now();

            _round = createRound([..._digits]);
            renderBoard(gameEl, _round);

            timerFillEl.classList.remove('hh-timer-warn', 'hh-timer-danger');
            timerFillEl.style.transform = 'scaleX(1)';
        }

        _rafId = requestAnimationFrame(tick);
    }
}

function launchGame(puzzleNum, isArchive) {
    _isArchive = isArchive || false;
    const digits    = generatePuzzle(puzzleNum);
    const solutions = computeSolutions(digits, ORDER_MIN, ORDER_MAX);
    const difficulty = computeDifficulty(digits, ORDER_MIN, ORDER_MAX);
    const allTargets = [...solutions.keys()];
    const targetsList = sortByDifficulty(allTargets, difficulty);

    if (targetsList.length === 0) {
        showToast('No targets for this hand.');
        return;
    }

    // Resume saved run only for today (not archive plays)
    if (!isArchive) {
        const saved = loadRunState();
        if (saved && saved.puzzleNum === puzzleNum) {
            startRun(puzzleNum, digits, saved.targetsList, solutions, difficulty, saved);
            return;
        }
    }

    const introSeen = localStorage.getItem(STORAGE_INTRO) === '1';
    if (!introSeen) {
        showIntro(targetsList.length, () =>
            startRun(puzzleNum, digits, targetsList, solutions, difficulty, null));
    } else {
        startRun(puzzleNum, digits, targetsList, solutions, difficulty, null);
    }
}


// ============================================================
// 16. KEYBOARD HANDLER
// ============================================================
function wireKeyboard(containerEl, getRound, setRound, isFinished, getCurrentTarget, showFb, advanceTarget) {
    let keyBuffer  = '';
    let keyTimeout = null;

    function clearBuffer() {
        keyBuffer = '';
        if (keyTimeout) { clearTimeout(keyTimeout); keyTimeout = null; }
    }

    function getActiveTiles() {
        return getRound().cards.filter(c => !c.used);
    }

    function findCardIndex(value) {
        const r = getRound();
        for (let i = 0; i < r.cards.length; i++) {
            if (!r.cards[i].used && r.cards[i].value === value && !r.selected.includes(i)) return i;
        }
        for (let i = 0; i < r.cards.length; i++) {
            if (!r.cards[i].used && r.cards[i].value === value) return i;
        }
        return -1;
    }

    function commitBuffer() {
        keyTimeout = null;
        const num = parseInt(keyBuffer, 10);
        keyBuffer = '';
        if (isNaN(num)) return;
        const idx = findCardIndex(num);
        if (idx !== -1) {
            setRound(roundSelectCard(getRound(), idx));
            renderBoard(containerEl, getRound());
            if (getRound().selected.length === 2) {
                const ov = containerEl.querySelector('.hh-op-overlay');
                if (ov) ov.classList.add('hh-op-show');
            }
        }
    }

    function handleKeydown(e) {
        if (isFinished()) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (containerEl.querySelector('.hh-solution-modal')) return;

        const key = e.key;

        if (key >= '0' && key <= '9') {
            e.preventDefault();
            keyBuffer += key;
            if (keyTimeout) { clearTimeout(keyTimeout); keyTimeout = null; }

            const tiles = getActiveTiles();
            const num   = parseInt(keyBuffer, 10);
            const hasExact  = tiles.some(t => t.value === num);
            const hasLonger = tiles.some(t => String(t.value).startsWith(keyBuffer) && String(t.value).length > keyBuffer.length);

            if (hasExact && !hasLonger) {
                keyBuffer = '';
                const idx = findCardIndex(num);
                if (idx !== -1) {
                    setRound(roundSelectCard(getRound(), idx));
                    renderBoard(containerEl, getRound());
                    if (getRound().selected.length === 2) {
                        const ov = containerEl.querySelector('.hh-op-overlay');
                        if (ov) ov.classList.add('hh-op-show');
                    }
                }
            } else if (hasExact || hasLonger) {
                keyTimeout = setTimeout(commitBuffer, 600);
            } else {
                keyBuffer = '';
            }
            return;
        }

        const opMap = { '+': '+', '-': '-', '*': '*', 'x': '*', 'X': '*', '/': '/' };
        if (opMap[key]) {
            e.preventDefault();
            if (keyBuffer) { if (keyTimeout) clearTimeout(keyTimeout); commitBuffer(); }
            const r = getRound();
            if (r.selected.length === 2) {
                const next = roundApplyOp(r, opMap[key]);
                if (next) {
                    setRound(next);
                    renderBoard(containerEl, next);
                    if (roundRemaining(next).length === 1) {
                        const val           = roundGetValue(next);
                        const currentTarget = getCurrentTarget();
                        if (val !== null && Number.isInteger(val) && val === currentTarget) {
                            // Trigger the same resolve path as the pointer handler
                            // by dispatching a synthetic resolve through the arena
                            const arenaEvent = new CustomEvent('hh-resolve', { detail: next });
                            containerEl.dispatchEvent(arenaEvent);
                        }
                    }
                }
            }
            return;
        }

        if (key === 'Backspace' || key === 'z' || key === 'Z') {
            e.preventDefault();
            clearBuffer();
            setRound(roundUndo(getRound()));
            renderBoard(containerEl, getRound());
            return;
        }

        if (key === 'Escape') {
            clearBuffer();
            setRound({ ...getRound(), selected: [] });
            renderBoard(containerEl, getRound());
        }
    }

    document.addEventListener('keydown', handleKeydown);
    return () => { document.removeEventListener('keydown', handleKeydown); clearBuffer(); };
}

// ============================================================
// 17. CALENDAR / ARCHIVE
// ============================================================
function openCalendar() {
    const today    = getTodayPuzzleNumber();
    const history  = loadHistory();
    const DAYS     = 60;

    // Build list of puzzleNums from today back DAYS days
    const entries = [];
    for (let i = 0; i < DAYS; i++) {
        const pNum = today - i;
        if (pNum < 1) break;
        entries.push(pNum);
    }

    // Group into rows of 4
    const rows = [];
    for (let i = 0; i < entries.length; i += 4) {
        rows.push(entries.slice(i, i + 4));
    }

    // Build month-labelled sections
    let lastMonth = -1;
    let sectionsHTML = '';
    for (const row of rows) {
        // Check if first entry of row starts a new month
        const d = getDateFromPuzzleNumber(row[0]);
        const monthKey = d.getUTCMonth();
        if (monthKey !== lastMonth) {
            lastMonth = monthKey;
            const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            sectionsHTML += `<div class="hh-cal-month-label">${months[d.getUTCMonth()]} ${d.getUTCFullYear()}</div>`;
        }
        const cellsHTML = row.map(pNum => {
            const isToday = pNum === today;
            const result  = history[pNum];
            const dateLabel = formatPuzzleDateShort(pNum);
            const isPerfect = result && result.solved === result.total;

            let cellClass = 'hh-cal-cell';
            if (isToday)   cellClass += ' hh-cal-today';
            if (result && !isPerfect) cellClass += ' hh-cal-played';
            if (isPerfect) cellClass += ' hh-cal-perfect';

            const scoreHTML = result
                ? `<span class="hh-cal-score">${isPerfect ? '\uD83D\uDD25' : result.solved + '/' + result.total}</span>`
                : `<span class="hh-cal-empty">&mdash;</span>`;

            return `<div class="${cellClass}" data-puzzle="${pNum}">
  <span class="hh-cal-date">${dateLabel}${isToday ? ' \u2022' : ''}</span>
  ${scoreHTML}
</div>`;
        }).join('');
        sectionsHTML += `<div class="hh-cal-row">${cellsHTML}</div>`;
    }

    const overlay = document.createElement('div');
    overlay.id        = 'hhCalModal';
    overlay.className = 'hh-modal-overlay';
    overlay.innerHTML = `
<div class="hh-modal">
  <div class="hh-modal-header">
    <span class="hh-modal-title">Past Hands</span>
    <button class="hh-modal-close" id="hhCalClose">&#x2715;</button>
  </div>
  <div class="hh-cal-scroll">${sectionsHTML}</div>
</div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('#hhCalClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.hh-cal-scroll').addEventListener('click', (e) => {
        const cell = e.target.closest('[data-puzzle]');
        if (!cell) return;
        const pNum = parseInt(cell.dataset.puzzle, 10);
        overlay.remove();
        const isArchive = pNum !== today;
        launchGame(pNum, isArchive);
    });
}

// ============================================================
// 18. LOBBY
// ============================================================
function showLobby() {
    _gameActive = false;
    const gameEl  = document.getElementById('hhGame');
    const lobbyEl = document.getElementById('hhLobby');

    if (gameEl)  { gameEl.style.display  = 'none'; gameEl.innerHTML = ''; }
    if (lobbyEl) lobbyEl.style.display = 'flex';

    updateLobby();
}

function updateLobby() {
    const today   = getTodayPuzzleNumber();
    const digits  = generatePuzzle(today);
    const history = loadHistory();
    const result  = history[today];

    // Show today's digits
    const handDisplay = document.getElementById('hhHandDisplay');
    if (handDisplay) {
        handDisplay.innerHTML = digits.map(d =>
            `<div class="hh-hand-digit">${d}</div>`
        ).join('');
    }

    // Play button label
    const playBtn = document.getElementById('hhPlayBtn');
    if (playBtn) {
        playBtn.textContent = result ? 'Play Again' : "Play Today\u2019s Hand";
    }

    // Previous result summary
    const metaEl = document.getElementById('hhLobbyMeta');
    if (metaEl) {
        if (result) {
            const isPerfect = result.solved === result.total;
            if (isPerfect) {
                metaEl.innerHTML = `<span class="hh-meta-perfect">\uD83D\uDD25 Perfect \u2014 ${result.solved}/${result.total}</span>`;
            } else {
                metaEl.innerHTML = `Today: <span class="hh-meta-score">${result.solved}/${result.total}</span> solved`;
            }
        } else {
            metaEl.innerHTML = formatPuzzleDateLong(today);
        }
    }
}

// ============================================================
// 19. INIT
// ============================================================
function init() {
    const today = getTodayPuzzleNumber();

    // Wire lobby buttons
    document.getElementById('hhPlayBtn').addEventListener('click', () => {
        launchGame(today, false);
    });

    document.getElementById('hhArchiveBtn').addEventListener('click', () => {
        openCalendar();
    });

    updateLobby();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

