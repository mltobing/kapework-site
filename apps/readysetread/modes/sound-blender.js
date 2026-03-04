'use strict';

/* ─── Sound Blender — scrub-to-blend ────────────────────────────── */
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
  // New words
  { word: 'cat', emoji: '🐱', phonemes: ['c','a','t'] },
  { word: 'hat', emoji: '🎩', phonemes: ['h','a','t'] },
  { word: 'mat', emoji: '🧹', phonemes: ['m','a','t'] },
  { word: 'dog', emoji: '🐶', phonemes: ['d','o','g'] },
  { word: 'pant', emoji: '👖', phonemes: ['p','a','n','t'] },
  { word: 'sand', emoji: '🏖️', phonemes: ['s','a','n','d'] },
  { word: 'hand', emoji: '✋', phonemes: ['h','a','n','d'] },
  { word: 'mint', emoji: '🌿', phonemes: ['m','i','n','t'] },
];

/* ─── Audio helpers ─────────────────────────────────────────────── */
function sbPlayPhoneme(letter) { playUnitAudio(letter); }
function sbPlayWord(word)       { playWordAudio(word); }
function sbPlaySFX(name)        { tryPlayFile(AUDIO_BASE + name); }

/* ─── Session state ─────────────────────────────────────────────── */
let sbSession = null;

function buildSBSession() {
  const today = getTodayStr();
  const seed = dateHash(today + 'sb');
  const shuffled = seededShuffle(SB_WORD_POOL, seed);
  const chosen = shuffled.slice(0, SB_WORDS_PER_SESSION);

  return {
    words: chosen.map(entry => ({
      ...entry,
      blended: false,
      hintUsed: false,
    })),
    currentIdx: 0,
    totalHints: 0,
    allInOrder: true,
    sessionStartTime: Date.now(),
    demoShown: !!localStorage.getItem('kapework_sb_demo_seen'),
  };
}

/* ─── Preload audio for session ─────────────────────────────────── */
function sbPreloadSession() {
  if (!sbSession) return;
  ['correct.wav', 'celebrate.wav', 'whoosh.wav'].forEach(f => preloadAudioFile(AUDIO_BASE + f));
  const vowelsNeeded = new Set();
  sbSession.words.forEach(e => {
    e.phonemes.forEach(p => {
      preloadUnitAudio(p);
      if (SB_VOWELS.has(p)) vowelsNeeded.add(p);
    });
    preloadWordAudio(e.word);
    preloadAudioFile(AUDIO_BASE + 'word_' + e.word + '_slow.mp3');
  });
  // Decode vowel loops into AudioBuffers for WebAudio sustain
  vowelsNeeded.forEach(v => preloadVowelBuffer(v));
}

/* ─── Scrub track state ─────────────────────────────────────────── */
let sbScrubbing = false;
let sbCurrentSnapIdx = -1;

/* ─── Start ─────────────────────────────────────────────────────── */
function startSoundBlender() {
  if (state.sbTodayDone) { showTodaySBSummary(); return; }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  tts.unlockFromGesture();

  sbSession = buildSBSession();
  showScreen('sb-game');
  document.getElementById('sb-game-streak').textContent = state.streak;

  sbPreloadSession();
  loadSBWord(0);
}

/* ─── Build round dots ──────────────────────────────────────────── */
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

/* ─── Load word ─────────────────────────────────────────────────── */
function loadSBWord(idx, animate = false) {
  if (!sbSession) return;
  sbSession.currentIdx = idx;
  sbCurrentSnapIdx = -1;
  sbScrubbing = false;
  const entry = sbSession.words[idx];
  if (!entry) return;

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
  instrEl.textContent = 'Slide your finger under the letters!';

  // Build boxes + track
  const boxContainer = document.getElementById('sb-boxes');
  if (animate) {
    boxContainer.classList.add('slide-out');
    boxContainer.addEventListener('animationend', () => {
      boxContainer.classList.remove('slide-out');
      renderSBBoxes(entry);
      boxContainer.classList.add('slide-in');
      boxContainer.addEventListener('animationend', () => boxContainer.classList.remove('slide-in'), { once: true });
    }, { once: true });
  } else {
    renderSBBoxes(entry);
  }

  // Show first-time demo on very first word ever
  if (!sbSession.demoShown && idx === 0) {
    sbSession.demoShown = true;
    localStorage.setItem('kapework_sb_demo_seen', '1');
    setTimeout(() => sbPlayDemo(), 600);
  }
}

