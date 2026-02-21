'use strict';

/* ─── Letter Hunt picture data ─────────────────────────────────── */

const TIER1 = {
  s: {
    hint: '🐍 snake',
    items: [
      { word: 'sun',    emoji: '☀️',  correct: true  },
      { word: 'sock',   emoji: '🧦',  correct: true  },
      { word: 'dog',    emoji: '🐕',  correct: false },
      { word: 'moon',   emoji: '🌙',  correct: false },
      { word: 'bird',   emoji: '🐦',  correct: false },
      { word: 'train',  emoji: '🚂',  correct: false },
      { word: 'star',   emoji: '⭐',  correct: true  },
      { word: 'sheep',  emoji: '🐑',  correct: true  },
    ]
  },
  a: {
    hint: '🍎 apple',
    items: [
      { word: 'ant',    emoji: '🐜',  correct: true  },
      { word: 'apple',  emoji: '🍎',  correct: true  },
      { word: 'cat',    emoji: '🐱',  correct: false },
      { word: 'ball',   emoji: '⚽',  correct: false },
      { word: 'fish',   emoji: '🐟',  correct: false },
      { word: 'moon',   emoji: '🌙',  correct: false },
      { word: 'anchor', emoji: '⚓',  correct: true  },
      { word: 'arrow',  emoji: '🏹',  correct: true  },
    ]
  },
  t: {
    hint: '🐯 tiger',
    items: [
      { word: 'tiger',  emoji: '🐯',  correct: true  },
      { word: 'turtle', emoji: '🐢',  correct: true  },
      { word: 'bike',   emoji: '🚲',  correct: false },
      { word: 'cup',    emoji: '☕',  correct: false },
      { word: 'rain',   emoji: '🌧️',  correct: false },
      { word: 'star',   emoji: '⭐',  correct: false },
      { word: 'truck',  emoji: '🚚',  correct: true  },
      { word: 'tree',   emoji: '🌳',  correct: true  },
    ]
  },
  p: {
    hint: '🐧 penguin',
    items: [
      { word: 'pig',    emoji: '🐷',  correct: true  },
      { word: 'pizza',  emoji: '🍕',  correct: true  },
      { word: 'dog',    emoji: '🐕',  correct: false },
      { word: 'tree',   emoji: '🌳',  correct: false },
      { word: 'cup',    emoji: '☕',  correct: false },
      { word: 'fish',   emoji: '🐟',  correct: false },
      { word: 'pear',   emoji: '🍐',  correct: true  },
      { word: 'parrot', emoji: '🦜',  correct: true  },
    ]
  },
  i: {
    hint: '🦋 insect',
    items: [
      { word: 'igloo',  emoji: '🏔️',  correct: true  },
      { word: 'insect', emoji: '🐛',  correct: true  },
      { word: 'dog',    emoji: '🐕',  correct: false },
      { word: 'train',  emoji: '🚂',  correct: false },
      { word: 'moon',   emoji: '🌙',  correct: false },
      { word: 'ball',   emoji: '⚽',  correct: false },
      { word: 'iron',   emoji: '🔧',  correct: true  },
      { word: 'ink',    emoji: '🖊️',  correct: true  },
    ]
  },
  n: {
    hint: '🌙 night',
    items: [
      { word: 'net',    emoji: '🕸️',  correct: true  },
      { word: 'nose',   emoji: '👃',  correct: true  },
      { word: 'dog',    emoji: '🐕',  correct: false },
      { word: 'apple',  emoji: '🍎',  correct: false },
      { word: 'sun',    emoji: '☀️',  correct: false },
      { word: 'ball',   emoji: '⚽',  correct: false },
      { word: 'nest',   emoji: '🪺',  correct: true  },
      { word: 'nut',    emoji: '🥜',  correct: true  },
    ]
  }
};

