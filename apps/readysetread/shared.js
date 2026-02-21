'use strict';

/* ─── Audio ────────────────────────────────────────────────────── */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', gainVal = 0.4) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* audio not available */ }
}

function playChord(freqs, duration) {
  freqs.forEach((f, i) => {
    setTimeout(() => playTone(f, duration, 'sine', 0.3), i * 60);
  });
}

function soundCorrect() {
  playChord([523, 659, 784], 0.4);
}

function soundIncorrect() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {}
}

function soundRoundComplete() {
  const notes = [392, 494, 587, 698, 784];
  notes.forEach((f, i) => {
    setTimeout(() => playTone(f, 0.3, 'sine', 0.25), i * 90);
  });
}

function soundSessionComplete() {
  const notes = [523, 659, 784, 1047, 1319];
  notes.forEach((f, i) => {
    setTimeout(() => playTone(f, 0.5, 'sine', 0.28), i * 100);
  });
  setTimeout(() => playChord([523, 659, 784], 0.8), 600);
}

/* ─── Speech Synthesis — TTSPhonics engine ─────────────────────── */
const PHONEMES = {
  // ─── Tier 1 — Foundation ─────────────────────────────────────
  s:  { text: 'snake',    cutMs: 230 },
  a:  { text: 'ant',      cutMs: 220 },
  t:  { text: 'tuh'                  },
  p:  { text: 'puh'                  },
  i:  { text: 'in',       cutMs: 200 },
  n:  { text: 'nose',     cutMs: 220 },
  // ─── Tier 2 — Core ───────────────────────────────────────────
  m:  { text: 'moon',     cutMs: 220 },
  d:  { text: 'duh'                  },
  g:  { text: 'guh'                  },
  o:  { text: 'octopus',  cutMs: 220 },
  c:  { text: 'kuh'                  },
  k:  { text: 'kuh'                  },
  e:  { text: 'egg',      cutMs: 200 },
  r:  { text: 'run',      cutMs: 200 },
  h:  { text: 'hat',      cutMs: 180 },
  b:  { text: 'buh'                  },
  u:  { text: 'up',       cutMs: 180 },
  l:  { text: 'lion',     cutMs: 220 },
  f:  { text: 'fish',     cutMs: 230 },
  // ─── Tier 3 — Extended ───────────────────────────────────────
  j:  { text: 'juh'                  },
  w:  { text: 'wet',      cutMs: 200 },
  v:  { text: 'van',      cutMs: 200 },
  x:  { text: 'x-ray'                },
  y:  { text: 'yellow',   cutMs: 200 },
  z:  { text: 'zoo',      cutMs: 200 },
  q:  { text: 'queen',    cutMs: 220 },
  // ─── Tier 4 — Digraphs ───────────────────────────────────────
  sh: { text: 'ship',     cutMs: 230 },
  ch: { text: 'chair',    cutMs: 230 },
  th: { text: 'thumb',    cutMs: 230 },
  wh: { text: 'whale',    cutMs: 230 },
  ck: { text: 'kuh'                  },
  // ─── Tier 5 — Blends ─────────────────────────────────────────
  bl: { text: 'blue',     cutMs: 250 },
  cl: { text: 'clap',     cutMs: 250 },
  fl: { text: 'flag',     cutMs: 250 },
  br: { text: 'brush',    cutMs: 250 },
  cr: { text: 'crab',     cutMs: 250 },
  fr: { text: 'frog',     cutMs: 250 },
  st: { text: 'stop',     cutMs: 250 },
  sp: { text: 'spoon',    cutMs: 250 },
  gl: { text: 'glue',     cutMs: 250 },
  pl: { text: 'play',     cutMs: 250 },
  sl: { text: 'sleep',    cutMs: 250 },
  gr: { text: 'green',    cutMs: 250 },
  pr: { text: 'prize',    cutMs: 250 },
  tr: { text: 'truck',    cutMs: 250 },
  dr: { text: 'drum',     cutMs: 250 },
  sk: { text: 'skate',    cutMs: 250 },
  sn: { text: 'snail',    cutMs: 250 },
  sm: { text: 'smile',    cutMs: 250 },
  sw: { text: 'swim',     cutMs: 250 },
  tw: { text: 'twin',     cutMs: 250 },
};

class TTSPhonics {
  constructor({ ratePhoneme = 0.80, rateWord = 0.90, pitch = 1.00, volume = 1.00, lang = 'en-US' } = {}) {
    this.ratePhoneme = ratePhoneme;
    this.rateWord    = rateWord;
    this.pitch       = pitch;
    this.volume      = volume;
    this.lang        = lang;
    this.voice       = null;
    this.unlocked    = false;
    this._cutTimer   = null;
  }

  async init() {
    await this._ensureVoices();
    this.voice = this._pickEnglishVoice(this.lang);
  }

