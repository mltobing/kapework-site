/**
 * rules.js — Rainbow Rules daily rule definitions
 *
 * Each rule has:
 *   id          — machine key
 *   label       — player-facing short name
 *   description — one sentence shown on the Rule Card
 *   validate(code) → boolean  — does this code satisfy the rule?
 *   generate(randFn) → string[] — produce a satisfying code using the seeded PRNG
 *
 * Quality constraint: generated codes must have ≥ 3 distinct colors.
 *
 * Rules (v1):
 *   all_different    — all 4 slots show different colors
 *   one_repeat       — exactly one color appears twice; the other two slots are unique
 *   no_adjacent      — no two neighboring slots share a color
 *   first_last_match — the first and last slot match
 */

'use strict';

window.RRRules = (function () {

  var COLOR_IDS = ['R', 'O', 'Y', 'G', 'B', 'P'];

  // ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────
  function makePRNG(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rand, n) { return Math.floor(rand() * n); }

  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(rand, i + 1);
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ── Quality guard ─────────────────────────────────────────────────────────
  function isQuality(code) {
    var seen = {};
    for (var i = 0; i < code.length; i++) seen[code[i]] = true;
    return Object.keys(seen).length >= 3;
  }

  // ── Validators ────────────────────────────────────────────────────────────

  function validateAllDifferent(code) {
    var seen = {};
    for (var i = 0; i < code.length; i++) {
      if (seen[code[i]]) return false;
      seen[code[i]] = true;
    }
    return true;
  }

  // Exactly one color appears exactly twice; all others appear exactly once.
  function validateOneRepeat(code) {
    var counts = {};
    for (var i = 0; i < code.length; i++) {
      counts[code[i]] = (counts[code[i]] || 0) + 1;
    }
    var twos = 0, bad = 0;
    var keys = Object.keys(counts);
    for (var j = 0; j < keys.length; j++) {
      var n = counts[keys[j]];
      if (n === 2) twos++;
      else if (n !== 1) bad++;
    }
    return twos === 1 && bad === 0;
  }

  function validateNoAdjacent(code) {
    for (var i = 0; i < code.length - 1; i++) {
      if (code[i] === code[i + 1]) return false;
    }
    return true;
  }

  function validateFirstLastMatch(code) {
    return code.length >= 2 && code[0] === code[code.length - 1];
  }

  // ── Generators ────────────────────────────────────────────────────────────

  function generateAllDifferent(rand) {
    // Pick any 4 of 6 colors in random order
    return shuffle(COLOR_IDS, rand).slice(0, 4);
  }

  function generateOneRepeat(rand) {
    // Choose 3 distinct colors, duplicate one, shuffle → 4-slot code
    var pool     = shuffle(COLOR_IDS, rand).slice(0, 3);
    var repeated = pool[randInt(rand, 3)];
    var code     = pool.concat([repeated]);
    return shuffle(code, rand);
  }

  function generateNoAdjacent(rand) {
    // Rejection sampling — succeeds quickly for 6 colors over 4 slots
    for (var attempt = 0; attempt < 300; attempt++) {
      var code = [];
      for (var i = 0; i < 4; i++) {
        code.push(COLOR_IDS[randInt(rand, COLOR_IDS.length)]);
      }
      if (validateNoAdjacent(code) && isQuality(code)) return code;
    }
    // Deterministic fallback (always valid)
    return ['R', 'O', 'R', 'G'];
  }

  function generateFirstLastMatch(rand) {
    // Anchor = first & last color; fill middle 2 slots freely
    for (var attempt = 0; attempt < 300; attempt++) {
      var anchor = COLOR_IDS[randInt(rand, COLOR_IDS.length)];
      var mid    = [];
      for (var i = 0; i < 2; i++) {
        mid.push(COLOR_IDS[randInt(rand, COLOR_IDS.length)]);
      }
      var code = [anchor].concat(mid).concat([anchor]);
      if (isQuality(code)) return code;
    }
    return ['R', 'O', 'G', 'R'];
  }

  // ── Rule set ──────────────────────────────────────────────────────────────

  var RULES = [
    {
      id:          'all_different',
      label:       'All different',
      description: 'Every slot in the hidden code shows a different color.',
      validate:    validateAllDifferent,
      generate:    generateAllDifferent,
    },
    {
      id:          'one_repeat',
      label:       'Exactly one repeat',
      description: 'One color appears exactly twice. The other two slots are unique colors.',
      validate:    validateOneRepeat,
      generate:    generateOneRepeat,
    },
    {
      id:          'no_adjacent',
      label:       'No adjacent match',
      description: 'No two neighboring slots share the same color.',
      validate:    validateNoAdjacent,
      generate:    generateNoAdjacent,
    },
    {
      id:          'first_last_match',
      label:       'First and last match',
      description: 'The first and last slots show the same color.',
      validate:    validateFirstLastMatch,
      generate:    generateFirstLastMatch,
    },
  ];

  function byId(id) {
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].id === id) return RULES[i];
    }
    return null;
  }

  return {
    RULES:    RULES,
    byId:     byId,
    makePRNG: makePRNG,
  };
})();