const TIER2 = {
  m: {
    hint: '🌙 moon',
    items: [
      { word: 'moon',   emoji: '🌙', correct: true  },
      { word: 'milk',   emoji: '🥛', correct: true  },
      { word: 'mouse',  emoji: '🐭', correct: true  },
      { word: 'monkey', emoji: '🐒', correct: true  },
      { word: 'dog',    emoji: '🐕', correct: false },
      { word: 'apple',  emoji: '🍎', correct: false },
      { word: 'sun',    emoji: '☀️', correct: false },
      { word: 'bird',   emoji: '🐦', correct: false },
    ]
  },
  d: {
    hint: '🦆 duck',
    items: [
      { word: 'dog',    emoji: '🐕', correct: true  },
      { word: 'duck',   emoji: '🦆', correct: true  },
      { word: 'drum',   emoji: '🥁', correct: true  },
      { word: 'door',   emoji: '🚪', correct: true  },
      { word: 'cat',    emoji: '🐱', correct: false },
      { word: 'sun',    emoji: '☀️', correct: false },
      { word: 'fish',   emoji: '🐟', correct: false },
      { word: 'moon',   emoji: '🌙', correct: false },
    ]
  },
  g: {
    hint: '🍇 grapes',
    items: [
      { word: 'goat',   emoji: '🐐', correct: true  },
      { word: 'grapes', emoji: '🍇', correct: true  },
      { word: 'gift',   emoji: '🎁', correct: true  },
      { word: 'guitar', emoji: '🎸', correct: true  },
      { word: 'dog',    emoji: '🐕', correct: false },
      { word: 'apple',  emoji: '🍎', correct: false },
      { word: 'fish',   emoji: '🐟', correct: false },
      { word: 'bird',   emoji: '🐦', correct: false },
    ]
  },
  o: {
    hint: '🐙 octopus',
    items: [
      { word: 'octopus',emoji: '🐙', correct: true  },
      { word: 'orange', emoji: '🍊', correct: true  },
      { word: 'otter',  emoji: '🦦', correct: true  },
      { word: 'ox',     emoji: '🐂', correct: true  },
      { word: 'cat',    emoji: '🐱', correct: false },
      { word: 'sun',    emoji: '☀️', correct: false },
      { word: 'fish',   emoji: '🐟', correct: false },
      { word: 'ball',   emoji: '⚽', correct: false },
    ]
  },
  c: {
    hint: '🐄 cow',
    items: [
      { word: 'car',    emoji: '🚗', correct: true  },
      { word: 'cake',   emoji: '🎂', correct: true  },
      { word: 'cow',    emoji: '🐄', correct: true  },
      { word: 'camel',  emoji: '🐪', correct: true  },
      { word: 'dog',    emoji: '🐕', correct: false },
      { word: 'apple',  emoji: '🍎', correct: false },
      { word: 'moon',   emoji: '🌙', correct: false },
      { word: 'fish',   emoji: '🐟', correct: false },
    ]
  },
  k: {
    hint: '🪁 kite',
    items: [
      { word: 'key',    emoji: '🗝️', correct: true  },
      { word: 'king',   emoji: '👑', correct: true  },
      { word: 'koala',  emoji: '🐨', correct: true  },
      { word: 'kite',   emoji: '🪁', correct: true  },
      { word: 'dog',    emoji: '🐕', correct: false },
      { word: 'apple',  emoji: '🍎', correct: false },
      { word: 'sun',    emoji: '☀️', correct: false },
      { word: 'fish',   emoji: '🐟', correct: false },
    ]
  },
  e: {
    hint: '🥚 egg',
    items: [
      { word: 'egg',      emoji: '🥚', correct: true  },
      { word: 'elephant', emoji: '🐘', correct: true  },
      { word: 'envelope', emoji: '✉️', correct: true  },
      { word: 'eagle',    emoji: '🦅', correct: true  },
      { word: 'dog',      emoji: '🐕', correct: false },
      { word: 'sun',      emoji: '☀️', correct: false },
      { word: 'fish',     emoji: '🐟', correct: false },
      { word: 'ball',     emoji: '⚽', correct: false },
    ]
  },
  r: {
    hint: '🌈 rainbow',
    items: [
      { word: 'rabbit',  emoji: '🐰', correct: true  },
      { word: 'rainbow', emoji: '🌈', correct: true  },
      { word: 'rocket',  emoji: '🚀', correct: true  },
      { word: 'ring',    emoji: '💍', correct: true  },
      { word: 'dog',     emoji: '🐕', correct: false },
      { word: 'apple',   emoji: '🍎', correct: false },
      { word: 'sun',     emoji: '☀️', correct: false },
      { word: 'fish',    emoji: '🐟', correct: false },
    ]
  },
  h: {
    hint: '🏠 house',
    items: [
      { word: 'hat',   emoji: '🎩', correct: true  },
      { word: 'horse', emoji: '🐴', correct: true  },
      { word: 'heart', emoji: '❤️', correct: true  },
      { word: 'house', emoji: '🏠', correct: true  },
      { word: 'dog',   emoji: '🐕', correct: false },
      { word: 'apple', emoji: '🍎', correct: false },
      { word: 'sun',   emoji: '☀️', correct: false },
      { word: 'fish',  emoji: '🐟', correct: false },
    ]
  },
  b: {
    hint: '🐻 bear',
    items: [
      { word: 'ball',  emoji: '⚽', correct: true  },
      { word: 'bear',  emoji: '🐻', correct: true  },
      { word: 'bee',   emoji: '🐝', correct: true  },
      { word: 'boat',  emoji: '⛵', correct: true  },
      { word: 'dog',   emoji: '🐕', correct: false },
      { word: 'apple', emoji: '🍎', correct: false },
      { word: 'sun',   emoji: '☀️', correct: false },
      { word: 'fish',  emoji: '🐟', correct: false },
    ]
  },
  u: {
    hint: '☂️ umbrella',
    items: [
      { word: 'umbrella',  emoji: '🌂', correct: true  },
      { word: 'up',        emoji: '⬆️', correct: true  },
      { word: 'underwear', emoji: '🩲', correct: true  },
      { word: 'unicycle',  emoji: '🚲', correct: true  },
      { word: 'dog',       emoji: '🐕', correct: false },
      { word: 'apple',     emoji: '🍎', correct: false },
      { word: 'sun',       emoji: '☀️', correct: false },
      { word: 'fish',      emoji: '🐟', correct: false },
    ]
  },
  l: {
    hint: '🦁 lion',
    items: [
      { word: 'lamp',  emoji: '🪔', correct: true  },
      { word: 'lemon', emoji: '🍋', correct: true  },
      { word: 'leaf',  emoji: '🍃', correct: true  },
      { word: 'lion',  emoji: '🦁', correct: true  },
      { word: 'dog',   emoji: '🐕', correct: false },
      { word: 'apple', emoji: '🍎', correct: false },
      { word: 'sun',   emoji: '☀️', correct: false },
      { word: 'fish',  emoji: '🐟', correct: false },
    ]
  },
  f: {
    hint: '🐸 frog',
    items: [
      { word: 'fish',   emoji: '🐟', correct: true  },
      { word: 'flower', emoji: '🌸', correct: true  },
      { word: 'fire',   emoji: '🔥', correct: true  },
      { word: 'frog',   emoji: '🐸', correct: true  },
      { word: 'dog',    emoji: '🐕', correct: false },
      { word: 'apple',  emoji: '🍎', correct: false },
      { word: 'sun',    emoji: '☀️', correct: false },
      { word: 'bird',   emoji: '🐦', correct: false },
    ]
  },
};

