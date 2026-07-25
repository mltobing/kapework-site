/**
 * src/lib/calendar-events.js
 *
 * The single definition of what makes a mirrored calendar event *active*, plus
 * the query composition that enforces it at the database.
 *
 * Why this exists: iCloud is the source of truth, and the private irma-sync job
 * mirrors it into ma_calendar_events. When an event disappears from the pinned
 * iCloud calendar the mirror does NOT delete the row — it soft-cancels it
 * (status = 'cancelled') so the reconciliation/audit trail survives. That is a
 * deliberate design decision on the private side and stays as it is.
 *
 * The consequence is that every *active* read in this app has to filter on
 * status itself. Before this module existed, fetchEvents() selected `status`
 * but never filtered on it, so an event deleted in iCloud kept appearing in
 * Today and Agenda indefinitely.
 *
 * Fail-closed rule: only the literal string 'confirmed' is active. A row with a
 * missing, unknown, or future status (say 'tentative', or something a later
 * migration introduces) is NOT rendered. The opposite formulation —
 * "everything except cancelled" — would silently surface any new status the day
 * it is introduced, which is exactly the failure mode this module exists to
 * prevent.
 *
 * Cancelled rows are still readable on purpose: diagnostics, admin views, and
 * notice matching may legitimately need to know a row was cancelled. This
 * module governs the *active* reads only; it never deletes anything and never
 * changes an unrelated historical query.
 *
 * The day-bucketing helpers at the bottom live here rather than in the views
 * for one practical reason: views/today.js and views/calendar.js both import
 * api.js, which imports the browser Supabase client over a network URL, so
 * nothing in them can be imported by a Node test. Keeping the selection logic
 * pure here means "Today never renders a cancelled event" is a real assertion
 * about real code, not a regex over a source file.
 */

import { amsDateKey, addDaysKey } from './datetime.js';

// The one status an ordinary "what's coming up" screen ever renders.
export const ACTIVE_CALENDAR_STATUS = 'confirmed';

// Scalar columns only, no embedded relationships — same discipline as
// LOGBOEK_CORE_COLUMNS in api.js. `status` stays in the select even though the
// query now filters on it: callers and diagnostics still read it, and dropping
// it would make a wrong row harder to spot, not less likely.
export const CALENDAR_EVENT_COLUMNS =
  'id, external_event_uid, title, starts_at, ends_at, all_day, location, notes, external_url, status';

/**
 * True only for a row this app should render on an active screen.
 * @param {{ status?: string }|null|undefined} event
 */
export function isActiveCalendarEvent(event) {
  return Boolean(event) && event.status === ACTIVE_CALENDAR_STATUS;
}

/**
 * The active subset of `events`, in their original order. Order is preserved
 * because callers rely on the `starts_at` ascending order the query applied —
 * filtering must never reshuffle a day.
 *
 * @param {Array|null|undefined} events
 * @returns {Array}
 */
export function activeCalendarEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter(isActiveCalendarEvent);
}

/**
 * Map external_event_uid → event, built from active events only.
 *
 * Used for notice matching (a ride notice is compared against the event the
 * calendar currently holds). A cancelled row must never satisfy a notice: if
 * the event was deleted from iCloud, the notice's discrepancy is real and has
 * to stay visible.
 *
 * @param {Array|null|undefined} events
 * @returns {Map<string, object>}
 */
export function activeEventsByUid(events) {
  const map = new Map();
  for (const event of activeCalendarEvents(events)) {
    if (event.external_event_uid) map.set(event.external_event_uid, event);
  }
  return map;
}

/**
 * Compose the active-events query on an already-selected PostgREST table
 * builder.
 *
 * Dependency-injected rather than reaching for `supabase` directly so the
 * query *contract* — specifically that the confirmed-status filter is present
 * and that the existing date bounds/ordering/pagination are unchanged — is
 * testable without importing the browser Supabase client. api.js passes the
 * real `supabase.from('ma_calendar_events')`.
 *
 * The status filter sits with the family filter, before the date range and
 * ordering, so the shape reads the way the row is scoped: family, then
 * liveness, then window.
 *
 * @param {object} table         result of supabase.from('ma_calendar_events')
 * @param {object} opts
 * @param {string} opts.familyId
 * @param {string} opts.from     inclusive ISO lower bound on starts_at
 * @param {string} [opts.to]     exclusive ISO upper bound on starts_at
 * @param {number} opts.limit
 * @param {number} opts.offset
 */
export function buildActiveEventsQuery(table, { familyId, from, to, limit, offset }) {
  let query = table
    .select(CALENDAR_EVENT_COLUMNS)
    .eq('family_id', familyId)
    .eq('status', ACTIVE_CALENDAR_STATUS)
    .gte('starts_at', from);
  if (to) query = query.lt('starts_at', to);
  return query
    .order('starts_at', { ascending: true })
    .range(offset, offset + limit - 1);
}

// ─── Day/horizon selection (pure — see module comment) ───────────────────────

/**
 * The active events falling on one Amsterdam calendar day, in input order.
 * Backs the Today view's "Vandaag" list.
 *
 * @param {Array|null|undefined} events
 * @param {string} dayKey  "YYYY-MM-DD" in Amsterdam
 */
export function activeEventsOnDay(events, dayKey) {
  return activeCalendarEvents(events).filter(e => amsDateKey(e.starts_at) === dayKey);
}

/**
 * Bucket active events into the Agenda view's three horizons, relative to
 * `todayKey`. Boundaries follow the Amsterdam calendar day, so an event never
 * lands in the wrong bucket because the viewer is in a different timezone —
 * "YYYY-MM-DD" keys compare chronologically as plain strings.
 *
 * Labels stay in the view; this returns only the buckets.
 *
 * @param {Array|null|undefined} events  sorted ascending by starts_at
 * @param {string} todayKey
 * @returns {{ today: Array, thisWeek: Array, later: Array }}
 */
export function bucketActiveEventsByHorizon(events, todayKey) {
  const tomorrowKey = addDaysKey(todayKey, 1);
  const weekEndKey  = addDaysKey(todayKey, 7);

  const today    = [];
  const thisWeek = [];
  const later    = [];

  for (const event of activeCalendarEvents(events)) {
    const key = amsDateKey(event.starts_at);
    if (key < tomorrowKey)     today.push(event);
    else if (key < weekEndKey) thisWeek.push(event);
    else                       later.push(event);
  }

  return { today, thisWeek, later };
}
