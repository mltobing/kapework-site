// Prevent iOS overscroll artifacts
document.addEventListener('touchmove', function(e) {
    if (e.target.closest('.archive-list') || e.target.closest('.modal')) return;
    e.preventDefault();
}, { passive: false });

document.body.addEventListener('touchmove', function(e) {
    if (e.target.closest('.archive-list') || e.target.closest('.modal')) return;
    e.preventDefault();
}, { passive: false });

// ============================================================
// CONFIG
// ============================================================
const APP_CONFIG = {
    publicUrl: 'https://make24.app/',
    shareLabel: 'make24.app'
};

// Supabase config
const SUPABASE_URL = 'https://fimsbfcvavpehryvvcho.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpbXNiZmN2YXZwZWhyeXZ2Y2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzOTEwMDMsImV4cCI6MjA3MDk2NzAwM30.6uAm_bDPN9aetYaKWA7zCvS8XDEVhmKKxA7RA7YK4JQ';

// Supabase client (auth-aware)
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// NAMED CONSTANTS (replaces magic numbers)
// ============================================================
const STORAGE_KEY = 'make24_v5';
const ARCHIVE_PAGE_SIZE = 30;
const STREAK_FREEZE_INTERVAL = 7;
const PERFECT_MOVES = 3;
const HINT_DELAY_MS = 30000;         // 30 seconds before hint appears
const HISTORY_SHARE_DAYS = 24;
const FAST_SOLVE_THRESHOLD_S = 60;   // seconds for "fast" perfect
const WRONG_ANSWER_RESET_MS = 800;   // delay before resetting wrong answer
const CONFETTI_COUNT = 60;
const CONFETTI_DURATION_MS = 3000;
const WIN_MODAL_DELAY_MS = 500;
const ARCHIVE_WIN_MODAL_DELAY_MS = 300;
const NUDGE_SHOW_DELAY_MS = 1200;
const NUDGE_HIDE_DELAY_MS = 8000;
const SHAKE_THRESHOLD = 25;
const SHAKE_TIMEOUT_MS = 800;
const EPOCH_DATE = '2025-01-01T00:00:00Z';
const PUZZLE_SEED_MULTIPLIER = 12345;
const SOLUTION_THRESHOLD_EASY = 20;
const SOLUTION_THRESHOLD_MEDIUM = 6;
const TARGET_NUMBER = 24;
const FLOAT_EPSILON = 0.0001;

// ============================================================
// GAME STATE
// ============================================================
let gameState = {
    deviceId: null,
    streak: 0,
    freezes: 0,
    lastPlayedDate: null,
    history: {},
};

let currentPuzzle = {
    numbers: [],
    puzzleNum: 0,
    date: null,
    isArchive: false
};

let playState = {
    cards: [],
    selected: [],
    moves: 0,
    cardStates: [],
    operatorHistory: [],
    solutionSteps: [],   // [{a:{value,slot}, op, b:{value,slot}, result:{value,slot}}]
    replaySequence: [],  // full replay: {type:'merge',...step} or {type:'undo',...step}
    undoCount: 0,
    startTime: null,
    endTime: null,
    completed: false,
    hinted: false,
};

// Hint system state
let hintTimer = null;
let hintVisible = false;

// Valid solvable puzzles
const VALID_PUZZLES = [[5,6,7,9],[1,6,8,9],[4,8,9,9],[1,5,8,9],[2,3,4,7],[1,7,8,8],[3,6,7,8],[4,6,6,7],[2,5,6,7],[1,3,3,4],[1,4,4,6],[1,1,6,9],[2,4,6,9],[1,5,6,7],[1,3,4,4],[1,1,5,8],[1,3,7,8],[2,4,4,6],[3,3,4,4],[2,3,5,8],[2,3,4,4],[1,1,3,4],[3,4,6,8],[1,3,8,8],[6,8,8,9],[6,6,6,6],[4,6,6,9],[4,5,5,8],[1,5,7,8],[1,1,6,6],[2,6,6,6],[1,4,8,8],[4,4,4,6],[1,2,6,9],[2,4,4,7],[5,5,9,9],[1,4,5,9],[5,5,5,6],[1,2,4,5],[2,2,2,7],[3,5,7,8],[2,5,5,8],[1,2,3,8],[3,4,5,7],[5,7,8,9],[1,4,6,8],[1,3,3,6],[2,2,2,9],[3,3,7,9],[3,3,6,7],[1,3,4,8],[1,1,4,4],[1,4,4,9],[2,2,3,4],[1,4,5,6],[1,2,5,9],[1,1,1,8],[2,3,3,9],[3,4,9,9],[2,5,8,9],[4,4,6,9],[2,2,7,8],[4,5,5,7],[3,6,6,6],[1,2,6,8],[2,6,6,7],[2,6,6,8],[1,2,5,6],[2,6,7,8],[2,4,6,7],[3,3,3,4],[5,5,5,9],[3,8,9,9],[3,4,4,7],[2,2,4,7],[3,7,7,8],[3,3,3,6],[3,6,7,9],[4,6,6,6],[1,2,6,7],[1,1,4,8],[3,4,6,9],[2,3,9,9],[2,2,3,8],[5,5,8,8],[1,1,8,8],[2,2,5,9],[3,3,3,9],[3,7,7,7],[3,3,6,8],[5,5,8,9],[4,6,9,9],[1,4,4,5],[4,4,5,5],[6,6,6,8],[3,7,8,8],[3,9,9,9],[2,5,6,8],[3,3,4,6],[6,6,7,9],[2,4,5,5],[1,5,8,8],[1,1,3,8],[2,2,3,5],[1,3,5,6],[1,6,6,8],[1,4,5,7],[2,4,5,8],[1,2,2,6],[2,4,7,7],[2,2,3,9],[3,3,3,5],[1,5,6,9],[2,2,5,6],[1,4,5,5],[2,8,9,9],[5,6,6,9],[3,5,8,9],[1,4,6,9],[2,5,7,8],[3,6,8,8],[4,5,5,9],[1,2,3,5],[3,4,7,9],[5,5,6,7],[2,4,6,8],[4,5,8,8],[4,7,7,7],[2,4,7,8],[1,2,5,5],[4,5,6,8],[3,6,7,7],[1,3,4,7],[2,3,4,8],[1,3,7,7],[2,3,4,5],[2,2,2,4],[1,3,3,5],[1,2,3,4],[2,2,6,8],[3,3,5,7],[1,2,4,9],[1,1,2,8],[5,6,6,8],[3,6,6,7],[1,3,8,9],[1,3,6,7],[1,1,2,6],[4,5,6,7],[1,2,5,7],[2,4,5,6],[2,4,7,9],[1,1,2,9],[6,8,8,8],[1,2,3,6],[1,1,5,7],[6,6,6,9],[3,7,9,9],[3,6,6,9],[3,6,6,8],[1,3,5,8],[2,3,6,9],[1,2,4,8],[2,3,5,7],[2,5,5,7],[3,3,9,9],[4,4,5,6],[2,2,5,7],[1,8,8,8],[2,4,5,7],[4,5,7,7],[1,6,9,9],[1,1,4,7],[1,7,8,9],[1,3,4,9],[3,3,5,5],[1,2,8,8],[5,6,9,9],[1,3,4,5],[6,8,9,9],[3,5,6,6],[2,2,4,9],[3,5,5,9],[4,4,8,8],[2,3,3,7],[4,4,4,8],[6,7,8,9],[1,3,6,6],[3,3,6,6],[4,4,7,9],[1,1,2,7],[4,7,7,8],[3,3,4,9],[1,6,6,9],[2,2,4,5],[1,2,8,9],[3,4,4,5],[1,5,9,9],[2,4,4,9],[2,3,3,5],[3,6,8,9],[2,4,6,6],[3,4,5,8],[3,3,4,5],[1,2,3,7],[2,2,6,9],[2,3,8,9],[2,3,7,7],[2,5,5,9],[1,2,6,6],[1,2,2,5],[5,8,8,8],[3,4,5,6],[1,4,5,8],[1,3,6,8],[4,6,6,8],[3,3,8,9],[2,2,3,6],[2,4,8,9],[3,3,7,8],[1,8,8,9],[4,5,7,9],[7,8,8,9],[5,8,8,9],[2,7,8,8],[1,4,4,7],[3,3,3,7],[3,5,8,8],[1,2,7,7],[1,3,3,9],[2,5,8,8],[1,2,4,7],[2,3,4,9],[2,7,8,9],[1,3,9,9],[2,2,5,8],[3,3,3,8],[3,7,7,9],[4,5,8,9],[5,6,8,8],[2,3,3,3],[1,2,5,8],[2,3,5,9],[1,2,2,7],[1,4,6,6],[3,8,8,8],[4,5,9,9],[3,5,5,6],[1,4,6,7],[3,3,7,7],[4,4,5,8],[1,1,3,5],[1,1,5,5],[1,2,3,3],[1,5,5,6],[1,6,8,8],[1,3,5,7],[1,3,7,9],[2,2,4,4],[1,6,6,6],[3,3,8,8],[1,1,4,9],[1,2,3,9],[2,5,6,6],[5,5,6,8],[3,5,6,8],[4,4,4,9],[2,7,7,8],[3,5,5,8],[4,5,7,8],[2,3,7,8],[2,3,8,8],[3,4,6,6],[3,4,4,6],[4,4,4,5],[4,6,8,9],[2,3,7,9],[3,8,8,9],[4,4,7,8],[1,4,7,9],[4,6,8,8],[2,2,4,6],[6,6,8,9],[3,3,4,7],[5,6,7,8],[1,5,5,9],[1,1,3,6],[4,6,7,9],[3,6,9,9],[4,7,8,8],[2,2,2,8],[1,2,7,8],[4,4,4,4],[2,4,4,5],[4,8,8,9],[2,5,6,9],[1,4,7,8],[4,6,7,7],[2,3,4,6],[5,5,7,7],[1,1,3,7],[2,2,6,6],[3,3,5,6],[5,5,6,6],[4,6,7,8],[2,2,8,9],[2,4,4,8],[4,7,8,9],[1,2,2,4],[2,3,6,6],[4,4,7,7],[3,5,7,9],[3,4,4,9],[2,4,5,9],[1,5,7,9],[2,6,6,9],[6,6,8,8],[2,2,8,8],[1,4,4,4],[4,5,6,6],[4,4,8,9],[3,7,8,9],[3,4,7,8],[3,5,9,9],[6,7,9,9],[1,7,7,9],[3,4,4,8],[3,4,4,4],[5,7,8,8],[3,5,5,7],[2,5,7,7],[1,3,6,9],[2,2,6,7],[5,5,5,5],[3,3,4,8],[4,7,9,9],[5,6,7,7],[2,8,8,9],[3,4,8,9],[3,3,3,3],[1,4,7,7],[2,3,6,8],[1,5,6,8],[1,4,4,8],[2,2,5,5],[3,3,5,9],[2,5,7,9],[2,4,8,8],[2,2,2,5],[2,4,4,4],[2,6,8,9],[1,7,9,9],[1,3,5,9],[2,3,3,6],[2,6,9,9],[4,4,6,8],[2,3,5,5],[2,2,7,7],[3,5,6,9],[2,6,8,8],[2,3,5,6],[4,5,5,6],[1,3,3,7],[5,6,6,7],[5,5,7,8],[5,6,6,6],[1,2,4,4],[1,4,8,9],[4,5,5,5],[2,3,6,7],[2,2,3,3],[1,1,4,6],[4,4,4,7],[2,3,3,8],[3,4,5,5],[2,4,9,9],[2,2,3,7],[4,5,6,9],[1,5,6,6],[1,1,3,9],[2,2,4,8],[3,3,6,9],[3,4,7,7],[2,8,8,8],[1,1,6,8],[1,6,7,9],[5,7,7,9],[3,5,6,7],[2,2,2,3],[1,5,5,5],[1,2,2,8],[1,2,2,9],[4,4,5,7],[1,3,3,3],[1,3,4,6],[1,2,7,9],[3,4,5,9],[2,6,7,9],[1,1,5,6],[1,1,4,5],[1,3,3,8],[4,8,8,8],[1,2,4,6],[5,6,8,9]];

// ============================================================
// DIFFICULTY SCORING ENGINE
// ============================================================
function evaluateAllExpressions(a, b, c, d) {
    const ops = ['+', '-', '*', '/'];
    const nums = [a, b, c, d];
    const perms = [];
    for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) if (j !== i)
            for (let k = 0; k < 4; k++) if (k !== i && k !== j)
                for (let l = 0; l < 4; l++) if (l !== i && l !== j && l !== k)
                    perms.push([nums[i], nums[j], nums[k], nums[l]]);

    let solutionCount = 0;
    let hasDivision = false;
    let hasNonInteger = false;

    for (const perm of perms) {
        const [w, x, y, z] = perm;
        for (const o1 of ops) for (const o2 of ops) for (const o3 of ops) {
            const r1 = calc(w, o1, x);
            if (r1 === null) continue;
            const r2 = calc(r1, o2, y);
            if (r2 === null) continue;
            const r3 = calc(r2, o3, z);
            if (r3 !== null && Math.abs(r3 - TARGET_NUMBER) < FLOAT_EPSILON) {
                solutionCount++;
                if (o1 === '/' || o2 === '/' || o3 === '/') hasDivision = true;
                if (!Number.isInteger(r1) || !Number.isInteger(r2)) hasNonInteger = true;
            }

            const s1 = calc(w, o1, x);
            if (s1 === null) continue;
            const s2 = calc(y, o2, z);
            if (s2 === null) continue;
            const s3 = calc(s1, o3, s2);
            if (s3 !== null && Math.abs(s3 - TARGET_NUMBER) < FLOAT_EPSILON) {
                solutionCount++;
                if (o1 === '/' || o2 === '/' || o3 === '/') hasDivision = true;
                if (!Number.isInteger(s1) || !Number.isInteger(s2)) hasNonInteger = true;
            }
        }
    }
    return { solutionCount, hasDivision, hasNonInteger };
}