/* ─── Render letter boxes + blending track ──────────────────────── */
function renderSBBoxes(entry) {
  const boxContainer = document.getElementById('sb-boxes');
  boxContainer.innerHTML = '';

  // Letter tiles row
  const tileRow = document.createElement('div');
  tileRow.className = 'sb-tile-row';
  tileRow.id = 'sb-tile-row';

  entry.phonemes.forEach((phoneme, i) => {
    const box = document.createElement('div');
    box.className = 'sb-box' + (SB_VOWELS.has(phoneme) ? ' sb-vowel' : ' sb-consonant');
    box.textContent = phoneme;
    box.dataset.idx = i;
    tileRow.appendChild(box);
  });

  boxContainer.appendChild(tileRow);

  // Blending track bar (sits under the tiles)
  const track = document.createElement('div');
  track.className = 'sb-track';
  track.id = 'sb-track';

  const handle = document.createElement('div');
  handle.className = 'sb-track-handle';
  handle.id = 'sb-track-handle';
  track.appendChild(handle);

  // Progress fill behind the handle
  const fill = document.createElement('div');
  fill.className = 'sb-track-fill';
  fill.id = 'sb-track-fill';
  track.appendChild(fill);

  boxContainer.appendChild(track);

  // Merged tile (hidden initially)
  const merged = document.createElement('div');
  merged.className = 'sb-merged';
  merged.id = 'sb-merged';
  merged.style.display = 'none';
  merged.textContent = entry.word;
  boxContainer.appendChild(merged);

  // Bind pointer events on the track
  sbBindTrackEvents(track);
}

/* ─── Pointer events for scrub track ────────────────────────────── */
function sbBindTrackEvents(track) {
  track.addEventListener('pointerdown', sbOnPointerDown, { passive: false });
  track.addEventListener('pointermove', sbOnPointerMove, { passive: false });
  track.addEventListener('pointerup', sbOnPointerUp, { passive: false });
  track.addEventListener('pointercancel', sbOnPointerUp, { passive: false });
  track.addEventListener('pointerleave', sbOnPointerUp, { passive: false });
}

function sbOnPointerDown(e) {
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (!entry || entry.blended) return;

  e.preventDefault();
  e.target.setPointerCapture?.(e.pointerId);

  // Unlock audio on first interaction (iOS requirement)
  try { if (audioCtx?.state === 'suspended') audioCtx.resume(); } catch (_) {}
  tts.unlockFromGesture();

  sbScrubbing = true;
  sbCurrentSnapIdx = -1;
  sbProcessPointer(e);
}

function sbOnPointerMove(e) {
  if (!sbScrubbing) return;
  e.preventDefault();
  sbProcessPointer(e);
}

function sbOnPointerUp(e) {
  if (!sbScrubbing) return;
  e.preventDefault();
  sbScrubbing = false;
  stopVowelSustain();

  // If we reached the last index, trigger completion
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (entry && sbCurrentSnapIdx === entry.phonemes.length - 1 && !entry.blended) {
    sbCompleteWord();
  }
}

/* ─── Process pointer position → snap to nearest letter ─────────── */
function sbProcessPointer(e) {
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (!entry || entry.blended) return;

  const tileRow = document.getElementById('sb-tile-row');
  const tiles = tileRow.querySelectorAll('.sb-box');
  if (!tiles.length) return;

  const track = document.getElementById('sb-track');
  const trackRect = track.getBoundingClientRect();
  const pointerX = e.clientX;

  // Find nearest tile center
  let bestIdx = 0;
  let bestDist = Infinity;
  const tileCenters = [];

  tiles.forEach((tile, i) => {
    const r = tile.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    tileCenters.push(cx);
    const dist = Math.abs(pointerX - cx);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  });

  // Only allow forward or same — no skipping backward past where we've been
  // But allow moving back to re-trigger
  if (bestIdx === sbCurrentSnapIdx) return; // same index, no change

  sbCurrentSnapIdx = bestIdx;
  sbOnSnapChange(bestIdx, entry, tiles, tileCenters, trackRect);
}

/* ─── Handle snap index change ──────────────────────────────────── */
function sbOnSnapChange(idx, entry, tiles, tileCenters, trackRect) {
  const phonemes = entry.phonemes;
  const lastIdx = phonemes.length - 1;

  // Update handle position
  const handle = document.getElementById('sb-track-handle');
  const fill = document.getElementById('sb-track-fill');
  const cx = tileCenters[idx];
  const leftPx = cx - trackRect.left;
  handle.style.left = leftPx + 'px';
  fill.style.width = leftPx + 'px';

  // Update active prefix highlight (0..idx lit)
  tiles.forEach((tile, i) => {
    tile.classList.toggle('sb-active', i <= idx);
  });

  // Audio behavior
  stopVowelSustain();

  if (idx < lastIdx) {
    // Play the phoneme for the current unit
    sbPlayPhoneme(phonemes[idx]);

    // If this unit is a vowel, start sustain loop
    if (SB_VOWELS.has(phonemes[idx])) {
      // Small delay so the phoneme plays first
      setTimeout(() => {
        if (sbScrubbing && sbCurrentSnapIdx === idx) {
          startVowelSustain(phonemes[idx]);
        }
      }, 250);
    }
  } else {
    // Last index: stop sustain, play full word, trigger success
    sbCompleteWord();
  }
}

