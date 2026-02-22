'use strict';

/* ─── Word Match ──────────────────────────────────────────────── */
const WM_WORDS_PER_SESSION = 5;

// Word pairs: left = picture word, right = its text label (possibly shuffled)
const WM_WORD_POOL = [
  { left: { emoji: '🐱', word: 'cat'  }, right: 'cat'  },
  { left: { emoji: '🐕', word: 'dog'  }, right: 'dog'  },
  { left: { emoji: '🐝', word: 'bee'  }, right: 'bee'  },
  { left: { emoji: '☀️', word: 'sun'  }, right: 'sun'  },
  { left: { emoji: '🎩', word: 'hat'  }, right: 'hat'  },
  { left: { emoji: '🍎', word: 'apple'}, right: 'apple'},
  { left: { emoji: '🐸', word: 'frog' }, right: 'frog' },
  { left: { emoji: '🌙', word: 'moon' }, right: 'moon' },
  { left: { emoji: '🐟', word: 'fish' }, right: 'fish' },
  { left: { emoji: '⭐', word: 'star' }, right: 'star' },
  { left: { emoji: '🚗', word: 'car'  }, right: 'car'  },
  { left: { emoji: '🌳', word: 'tree' }, right: 'tree' },
  { left: { emoji: '🥛', word: 'milk' }, right: 'milk' },
  { left: { emoji: '🥁', word: 'drum' }, right: 'drum' },
  { left: { emoji: '🐻', word: 'bear' }, right: 'bear' },
];

let wmSession = null;

function buildWMSession() {
  const today = getTodayStr();
  const seed  = dateHash(today + 'wm');
  const pool  = seededShuffle([...WM_WORD_POOL], seed).slice(0, WM_WORDS_PER_SESSION);

  const lefts  = pool.map(p => p.left);
  const rights = seededShuffle(pool.map(p => p.right), seed + 17);

  return {
    pairs: pool,
    lefts,
    rights,
    matched:          [],
    selectedLeft:     null,
    totalIncorrect:   0,
    sessionStartTime: Date.now(),
    lineData:         [],
  };
}

function startWordMatch() {
  if (state.wmTodayDone) { showTodayWMSummary(); return; }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  tts.unlockFromGesture();

  wmSession = buildWMSession();

  // Preload audio for session
  wmSession.lefts.forEach(item => preloadWordAudio(item.word));

  showScreen('wm-game');
  document.getElementById('wm-game-streak').textContent = state.streak;
  renderWMGrid();
}

function renderWMGrid() {
  const leftCol  = document.getElementById('wm-left');
  const rightCol = document.getElementById('wm-right');
  const svg      = document.getElementById('wm-lines');
  leftCol.innerHTML  = '';
  rightCol.innerHTML = '';
  svg.innerHTML      = '';
  wmSession.lineData = [];
  wmSession.selectedLeft = null;

  wmSession.lefts.forEach((item, i) => {
    const el = document.createElement('div');
    el.className   = 'wm-word';
    el.dataset.idx = String(i);
    el.textContent = item.emoji;
    el.style.fontSize = '2.5rem';
    el.addEventListener('click', () => onWMLeftTap(el, i));
    leftCol.appendChild(el);
  });

  wmSession.rights.forEach((word, i) => {
    const el = document.createElement('div');
    el.className   = 'wm-word';
    el.dataset.idx = String(i);
    el.textContent = word;
    el.addEventListener('click', () => onWMRightTap(el, i));
    rightCol.appendChild(el);
  });
}

function onWMLeftTap(el, idx) {
  if (el.classList.contains('matched')) return;
  try { if (audioCtx?.state === 'suspended') audioCtx.resume(); } catch (e) {}
  tts.unlockFromGesture();

  document.querySelectorAll('#wm-left .wm-word').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  wmSession.selectedLeft = idx;
  playWordAudio(wmSession.lefts[idx].word);
}