function calc(a, op, b) {
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
    }
}

function getPuzzleDifficulty(numbers) {
    const result = evaluateAllExpressions(...numbers);
    if (result.solutionCount >= SOLUTION_THRESHOLD_EASY) return { level: 'easy', label: 'Easy', emoji: '\uD83E\uDDE9' };
    if (result.solutionCount >= SOLUTION_THRESHOLD_MEDIUM) return { level: 'medium', label: 'Medium', emoji: '\uD83E\uDDE9\uD83E\uDDE9' };
    return { level: 'hard', label: 'Hard', emoji: '\uD83E\uDDE9\uD83E\uDDE9\uD83E\uDDE9' };
}

const difficultyCache = {};
function getCachedDifficulty(puzzleNum) {
    if (!difficultyCache[puzzleNum]) {
        const nums = generatePuzzle(puzzleNum);
        difficultyCache[puzzleNum] = getPuzzleDifficulty(nums);
    }
    return difficultyCache[puzzleNum];
}

// ============================================================
// HINT SYSTEM
// ============================================================
function findHintForPuzzle(numbers) {
    const ops = ['+', '-', '*', '/'];
    const opSymbols = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };
    for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
            for (const op of ops) {
                const orderings = (op === '+' || op === '*') ?
                    [[numbers[i], numbers[j]]] :
                    [[numbers[i], numbers[j]], [numbers[j], numbers[i]]];

                for (const [a, b] of orderings) {
                    const r = calc(a, op, b);
                    if (r === null) continue;
                    const remaining = numbers.filter((_, idx) => idx !== i && idx !== j);
                    remaining.push(r);
                    // Verify with the full solver to avoid false positives
                    if (solve24Full(remaining) !== null) {
                        return `${a} ${opSymbols[op]} ${b}`;
                    }
                }
            }
        }
    }
    return null;
}

function canMake24From3(nums) {
    const ops = ['+', '-', '*', '/'];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) if (j !== i) {
            for (let k = 0; k < 3; k++) if (k !== i && k !== j) {
                const [a, b, c] = [nums[i], nums[j], nums[k]];
                for (const o1 of ops) for (const o2 of ops) {
                    const r1 = calc(a, o1, b);
                    if (r1 !== null) {
                        const r2 = calc(r1, o2, c);
                        if (r2 !== null && Math.abs(r2 - TARGET_NUMBER) < FLOAT_EPSILON) return true;
                    }
                    const s1 = calc(b, o2, c);
                    if (s1 !== null) {
                        const s2 = calc(a, o1, s1);
                        if (s2 !== null && Math.abs(s2 - TARGET_NUMBER) < FLOAT_EPSILON) return true;
                    }
                }
            }
        }
    }
    return false;
}

// Full solver that returns solutionSteps in replay format
function solve24Full(numbers) {
    const ops = ['+', '-', '*', '/'];

    // Try all pairs, compute result, recurse on remaining 3 then 2 numbers
    function solveRecursive(cards) {
        if (cards.length === 1) {
            if (Math.abs(cards[0].value - TARGET_NUMBER) < FLOAT_EPSILON) return [];
            return null;
        }
        for (let i = 0; i < cards.length; i++) {
            for (let j = 0; j < cards.length; j++) {
                if (i === j) continue;
                for (const op of ops) {
                    const r = calc(cards[i].value, op, cards[j].value);
                    if (r === null) continue;
                    const remaining = cards.filter((_, idx) => idx !== i && idx !== j);
                    const resultCard = { value: r, slot: cards[i].slot };
                    remaining.push(resultCard);
                    const rest = solveRecursive(remaining);
                    if (rest !== null) {
                        return [{
                            a: { value: cards[i].value, slot: cards[i].slot },
                            op: op,
                            b: { value: cards[j].value, slot: cards[j].slot },
                            result: { value: r, slot: cards[i].slot }
                        }, ...rest];
                    }
                }
            }
        }
        return null;
    }

    const cards = numbers.map((v, i) => ({ value: v, slot: i }));
    return solveRecursive(cards);
}

function startHintTimer() {
    clearHintTimer();
    hintVisible = false;
    document.getElementById('hintBtn').classList.remove('visible');
    document.getElementById('hintDisplay').classList.remove('visible');
    document.getElementById('hintDisplay').textContent = '';
    if (playState.completed) return;
    hintTimer = setTimeout(() => {
        if (!playState.completed && playState.moves === 0) {
            document.getElementById('hintBtn').classList.add('visible');
            hintVisible = true;
        }
    }, HINT_DELAY_MS);
}

function clearHintTimer() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
}

function useHint() {
    if (playState.completed || playState.hinted) return;
    const remaining = playState.cards.filter(c => !c.used).map(c => c.value);
    let hintText;
    if (remaining.length === 4) {
        hintText = findHintForPuzzle(remaining);
    } else {
        hintText = null;
    }
    if (hintText) {
        playState.hinted = true;
        document.getElementById('hintDisplay').textContent = hintText;
        document.getElementById('hintDisplay').classList.add('visible');
        document.getElementById('hintBtn').classList.remove('visible');
        clearHintTimer();
    }
}

// ============================================================
// SYNC ERROR SURFACING
// ============================================================
function showSyncError(message) {
    const toast = document.getElementById('syncErrorToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 5000);
}

// ============================================================
// AUTH — guest-first, Google + email OTP code
// ============================================================
const NUDGE_DISMISSED_KEY = 'make24_sync_nudge_dismissed';
const STREAK_NUDGE_MILESTONES = [3, 7, 14];
let pendingOtpEmail = null;

async function updateSyncUI() {
    const syncSection = document.getElementById('syncSection');
    const syncLabel = document.getElementById('syncLabel');
    const syncMethods = document.getElementById('syncMethods');
    const signedInView = document.getElementById('syncSignedInView');
    const syncStatus = document.getElementById('syncStatus');
    if (!syncSection) return;

    const { data: { session } } = await sb.auth.getSession();
    const email = session?.user?.email;

    if (email) {
        syncSection.classList.add('signed-in');
        syncLabel.textContent = `Synced as ${email}`;
        syncMethods.style.display = 'none';
        signedInView.style.display = 'block';
        syncStatus.textContent = '';
        syncStatus.className = 'sync-status';
    } else {
        syncSection.classList.remove('signed-in');
        syncLabel.textContent = 'Keep your streak across devices';
        syncMethods.style.display = 'flex';
        signedInView.style.display = 'none';
        // Reset OTP UI
        document.getElementById('emailOtpRow').style.display = 'flex';
        document.getElementById('otpVerifyRow').classList.remove('visible');
        document.getElementById('otpEmailInput').value = '';
        document.getElementById('otpCodeInput').value = '';
        pendingOtpEmail = null;
    }
}

// Google sign-in via popup (stays in PWA context)
async function signInWithGoogle() {
    const status = document.getElementById('syncStatus');
    status.textContent = 'Opening Google sign-in...';
    status.className = 'sync-status';

    const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.href,
            queryParams: { prompt: 'select_account' }
        }
    });

    if (error) {
        status.textContent = error.message;
        status.className = 'sync-status error';
    }
}

// Email OTP: send code
async function sendOtpCode() {
    const emailInput = document.getElementById('otpEmailInput');
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
        const status = document.getElementById('syncStatus');
        status.textContent = 'Please enter a valid email.';
        status.className = 'sync-status error';
        return;
    }

    const sendBtn = document.getElementById('otpSendBtn');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    const status = document.getElementById('syncStatus');
    status.textContent = '';
    status.className = 'sync-status';

    const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
            shouldCreateUser: true
        }
    });

    if (error) {
        status.textContent = error.message;
        status.className = 'sync-status error';
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send code';
        return;
    }

    pendingOtpEmail = email;
    status.textContent = 'Code sent! Check your email (and spam).';
    status.className = 'sync-status success';

    // Show code entry row, hide email row
    document.getElementById('emailOtpRow').style.display = 'none';
    document.getElementById('otpVerifyRow').classList.add('visible');
    document.getElementById('otpCodeInput').focus();

    sendBtn.disabled = false;
    sendBtn.textContent = 'Send code';
}

// Email OTP: verify code
async function verifyOtpCode() {
    const codeInput = document.getElementById('otpCodeInput');
    const code = codeInput.value.trim();
    const status = document.getElementById('syncStatus');

    if (!code || code.length < 6) {
        status.textContent = 'Enter the 6-digit code from your email.';
        status.className = 'sync-status error';
        return;
    }

    if (!pendingOtpEmail) {
        status.textContent = 'Session expired. Please send a new code.';
        status.className = 'sync-status error';
        document.getElementById('emailOtpRow').style.display = 'flex';
        document.getElementById('otpVerifyRow').classList.remove('visible');
        return;
    }

    const verifyBtn = document.getElementById('otpVerifyBtn');
    verifyBtn.disabled = true;
    verifyBtn.textContent = '...';

    const { error } = await sb.auth.verifyOtp({
        email: pendingOtpEmail,
        token: code,
        type: 'email'
    });

    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Verify';

    if (error) {
        status.textContent = error.message;
        status.className = 'sync-status error';
    } else {
        status.textContent = 'Signed in! Syncing your data...';
        status.className = 'sync-status success';
        // Drive the full sync explicitly — don't rely solely on onAuthStateChange
        await updateSyncUI();
        await ensureCanonicalDeviceId();
        await syncFromSupabase();
        await syncHistoryFromSupabase();
        updateStreak();
        reconcileStreakFromHistory();
        // Re-init today's puzzle with synced state
        const today = getTodayPuzzleNumber();
        if (!currentPuzzle.isArchive && currentPuzzle.puzzleNum === today) {
            initPuzzle(today, false);
        }
    }
}

async function promptSignOut() {
    const ok = confirm('Sign out? (Your local history stays on this device.)');
    if (!ok) return;
    console.log('[SYNC DEBUG] promptSignOut: user confirmed, calling sb.auth.signOut()');
    try {
        const { error } = await sb.auth.signOut();
        console.log('[SYNC DEBUG] signOut returned — error:', JSON.stringify(error));
        if (error) {
            console.error('[SYNC DEBUG] signOut returned error, trying local scope:', JSON.stringify(error));
            // If global sign-out fails (e.g. network/token issue), force local sign-out
            const { error: localErr } = await sb.auth.signOut({ scope: 'local' });
            if (localErr) {
                console.error('[SYNC DEBUG] local signOut also failed:', JSON.stringify(localErr));
                alert('Sign-out failed: ' + error.message);
            }
        }
    } catch (e) {
        console.error('[SYNC DEBUG] signOut threw exception:', e);
        // Force local sign-out even if global threw
        try {
            await sb.auth.signOut({ scope: 'local' });
            console.log('[SYNC DEBUG] local signOut succeeded after exception');
        } catch (e2) {
            console.error('[SYNC DEBUG] local signOut also threw:', e2);
            alert('Sign-out failed: ' + (e.message || e));
        }
    }
    await updateSyncUI();
}

// Nudge: gentle toast at streak milestones
async function maybeShowSyncNudge() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) return;

    const dismissed = localStorage.getItem(NUDGE_DISMISSED_KEY);
    if (dismissed === 'forever') return;

    const streak = gameState.streak;
    if (!STREAK_NUDGE_MILESTONES.includes(streak)) return;

    const shownKey = `make24_nudge_shown_${streak}`;
    if (localStorage.getItem(shownKey)) return;
    localStorage.setItem(shownKey, '1');

    const nudge = document.getElementById('syncNudge');
    setTimeout(() => nudge.classList.add('visible'), NUDGE_SHOW_DELAY_MS);
    setTimeout(() => nudge.classList.remove('visible'), NUDGE_HIDE_DELAY_MS);
}

function dismissSyncNudge() {
    const nudge = document.getElementById('syncNudge');
    nudge.classList.remove('visible');
    localStorage.setItem(NUDGE_DISMISSED_KEY, 'forever');
}

// Nudge link opens the archive modal (where the sign-in lives for now)
function nudgeOpenSignIn() {
    dismissSyncNudge();
    document.getElementById('settingsModal').classList.add('show');
}