const TIER3 = {
  j: {
    hint: '🪼 jellyfish',
    items: [
      { word: 'jellyfish', emoji: '🪼', correct: true  },
      { word: 'jar',       emoji: '🫙', correct: true  },
      { word: 'juice',     emoji: '🧃', correct: true  },
      { word: 'jet',       emoji: '✈️', correct: true  },
      { word: 'dog',       emoji: '🐕', correct: false },
      { word: 'apple',     emoji: '🍎', correct: false },
      { word: 'sun',       emoji: '☀️', correct: false },
      { word: 'fish',      emoji: '🐟', correct: false },
    ]
  },
  w: {
    hint: '🐋 whale',
    items: [
      { word: 'wolf',       emoji: '🐺', correct: true  },
      { word: 'worm',       emoji: '🪱', correct: true  },
      { word: 'watermelon', emoji: '🍉', correct: true  },
      { word: 'watch',      emoji: '⌚', correct: true  },
      { word: 'dog',        emoji: '🐕', correct: false },
      { word: 'apple',      emoji: '🍎', correct: false },
      { word: 'sun',        emoji: '☀️', correct: false },
      { word: 'fish',       emoji: '🐟', correct: false },
    ]
  },
  v: {
    hint: '🌋 volcano',
    items: [
      { word: 'violin',  emoji: '🎻', correct: true  },
      { word: 'volcano', emoji: '🌋', correct: true  },
      { word: 'van',     emoji: '🚐', correct: true  },
      { word: 'vampire', emoji: '🧛', correct: true  },
      { word: 'dog',     emoji: '🐕', correct: false },
      { word: 'apple',   emoji: '🍎', correct: false },
      { word: 'sun',     emoji: '☀️', correct: false },
      { word: 'fish',    emoji: '🐟', correct: false },
    ]
  },
  y: {
    hint: '🪀 yo-yo',
    items: [
      { word: 'yak',  emoji: '🦬', correct: true  },
      { word: 'yo-yo',emoji: '🪀', correct: true  },
      { word: 'yawn', emoji: '🥱', correct: true  },
      { word: 'yacht',emoji: '⛵', correct: true  },
      { word: 'dog',  emoji: '🐕', correct: false },
      { word: 'apple',emoji: '🍎', correct: false },
      { word: 'sun',  emoji: '☀️', correct: false },
      { word: 'fish', emoji: '🐟', correct: false },
    ]
  },
  z: {
    hint: '🦓 zebra',
    items: [
      { word: 'zebra',    emoji: '🦓', correct: true  },
      { word: 'zero',     emoji: '0️⃣', correct: true  },
      { word: 'zombie',   emoji: '🧟', correct: true  },
      { word: 'zucchini', emoji: '🥒', correct: true  },
      { word: 'dog',      emoji: '🐕', correct: false },
      { word: 'apple',    emoji: '🍎', correct: false },
      { word: 'sun',      emoji: '☀️', correct: false },
      { word: 'fish',     emoji: '🐟', correct: false },
    ]
  },
  q: {
    hint: '👸 queen',
    items: [
      { word: 'queen', emoji: '👸', correct: true  },
      { word: 'quill', emoji: '✍️', correct: true  },
      { word: 'quail', emoji: '🐦', correct: true  },
      { word: 'dog',   emoji: '🐕', correct: false },
      { word: 'apple', emoji: '🍎', correct: false },
      { word: 'sun',   emoji: '☀️', correct: false },
      { word: 'fish',  emoji: '🐟', correct: false },
      { word: 'moon',  emoji: '🌙', correct: false },
    ]
  },
  x: {
    hint: '🦴 x-ray',
    items: [
      { word: 'x-ray',    emoji: '🦴', correct: true  },
      { word: 'xylophone',emoji: '🎵', correct: true  },
      { word: 'dog',      emoji: '🐕', correct: false },
      { word: 'apple',    emoji: '🍎', correct: false },
      { word: 'sun',      emoji: '☀️', correct: false },
      { word: 'fish',     emoji: '🐟', correct: false },
      { word: 'bird',     emoji: '🐦', correct: false },
      { word: 'moon',     emoji: '🌙', correct: false },
    ]
  },
};

