/* netlify/functions-tests/ma-calendar-write-request.test.js
 *
 * Tests for the owner-only calendar-write-request Netlify Function against a
 * fake Supabase client (see _fake-supabase.js) — no network calls except the
 * mocked GitHub dispatch.
 *
 * Covers: owner-only authorization, malformed events (title/date/time/window),
 * one/two-item constraints, server-generated deterministic UIDs, source
 * notice re-verification (state/match_status, confirmedEditedFields gating),
 * duplicate-request reuse, failed-dispatch retry (with and without a
 * conflicting written item), and the activity metadata allowlist.
 *
 * Run: node --test netlify/functions-tests/ma-calendar-write-request.test.js
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeSupabase, setFixture } = require('./_fake-supabase');
installFakeSupabase();

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
process.env.MA_DEVICE_TOKEN_PEPPER = 'fake-pepper';
process.env.MA_SYNC_GITHUB_TOKEN = 'fake-gh-token';

const handler = require('../functions/ma-calendar-write-request').handler;

let lastFetchCall = null;
function mockGithubDispatch(status, jsonBody = null) {
  global.fetch = async (url, opts) => {
    lastFetchCall = { url, opts };
    return { status, json: async () => jsonBody };
  };
}

beforeEach(() => {
  mockGithubDispatch(204);
  lastFetchCall = null;
});

const FAMILY_ID = 'family-cal-0001';
const OWNER_ID = 'user-owner-0001';
const MEMBER_ID = 'user-member-0001';
const CAREGIVER_ID = 'user-caregiver-0001';
const UNRELATED_ID = 'user-unrelated-0001';
const NOTICE_ID = 'notice-0001';

let ipCounter = 0;
function uniqueIp() { ipCounter += 1; return `10.0.2.${ipCounter}`; }

function makeEvent({ method = 'POST', body = {}, auth = null, origin = 'https://ma.kapework.com', ip = uniqueIp() } = {}) {
  return {
    httpMethod: method,
    headers: {
      origin,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      'x-forwarded-for': ip,
    },
    body: method === 'OPTIONS' ? null : JSON.stringify(body),
  };
}

const ROSTER = { [OWNER_ID]: 'owner', [MEMBER_ID]: 'member' };

function authFixture(userId) {
  return async (token) => {
    if (token !== userId) return { data: { user: null }, error: new Error('invalid token') };
    return { data: { user: { id: userId } }, error: null };
  };
}

function membershipTableHandler() {
  return (state) => {
    const userIdFilter = state.filters.find((f) => f.col === 'user_id')?.val;
    const familyIdFilter = state.filters.find((f) => f.col === 'family_id')?.val;
    const roleFilter = state.filters.find((f) => f.col === 'role')?.val;
    if (familyIdFilter !== FAMILY_ID) return { data: null, error: null };
    const role = ROSTER[userIdFilter];
    if (!role) return { data: null, error: null };
    if (roleFilter && role !== roleFilter) return { data: null, error: null };
    return { data: { user_id: userIdFilter }, error: null };
  };
}

// Amsterdam is UTC+2 in summer (CEST) — well within the DST period.
const FUTURE_DATE = '2026-08-07';

function rideNoticeFixture(overrides = {}) {
  return {
    id: NOTICE_ID, family_id: FAMILY_ID, state: 'open', match_status: 'missing',
    ride_date: FUTURE_DATE, pickup_time: '09:00:00', return_time: '12:00:00',
    destination: 'Fysiotherapie', return_place: 'Voorbeeldwinkel',
    ...overrides,
  };
}

function appointmentNoticeFixture(overrides = {}) {
  return {
    id: NOTICE_ID, family_id: FAMILY_ID, state: 'open', match_status: 'missing',
    appointment_date: FUTURE_DATE, start_time: '14:30:00', end_time: null,
    practitioner: 'Voorbeeld Therapeut', location: 'Voorbeeldstraat 1',
    ...overrides,
  };
}

function validRideEvent(overrides = {}) {
  return { title: 'Rit naar Fysiotherapie', date: FUTURE_DATE, startTime: '09:00', endTime: '09:15', location: 'Fysiotherapie', notes: null, ...overrides };
}

function buildFixture({
  userId,
  rideNotice = null,
  appointmentNotice = null,
  existingRequest = null,
  writtenItems = [],
  insertedRequest = { id: 'req-new-1' },
  activityError = null,
} = {}) {
  const calls = { requestInserts: [], requestUpdates: [], itemInserts: [], itemDeletes: [], activityInserts: [] };
  const fixture = {
    auth: authFixture(userId),
    tables: {
      ma_family_members: membershipTableHandler(),
      ma_ride_notices: () => ({ data: rideNotice, error: null }),
      ma_appointment_notices: () => ({ data: appointmentNotice, error: null }),
      ma_calendar_write_requests: (state) => {
        if (state.op === 'insert') {
          calls.requestInserts.push(Array.isArray(state.payload) ? state.payload[0] : state.payload);
          return { data: insertedRequest, error: null };
        }
        if (state.op === 'update') {
          calls.requestUpdates.push(state.payload);
          return { data: null, error: null };
        }
        return { data: existingRequest, error: null };
      },
      ma_calendar_write_items: (state) => {
        if (state.op === 'insert') {
          calls.itemInserts.push(state.payload);
          return { data: state.payload, error: null };
        }
        if (state.op === 'delete') {
          calls.itemDeletes.push(state.filters);
          return { data: null, error: null };
        }
        return { data: writtenItems, error: null };
      },
      ma_activity_events: (state) => {
        calls.activityInserts.push(state.payload);
        if (activityError) return { data: null, error: activityError };
        return { data: null, error: null };
      },
    },
  };
  return { fixture, calls };
}

function rideBody(overrides = {}) {
  return { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID, events: [validRideEvent()], ...overrides };
}

// ─── Authorization ────────────────────────────────────────────────────────────

test('owner with a missing ride notice → 202 queued, request+items created, workflow dispatched', async () => {
  const { fixture, calls } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 202);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestId, 'req-new-1');
  assert.equal(parsed.status, 'queued');

  assert.equal(calls.requestInserts.length, 1);
  assert.equal(calls.requestInserts[0].family_id, FAMILY_ID);
  assert.equal(calls.requestInserts[0].requested_by, OWNER_ID);
  assert.equal(calls.requestInserts[0].source_kind, 'ride_notice');
  assert.equal(calls.requestInserts[0].ride_notice_id, NOTICE_ID);

  assert.equal(calls.itemInserts.length, 1);
  assert.equal(calls.itemInserts[0][0].event_uid, 'ma-req-new-1-1@kapework.invalid');
  assert.equal(calls.itemInserts[0][0].sequence_no, 1);

  assert.equal(calls.activityInserts.length, 1);
  assert.equal(calls.activityInserts[0].action, 'calendar_write_requested');
  assert.deepEqual(calls.activityInserts[0].metadata, { source_kind: 'ride_notice', event_count: 1 });

  assert.equal(lastFetchCall.opts.headers.Authorization, 'Bearer fake-gh-token');
  const dispatchBody = JSON.parse(lastFetchCall.opts.body);
  assert.equal(dispatchBody.inputs.calendar_write_request_id, 'req-new-1');
});

test('member is refused with 403 and nothing is created', async () => {
  const { fixture, calls } = buildFixture({ userId: MEMBER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: MEMBER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 403);
  assert.equal(calls.requestInserts.length, 0);
});

test('caregiver (no ma_family_members row) is refused with 403', async () => {
  const { fixture } = buildFixture({ userId: CAREGIVER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: CAREGIVER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 403);
});

test('an unrelated signed-in user is refused with 403', async () => {
  const { fixture } = buildFixture({ userId: UNRELATED_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: UNRELATED_ID, body: rideBody() }));
  assert.equal(res.statusCode, 403);
});

test('no Authorization header → 401', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ body: rideBody() }));
  assert.equal(res.statusCode, 401);
});

test('OPTIONS preflight → 204', async () => {
  const res = await handler(makeEvent({ method: 'OPTIONS' }));
  assert.equal(res.statusCode, 204);
});

test('GET is not allowed → 405', async () => {
  const res = await handler(makeEvent({ method: 'GET', auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 405);
});

test('missing familyId/sourceKind/noticeId/events → 400', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 400);
});

// ─── Malformed events ─────────────────────────────────────────────────────────

test('title over 120 chars → invalid_event', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ title: 'x'.repeat(121) })] }) }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_event');
});

test('blank title → invalid_event', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ title: '   ' })] }) }));
  assert.equal(res.statusCode, 400);
});

test('malformed date → invalid_event', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ date: '2026-13-40' })] }) }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_event');
});

test('malformed time → invalid_event', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ startTime: '9am' })] }) }));
  assert.equal(res.statusCode, 400);
});

test('end time not after start time → invalid_event', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ startTime: '10:00', endTime: '09:00' })] }) }));
  assert.equal(res.statusCode, 400);
});

test('location over 300 chars → invalid_event', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ location: 'x'.repeat(301) })] }) }));
  assert.equal(res.statusCode, 400);
});

test('notes over 1200 chars → invalid_event', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ notes: 'x'.repeat(1201) })] }) }));
  assert.equal(res.statusCode, 400);
});

test('notes with too many lines → invalid_event', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ notes: 'line\n'.repeat(25) })] }) }));
  assert.equal(res.statusCode, 400);
});

test('a NUL byte anywhere in text fields → invalid_event', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ title: 'a\0b' })] }) }));
  assert.equal(res.statusCode, 400);
});

test('date more than 6 months ahead → outside_calendar_window', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture({ ride_date: '2028-01-01' }) });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ date: '2028-01-01' })] }) }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'outside_calendar_window');
});

test('date before yesterday → outside_calendar_window', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture({ ride_date: '2020-01-01' }) });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ date: '2020-01-01' })] }) }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'outside_calendar_window');
});

// ─── Item-count constraints ───────────────────────────────────────────────────

test('a ride notice with 3 events is rejected', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent(), validRideEvent(), validRideEvent()] }) }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_event');
});

test('a ride notice with 0 events is rejected', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [] }) }));
  assert.equal(res.statusCode, 400);
});

test('an appointment notice with 2 events is rejected — exactly one is allowed', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, appointmentNotice: appointmentNoticeFixture() });
  setFixture(fixture);
  const body = {
    familyId: FAMILY_ID, sourceKind: 'appointment_notice', noticeId: NOTICE_ID,
    confirmedEditedFields: true,
    events: [validRideEvent(), validRideEvent()],
  };
  const res = await handler(makeEvent({ auth: OWNER_ID, body }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_event');
});

test('a ride notice with 2 events succeeds and both get sequential UIDs', async () => {
  const { fixture, calls } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({
    auth: OWNER_ID,
    body: rideBody({
      events: [
        validRideEvent(),
        validRideEvent({ title: 'Terug naar huis', startTime: '12:00', endTime: '12:15', location: 'Voorbeeldwinkel' }),
      ],
    }),
  }));
  assert.equal(res.statusCode, 202);
  assert.equal(calls.itemInserts[0][0].event_uid, 'ma-req-new-1-1@kapework.invalid');
  assert.equal(calls.itemInserts[0][1].event_uid, 'ma-req-new-1-2@kapework.invalid');
  assert.equal(calls.itemInserts[0][0].sequence_no, 1);
  assert.equal(calls.itemInserts[0][1].sequence_no, 2);
});

// ─── Source notice re-verification ────────────────────────────────────────────

test('notice not found → invalid_notice', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: null });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, 'invalid_notice');
});

test('notice already dismissed (state != open) → invalid_notice', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture({ state: 'dismissed' }) });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).error, 'invalid_notice');
});

test('matched notice → invalid_notice, no add button\'s worth of trust from the server', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture({ match_status: 'matched' }) });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 409);
});

test('conflict notice → invalid_notice', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture({ match_status: 'conflict' }) });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 409);
});

test('unparsed notice requires confirmedEditedFields even with unchanged-looking fields', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture({ match_status: 'unparsed', ride_date: null, pickup_time: null, destination: null }) });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() })); // confirmedEditedFields omitted
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_notice');
});

test('unparsed notice succeeds once confirmedEditedFields is true', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture({ match_status: 'unparsed', ride_date: null, pickup_time: null, destination: null }) });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ confirmedEditedFields: true }) }));
  assert.equal(res.statusCode, 202);
});

test('missing ride notice with unchanged fields succeeds without confirmedEditedFields', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  // validRideEvent()'s date/startTime/location exactly match rideNoticeFixture()'s outbound leg
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 202);
});

test('missing ride notice with an edited pickup time requires confirmedEditedFields', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody({ events: [validRideEvent({ startTime: '10:00', endTime: '10:15' })] }) }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_notice');
});

test('missing ride notice with an edited pickup time succeeds once confirmed', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({
    auth: OWNER_ID,
    body: rideBody({ confirmedEditedFields: true, events: [validRideEvent({ startTime: '10:00', endTime: '10:15' })] }),
  }));
  assert.equal(res.statusCode, 202);
});

test('missing appointment notice always requires confirmedEditedFields (end time is always an addition)', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, appointmentNotice: appointmentNoticeFixture() });
  setFixture(fixture);
  const body = {
    familyId: FAMILY_ID, sourceKind: 'appointment_notice', noticeId: NOTICE_ID,
    events: [{ title: 'Voorbeeld Kliniek — afspraak', date: FUTURE_DATE, startTime: '14:30', endTime: '15:00', location: 'Voorbeeldstraat 1', notes: null }],
  };
  const res = await handler(makeEvent({ auth: OWNER_ID, body }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_notice');
});

test('missing appointment notice succeeds once confirmed', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, appointmentNotice: appointmentNoticeFixture() });
  setFixture(fixture);
  const body = {
    familyId: FAMILY_ID, sourceKind: 'appointment_notice', noticeId: NOTICE_ID, confirmedEditedFields: true,
    events: [{ title: 'Voorbeeld Kliniek — afspraak', date: FUTURE_DATE, startTime: '14:30', endTime: '15:00', location: 'Voorbeeldstraat 1', notes: null }],
  };
  const res = await handler(makeEvent({ auth: OWNER_ID, body }));
  assert.equal(res.statusCode, 202);
});

// ─── Duplicate request reuse / failed-dispatch retry ─────────────────────────

test('an existing queued request for the same notice is returned, not duplicated', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID, rideNotice: rideNoticeFixture(),
    existingRequest: { id: 'req-existing-1', status: 'queued' },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.requestId, 'req-existing-1');
  assert.equal(parsed.status, 'queued');
  assert.equal(calls.requestInserts.length, 0);
});

test('an existing processing request is returned, not duplicated (double click)', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID, rideNotice: rideNoticeFixture(),
    existingRequest: { id: 'req-existing-2', status: 'processing' },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'processing');
  assert.equal(calls.requestInserts.length, 0);
});

test('an existing success request is returned, never re-dispatched', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID, rideNotice: rideNoticeFixture(),
    existingRequest: { id: 'req-existing-3', status: 'success' },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'success');
  assert.equal(calls.requestInserts.length, 0);
  assert.equal(lastFetchCall, null); // never dispatched again
});

test('a failed request with no written items is reset and reused for retry', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID, rideNotice: rideNoticeFixture(),
    existingRequest: { id: 'req-existing-4', status: 'failed' },
    writtenItems: [],
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 202);
  assert.equal(JSON.parse(res.body).requestId, 'req-existing-4');
  assert.equal(calls.requestInserts.length, 0); // reused, not a fresh insert
  assert.equal(calls.requestUpdates.some((u) => u.status === 'queued'), true);
  assert.equal(calls.itemDeletes.length, 1); // old items cleared before re-inserting
  assert.equal(calls.itemInserts[0][0].event_uid, 'ma-req-existing-4-1@kapework.invalid');
});

test('a failed request WITH a written item is never reset — existing state is returned instead', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID, rideNotice: rideNoticeFixture(),
    existingRequest: { id: 'req-existing-5', status: 'failed' },
    writtenItems: [{ id: 'item-1' }],
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).requestId, 'req-existing-5');
  assert.equal(calls.itemDeletes.length, 0); // never touched
  assert.equal(calls.requestUpdates.filter((u) => u.status === 'queued').length, 0);
});

// ─── Dispatch failure ─────────────────────────────────────────────────────────

test('GitHub dispatch failure → 502, request marked failed, activity already recorded', async () => {
  mockGithubDispatch(500);
  const { fixture, calls } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, 'dispatch_failed');
  assert.equal(calls.activityInserts.length, 1); // audited even though dispatch failed
  const failUpdate = calls.requestUpdates.find((u) => u.error_code === 'dispatch_failed');
  assert.ok(failUpdate);
  assert.equal(failUpdate.status, 'failed');
});

// ─── Activity metadata allowlist ──────────────────────────────────────────────

test('calendar_write_requested metadata carries only source_kind and event_count', async () => {
  const { fixture, calls } = buildFixture({ userId: OWNER_ID, rideNotice: rideNoticeFixture() });
  setFixture(fixture);
  await handler(makeEvent({ auth: OWNER_ID, body: rideBody() }));
  assert.deepEqual(Object.keys(calls.activityInserts[0].metadata).sort(), ['event_count', 'source_kind']);
});
