/**
 * src/lib/today-state.js
 *
 * The deterministic "what is happening today" engine, shared by the signed-in
 * Today tab and the trusted /vandaag display.
 *
 * It is a PURE function: give it sanitized events, an absolute "now", and calendar
 * freshness, and it returns structured state — never HTML, never a Date.now() call
 * of its own. That is what makes it testable across timezones and DST boundaries.
 *
 * Guarantees (see the brief):
 *   - No LLM, no guessing. Every time shown is a real source time.
 *   - A downstairs/dressing time is NEVER manufactured from an appointment time;
 *     it only appears when explicitly written on the event.
 *   - A contact window stays a window; its start is never turned into an arrival.
 *   - Cancelled events are ignored. All-day events are listed but create no go-now.
 *   - When the calendar is stale beyond a safe threshold, actionable "go now"
 *     instructions are suppressed and a calm notice is shown instead.
 *   - Every comparison is in Europe/Amsterdam (via the shared datetime helpers),
 *     so the result is identical for a viewer in any device timezone.
 */

import { amsDateKey, amsMinutesOfDay, formatTime, formatClock } from './datetime.js';

/**
 * Staleness threshold. The mirror syncs roughly every 3 hours, so we only warn
 * once data is twice that old — a single missed sync must not cry wolf at a
 * 91-year-old. Documented and overridable via input.staleThresholdMs.
 */
export const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

const COPY = {
  empty:          'Vandaag geen afspraken.',
  emptyAllDay:    'Vandaag geen afspraken op een tijd.',
  downstairsWait: 'U hoeft nog niet naar beneden.',
  downstairsGo:   'U kunt nu naar beneden.',
  after:          'Uw afspraken voor vandaag zijn afgelopen.',
  stale:          'De informatie is misschien niet actueel.',
};

const MINUTES_IN_DAY = 24 * 60;

function toMs(instant) {
  if (instant instanceof Date) return instant.getTime();
  if (typeof instant === 'number') return instant;
  return new Date(instant).getTime();
}

function clockToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':');
  const min = Number(h) * 60 + Number(m || 0);
  return Number.isFinite(min) ? min : null;
}

/**
 * Build the today schedule (buckets + per-event phase flags) for an Amsterdam
 * date. Timed events are sorted; each carries `past` and `current` relative to
 * `nowMin`. Cancelled events are dropped. Cross-midnight ends are clamped to the
 * end of today so a phase never leaks into tomorrow.
 */
function buildSchedule(events, dateKey, nowMin) {
  const allDay = [];
  const timedRaw = [];

  for (const ev of events || []) {
    if (!ev || !ev.startsAt) continue;
    if (String(ev.status || '').toLowerCase() === 'cancelled') continue;
    if (amsDateKey(ev.startsAt) !== dateKey) continue;
    if (ev.allDay) { allDay.push(ev); continue; }
    timedRaw.push(ev);
  }

  timedRaw.sort((a, b) => amsMinutesOfDay(a.startsAt) - amsMinutesOfDay(b.startsAt));

  const timed = timedRaw.map((ev, i) => {
    const startMin = amsMinutesOfDay(ev.startsAt);
    const hasEnd =
      ev.endsAt != null &&
      (amsDateKey(ev.endsAt) > dateKey || amsMinutesOfDay(ev.endsAt) > startMin);
    // Effective end drives phase detection only (never displayed): a timed event
    // with no end is "current" until the next one starts, or until end of day.
    const rawEndMin = hasEnd
      ? (amsDateKey(ev.endsAt) > dateKey ? MINUTES_IN_DAY : amsMinutesOfDay(ev.endsAt))
      : null;
    const nextStart = timedRaw[i + 1] ? amsMinutesOfDay(timedRaw[i + 1].startsAt) : MINUTES_IN_DAY;
    const effectiveEnd = rawEndMin != null ? rawEndMin : nextStart;
    return {
      ...ev,
      _startMin: startMin,
      _effectiveEnd: effectiveEnd,
      _hasEnd: hasEnd,
      current: startMin <= nowMin && nowMin < effectiveEnd,
      past: nowMin >= effectiveEnd,
    };
  });

  return { allDay, timed };
}

/**
 * Derive the single "Nu" card state from the schedule.
 * Returns { kind, headline, detail }.
 */
function deriveNu(schedule, nowMin) {
  const { allDay, timed } = schedule;

  if (timed.length === 0) {
    return allDay.length > 0
      ? { kind: 'empty_allday', headline: COPY.emptyAllDay, detail: null }
      : { kind: 'empty',        headline: COPY.empty,       detail: null };
  }

  const current = timed.find(ev => ev.current);
  if (current) {
    return {
      kind: 'during',
      headline: `Nu: ${current.title || 'afspraak'}`,
      detail: current._hasEnd ? `Tot ${formatTime(current.endsAt)}.` : null,
    };
  }

  const next = timed.find(ev => ev._startMin > nowMin);
  if (!next) {
    return { kind: 'after', headline: COPY.after, detail: null };
  }

  const startLabel = formatTime(next.startsAt);
  const downMin = clockToMinutes(next.downstairsAt);

  if (downMin != null) {
    if (nowMin < downMin) {
      return {
        kind: 'downstairs_wait',
        headline: COPY.downstairsWait,
        detail: `U kunt om ${formatClock(next.downstairsAt)} naar beneden. De afspraak is om ${startLabel}.`,
      };
    }
    return {
      kind: 'downstairs_go',
      headline: COPY.downstairsGo,
      detail: `De afspraak is om ${startLabel}.`,
    };
  }

  const detail = next.contactWindow
    ? `Contact tussen ${formatClock(next.contactWindow.start)} en ${formatClock(next.contactWindow.end)}.`
    : null;
  return { kind: 'before', headline: `De volgende afspraak is om ${startLabel}.`, detail };
}

/**
 * Compute today's state.
 *
 * @param {object}   input
 * @param {Array}    input.events                 Sanitized events (see event-derive.js)
 * @param {number|Date|string} input.now          Absolute "now"
 * @param {string|null} [input.calendarLastSyncedAt]  ISO of last mirror sync
 * @param {number}   [input.staleThresholdMs]     Override staleness threshold
 * @returns {{ dateKey, stale, staleNotice, nu, schedule, isEmpty }}
 */
export function computeTodayState({ events, now, calendarLastSyncedAt = null, staleThresholdMs = STALE_THRESHOLD_MS } = {}) {
  const nowMs   = toMs(now);
  const dateKey = amsDateKey(nowMs);
  const nowMin  = amsMinutesOfDay(nowMs);

  const schedule = buildSchedule(events, dateKey, nowMin);
  let nu = deriveNu(schedule, nowMin);

  // Freshness: unknown last-sync is treated as stale (be cautious), and any data
  // older than the threshold is stale.
  const stale =
    calendarLastSyncedAt == null ||
    (nowMs - toMs(calendarLastSyncedAt)) > staleThresholdMs;

  // Stale data must not drive someone downstairs. Downgrade the only actionable
  // "go now" cue to a plain, non-actionable statement of the source time.
  if (stale && nu.kind === 'downstairs_go') {
    const next = schedule.timed.find(ev => !ev.past && !ev.current);
    nu = {
      kind: 'before',
      headline: next ? `De volgende afspraak is om ${formatTime(next.startsAt)}.` : COPY.after,
      detail: null,
    };
  }

  return {
    dateKey,
    stale,
    staleNotice: stale ? COPY.stale : null,
    nu,
    schedule: { allDay: schedule.allDay, timed: schedule.timed },
    isEmpty: schedule.allDay.length === 0 && schedule.timed.length === 0,
  };
}