/* ─── Complete word (reached last letter) ───────────────────────── */
function sbCompleteWord() {
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (!entry || entry.blended) return;

  entry.blended = true;
  sbScrubbing = false;
  stopVowelSustain();

  // Play whoosh SFX
  sbPlaySFX('whoosh.wav');

  // Animate boxes sliding together
  const tileRow = document.getElementById('sb-tile-row');
  const tiles = tileRow.querySelectorAll('.sb-box');
  const merged = document.getElementById('sb-merged');
  const track = document.getElementById('sb-track');

  const containerRect = tileRow.getBoundingClientRect();
  const centerX = containerRect.width / 2;

  tiles.forEach(box => {
    const boxRect = box.getBoundingClientRect();
    const boxCenterX = boxRect.left + boxRect.width / 2 - containerRect.left;
    const offset = centerX - boxCenterX;
    box.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
    box.style.transform = `translateX(${offset}px) scale(0.8)`;
    box.style.opacity = '0';
  });

  // Hide track
  track.style.transition = 'opacity 0.3s ease';
  track.style.opacity = '0';

  // Show merged tile after animation
  setTimeout(() => {
    tileRow.style.display = 'none';
    track.style.display = 'none';
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

/* ─── First-time demo animation ─────────────────────────────────── */
function sbPlayDemo() {
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (!entry || entry.blended) return;

  const tileRow = document.getElementById('sb-tile-row');
  const tiles = tileRow.querySelectorAll('.sb-box');
  const track = document.getElementById('sb-track');
  const handle = document.getElementById('sb-track-handle');
  const fill = document.getElementById('sb-track-fill');
  const trackRect = track.getBoundingClientRect();
  if (!tiles.length) return;

  // Collect tile centers
  const tileCenters = [];
  tiles.forEach(tile => {
    const r = tile.getBoundingClientRect();
    tileCenters.push(r.left + r.width / 2);
  });

  let demoIdx = 0;
  handle.classList.add('sb-demo-active');

  function demoStep() {
    if (!sbSession || entry.blended || demoIdx >= tiles.length) {
      handle.classList.remove('sb-demo-active');
      // Reset visuals
      tiles.forEach(t => t.classList.remove('sb-active'));
      handle.style.left = '';
      fill.style.width = '0';
      sbCurrentSnapIdx = -1;
      return;
    }

    const cx = tileCenters[demoIdx];
    const leftPx = cx - trackRect.left;
    handle.style.transition = 'left 0.35s ease';
    handle.style.left = leftPx + 'px';
    fill.style.transition = 'width 0.35s ease';
    fill.style.width = leftPx + 'px';

    tiles.forEach((t, i) => t.classList.toggle('sb-active', i <= demoIdx));

    // Play phoneme sound during demo
    sbPlayPhoneme(entry.phonemes[demoIdx]);

    demoIdx++;
    if (demoIdx < tiles.length) {
      setTimeout(demoStep, 700);
    } else {
      // End demo
      setTimeout(() => {
        handle.classList.remove('sb-demo-active');
        handle.style.transition = '';
        fill.style.transition = '';
        tiles.forEach(t => t.classList.remove('sb-active'));
        handle.style.left = '';
        fill.style.width = '0';
        sbCurrentSnapIdx = -1;
      }, 800);
    }
  }

  demoStep();
}

/* ─── Hint button ───────────────────────────────────────────────── */
function onSBHint() {
  if (!sbSession) return;
  const entry = sbSession.words[sbSession.currentIdx];
  if (!entry) return;

  entry.hintUsed = true;
  sbSession.totalHints++;

  const hintWord = document.getElementById('sb-hint-word');
  hintWord.textContent = entry.word;
  hintWord.style.opacity = '1';

  setTimeout(() => { hintWord.style.opacity = '0'; }, 2000);
}

/* ─── Advance word ──────────────────────────────────────────────── */
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

/* ─── Session complete ──────────────────────────────────────────── */
function onSBComplete() {
  const duration = Math.round((Date.now() - sbSession.sessionStartTime) / 1000);
  const hints = sbSession.totalHints;
  let stars;

  if (duration < 120 && hints === 0) {
    stars = 3;
  } else if (hints === 0) {
    stars = 2;
  } else if (hints <= 3) {
    stars = 1;
  } else {
    stars = 0;
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
