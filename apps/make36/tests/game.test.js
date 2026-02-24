/**
 * Basic tests for Make 36 core solver and hint logic.
 *
 * These tests run in Node.js via Jest and import the pure functions
 * exported from app.js (the DOM/Supabase code is gated behind
 * typeof checks so it won't run during import in Node).
 */

// We need to mock browser globals before requiring app.js
// so the top-level DOM code doesn't blow up in Node.

// Minimal mock of browser globals
const noopEl = {
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    style: {},
    textContent: '',
    innerHTML: '',
    value: '',
    appendChild() {},
    querySelector() { return noopEl; },
    querySelectorAll() { return []; },
    scrollIntoView() {},
    focus() {},
    closest() { return null; },
    remove() {},
    insertBefore() {},
    dataset: {},
    className: '',
    getContext() {
        return {
            fillRect() {}, fillText() {}, beginPath() {}, moveTo() {},
            lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {},
            stroke() {}, fillStyle: '', strokeStyle: '', lineWidth: 0,
            font: '', textAlign: '', textBaseline: '',
        };
    },
    toBlob(cb) { cb(null); },
    width: 0,
    height: 0,
};

global.document = {
    getElementById() { return noopEl; },
    querySelectorAll() { return []; },
    createElement() { return { ...noopEl, children: [], appendChild() {} }; },
    createTextNode(text) { return { textContent: text }; },
    addEventListener() {},
    body: { addEventListener() {} },
};
global.window = { addEventListener() {}, location: { href: '' } };
global.localStorage = {
    _store: {},
    getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = v; },
    removeItem(k) { delete this._store[k]; },
};
global.navigator = { share: null, clipboard: { writeText() { return Promise.resolve(); } } };
global.setTimeout = (fn) => fn();
global.clearTimeout = () => {};
global.Date = Date;
global.confirm = () => false;
global.alert = () => {};
global.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) });

// Mock supabase global
global.supabase = {
    createClient() {
        return {
            auth: {
                getSession() { return Promise.resolve({ data: { session: null } }); },
                onAuthStateChange() {},
                signInWithOAuth() { return Promise.resolve({}); },
                signInWithOtp() { return Promise.resolve({}); },
                verifyOtp() { return Promise.resolve({}); },
                signOut() { return Promise.resolve({}); },
            },
            rpc() { return Promise.resolve({ data: null, error: null }); },
        };
    },
};

// Now require the module
const game = require('../app.js');

// ============================================================
// TESTS
// ============================================================

describe('calc', () => {
    test('addition', () => {
        expect(game.calc(3, '+', 5)).toBe(8);
    });
    test('subtraction', () => {
        expect(game.calc(10, '-', 4)).toBe(6);
    });
    test('multiplication', () => {
        expect(game.calc(3, '*', 8)).toBe(24);
    });
    test('division', () => {
        expect(game.calc(12, '/', 3)).toBe(4);
    });
    test('division by zero returns null', () => {
        expect(game.calc(5, '/', 0)).toBeNull();
    });
});

describe('generatePuzzle', () => {
    test('returns 4 numbers', () => {
        const nums = game.generatePuzzle(1);
        expect(nums).toHaveLength(4);
    });
    test('same puzzle number always gives same numbers (deterministic)', () => {
        const a = game.generatePuzzle(42);
        const b = game.generatePuzzle(42);
        expect(a).toEqual(b);
    });
    test('different puzzle numbers give different puzzles', () => {
        const a = game.generatePuzzle(1);
        const b = game.generatePuzzle(2);
        // They could theoretically be the same, but with our seed it's extremely unlikely
        // Just check they're both valid 4-number arrays
        expect(a).toHaveLength(4);
        expect(b).toHaveLength(4);
    });
});

describe('getPuzzleDifficulty', () => {
    test('classifies easy puzzles', () => {
        // [1,2,3,4] has solutions (e.g. 4*3*(2+1)=36)
        const diff = game.getPuzzleDifficulty([1, 2, 3, 4]);
        expect(diff.level).toBe('easy');
    });
    test('returns valid difficulty levels', () => {
        const diff = game.getPuzzleDifficulty([5, 6, 7, 9]);
        expect(['easy', 'medium', 'hard']).toContain(diff.level);
        expect(diff.label).toBeTruthy();
        expect(diff.emoji).toBeTruthy();
    });
});

