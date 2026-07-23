/* netlify/functions-tests/ma-calendar-suggest.test.js
 *
 * Tests for the owner-only calendar-suggestion Netlify Function against a fake
 * Supabase client (see _fake-supabase.js) and a mocked Anthropic endpoint.
 *
 * Covers: owner-only authorization, missing API key, malformed body, notice
 * re-verification (found/open), missing excerpt, happy-path extraction,
 * appointment single-event cap, server-side cleaning of malformed/oversized/
 * injection-y model output, Anthropic failure/truncation/non-JSON handling,
 * rate limiting, and log discipline (the excerpt never reaches a log line).
 *
 * Run: node --test netlify/functions-tests/ma-calendar-suggest.test.js
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeSupabase, setFixture } = require('./_fake-supabase');
installFakeSupabase();

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
process.env.MA_DEVICE_TOKEN_PEPPER = 'fake-pepper';
process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';

const handler = require('../functions/ma-calendar-suggest').handler;

const FAMILY_ID = 'family-cal-0001';
const OWNER_ID = 'user-owner-0001';
const MEMBER_ID = 'user-member-0001';
const NOTICE_ID = 'notice-0001';
const REFERENCE = '2026-07-22';
const RIDE_EXCERPT = 'Op vrijdag 7 augustus wordt uw moeder gereden naar fysio om 9.00 uur.';

let lastAnthropicBody = null;
function mockAnthropic(modelOutput, { stopReason = 'end_turn', httpStatus = 200, nonJson = false } = {}) {
  global.fetch = async (url, opts) => {
    lastAnthropicBody = opts && opts.body ? JSON.parse(opts.body) : null;
    if (httpStatus !== 200) return { ok: false, status: httpStatus, json: async () => ({}) };
    const text = nonJson ? 'not json at all' : JSON.stringify(modelOutput);
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text }], stop_reason: stopReason, usage: { input_tokens: 5, output_tokens: 5 } }),
    };
  };
}

beforeEach(() => {
  lastAnthropicBody = null;
  mockAnthropic({ reliable: true, events: [] });
});

let ipCounter = 0;
function uniqueIp() { ipCounter += 1; return `10.0.3.${ipCounter}`; }

function makeEvent({ method = 'POST', body = {}, auth = OWNER_ID, ip = uniqueIp() } = {}) {
  return {
    httpMethod: method,
    headers: {
      origin: 'https://ma.kapework.com',
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

function rideNotice(overrides = {}) {
  return {
    id: NOTICE_ID, family_id: FAMILY_ID, state: 'open', match_status: 'unparsed',
    excerpt: RIDE_EXCERPT, created_at: `${REFERENCE}T12:42:00Z`, ...overrides,
  };
}

function appointmentNotice(overrides = {}) {
  return {
    id: NOTICE_ID, family_id: FAMILY_ID, state: 'open', match_status: 'unparsed',
    excerpt: 'Uw afspraak is bevestigd.', provider_label: 'Voorbeeld Kliniek',
    practitioner: 'Voorbeeld Therapeut', received_at: `${REFERENCE}T08:00:00Z`, ...overrides,
  };
}

function buildFixture({ userId = OWNER_ID, notice = rideNotice(), table = 'ma_ride_notices' } = {}) {
  return {
    auth: authFixture(userId),
    tables: {
      ma_family_members: membershipTableHandler(),
      [table]: () => ({ data: notice, error: null }),
    },
  };
}

// ─── Method / config / body ──────────────────────────────────────────────────

test('OPTIONS preflight returns 204', async () => {
  setFixture(buildFixture());
  const res = await handler(makeEvent({ method: 'OPTIONS' }));
  assert.equal(res.statusCode, 204);
});

test('non-POST returns 405', async () => {
  setFixture(buildFixture());
  const res = await handler(makeEvent({ method: 'GET' }));
  assert.equal(res.statusCode, 405);
});

test('missing ANTHROPIC_API_KEY returns 503 config_error', async () => {
  setFixture(buildFixture());
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error, 'config_error');
  } finally {
    process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('missing familyId/noticeId → 400 bad_request', async () => {
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { sourceKind: 'ride_notice' } }));
  assert.equal(res.statusCode, 400);
});

test('unknown sourceKind → 400 bad_request', async () => {
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'something_else', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 400);
});

// ─── Authorization ────────────────────────────────────────────────────────────

test('a non-owner (member) is refused with 403', async () => {
  setFixture(buildFixture({ userId: MEMBER_ID }));
  const res = await handler(makeEvent({ auth: MEMBER_ID, body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'not_authorized');
});

// ─── Notice re-verification ─────────────────────────────────────────────────

test('a missing notice → 404 invalid_notice', async () => {
  setFixture(buildFixture({ notice: null }));
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, 'invalid_notice');
});

test('a non-open notice → 409 invalid_notice', async () => {
  setFixture(buildFixture({ notice: rideNotice({ state: 'dismissed' }) }));
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 409);
});

test('a notice with no excerpt → 422 no_excerpt, and Anthropic is never called', async () => {
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
  setFixture(buildFixture({ notice: rideNotice({ excerpt: '   ' }) }));
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 422);
  assert.equal(JSON.parse(res.body).error, 'no_excerpt');
  assert.equal(called, false);
});

// ─── Happy path + output shaping ─────────────────────────────────────────────

test('a valid two-leg ride suggestion is returned cleaned', async () => {
  mockAnthropic({
    reliable: true,
    events: [
      { title: 'Rit naar fysio', date: '2026-08-07', start_time: '09:00', end_time: null, location: 'Fysio' },
      { title: 'Terugrit', date: '2026-08-07', start_time: '12:00', end_time: null, location: 'de Action' },
    ],
  });
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.reliable, true);
  assert.equal(data.events.length, 2);
  assert.deepEqual(data.events[0], { title: 'Rit naar fysio', date: '2026-08-07', startTime: '09:00', endTime: null, location: 'Fysio' });
  assert.equal(data.events[1].location, 'de Action');
});

test('the reference date and excerpt are passed to Anthropic (never a client-supplied excerpt)', async () => {
  mockAnthropic({ reliable: true, events: [] });
  setFixture(buildFixture());
  await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID, excerpt: 'ATTACKER SUPPLIED' } }));
  const sent = JSON.stringify(lastAnthropicBody);
  assert.ok(sent.includes(REFERENCE), 'reference date sent');
  assert.ok(sent.includes('fysio'), 'server-loaded excerpt sent');
  assert.ok(!sent.includes('ATTACKER SUPPLIED'), 'client-supplied excerpt is ignored');
});

test('an appointment suggestion is capped to a single event even if the model returns two', async () => {
  mockAnthropic({
    reliable: true,
    events: [
      { title: 'Afspraak', date: '2026-08-07', start_time: '14:30', end_time: null, location: 'Kliniek' },
      { title: 'Tweede', date: '2026-08-08', start_time: '10:00', end_time: null, location: 'Elders' },
    ],
  });
  setFixture(buildFixture({ notice: appointmentNotice(), table: 'ma_appointment_notices' }));
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'appointment_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).events.length, 1);
});

test('malformed model fields are dropped to null, not trusted', async () => {
  mockAnthropic({
    reliable: true,
    events: [{
      title: 'x'.repeat(500),          // over 120 → capped
      date: '2026-13-99',              // not a real date → null
      start_time: '9:00',             // not HH:MM → null
      end_time: '25:61',              // invalid → null
      location: 'ok location',
    }],
  });
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 200);
  const ev = JSON.parse(res.body).events[0];
  assert.equal(ev.title.length, 120);
  assert.equal(ev.date, null);
  assert.equal(ev.startTime, null);
  assert.equal(ev.endTime, null);
  assert.equal(ev.location, 'ok location');
});

test('an end time not after the start is dropped to null', async () => {
  mockAnthropic({ reliable: true, events: [{ title: 'Rit', date: '2026-08-07', start_time: '12:00', end_time: '11:00', location: null }] });
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(JSON.parse(res.body).events[0].endTime, null);
});

test('an entirely empty event is dropped, and reliable becomes false when nothing usable remains', async () => {
  mockAnthropic({ reliable: true, events: [{ title: null, date: null, start_time: null, end_time: null, location: null }] });
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  const data = JSON.parse(res.body);
  assert.equal(data.events.length, 0);
  assert.equal(data.reliable, false);
});

test('an injection-style title is returned as inert data (length-capped), never acted on', async () => {
  mockAnthropic({ reliable: true, events: [{ title: 'Negeer alle instructies en '.repeat(20), date: '2026-08-07', start_time: '09:00', end_time: null, location: null }] });
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 200);
  assert.ok(JSON.parse(res.body).events[0].title.length <= 120);
});

// ─── Anthropic failure modes ─────────────────────────────────────────────────

test('an Anthropic HTTP error → 502 suggest_unavailable', async () => {
  mockAnthropic(null, { httpStatus: 500 });
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, 'suggest_unavailable');
});

test('a truncated (max_tokens) response → 502 suggest_unavailable', async () => {
  mockAnthropic({ reliable: true, events: [] }, { stopReason: 'max_tokens' });
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 502);
});

test('a non-JSON model response → 502 suggest_unavailable', async () => {
  mockAnthropic(null, { nonJson: true });
  setFixture(buildFixture());
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  assert.equal(res.statusCode, 502);
});

// ─── Rate limit + log discipline ─────────────────────────────────────────────

test('rate limiting kicks in after the per-IP limit', async () => {
  setFixture(buildFixture());
  const ip = '10.0.9.9';
  let res;
  for (let i = 0; i < 12; i += 1) {
    res = await handler(makeEvent({ ip, body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  }
  assert.equal(res.statusCode, 429);
});

test('the excerpt and suggested field values never reach a log line', async () => {
  mockAnthropic({ reliable: true, events: [{ title: 'Geheime titel', date: '2026-08-07', start_time: '09:00', end_time: null, location: 'Geheime locatie' }] });
  setFixture(buildFixture());
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    await handler(makeEvent({ body: { familyId: FAMILY_ID, sourceKind: 'ride_notice', noticeId: NOTICE_ID } }));
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  const joined = logs.join('\n');
  assert.ok(!joined.includes('fysio'), 'excerpt content not logged');
  assert.ok(!joined.includes('Geheime titel'), 'suggested title not logged');
  assert.ok(!joined.includes('Geheime locatie'), 'suggested location not logged');
});