const TIER4 = {
  sh: {
    hint: '🐑 sheep',
    items: [
      { word: 'sheep', emoji: '🐑', correct: true  },
      { word: 'ship',  emoji: '🚢', correct: true  },
      { word: 'shell', emoji: '🐚', correct: true  },
      { word: 'shark', emoji: '🦈', correct: true  },
      { word: 'dog',   emoji: '🐕', correct: false },
      { word: 'apple', emoji: '🍎', correct: false },
      { word: 'sun',   emoji: '☀️', correct: false },
      { word: 'fish',  emoji: '🐟', correct: false },
    ]
  },
  ch: {
    hint: '🐔 chicken',
    items: [
      { word: 'cheese',  emoji: '🧀', correct: true  },
      { word: 'cherry',  emoji: '🍒', correct: true  },
      { word: 'chicken', emoji: '🐔', correct: true  },
      { word: 'chair',   emoji: '🪑', correct: true  },
      { word: 'dog',     emoji: '🐕', correct: false },
      { word: 'apple',   emoji: '🍎', correct: false },
      { word: 'sun',     emoji: '☀️', correct: false },
      { word: 'fish',    emoji: '🐟', correct: false },
    ]
  },
  th: {
    hint: '👍 thumb',
    items: [
      { word: 'thumb',        emoji: '👍', correct: true  },
      { word: 'thermometer',  emoji: '🌡️', correct: true  },
      { word: 'thought',      emoji: '💭', correct: true  },
      { word: 'three',        emoji: '3️⃣', correct: true  },
      { word: 'dog',          emoji: '🐕', correct: false },
      { word: 'apple',        emoji: '🍎', correct: false },
      { word: 'sun',          emoji: '☀️', correct: false },
      { word: 'fish',         emoji: '🐟', correct: false },
    ]
  },
  wh: {
    hint: '🐋 whale',
    items: [
      { word: 'whale',  emoji: '🐋', correct: true  },
      { word: 'wheel',  emoji: '🎡', correct: true  },
      { word: 'wheat',  emoji: '🌾', correct: true  },
      { word: 'whistle',emoji: '📯', correct: true  },
      { word: 'dog',    emoji: '🐕', correct: false },
      { word: 'apple',  emoji: '🍎', correct: false },
      { word: 'sun',    emoji: '☀️', correct: false },
      { word: 'fish',   emoji: '🐟', correct: false },
    ]
  },
};