  unlockFromGesture() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance('unlock');
      u.volume = 0; u.rate = this.ratePhoneme; u.pitch = this.pitch; u.lang = this.lang;
      if (this.voice) u.voice = this.voice;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      setTimeout(() => window.speechSynthesis.cancel(), 30);
    } catch (e) {}
  }

  playPhoneme(key) {
    const entry = PHONEMES[key];
    if (!entry) return false;
    return this._speak(entry.text, { cutMs: entry.cutMs ?? null, rate: this.ratePhoneme });
  }

  sayWord(word) {
    return this._speak(String(word), { cutMs: null, rate: this.rateWord });
  }

  stop() {
    if (!('speechSynthesis' in window)) return;
    if (this._cutTimer) { clearTimeout(this._cutTimer); this._cutTimer = null; }
    window.speechSynthesis.cancel();
  }

  _speak(text, { cutMs = null, rate = 0.9 } = {}) {
    if (!('speechSynthesis' in window)) return false;
    this.stop();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate; u.pitch = this.pitch; u.volume = this.volume; u.lang = this.lang;
    if (this.voice) u.voice = this.voice;
    u.onstart = () => {
      if (cutMs != null) {
        this._cutTimer = setTimeout(() => { window.speechSynthesis.cancel(); this._cutTimer = null; }, cutMs);
      }
    };
    u.onend = u.onerror = () => {
      if (this._cutTimer) { clearTimeout(this._cutTimer); this._cutTimer = null; }
    };
    window.speechSynthesis.speak(u);
    return true;
  }

  async _ensureVoices() {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    if (synth.getVoices && synth.getVoices().length > 0) return;
    await new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; synth.removeEventListener('voiceschanged', finish); resolve(); } };
      synth.addEventListener('voiceschanged', finish);
      setTimeout(finish, 600);
    });
  }

  _pickEnglishVoice(lang = 'en-US') {
    if (!window.speechSynthesis || !window.speechSynthesis.getVoices) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    return voices.find(v => (v.lang || '').toLowerCase() === lang.toLowerCase())
        || voices.find(v => (v.lang || '').toLowerCase().startsWith('en'))
        || voices[0] || null;
  }
}

const tts = new TTSPhonics();

function playLetterPhoneme(letter) { tts.playPhoneme(letter); }

/* ─── State ────────────────────────────────────────────────────── */
let state = {
  // Session
  currentRound: 0,
  rounds: [],
  totalIncorrect: 0,
  sessionStartTime: null,
  // Round
  foundCorrect: 0,
  roundIncorrect: 0,
  tapCounts: {},
  // Progress (from localStorage)
  streak: 0,
  lastPlayDate: null,
  todayDone: false,
  todayStars: 0,
  earnedCard: null,
  earnedCards: [],
  // Sight Word Dash
  swMastery:    {},
  swTodayDone:  false,
  swTodayStars: 0,
  swEarnedCard: null,
  // Word Match
  wmTodayDone:  false,
  wmTodayStars: 0,
  wmEarnedCard: null,
  // Letter Writer
  lwTodayDone:  false,
  lwTodayStars: 0,
  lwEarnedCard: null,
  // Word Writer
  wwTodayDone:  false,
  wwTodayStars: 0,
  wwEarnedCard: null,
  wwPracticed:  [],
};

/* ─── LocalStorage helpers ─────────────────────────────────────── */
const LS_KEY = 'kapework_lh_v1';

function loadProgress() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.streak         = data.streak ?? 0;
    state.lastPlayDate   = data.lastPlayDate ?? null;
    state.todayDone      = data.todayDone ?? false;
    state.todayStars     = data.todayStars ?? 0;
    state.earnedCard     = data.earnedCard  ?? null;
    state.earnedCards    = data.earnedCards ?? [];
    state.swMastery      = data.swMastery   ?? {};
    state.swTodayDone    = data.swTodayDone  ?? false;
    state.swTodayStars   = data.swTodayStars ?? 0;
    state.swEarnedCard   = data.swEarnedCard ?? null;
    state.wmTodayDone    = data.wmTodayDone  ?? false;
    state.wmTodayStars   = data.wmTodayStars ?? 0;
    state.wmEarnedCard   = data.wmEarnedCard ?? null;
    state.lwTodayDone    = data.lwTodayDone  ?? false;
    state.lwTodayStars   = data.lwTodayStars ?? 0;
    state.lwEarnedCard   = data.lwEarnedCard ?? null;
    state.wwTodayDone    = data.wwTodayDone  ?? false;
    state.wwTodayStars   = data.wwTodayStars ?? 0;
    state.wwEarnedCard   = data.wwEarnedCard ?? null;
    state.wwPracticed    = data.wwPracticed  ?? [];

    const today = getTodayStr();
    if (data.lastPlayDate !== today) {
      state.todayDone    = false;
      state.todayStars   = 0;
      state.earnedCard   = null;
      state.swTodayDone  = false;
      state.swTodayStars = 0;
      state.swEarnedCard = null;
      state.wmTodayDone  = false;
      state.wmTodayStars = 0;
      state.wmEarnedCard = null;
      state.lwTodayDone  = false;
      state.lwTodayStars = 0;
      state.lwEarnedCard = null;
      state.wwTodayDone  = false;
      state.wwTodayStars = 0;
      state.wwEarnedCard = null;
      state.wwPracticed  = [];
      // earnedCards and swMastery persist across days
    }
    if (state.lastPlayDate) {
      const daysSince = daysBetween(state.lastPlayDate, today);
      if (daysSince > 1) state.streak = 0;
    }
  } catch (e) { /* corrupt storage, ignore */ }
}

