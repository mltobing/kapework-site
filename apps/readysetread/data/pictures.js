'use strict';

const LW_ROUNDS_PER_SESSION = 6;

// Pictures per letter (Tier 1) — used by Letter Writer mode
const LW_PICTURES = {
  s: [
    { emoji: '🐍', word: 'snake' },
    { emoji: '🧦', word: 'sock' },
    { emoji: '☀️', word: 'sun' },
    { emoji: '⭐', word: 'star' },
    { emoji: '🥣', word: 'soup' },
    { emoji: '✂️', word: 'scissors' },
  ],
  a: [
    { emoji: '🍎', word: 'apple' },
    { emoji: '🐜', word: 'ant' },
    { emoji: '👼', word: 'angel' },
    { emoji: '🐊', word: 'alligator' },
    { emoji: '🚑', word: 'ambulance' },
  ],
  t: [
    { emoji: '🐯', word: 'tiger' },
    { emoji: '🌮', word: 'taco' },
    { emoji: '🎯', word: 'target' },
    { emoji: '🐢', word: 'turtle' },
    { emoji: '🌳', word: 'tree' },
    { emoji: '🦷', word: 'tooth' },
  ],
  p: [
    { emoji: '🐷', word: 'pig' },
    { emoji: '🍕', word: 'pizza' },
    { emoji: '🐧', word: 'penguin' },
    { emoji: '✏️', word: 'pencil' },
    { emoji: '🥞', word: 'pancake' },
    { emoji: '🍑', word: 'peach' },
  ],
  i: [
    { emoji: '🦎', word: 'iguana' },
    { emoji: '🍦', word: 'ice cream' },
    { emoji: '🏝️', word: 'island' },
  ],
  n: [
    { emoji: '👃', word: 'nose' },
    { emoji: '🥜', word: 'nut' },
    { emoji: '📰', word: 'newspaper' },
    { emoji: '🪺', word: 'nest' },
    { emoji: '🌙', word: 'night' },
  ],
};

// Letter placement on OG-style writing lines
// yTop/yBot map to line positions: 0=green top, 0.5=midline, 1.0=red baseline
const LW_LETTER_METRICS = {
  s: { yTop: 0.5, yBot: 1.0 },   // short
  a: { yTop: 0.5, yBot: 1.0 },   // short
  t: { yTop: 0.0, yBot: 1.0 },   // tall
  p: { yTop: 0.5, yBot: 1.35 },  // descender
  i: { yTop: 0.5, yBot: 1.0 },   // short
  n: { yTop: 0.5, yBot: 1.0 },   // short
};