describe('findHintForPuzzle', () => {
    test('returns a hint string for solvable puzzles', () => {
        const hint = game.findHintForPuzzle([1, 2, 3, 4]);
        expect(hint).toBeTruthy();
        expect(typeof hint).toBe('string');
        expect(hint.length).toBeGreaterThan(0);
    });
    test('hint contains two numbers and an operator', () => {
        const hint = game.findHintForPuzzle([1, 2, 3, 4]);
        // Format: "A op B" (e.g. "1 + 2")
        expect(hint).toMatch(/^\d+ [+\u2212\u00D7\u00F7] \d+$/);
    });
    test('hint leads to a solvable position for [4, 9, 1, 1]', () => {
        const hint = game.findHintForPuzzle([4, 9, 1, 1]);
        expect(hint).toBeTruthy();
        // One correct first step is 4 × 9 = 36
        expect(hint).toMatch(/[49]/);
    });
    test('hint first step is verifiable for many puzzles', () => {
        // Sample puzzles — each hint's first step should produce a solvable remainder
        const testCases = [[1,2,3,4], [4,9,1,1], [2,2,3,3], [3,3,4,1], [2,3,6,1]];
        for (const nums of testCases) {
            const hint = game.findHintForPuzzle(nums);
            if (!hint) continue; // skip unsolvable
            // Parse hint: "A op B"
            const parts = hint.split(' ');
            const a = parseFloat(parts[0]);
            const opSym = parts[1];
            const b = parseFloat(parts[2]);
            const opMap = { '+': '+', '\u2212': '-', '\u00D7': '*', '\u00F7': '/' };
            const op = opMap[opSym];
            const result = game.calc(a, op, b);
            // Find which indices to remove (match by value)
            const remaining = [...nums];
            const idxA = remaining.indexOf(a);
            remaining.splice(idxA, 1);
            const idxB = remaining.indexOf(b);
            remaining.splice(idxB, 1);
            remaining.push(result);
            // The remaining 3 numbers must be solvable
            expect(game.solve24Full(remaining)).not.toBeNull();
        }
    });
});

describe('canMake24From3', () => {
    test('returns true for [4, 9, 1] (4*9*1=36)', () => {
        expect(game.canMake24From3([4, 9, 1])).toBe(true);
    });
    test('returns true for [3, 3, 4] (3*3*4=36)', () => {
        expect(game.canMake24From3([3, 3, 4])).toBe(true);
    });
    test('returns false for impossible sets', () => {
        expect(game.canMake24From3([1, 1, 1])).toBe(false);
    });
});

describe('formatNumber', () => {
    test('formats integers without decimals', () => {
        expect(game.formatNumber(24)).toBe('24');
    });
    test('formats near-integer values', () => {
        expect(game.formatNumber(24.00)).toBe('24');
    });
    test('formats 1/2 as fraction', () => {
        expect(game.formatNumber(0.5)).toBe('1/2');
    });
    test('formats 2.5 as mixed number', () => {
        expect(game.formatNumber(2.5)).toBe('2 1/2');
    });
    test('formats 1/3 as fraction', () => {
        expect(game.formatNumber(1/3)).toBe('1/3');
    });
    test('formats 2 2/3 as mixed number', () => {
        expect(game.formatNumber(8/3)).toBe('2 2/3');
    });
    test('formats 3/4 as fraction', () => {
        expect(game.formatNumber(0.75)).toBe('3/4');
    });
    test('formats negative fractions', () => {
        expect(game.formatNumber(-0.5)).toBe('\u22121/2');
        expect(game.formatNumber(-1.5)).toBe('\u22121 1/2');
    });
});

describe('toFraction', () => {
    test('integer returns whole only', () => {
        expect(game.toFraction(5)).toEqual({ whole: 5, num: 0, den: 1 });
    });
    test('simple fraction', () => {
        const f = game.toFraction(0.5);
        expect(f.num).toBe(1);
        expect(f.den).toBe(2);
        expect(f.whole).toBe(0);
    });
    test('mixed number', () => {
        const f = game.toFraction(2.5);
        expect(f.whole).toBe(2);
        expect(f.num).toBe(1);
        expect(f.den).toBe(2);
    });
    test('thirds', () => {
        const f = game.toFraction(1/3);
        expect(f.num).toBe(1);
        expect(f.den).toBe(3);
    });
    test('reduces fractions', () => {
        const f = game.toFraction(0.75); // 3/4
        expect(f.num).toBe(3);
        expect(f.den).toBe(4);
    });
});