async function getAuthHeaders() {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token || SUPABASE_KEY;
    return {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`
    };
}

async function ensureCanonicalDeviceId() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        console.log('[SYNC DEBUG] ensureCanonicalDeviceId: no session, skipping');
        return;
    }
    const localId = getDeviceId();
    console.log('[SYNC DEBUG] ensureCanonicalDeviceId CALLING get_or_set_device_id with localId:', localId, 'auth user:', session.user.id);
    try {
        const { data, error } = await sb.rpc('get_or_set_device_id', { p_device_id: localId });
        console.log('[SYNC DEBUG] get_or_set_device_id RETURNED — data:', JSON.stringify(data), 'error:', JSON.stringify(error));
        if (error) {
            console.error('[SYNC DEBUG] get_or_set_device_id FAILED:', JSON.stringify(error));
            // Fallback: the RPC likely failed because a row already exists for this user
            // (e.g. 23505 duplicate key). Query user_devices directly to get the canonical
            // device_id so sync functions can find the right player row.
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(
                    `${SUPABASE_URL}/rest/v1/user_devices?user_id=eq.${session.user.id}&select=device_id&limit=1`,
                    { headers }
                );
                if (res.ok) {
                    const rows = await res.json();
                    console.log('[SYNC DEBUG] user_devices direct lookup returned:', JSON.stringify(rows));
                    if (rows && rows.length > 0 && rows[0].device_id) {
                        const canonicalId = rows[0].device_id;
                        if (canonicalId !== localId) {
                            localStorage.setItem('make24_device_id', canonicalId);
                            gameState.deviceId = canonicalId;
                            saveState();
                            console.log('[SYNC DEBUG] Adopted canonical device ID from user_devices:', canonicalId, '(was:', localId, ')');
                        }
                    }
                } else {
                    console.error('[SYNC DEBUG] user_devices direct lookup failed:', res.status, await res.text());
                }
            } catch (fe) {
                console.error('[SYNC DEBUG] user_devices direct lookup exception:', fe);
            }
            await registerDeviceFallback(session.user.id, localId);
            return;
        }
        const canonicalId = data;
        console.log('[SYNC DEBUG] canonicalId:', canonicalId, 'localId:', localId, 'match:', canonicalId === localId);
        if (canonicalId && canonicalId !== localId) {
            // Server returned a different canonical ID — adopt it
            localStorage.setItem('make24_device_id', canonicalId);
            gameState.deviceId = canonicalId;
            saveState();
            console.log('[SYNC DEBUG] Adopted canonical device ID:', canonicalId, '(was:', localId, ')');
            // Also register the local device ID so user_devices knows about this device
            await registerDeviceFallback(session.user.id, localId);
        }
    } catch (e) { console.error('[SYNC DEBUG] ensureCanonicalDeviceId exception:', e); }
}

// Fallback: directly insert into user_devices if the RPC didn't register this device.
// The server-side get_or_set_device_id returns the canonical ID for existing users
// but may not insert a new row for the second device.
async function registerDeviceFallback(userId, deviceId) {
    console.log('[SYNC DEBUG] registerDeviceFallback: inserting device_id:', deviceId, 'for user:', userId);
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${SUPABASE_URL}/rest/v1/user_devices`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'resolution=ignore-duplicates' },
            body: JSON.stringify({ user_id: userId, device_id: deviceId })
        });
        if (!response.ok) {
            const body = await response.text();
            console.error('[SYNC DEBUG] registerDeviceFallback FAILED:', response.status, body);
        } else {
            console.log('[SYNC DEBUG] registerDeviceFallback OK:', response.status);
        }
    } catch (e) {
        console.error('[SYNC DEBUG] registerDeviceFallback exception:', e);
    }
}

async function syncFromSupabase() {
    try {
        const headers = await getAuthHeaders();
        const { data: { session } } = await sb.auth.getSession();
        console.log('[SYNC DEBUG] syncFromSupabase START — gameState.deviceId:', gameState.deviceId, 'auth user:', session?.user?.id || 'none');

        // When logged in, try to find the player by auth user_id first.
        // This ensures a second device sees the same player row (and streak)
        // even if ensureCanonicalDeviceId failed to register it.
        let player = null;
        if (session?.user?.id) {
            const userUrl = `${SUPABASE_URL}/rest/v1/players?user_id=eq.${session.user.id}&select=id,current_streak,streak,freezes,device_id&limit=1`;
            console.log('[SYNC DEBUG] syncFromSupabase: querying players by user_id:', session.user.id);
            const userRes = await fetch(userUrl, { headers });
            if (userRes.ok) {
                const rows = await userRes.json();
                console.log('[SYNC DEBUG] syncFromSupabase: user_id query returned', rows.length, 'rows:', JSON.stringify(rows));
                if (rows && rows.length > 0) {
                    player = rows[0];
                    // Adopt the canonical device_id from the existing player row
                    // so that future syncs and trackPlay calls use the right ID
                    if (player.device_id && player.device_id !== gameState.deviceId) {
                        console.log('[SYNC DEBUG] syncFromSupabase: adopting canonical device_id from player row:', player.device_id, '(was:', gameState.deviceId, ')');
                        localStorage.setItem('make24_device_id', player.device_id);
                        gameState.deviceId = player.device_id;
                        saveState();
                    }
                }
            } else {
                console.log('[SYNC DEBUG] syncFromSupabase: user_id query failed:', userRes.status);
            }
        }

        // Fallback: look up by device_id (anonymous play, or user_id lookup failed)
        if (!player) {
            console.log('[SYNC DEBUG] syncFromSupabase: FALLBACK — querying get_or_create_player with device_id:', gameState.deviceId);
            const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_or_create_player`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ p_device_id: gameState.deviceId })
            });
            if (!response.ok) {
                showSyncError('Could not sync streak — server returned an error.');
                return;
            }
            player = await response.json();
            console.log('[SYNC DEBUG] syncFromSupabase: fallback player:', JSON.stringify(player));
        }

        const serverStreak = Number(player?.current_streak ?? player?.streak ?? 0);
        const serverFreezes = Number(player?.freezes ?? 0);
        const localStreak = Number(gameState.streak ?? 0);
        console.log('[SYNC DEBUG] syncFromSupabase: serverStreak:', serverStreak, 'localStreak:', localStreak, 'serverFreezes:', serverFreezes);
        if (localStreak === 0 || (Number.isFinite(serverStreak) && serverStreak > localStreak)) {
            gameState.streak = serverStreak;
            gameState.freezes = serverFreezes;
            saveState();
        }
        updateStreakDisplay();
    } catch (e) {
        showSyncError('Could not reach server to sync streak.');
        console.log('syncFromSupabase skipped:', e?.message || e);
    }
}

async function syncHistoryFromSupabase() {
    try {
        const headers = await getAuthHeaders();
        const { data: { session } } = await sb.auth.getSession();
        console.log('[SYNC DEBUG] syncHistoryFromSupabase START — gameState.deviceId:', gameState.deviceId, 'auth user:', session?.user?.id || 'none');

        // Step 1: Get player_id — prefer user_id lookup when logged in,
        // fall back to device_id for anonymous play
        let playerId = null;
        if (session?.user?.id) {
            const userUrl = `${SUPABASE_URL}/rest/v1/players?user_id=eq.${session.user.id}&select=id&limit=1`;
            const userRes = await fetch(userUrl, { headers });
            if (userRes.ok) {
                const rows = await userRes.json();
                console.log('[SYNC DEBUG] syncHistoryFromSupabase: user_id query returned', rows.length, 'rows');
                if (rows && rows.length > 0) playerId = rows[0].id;
            } else {
                console.log('[SYNC DEBUG] syncHistoryFromSupabase: user_id query failed:', userRes.status);
            }
        }
        if (!playerId) {
            console.log('[SYNC DEBUG] syncHistoryFromSupabase: FALLBACK — querying players by device_id:', gameState.deviceId);
            const playerUrl = `${SUPABASE_URL}/rest/v1/players?device_id=eq.${encodeURIComponent(gameState.deviceId)}&select=id&limit=1`;
            const playerRes = await fetch(playerUrl, { headers });
            if (!playerRes.ok) {
                showSyncError('Could not sync history — server returned an error.');
                return;
            }
            const players = await playerRes.json();
            console.log('[SYNC DEBUG] syncHistoryFromSupabase: device_id query returned', players.length, 'rows');
            if (!players || players.length === 0) return;
            playerId = players[0].id;
        }
        console.log('[SYNC DEBUG] syncHistoryFromSupabase: using playerId:', playerId);

        // Step 2: Get all solved puzzles from daily_results
        const url = `${SUPABASE_URL}/rest/v1/daily_results?player_id=eq.${playerId}&solved=eq.true&select=puzzle_num,moves,solve_time_seconds,operators,undos,is_perfect,is_fast&order=puzzle_num.desc&limit=500`;
        const response = await fetch(url, { headers });
        if (!response.ok) {
            showSyncError('Could not sync history — server returned an error.');
            return;
        }
        const rows = await response.json();
        if (!rows || rows.length === 0) return;

        let merged = 0;
        for (const row of rows) {
            const num = row.puzzle_num;
            const existing = gameState.history[num];
            // Only fill in missing history — never overwrite local data
            if (!existing || !existing.completed) {
                gameState.history[num] = {
                    completed: true,
                    solvedOnTime: true,
                    moves: row.moves || 0,
                    operators: row.operators || [],
                    undos: row.undos || 0,
                    solveTime: row.solve_time_seconds || 0,
                    hinted: false
                };
                merged++;
            }
        }
        // Always update lastPlayedDate to the highest completed puzzle from server
        for (const row of rows) {
            const num = row.puzzle_num;
            if (num > (gameState.lastPlayedDate || 0)) {
                gameState.lastPlayedDate = num;
            }
        }
        saveState();
        const totalRows = rows.length;
        console.log(`[SYNC DEBUG] syncHistoryFromSupabase: server returned ${totalRows} solved puzzles, merged ${merged} new entries`);
    } catch (e) {
        showSyncError('Could not reach server to sync history.');
        console.log('syncHistoryFromSupabase skipped:', e?.message || e);
    }
}

// ============================================================
// STREAK COMPUTATION FROM HISTORY (fixes streak derivation)
// ============================================================
function computeStreakFromHistory() {
    const today = getTodayPuzzleNumber();
    let streak = 0;
    for (let num = today; num >= 1; num--) {
        const entry = gameState.history[num];
        // Only count puzzles solved on their actual day (not retroactively filled)
        if (entry?.completed && entry.solvedOnTime !== false) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

function reconcileStreakFromHistory() {
    const computed = computeStreakFromHistory();
    if (computed > gameState.streak) {
        gameState.streak = computed;
    }
    // Keep lastPlayedDate in sync with history so updateStreak() doesn't reset
    const today = getTodayPuzzleNumber();
    if (gameState.history[today]?.completed) {
        gameState.lastPlayedDate = today;
    } else {
        // Find the most recent completed puzzle
        for (let num = today; num >= 1; num--) {
            if (gameState.history[num]?.completed) {
                gameState.lastPlayedDate = num;
                break;
            }
        }
    }
    saveState();
    updateStreakDisplay();
}

// ============================================================
// AUTH STATE CHANGE — re-init puzzle after sync (fixes reload bug)
// ============================================================
let bootComplete = false;

sb.auth.onAuthStateChange(async (_event, session) => {
    // During boot, boot() handles the full sync itself.
    // Only act on auth changes that happen AFTER boot (e.g. sign-in, sign-out).
    if (!bootComplete) return;
    await updateSyncUI();
    if (session) {
        await ensureCanonicalDeviceId();
        await syncFromSupabase();
        await syncHistoryFromSupabase();
        updateStreak();
        reconcileStreakFromHistory();
        // Re-init today's puzzle if state changed after sync
        const today = getTodayPuzzleNumber();
        if (!currentPuzzle.isArchive && currentPuzzle.puzzleNum === today) {
            initPuzzle(today, false);
        }
    }
});

// ============================================================
// SHAREABLE HISTORY GRID
// ============================================================
function generateHistoryImage() {
    const canvas = document.getElementById('shareCanvas');
    const ctx = canvas.getContext('2d');
    const today = getTodayPuzzleNumber();
    const days = HISTORY_SHARE_DAYS;
    const cols = 6;
    const rows = Math.ceil(days / cols);
    const cellSize = 48;
    const gap = 6;
    const padding = 24;
    const headerHeight = 60;
    const footerHeight = 44;
    const gridWidth = cols * cellSize + (cols - 1) * gap;
    const gridHeight = rows * cellSize + (rows - 1) * gap;

    canvas.width = gridWidth + padding * 2;
    canvas.height = headerHeight + gridHeight + footerHeight + padding;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#22d3ee';
    ctx.font = 'bold 18px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Make 24 \u2014 Last ${days} Days`, canvas.width / 2, 36);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '14px "DM Sans", sans-serif';
    ctx.fillText(`\uD83D\uDD25 ${gameState.streak} streak`, canvas.width / 2, 54);

    for (let i = 0; i < days; i++) {
        const num = today - i;
        if (num < 1) continue;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = padding + col * (cellSize + gap);
        const y = headerHeight + row * (cellSize + gap);

        const history = gameState.history[num];
        const completed = history?.completed;
        const isPerfect = completed && history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
        const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;

        if (isFast) ctx.fillStyle = 'rgba(251, 191, 36, 0.5)';
        else if (isPerfect) ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
        else if (completed) ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
        else ctx.fillStyle = '#1e293b';

        const r = 6;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + cellSize - r, y);
        ctx.quadraticCurveTo(x + cellSize, y, x + cellSize, y + r);
        ctx.lineTo(x + cellSize, y + cellSize - r);
        ctx.quadraticCurveTo(x + cellSize, y + cellSize, x + cellSize - r, y + cellSize);
        ctx.lineTo(x + r, y + cellSize);
        ctx.quadraticCurveTo(x, y + cellSize, x, y + cellSize - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();

        if (num === today) { ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; }
        else if (isFast || isPerfect) { ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5; }
        else if (completed) { ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1; }
        else { ctx.strokeStyle = '#334155'; ctx.lineWidth = 1; }
        ctx.stroke();

        ctx.fillStyle = '#f1f5f9';
        ctx.font = 'bold 13px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num.toString(), x + cellSize / 2, y + cellSize / 2);

        if (isFast) { ctx.font = '10px sans-serif'; ctx.fillText('\u2B50\u2B50', x + cellSize - 8, y + 8); }
        else if (isPerfect) { ctx.font = '10px sans-serif'; ctx.fillText('\u2B50', x + cellSize - 6, y + 8); }
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '12px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(APP_CONFIG.shareLabel, canvas.width / 2, headerHeight + gridHeight + 16);

    return canvas;
}

function shareHistoryGrid() {
    const canvas = generateHistoryImage();
    const today = getTodayPuzzleNumber();
    let solved = 0, perfect = 0, fastPerfect = 0;
    for (let i = 0; i < HISTORY_SHARE_DAYS; i++) {
        const num = today - i;
        const h = gameState.history[num];
        if (h?.completed) {
            solved++;
            const ip = h.moves === PERFECT_MOVES && (h.undos || 0) === 0;
            if (ip && h.solveTime && h.solveTime <= FAST_SOLVE_THRESHOLD_S) fastPerfect++;
            else if (ip) perfect++;
        }
    }

    let emojiGrid = '';
    for (let i = 0; i < HISTORY_SHARE_DAYS; i++) {
        const num = today - i;
        const h = gameState.history[num];
        if (!h?.completed) emojiGrid += '\u2B1B';
        else {
            const ip = h.moves === PERFECT_MOVES && (h.undos || 0) === 0;
            const fast = ip && h.solveTime && h.solveTime <= FAST_SOLVE_THRESHOLD_S;
            if (fast) emojiGrid += '\uD83C\uDF1F';
            else if (ip) emojiGrid += '\u2B50';
            else emojiGrid += '\uD83D\uDFE9';
        }
        if ((i + 1) % 6 === 0 && i < HISTORY_SHARE_DAYS - 1) emojiGrid += '\n';
    }

    const shareText = `Make 24 \u2014 Last ${HISTORY_SHARE_DAYS} Days\n${emojiGrid}\n\uD83D\uDD25 ${gameState.streak} | ${solved}/${HISTORY_SHARE_DAYS} solved\n${APP_CONFIG.publicUrl}`;

    canvas.toBlob(async (blob) => {
        if (blob && navigator.share && navigator.canShare) {
            const file = new File([blob], 'make24-history.png', { type: 'image/png' });
            const shareData = { text: shareText, files: [file] };
            try {
                if (navigator.canShare(shareData)) { await navigator.share(shareData); return; }
            } catch (e) { /* fall through */ }
        }
        if (navigator.share) {
            navigator.share({ text: shareText }).catch(() => copyToClipboard(shareText));
        } else { copyToClipboard(shareText); }
    }, 'image/png');
}

// ============================================================
// CHALLENGE A FRIEND
// ============================================================
function shareChallenge() {
    const puzzleNum = currentPuzzle.puzzleNum;
    const history = gameState.history[puzzleNum];
    const moves = history?.moves || playState.moves;
    const isPerfect = history?.completed && history.moves === PERFECT_MOVES && (history.undos || 0) === 0;

    let text = `\u2694\uFE0F Can you beat my Make 24?\n`;
    text += formatPuzzleDateLong(puzzleNum);
    if (isPerfect) text += ` \u2014 I got \u2B50 Perfect`;
    else text += ` \u2014 I solved it in ${moves} moves`;
    text += `\n\n${APP_CONFIG.publicUrl}`;

    if (navigator.share) {
        navigator.share({ text }).catch(() => copyToClipboard(text));
    } else { copyToClipboard(text); }
}

// ============================================================
// CORE GAME ENGINE
// ============================================================
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function getPuzzleNumber(date) {
    const epoch = new Date(EPOCH_DATE);
    const diff = date - epoch;
    return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

function getDateFromPuzzleNumber(num) {
    const epoch = new Date(EPOCH_DATE);
    return new Date(epoch.getTime() + (num - 1) * 24 * 60 * 60 * 1000);
}

function formatPuzzleDate(puzzleNum) {
    const today = getTodayPuzzleNumber();
    if (puzzleNum === today) return 'Today';
    if (puzzleNum === today - 1) return 'Yesterday';
    const d = getDateFromPuzzleNumber(puzzleNum);
    // Use the user's locale for short date with 2-digit year
    try {
        const locale = navigator.language || 'en';
        return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' });
    } catch (e) {
        // Fallback for environments without Intl (e.g. tests)
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const yr = String(d.getUTCFullYear()).slice(-2);
        return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, '${yr}`;
    }
}

function formatPuzzleDateLong(puzzleNum) {
    const d = getDateFromPuzzleNumber(puzzleNum);
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function getTodayPuzzleNumber() {
    const now = new Date();
    // Use local midnight so the puzzle changes at midnight in the user's timezone
    const localDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return getPuzzleNumber(localDate);
}

function generatePuzzle(puzzleNum) {
    const puzzleIndex = (puzzleNum - 1) % VALID_PUZZLES.length;
    const basePuzzle = VALID_PUZZLES[puzzleIndex];
    const rng = mulberry32(puzzleNum * PUZZLE_SEED_MULTIPLIER);
    const shuffled = [...basePuzzle];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function getDeviceId() {
    let id = localStorage.getItem('make24_device_id');
    if (!id) {
        id = 'dev_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        localStorage.setItem('make24_device_id', id);
    }
    return id;
}

function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) gameState = { ...gameState, ...JSON.parse(saved) };
    } catch (e) { console.error('Failed to load state:', e); }
    gameState.deviceId = getDeviceId();
}

function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState)); }
    catch (e) { console.error('Failed to save state:', e); }
}

