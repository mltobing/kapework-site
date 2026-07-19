/* netlify/functions-tests/ma-device-handlers.test.js
 *
 * End-to-end tests for the trusted-device Netlify Functions
 * (ma-devices-list, ma-pairing-create, ma-device-revoke, ma-device-activate)
 * against a fake Supabase client (see _fake-supabase.js) — no network calls.
 *
 * Covers the PR3 "Ma Beheer" authorization change (device administration is
 * now owner-only, not just family-membership) and the activity-audit
 * contract for device actions: exactly one event per meaningful action, no
 * pairing code/token/hash/label ever written to metadata, and a failed audit
 * write must not report a successful administrative action.
 *
 * Run: node --test netlify/functions-tests/ma-device-handlers.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeSupabase, setFixture } = require('./_fake-supabase');
installFakeSupabase();

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
process.env.MA_DEVICE_TOKEN_PEPPER = 'fake-pepper';

const listHandler     = require('../functions/ma-devices-list').handler;
const createHandler   = require('../functions/ma-pairing-create').handler;
const revokeHandler   = require('../functions/ma-device-revoke').handler;
const activateHandler = require('../functions/ma-device-activate').handler;

const FAMILY_ID = 'family-syn-0001';
const OWNER_ID     = 'user-owner-0001';
const MEMBER_ID    = 'user-member-0001';
const CAREGIVER_ID = 'user-caregiver-0001';
const UNRELATED_ID = 'user-unrelated-0001';

let ipCounter = 0;
function uniqueIp() { ipCounter += 1; return `10.0.0.${ipCounter}`; }

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

// Membership roster shared by every "owner/member/caregiver/unrelated" test —
// mirrors ma_family_members: only owner/member rows exist there (caregiver
// access lives in ma_care_team_members and is a *different* table, so a
// caregiver's token correctly finds no row here at all, same as an
// unrelated user's).
const ROSTER = {
  [OWNER_ID]:  'owner',
  [MEMBER_ID]: 'member',
};

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
    if (!role) return { data: null, error: null }; // caregiver/unrelated: no row here
    if (roleFilter && role !== roleFilter) return { data: null, error: null };
    return { data: { user_id: userIdFilter }, error: null };
  };
}

// ─── ma-devices-list ────────────────────────────────────────────────────────

test('devices-list: owner sees the family device list', async () => {
  setFixture({
    auth: authFixture(OWNER_ID),
    tables: {
      ma_family_members: membershipTableHandler(),
      ma_trusted_devices: () => ({
        data: [{ id: 'dev-1', label: 'iPad keuken', created_at: '2026-07-01T00:00:00Z', last_seen_at: null, expires_at: '2027-07-01T00:00:00Z', revoked_at: null }],
        error: null,
      }),
    },
  });
  const res = await listHandler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.devices.length, 1);
  assert.equal(parsed.devices[0].id, 'dev-1');
});

test('devices-list: member is refused with 403', async () => {
  setFixture({ auth: authFixture(MEMBER_ID), tables: { ma_family_members: membershipTableHandler() } });
  const res = await listHandler(makeEvent({ auth: MEMBER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'not_authorized');
});

test('devices-list: caregiver (no ma_family_members row) is refused with 403', async () => {
  setFixture({ auth: authFixture(CAREGIVER_ID), tables: { ma_family_members: membershipTableHandler() } });
  const res = await listHandler(makeEvent({ auth: CAREGIVER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 403);
});

test('devices-list: an unrelated user is refused with 403', async () => {
  setFixture({ auth: authFixture(UNRELATED_ID), tables: { ma_family_members: membershipTableHandler() } });
  const res = await listHandler(makeEvent({ auth: UNRELATED_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 403);
});

test('devices-list: no Authorization header → 401', async () => {
  setFixture({ auth: authFixture(OWNER_ID), tables: { ma_family_members: membershipTableHandler() } });
  const res = await listHandler(makeEvent({ body: { familyId: FAMILY_ID } })); // no auth
  assert.equal(res.statusCode, 401);
});

test('devices-list: invalid bearer token → 401', async () => {
  setFixture({ auth: authFixture(OWNER_ID), tables: { ma_family_members: membershipTableHandler() } });
  const res = await listHandler(makeEvent({ auth: 'garbage-token', body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 401);
});

test('devices-list: missing familyId → 400', async () => {
  setFixture({ auth: authFixture(OWNER_ID), tables: { ma_family_members: membershipTableHandler() } });
  const res = await listHandler(makeEvent({ auth: OWNER_ID, body: {} }));
  assert.equal(res.statusCode, 400);
});

test('devices-list: OPTIONS preflight → 204 with CORS headers, no body parsing', async () => {
  const res = await listHandler(makeEvent({ method: 'OPTIONS' }));
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://ma.kapework.com');
});

test('devices-list: GET is not allowed → 405', async () => {
  const res = await listHandler(makeEvent({ method: 'GET', auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 405);
});

// ─── ma-pairing-create ──────────────────────────────────────────────────────

test('pairing-create: owner creates a pairing; raw code/token appear only in the response, never in the DB insert payload', async () => {
  let insertedPayload = null;
  setFixture({
    auth: authFixture(OWNER_ID),
    tables: {
      ma_family_members: membershipTableHandler(),
      ma_device_pairings: (state) => {
        if (state.op === 'insert') { insertedPayload = state.payload; return { data: { id: 'pairing-1' }, error: null }; }
        return { data: null, error: null };
      },
    },
  });
  const res = await createHandler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, label: 'iPad keuken' } }));
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.pairingId, 'pairing-1');
  assert.match(parsed.activationUrl, /^https:\/\/ma\.kapework\.com\/vandaag\/koppelen#token=/);
  assert.match(parsed.code, /^\d{6}$/);

  // The raw secrets must never reach the DB — only their hashes.
  assert.ok(insertedPayload, 'expected an insert to ma_device_pairings');
  assert.equal(insertedPayload.link_token_hash?.length, 64); // sha-256 hex
  assert.equal(insertedPayload.code_hash?.length, 64);
  const rawToken = parsed.activationUrl.split('#token=')[1];
  assert.ok(!JSON.stringify(insertedPayload).includes(rawToken));
  assert.ok(!JSON.stringify(insertedPayload).includes(parsed.code));
});

test('pairing-create: member is refused with 403 and no pairing row is created', async () => {
  let insertCalled = false;
  setFixture({
    auth: authFixture(MEMBER_ID),
    tables: {
      ma_family_members: membershipTableHandler(),
      ma_device_pairings: (state) => { if (state.op === 'insert') insertCalled = true; return { data: null, error: null }; },
    },
  });
  const res = await createHandler(makeEvent({ auth: MEMBER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 403);
  assert.equal(insertCalled, false);
});

// ─── ma-device-revoke ───────────────────────────────────────────────────────

function revokeFixture({ userId, updateReturnsData, activityError = null }) {
  const calls = { updates: [], activityInserts: [] };
  const fixture = {
    auth: authFixture(userId),
    tables: {
      ma_family_members: membershipTableHandler(),
      ma_trusted_devices: (state) => {
        if (state.op === 'update') {
          calls.updates.push(state.payload);
          return { data: updateReturnsData, error: null };
        }
        return { data: null, error: null };
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

test('device-revoke: owner revokes an existing device → 200, one activity event with empty (safe) metadata', async () => {
  const { fixture, calls } = revokeFixture({ userId: OWNER_ID, updateReturnsData: { id: 'dev-1' } });
  setFixture(fixture);
  const res = await revokeHandler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, deviceId: 'dev-1' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, revoked: true });

  assert.equal(calls.activityInserts.length, 1);
  const activity = calls.activityInserts[0];
  assert.equal(activity.action, 'trusted_device_revoked');
  assert.equal(activity.actor_user_id, OWNER_ID);
  assert.equal(activity.object_id, 'dev-1');
  assert.deepEqual(activity.metadata, {}); // no label/token/hash
  assert.equal(activity.idempotency_key, 'trusted-device-revoked-dev-1');
});

test('device-revoke: revoking an already-revoked device is a no-op → 200 revoked:false, no second activity event', async () => {
  // The update's WHERE .is('revoked_at', null) no longer matches → no row returned.
  const { fixture, calls } = revokeFixture({ userId: OWNER_ID, updateReturnsData: null });
  setFixture(fixture);
  const res = await revokeHandler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, deviceId: 'dev-1' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, revoked: false });
  assert.equal(calls.activityInserts.length, 0);
});

test('device-revoke: member is refused with 403 and no update is attempted', async () => {
  const { fixture, calls } = revokeFixture({ userId: MEMBER_ID, updateReturnsData: { id: 'dev-1' } });
  setFixture(fixture);
  const res = await revokeHandler(makeEvent({ auth: MEMBER_ID, body: { familyId: FAMILY_ID, deviceId: 'dev-1' } }));
  assert.equal(res.statusCode, 403);
  assert.equal(calls.updates.length, 0);
});

test('device-revoke: caregiver is refused with 403', async () => {
  const { fixture } = revokeFixture({ userId: CAREGIVER_ID, updateReturnsData: { id: 'dev-1' } });
  setFixture(fixture);
  const res = await revokeHandler(makeEvent({ auth: CAREGIVER_ID, body: { familyId: FAMILY_ID, deviceId: 'dev-1' } }));
  assert.equal(res.statusCode, 403);
});

test('device-revoke: a failed audit write surfaces as 500, even though the revoke itself succeeded', async () => {
  const { fixture, calls } = revokeFixture({
    userId: OWNER_ID,
    updateReturnsData: { id: 'dev-1' },
    activityError: { code: '500XX', message: 'insert failed' },
  });
  setFixture(fixture);
  const res = await revokeHandler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, deviceId: 'dev-1' } }));
  assert.equal(res.statusCode, 500);
  assert.equal(calls.updates.length, 1); // the revoke DB write did happen
});

test('device-revoke: missing deviceId → 400', async () => {
  const { fixture } = revokeFixture({ userId: OWNER_ID, updateReturnsData: null });
  setFixture(fixture);
  const res = await revokeHandler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 400);
});

// ─── ma-device-activate ─────────────────────────────────────────────────────

function activateFixture({ pairingFound, alreadyConsumedRace = false, deviceInsertError = null, activityError = null }) {
  const calls = { deviceInserts: [], activityInserts: [] };
  const fixture = {
    auth: async () => ({ data: { user: null }, error: null }), // never used by this endpoint
    tables: {
      ma_device_pairings: (state) => {
        if (state.op === 'update') {
          if (!pairingFound || alreadyConsumedRace) return { data: null, error: null };
          return { data: { family_id: FAMILY_ID, requested_label: 'iPad keuken', created_by: OWNER_ID }, error: null };
        }
        // select (lookup)
        if (!pairingFound) return { data: null, error: null };
        return { data: { id: 'pairing-1' }, error: null };
      },
      ma_trusted_devices: (state) => {
        calls.deviceInserts.push(state.payload);
        if (deviceInsertError) return { data: null, error: deviceInsertError };
        return { data: { id: 'dev-new-1' }, error: null };
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

test('device-activate: valid pairing token → 200, cookie set, exactly one safe activity event', async () => {
  const { fixture, calls } = activateFixture({ pairingFound: true });
  setFixture(fixture);
  const res = await activateHandler(makeEvent({ body: { token: 'a-valid-looking-token-value' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.ok(res.multiValueHeaders['Set-Cookie'][0].startsWith('ma_today_device='));

  assert.equal(calls.activityInserts.length, 1);
  const activity = calls.activityInserts[0];
  assert.equal(activity.action, 'trusted_device_activated');
  assert.equal(activity.actor_user_id, OWNER_ID);
  assert.equal(activity.object_id, 'dev-new-1');
  assert.deepEqual(activity.metadata, {}); // no label/token/code

  // The device row itself legitimately stores the label (management UI needs
  // it) but never the raw pairing token/code.
  const deviceInsert = calls.deviceInserts[0];
  assert.equal(deviceInsert.label, 'iPad keuken');
  assert.equal(deviceInsert.token_hash.length, 64);
  assert.ok(!('token' in deviceInsert));
  assert.ok(!('code' in deviceInsert));
});

test('device-activate: unknown token → generic 401, no device or activity created', async () => {
  const { fixture, calls } = activateFixture({ pairingFound: false });
  setFixture(fixture);
  const res = await activateHandler(makeEvent({ body: { token: 'no-such-token' } }));
  assert.equal(res.statusCode, 401);
  assert.deepEqual(JSON.parse(res.body), { error: 'activation_failed' });
  assert.equal(calls.deviceInserts.length, 0);
  assert.equal(calls.activityInserts.length, 0);
});

test('device-activate: concurrent double-consume race → generic 401, not a 500 or a second device', async () => {
  const { fixture, calls } = activateFixture({ pairingFound: true, alreadyConsumedRace: true });
  setFixture(fixture);
  const res = await activateHandler(makeEvent({ body: { token: 'a-valid-looking-token-value' } }));
  assert.equal(res.statusCode, 401);
  assert.equal(calls.deviceInserts.length, 0);
});

test('device-activate: activity write failure after device creation → 500, generic body (device already exists but is unaudited)', async () => {
  const { fixture, calls } = activateFixture({
    pairingFound: true,
    activityError: { code: '500XX', message: 'insert failed' },
  });
  setFixture(fixture);
  const res = await activateHandler(makeEvent({ body: { token: 'a-valid-looking-token-value' } }));
  assert.equal(res.statusCode, 500);
  assert.deepEqual(JSON.parse(res.body), { error: 'activation_failed' });
  assert.equal(calls.deviceInserts.length, 1); // the device row was created
});

test('device-activate: neither token nor code supplied → 400', async () => {
  const { fixture } = activateFixture({ pairingFound: true });
  setFixture(fixture);
  const res = await activateHandler(makeEvent({ body: {} }));
  assert.equal(res.statusCode, 400);
});