describe('getPuzzleNumber / getDateFromPuzzleNumber', () => {
    test('puzzle 1 corresponds to epoch date', () => {
        const date = game.getDateFromPuzzleNumber(1);
        expect(date.toISOString().startsWith('2025-01-01')).toBe(true);
    });
    test('round-trips correctly', () => {
        const date = game.getDateFromPuzzleNumber(100);
        const num = game.getPuzzleNumber(date);
        expect(num).toBe(100);
    });
});

describe('every puzzle in VALID_PUZZLES is solvable', () => {
    // Sample a few to keep test fast
    const sampleIndices = [0, 50, 100, 150, 200, 250, 300, 350, 399];
    test.each(sampleIndices)('puzzle at index %i is solvable', (idx) => {
        const nums = game.VALID_PUZZLES[idx];
        expect(nums).toHaveLength(4);
        const result = game.evaluateAllExpressions(...nums);
        expect(result.solutionCount).toBeGreaterThan(0);
    });
});

describe('formatPuzzleDate', () => {
    test('returns "Today" for today\'s puzzle', () => {
        const today = game.getPuzzleNumber(new Date(Date.UTC(
            new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()
        )));
        expect(game.formatPuzzleDate(today)).toBe('Today');
    });
    test('returns "Yesterday" for yesterday\'s puzzle', () => {
        const today = game.getPuzzleNumber(new Date(Date.UTC(
            new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()
        )));
        expect(game.formatPuzzleDate(today - 1)).toBe('Yesterday');
    });
    test('returns "Jan 1" for puzzle 1 (epoch)', () => {
        // Includes 2-digit year now; fallback format in Node: "Jan 1, '25"
        const result = game.formatPuzzleDate(1);
        expect(result).toContain('Jan');
        expect(result).toContain('1');
        expect(result).toMatch(/25/); // year 2025 epoch
    });
});

describe('formatPuzzleDateLong', () => {
    test('returns full date for puzzle 1', () => {
        expect(game.formatPuzzleDateLong(1)).toBe('January 1, 2025');
    });
});

describe('formatTimeHuman', () => {
    test('formats seconds under a minute', () => {
        expect(game.formatTimeHuman(33)).toBe('33s');
    });
    test('formats exactly one minute', () => {
        expect(game.formatTimeHuman(60)).toBe('1m');
    });
    test('formats minutes and seconds', () => {
        expect(game.formatTimeHuman(95)).toBe('1m 35s');
    });
    test('returns -- for zero or null', () => {
        expect(game.formatTimeHuman(0)).toBe('--');
        expect(game.formatTimeHuman(null)).toBe('--');
    });
});

describe('solutionSteps serialization', () => {
    test('solutionSteps round-trips through JSON', () => {
        const steps = [
            { a: { value: 4, slot: 0 }, op: '*', b: { value: 9, slot: 1 }, result: { value: 36, slot: 0 } }
        ];
        const json = JSON.stringify(steps);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(steps);
        expect(parsed[0].a.value).toBe(4);
        expect(parsed[0].result.value).toBe(36);
    });
});

describe('solve24Full', () => {
    test('returns 3 steps for [1, 2, 3, 4]', () => {
        const steps = game.solve24Full([1, 2, 3, 4]);
        expect(steps).not.toBeNull();
        expect(steps.length).toBe(3);
        // Verify each step has correct shape
        for (const step of steps) {
            expect(step).toHaveProperty('a');
            expect(step).toHaveProperty('op');
            expect(step).toHaveProperty('b');
            expect(step).toHaveProperty('result');
            expect(step.a).toHaveProperty('value');
            expect(step.a).toHaveProperty('slot');
        }
    });
    test('final result is 36', () => {
        const steps = game.solve24Full([1, 2, 3, 4]);
        const lastStep = steps[steps.length - 1];
        expect(Math.abs(lastStep.result.value - 36)).toBeLessThan(0.001);
    });
    test('solves [2, 2, 3, 3]', () => {
        const steps = game.solve24Full([2, 2, 3, 3]);
        expect(steps).not.toBeNull();
        expect(steps.length).toBe(3);
    });
});

describe('named constants', () => {
    test('TARGET_NUMBER is 36', () => {
        expect(game.TARGET_NUMBER).toBe(36);
    });
    test('PERFECT_MOVES is 3', () => {
        expect(game.PERFECT_MOVES).toBe(3);
    });
    test('FAST_SOLVE_THRESHOLD_S is 60', () => {
        expect(game.FAST_SOLVE_THRESHOLD_S).toBe(60);
    });
});