const TIER5 = {
  bl: {
    hint: '🫐 blueberry',
    items: [
      { word: 'blueberry', emoji: '🫐', correct: true  },
      { word: 'blanket',   emoji: '🛏️', correct: true  },
      { word: 'block',     emoji: '🧱', correct: true  },
      { word: 'blade',     emoji: '🔪', correct: true  },
      { word: 'dog',       emoji: '🐕', correct: false },
      { word: 'apple',     emoji: '🍎', correct: false },
      { word: 'sun',       emoji: '☀️', correct: false },
      { word: 'fish',      emoji: '🐟', correct: false },
    ]
  },
  cl: {
    hint: '☁️ cloud',
    items: [
      { word: 'cloud', emoji: '☁️', correct: true  },
      { word: 'clock', emoji: '🕐', correct: true  },
      { word: 'clown', emoji: '🤡', correct: true  },
      { word: 'clap',  emoji: '👏', correct: true  },
      { word: 'dog',   emoji: '🐕', correct: false },
      { word: 'apple', emoji: '🍎', correct: false },
      { word: 'sun',   emoji: '☀️', correct: false },
      { word: 'fish',  emoji: '🐟', correct: false },
    ]
  },
  fl: {
    hint: '🦩 flamingo',
    items: [
      { word: 'flower',   emoji: '🌸', correct: true  },
      { word: 'flag',     emoji: '🚩', correct: true  },
      { word: 'flamingo', emoji: '🦩', correct: true  },
      { word: 'flash',    emoji: '⚡', correct: true  },
      { word: 'dog',      emoji: '🐕', correct: false },
      { word: 'apple',    emoji: '🍎', correct: false },
      { word: 'sun',      emoji: '☀️', correct: false },
      { word: 'fish',     emoji: '🐟', correct: false },
    ]
  },
  br: {
    hint: '🍞 bread',
    items: [
      { word: 'bread',  emoji: '🍞', correct: true  },
      { word: 'broom',  emoji: '🧹', correct: true  },
      { word: 'brain',  emoji: '🧠', correct: true  },
      { word: 'bridge', emoji: '🌉', correct: true  },
      { word: 'dog',    emoji: '🐕', correct: false },
      { word: 'apple',  emoji: '🍎', correct: false },
      { word: 'sun',    emoji: '☀️', correct: false },
      { word: 'fish',   emoji: '🐟', correct: false },
    ]
  },
  cr: {
    hint: '🦀 crab',
    items: [
      { word: 'crab',       emoji: '🦀', correct: true  },
      { word: 'crown',      emoji: '👑', correct: true  },
      { word: 'crayon',     emoji: '🖍️', correct: true  },
      { word: 'crocodile',  emoji: '🐊', correct: true  },
      { word: 'dog',        emoji: '🐕', correct: false },
      { word: 'apple',      emoji: '🍎', correct: false },
      { word: 'sun',        emoji: '☀️', correct: false },
      { word: 'fish',       emoji: '🐟', correct: false },
    ]
  },
  fr: {
    hint: '🐸 frog',
    items: [
      { word: 'frog',        emoji: '🐸', correct: true  },
      { word: 'french fries',emoji: '🍟', correct: true  },
      { word: 'frame',       emoji: '🖼️', correct: true  },
      { word: 'fruit',       emoji: '🍓', correct: true  },
      { word: 'dog',         emoji: '🐕', correct: false },
      { word: 'apple',       emoji: '🍎', correct: false },
      { word: 'sun',         emoji: '☀️', correct: false },
      { word: 'fish',        emoji: '🐟', correct: false },
    ]
  },
  st: {
    hint: '⭐ star',
    items: [
      { word: 'star',       emoji: '⭐', correct: true  },
      { word: 'strawberry', emoji: '🍓', correct: true  },
      { word: 'stone',      emoji: '🪨', correct: true  },
      { word: 'stamp',      emoji: '📮', correct: true  },
      { word: 'dog',        emoji: '🐕', correct: false },
      { word: 'apple',      emoji: '🍎', correct: false },
      { word: 'moon',       emoji: '🌙', correct: false },
      { word: 'fish',       emoji: '🐟', correct: false },
    ]
  },
  sp: {
    hint: '🕷️ spider',
    items: [
      { word: 'spider',    emoji: '🕷️', correct: true  },
      { word: 'spoon',     emoji: '🥄', correct: true  },
      { word: 'spaceship', emoji: '🚀', correct: true  },
      { word: 'spaghetti', emoji: '🍝', correct: true  },
      { word: 'dog',       emoji: '🐕', correct: false },
      { word: 'apple',     emoji: '🍎', correct: false },
      { word: 'sun',       emoji: '☀️', correct: false },
      { word: 'fish',      emoji: '🐟', correct: false },
    ]
  },
  tr: {
    hint: '🌳 tree',
    items: [
      { word: 'truck',   emoji: '🚚', correct: true  },
      { word: 'tree',    emoji: '🌳', correct: true  },
      { word: 'train',   emoji: '🚂', correct: true  },
      { word: 'trophy',  emoji: '🏆', correct: true  },
      { word: 'dog',     emoji: '🐕', correct: false },
      { word: 'apple',   emoji: '🍎', correct: false },
      { word: 'sun',     emoji: '☀️', correct: false },
      { word: 'fish',    emoji: '🐟', correct: false },
    ]
  },
  dr: {
    hint: '🥁 drum',
    items: [
      { word: 'drum',       emoji: '🥁', correct: true  },
      { word: 'dragon',     emoji: '🐉', correct: true  },
      { word: 'dress',      emoji: '👗', correct: true  },
      { word: 'dragonfly',  emoji: '🪲', correct: true  },
      { word: 'dog',        emoji: '🐕', correct: false },
      { word: 'apple',      emoji: '🍎', correct: false },
      { word: 'sun',        emoji: '☀️', correct: false },
      { word: 'fish',       emoji: '🐟', correct: false },
    ]
  },
  gr: {
    hint: '🍇 grapes',
    items: [
      { word: 'grapes',    emoji: '🍇', correct: true  },
      { word: 'grass',     emoji: '🌿', correct: true  },
      { word: 'grandma',   emoji: '👵', correct: true  },
      { word: 'grapefruit',emoji: '🍊', correct: true  },
      { word: 'dog',       emoji: '🐕', correct: false },
      { word: 'apple',     emoji: '🍎', correct: false },
      { word: 'sun',       emoji: '☀️', correct: false },
      { word: 'fish',      emoji: '🐟', correct: false },
    ]
  },
  pl: {
    hint: '✈️ plane',
    items: [
      { word: 'plane', emoji: '✈️', correct: true  },
      { word: 'plant', emoji: '🌱', correct: true  },
      { word: 'plate', emoji: '🍽️', correct: true  },
      { word: 'plum',  emoji: '🫐', correct: true  },
      { word: 'dog',   emoji: '🐕', correct: false },
      { word: 'apple', emoji: '🍎', correct: false },
      { word: 'sun',   emoji: '☀️', correct: false },
      { word: 'fish',  emoji: '🐟', correct: false },
    ]
  },
};

