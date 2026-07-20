/* netlify/functions-tests/ma-sync-trigger.test.js
 *
 * Tests for the owner-only manual calendar-sync-request Netlify Function
 * against a fake Supabase client (see _fake-supabase.js) — no network calls.
 *
 * Covers: owner-only authorization, single-flight (an active run blocks a
 * duplicate request), the 60s cooldown after a finished run or a very-fresh
 * pending request, de-duplicating a still-fresh unclaimed request instead of
 * inserting a second one, and the audit-write-must-not-be-skipped contract
 * (mirrors ma-device-revoke.js's pattern: a failed audit write surfaces as a
 * 500 even though the underlying write already happened).
 *
 * Run: node --test netlify/functions-tests/ma-sync-trigger.test.js
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeSupabase, setFixture } = require('./_fake-supabase');
installFakeSupabase();

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
process.env.MA_DEVICE_TOKEN_PEPPER = 'fake-pepper';
process.env.MA_SYNC_GITHUB_TOKEN = 'fake-gh-token';

const handler = require('../functions/ma-sync-trigger').handler;

// ─── GitHub dispatch fetch mock ─────────────────────────────────────────────
// Every test gets a default 204-success mock via beforeEach; a test that
// cares about a different GitHub response overrides global.fetch itself.

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

const FAMILY_ID = 'family-syn-0001';
const OWNER_ID     = 'user-owner-0001';
const MEMBER_ID    = 'user-member-0001';
const CAREGIVER_ID = 'user-caregiver-0001';
const UNRELATED_ID = 'user-unrelated-0001';

let ipCounter = 0;
function uniqueIp() { ipCounter += 1; return `10.0.1.${ipCounter}`; }

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
    const userIdFilter = state.filters.find(f => f.col === 'user_id')?.val;
    const familyIdFilter = state.filters.find(f => f.col === 'family_id')?.val;
    const roleFilter = state.filters.find(f => f.col === 'role')?.val;
    if (familyIdFilter !== FAMILY_ID) return { data: null, error: null };
    const role = ROSTER[userIdFilter];
    if (!role) return { data: null, error: null };
    if (roleFilter && role !== roleFilter) return { data: null, error: null };
    return { data: { user_id: userIdFilter }, error: null };
  };
}

/**
 * @param {object} opts
 * @param {object|null} [opts.latestRun] — row returned by the ma_integration_runs lookup
 * @param {object|null} [opts.pendingRequest] — row returned by the pending ma_sync_requests lookup
 * @param {object|null} [opts.insertedRequest] — row to return from a ma_sync_requests insert
 * @param {object|null} [opts.activityError]
 */
function buildFixture({ userId, latestRun = null, pendingRequest = null, insertedRequest = { id: 'req-1', requested_at: new Date().toISOString() }, activityError = null }) {
  const calls = { syncRequestInserts: [], syncRequestUpdates: [], activityInserts: [], pendingLookupFilters: null };
  const fixture = {
    auth: authFixture(userId),
    tables: {
      ma_family_members: membershipTableHandler(),
      ma_integration_runs: () => ({ data: latestRun, error: null }),
      ma_sync_requests: (state) => {
        if (state.op === 'insert') {
          calls.syncRequestInserts.push(state.payload);
          return { data: insertedRequest, error: null };
        }
        if (state.op === 'update') {
          calls.syncRequestUpdates.push(state.payload);
          return { data: null, error: null };
        }
        calls.pendingLookupFilters = state.filters;
        return { data: pendingRequest, error: null };
      },
      ma_activity_events: (state) => {
        calls.activityInserts.push(state.payload);
        if (activityError) return { data: null, error: activityError };
        return { data: null, error: null };
      },
      app_errors: () => ({ data: null, error: null }),
    },
  };
  return { fixture, calls };
}

// ─── Authorization ──────────────────────────────────────────────────────────

