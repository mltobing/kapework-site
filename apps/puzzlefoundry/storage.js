/**
 * storage.js — Puzzle Foundry local persistence (localStorage only, no backend)
 */

const KEYS = {
  LAST_PACK:    'pf_last_pack_v1',
  RECENT_SEEDS: 'pf_recent_seeds_v1',
};

// ── Last pack ──────────────────────────────────────────────────────────────
export function saveLastPack(seeds) {
  try { localStorage.setItem(KEYS.LAST_PACK, JSON.stringify(seeds)); } catch (_) {}
}

export function loadLastPack() {
  try {
    const raw = localStorage.getItem(KEYS.LAST_PACK);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// ── Recent seeds (last 20 played) ─────────────────────────────────────────
export function saveRecentSeed(seed) {
  const recents = loadRecentSeeds();
  const updated = [seed, ...recents.filter(s => s.id !== seed.id)].slice(0, 20);
  try { localStorage.setItem(KEYS.RECENT_SEEDS, JSON.stringify(updated)); } catch (_) {}
}

export function loadRecentSeeds() {
  try {
    const raw = localStorage.getItem(KEYS.RECENT_SEEDS);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}
