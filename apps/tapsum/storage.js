import { STORAGE, SLUG } from './constants.js';

export function getDeviceId() {
  let id = localStorage.getItem(STORAGE.DEVICE_ID);
  if (!id) {
    id = crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
    localStorage.setItem(STORAGE.DEVICE_ID, id);
  }
  return id;
}

export function getBestScore() {
  return parseInt(localStorage.getItem(STORAGE.BEST_SCORE) ?? '0', 10);
}

export function saveBestScore(score) {
  localStorage.setItem(STORAGE.BEST_SCORE, String(score));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function getTodayBest() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE.TODAY) ?? '{}');
    return data.date === todayStr() ? (data.best ?? 0) : 0;
  } catch {
    return 0;
  }
}

export function saveTodayBest(score) {
  if (score > getTodayBest()) {
    localStorage.setItem(STORAGE.TODAY, JSON.stringify({ date: todayStr(), best: score }));
  }
}

/** Non-critical — silently swallows all errors. */
export async function pushToCloud(bestScore) {
  try {
    const cfg = window.KapeworkConfig ?? {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    await sb.from('scores').upsert(
      { slug: SLUG, device_id: getDeviceId(), best_score: bestScore },
      { onConflict: 'slug,device_id' }
    );
  } catch { /* non-critical */ }
}
