'use strict';

/* ─── Letter Writer ───────────────────────────────────────────── */

// Global onclick wrappers
function playLWWord() {
  const letter  = lwSession?.letters[lwSession.currentIdx];
  const pics    = letter ? (LW_PICTURES[letter] || []) : [];
  const picture = pics[lwSession?.currentPictureIdx ?? 0];
  const btn = document.getElementById('lw-speaker-btn');
  if (btn) { btn.classList.add('playing'); btn.addEventListener('animationend', () => btn.classList.remove('playing'), { once: true }); }
  tts.sayWord(picture?.word || letter || '');
}

function lwClear()  { clearLWCanvas(); }
function lwCheck()  { lwCheckLetter(); }
function lwRetry()  { document.getElementById('lw-btn-retry')?.click(); }
function lwNext()   { document.getElementById('lw-btn-next')?.click(); }
let lwSession  = null;
let lwCanvas   = null;
let lwCtx      = null;
let lwDrawing  = false;
let lwLastX    = 0;
let lwLastY    = 0;
let lwHasStrokes = false;

function buildLWSession() {
  const today   = getTodayStr();
  const seed    = dateHash(today + 'lw');
  const letters = Object.keys(LW_PICTURES);
  const shuffled = seededShuffle([...letters], seed);
  const chosen   = shuffled.slice(0, LW_ROUNDS_PER_SESSION);

  return {
    letters:          chosen,
    currentIdx:       0,
    currentPictureIdx: 0,
    totalIncorrect:   0,
    sessionStartTime: Date.now(),
    phase:            'uppercase', // 'uppercase' | 'lowercase'
  };
}

function startLetterWriter() {
  if (state.lwTodayDone) { showTodayLWSummary(); return; }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  tts.unlockFromGesture();

  lwSession = buildLWSession();
  lwCanvas  = document.getElementById('lw-canvas');
  lwCtx     = lwCanvas.getContext('2d');

  showScreen('lw-game');
  document.getElementById('lw-game-streak').textContent = state.streak;
  initLWCanvas();
  loadLWRound(0);
}

function initLWCanvas() {
  const wrap   = document.querySelector('.lw-canvas-wrap');
  const dpr    = window.devicePixelRatio || 1;
  lwCanvas.width  = wrap.clientWidth  * dpr;
  lwCanvas.height = wrap.clientHeight * dpr;
  lwCanvas.style.width  = wrap.clientWidth  + 'px';
  lwCanvas.style.height = wrap.clientHeight + 'px';
  lwCtx.scale(dpr, dpr);
  drawGuideLines();

  lwCanvas.addEventListener('pointerdown', lwOnPointerDown);
  lwCanvas.addEventListener('pointermove', lwOnPointerMove);
  lwCanvas.addEventListener('pointerup',   lwOnPointerUp);
  lwCanvas.addEventListener('pointercancel', lwOnPointerUp);
}

function drawGuideLines() {
  if (!lwCtx) return;
  const w = lwCanvas.width  / (window.devicePixelRatio || 1);
  const h = lwCanvas.height / (window.devicePixelRatio || 1);

  lwCtx.clearRect(0, 0, w, h);

  const topY  = h * 0.15;
  const midY  = h * 0.50;
  const baseY = h * 0.80;

  // Top line (green) — ascender height
  lwCtx.beginPath();
  lwCtx.strokeStyle = 'rgba(74,222,128,0.3)';
  lwCtx.lineWidth = 1.5;
  lwCtx.setLineDash([6, 4]);
  lwCtx.moveTo(16, topY); lwCtx.lineTo(w - 16, topY);
  lwCtx.stroke();

  // Mid line (dashed) — x-height
  lwCtx.beginPath();
  lwCtx.strokeStyle = 'rgba(0,229,204,0.2)';
  lwCtx.lineWidth = 1;
  lwCtx.setLineDash([4, 4]);
  lwCtx.moveTo(16, midY); lwCtx.lineTo(w - 16, midY);
  lwCtx.stroke();

  // Baseline (red)
  lwCtx.beginPath();
  lwCtx.strokeStyle = 'rgba(255,100,100,0.4)';
  lwCtx.lineWidth = 1.5;
  lwCtx.setLineDash([]);
  lwCtx.moveTo(16, baseY); lwCtx.lineTo(w - 16, baseY);
  lwCtx.stroke();

  lwCtx.setLineDash([]);
}

