/**
 * Regression tests for src/lib/calendar-events.js.
 *
 * The bug these guard against: an event deleted from the pinned iCloud
 * calendar becomes a soft-cancelled row in ma_calendar_events (the mirror
 * keeps it for audit/reconciliation, deliberately), and the Ma app used to
 * read those rows without filtering on `status` — so a deleted appointment
 * kept showing up in Today and Agenda forever.
 *
 * Two independent layers are asserted here:
 *   1. the query composition really carries a `status = 'confirmed'` filter,
 *      and the pre-existing date bounds / ordering / pagination are unchanged;
 *   2. the pure selection helpers the views render through exclude anything
 *      that is not confirmed, so a future caller or test double supplying a
 *      cancelled row still cannot get one onto the screen.
 *
 * Run with Node's built-in runner (no dependencies):
 *   node --test apps/ma/src/lib/calendar-events.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_CALENDAR_STATUS,
  CALENDAR_EVENT_COLUMNS,
  isActiveCalendarEvent,
  activeCalendarEvents,
  activeEventsByUid,
  activeEventsOnDay,
  bucketActiveEventsByHorizon,
  buildActiveEventsQuery,
} from './calendar-events.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Synthetic only — neutral placeholder titles, never real calendar content.

const confirmed = (over = {}) => ({
  id: 'evt-confirmed',
  external_event_uid: 'uid-confirmed',
  title: 'Voorbeeld afspraak',
  starts_at: '2026-07-25T08:00:00+00:00',
  status: 'confirmed',
  ...over,
});

const cancelled = (over = {}) => confirmed({
  id: 'evt-cancelled',
  external_event_uid: 'uid-cancelled',
  status: 'cancelled',
  ...over,
});

// ─── isActiveCalendarEvent / activeCalendarEvents ────────────────────────────

test('a confirmed event is active', () => {
  assert.equal(isActiveCalendarEvent(confirmed()), true);
});

test('a cancelled event is not active', () => {
  assert.equal(isActiveCalendarEvent(cancelled()), false);
});

test('an unknown status is not active — a new status must fail closed', () => {
  // The whole reason the filter is `= 'confirmed'` and not `!= 'cancelled'`:
  // a status introduced by a later migration must stay invisible until
  // somebody deliberately decides it should render.
  assert.equal(isActiveCalendarEvent(confirmed({ status: 'tentative' })), false);
  assert.equal(isActiveCalendarEvent(confirmed({ status: 'CONFIRMED' })), false);
  assert.equal(isActiveCalendarEvent(confirmed({ status: '' })), false);
});

test('a missing status is not active', () => {
  const noStatus = confirmed();
  delete noStatus.status;
  assert.equal(isActiveCalendarEvent(noStatus), false);
  assert.equal(isActiveCalendarEvent(confirmed({ status: null })), false);
  assert.equal(isActiveCalendarEvent(confirmed({ status: undefined })), false);
});

test('null/undefined are not active and do not throw', () => {
  assert.equal(isActiveCalendarEvent(null), false);
  assert.equal(isActiveCalendarEvent(undefined), false);
});

test('activeCalendarEvents keeps confirmed events in their original order', () => {
  const a = confirmed({ id: 'a', starts_at: '2026-07-25T08:00:00+00:00' });
  const b = confirmed({ id: 'b', starts_at: '2026-07-25T09:00:00+00:00' });
  const c = confirmed({ id: 'c', starts_at: '2026-07-25T10:00:00+00:00' });
  const mixed = [a, cancelled(), b, confirmed({ id: 'x', status: 'tentative' }), c];

  assert.deepEqual(activeCalendarEvents(mixed).map(e => e.id), ['a', 'b', 'c']);
});

test('activeCalendarEvents tolerates a non-array input', () => {
  assert.deepEqual(activeCalendarEvents(null), []);
  assert.deepEqual(activeCalendarEvents(undefined), []);
});

// ─── activeEventsByUid (notice conflict map) ─────────────────────────────────

test('the conflict-map helper excludes cancelled events', () => {
  const map = activeEventsByUid([confirmed(), cancelled()]);
  assert.equal(map.size, 1);
  assert.equal(map.has('uid-confirmed'), true);
  // A ride notice whose event was deleted from iCloud describes a real, still
  // open discrepancy — a soft-cancelled row must never resolve it.
  assert.equal(map.has('uid-cancelled'), false);
});

test('the conflict-map helper skips events with no external uid', () => {
  const map = activeEventsByUid([confirmed({ external_event_uid: null })]);
  assert.equal(map.size, 0);
});

// ─── Today ───────────────────────────────────────────────────────────────────

test('Today does not select a cancelled event', () => {
  // 2026-07-25T08:00Z is 10:00 Amsterdam on 2026-07-25.
  const events = [
    confirmed({ id: 'keep', starts_at: '2026-07-25T08:00:00+00:00' }),
    cancelled({ id: 'drop', starts_at: '2026-07-25T09:00:00+00:00' }),
  ];
  assert.deepEqual(activeEventsOnDay(events, '2026-07-25').map(e => e.id), ['keep']);
});

test('Today selects only the requested Amsterdam day', () => {
  const events = [
    confirmed({ id: 'today',    starts_at: '2026-07-25T08:00:00+00:00' }),
    confirmed({ id: 'tomorrow', starts_at: '2026-07-26T08:00:00+00:00' }),
  ];
  assert.deepEqual(activeEventsOnDay(events, '2026-07-25').map(e => e.id), ['today']);
});

test('Today uses the Amsterdam day boundary, not UTC', () => {
  // 23:30 UTC on the 24th is 01:30 Amsterdam on the 25th (CEST, +02:00).
  const events = [confirmed({ id: 'late', starts_at: '2026-07-24T23:30:00+00:00' })];
  assert.deepEqual(activeEventsOnDay(events, '2026-07-25').map(e => e.id), ['late']);
});

// ─── Agenda ──────────────────────────────────────────────────────────────────

test('Agenda does not bucket a cancelled event', () => {
  const events = [
    confirmed({ id: 'keep', starts_at: '2026-07-25T08:00:00+00:00' }),
    cancelled({ id: 'drop', starts_at: '2026-07-25T09:00:00+00:00' }),
  ];
  const { today, thisWeek, later } = bucketActiveEventsByHorizon(events, '2026-07-25');
  assert.deepEqual(today.map(e => e.id), ['keep']);
  assert.deepEqual(thisWeek, []);
  assert.deepEqual(later, []);
});

test('Agenda buckets active events by Amsterdam horizon, preserving order', () => {
  const events = [
    confirmed({ id: 'today',  starts_at: '2026-07-25T08:00:00+00:00' }),
    cancelled({ id: 'gone',   starts_at: '2026-07-27T08:00:00+00:00' }),
    confirmed({ id: 'week1',  starts_at: '2026-07-27T08:00:00+00:00' }),
    confirmed({ id: 'week2',  starts_at: '2026-07-31T08:00:00+00:00' }),
    confirmed({ id: 'later',  starts_at: '2026-08-10T08:00:00+00:00' }),
  ];
  const { today, thisWeek, later } = bucketActiveEventsByHorizon(events, '2026-07-25');
  assert.deepEqual(today.map(e => e.id),    ['today']);
  assert.deepEqual(thisWeek.map(e => e.id), ['week1', 'week2']);
  assert.deepEqual(later.map(e => e.id),    ['later']);
});

test('Agenda treats the seventh day out as "coming up", not "this week"', () => {
  const events = [confirmed({ id: 'boundary', starts_at: '2026-08-01T08:00:00+00:00' })];
  const { thisWeek, later } = bucketActiveEventsByHorizon(events, '2026-07-25');
  assert.deepEqual(thisWeek, []);
  assert.deepEqual(later.map(e => e.id), ['boundary']);
});

// ─── Query contract ──────────────────────────────────────────────────────────

/**
 * Records every PostgREST builder call in order. `range` terminates the chain
 * the way the real client does (it returns a thenable); here it just returns
 * the recorder so the assertions can read the whole call log.
 */