// All tiers merged — session builder draws from this flat pool
const ALL_LETTERS = { ...TIER1, ...TIER2, ...TIER3, ...TIER4, ...TIER5 };

// Collectible cards pool
const CARDS = [
  { emoji: '🦁', name: 'Lion',      rarity: 'standard' },
  { emoji: '🐘', name: 'Elephant',  rarity: 'standard' },
  { emoji: '🦊', name: 'Fox',       rarity: 'standard' },
  { emoji: '🐬', name: 'Dolphin',   rarity: 'standard' },
  { emoji: '🦒', name: 'Giraffe',   rarity: 'standard' },
  { emoji: '🐧', name: 'Penguin',   rarity: 'standard' },
  { emoji: '🦜', name: 'Parrot',    rarity: 'standard' },
  { emoji: '🐯', name: 'Tiger',     rarity: 'standard' },
  { emoji: '🦋', name: 'Butterfly', rarity: 'standard' },
  { emoji: '🐺', name: 'Wolf',      rarity: 'standard' },
  { emoji: '🦅', name: 'Eagle',     rarity: 'rare'     },
  { emoji: '🦄', name: 'Unicorn',   rarity: 'rare'     },
  { emoji: '🐉', name: 'Dragon',    rarity: 'rare'     },
  { emoji: '🦚', name: 'Peacock',   rarity: 'rare'     },
];