function loadLWRound(idx) {
  if (!lwSession) return;
  lwSession.currentIdx   = idx;
  lwSession.phase        = 'uppercase';
  lwSession.currentPictureIdx = 0;
  lwHasStrokes = false;

  const letter  = lwSession.letters[idx];
  const pics    = LW_PICTURES[letter] || [];
  const picture = pics[0];

  buildLWDots(idx);
  updateLWUI(letter, picture, 'uppercase');
  clearLWCanvas();
}

function buildLWDots(currentIdx) {
  const container = document.getElementById('lw-dots');
  container.innerHTML = '';
  for (let i = 0; i < LW_ROUNDS_PER_SESSION; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot' +
      (i < currentIdx   ? ' done'    : '') +
      (i === currentIdx ? ' current' : '');
    container.appendChild(dot);
  }
}

function updateLWUI(letter, picture, phase) {
  document.getElementById('lw-emoji').textContent    = picture ? picture.emoji : '✏️';
  document.getElementById('lw-pic-word').textContent = picture ? picture.word  : '';

  const stepLabel = document.getElementById('lw-step-label');
  const picHint   = document.getElementById('lw-pic-hint');
  if (phase === 'uppercase') {
    stepLabel.textContent = 'Uppercase';
    picHint.textContent   = `Trace the letter  ${letter.toUpperCase()}  like in "${picture?.word || ''}"`;
  } else {
    stepLabel.textContent = 'Lowercase';
    picHint.textContent   = `Now write the lowercase  ${letter}`;
  }

  document.getElementById('lw-btn-check').classList.remove('visible');
  document.getElementById('lw-post-check').classList.remove('visible');
  document.getElementById('lw-actions').style.display = 'flex';

  setTimeout(() => { tts.sayWord(picture?.word || letter); }, 400);
}

function clearLWCanvas() {
  if (!lwCtx) return;
  drawGuideLines();
  lwHasStrokes = false;
  document.getElementById('lw-btn-check').classList.remove('visible');
  document.getElementById('lw-post-check').classList.remove('visible');
  document.getElementById('lw-actions').style.display = 'flex';
}

/* ─── Drawing events ───────────────────────────────────────────── */
function lwGetPos(e) {
  const rect = lwCanvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return {
    x: src.clientX - rect.left,
    y: src.clientY - rect.top,
  };
}

function lwOnPointerDown(e) {
  e.preventDefault();
  lwDrawing = true;
  const { x, y } = lwGetPos(e);
  lwLastX = x; lwLastY = y;
  lwCtx.beginPath();
  lwCtx.moveTo(x, y);
  lwCtx.strokeStyle = '#00e5cc';
  lwCtx.lineWidth   = 5;
  lwCtx.lineCap     = 'round';
  lwCtx.lineJoin    = 'round';
}

function lwOnPointerMove(e) {
  if (!lwDrawing) return;
  e.preventDefault();
  const { x, y } = lwGetPos(e);
  lwCtx.lineTo(x, y);
  lwCtx.stroke();
  lwCtx.beginPath();
  lwCtx.moveTo(x, y);
  lwLastX = x; lwLastY = y;
  if (!lwHasStrokes) {
    lwHasStrokes = true;
    document.getElementById('lw-btn-check').classList.add('visible');
  }
}

function lwOnPointerUp(e) {
  lwDrawing = false;
}