function updateStreak() {
    const today = getTodayPuzzleNumber();
    const yesterday = today - 1;
    if (gameState.lastPlayedDate === today) return;
    if (gameState.lastPlayedDate === yesterday) { /* continues */ }
    else if (gameState.lastPlayedDate === yesterday - 1 && gameState.freezes > 0) {
        gameState.freezes--; saveState();
    } else if (gameState.lastPlayedDate && gameState.lastPlayedDate < yesterday) {
        gameState.streak = 0; saveState();
    }
    updateStreakDisplay();
}

function incrementStreak() {
    gameState.streak++;
    gameState.lastPlayedDate = currentPuzzle.puzzleNum;
    if (gameState.streak > 0 && gameState.streak % STREAK_FREEZE_INTERVAL === 0) gameState.freezes++;
    saveState();
    updateStreakDisplay();
}

function updateStreakDisplay() {
    document.getElementById('streakCount').textContent = gameState.streak;
    const freezeEl = document.getElementById('freezeIndicator');
    freezeEl.textContent = gameState.freezes > 0 ? '\u2744\uFE0F'.repeat(Math.min(gameState.freezes, 3)) : '';
}

function canUpgradeResult(puzzleNum) {
    const today = getTodayPuzzleNumber();
    if (puzzleNum === today) return true;
    const history = gameState.history[puzzleNum];
    if (history?.completed) return false;
    return true;
}

// ============================================================
// CLEAN WIN SCREEN: fade cards, show big 24
// ============================================================
function showCleanWinState() {
    const grid = document.getElementById('diamondGrid');
    grid.classList.add('win-hidden');
    const display = document.getElementById('resultDisplay');
    display.textContent = '24';
    display.className = 'result-display win-clean';
    display.style.cursor = 'pointer';
}

function clearWinState() {
    const grid = document.getElementById('diamondGrid');
    grid.classList.remove('win-hidden');
    const display = document.getElementById('resultDisplay');
    display.className = 'result-display';
    display.textContent = '';
    display.style.cursor = '';
}

function initPuzzle(puzzleNum, isArchive = false) {
    hideVictoryCard();
    hideOperators();
    clearHintTimer();
    clearWinState();

    currentPuzzle.puzzleNum = puzzleNum;
    currentPuzzle.numbers = generatePuzzle(puzzleNum);
    currentPuzzle.isArchive = isArchive;
    currentPuzzle.date = getDateFromPuzzleNumber(puzzleNum);

    const history = gameState.history[puzzleNum];
    const alreadySolved = history?.completed;

    // Locked archive puzzle
    if (alreadySolved && isArchive) {
        playState.completed = true;
        playState.moves = history.moves || 0;
        playState.operatorHistory = history.operators || [];
        playState.undoCount = history.undos || 0;
        playState.hinted = false;

        resetPlay();
        updateUI();
        showCleanWinState();

        const isPerfect = history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
        const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;

        let badge = 'Solved';
        let badgeClass = '';
        if (isFast) { badge = 'Perfect + Fast'; badgeClass = 'perfect'; }
        else if (isPerfect) { badge = 'Perfect'; badgeClass = 'perfect'; }

        setTimeout(() => {
            showVictoryCard({
                badge,
                badgeClass,
                date: formatPuzzleDateLong(puzzleNum),
                time: formatTimeHuman(history.solveTime),
                moves: String(history.moves),
                streak: String(gameState.streak),
                percentileText: ''
            });
            addDifficultyChip(puzzleNum);
        }, ARCHIVE_WIN_MODAL_DELAY_MS);
        return;
    }

    // Today's puzzle already solved
    if (alreadySolved && !isArchive) {
        playState.completed = true;
        playState.moves = history.moves || 0;
        playState.operatorHistory = history.operators || [];
        playState.undoCount = history.undos || 0;
        playState.hinted = false;
    } else {
        playState.moves = 0;
        playState.completed = false;
        playState.operatorHistory = [];
        playState.undoCount = 0;
        playState.hinted = false;
    }

    resetPlay();
    updateUI();

    if (alreadySolved && !isArchive) {
        showCleanWinState();

        const isPerfect = history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
        const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;

        let badge2 = 'Solved';
        let badgeClass2 = '';
        if (isFast) { badge2 = 'Perfect + Fast'; badgeClass2 = 'perfect'; }
        else if (isPerfect) { badge2 = 'Perfect'; badgeClass2 = 'perfect'; }

        setTimeout(() => {
            showVictoryCard({
                badge: badge2,
                badgeClass: badgeClass2,
                date: formatPuzzleDateLong(puzzleNum),
                time: formatTimeHuman(history.solveTime),
                moves: String(history.moves),
                streak: String(gameState.streak),
                percentileText: ''
            });
            addDifficultyChip(puzzleNum);
        }, ARCHIVE_WIN_MODAL_DELAY_MS);
    } else if (!alreadySolved) {
        startHintTimer();
    }
}

function showVictoryCard(opts) {
    const { badge, badgeClass, date, time, moves, streak, percentileText } = opts;
    document.getElementById('victoryBadge').textContent = badge;
    document.getElementById('victoryBadge').className = 'victory-badge' + (badgeClass ? ` ${badgeClass}` : '');
    document.getElementById('victoryDate').textContent = date;
    document.getElementById('victoryTime').textContent = time;
    document.getElementById('victoryMoves').textContent = moves;
    document.getElementById('victoryStreak').textContent = streak;
    const pEl = document.getElementById('victoryPercentile');
    pEl.textContent = percentileText || '';
    pEl.className = 'victory-percentile';
    document.getElementById('victoryBackdrop').classList.add('show');
}

function hideVictoryCard() {
    document.getElementById('victoryBackdrop').classList.remove('show');
}

