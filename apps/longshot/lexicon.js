/**
 * lexicon.js — Longshot v2 runtime word-list loader
 *
 * Loads common-words.txt once and exposes a Set for O(1) lookups.
 * Used by game.js to validate submitted words against the common-word lexicon.
 */

'use strict';

var _lexiconSet = null;

async function loadLexicon() {
  if (_lexiconSet) return _lexiconSet;

  var resp = await fetch('/apps/longshot/data/common-words.txt');
  if (!resp.ok) throw new Error('Failed to load word list: ' + resp.status);

  var text = await resp.text();
  var set  = new Set();
  for (var line of text.split('\n')) {
    var w = line.trim().toLowerCase();
    if (w.length >= 5 && /^[a-z]+$/.test(w)) set.add(w);
  }
  _lexiconSet = set;
  return set;
}

function hasWord(word) {
  return _lexiconSet ? _lexiconSet.has(word) : false;
}

window.LongshotLexicon = { loadLexicon: loadLexicon, hasWord: hasWord };
