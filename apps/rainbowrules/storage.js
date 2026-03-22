/**
 * storage.js — Rainbow Rules localStorage persistence
 *
 * Namespace: 'rr_'
 *
 * Keys:
 *   rr_state_YYYY-MM-DD   per-day game state (guesses, done, won)
 *   rr_stats              lifetime stats object
 */

'use strict';

window.RRStorage = (function () {
  var NS = 'rr_';

  function key(s) { return NS + s; }

  function load(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }

  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  // ── Date key (local calendar date, so all players share the same daily puzzle) ──
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ── Daily state ────────────────────────────────────────────────────────────
  // Shape: { dateKey, guesses: [{colors, exact, misplaced}], done, won }

  function loadDailyState(dateKey) {
    return load(key('state_' + dateKey));
  }

  function saveDailyState(dateKey, state) {
    save(key('state_' + dateKey), state);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  var DEFAULT_STATS = {
    streak:       0,
    bestStreak:   0,
    lastPlayed:   null,
    totalPlayed:  0,
    totalSolved:  0,
    goldDays:     0,
    silverDays:   0,
    bronzeDays:   0,
    totalGuesses: 0,
  };

  function loadStats() {
    var stored = load(key('stats'));
    if (!stored) return Object.assign({}, DEFAULT_STATS);
    // Merge in any new keys from DEFAULT_STATS to handle upgrades
    return Object.assign({}, DEFAULT_STATS, stored);
  }

  function saveStats(stats) {
    save(key('stats'), stats);
  }

  // ── Record game completion ─────────────────────────────────────────────────
  // medal: 'gold' | 'silver' | 'bronze' | 'fail'
  // guessCount: number of guesses used (even on fail)
  // Returns the updated stats object.
  function recordCompletion(dateKey, medal, guessCount) {
    var stats = loadStats();

    // Deduplicate: don't re-record the same calendar day
    if (stats.lastPlayed === dateKey) return stats;

    // Streak: must have played yesterday to continue
    var yesterday = new Date(dateKey + 'T00:00:00');
    yesterday.setDate(yesterday.getDate() - 1);
    var yKey = yesterday.getFullYear() + '-' +
      String(yesterday.getMonth() + 1).padStart(2, '0') + '-' +
      String(yesterday.getDate()).padStart(2, '0');

    if (medal !== 'fail') {
      stats.streak = (stats.lastPlayed === yKey) ? stats.streak + 1 : 1;
    } else {
      stats.streak = 0;
    }

    if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;

    stats.lastPlayed = dateKey;
    stats.totalPlayed++;

    if (medal !== 'fail') {
      stats.totalSolved++;
      stats.totalGuesses += guessCount;
      if (medal === 'gold')   stats.goldDays++;
      if (medal === 'silver') stats.silverDays++;
      if (medal === 'bronze') stats.bronzeDays++;
    }

    saveStats(stats);
    return stats;
  }

  return {
    todayKey:         todayKey,
    loadDailyState:   loadDailyState,
    saveDailyState:   saveDailyState,
    loadStats:        loadStats,
    recordCompletion: recordCompletion,
  };
})();
