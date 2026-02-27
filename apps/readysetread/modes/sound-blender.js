'use strict';

/* ─── Sound Blender ───────────────────────────────────────────── */
const SB_WORDS_PER_SESSION = 8;
const SB_GUIDED_ROUNDS = 3;
const SB_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

const SB_WORD_POOL = [
  { word: 'sat', emoji: '🪑', phonemes: ['s','a','t'] },
  { word: 'sip', emoji: '🥤', phonemes: ['s','i','p'] },
  { word: 'sap', emoji: '🌳', phonemes: ['s','a','p'] },
  { word: 'tap', emoji: '👆', phonemes: ['t','a','p'] },
  { word: 'tan', emoji: '☀️', phonemes: ['t','a','n'] },
  { word: 'tip', emoji: '💡', phonemes: ['t','i','p'] },
  { word: 'tin', emoji: '🥫', phonemes: ['t','i','n'] },
  { word: 'pat', emoji: '🐾', phonemes: ['p','a','t'] },
  { word: 'pan', emoji: '🍳', phonemes: ['p','a','n'] },
  { word: 'pin', emoji: '📌', phonemes: ['p','i','n'] },
  { word: 'pit', emoji: '🕳️', phonemes: ['p','i','t'] },
  { word: 'nap', emoji: '😴', phonemes: ['n','a','p'] },
  { word: 'nip', emoji: '✂️', phonemes: ['n','i','p'] },
  { word: 'nit', emoji: '🔍', phonemes: ['n','i','t'] },
  { word: 'ant', emoji: '🐜', phonemes: ['a','n','t'] },
  { word: 'sit', emoji: '🪑', phonemes: ['s','i','t'] },
  { word: 'nat', emoji: '🦟', phonemes: ['n','a','t'] },
  { word: 'at',  emoji: '📍', phonemes: ['a','t'] },
  { word: 'an',  emoji: '1️⃣', phonemes: ['a','n'] },
  { word: 'in',  emoji: '📥', phonemes: ['i','n'] },
  { word: 'it',  emoji: '👉', phonemes: ['i','t'] },
  { word: 'is',  emoji: '✅', phonemes: ['i','s'] },
  { word: 'tat', emoji: '🧵', phonemes: ['t','a','t'] },
];

/* ─── Audio helpers (delegate to shared playWordAudio / playUnitAudio / tryPlayFile) */
function sbPlayPhoneme(letter) { playUnitAudio(letter); }
function sbPlayWord(word)       { playWordAudio(word); }
function sbPlayBlend(letters) {
  const blend = letters.join('').toLowerCase();
  playStoredAudio([AUDIO_BASE + 'blend_' + blend + '.mp3', AUDIO_BASE + 'blend_' + blend + '.wav'], `blend:${blend}`);
}
function sbPlaySFX(name)        { tryPlayFile(AUDIO_BASE + name); }

/* ─── Session state ───────────────────────────────────────────── */
let sbSession = null;

function buildSBSession() {
  const today = getTodayStr();
  const seed = dateHash(today + 'sb');
  const shuffled = seededShuffle(SB_WORD_POOL, seed);
  const chosen = shuffled.slice(0, SB_WORDS_PER_SESSION);

  return {
    words: chosen.map(entry => ({
      ...entry,
      tappedPhonemes: new Set(),
      tappedInOrder: true,
      nextExpected: 0,
      hintUsed: false,
      blended: false,
    })),
    currentIdx: 0,
    totalHints: 0,
    allInOrder: true,
    sessionStartTime: Date.now(),
    successiveBlending: localStorage.getItem('kapework_sb_successive') !== 'off',
    partialBlendPlayed: false,
  };
}

/* ─── Preload audio for session (uses shared cache) ──────────── */
function sbPreloadSession() {
  if (!sbSession) return;
  ['correct.wav', 'celebrate.wav', 'whoosh.wav'].forEach(f => preloadAudioFile(AUDIO_BASE + f));
  sbSession.words.forEach(e => {
    e.phonemes.forEach(p => preloadUnitAudio(p));
    preloadWordAudio(e.word);
    preloadAudioFile(AUDIO_BASE + 'word_' + e.word + '_slow.mp3');
    if (e.phonemes.length >= 2) {
      preloadAudioFile(AUDIO_BASE + 'blend_' + e.phonemes.slice(0, 2).join('') + '.mp3');
    }
  });
}

