/**
 * board-bank.js — Longshot v2 board bank loader
 *
 * Loads board-bank.json and returns the board for a given local date.
 * Board selection is deterministic: same date → same board for all players.
 *
 * Each board entry (from board-bank.json):
 * {
 *   id:       number,
 *   grid:     string[16],           // flat 4×4 letter array
 *   allowed:  string[],             // all traceable 5+ letter words (sorted)
 *   featured: string,               // longest (Longshot) word
 *   topWords: string[],             // top 10 by length
 *   medals:   { bronze, silver, gold },  // required lengths
 *   maxLen:   number
 * }
 */

'use strict';

var _bank = null;

// Epoch for day-index calculation (local calendar date).
// Day 0 = 2025-01-01 local time.
var EPOCH_MS = new Date(2025, 0, 1).getTime(); // Jan 1 2025 00:00 local

function localDayIndex() {
  var msPerDay = 86400 * 1000;
  var now = new Date();
  // Use local midnight for the current date
  var localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.floor((localMidnight - EPOCH_MS) / msPerDay);
}

function selectBoard(bank, dateKey) {
  if (!bank || bank.length === 0) return null;
  // Use the date key directly for determinism: hash the date string
  var hash = 0;
  for (var i = 0; i < dateKey.length; i++) {
    hash = ((hash << 5) - hash) + dateKey.charCodeAt(i);
    hash |= 0;
  }
  var idx = Math.abs(hash) % bank.length;
  var board = bank[idx];
  // Attach a human-friendly puzzle number (1-indexed day since epoch)
  board.puzzleNumber = localDayIndex() + 1;
  return board;
}

async function loadBoard(dateKey) {
  if (!_bank) {
    var resp = await fetch('/apps/longshot/data/board-bank.json');
    if (!resp.ok) throw new Error('Failed to load board bank: ' + resp.status);
    _bank = await resp.json();
  }
  return selectBoard(_bank, dateKey);
}

window.LongshotBoardBank = { loadBoard: loadBoard };
