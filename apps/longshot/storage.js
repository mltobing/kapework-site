/**
 * storage.js — Longshot v2 localStorage persistence
 *
 * Keys (all namespaced under 'ls2_'):
 *   ls2_state_YYYY-MM-DD   per-day game state JSON
 *   ls2_streak             current streak count
 *   ls2_last_played        last played date string YYYY-MM-DD
 */

'use strict';

var NAMESPACE = 'ls2_';

function key(suffix) { return NAMESPACE + suffix; }

function load(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
}

function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
}

// ── Date helpers ──────────────────────────────────────────────────────────────
// Date key uses local time so players share the same puzzle for their calendar day.
function todayKey() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// ── Daily state ───────────────────────────────────────────────────────────────
// State shape:
// {
//   dateKey: 'YYYY-MM-DD',
//   boardId: number,
//   shots: ['word1', 'word2', 'word3'],   // valid submitted words
//   done: boolean,
//   medal: 'bronze'|'silver'|'gold'|'none'|null
// }

function loadDailyState(dateKey) {
  return load(key('state_' + dateKey));
}

function saveDailyState(dateKey, state) {
  save(key('state_' + dateKey), state);
}

// ── Streak ────────────────────────────────────────────────────────────────────
function loadStreak() {
  return load(key('streak')) || 0;
}

function loadLastPlayed() {
  return load(key('last_played')) || null;
}

function saveStreak(n) {
  save(key('streak'), n);
}

function saveLastPlayed(dateKey) {
  save(key('last_played'), dateKey);
}

// ── Update streak on game completion ─────────────────────────────────────────
// Returns the new streak value.
function recordCompletion(dateKey) {
  var last   = loadLastPlayed();
  var streak = loadStreak();

  if (last === dateKey) return streak; // already recorded today

  var yesterday = new Date(dateKey);
  yesterday.setDate(yesterday.getDate() - 1);
  var yKey = yesterday.getFullYear() + '-' +
    String(yesterday.getMonth() + 1).padStart(2, '0') + '-' +
    String(yesterday.getDate()).padStart(2, '0');

  streak = (last === yKey) ? streak + 1 : 1;
  saveStreak(streak);
  saveLastPlayed(dateKey);
  return streak;
}

window.LongshotStorage = {
  todayKey:       todayKey,
  loadDailyState: loadDailyState,
  saveDailyState: saveDailyState,
  loadStreak:     loadStreak,
  recordCompletion: recordCompletion,
};