/* ─── Start ───────────────────────────────────────────────────── */
function startSoundBlender() {
  if (state.sbTodayDone) { showTodaySBSummary(); return; }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  tts.unlockFromGesture();

  sbSession = buildSBSession();
  showScreen('sb-game');
  document.getElementById('sb-game-streak').textContent = state.streak;

  // Preload audio (non-blocking)
  sbPreloadSession();

  loadSBWord(0);
}

/* ─── Build round dots ────────────────────────────────────────── */
function buildSBDots(currentIdx) {
  const container = document.getElementById('sb-dots');
  container.innerHTML = '';
  for (let i = 0; i < SB_WORDS_PER_SESSION; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot' +
      (i < currentIdx ? ' done' : '') +
      (i === currentIdx ? ' current' : '');
    container.appendChild(dot);
  }
}

/* ─── Load word ───────────────────────────────────────────────── */
function loadSBWord(idx, animate = false) {
  if (!sbSession) return;
  sbSession.currentIdx = idx;
  sbSession.partialBlendPlayed = false;
  const entry = sbSession.words[idx];
  if (!entry) return;

  const isGuided = idx < SB_GUIDED_ROUNDS;

  buildSBDots(idx);

  // Picture emoji
  const emojiEl = document.getElementById('sb-emoji');
  emojiEl.textContent = entry.emoji;
  emojiEl.classList.remove('sb-bounce');

  // Hint (hidden by default)
  const hintBtn = document.getElementById('sb-hint-btn');
  const hintWord = document.getElementById('sb-hint-word');
  hintBtn.style.display = '';
  hintWord.textContent = '';
  hintWord.style.opacity = '0';

  // Instruction
  const instrEl = document.getElementById('sb-instruction');
  instrEl.textContent = isGuided
    ? 'Tap each sound in order, then blend!'
    : 'Tap each sound, then blend!';

  // Blend button
  const blendBtn = document.getElementById('sb-blend-btn');
  blendBtn.classList.remove('sb-glow');
  blendBtn.disabled = true;

  // Settings gear
  const settingsEl = document.getElementById('sb-settings');
  settingsEl.style.display = '';

  // Build Elkonin boxes
  const boxContainer = document.getElementById('sb-boxes');
  if (animate) {
    boxContainer.classList.add('slide-out');
    boxContainer.addEventListener('animationend', () => {
      boxContainer.classList.remove('slide-out');
      renderSBBoxes(entry, isGuided);
      boxContainer.classList.add('slide-in');
      boxContainer.addEventListener('animationend', () => boxContainer.classList.remove('slide-in'), { once: true });
    }, { once: true });
  } else {
    renderSBBoxes(entry, isGuided);
  }
}

function renderSBBoxes(entry, isGuided) {
  const boxContainer = document.getElementById('sb-boxes');
  boxContainer.innerHTML = '';

  entry.phonemes.forEach((phoneme, i) => {
    const box = document.createElement('div');
    box.className = 'sb-box' + (SB_VOWELS.has(phoneme) ? ' sb-vowel' : ' sb-consonant');
    box.textContent = phoneme;
    box.dataset.idx = i;
    box.addEventListener('click', () => onSBBoxTap(box, i));

    // Guided mode: first untapped box pulses
    if (isGuided && i === 0) {
      box.classList.add('sb-pulse');
    }

    boxContainer.appendChild(box);
  });

  // Merged tile (hidden initially)
  const merged = document.createElement('div');
  merged.className = 'sb-merged';
  merged.id = 'sb-merged';
  merged.style.display = 'none';
  merged.textContent = entry.word;
  boxContainer.appendChild(merged);
}