function formatTimeHuman(seconds) {
    if (!seconds || seconds <= 0) return '--';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function resetPlay() {
    playState.cards = currentPuzzle.numbers.map((v, i) => ({
        value: v, used: false, slot: i
    }));
    playState.selected = [];
    playState.cardStates = [];
    playState.operatorHistory = [];
    playState.solutionSteps = [];
    playState.replaySequence = [];
    playState.undoCount = 0;
    playState.startTime = null;
    playState.endTime = null;

    document.getElementById('hintDisplay').classList.remove('visible');
    document.getElementById('hintDisplay').textContent = '';
    document.getElementById('hintBtn').classList.remove('visible');

    renderCards();
    hideOperators();
    updateResult();

    if (!playState.completed) {
        playState.startTime = Date.now();
    }
}

function renderCards() {
    const slots = ['slot0', 'slot1', 'slot2', 'slot3'];
    slots.forEach((slotId, i) => {
        const slot = document.getElementById(slotId);
        slot.innerHTML = '';
        const cardData = playState.cards.find(c => c.slot === i && !c.used);
        if (cardData) {
            const card = document.createElement('div');
            card.className = 'card';
            card.appendChild(formatNumberHTML(cardData.value));
            card.dataset.index = playState.cards.indexOf(cardData);
            const cardIndex = playState.cards.indexOf(cardData);
            if (playState.selected.includes(cardIndex)) {
                card.classList.add('selected');
                if (playState.selected[0] === cardIndex) card.classList.add('first');
                else card.classList.add('second');
            }
            card.addEventListener('click', () => selectCard(cardIndex));
            slot.appendChild(card);
        }
    });
}

function toFraction(n) {
    if (Number.isInteger(n)) return { whole: n, num: 0, den: 1 };
    const sign = n < 0 ? -1 : 1;
    const absN = Math.abs(n);
    const whole = Math.floor(absN);
    const frac = absN - whole;
    // Try denominators up to 1000 to find an exact match
    for (let den = 2; den <= 1000; den++) {
        const num = Math.round(frac * den);
        if (Math.abs(num / den - frac) < FLOAT_EPSILON) {
            // Simplify
            function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
            const g = gcd(num, den);
            const sNum = num / g;
            const sDen = den / g;
            if (sNum === 0) return { whole: sign * whole, num: 0, den: 1 };
            return { whole: sign * whole, num: sNum, den: sDen, negative: sign < 0 };
        }
    }
    return null; // Not a clean fraction
}

function formatNumber(n) {
    if (Number.isInteger(n)) return n.toString();
    const rounded = Math.round(n * 100) / 100;
    if (Number.isInteger(rounded)) return rounded.toString();
    const f = toFraction(n);
    if (f && f.num > 0) {
        const sign = f.negative ? '\u2212' : '';
        if (f.whole !== 0) return `${sign}${Math.abs(f.whole)} ${f.num}/${f.den}`;
        return `${sign}${f.num}/${f.den}`;
    }
    return rounded.toFixed(2).replace(/\.?0+$/, '');
}

function formatNumberHTML(n) {
    if (Number.isInteger(n)) return document.createTextNode(n.toString());
    const rounded = Math.round(n * 100) / 100;
    if (Number.isInteger(rounded)) return document.createTextNode(rounded.toString());
    const f = toFraction(n);
    if (f && f.num > 0) {
        const span = document.createElement('span');
        span.className = 'fraction-display';
        const sign = f.negative ? '\u2212' : '';
        if (f.whole !== 0) {
            const wholeSpan = document.createElement('span');
            wholeSpan.className = 'fraction-whole';
            wholeSpan.textContent = `${sign}${Math.abs(f.whole)}`;
            span.appendChild(wholeSpan);
        } else if (sign) {
            const signSpan = document.createElement('span');
            signSpan.className = 'fraction-whole';
            signSpan.textContent = sign;
            span.appendChild(signSpan);
        }
        const fracSpan = document.createElement('span');
        fracSpan.className = 'fraction-part';
        fracSpan.innerHTML = `<span class="frac-num">${f.num}</span><span class="frac-den">${f.den}</span>`;
        span.appendChild(fracSpan);
        return span;
    }
    return document.createTextNode(rounded.toFixed(2).replace(/\.?0+$/, ''));
}

function selectCard(index) {
    if (playState.completed) return;
    if (playState.cards[index].used) return;

    // Tutorial gate: only allow the correct card
    if (tutorialActive) {
        const cardValue = playState.cards[index].value;
        if (!tutorialCheckAction('selectCard', { value: cardValue })) return;
    }

    const pos = playState.selected.indexOf(index);
    if (pos !== -1) {
        playState.selected.splice(pos, 1);
        hideOperators();
    } else if (playState.selected.length < 2) {
        playState.selected.push(index);
        if (playState.selected.length === 2) showOperators();
    }

    renderCards();
}

function showOperators() { document.getElementById('operatorsOverlay').classList.add('show'); }
function hideOperators() { document.getElementById('operatorsOverlay').classList.remove('show'); }

function applyOperation(op) {
    if (playState.selected.length !== 2 || playState.completed) return;

    // Tutorial gate: only allow the correct operator
    if (tutorialActive) {
        if (!tutorialCheckAction('selectOp', { op })) return;
    }

    const [i, j] = playState.selected;
    const a = playState.cards[i].value;
    const b = playState.cards[j].value;

    let result;
    switch (op) {
        case '+': result = a + b; break;
        case '-': result = a - b; break;
        case '*': result = a * b; break;
        case '/':
            if (b === 0) return;
            result = a / b;
            break;
    }

    if (!playState.startTime) playState.startTime = Date.now();

    document.getElementById('hintDisplay').classList.remove('visible');
    document.getElementById('hintBtn').classList.remove('visible');
    clearHintTimer();

    playState.cardStates.push({
        cards: JSON.parse(JSON.stringify(playState.cards)),
        operators: [...playState.operatorHistory],
        solutionSteps: JSON.parse(JSON.stringify(playState.solutionSteps))
    });

    // Record solution step for replay
    const slotA = playState.cards[i].slot;
    const slotB = playState.cards[j].slot;
    const targetSlot = slotA; // result goes to first card's slot
    const stepRecord = {
        a: { value: a, slot: slotA },
        op: op,
        b: { value: b, slot: slotB },
        result: { value: result, slot: targetSlot }
    };
    playState.solutionSteps.push(stepRecord);
    playState.replaySequence.push({ type: 'merge', ...stepRecord });

    playState.operatorHistory.push(op);
    playState.cards[i].used = true;
    playState.cards[j].used = true;

    const emptySlot = playState.cards[i].slot;
    playState.cards.push({ value: result, used: false, slot: emptySlot });

    playState.selected = [];
    playState.moves++;

    hideOperators();
    renderCards();
    updateResult();
    updateMoveDots();
    checkGameState();
}

function undo() {
    if (playState.cardStates.length === 0 || playState.completed) return;

    const lastStep = playState.solutionSteps[playState.solutionSteps.length - 1];
    if (lastStep) {
        playState.replaySequence.push({ type: 'undo', ...lastStep });
    }

    const prevState = playState.cardStates.pop();
    playState.cards = prevState.cards;
    playState.operatorHistory = prevState.operators;
    playState.solutionSteps = prevState.solutionSteps || [];
    playState.selected = [];
    playState.moves++;
    playState.undoCount++;

    hideOperators();
    renderCards();
    updateResult();
    updateMoveDots();
}

function updateResult() {
    const remaining = playState.cards.filter(c => !c.used);
    const display = document.getElementById('resultDisplay');
    if (remaining.length === 1) {
        const val = remaining[0].value;
        display.innerHTML = '';
        display.appendChild(formatNumberHTML(val));
        display.classList.add('visible');
        if (Math.abs(val - TARGET_NUMBER) < FLOAT_EPSILON) {
            display.classList.add('success');
            display.classList.remove('error');
        } else {
            display.classList.remove('success');
            display.classList.add('error');
        }
    } else {
        display.textContent = '';
        display.classList.remove('visible', 'success', 'error');
    }
    updateUndoButton();
}

function updateUndoButton() {
    const undoBtn = document.getElementById('undoBtn');
    if (playState.cardStates.length > 0 && !playState.completed) undoBtn.classList.add('visible');
    else undoBtn.classList.remove('visible');
}

function checkGameState() {
    const remaining = playState.cards.filter(c => !c.used);
    if (remaining.length === 1) {
        const val = remaining[0].value;
        if (Math.abs(val - TARGET_NUMBER) < FLOAT_EPSILON) handleWin();
        else handleWrongAnswer();
    }
}

async function handleWin() {
    playState.completed = true;
    playState.endTime = Date.now();

    // Tutorial mode: show success and load today's puzzle
    if (tutorialActive) {
        clearTutorialHighlights();
        const tooltip = document.getElementById('tutorialTooltip');
        tooltip.innerHTML = 'You got it! Loading today\'s puzzle...';
        tooltip.classList.add('visible');
        showConfetti();
        setTimeout(() => endTutorial(), 2000);
        return;
    }

    // User played a real game — dismiss the tutorial ? if still showing
    hideTutorialHelpBtn();

    const solveTime = playState.startTime ?
        Math.round((playState.endTime - playState.startTime) / 1000) : 0;

    const isPerfect = playState.moves === PERFECT_MOVES && playState.undoCount === 0 && !playState.hinted;
    const isFast = isPerfect && solveTime <= FAST_SOLVE_THRESHOLD_S;

    if (canUpgradeResult(currentPuzzle.puzzleNum)) {
        gameState.history[currentPuzzle.puzzleNum] = {
            completed: true,
            solvedOnTime: !currentPuzzle.isArchive,
            moves: playState.moves,
            operators: [...playState.operatorHistory],
            solutionSteps: JSON.parse(JSON.stringify(playState.solutionSteps)),
            replaySequence: JSON.parse(JSON.stringify(playState.replaySequence)),
            undos: playState.undoCount,
            solveTime: solveTime,
            hinted: playState.hinted
        };
    }

    if (!currentPuzzle.isArchive) {
        incrementStreak();
        syncStreakToSupabase();
    }

    saveState();
    updateMoveDots();
    showConfetti();

    // Clean win: fade cards, show big 24
    showCleanWinState();

    let badge = 'Solved';
    let badgeClass = '';
    if (isFast) { badge = 'Perfect + Fast'; badgeClass = 'perfect'; }
    else if (isPerfect) { badge = 'Perfect'; badgeClass = 'perfect'; }
    if (playState.hinted) { badge += ' (with hint)'; }

    setTimeout(() => {
        showVictoryCard({
            badge,
            badgeClass,
            date: formatPuzzleDateLong(currentPuzzle.puzzleNum),
            time: formatTimeHuman(solveTime),
            moves: String(playState.moves),
            streak: String(gameState.streak),
            percentileText: ''
        });
        addDifficultyChip(currentPuzzle.puzzleNum);
    }, WIN_MODAL_DELAY_MS);

    const percentileData = await trackPlay(true);
    displayPercentile(percentileData);

    // Gentle nudge at streak milestones (if not signed in)
    maybeShowSyncNudge();
}

function handleWrongAnswer() {
    setTimeout(() => {
        playState.cards = currentPuzzle.numbers.map((v, i) => ({
            value: v, used: false, slot: i
        }));
        playState.selected = [];
        playState.cardStates = [];
        renderCards();
        updateResult();
    }, WRONG_ANSWER_RESET_MS);
}

function updateMoveDots() {
    const container = document.getElementById('moveDots');
    container.innerHTML = '';
    const totalDots = Math.max(PERFECT_MOVES, playState.moves);
    for (let i = 0; i < totalDots; i++) {
        const dot = document.createElement('div');
        dot.className = 'move-dot';
        if (i < playState.moves) {
            dot.classList.add(i < PERFECT_MOVES ? 'filled' : 'excess');
        } else {
            dot.classList.add('perfect-hint');
        }
        container.appendChild(dot);
    }
}

function updateUI() {
    document.getElementById('puzzleDate').textContent = formatPuzzleDate(currentPuzzle.puzzleNum);
    const dateEl = document.getElementById('puzzleDate');
    const banner = document.getElementById('archiveBanner');
    if (currentPuzzle.isArchive) {
        dateEl.classList.add('archive');
        banner.classList.remove('show');
    } else {
        dateEl.classList.remove('archive');
        banner.classList.remove('show');
    }
    updateStreakDisplay();
    updateMoveDots();
}

function showConfetti() {
    const container = document.getElementById('confetti');
    const colors = ['#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#fbbf24'];
    for (let i = 0; i < CONFETTI_COUNT; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animation = `confetti-fall ${1.5 + Math.random()}s ease-out forwards`;
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        confetti.style.width = (6 + Math.random() * 8) + 'px';
        confetti.style.height = (6 + Math.random() * 8) + 'px';
        container.appendChild(confetti);
    }
    setTimeout(() => { container.innerHTML = ''; }, CONFETTI_DURATION_MS);
}

// Share result
function generateShareText() {
    const history = gameState.history[currentPuzzle.puzzleNum];
    const isPerfect = history?.completed && history.moves === PERFECT_MOVES && (history.undos || 0) === 0 && !history.hinted;
    const isFast = isPerfect && history?.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;
    const operators = history?.operators || playState.operatorHistory;

    const opSymbols = { '+': '\u2795', '-': '\u2796', '*': '\u2716\uFE0F', '/': '\u2797' };
    const opLine = operators.map(op => opSymbols[op]).join(' ');

    let text = `24 \u2014 ${formatPuzzleDateLong(currentPuzzle.puzzleNum)}\n`;
    text += `${opLine}\n`;
    if (isFast) text += `\u26A1 Perfect + Fast!\n`;
    else if (isPerfect) text += `\u2B50 Perfect!\n`;
    text += `\uD83D\uDD25 ${gameState.streak}\n`;
    text += `${APP_CONFIG.publicUrl}`;
    return text;
}

function share() {
    const text = generateShareText();
    if (navigator.share) {
        navigator.share({ text }).catch(() => copyToClipboard(text));
    } else { copyToClipboard(text); }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!');
    }).catch(() => { showToast('Copied to clipboard!'); });
}

function showToast(message) {
    const toast = document.getElementById('clipboardToast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('visible'), 2000);
}

// Archive
let archiveDisplayCount = ARCHIVE_PAGE_SIZE;

function showArchive() {
    const modal = document.getElementById('archiveModal');
    const list = document.getElementById('archiveList');
    list.innerHTML = '';
    const today = getTodayPuzzleNumber();

    for (let i = 0; i < archiveDisplayCount; i++) {
        const num = today - i;
        if (num < 1) continue;

        const item = document.createElement('div');
        item.className = 'archive-item';
        item.textContent = num;

        const history = gameState.history[num];
        if (history?.completed) {
            const isPerfect = history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
            const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;
            if (isFast) item.classList.add('fast-perfect');
            else if (isPerfect) item.classList.add('perfect');
            else item.classList.add('completed');
            if (num !== today) item.classList.add('locked');
        }
        if (num === today) item.classList.add('today');

        item.addEventListener('click', () => {
            modal.classList.remove('show');
            initPuzzle(num, num !== today);
        });
        list.appendChild(item);
    }

    if (today > archiveDisplayCount) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.className = 'load-more-btn';
        loadMoreBtn.textContent = '\u2193 Load More History';
        loadMoreBtn.addEventListener('click', () => {
            archiveDisplayCount += ARCHIVE_PAGE_SIZE;
            showArchive();
        });
        const modalContent = modal.querySelector('.modal');
        const existingBtn = modalContent.querySelector('.load-more-btn');
        if (existingBtn) existingBtn.remove();
        modalContent.insertBefore(loadMoreBtn, modalContent.querySelector('.share-history-btn'));
    }

    modal.classList.add('show');
}

