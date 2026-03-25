/* storage.js — Proof Grid 6×6: localStorage helpers for progress and streak */

"use strict";

var PG36Storage = (function () {

  var PROGRESS_PREFIX = 'pg36_progress_';
  var STREAK_KEY      = 'pg36_streak';

  /* ── Local date string ───────────────────────────────────── */

  function getLocalDateStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* ── Game progress (keyed by date) ──────────────────────── */

  function saveProgress(data) {
    var key = PROGRESS_PREFIX + getLocalDateStr();
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  }

  function loadProgress() {
    var key = PROGRESS_PREFIX + getLocalDateStr();
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (e) { return null; }
  }

  function clearProgress() {
    var key = PROGRESS_PREFIX + getLocalDateStr();
    try { localStorage.removeItem(key); } catch (e) {}
  }

  /* ── Streak tracking ─────────────────────────────────────── */

  function loadStreak() {
    try {
      return JSON.parse(localStorage.getItem(STREAK_KEY) || 'null') || {};
    } catch (e) { return {}; }
  }

  function saveStreak(data) {
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(data)); } catch (e) {}
  }

  /**
   * Record a solve and return the new streak count.
   * Streak increments if yesterday was also solved.
   * Returns current streak if today was already recorded.
   */
  function recordAndGetStreak() {
    var today = getLocalDateStr();
    var data = loadStreak();

    if (data.lastDate === today) return data.count || 1;

    var newCount = 1;
    if (data.lastDate) {
      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      var yd = yesterday.getFullYear() + '-' +
        String(yesterday.getMonth() + 1).padStart(2, '0') + '-' +
        String(yesterday.getDate()).padStart(2, '0');
      if (data.lastDate === yd) newCount = (data.count || 1) + 1;
    }

    saveStreak({ lastDate: today, count: newCount });
    return newCount;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    getLocalDateStr:    getLocalDateStr,
    saveProgress:       saveProgress,
    loadProgress:       loadProgress,
    clearProgress:      clearProgress,
    recordAndGetStreak: recordAndGetStreak
  };

})();
