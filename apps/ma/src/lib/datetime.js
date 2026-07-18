/**
 * src/lib/datetime.js
 *
 * The single source of truth for date/time formatting in the Ma app.
 *
 * The app describes the daily schedule of one person living in the Netherlands,
 * but family members read it from other timezones (currently America/New_York).
 * Amsterdam local time is therefore the *definition* of the data, not a display
 * preference: a 09:30 Amsterdam pickup must read "09:30" for every viewer, and an
 * all-day event stored at Amsterdam midnight must never drift onto the wrong day.
 *
 * Rule for the whole app: never call toLocaleDateString / toLocaleTimeString /
 * getHours / getDate etc. without an explicit `timeZone: TZ`. Route every date or
 * time that reaches the DOM through the helpers below.
 *
 * All parts are derived with Intl (which knows the CET/CEST DST transitions) rather
 * than arithmetic on UTC offsets, so nothing here hardcodes +1/+2.
 */

export const TZ = 'Europe/Amsterdam';

const DUTCH_WEEKDAYS = [
  'zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag',
];

const DUTCH_MONTHS = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

const DUTCH_MONTHS_SHORT = [
  'jan', 'feb', 'mrt', 'apr', 'mei', 'jun',
  'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
];

// Reused formatter — pins every field to the Amsterdam calendar/clock.
const AMS_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year:   'numeric',
  month:  '2-digit',
  day:    '2-digit',
  hour:   '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Coerce an ISO string / Date / timestamp into a Date. */
function toDate(iso) {
  return iso instanceof Date ? iso : new Date(iso);
}

/**
 * Returns the Amsterdam calendar + clock parts for an instant, as zero-padded
 * strings: { year:'2026', month:'07', day:'18', hour:'09', minute:'30' }.
 */
function amsParts(iso) {
  const parts = {};
  for (const p of AMS_PARTS.formatToParts(toDate(iso))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  // Some engines emit '24' for midnight under hour12:false — normalise to '00'.
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

/** Day-of-week index (0 = Sunday) for a YYYY-MM-DD calendar date. */
function weekdayIndex(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ─── Time & date formatting ────────────────────────────────────────────────

/**
 * `HH:MM` in Amsterdam, 24-hour, e.g. "09:30".
 * A 09:30 Amsterdam event reads "09:30" for a New York viewer, never "3:30 AM".
 */
export function formatTime(iso) {
  const p = amsParts(iso);
  return `${p.hour}:${p.minute}`;
}

/**
 * `HH:MM` from a bare wall-clock time string ("HH:MM" or "HH:MM:SS").
 *
 * Unlike formatTime(), this takes a time-of-day with no date and no instant — a
 * value extracted from an e-mail sentence and already normalised to Amsterdam
 * wall-clock by the reconciliation job. A bare time has no timezone, so there is
 * nothing to convert here, only seconds to trim. Returns '' for null/empty.
 */
export function formatClock(hhmmss) {
  if (!hhmmss) return '';
  const [h, m = '00'] = String(hhmmss).split(':');
  return `${pad2(Number(h))}:${pad2(Number(m))}`;
}

/**
 * Dutch weekday + day + month for a YYYY-MM-DD *calendar date*, e.g.
 * "vrijdag 17 juli". Use for anything already keyed to an Amsterdam date
 * (day headers, briefing_date, todayAms()).
 */
export function formatDateKeyHeader(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return `${DUTCH_WEEKDAYS[weekdayIndex(y, m, d)]} ${d} ${DUTCH_MONTHS[m - 1]}`;
}

/** Dutch weekday + day + month in Amsterdam for an instant, e.g. "vrijdag 17 juli". */
export function formatDayHeader(iso) {
  return formatDateKeyHeader(amsDateKey(iso));
}

/** Amsterdam day-of-month number for an instant (for compact date badges). */
export function dayNumberAms(iso) {
  return Number(amsParts(iso).day);
}

/**
 * Minutes since Amsterdam midnight for an instant, e.g. 09:30 → 570.
 *
 * Used by the deterministic today-state engine so it can compare "now" against
 * event/downstairs/window times as plain integers *within a single Amsterdam
 * day*. Because both operands are derived from Amsterdam wall-clock parts (via
 * Intl, which knows CET/CEST), the comparison is DST-safe and identical for a
 * viewer in any device timezone.
 */
export function amsMinutesOfDay(iso) {
  const p = amsParts(iso);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** Short Dutch month for an instant in Amsterdam, e.g. "jul". */
export function monthShortAms(iso) {
  return DUTCH_MONTHS_SHORT[Number(amsParts(iso).month) - 1];
}

// ─── Amsterdam date keys & "today" ──────────────────────────────────────────

/**
 * `YYYY-MM-DD` of the Amsterdam calendar date for an instant.
 * Use for ALL grouping/bucketing so events never land on the wrong day.
 */
export function amsDateKey(iso) {
  const p = amsParts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Today's `YYYY-MM-DD` in Amsterdam — "today" is an Amsterdam concept, not the device's. */
export function todayAms() {
  return amsDateKey(new Date());
}

/** Add `n` days to a `YYYY-MM-DD` key, returning a new `YYYY-MM-DD` key. */
export function addDaysKey(key, n) {
  const [y, m, d] = String(key).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** True if the instant falls on today's Amsterdam date. */
export function isTodayAms(iso) {
  return amsDateKey(iso) === todayAms();
}

/** True if the instant falls on tomorrow's Amsterdam date. */
export function isTomorrowAms(iso) {
  return amsDateKey(iso) === addDaysKey(todayAms(), 1);
}

/**
 * A timestamptz lower bound (UTC ISO) safely at or before Amsterdam's start of
 * today, so a `gte('starts_at', …)` query keeps today's already-started and
 * all-day (Amsterdam-midnight) events instead of dropping them as "past".
 * One day of slack avoids any offset arithmetic; callers bucket by amsDateKey.
 */
export function startOfTodayAmsISO() {
  return `${addDaysKey(todayAms(), -1)}T00:00:00.000Z`;
}

/**
 * True if the instant has already passed (now, as an absolute instant).
 * Instant comparison is timezone-independent, so no TZ is needed here.
 */
export function isPast(iso) {
  return toDate(iso).getTime() < Date.now();
}

// ─── Relative time ──────────────────────────────────────────────────────────

/**
 * Human-friendly relative label: "Just now", "5m ago", "3h ago", "Yesterday",
 * "3 days ago", or an Amsterdam short date ("17 jul") for anything older.
 * The elapsed-time buckets are instant math (timezone-independent); only the
 * absolute-date fallback is pinned to Amsterdam.
 */
export function formatRelative(iso) {
  const diffMs  = Date.now() - toDate(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1)   return 'Just now';
  if (diffMin < 60)  return `${diffMin}m ago`;
  if (diffHr  < 24)  return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay <  7)  return `${diffDay} days ago`;
  return `${dayNumberAms(iso)} ${monthShortAms(iso)}`;
}