// ============================================================
// CALENDAR HISTORY VIEW
// ============================================================
let calendarViewYear = null;
let calendarViewMonth = null; // 0-indexed
let calendarLastSelectedYear = null;
let calendarLastSelectedMonth = null;

function showCalendar() {
    // If user previously navigated to a specific month, return there instead of current month
    if (calendarLastSelectedYear !== null) {
        calendarViewYear = calendarLastSelectedYear;
        calendarViewMonth = calendarLastSelectedMonth;
    } else {
        const now = new Date();
        calendarViewYear = now.getFullYear();
        calendarViewMonth = now.getMonth();
    }
    renderCalendar();
    document.getElementById('calendarModal').classList.add('show');
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const title = document.getElementById('calTitle');
    const streakEl = document.getElementById('calStreak');
    const nextBtn = document.getElementById('calNext');
    grid.innerHTML = '';

    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    title.textContent = `${months[calendarViewMonth]} ${calendarViewYear}`;

    // Streak summary
    streakEl.textContent = gameState.streak > 0 ? `\uD83D\uDD25 ${gameState.streak} day streak` : '';

    // Disable forward nav if viewing current month
    const now = new Date();
    const isCurrentMonth = calendarViewYear === now.getFullYear() && calendarViewMonth === now.getMonth();
    nextBtn.disabled = isCurrentMonth;

    // Disable backward nav before epoch
    const epochDate = new Date(EPOCH_DATE);
    const prevBtn = document.getElementById('calPrev');
    const isEpochMonth = calendarViewYear === epochDate.getUTCFullYear() && calendarViewMonth === epochDate.getUTCMonth();
    prevBtn.disabled = (calendarViewYear < epochDate.getUTCFullYear()) ||
        (calendarViewYear === epochDate.getUTCFullYear() && calendarViewMonth <= epochDate.getUTCMonth());

    // First day of month (0=Sun, convert to Mon-start: 0=Mon)
    const firstDay = new Date(Date.UTC(calendarViewYear, calendarViewMonth, 1));
    let startDow = firstDay.getUTCDay(); // 0=Sun
    startDow = startDow === 0 ? 6 : startDow - 1; // Convert to Mon=0

    const daysInMonth = new Date(Date.UTC(calendarViewYear, calendarViewMonth + 1, 0)).getUTCDate();
    const today = getTodayPuzzleNumber();

    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day empty';
        grid.appendChild(empty);
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'cal-day';
        cell.textContent = day;

        const dateUTC = new Date(Date.UTC(calendarViewYear, calendarViewMonth, day));
        const puzzleNum = getPuzzleNumber(dateUTC);

        // Future day
        if (puzzleNum > today) {
            cell.classList.add('future');
            grid.appendChild(cell);
            continue;
        }

        // Before epoch
        if (puzzleNum < 1) {
            cell.classList.add('empty');
            grid.appendChild(cell);
            continue;
        }

        // Today
        if (puzzleNum === today) {
            cell.classList.add('today');
        }

        // Check history
        const history = gameState.history[puzzleNum];
        if (history?.completed) {
            const isPerfect = history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
            const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;
            if (isFast || isPerfect) {
                cell.classList.add('perfect');
            } else {
                cell.classList.add('solved');
            }
        } else if (puzzleNum < today) {
            cell.classList.add('missed');
        }

        // Tap: today loads puzzle, solved past days replay, unsolved past days load for play
        cell.addEventListener('click', () => {
            // Remember which month the user was browsing
            calendarLastSelectedYear = calendarViewYear;
            calendarLastSelectedMonth = calendarViewMonth;
            document.getElementById('calendarModal').classList.remove('show');
            if (puzzleNum === today) {
                initPuzzle(puzzleNum, false);
            } else if (history?.completed && history.solutionSteps?.length > 0) {
                startReplay(puzzleNum);
            } else {
                initPuzzle(puzzleNum, true);
            }
        });

        grid.appendChild(cell);
    }
}

// Supabase tracking
let lastPercentileData = null;

async function trackPlay(success) {
    if (currentPuzzle.isArchive) return null;
    try {
        const solveTime = playState.startTime ?
            Math.round((playState.endTime - playState.startTime) / 1000) : 0;

        const payload = {
            p_device_id: gameState.deviceId,
            p_puzzle_num: currentPuzzle.puzzleNum,
            p_solved: success,
            p_moves: playState.moves,
            p_solve_time: solveTime,
            p_operators: playState.operatorHistory,
            p_undos: playState.undoCount
        };

        const headers = await getAuthHeaders();
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_solve`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            showSyncError('Could not save your result to the server.');
            return null;
        }
        const result = await response.json();
        if (result && result.length > 0) {
            lastPercentileData = result[0];
            return result[0];
        }
        return null;
    } catch (e) {
        showSyncError('Could not reach server to save your result.');
        console.error('Failed to track play:', e);
        return null;
    }
}

async function syncStreakToSupabase() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_player_streak`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                p_device_id: gameState.deviceId,
                p_new_streak: gameState.streak,
                p_freezes: gameState.freezes
            })
        });
        if (!response.ok) {
            showSyncError('Could not sync streak to server.');
        }
    } catch (e) {
        showSyncError('Could not reach server to sync streak.');
        console.error('Failed to sync streak:', e);
    }
}

function displayPercentile(data) {
    const display = document.getElementById('victoryPercentile');
    if (!display) return;
    if (!data || !data.percentile || !data.total_players) {
        display.textContent = '';
        display.className = 'victory-percentile';
        return;
    }
    const p = data.percentile, t = data.total_players;
    let message = '';
    if (p >= 90) { message = `Top ${100 - p}% of ${t} players today`; display.className = 'victory-percentile highlight'; }
    else if (p >= 75) { message = `Better than ${p}% of ${t} players`; display.className = 'victory-percentile highlight'; }
    else if (p >= 50) { message = `Better than ${p}% of ${t} players`; display.className = 'victory-percentile'; }
    else { message = `${t} players solved today`; display.className = 'victory-percentile'; }
    display.textContent = message;
}

// ============================================================
// SHAKE TO UNDO (settings-driven)
// ============================================================
let lastShakeTime = 0;
let shakeEnabled = false;
let lastX = 0, lastY = 0, lastZ = 0;

// Platform detection
function needsMotionPermission() {
    return typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function';
}

function hasMotionSensor() {
    return 'DeviceMotionEvent' in window;
}

function handleMotion(event) {
    if (!shakeEnabled || playState.completed) return;
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null) return;
    const deltaX = Math.abs(acc.x - lastX);
    const deltaY = Math.abs(acc.y - lastY);
    const deltaZ = Math.abs(acc.z - lastZ);
    lastX = acc.x; lastY = acc.y; lastZ = acc.z;
    const totalDelta = deltaX + deltaY + deltaZ;
    const now = Date.now();
    if (totalDelta > SHAKE_THRESHOLD && now - lastShakeTime > SHAKE_TIMEOUT_MS) {
        lastShakeTime = now;
        animatedUndo();
    }
}

function enableMotionListener() {
    window.addEventListener('devicemotion', handleMotion);
    shakeEnabled = true;
}

function disableMotionListener() {
    window.removeEventListener('devicemotion', handleMotion);
    shakeEnabled = false;
}

// Try to activate motion (called from settings toggle and on boot)
async function activateShake() {
    if (shakeEnabled) return true;
    if (needsMotionPermission()) {
        try {
            const response = await DeviceMotionEvent.requestPermission();
            if (response === 'granted') {
                enableMotionListener();
                return true;
            }
            return false;
        } catch (e) {
            console.error('Motion permission error:', e);
            return false;
        }
    } else if (hasMotionSensor()) {
        enableMotionListener();
        return true;
    }
    return false;
}

function updateShakeToggleUI() {
    const toggle = document.getElementById('shakeToggle');
    if (!toggle) return; // not in DOM (e.g. test env)
    const guidance = document.getElementById('shakeGuidance');
    const desc = document.getElementById('shakeDesc');
    const pref = localStorage.getItem('make24_shake');
    const isOn = pref === '1' && shakeEnabled;

    toggle.setAttribute('aria-checked', isOn ? 'true' : 'false');

    if (!hasMotionSensor()) {
        // Desktop or device without sensors — hide entire row
        document.getElementById('shakeSettingRow').style.display = 'none';
        guidance.classList.remove('visible');
        return;
    }

    if (needsMotionPermission() && pref === '1' && !shakeEnabled) {
        // iOS: user wants shake but permission wasn't granted this session
        desc.textContent = 'Permission needed — tap the toggle to allow';
        guidance.innerHTML = getIOSGuidanceHTML();
        guidance.classList.add('visible');
    } else if (isOn) {
        desc.textContent = 'Shake your phone to undo the last move';
        guidance.classList.remove('visible');
    } else {
        desc.textContent = 'Shake your phone to undo the last move';
        guidance.classList.remove('visible');
    }
}

function getIOSGuidanceHTML() {
    return `
        <p>Safari asks for permission each visit. To allow permanently:</p>
        <ol class="guidance-steps">
            <li>Open <b>Settings</b> on your iPhone</li>
            <li>Scroll to <b>Safari</b> → <b>Advanced</b> → <b>Website Data</b></li>
            <li>Find <b>make24.app</b> and enable <b>Motion & Orientation</b></li>
        </ol>
        <p>Or in Safari: tap <b>aA</b> in the address bar → <b>Website Settings</b> → enable <b>Motion & Orientation</b>.</p>
    `;
}

async function handleShakeToggle() {
    const pref = localStorage.getItem('make24_shake');
    if (pref === '1' && shakeEnabled) {
        // Turn off
        disableMotionListener();
        localStorage.setItem('make24_shake', '0');
    } else {
        // Turn on — attempt to get permission
        const granted = await activateShake();
        if (granted) {
            localStorage.setItem('make24_shake', '1');
        } else if (needsMotionPermission()) {
            // Permission denied or dismissed — show guidance
            localStorage.setItem('make24_shake', '1'); // remember intent
        }
    }
    updateShakeToggleUI();
}

// Boot: silently restore if previously enabled
async function initShakeSetting() {
    const pref = localStorage.getItem('make24_shake');
    if (pref === '1') {
        if (needsMotionPermission()) {
            // On iOS, can't auto-request (needs user gesture).
            // We'll show the guidance and let user re-tap the toggle.
        } else if (hasMotionSensor()) {
            enableMotionListener();
        }
    }
    updateShakeToggleUI();
}

if (document.getElementById('shakeToggle')) {
    document.getElementById('shakeToggle').addEventListener('click', handleShakeToggle);
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.querySelectorAll('.op-btn').forEach(btn => {
    btn.addEventListener('click', () => applyOperation(btn.dataset.op));
});

document.getElementById('undoBtn').addEventListener('click', animatedUndo);
document.getElementById('hintBtn').addEventListener('click', useHint);

// Sync nudge toast handlers
document.getElementById('syncNudgeLink').addEventListener('click', nudgeOpenSignIn);
document.getElementById('syncNudgeDismiss').addEventListener('click', dismissSyncNudge);

// Auth: Google + OTP handlers
document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
document.getElementById('otpSendBtn').addEventListener('click', sendOtpCode);
document.getElementById('otpVerifyBtn').addEventListener('click', verifyOtpCode);
document.getElementById('syncSignOutBtn').addEventListener('click', promptSignOut);

// Allow Enter key in OTP inputs
document.getElementById('otpEmailInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendOtpCode();
});
document.getElementById('otpCodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyOtpCode();
});

document.getElementById('operatorsOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        playState.selected = [];
        hideOperators();
        renderCards();
    }
});