function saveProgress() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      streak:        state.streak,
      lastPlayDate:  state.lastPlayDate,
      todayDone:     state.todayDone,
      todayStars:    state.todayStars,
      earnedCard:    state.earnedCard,
      earnedCards:   state.earnedCards,
      swMastery:     state.swMastery,
      swTodayDone:   state.swTodayDone,
      swTodayStars:  state.swTodayStars,
      swEarnedCard:  state.swEarnedCard,
      wmTodayDone:   state.wmTodayDone,
      wmTodayStars:  state.wmTodayStars,
      wmEarnedCard:  state.wmEarnedCard,
      lwTodayDone:   state.lwTodayDone,
      lwTodayStars:  state.lwTodayStars,
      lwEarnedCard:  state.lwEarnedCard,
      wwTodayDone:   state.wwTodayDone,
      wwTodayStars:  state.wwTodayStars,
      wwEarnedCard:  state.wwEarnedCard,
      wwPracticed:   state.wwPracticed,
    }));
  } catch (e) {}
}

/* ─── Date utilities ───────────────────────────────────────────── */
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysBetween(a, b) {
  const msPerDay = 86400000;
  return Math.round(Math.abs(new Date(b) - new Date(a)) / msPerDay);
}

function formatDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m-1]} ${d}, ${y}`;
}

/* ─── Seeded randomness (shared across all modes) ──────────────── */
function dateHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─── Navigation ───────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goHome() {
  updateHomeUI();
  showScreen('home');
}

function updateHomeUI() {
  document.getElementById('home-streak').textContent = state.streak;

  const lhCard   = document.getElementById('lh-card');
  const lhStatus = document.getElementById('lh-status');
  if (state.todayDone) {
    lhCard.classList.remove('ready'); lhCard.classList.add('done');
    lhStatus.className   = 'mode-status stars';
    lhStatus.textContent = '⭐'.repeat(state.todayStars) || '✓';
    lhCard.onclick = () => showTodaySummary();
  } else {
    lhCard.classList.add('ready'); lhCard.classList.remove('done');
    lhStatus.className   = 'mode-status play';
    lhStatus.textContent = 'Play';
    lhCard.onclick = startLetterHunt;
  }

  const swCard   = document.getElementById('sw-card');
  const swStatus = document.getElementById('sw-status');
  if (swCard) {
    if (state.swTodayDone) {
      swCard.classList.remove('ready'); swCard.classList.add('done');
      swStatus.className   = 'mode-status stars';
      swStatus.textContent = '⭐'.repeat(state.swTodayStars) || '✓';
      swCard.onclick = () => showTodaySWSummary();
    } else {
      swCard.classList.add('ready'); swCard.classList.remove('done');
      swStatus.className   = 'mode-status play';
      swStatus.textContent = 'Play';
      swCard.onclick = startSightWordDash;
    }
  }

  const wmCard   = document.getElementById('wm-card');
  const wmStatus = document.getElementById('wm-status');
  if (wmCard) {
    if (state.wmTodayDone) {
      wmCard.classList.remove('ready'); wmCard.classList.add('done');
      wmStatus.className   = 'mode-status stars';
      wmStatus.textContent = '⭐'.repeat(state.wmTodayStars) || '✓';
      wmCard.onclick = () => showTodayWMSummary();
    } else {
      wmCard.classList.add('ready'); wmCard.classList.remove('done');
      wmStatus.className   = 'mode-status play';
      wmStatus.textContent = 'Play';
      wmCard.onclick = startWordMatch;
    }
  }

  const lwCard   = document.getElementById('lw-card');
  const lwStatus = document.getElementById('lw-status');
  if (lwCard) {
    if (state.lwTodayDone) {
      lwCard.classList.remove('ready'); lwCard.classList.add('done');
      lwStatus.className   = 'mode-status stars';
      lwStatus.textContent = '⭐'.repeat(state.lwTodayStars) || '✓';
      lwCard.onclick = () => showTodayLWSummary();
    } else {
      lwCard.classList.add('ready'); lwCard.classList.remove('done');
      lwStatus.className   = 'mode-status play';
      lwStatus.textContent = 'Play';
      lwCard.onclick = startLetterWriter;
    }
  }

  const wwCard   = document.getElementById('ww-card');
  const wwStatus = document.getElementById('ww-status');
  if (wwCard) {
    if (state.wwTodayDone) {
      wwCard.classList.remove('ready'); wwCard.classList.add('done');
      wwStatus.className   = 'mode-status stars';
      wwStatus.textContent = '⭐'.repeat(state.wwTodayStars) || '✓';
      wwCard.onclick = () => showTodayWWSummary();
    } else {
      wwCard.classList.add('ready'); wwCard.classList.remove('done');
      wwStatus.className   = 'mode-status play';
      wwStatus.textContent = 'Play';
      wwCard.onclick = startWordWriter;
    }
  }
}

/* ─── Share ────────────────────────────────────────────────────── */
let summaryMode = 'lh'; // 'lh' | 'sw' | 'wm' | 'lw' | 'ww'

function shareResult() {
  const date   = formatDate(getTodayStr());
  const streak = state.streak;
  const isSW   = (summaryMode === 'sw');
  const isWM   = (summaryMode === 'wm');
  const isLW   = (summaryMode === 'lw');
  const isWW   = (summaryMode === 'ww');
  const stars  = '⭐'.repeat(isWW ? state.wwTodayStars : isLW ? state.lwTodayStars : isWM ? state.wmTodayStars : isSW ? state.swTodayStars : state.todayStars) || '✓';
  const game   = isWW ? 'Word Writer' : isLW ? 'Letter Writer' : isWM ? 'Word Match' : isSW ? 'Sight Word Dash' : 'Letter Hunt';
  const text   = `${stars} ${game} — ${date} — Streak: ${streak} 🔥\nKapework · kapework.com/apps/readysetread/`;

  if (navigator.share) {
    navigator.share({ text }).catch(() => copyToClipboard(text));
  } else {
    copyToClipboard(text);
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Copied to clipboard!');
  }
}

/* ─── Confetti ─────────────────────────────────────────────────── */
const CONFETTI_COLORS = ['#00e5cc','#4ade80','#ffd700','#ff6b35','#e8edf5','#a78bfa'];

function spawnConfetti(count) {
  const container = document.getElementById('confetti');
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.left            = `${10 + Math.random() * 80}%`;
    el.style.top             = `${-10}px`;
    el.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    el.style.width           = `${6 + Math.random() * 8}px`;
    el.style.height          = `${6 + Math.random() * 8}px`;
    el.style.borderRadius    = Math.random() > 0.5 ? '50%' : '2px';
    el.style.animationDelay  = `${Math.random() * 0.4}s`;
    el.style.animationDuration = `${0.9 + Math.random() * 0.6}s`;
    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

/* ─── Toast ────────────────────────────────────────────────────── */
let toastTimer = null;

function showToast(msg, duration = 2000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), duration);
}

/* ─── Gallery ──────────────────────────────────────────────────── */
function openGallery() {
  renderGallery();
  showScreen('gallery');
}

function renderGallery() {
  const grid    = document.getElementById('gallery-grid');
  const countEl = document.getElementById('gallery-count');
  grid.innerHTML = '';

  const earned = CARDS.filter(c => state.earnedCards.includes(c.name));
  countEl.textContent = earned.length === 0 ? '' : `${earned.length} badge${earned.length !== 1 ? 's' : ''}`;

  if (earned.length === 0) {
    grid.innerHTML = `
      <div class="gallery-empty">
        <div class="gallery-empty-icon">🐾</div>
        <div class="gallery-empty-text">Play any game to earn your first animal badge!</div>
      </div>
    `;
    return;
  }

  earned.forEach(card => {
    const el = document.createElement('div');
    el.className = 'gc' + (card.rarity === 'rare' ? ' gc-rare' : '');
    el.innerHTML = `<div class="gc-emoji">${card.emoji}</div><div class="gc-name">${card.name}</div>`;
    el.addEventListener('click', () => onBadgeTap(el, card));
    grid.appendChild(el);
  });
}

function onBadgeTap(el, card) {
  el.classList.remove('bounce');
  void el.offsetWidth;
  el.classList.add('bounce');
  el.addEventListener('animationend', () => el.classList.remove('bounce'), { once: true });
  soundRoundComplete();
  tts.sayWord(card.name);
}

/* ─── Init ─────────────────────────────────────────────────────── */
function init() {
  loadProgress();
  updateHomeUI();
  tts.init();
}