function onWMRightTap(el, rightIdx) {
  if (!wmSession || wmSession.selectedLeft === null) return;
  if (el.classList.contains('matched')) return;
  try { if (audioCtx?.state === 'suspended') audioCtx.resume(); } catch (e) {}
  tts.unlockFromGesture();

  const leftIdx   = wmSession.selectedLeft;
  const leftItem  = wmSession.lefts[leftIdx];
  const rightWord = wmSession.rights[rightIdx];

  // Check match: left emoji corresponds to a pair whose right word equals rightWord
  const isCorrect = leftItem.word === rightWord;

  if (isCorrect) {
    soundCorrect();
    playWordAudio(rightWord);

    const leftEl = document.querySelectorAll('#wm-left .wm-word')[leftIdx];
    leftEl.classList.remove('selected');
    leftEl.classList.add('matched');
    el.classList.add('matched');
    wmSession.selectedLeft = null;
    wmSession.matched.push({ leftIdx, rightIdx });

    drawMatchLine(leftIdx, rightIdx, true);

    if (wmSession.matched.length === WM_WORDS_PER_SESSION) {
      setTimeout(() => onWMComplete(), 900);
    }
  } else {
    wmSession.totalIncorrect++;
    soundIncorrect();
    el.classList.add('shake');
    el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
  }
}

function drawMatchLine(leftIdx, rightIdx, permanent) {
  const svg       = document.getElementById('wm-lines');
  const area      = document.getElementById('wm-area');
  const leftEls   = document.querySelectorAll('#wm-left .wm-word');
  const rightEls  = document.querySelectorAll('#wm-right .wm-word');

  if (!leftEls[leftIdx] || !rightEls[rightIdx]) return;

  const areaRect  = area.getBoundingClientRect();
  const leftRect  = leftEls[leftIdx].getBoundingClientRect();
  const rightRect = rightEls[rightIdx].getBoundingClientRect();

  const x1 = leftRect.right  - areaRect.left;
  const y1 = leftRect.top + leftRect.height / 2 - areaRect.top;
  const x2 = rightRect.left  - areaRect.left;
  const y2 = rightRect.top + rightRect.height / 2 - areaRect.top;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.className.baseVal = 'wm-line' + (permanent ? ' matched' : ' temp');
  svg.appendChild(line);
  requestAnimationFrame(() => line.classList.add('active'));
}

function onWMComplete() {
  const duration = Math.round((Date.now() - wmSession.sessionStartTime) / 1000);
  let stars;
  if (wmSession.totalIncorrect === 0) {
    stars = duration < 45 ? 3 : 2;
  } else if (wmSession.totalIncorrect <= 3) {
    stars = 1;
  } else {
    stars = 0;
  }

  const today = getTodayStr();
  if (state.lastPlayDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    state.streak = (state.lastPlayDate === yStr || !state.lastPlayDate) ? state.streak + 1 : 1;
    state.lastPlayDate = today;
  }

  const seed = dateHash(today + 'wm' + stars);
  const pool = stars >= 2 ? CARDS.filter(c => c.rarity === 'rare') : CARDS.filter(c => c.rarity === 'standard');
  const card = pool[seed % pool.length];

  state.wmTodayDone  = true;
  state.wmTodayStars = stars;
  state.wmEarnedCard = card;
  if (!state.earnedCards.includes(card.name)) state.earnedCards.push(card.name);

  saveProgress();
  showWMSummary(stars, card);
}

function showWMSummary(stars, card) {
  summaryMode = 'wm';
  showScreen('summary');
  soundSessionComplete();
  spawnConfetti(25);

  const titles = ['Keep practicing!', 'Great job!', 'Excellent!', 'Perfect!'];
  document.getElementById('summary-title').textContent = titles[Math.min(stars, 3)];
  document.getElementById('summary-date').textContent  = 'Word Match · ' + formatDate(getTodayStr());

  ['star1', 'star2', 'star3'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.classList.remove('earned');
    if (i < stars) setTimeout(() => el.classList.add('earned'), 300 + i * 250);
  });

  const labels = ['Keep practicing! ✨', 'Great job! 🎉', 'Excellent! 🌟', 'Perfect! 🏆'];
  document.getElementById('star-label').textContent = labels[Math.min(stars, 3)];

  const cardEl = document.getElementById('card-reveal');
  cardEl.className = 'card-reveal' + (card.rarity === 'rare' ? ' rare' : '');
  document.getElementById('card-emoji').textContent   = card.emoji;
  document.getElementById('card-name').textContent    = card.name;
  document.getElementById('card-rarity').textContent  = card.rarity === 'rare' ? '✨ Rare card!' : "Today's card";
  document.getElementById('summary-streak-count').textContent = state.streak;
}

function showTodayWMSummary() {
  const card = state.wmEarnedCard || CARDS[0];
  showWMSummary(state.wmTodayStars, card);
}