/* ─── Box tap handler ─────────────────────────────────────────── */
function onSBBoxTap(box, idx) {
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (!entry || entry.blended) return;
  if (box.classList.contains('sb-tapped')) return;

  try { if (audioCtx?.state === 'suspended') audioCtx.resume(); } catch (e) {}
  tts.unlockFromGesture();

  const isGuided = sbSession.currentIdx < SB_GUIDED_ROUNDS;

  // Check order
  if (idx !== entry.nextExpected) {
    entry.tappedInOrder = false;
  }
  entry.nextExpected = Math.max(entry.nextExpected, idx + 1);

  // Mark as tapped
  entry.tappedPhonemes.add(idx);
  box.classList.add('sb-tapped');
  box.classList.remove('sb-pulse');

  // Play phoneme sound
  sbPlayPhoneme(entry.phonemes[idx]);

  // In guided mode, pulse the next untapped box
  if (isGuided) {
    const boxes = document.getElementById('sb-boxes').querySelectorAll('.sb-box');
    boxes.forEach(b => b.classList.remove('sb-pulse'));
    for (let i = 0; i < entry.phonemes.length; i++) {
      if (!entry.tappedPhonemes.has(i)) {
        boxes[i].classList.add('sb-pulse');
        break;
      }
    }
  }

  // Successive blending: after 2nd phoneme tapped in a word with 3+ phonemes
  if (sbSession.successiveBlending &&
      entry.phonemes.length >= 3 &&
      entry.tappedPhonemes.size === 2 &&
      !sbSession.partialBlendPlayed) {
    sbSession.partialBlendPlayed = true;
    setTimeout(() => {
      // Play partial blend of first 2 phonemes
      const firstTwo = entry.phonemes.slice(0, 2);
      sbPlayBlend(firstTwo);

      // Visually slide first two boxes slightly together
      const boxes = document.getElementById('sb-boxes').querySelectorAll('.sb-box');
      if (boxes[0] && boxes[1]) {
        boxes[0].classList.add('sb-partial-merge-left');
        boxes[1].classList.add('sb-partial-merge-right');
      }
    }, 800);
  }

  // Check if all phonemes tapped
  if (entry.tappedPhonemes.size === entry.phonemes.length) {
    const blendBtn = document.getElementById('sb-blend-btn');
    blendBtn.disabled = false;
    blendBtn.classList.add('sb-glow');
  }
}

/* ─── Hint button ─────────────────────────────────────────────── */
function onSBHint() {
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (!entry) return;

  entry.hintUsed = true;
  sbSession.totalHints++;

  const hintWord = document.getElementById('sb-hint-word');
  hintWord.textContent = entry.word;
  hintWord.style.opacity = '1';

  // Fade after 2s
  setTimeout(() => {
    hintWord.style.opacity = '0';
  }, 2000);
}

/* ─── Blend ───────────────────────────────────────────────────── */
function onSBBlend() {
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (!entry || entry.blended) return;
  if (entry.tappedPhonemes.size < entry.phonemes.length) return;

  entry.blended = true;

  // Play whoosh SFX
  sbPlaySFX('whoosh.wav');

  // Animate boxes sliding together
  const boxes = document.getElementById('sb-boxes').querySelectorAll('.sb-box');
  const merged = document.getElementById('sb-merged');
  const boxContainer = document.getElementById('sb-boxes');
  const containerRect = boxContainer.getBoundingClientRect();
  const centerX = containerRect.width / 2;

  boxes.forEach(box => {
    const boxRect = box.getBoundingClientRect();
    const boxCenterX = boxRect.left + boxRect.width / 2 - containerRect.left;
    const offset = centerX - boxCenterX;
    box.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
    box.style.transform = `translateX(${offset}px) scale(0.8)`;
    box.style.opacity = '0';
  });

  // Show merged tile after animation
  setTimeout(() => {
    boxes.forEach(box => box.style.display = 'none');
    merged.style.display = 'flex';
    merged.classList.add('sb-merged-pop');

    // Play whole word
    sbPlayWord(entry.word);

    // Play correct chime
    setTimeout(() => sbPlaySFX('correct.wav'), 200);

    // Bounce picture
    const emojiEl = document.getElementById('sb-emoji');
    emojiEl.classList.add('sb-bounce');

    // Confetti
    spawnConfetti(8);
  }, 500);

  // Auto-advance after celebration
  setTimeout(() => advanceSBWord(), 2000);
}