/* ─── Check / Next / Retry ────────────────────────────────────── */
function lwCheckLetter() {
  // Simple heuristic: if the user drew anything, accept it and celebrate
  if (!lwHasStrokes) return;

  soundCorrect();
  spawnConfetti(10);
  tts.sayWord('Great job!');

  document.getElementById('lw-btn-check').classList.remove('visible');
  document.getElementById('lw-actions').style.display = 'none';
  document.getElementById('lw-post-check').classList.add('visible');

  const retryBtn = document.getElementById('lw-btn-retry');
  const nextBtn  = document.getElementById('lw-btn-next');

  const letter = lwSession.letters[lwSession.currentIdx];
  const pics   = LW_PICTURES[letter] || [];
  const isLastPhase = lwSession.phase === 'lowercase';

  retryBtn.onclick = () => {
    clearLWCanvas();
    updateLWUI(letter, pics[lwSession.currentPictureIdx], lwSession.phase);
  };

  nextBtn.textContent = isLastPhase ? 'Next Letter →' : 'Now Lowercase →';
  nextBtn.onclick = () => {
    if (!isLastPhase) {
      lwSession.phase = 'lowercase';
      clearLWCanvas();
      updateLWUI(letter, pics[lwSession.currentPictureIdx], 'lowercase');
    } else {
      lwAdvanceRound();
    }
  };
}

function lwAdvanceRound() {
  const next = lwSession.currentIdx + 1;
  if (next >= LW_ROUNDS_PER_SESSION) {
    soundRoundComplete();
    setTimeout(() => onLWComplete(), 800);
  } else {
    loadLWRound(next);
  }
}

function onLWComplete() {
  const duration = Math.round((Date.now() - lwSession.sessionStartTime) / 1000);
  const stars = duration < 120 ? 3 : duration < 210 ? 2 : 1;

  const today = getTodayStr();
  if (state.lastPlayDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    state.streak = (state.lastPlayDate === yStr || !state.lastPlayDate) ? state.streak + 1 : 1;
    state.lastPlayDate = today;
  }

  const seed = dateHash(today + 'lw' + stars);
  const pool = stars >= 2 ? CARDS.filter(c => c.rarity === 'rare') : CARDS.filter(c => c.rarity === 'standard');
  const card = pool[seed % pool.length];

  state.lwTodayDone  = true;
  state.lwTodayStars = stars;
  state.lwEarnedCard = card;
  if (!state.earnedCards.includes(card.name)) state.earnedCards.push(card.name);

  saveProgress();
  showLWSummary(stars, card);
}

function showLWSummary(stars, card) {
  summaryMode = 'lw';
  showScreen('summary');
  soundSessionComplete();
  spawnConfetti(25);

  const titles = ['Great start!', 'Well done!', 'Excellent!', 'Perfect!'];
  document.getElementById('summary-title').textContent = titles[Math.min(stars, 3)];
  document.getElementById('summary-date').textContent  = 'Letter Writer · ' + formatDate(getTodayStr());

  ['star1', 'star2', 'star3'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.classList.remove('earned');
    if (i < stars) setTimeout(() => el.classList.add('earned'), 300 + i * 250);
  });

  const labels = ['Keep it up! ✨', 'Well done! 🎉', 'Excellent! 🌟', 'Perfect! 🏆'];
  document.getElementById('star-label').textContent = labels[Math.min(stars, 3)];

  const cardEl = document.getElementById('card-reveal');
  cardEl.className = 'card-reveal' + (card.rarity === 'rare' ? ' rare' : '');
  document.getElementById('card-emoji').textContent   = card.emoji;
  document.getElementById('card-name').textContent    = card.name;
  document.getElementById('card-rarity').textContent  = card.rarity === 'rare' ? '✨ Rare card!' : "Today's card";
  document.getElementById('summary-streak-count').textContent = state.streak;
}

function showTodayLWSummary() {
  const card = state.lwEarnedCard || CARDS[0];
  showLWSummary(state.lwTodayStars, card);
}