function recordingQuery() {
  const calls = [];
  const builder = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'calls') return calls;
      return (...args) => { calls.push([prop, ...args]); return builder; };
    },
  });
  return builder;
}

/** All arguments of the first call to `name`, or undefined if never called. */
function callArgs(calls, name) {
  const found = calls.find(([method]) => method === name);
  return found ? found.slice(1) : undefined;
}

test('fetchEvents composes a confirmed-status filter', () => {
  const q = recordingQuery();
  buildActiveEventsQuery(q, {
    familyId: 'fam-1', from: '2026-07-25T00:00:00+00:00', limit: 40, offset: 0,
  });

  const eqCalls = q.calls.filter(([method]) => method === 'eq');
  assert.deepEqual(
    eqCalls,
    [['eq', 'family_id', 'fam-1'], ['eq', 'status', 'confirmed']],
    'the status filter must be present, and sit with the family filter',
  );
  assert.equal(ACTIVE_CALENDAR_STATUS, 'confirmed');
});

test('fetchEvents never filters with a mere not-cancelled predicate', () => {
  const q = recordingQuery();
  buildActiveEventsQuery(q, {
    familyId: 'fam-1', from: '2026-07-25T00:00:00+00:00', limit: 40, offset: 0,
  });
  // `.neq('status','cancelled')` would let any future status through.
  assert.equal(q.calls.some(([method]) => method === 'neq'), false);
});

test('fetchEvents still selects status for callers and diagnostics', () => {
  const q = recordingQuery();
  buildActiveEventsQuery(q, {
    familyId: 'fam-1', from: '2026-07-25T00:00:00+00:00', limit: 40, offset: 0,
  });
  assert.match(CALENDAR_EVENT_COLUMNS, /\bstatus\b/);
  assert.deepEqual(callArgs(q.calls, 'select'), [CALENDAR_EVENT_COLUMNS]);
});

test('fetchEvents keeps its date bounds, ordering and pagination unchanged', () => {
  const q = recordingQuery();
  buildActiveEventsQuery(q, {
    familyId: 'fam-1',
    from: '2026-07-25T00:00:00+00:00',
    to: '2027-01-25T00:00:00+00:00',
    limit: 60,
    offset: 120,
  });

  assert.deepEqual(callArgs(q.calls, 'gte'), ['starts_at', '2026-07-25T00:00:00+00:00']);
  assert.deepEqual(callArgs(q.calls, 'lt'),  ['starts_at', '2027-01-25T00:00:00+00:00']);
  assert.deepEqual(callArgs(q.calls, 'order'), ['starts_at', { ascending: true }]);
  assert.deepEqual(callArgs(q.calls, 'range'), [120, 179]);
});

test('fetchEvents omits the upper bound when no `to` is given', () => {
  const q = recordingQuery();
  buildActiveEventsQuery(q, {
    familyId: 'fam-1', from: '2026-07-25T00:00:00+00:00', limit: 40, offset: 0,
  });
  assert.equal(q.calls.some(([method]) => method === 'lt'), false);
  assert.deepEqual(callArgs(q.calls, 'range'), [0, 39]);
});
