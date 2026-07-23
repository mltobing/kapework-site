/* netlify/functions-tests/ma-document-process.test.js
 *
 * Tests for the owner-only Document Inbox start/restart Netlify Function
 * against a fake Supabase client (see _fake-supabase.js) — no network calls;
 * the background-function dispatch itself is exercised via a mocked
 * global.fetch (same pattern as ma-sync-trigger.test.js's GitHub dispatch
 * mock).
 *
 * Run: node --test netlify/functions-tests/ma-document-process.test.js
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeSupabase, setFixture } = require('./_fake-supabase');
installFakeSupabase();

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
process.env.MA_DEVICE_TOKEN_PEPPER = 'fake-pepper';
process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';
process.env.URL = 'https://ma.kapework.com';

const handler = require('../functions/ma-document-process').handler;

const FAMILY_ID = 'family-doc-0001';
const IMPORT_ID = 'import-0001';
const OWNER_ID = 'user-owner-0001';
const MEMBER_ID = 'user-member-0001';
const CAREGIVER_ID = 'user-caregiver-0001';
const UNRELATED_ID = 'user-unrelated-0001';

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

function buildFixture({
  userId, importRow = { id: IMPORT_ID, family_id: FAMILY_ID, status: 'uploaded' },
  fileRows = [{ id: 'file-1' }],
}) {
  const calls = { importUpdates: [] };
  const fixture = {
    auth: authFixture(userId),
    tables: {
      ma_family_members: membershipTableHandler(),
      ma_document_imports: (state) => {
        if (state.op === 'update') {
          calls.importUpdates.push(state.payload);
          return { data: null, error: null };
        }
        return { data: importRow, error: null };
      },
      ma_document_import_files: () => ({ data: fileRows, error: null }),
    },
  };
  return { fixture, calls };
}

let lastFetchCall = null;
function mockBackground(status = 202) {
  global.fetch = async (url, opts) => {
    lastFetchCall = { url, opts };
    return { status, json: async () => ({}) };
  };
}

beforeEach(() => {
  mockBackground(202);
  lastFetchCall = null;
});

// ─── Method / config / rate limit ────────────────────────────────────────────

test('OPTIONS preflight → 204 with CORS headers', async () => {
  const res = await handler(makeEvent({ method: 'OPTIONS' }));
  assert.equal(res.statusCode, 204);
});

test('GET is not allowed → 405', async () => {
  const res = await handler(makeEvent({ method: 'GET', auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 405);
});

test('missing ANTHROPIC_API_KEY → 503 config_error', async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
    assert.equal(res.statusCode, 503);
  } finally {
    process.env.ANTHROPIC_API_KEY = original;
  }
});

test('missing/bad JSON body → 400', async () => {
  const res = await handler({ httpMethod: 'POST', headers: { origin: 'https://ma.kapework.com', authorization: `Bearer ${OWNER_ID}`, 'x-forwarded-for': uniqueIp() }, body: 'not-json' });
  assert.equal(res.statusCode, 400);
});

test('missing familyId/importId → 400', async () => {
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID } }));
  assert.equal(res.statusCode, 400);
});

// ─── Authorization ──────────────────────────────────────────────────────────

test('non-owner (member) → 403', async () => {
  const { fixture } = buildFixture({ userId: MEMBER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: MEMBER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 403);
});

test('caregiver (no ma_family_members row) → 403', async () => {
  const { fixture } = buildFixture({ userId: CAREGIVER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: CAREGIVER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 403);
});

test('unrelated signed-in user → 403', async () => {
  const { fixture } = buildFixture({ userId: UNRELATED_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: UNRELATED_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 403);
});

test('no Authorization header → 401', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 401);
});

// ─── State machine ────────────────────────────────────────────────────────────

test('owner starting an "uploaded" import → 202 queued, background dispatched with same bearer + ids', async () => {
  const { fixture, calls } = buildFixture({ userId: OWNER_ID, importRow: { id: IMPORT_ID, family_id: FAMILY_ID, status: 'uploaded' } });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 202);
  assert.equal(JSON.parse(res.body).status, 'queued');
  assert.ok(calls.importUpdates.some((u) => u.status === 'queued'));
  assert.ok(lastFetchCall.url.includes('ma-document-process-background'));
  assert.equal(lastFetchCall.opts.headers.authorization, `Bearer ${OWNER_ID}`);
  const dispatchedBody = JSON.parse(lastFetchCall.opts.body);
  assert.equal(dispatchedBody.familyId, FAMILY_ID);
  assert.equal(dispatchedBody.importId, IMPORT_ID);
});

test('owner starting a "failed" import (retry) → 202 queued', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID, importRow: { id: IMPORT_ID, family_id: FAMILY_ID, status: 'failed' } });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 202);
});

test('wrong family (import belongs to a different family) → not started', async () => {
  const { fixture, calls } = buildFixture({ userId: OWNER_ID, importRow: { id: IMPORT_ID, family_id: 'other-family', status: 'uploaded' } });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.notEqual(res.statusCode, 202);
  assert.equal(calls.importUpdates.length, 0);
});

test('no source files → 400 source_missing, not queued', async () => {
  const { fixture, calls } = buildFixture({ userId: OWNER_ID, fileRows: [] });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'source_missing');
  assert.equal(calls.importUpdates.length, 0);
});

for (const status of ['queued', 'processing', 'ready', 'completed', 'duplicate', 'cancelled']) {
  test(`"${status}" import cannot be (re)started — reports current state instead`, async () => {
    const { fixture, calls } = buildFixture({ userId: OWNER_ID, importRow: { id: IMPORT_ID, family_id: FAMILY_ID, status } });
    setFixture(fixture);
    const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).status, status);
    assert.equal(calls.importUpdates.length, 0);
    assert.equal(lastFetchCall, null);
  });
}

// ─── Dispatch failure handling ────────────────────────────────────────────────

test('background dispatch rejected (non-202/200) → controlled dispatch_failed, import marked failed', async () => {
  mockBackground(500);
  const { fixture, calls } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, 'dispatch_failed');
  const failUpdate = calls.importUpdates.find((u) => u.error_code === 'dispatch_failed');
  assert.ok(failUpdate);
  assert.equal(failUpdate.status, 'failed');
});

test('background dispatch network failure → controlled dispatch_failed', async () => {
  global.fetch = async () => { throw new Error('network down'); };
  const { fixture, calls } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(res.statusCode, 502);
  assert.ok(calls.importUpdates.some((u) => u.error_code === 'dispatch_failed'));
});

// ─── No sensitive data leaks ───────────────────────────────────────────────────

test('response never echoes the Authorization token or private payload', async () => {
  const { fixture } = buildFixture({ userId: OWNER_ID });
  setFixture(fixture);
  const res = await handler(makeEvent({ auth: OWNER_ID, body: { familyId: FAMILY_ID, importId: IMPORT_ID } }));
  assert.equal(JSON.stringify(res).includes(OWNER_ID), false);
});