// ============================================================
// PUZZLE DETAILS SHEET
// ============================================================
function showPuzzleDetails(puzzleNum) {
    const today = getTodayPuzzleNumber();
    const history = gameState.history[puzzleNum];
    const numbers = generatePuzzle(puzzleNum);
    const opSymbols = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };

    document.getElementById('detailsDate').textContent = formatPuzzleDateLong(puzzleNum);

    // Show puzzle tiles
    const tilesEl = document.getElementById('detailsTiles');
    tilesEl.innerHTML = '';
    numbers.forEach(n => {
        const tile = document.createElement('div');
        tile.className = 'details-tile';
        tile.textContent = n;
        tilesEl.appendChild(tile);
    });

    const statusEl = document.getElementById('detailsStatus');
    const statsRow = document.getElementById('detailsStatsRow');
    const metaEl = document.getElementById('detailsMeta');
    const actionsEl = document.getElementById('detailsActions');
    statsRow.innerHTML = '';
    actionsEl.innerHTML = '';

    if (history?.completed) {
        const isPerfect = history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
        const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;

        if (isFast) { statusEl.textContent = 'Perfect + Fast'; statusEl.className = 'details-status perfect'; }
        else if (isPerfect) { statusEl.textContent = 'Perfect'; statusEl.className = 'details-status perfect'; }
        else { statusEl.textContent = 'Solved'; statusEl.className = 'details-status solved'; }

        // Stats
        const addStat = (value, label) => {
            const div = document.createElement('div');
            div.className = 'details-stat';
            div.innerHTML = `<span class="details-stat-value">${value}</span><span class="details-stat-label">${label}</span>`;
            statsRow.appendChild(div);
        };
        addStat(formatTimeHuman(history.solveTime), 'Time');
        addStat(String(history.moves), 'Moves');

        metaEl.textContent = formatPuzzleDateLong(puzzleNum);

        // Replay button (only if solutionSteps exist)
        if (history.solutionSteps && history.solutionSteps.length > 0) {
            const replayBtn = document.createElement('button');
            replayBtn.className = 'btn btn-primary';
            replayBtn.textContent = 'Replay solution';
            replayBtn.addEventListener('click', () => {
                document.getElementById('detailsModal').classList.remove('show');
                startReplay(puzzleNum);
            });
            actionsEl.appendChild(replayBtn);
        }

        // Share button
        const shareBtn = document.createElement('button');
        shareBtn.className = 'btn btn-challenge';
        shareBtn.textContent = 'Share';
        shareBtn.addEventListener('click', () => {
            const text = `Make 24 \u2014 ${formatPuzzleDate(puzzleNum)}\n${isPerfect ? '\u2B50 Perfect' : 'Solved'} in ${history.moves} moves\n${APP_CONFIG.publicUrl}`;
            if (navigator.share) {
                navigator.share({ text }).catch(() => copyToClipboard(text));
            } else { copyToClipboard(text); }
        });
        actionsEl.appendChild(shareBtn);
    } else {
        statusEl.textContent = 'Missed';
        statusEl.className = 'details-status missed';
        metaEl.textContent = formatPuzzleDateLong(puzzleNum);
    }

    document.getElementById('detailsModal').classList.add('show');
}

// ============================================================
// SOLUTION REPLAY ENGINE
// ============================================================
let replayState = {
    steps: [],
    numbers: [],
    currentStep: -1, // -1 = showing initial tiles, 0..n-1 = after step i
    playing: false,
    timer: null,
    cards: []   // current card state: [{value, slot, used}]
};

const REPLAY_STEP_MS = 1500;
const REPLAY_HIGHLIGHT_MS = 400;
const REPLAY_OP_MS = 350;
const REPLAY_MERGE_MS = 450;

// Generate fake merge+undo pairs for old games without full replay history.
// Creates realistic-looking "wrong attempts" before the real solution steps.
function generateFakePrelude(numbers, extraMoves) {
    const sequence = [];
    const pairs = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
    const ops = ['+', '*', '-', '+', '*', '-'];
    const numPairs = Math.floor(extraMoves / 2);

    for (let p = 0; p < numPairs; p++) {
        const [si, sj] = pairs[p % pairs.length];
        const op = ops[p % ops.length];
        const a = numbers[si];
        const b = numbers[sj];
        const result = calc(a, op, b);
        if (result === null) continue;

        const step = {
            a: { value: a, slot: si },
            op: op,
            b: { value: b, slot: sj },
            result: { value: result, slot: si }
        };
        sequence.push({ type: 'merge', ...step });
        sequence.push({ type: 'undo', ...step });
    }
    return sequence;
}

function startReplay(puzzleNum) {
    const history = gameState.history[puzzleNum];
    const numbers = generatePuzzle(puzzleNum);

    // Prefer replaySequence (includes undos), fall back to solutionSteps, then solve
    let steps = history?.replaySequence;
    if (!steps || steps.length === 0) {
        let solnSteps = history?.solutionSteps;
        if (!solnSteps || solnSteps.length === 0) {
            solnSteps = solve24Full(numbers);
            if (!solnSteps) return;
        }
        const mergeSteps = solnSteps.map(s => ({ type: 'merge', ...s }));

        // For old games with extra moves, generate fake merge+undo prelude
        const totalMoves = history?.moves || solnSteps.length;
        const extraMoves = totalMoves - solnSteps.length;
        if (extraMoves >= 2) {
            const prelude = generateFakePrelude(numbers, extraMoves);
            steps = [...prelude, ...mergeSteps];
        } else {
            steps = mergeSteps;
        }
    }

    replayState.steps = steps;
    replayState.numbers = numbers;
    replayState.puzzleNum = puzzleNum;
    replayState.currentStep = -1;
    replayState.playing = false;

    // Init cards at starting state
    replayState.cards = replayState.numbers.map((v, i) => ({ value: v, slot: i, used: false }));

    renderReplayCards();
    document.getElementById('replayOpDisplay').classList.remove('visible');
    document.getElementById('replayOpDisplay').textContent = '';

    // Initialize dots for replay: show total moves as empty, none filled yet
    replayState.totalMoves = history?.moves || steps.length;
    updateReplayDots(0, replayState.totalMoves);

    document.getElementById('replayOverlay').classList.add('show');

    // Auto-play after a short delay
    setTimeout(() => {
        replayState.playing = true;
        replayAutoStep();
    }, 600);
}

function updateReplayDots(completedSteps, totalMoves) {
    const container = document.getElementById('moveDots');
    container.innerHTML = '';
    const totalDots = Math.max(PERFECT_MOVES, totalMoves);
    for (let i = 0; i < totalDots; i++) {
        const dot = document.createElement('div');
        dot.className = 'move-dot';
        if (i < completedSteps) {
            dot.classList.add(i < PERFECT_MOVES ? 'filled' : 'excess');
        } else {
            dot.classList.add('perfect-hint');
        }
        container.appendChild(dot);
    }
}

function renderReplayCards() {
    for (let s = 0; s < 4; s++) {
        const slot = document.getElementById(`rslot${s}`);
        slot.innerHTML = '';
        const card = replayState.cards.find(c => c.slot === s && !c.used);
        if (card) {
            const el = document.createElement('div');
            el.className = 'replay-card';
            el.appendChild(formatNumberHTML(card.value));
            slot.appendChild(el);
        }
    }
}

function replayAutoStep() {
    if (!replayState.playing) return;
    if (replayState.currentStep >= replayState.steps.length - 1) {
        // Replay complete — wait for last animation, then show victory
        replayState.playing = false;
        const lastStepAnimTime = REPLAY_HIGHLIGHT_MS + REPLAY_OP_MS + REPLAY_MERGE_MS + 300;
        setTimeout(() => {
            closeReplay();
            showConfetti();
            showReplayVictoryCard();
        }, lastStepAnimTime);
        return;
    }

    replayState.timer = setTimeout(() => {
        replayStepForward();
        replayAutoStep();
    }, REPLAY_STEP_MS);
}

function showReplayVictoryCard() {
    const puzzleNum = replayState.puzzleNum;
    const history = gameState.history[puzzleNum];
    if (!history) return;

    const isPerfect = history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
    const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;

    let badge = 'Solved';
    let badgeClass = '';
    if (isFast) { badge = 'Perfect + Fast'; badgeClass = 'perfect'; }
    else if (isPerfect) { badge = 'Perfect'; badgeClass = 'perfect'; }
    if (history.hinted) { badge += ' (with hint)'; }

    showVictoryCard({
        badge,
        badgeClass,
        date: formatPuzzleDateLong(puzzleNum),
        time: formatTimeHuman(history.solveTime),
        moves: String(history.moves),
        streak: String(gameState.streak),
        percentileText: ''
    });
    addDifficultyChip(puzzleNum);
}

function replayStepForward() {
    if (replayState.currentStep >= replayState.steps.length - 1) return;
    replayState.currentStep++;
    const step = replayState.steps[replayState.currentStep];

    if (step.type === 'undo') {
        replayUndoStep(step);
    } else {
        replayMergeStep(step);
    }
}

function replayMergeStep(step) {
    const opSymbols = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };

    // Highlight the two source cards
    const slotA = document.getElementById(`rslot${step.a.slot}`);
    const slotB = document.getElementById(`rslot${step.b.slot}`);
    const cardA = slotA?.querySelector('.replay-card');
    const cardB = slotB?.querySelector('.replay-card');
    if (cardA) cardA.classList.add('highlight');
    if (cardB) cardB.classList.add('highlight');

    // Show operator
    setTimeout(() => {
        const opDisplay = document.getElementById('replayOpDisplay');
        opDisplay.textContent = opSymbols[step.op] || step.op;
        opDisplay.classList.add('visible');
    }, REPLAY_HIGHLIGHT_MS);

    // Merge animation
    setTimeout(() => {
        if (cardA) cardA.classList.add('merging');
        if (cardB) cardB.classList.add('merging');
        document.getElementById('replayOpDisplay').classList.remove('visible');
    }, REPLAY_HIGHLIGHT_MS + REPLAY_OP_MS);

    // Apply state change and show result
    setTimeout(() => {
        // Update card state
        const idxA = replayState.cards.findIndex(c => c.slot === step.a.slot && !c.used);
        const idxB = replayState.cards.findIndex(c => c.slot === step.b.slot && !c.used);
        if (idxA >= 0) replayState.cards[idxA].used = true;
        if (idxB >= 0) replayState.cards[idxB].used = true;
        replayState.cards.push({ value: step.result.value, slot: step.result.slot, used: false });

        renderReplayCards();

        // Appear animation on new card
        const resultSlot = document.getElementById(`rslot${step.result.slot}`);
        const newCard = resultSlot?.querySelector('.replay-card');
        if (newCard) newCard.classList.add('appearing');

        // Update move dots to reflect progress
        updateReplayDots(replayState.currentStep + 1, replayState.totalMoves);
    }, REPLAY_HIGHLIGHT_MS + REPLAY_OP_MS + REPLAY_MERGE_MS);
}

function replayUndoStep(step) {
    const opSymbols = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };

    // Flash the operator in orange to signal undo
    const opDisplay = document.getElementById('replayOpDisplay');
    opDisplay.textContent = opSymbols[step.op] || step.op;
    opDisplay.classList.add('visible', 'undo');

    // Add puff/smoke to the result card that will disappear
    const resultSlot = document.getElementById(`rslot${step.result.slot}`);
    const resultCard = resultSlot?.querySelector('.replay-card');
    if (resultCard) resultCard.classList.add('replay-puff');

    // After puff animation: reverse the merge state and show restored cards
    setTimeout(() => {
        opDisplay.classList.remove('visible', 'undo');

        // Remove the result card from state
        const resultIdx = replayState.cards.findIndex(c =>
            c.slot === step.result.slot && !c.used && c.value === step.result.value);
        if (resultIdx >= 0) replayState.cards.splice(resultIdx, 1);

        // Restore source cards
        for (let i = replayState.cards.length - 1; i >= 0; i--) {
            if (replayState.cards[i].used && replayState.cards[i].slot === step.b.slot &&
                replayState.cards[i].value === step.b.value) {
                replayState.cards[i].used = false;
                break;
            }
        }
        for (let i = replayState.cards.length - 1; i >= 0; i--) {
            if (replayState.cards[i].used && replayState.cards[i].slot === step.a.slot &&
                replayState.cards[i].value === step.a.value) {
                replayState.cards[i].used = false;
                break;
            }
        }

        renderReplayCards();

        // Appear animation on restored cards
        const slotAEl = document.getElementById(`rslot${step.a.slot}`);
        const slotBEl = document.getElementById(`rslot${step.b.slot}`);
        const cardA = slotAEl?.querySelector('.replay-card');
        const cardB = slotBEl?.querySelector('.replay-card');
        if (cardA) cardA.classList.add('appearing');
        if (cardB) cardB.classList.add('appearing');

        // Update move dots
        updateReplayDots(replayState.currentStep + 1, replayState.totalMoves);
    }, 500);
}

function replayStepBack() {
    // Manual step back not used during auto-play but kept for consistency
    if (replayState.currentStep < 0) return;

    const step = replayState.steps[replayState.currentStep];
    replayState.currentStep--;

    if (step.type === 'undo') {
        // Stepping back from an undo = re-apply the merge
        const idxA = replayState.cards.findIndex(c => c.slot === step.a.slot && !c.used);
        const idxB = replayState.cards.findIndex(c => c.slot === step.b.slot && !c.used);
        if (idxA >= 0) replayState.cards[idxA].used = true;
        if (idxB >= 0) replayState.cards[idxB].used = true;
        replayState.cards.push({ value: step.result.value, slot: step.result.slot, used: false });
    } else {
        // Stepping back from a merge = reverse it
        const resultIdx = replayState.cards.findIndex(c => c.slot === step.result.slot && !c.used && c.value === step.result.value);
        if (resultIdx >= 0) replayState.cards.splice(resultIdx, 1);

        for (let i = replayState.cards.length - 1; i >= 0; i--) {
            if (replayState.cards[i].used && replayState.cards[i].slot === step.b.slot && replayState.cards[i].value === step.b.value) {
                replayState.cards[i].used = false;
                break;
            }
        }
        for (let i = replayState.cards.length - 1; i >= 0; i--) {
            if (replayState.cards[i].used && replayState.cards[i].slot === step.a.slot && replayState.cards[i].value === step.a.value) {
                replayState.cards[i].used = false;
                break;
            }
        }
    }

    renderReplayCards();
    document.getElementById('replayOpDisplay').classList.remove('visible');
}

function closeReplay() {
    replayState.playing = false;
    if (replayState.timer) { clearTimeout(replayState.timer); replayState.timer = null; }
    document.getElementById('replayOverlay').classList.remove('show');
    // Restore original move dots
    updateMoveDots();
}