test('owner with no prior run/request → 200 queued, exactly one audited request, workflow dispatched', async () => {
  const { fixture, calls } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, 'queued');
  assert.equal(parsed.requestId, 'req-1');

  assert.equal(calls.syncRequestInserts.length, 1);
  assert.equal(calls.syncRequestInserts[0].family_id, FAMILY_ID);
  assert.equal(calls.syncRequestInserts[0].requested_by, OWNER_ID);

  assert.equal(calls.activityInserts.length, 1);
  const activity = calls.activityInserts[0];
  assert.equal(activity.action, 'manual_sync_requested');
  assert.equal(activity.actor_user_id, OWNER_ID);
  assert.deepEqual(activity.metadata, {});

  assert.ok(lastFetchCall.url.includes('/repos/mltobing/irma-sync/actions/workflows/sync.yml/dispatches'));
  assert.equal(lastFetchCall.opts.headers.Authorization, 'Bearer fake-gh-token');
  const dispatchBody = JSON.parse(lastFetchCall.opts.body);
  assert.equal(dispatchBody.ref, 'main');
  assert.equal(dispatchBody.inputs.manual_request_id, 'req-1');

  assert.equal(calls.syncRequestUpdates.length, 1);
  assert.equal(calls.syncRequestUpdates[0].dispatch_status, 'dispatched');
});

test('member is refused with 403 and no request is created', async () => {
  const { fixture, calls } = buildFixture({ userId: MEMBER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: MEMBER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 403);
  assert.equal(calls.syncRequestInserts.length, 0);
});

test('caregiver (no ma_family_members row) is refused with 403', async () => {
  const { fixture } = buildFixture({ userId: CAREGIVER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: CAREGIVER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 403);
});

test('an unrelated signed-in user is refused with 403', async () => {
  const { fixture } = buildFixture({ userId: UNRELATED_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: UNRELATED_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 403);
});

test('no Authorization header → 401', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 401);
});

test('missing familyId → 400', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: {} }));
  assert.equal(res.statusCode, 400);
});

test('OPTIONS preflight → 204 with CORS headers, no body parsing', async () => {
  const res = await handler(makeEvent({ method: 'OPTIONS' }));
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://ma.kapework.com');
});

test('GET is not allowed → 405', async () => {
  const res = await handler(makeEvent({ method: 'GET', auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 405);
});

// ─── Single-flight / cooldown ───────────────────────────────────────────────

test('an active run (running, started recently) → already_running, no duplicate request', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID,
    latestRun: { id: 'run-1', status: 'running', finished_at: null, started_at: new Date().toISOString() },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.status, 'already_running');
  assert.equal(calls.syncRequestInserts.length, 0);
});

test('a stale "running" row (started long ago) is not treated as active — proceeds to queue', async () => {
  const staleStart = new Date(Date.now() - 60 * 60_000).toISOString(); // 1h ago
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID,
    latestRun: { id: 'run-1', status: 'running', finished_at: null, started_at: staleStart },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'queued');
  assert.equal(calls.syncRequestInserts.length, 1);
});

test('a run that finished less than 60s ago → cooldown, no duplicate request', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID,
    latestRun: { id: 'run-1', status: 'success', finished_at: new Date(Date.now() - 10_000).toISOString(), started_at: new Date(Date.now() - 20_000).toISOString() },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.status, 'cooldown');
  assert.ok(parsed.retryAfterSeconds > 0 && parsed.retryAfterSeconds <= 60);
  assert.equal(calls.syncRequestInserts.length, 0);
});

test('a run that finished over 60s ago → no cooldown, proceeds to queue', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID,
    latestRun: { id: 'run-1', status: 'success', finished_at: new Date(Date.now() - 90_000).toISOString(), started_at: new Date(Date.now() - 100_000).toISOString() },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'queued');
  assert.equal(calls.syncRequestInserts.length, 1);
});

test('an existing unclaimed request under 60s old → cooldown, no duplicate insert', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID,
    pendingRequest: { id: 'req-existing', requested_at: new Date(Date.now() - 5_000).toISOString() },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'cooldown');
  assert.equal(calls.syncRequestInserts.length, 0);
});