/* ─── Swipe support for blend ─────────────────────────────────── */
let sbSwipeStartX = 0;
let sbSwipeActive = false;

function onSBSwipeStart(e) {
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (!entry || entry.blended) return;
  if (entry.tappedPhonemes.size < entry.phonemes.length) return;

  const touch = e.touches ? e.touches[0] : e;
  sbSwipeStartX = touch.clientX;
  sbSwipeActive = true;
}

function onSBSwipeEnd(e) {
  if (!sbSwipeActive) return;
  sbSwipeActive = false;

  const touch = e.changedTouches ? e.changedTouches[0] : e;
  const dx = touch.clientX - sbSwipeStartX;
  if (dx > 60) {
    // Right swipe detected — trigger blend
    onSBBlend();
  }
}

/* ─── Advance word ────────────────────────────────────────────── */
function advanceSBWord() {
  if (!sbSession) return;
  const next = sbSession.currentIdx + 1;
  if (next >= SB_WORDS_PER_SESSION) {
    soundRoundComplete();
    setTimeout(() => onSBComplete(), 800);
  } else {
    loadSBWord(next, true);
  }
}

/* ─── Session complete ────────────────────────────────────────── */
function onSBComplete() {
  // Calculate stars
  const allInOrder = sbSession.words.every(w => w.tappedInOrder);
  const duration = Math.round((Date.now() - sbSession.sessionStartTime) / 1000);
  const hints = sbSession.totalHints;
  let stars;

  if (allInOrder && duration < 120 && hints === 0) {
    stars = 3; // All L→R, fast, no hints
  } else if (hints === 0) {
    stars = 2; // No hints
  } else if (hints <= 3) {
    stars = 1; // Few hints
  } else {
    stars = 0; // 4+ hints — still completed
  }

  // Update streak
  const today = getTodayStr();
  if (state.lastPlayDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    state.streak = (state.lastPlayDate === yStr || !state.lastPlayDate) ? state.streak + 1 : 1;
    state.lastPlayDate = today;
  }

  // Collectible card
  const seed = dateHash(today + 'sb' + stars);
  const pool = stars >= 2 ? CARDS.filter(c => c.rarity === 'rare') : CARDS.filter(c => c.rarity === 'standard');
  const card = pool[seed % pool.length];

  state.sbTodayDone  = true;
  state.sbTodayStars = stars;
  state.sbEarnedCard = card;
  if (!state.earnedCards.includes(card.name)) state.earnedCards.push(card.name);

  sbPlaySFX('celebrate.wav');
  saveProgress();
  showSBSummary(stars, card);
}

function showSBSummary(stars, card) {
  summaryMode = 'sb';
  showScreen('summary');
  soundSessionComplete();
  spawnConfetti(25);

  const titles = ['Keep practicing!', 'Great job!', 'Excellent!', 'Perfect!'];
  document.getElementById('summary-title').textContent = titles[Math.min(stars, 3)];
  document.getElementById('summary-date').textContent  = 'Sound Blender · ' + formatDate(getTodayStr());

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

function showTodaySBSummary() {
  const card = state.sbEarnedCard || CARDS[0];
  showSBSummary(state.sbTodayStars, card);
}

/* ─── Settings toggle ─────────────────────────────────────────── */
function toggleSBSuccessive() {
  if (!sbSession) return;
  sbSession.successiveBlending = !sbSession.successiveBlending;
  localStorage.setItem('kapework_sb_successive', sbSession.successiveBlending ? 'on' : 'off');
  const label = document.getElementById('sb-successive-label');
  if (label) {
    label.textContent = sbSession.successiveBlending ? 'Successive blending: ON' : 'Successive blending: OFF';
  }
  showToast(sbSession.successiveBlending ? 'Successive blending ON' : 'Successive blending OFF');
}