// ============================================================
// ANIMATED UNDO (live play)
// ============================================================
function animatedUndo() {
    if (tutorialActive) return; // no undo during tutorial
    if (playState.cardStates.length === 0 || playState.completed) return;

    // Get the merged card slot before undo
    const lastStep = playState.solutionSteps[playState.solutionSteps.length - 1];
    const mergedSlot = lastStep ? lastStep.result.slot : null;

    // Record undo in replay sequence (the step being undone)
    if (lastStep) {
        playState.replaySequence.push({ type: 'undo', ...lastStep });
    }

    const prevState = playState.cardStates.pop();
    playState.cards = prevState.cards;
    playState.operatorHistory = prevState.operators;
    playState.solutionSteps = prevState.solutionSteps || [];
    playState.selected = [];
    playState.moves++;
    playState.undoCount++;

    hideOperators();
    renderCards();
    updateResult();
    updateMoveDots();

    // Apply undo-appear animation to restored cards
    if (lastStep) {
        const slots = [lastStep.a.slot, lastStep.b.slot];
        slots.forEach(s => {
            const slotEl = document.getElementById(`slot${s}`);
            const card = slotEl?.querySelector('.card');
            if (card) card.classList.add('undo-appear');
        });
    }
}

// More menu
document.getElementById('moreBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('moreMenu').classList.toggle('show');
});
document.addEventListener('click', () => {
    document.getElementById('moreMenu').classList.remove('show');
});
document.getElementById('menuHintBtn').addEventListener('click', () => {
    document.getElementById('moreMenu').classList.remove('show');
    useHint();
});
document.getElementById('menuCalendarBtn').addEventListener('click', () => {
    document.getElementById('moreMenu').classList.remove('show');
    showCalendar();
});

// Tap the date label to open the calendar directly
document.getElementById('puzzleDate').addEventListener('click', () => {
    if (tutorialActive) return;
    showCalendar();
});
document.getElementById('menuSettingsBtn').addEventListener('click', () => {
    document.getElementById('moreMenu').classList.remove('show');
    document.getElementById('settingsModal').classList.add('show');
});

// Freeze tooltip on streak tap
document.getElementById('streakDisplay').addEventListener('click', () => {
    const tooltip = document.getElementById('freezeTooltip');
    if (!tooltip) return;
    tooltip.classList.add('visible');
    clearTimeout(document.getElementById('streakDisplay')._tipTimer);
    document.getElementById('streakDisplay')._tipTimer = setTimeout(() => tooltip.classList.remove('visible'), 3000);
});

// Calendar modal controls
document.getElementById('closeCalendar').addEventListener('click', () => {
    document.getElementById('calendarModal').classList.remove('show');
});
document.getElementById('calendarModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
});
document.getElementById('calPrev').addEventListener('click', () => {
    calendarViewMonth--;
    if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear--; }
    renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
    calendarViewMonth++;
    if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear++; }
    renderCalendar();
});
document.getElementById('shareMonthBtn').addEventListener('click', shareHistoryGrid);

// Details sheet
document.getElementById('detailsClose').addEventListener('click', () => {
    document.getElementById('detailsModal').classList.remove('show');
});
document.getElementById('detailsModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
});

// Replay close button
document.getElementById('replayCloseBtn').addEventListener('click', closeReplay);

// Keep old archive modal functional via close button
document.getElementById('closeArchive').addEventListener('click', () => {
    document.getElementById('archiveModal').classList.remove('show');
});

document.getElementById('shareBtn').addEventListener('click', share);
document.getElementById('challengeBtn').addEventListener('click', shareChallenge);
document.getElementById('shareHistoryBtn').addEventListener('click', shareHistoryGrid);

// Tap the big green "24" to replay the solution
document.getElementById('resultDisplay').addEventListener('click', () => {
    if (!playState.completed) return;
    const puzzleNum = currentPuzzle.puzzleNum;
    hideVictoryCard();
    startReplay(puzzleNum);
});

// Victory card close: X button or tap outside
document.getElementById('victoryClose').addEventListener('click', hideVictoryCard);
document.getElementById('victoryBackdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideVictoryCard();
});

// Tap victory badge to replay solution
document.getElementById('victoryBadge').addEventListener('click', () => {
    const puzzleNum = currentPuzzle.puzzleNum;
    hideVictoryCard();
    startReplay(puzzleNum);
});

document.getElementById('archiveModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
});

// Settings modal (menuSettingsBtn already wired above)
document.getElementById('closeSettings').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.remove('show');
});
document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
});

// ============================================================
// GUIDED TUTORIAL (first-time users)
// ============================================================
let tutorialActive = false;
let tutorialStep = 0;

// Tutorial puzzle: [1, 2, 3, 4] → 1×2=2, 2×3=6, 6×4=24
const TUTORIAL_NUMBERS = [1, 2, 3, 4];
const TUTORIAL_STEPS = [
    // Step 0: tap first number
    { action: 'selectCard', targetValue: 1, tooltip: 'Tap the <span class="tutorial-highlight">1</span> card' },
    // Step 1: tap second number
    { action: 'selectCard', targetValue: 2, tooltip: 'Now tap the <span class="tutorial-highlight">2</span> card' },
    // Step 2: pick operator
    { action: 'selectOp', targetOp: '*', tooltip: 'Choose <span class="tutorial-highlight">&times;</span> to multiply them' },
    // Step 3: tap result card (2)
    { action: 'selectCard', targetValue: 2, tooltip: 'Tap the <span class="tutorial-highlight">2</span> card (the result)' },
    // Step 4: tap 3
    { action: 'selectCard', targetValue: 3, tooltip: 'Now tap <span class="tutorial-highlight">3</span>' },
    // Step 5: multiply again
    { action: 'selectOp', targetOp: '*', tooltip: 'Choose <span class="tutorial-highlight">&times;</span> again' },
    // Step 6: tap result card (6)
    { action: 'selectCard', targetValue: 6, tooltip: 'Tap the <span class="tutorial-highlight">6</span>' },
    // Step 7: tap 4
    { action: 'selectCard', targetValue: 4, tooltip: 'And finally tap <span class="tutorial-highlight">4</span>' },
    // Step 8: multiply for 24
    { action: 'selectOp', targetOp: '*', tooltip: 'Choose <span class="tutorial-highlight">&times;</span> to make 24!' },
];

function shouldShowTutorialHint() {
    if (localStorage.getItem('make24_tutorial')) return false;
    // Show the ? for users with no history
    return Object.keys(gameState.history).length === 0;
}

function showTutorialHelpBtn() {
    document.getElementById('tutorialHelpBtn').classList.add('visible');
}

function hideTutorialHelpBtn() {
    document.getElementById('tutorialHelpBtn').classList.remove('visible');
    localStorage.setItem('make24_tutorial', '1');
}

function startTutorial() {
    tutorialActive = true;
    tutorialStep = 0;

    // Hide the ? icon and any active victory card
    document.getElementById('tutorialHelpBtn').classList.remove('visible');
    hideVictoryCard();
    clearWinState();

    // Override current puzzle with tutorial puzzle
    currentPuzzle.puzzleNum = 0; // sentinel: not a real puzzle
    currentPuzzle.numbers = [...TUTORIAL_NUMBERS];
    currentPuzzle.isArchive = true; // prevents streak counting
    currentPuzzle.date = null;

    playState.moves = 0;
    playState.completed = false;
    playState.cards = TUTORIAL_NUMBERS.map((v, i) => ({ value: v, used: false, slot: i }));
    playState.selected = [];
    playState.cardStates = [];
    playState.operatorHistory = [];
    playState.solutionSteps = [];
    playState.replaySequence = [];
    playState.undoCount = 0;
    playState.startTime = null;
    playState.endTime = null;
    playState.hinted = false;

    document.getElementById('puzzleDate').textContent = 'Practice';
    document.getElementById('tutorialBanner').classList.add('visible');

    renderCards();
    hideOperators();
    updateResult();
    updateMoveDots();
    showTutorialStep();
}

function showTutorialStep() {
    if (!tutorialActive) return;
    const tooltip = document.getElementById('tutorialTooltip');
    if (tutorialStep >= TUTORIAL_STEPS.length) {
        tooltip.classList.remove('visible');
        return;
    }
    const step = TUTORIAL_STEPS[tutorialStep];
    tooltip.innerHTML = step.tooltip;
    tooltip.classList.add('visible');

    // Highlight target cards
    clearTutorialHighlights();
    if (step.action === 'selectCard') {
        highlightTutorialCard(step.targetValue);
    } else if (step.action === 'selectOp') {
        highlightTutorialOp(step.targetOp);
    }
}

function clearTutorialHighlights() {
    document.querySelectorAll('.tutorial-target').forEach(el => el.classList.remove('tutorial-target'));
    document.querySelectorAll('.tutorial-dim').forEach(el => el.classList.remove('tutorial-dim'));
}

function highlightTutorialCard(value) {
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        if (parseFloat(card.textContent) === value && !card.classList.contains('used')) {
            card.classList.add('tutorial-target');
        } else {
            card.classList.add('tutorial-dim');
        }
    });
}

function highlightTutorialOp(op) {
    const opMap = { '+': '+', '-': '-', '*': '*', '/': '/' };
    document.querySelectorAll('.op-btn').forEach(btn => {
        if (btn.dataset.op === op) {
            btn.classList.add('tutorial-target');
        } else {
            btn.classList.add('tutorial-dim');
        }
    });
}

// Check if the user's action matches the tutorial step
function tutorialCheckAction(action, detail) {
    if (!tutorialActive || tutorialStep >= TUTORIAL_STEPS.length) return true; // not in tutorial
    const step = TUTORIAL_STEPS[tutorialStep];
    if (step.action === 'selectCard' && action === 'selectCard') {
        // Check if the card value matches
        if (detail.value === step.targetValue) {
            tutorialStep++;
            // After a brief delay, show next step
            setTimeout(() => showTutorialStep(), 150);
            return true;
        }
        return false; // wrong card
    }
    if (step.action === 'selectOp' && action === 'selectOp') {
        if (detail.op === step.targetOp) {
            tutorialStep++;
            setTimeout(() => showTutorialStep(), 150);
            return true;
        }
        return false; // wrong op
    }
    return false;
}

function endTutorial() {
    tutorialActive = false;
    tutorialStep = 0;
    hideTutorialHelpBtn();
    document.getElementById('tutorialBanner').classList.remove('visible');
    document.getElementById('tutorialTooltip').classList.remove('visible');
    clearTutorialHighlights();

    // Load today's real puzzle
    initPuzzle(getTodayPuzzleNumber(), false);
}

function skipTutorial() {
    tutorialActive = false;
    hideTutorialHelpBtn();
    document.getElementById('tutorialBanner').classList.remove('visible');
    document.getElementById('tutorialTooltip').classList.remove('visible');
    clearTutorialHighlights();
    initPuzzle(getTodayPuzzleNumber(), false);
}

// Wire tutorial buttons
document.getElementById('tutorialSkip').addEventListener('click', skipTutorial);
document.getElementById('tutorialHelpBtn').addEventListener('click', () => {
    startTutorial();
});
document.getElementById('menuTutorialBtn').addEventListener('click', () => {
    document.getElementById('moreMenu').classList.remove('show');
    startTutorial();
});

// ============================================================
// DIFFICULTY CHIP (shown after solve in victory card)
// ============================================================
function addDifficultyChip(puzzleNum) {
    const diff = getCachedDifficulty(puzzleNum);
    const existing = document.querySelector('.difficulty-chip');
    if (existing) existing.remove();
    const chip = document.createElement('span');
    chip.className = `difficulty-chip ${diff.level}`;
    chip.textContent = diff.label;
    const dateEl = document.getElementById('victoryDate');
    dateEl.parentNode.insertBefore(chip, dateEl.nextSibling);
}

// ============================================================
// BOOT (async to support auth)
// ============================================================
async function boot() {
    loadState();

    // Wait for the Supabase auth state to be fully resolved before rendering.
    // getSession() restores any persisted session from storage.
    const { data: { session } } = await sb.auth.getSession();
    await updateSyncUI();

    if (session) {
        await ensureCanonicalDeviceId();
    }

    await syncFromSupabase();
    await syncHistoryFromSupabase();
    updateStreak();
    reconcileStreakFromHistory();
    initPuzzle(getTodayPuzzleNumber(), false);

    // Show subtle ? for first-time users (tutorial is opt-in)
    if (shouldShowTutorialHint()) {
        showTutorialHelpBtn();
    }

    // Allow onAuthStateChange to handle subsequent auth events (sign-in/out)
    bootComplete = true;
}

boot();

// Initialize shake-to-undo from saved preference
initShakeSetting();

// ============================================================
// EXPORTS FOR TESTING (Node.js only)
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calc,
        evaluateAllExpressions,
        getPuzzleDifficulty,
        findHintForPuzzle,
        canMake24From3,
        mulberry32,
        generatePuzzle,
        formatNumber,
        toFraction,
        getPuzzleNumber,
        getDateFromPuzzleNumber,
        computeStreakFromHistory,
        formatPuzzleDate,
        formatPuzzleDateLong,
        formatTimeHuman,
        VALID_PUZZLES,
        TARGET_NUMBER,
        FLOAT_EPSILON,
        PERFECT_MOVES,
        FAST_SOLVE_THRESHOLD_S,
        SOLUTION_THRESHOLD_EASY,
        SOLUTION_THRESHOLD_MEDIUM,
        EPOCH_DATE,
        PUZZLE_SEED_MULTIPLIER,
        solve24Full,
    };
}
