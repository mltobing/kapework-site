'use strict';

/* ─── Sight Word Dash ──────────────────────────────────────────── */
let swSession = null;

function buildSWSession() {
  const tier  = SIGHT_WORD_TIERS.pre_primer;
  const today = getTodayStr();
  const seed  = dateHash(today + 'sw');

  const withPts = tier.map(w => ({ ...w, pts: state.swMastery[w.word] ?? 0 }));
  const pool = [
    ...seededShuffle(withPts.filter(w => w.pts <  10), seed),
    ...seededShuffle(withPts.filter(w => w.pts >= 10), seed + 1),
  ];

  const chosen = pool.slice(0, SW_WORDS_PER_SESSION);
  return {
    words: chosen.map(item => {
      const options = seededShuffle(
        [item.word, ...item.distractors],
        seed + item.word.length + item.word.charCodeAt(0)
      );
      return { word: item.word, options, taps: 0, solved: false };
    }),
    currentIdx:      0,
    totalIncorrect:  0,
    sessionStartTime: Date.now(),
    fadeTimer:       null,
  };
}

function startSightWordDash() {
  if (state.swTodayDone) { showTodaySWSummary(); return; }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  tts.unlockFromGesture();

  swSession = buildSWSession();
  showScreen('sw-game');
  document.getElementById('sw-game-streak').textContent = state.streak;
  loadSWWord(0);
}

function buildSWDots(currentIdx) {
  const container = document.getElementById('sw-dots');
  container.innerHTML = '';
  for (let i = 0; i < SW_WORDS_PER_SESSION; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot' +
      (i < currentIdx   ? ' done'    : '') +
      (i === currentIdx ? ' current' : '');
    container.appendChild(dot);
  }
}

function loadSWWord(idx, animate = false) {
  if (!swSession) return;
  swSession.currentIdx = idx;
  const entry = swSession.words[idx];
  if (!entry) return;

  buildSWDots(idx);

  const wordEl = document.getElementById('sw-word');
  wordEl.textContent = entry.word;
  wordEl.classList.remove('faded');

  if (swSession.fadeTimer) { clearTimeout(swSession.fadeTimer); swSession.fadeTimer = null; }
  setTimeout(() => tts.sayWord(entry.word), 350);
  swSession.fadeTimer = setTimeout(() => wordEl.classList.add('faded'), 2300);

  const grid = document.getElementById('sw-options-grid');
  const renderOptions = () => {
    grid.innerHTML = '';
    entry.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'sw-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => onSWOptionTap(btn, opt, entry));
      grid.appendChild(btn);
    });
    if (animate) {
      grid.classList.remove('slide-out');
      grid.classList.add('slide-in');
      grid.addEventListener('animationend', () => grid.classList.remove('slide-in'), { once: true });
    }
  };

  if (animate) {
    grid.classList.add('slide-out');
    grid.addEventListener('animationend', renderOptions, { once: true });
  } else {
    renderOptions();
  }
}

function playSWWord() {
  const entry = swSession?.words[swSession.currentIdx];
  if (!entry) return;
  const btn = document.getElementById('sw-speaker-btn');
  btn.classList.add('playing');
  btn.addEventListener('animationend', () => btn.classList.remove('playing'), { once: true });
  tts.sayWord(entry.word);
}

function onSWWordTap() {
  const wordEl = document.getElementById('sw-word');
  wordEl.classList.remove('faded');
  if (swSession) {
    if (swSession.fadeTimer) clearTimeout(swSession.fadeTimer);
    swSession.fadeTimer = setTimeout(() => wordEl.classList.add('faded'), 2000);
  }
}

function onSWOptionTap(btn, tappedWord, entry) {
  if (btn.classList.contains('correct') || btn.classList.contains('locked-out')) return;
  try { if (audioCtx?.state === 'suspended') audioCtx.resume(); } catch (e) {}
  tts.unlockFromGesture();

  entry.taps++;

  if (tappedWord === entry.word) {
    btn.classList.add('correct');
    soundCorrect();
    tts.sayWord(entry.word);
    const pts = entry.taps === 1 ? 2 : entry.taps === 2 ? 1 : 0;
    state.swMastery[entry.word] = (state.swMastery[entry.word] ?? 0) + pts;
    entry.solved = true;
    setTimeout(() => advanceSWWord(), 800);
  } else {
    swSession.totalIncorrect++;
    soundIncorrect();
    btn.classList.add('shake');
    btn.addEventListener('animationend', () => btn.classList.remove('shake'), { once: true });
    const wrongTaps = parseInt(btn.dataset.wrongTaps || '0') + 1;
    btn.dataset.wrongTaps = String(wrongTaps);
    if (wrongTaps >= 2) btn.classList.add('locked-out');
  }
}

function advanceSWWord() {
  if (!swSession) return;
  const next = swSession.currentIdx + 1;
  if (next >= SW_WORDS_PER_SESSION) {
    soundRoundComplete();
    setTimeout(() => onSWComplete(), 800);
  } else {
    loadSWWord(next, true);
  }
}

function onSWComplete() {
  const duration = Math.round((Date.now() - swSession.sessionStartTime) / 1000);
  let stars;
  if (swSession.totalIncorrect === 0) {
    stars = duration < 60 ? 3 : 2;
  } else if (swSession.totalIncorrect <= 3) {
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

  const seed = dateHash(today + 'sw' + stars);
  const pool = stars >= 2 ? CARDS.filter(c => c.rarity === 'rare') : CARDS.filter(c => c.rarity === 'standard');
  const card = pool[seed % pool.length];

  state.swTodayDone  = true;
  state.swTodayStars = stars;
  state.swEarnedCard = card;
  if (!state.earnedCards.includes(card.name)) state.earnedCards.push(card.name);

  saveProgress();
  showSWSummary(stars, card);
}

function showSWSummary(stars, card) {
  summaryMode = 'sw';
  showScreen('summary');
  soundSessionComplete();
  spawnConfetti(25);

  const titles = ['Keep practicing!', 'Great job!', 'Excellent!', 'Perfect!'];
  document.getElementById('summary-title').textContent = titles[Math.min(stars, 3)];
  document.getElementById('summary-date').textContent  = 'Sight Word Dash · ' + formatDate(getTodayStr());

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

function showTodaySWSummary() {
  const card = state.swEarnedCard || CARDS[0];
  showSWSummary(state.swTodayStars, card);
}
