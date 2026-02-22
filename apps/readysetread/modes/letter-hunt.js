'use strict';

/* ─── Letter Hunt ──────────────────────────────────────────────── */
const ROUNDS_PER_SESSION = 5;

function buildSession() {
  const letters = Object.keys(ALL_LETTERS);
  const today   = getTodayStr();
  const seed    = dateHash(today);
  const shuffled = seededShuffle([...letters], seed);
  const chosen   = shuffled.slice(0, ROUNDS_PER_SESSION);

  return chosen.map(letter => {
    const data    = ALL_LETTERS[letter];
    const correct = data.items.filter(i => i.correct);
    const wrong   = data.items.filter(i => !i.correct);

    const corrItems = seededShuffle(correct, seed + letter.charCodeAt(0)).slice(0, 2);
    const wronItems = seededShuffle(wrong,   seed + letter.charCodeAt(0) + 7).slice(0, 4);
    const all = seededShuffle([...corrItems, ...wronItems], seed + letter.charCodeAt(0) + 13);

    return { letter, hint: data.hint, items: all };
  });
}

function startLetterHunt() {
  if (state.todayDone) { showTodaySummary(); return; }

  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  tts.unlockFromGesture();

  state.rounds           = buildSession();
  state.currentRound     = 0;
  state.totalIncorrect   = 0;
  state.sessionStartTime = Date.now();

  showScreen('game');
  document.getElementById('game-streak').textContent = state.streak;
  loadRound(0);
}

function loadRound(index, animate = false) {
  const round = state.rounds[index];
  if (!round) return;

  state.foundCorrect   = 0;
  state.roundIncorrect = 0;
  state.tapCounts      = {};

  buildRoundDots(index);

  document.getElementById('letter-chars').textContent = `${round.letter.toUpperCase()} ${round.letter}`;
  document.getElementById('letter-hint').textContent   = round.hint;

  const grid = document.getElementById('picture-grid');

  const renderGrid = () => {
    grid.innerHTML = '';
    round.items.forEach(item => {
      const card = document.createElement('div');
      card.className       = 'pic-card';
      card.dataset.word    = item.word;
      card.dataset.correct = item.correct ? '1' : '0';
      card.innerHTML = `
        <span class="pic-emoji">${item.emoji}</span>
        <span class="pic-check">✓</span>
      `;
      card.addEventListener('click', () => onCardTap(card, item));
      grid.appendChild(card);
    });
    if (animate) {
      grid.classList.remove('slide-out');
      grid.classList.add('slide-in');
      grid.addEventListener('animationend', () => grid.classList.remove('slide-in'), { once: true });
    }
  };

  if (animate) {
    grid.classList.add('slide-out');
    grid.addEventListener('animationend', () => { renderGrid(); }, { once: true });
  } else {
    renderGrid();
  }

  setTimeout(() => playLetterSound(), 400);
}

function buildRoundDots(currentIndex) {
  const container = document.getElementById('round-dots');
  container.innerHTML = '';
  for (let i = 0; i < ROUNDS_PER_SESSION; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot' +
      (i < currentIndex  ? ' done'    : '') +
      (i === currentIndex ? ' current' : '');
    container.appendChild(dot);
  }
}

function onCardTap(card, item) {
  if (card.classList.contains('correct') || card.classList.contains('locked-out')) return;

  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
  } catch(e) {}
  tts.unlockFromGesture();

  const word = item.word;
  state.tapCounts[word] = (state.tapCounts[word] || 0) + 1;

  if (item.correct) {
    card.classList.add('correct');
    soundCorrect();
    playWordAudio(item.word);
    state.foundCorrect++;
    if (state.foundCorrect === 2) {
      setTimeout(() => onRoundComplete(), 600);
    }
  } else {
    state.totalIncorrect++;
    state.roundIncorrect++;
    soundIncorrect();
    card.classList.add('shake');
    card.addEventListener('animationend', () => card.classList.remove('shake'), { once: true });
    if (state.tapCounts[word] >= 2) {
      card.classList.add('locked-out');
    }
  }
}

function playLetterSound() {
  const btn = document.getElementById('speaker-btn');
  btn.classList.add('playing');
  btn.addEventListener('animationend', () => btn.classList.remove('playing'), { once: true });
  const round = state.rounds[state.currentRound];
  if (round) playLetterPhoneme(round.letter);
}

function onRoundComplete() {
  soundRoundComplete();
  spawnConfetti(8);
  const next = state.currentRound + 1;
  if (next >= ROUNDS_PER_SESSION) {
    setTimeout(() => onSessionComplete(), 1200);
  } else {
    state.currentRound = next;
    setTimeout(() => loadRound(next, true), 1000);
  }
}

function onSessionComplete() {
  const duration = Math.round((Date.now() - state.sessionStartTime) / 1000);
  let stars;
  if (state.totalIncorrect === 0) {
    stars = duration < 90 ? 3 : 2;
  } else if (state.totalIncorrect <= 3) {
    stars = 1;
  } else {
    stars = 0;
  }

  const today = getTodayStr();
  if (state.lastPlayDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    if (state.lastPlayDate === yStr || !state.lastPlayDate) {
      state.streak++;
    } else {
      state.streak = 1;
    }
    state.lastPlayDate = today;
  }

  const seed = dateHash(today + stars);
  const pool = stars >= 2 ? CARDS.filter(c => c.rarity === 'rare') : CARDS.filter(c => c.rarity === 'standard');
  const card = pool[seed % pool.length];

  state.todayDone  = true;
  state.todayStars = stars;
  state.earnedCard = card;
  if (!state.earnedCards.includes(card.name)) state.earnedCards.push(card.name);

  saveProgress();
  showSummary(stars, card);
}

function showSummary(stars, card) {
  summaryMode = 'lh';
  showScreen('summary');
  soundSessionComplete();
  spawnConfetti(25);

  const titles = ['Keep practicing!', 'Great job!', 'Excellent!', 'Perfect!'];
  document.getElementById('summary-title').textContent = titles[Math.min(stars, 3)];
  document.getElementById('summary-date').textContent  = formatDate(getTodayStr());

  ['star1','star2','star3'].forEach((id, i) => {
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

function showTodaySummary() {
  const card = state.earnedCard || CARDS[0];
  showSummary(state.todayStars, card);
}
