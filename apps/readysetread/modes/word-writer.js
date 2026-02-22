'use strict';

/* ─── Word Writer ─────────────────────────────────────────────── */
const WW_WORDS_PER_SESSION = 4;

let wwSession = null;

function buildWWSession() {
  const tier  = SIGHT_WORD_TIERS.pre_primer;
  const today = getTodayStr();
  const seed  = dateHash(today + 'ww');

  // Prefer words already seen in Sight Word Dash (higher mastery = more familiar)
  const withPts = tier.map(w => ({ ...w, pts: state.swMastery[w.word] ?? 0 }));
  const seen    = seededShuffle(withPts.filter(w => w.pts > 0),  seed);
  const unseen  = seededShuffle(withPts.filter(w => w.pts === 0), seed + 1);
  const chosen  = [...seen, ...unseen].slice(0, WW_WORDS_PER_SESSION).map(w => w.word);

  return {
    words:           chosen,
    currentIdx:      0,
    stepsDone:       [false, false, false],
    stepHasStrokes:  [false, false, false],
    clears:          0,
    isDrawing:       [false, false, false],
    lastX:           [0, 0, 0],
    lastY:           [0, 0, 0],
    ctxs:            [null, null, null],
    cssW:            [0, 0, 0],
    cssH:            [0, 0, 0],
    pauseTimers:     [null, null, null],
    sessionStartTime: Date.now(),
  };
}

function startWordWriter() {
  if (state.wwTodayDone) { showTodayWWSummary(); return; }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  tts.unlockFromGesture();

  wwSession = buildWWSession();

  // Preload audio for session
  wwSession.words.forEach(word => preloadWordAudio(word));

  showScreen('ww-game');
  document.getElementById('ww-game-streak').textContent = state.streak;
  // rAF so the screen is active and canvas clientWidth/Height are computable
  requestAnimationFrame(() => loadWWWord(0));
}

function loadWWWord(idx) {
  if (!wwSession) return;
  wwSession.currentIdx     = idx;
  wwSession.stepsDone      = [false, false, false];
  wwSession.stepHasStrokes = [false, false, false];
  wwSession.isDrawing      = [false, false, false];
  wwSession.pauseTimers.forEach(t => clearTimeout(t));
  wwSession.pauseTimers    = [null, null, null];

  const word = wwSession.words[idx];

  // Progress
  document.getElementById('ww-progress-text').textContent = `Word ${idx + 1} of ${WW_WORDS_PER_SESSION}`;

  // Target word
  document.getElementById('ww-target-word').textContent = word;

  // Reset each line set UI
  for (let s = 0; s < 3; s++) {
    const setEl   = document.getElementById(`ww-set-${s}`);
    const checkEl = document.getElementById(`ww-check-${s}`);
    setEl.classList.remove('ww-active-step', 'ww-done-step', 'ww-inactive-step');
    setEl.classList.add(s === 0 ? 'ww-active-step' : 'ww-inactive-step');
    checkEl.classList.remove('visible');
  }

  // Hide Next button
  document.getElementById('ww-next-btn').classList.remove('visible');

  // Init canvases
  initWWCanvases(word);

  // Read the word aloud
  setTimeout(() => playWordAudio(word), 400);
}

function initWWCanvases(word) {
  const dpr = window.devicePixelRatio || 1;
  for (let step = 0; step < 3; step++) {
    const canvasEl = document.getElementById(`ww-canvas-${step}`);
    const wrapEl   = document.getElementById(`ww-wrap-${step}`);

    const cssW = wrapEl.clientWidth;
    const cssH = wrapEl.clientHeight;

    // Resizing resets the canvas state (including transform)
    canvasEl.width  = cssW * dpr;
    canvasEl.height = cssH * dpr;
    canvasEl.style.width  = cssW + 'px';
    canvasEl.style.height = cssH + 'px';

    const ctx = canvasEl.getContext('2d');
    ctx.scale(dpr, dpr);

    wwSession.ctxs[step] = ctx;
    wwSession.cssW[step] = cssW;
    wwSession.cssH[step] = cssH;

    drawWWLines(ctx, cssW, cssH);
    if (step === 0) drawDottedWord(ctx, word, cssW, cssH);

    // Property assignment replaces any prior handler → no duplicate listeners
    const s = step;
    canvasEl.onpointerdown   = (e) => wwPointerDown(e, s);
    canvasEl.onpointermove   = (e) => wwPointerMove(e, s);
    canvasEl.onpointerup     = (e) => wwPointerUp(e, s);
    canvasEl.onpointercancel = (e) => wwPointerUp(e, s);
  }
}

