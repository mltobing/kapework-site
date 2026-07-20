/**
 * lib/beheer-health.js
 *
 * Pure health-state rules for the Beheer "Systeemstatus" cards — kept
 * separate from views/beheer.js (which only formats these results into DOM)
 * so the Amsterdam-boundary rules are unit-testable without a browser.
 *
 * Every function takes `now` explicitly (defaulting to `new Date()`) so tests
 * can pin an exact instant instead of relying on the real clock.
 */

import { amsMinutesOfDay } from './datetime.js';

const HOUR_MS = 3600_000;

/**
 * Agenda & synchronisatie card.
 * @param {{ calendar_status?: string, status?: string, finished_at?: string|null }|null} run — latest ma_integration_runs row
 * @param {{ last_synced_at?: string }|null} source — fetchCalendarSourceAdminStatus()
 * @param {Date} [now]
 * @returns {{ level: 'neutral'|'green'|'amber'|'red', reason: string }}
 */
export function computeAgendaHealth(run, source, now = new Date()) {
  const lastSyncedAt = source?.last_synced_at ?? null;
  const runFailed = run?.calendar_status === 'failed';
  const isRunning = run?.status === 'running' && !run?.finished_at;
  const ageMs = lastSyncedAt ? now.getTime() - new Date(lastSyncedAt).getTime() : null;

  // A run in progress (scheduled or manual) is the most relevant thing to show
  // right now, regardless of how stale the last successful sync looks —
  // that's exactly the situation a running sync is about to resolve.
  if (isRunning) return { level: 'neutral', reason: 'running' };
  if (!run && !lastSyncedAt) return { level: 'neutral', reason: 'no_data' };
  // Source says recently synced, but the latest run reports failure — the two
  // disagree, so say so rather than guess which one is right.
  if (runFailed && ageMs !== null && ageMs <= 6 * HOUR_MS) return { level: 'amber', reason: 'disagreement' };
  if (runFailed) return { level: 'red', reason: 'run_failed' };
  if (ageMs === null) return { level: 'neutral', reason: 'no_data' };
  if (ageMs <= 6 * HOUR_MS)  return { level: 'green', reason: 'fresh' };
  if (ageMs <= 12 * HOUR_MS) return { level: 'amber', reason: 'stale' };
  return { level: 'red', reason: 'very_stale' };
}

/**
 * Briefings card, evaluated against tomorrow's ma_briefings row (or null).
 * @param {{ status?: string }|null} briefing
 * @param {Date} [now]
 * @returns {{ level: 'neutral'|'green'|'amber'|'red', reason: string }}
 */
export function computeBriefingHealth(briefing, now = new Date()) {
  const nowMinutes = amsMinutesOfDay(now);

  if (!briefing) {
    return nowMinutes >= 17 * 60
      ? { level: 'amber', reason: 'missing_after_17' }
      : { level: 'neutral', reason: 'not_yet_due' };
  }
  if (briefing.status === 'changed_after_sent') return { level: 'red', reason: 'changed_after_sent' };
  if (briefing.status === 'sent') return { level: 'green', reason: 'sent' };
  // 'ready'
  return nowMinutes >= 18 * 60
    ? { level: 'amber', reason: 'ready_not_sent_after_18' }
    : { level: 'neutral', reason: 'ready_earlier' };
}

/**
 * AutoMaatje / ride-mail card.
 * @param {{ notices_status?: string }|null} run
 * @param {{ openCount: number }} summary
 * @returns {{ level: 'neutral'|'green'|'amber'|'red', reason: string }}
 */
export function computeNoticesHealth(run, summary) {
  const status = run?.notices_status ?? null;
  const openCount = summary?.openCount ?? 0;

  if (status === 'disabled') return { level: 'neutral', reason: 'disabled' };
  if (status === 'failed')   return { level: 'red', reason: 'check_failed' };
  if (status === 'misconfigured') return { level: 'red', reason: 'misconfigured' };
  if (status === 'success') {
    return openCount > 0 ? { level: 'amber', reason: 'open_discrepancies' } : { level: 'green', reason: 'clean' };
  }
  return { level: 'neutral', reason: 'no_data' };
}