test('an existing unclaimed request older than 60s but still fresh → reported as queued, no duplicate insert', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID,
    pendingRequest: { id: 'req-existing', requested_at: new Date(Date.now() - 5 * 60_000).toISOString() },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.status, 'queued');
  assert.equal(parsed.requestId, 'req-existing');
  assert.equal(calls.syncRequestInserts.length, 0);
});

test('an existing unclaimed request older than the freshness window is ignored — a new one is queued', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID,
    pendingRequest: { id: 'req-old', requested_at: new Date(Date.now() - 25 * 60_000).toISOString() },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'queued');
  assert.equal(calls.syncRequestInserts.length, 1);
});

// ─── Audit-write discipline ─────────────────────────────────────────────────

test('a failed audit write surfaces as 500, even though the request row was already inserted', async () => {
  const { fixture, calls } = buildFixture({
    userId: OWNER_ID,
    activityError: { code: '500XX', message: 'insert failed' },
  });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 500);
  assert.equal(calls.syncRequestInserts.length, 1); // the request row write did happen
});

// ─── GitHub workflow dispatch ───────────────────────────────────────────────

test('missing GitHub dispatch configuration → 503, no request created, no dispatch attempted', async () => {
  const originalToken = process.env.MA_SYNC_GITHUB_TOKEN;
  delete process.env.MA_SYNC_GITHUB_TOKEN;
  try {
    const { fixture, calls } = buildFixture({ userId: OWNER_ID });
    setFixture(fixture);
    const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
    assert.equal(res.statusCode, 503);
    assert.equal(calls.syncRequestInserts.length, 0);
    assert.equal(lastFetchCall, null);
  } finally {
    process.env.MA_SYNC_GITHUB_TOKEN = originalToken;
  }
});

test('GitHub 200 response with a run id → queued, run id stored for correlation', async () => {
  mockGithubDispatch(200, { id: 123456 });
  const { fixture, calls } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'queued');
  assert.equal(calls.syncRequestUpdates[0].dispatch_status, 'dispatched');
  assert.equal(calls.syncRequestUpdates[0].github_run_id, '123456');
});

test('GitHub 204 response (no body) → queued, no run id required', async () => {
  mockGithubDispatch(204);
  const { fixture, calls } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.syncRequestUpdates[0].dispatch_status, 'dispatched');
  assert.equal(calls.syncRequestUpdates[0].github_run_id, null);
});

test('GitHub 4xx response → 502, request marked dispatch_status=failed, response body never leaked', async () => {
  mockGithubDispatch(422, { message: 'Unprocessable: some internal detail' });
  const { fixture, calls } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 502);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.error, 'dispatch_failed');
  assert.ok(!JSON.stringify(parsed).includes('Unprocessable'));
  assert.equal(calls.syncRequestUpdates[0].dispatch_status, 'failed');
  assert.equal(calls.syncRequestUpdates[0].dispatch_error_code, 'github_client_error');
});

test('GitHub 5xx response → 502, dispatch_error_code=github_server_error', async () => {
  mockGithubDispatch(503);
  const { fixture, calls } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 502);
  assert.equal(calls.syncRequestUpdates[0].dispatch_error_code, 'github_server_error');
});

test('GitHub dispatch network failure → 502, dispatch_error_code=network_error', async () => {
  global.fetch = async () => { throw new Error('fetch failed'); };
  const { fixture, calls } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 502);
  assert.equal(calls.syncRequestUpdates[0].dispatch_error_code, 'network_error');
});

test('the pending-request lookup excludes dispatch_status=failed, so a failed dispatch never blocks a retry', async () => {
  const { fixture, calls } = buildFixture({ userId: OWNER_ID, pendingRequest: null });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'queued');
  assert.equal(calls.syncRequestInserts.length, 1); // proceeded to a fresh request + dispatch
  assert.ok(calls.pendingLookupFilters.some(f => f.type === 'neq' && f.col === 'dispatch_status' && f.val === 'failed'));
});