/* ─── Canvas rendering ────────────────────────────────────────── */
function drawWWLines(ctx, w, h) {
  const topY  = h * 0.15;
  const midY  = h * 0.55;
  const baseY = h * 0.82;

  ctx.save();

  // Green top line — ascenders / capitals
  ctx.beginPath();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.65)';
  ctx.lineWidth   = 2;
  ctx.moveTo(12, topY); ctx.lineTo(w - 12, topY);
  ctx.stroke();

  // Dashed middle line — x-height
  ctx.beginPath();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(232, 237, 245, 0.38)';
  ctx.lineWidth   = 1.5;
  ctx.moveTo(12, midY); ctx.lineTo(w - 12, midY);
  ctx.stroke();

  // Red baseline
  ctx.beginPath();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
  ctx.lineWidth   = 2;
  ctx.moveTo(12, baseY); ctx.lineTo(w - 12, baseY);
  ctx.stroke();

  ctx.restore();
}

function drawDottedWord(ctx, word, w, h) {
  const baseY  = h * 0.82;
  const topY   = h * 0.15;
  const maxH   = (baseY - topY) * 0.88;
  const maxW   = w - 28;

  let fontSize = Math.floor(maxH);

  ctx.save();
  ctx.font = `900 ${fontSize}px 'DM Sans', system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';

  // Scale down if word is wider than available space
  const measured = ctx.measureText(word).width;
  if (measured > maxW) {
    fontSize = Math.floor(fontSize * maxW / measured * 0.97);
    ctx.font = `900 ${fontSize}px 'DM Sans', system-ui, sans-serif`;
  }

  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = 'rgba(0, 229, 204, 0.38)';
  ctx.lineWidth   = Math.max(2, fontSize * 0.07);
  ctx.strokeText(word, 14, baseY);
  ctx.setLineDash([]);
  ctx.restore();
}

/* ─── Pointer events ──────────────────────────────────────────── */
function wwGetPos(e, canvasEl) {
  const rect = canvasEl.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

function wwPointerDown(e, step) {
  e.preventDefault();
  if (!wwSession || wwSession.stepsDone[step]) return;
  // Don't allow drawing on a future step
  if (step > 0 && !wwSession.stepsDone[step - 1]) return;

  try { if (audioCtx?.state === 'suspended') audioCtx.resume(); } catch (_) {}
  tts.unlockFromGesture();

  // Cancel any pending pause timer (user put finger down again)
  clearTimeout(wwSession.pauseTimers[step]);
  wwSession.pauseTimers[step] = null;

  const canvasEl = document.getElementById(`ww-canvas-${step}`);
  const { x, y } = wwGetPos(e, canvasEl);
  const ctx = wwSession.ctxs[step];

  wwSession.isDrawing[step] = true;
  wwSession.lastX[step] = x;
  wwSession.lastY[step] = y;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.strokeStyle = '#e8edf5';
  ctx.lineWidth   = 4;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
}

function wwPointerMove(e, step) {
  e.preventDefault();
  if (!wwSession || !wwSession.isDrawing[step]) return;

  const canvasEl = document.getElementById(`ww-canvas-${step}`);
  const { x, y } = wwGetPos(e, canvasEl);
  const ctx = wwSession.ctxs[step];

  // Smooth stroke via quadratic bezier to the midpoint
  const mx = (wwSession.lastX[step] + x) / 2;
  const my = (wwSession.lastY[step] + y) / 2;
  ctx.quadraticCurveTo(wwSession.lastX[step], wwSession.lastY[step], mx, my);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mx, my);

  wwSession.lastX[step] = x;
  wwSession.lastY[step] = y;
  wwSession.stepHasStrokes[step] = true;
}

function wwPointerUp(e, step) {
  if (!wwSession || !wwSession.isDrawing[step]) return;
  wwSession.isDrawing[step] = false;

  if (!wwSession.stepHasStrokes[step] || wwSession.stepsDone[step]) return;

  // 1.5 s of inactivity → auto-complete this step
  clearTimeout(wwSession.pauseTimers[step]);
  wwSession.pauseTimers[step] = setTimeout(() => markWWStepDone(step), 1500);
}

/* ─── Step completion ─────────────────────────────────────────── */
function markWWStepDone(step) {
  if (!wwSession || wwSession.stepsDone[step]) return;
  wwSession.stepsDone[step] = true;

  soundCorrect();
  playWordAudio(wwSession.words[wwSession.currentIdx]);

  // Show checkmark
  document.getElementById(`ww-check-${step}`).classList.add('visible');

  // Update styling
  const setEl = document.getElementById(`ww-set-${step}`);
  setEl.classList.remove('ww-active-step');
  setEl.classList.add('ww-done-step');

  const nextStep = step + 1;
  if (nextStep < 3) {
    const nextEl = document.getElementById(`ww-set-${nextStep}`);
    nextEl.classList.remove('ww-inactive-step');
    nextEl.classList.add('ww-active-step');
    nextEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    setTimeout(() => onWWWordComplete(), 600);
  }
}

function onWWWordComplete() {
  spawnConfetti(10);
  soundRoundComplete();
  playWordAudio('Great job!');
  document.getElementById('ww-next-btn').classList.add('visible');
}

function wwAdvanceWord() {
  const next = wwSession.currentIdx + 1;
  if (next >= WW_WORDS_PER_SESSION) {
    onWWComplete();
  } else {
    document.getElementById('ww-next-btn').classList.remove('visible');
    const zone = document.getElementById('ww-writing-zone');
    zone.style.opacity = '0';
    zone.style.transition = 'opacity 0.22s ease';
    setTimeout(() => {
      zone.style.opacity = '1';
      loadWWWord(next);
    }, 240);
  }
}

function wwClearStep(step) {
  if (!wwSession || wwSession.stepsDone[step]) return;
  // Can only clear the currently active step
  if (step > 0 && !wwSession.stepsDone[step - 1]) return;

  clearTimeout(wwSession.pauseTimers[step]);
  wwSession.pauseTimers[step] = null;
  wwSession.stepHasStrokes[step] = false;
  wwSession.isDrawing[step]      = false;
  wwSession.clears++;

  const ctx  = wwSession.ctxs[step];
  const cssW = wwSession.cssW[step];
  const cssH = wwSession.cssH[step];

  ctx.clearRect(0, 0, cssW, cssH);
  drawWWLines(ctx, cssW, cssH);
  if (step === 0) drawDottedWord(ctx, wwSession.words[wwSession.currentIdx], cssW, cssH);
}

function playWWWord() {
  const word = wwSession?.words[wwSession?.currentIdx];
  if (!word) return;
  const btn = document.getElementById('ww-speaker-btn');
  if (btn) {
    btn.classList.add('playing');
    btn.addEventListener('animationend', () => btn.classList.remove('playing'), { once: true });
  }
  playWordAudio(word);
}

/* ─── Session complete ────────────────────────────────────────── */
function onWWComplete() {
  const duration = Math.round((Date.now() - wwSession.sessionStartTime) / 1000);
  const clears   = wwSession.clears;

  let stars;
  if      (clears === 0 && duration < 180) { stars = 3; }
  else if (clears === 0)                   { stars = 2; }
  else if (clears <= 3)                    { stars = 1; }
  else                                     { stars = 0; }

  const today = getTodayStr();
  if (state.lastPlayDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    state.streak = (state.lastPlayDate === yStr || !state.lastPlayDate) ? state.streak + 1 : 1;
    state.lastPlayDate = today;
  }

  const seed = dateHash(today + 'ww' + stars);
  const pool = stars >= 2 ? CARDS.filter(c => c.rarity === 'rare') : CARDS.filter(c => c.rarity === 'standard');
  const card = pool[seed % pool.length];

  state.wwTodayDone  = true;
  state.wwTodayStars = stars;
  state.wwEarnedCard = card;
  state.wwPracticed  = [...wwSession.words];
  if (!state.earnedCards.includes(card.name)) state.earnedCards.push(card.name);

  saveProgress();
  showWWSummary(stars, card);
}

function showWWSummary(stars, card) {
  summaryMode = 'ww';
  showScreen('summary');
  soundSessionComplete();
  spawnConfetti(25);

  const titles = ['Keep practicing!', 'Good work!', 'Excellent!', 'Perfect!'];
  document.getElementById('summary-title').textContent = titles[Math.min(stars, 3)];
  document.getElementById('summary-date').textContent  = 'Word Writer · ' + formatDate(getTodayStr());

  ['star1', 'star2', 'star3'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.classList.remove('earned');
    if (i < stars) setTimeout(() => el.classList.add('earned'), 300 + i * 250);
  });

  const labels = ['Keep it up! ✨', 'Good work! 🎉', 'Excellent! 🌟', 'Perfect! 🏆'];
  document.getElementById('star-label').textContent = labels[Math.min(stars, 3)];

  const cardEl = document.getElementById('card-reveal');
  cardEl.className = 'card-reveal' + (card.rarity === 'rare' ? ' rare' : '');
  document.getElementById('card-emoji').textContent  = card.emoji;
  document.getElementById('card-name').textContent   = card.name;
  document.getElementById('card-rarity').textContent = card.rarity === 'rare' ? '✨ Rare card!' : "Today's card";
  document.getElementById('summary-streak-count').textContent = state.streak;
}

function showTodayWWSummary() {
  const card = state.wwEarnedCard || CARDS[0];
  showWWSummary(state.wwTodayStars, card);
}
