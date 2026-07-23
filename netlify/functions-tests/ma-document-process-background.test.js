/* netlify/functions-tests/ma-document-process-background.test.js
 *
 * Tests for the Document Inbox Netlify Background Function: owner
 * re-verification, atomic single-claim, success/failure status transitions,
 * and the logging-safety contract. processDocumentImport() itself is
 * exercised in _ma-document-processing.test.js — here we only check that
 * the background handler wires the claim/owner/error-mapping correctly
 * around it.
 *
 * Run: node --test netlify/functions-tests/ma-document-process-background.test.js
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeSupabase, setFixture } = require('./_fake-supabase');
installFakeSupabase();

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
process.env.MA_DEVICE_TOKEN_PEPPER = 'fake-pepper';
process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';

const handler = require('../functions/ma-document-process-background').handler;

const FAMILY_ID = 'family-doc-0001';
const IMPORT_ID = 'import-0001';
const OWNER_ID = 'user-owner-0001';
const MEMBER_ID = 'user-member-0001';

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
    if (familyIdFilter !== FAMILY_ID) return { data: null, error: null };
    const role = ROSTER[userIdFilter];
    if (!role || role !== 'owner') return { data: null, error: null };
    return { data: { user_id: userIdFilter }, error: null };
  };
}

function makeEvent(userId, body = { familyId: FAMILY_ID, importId: IMPORT_ID }) {
  return { headers: { authorization: `Bearer ${userId}` }, body: JSON.stringify(body) };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.claimSucceeds=true] — whether the atomic
 *   queued→processing update finds a matching row
 * @param {object|Error} [opts.processingOutcome] — either a result object
 *   processDocumentImport() should "return" (via a fixture-driven success)
 *   or an Error it should "throw" — simulated by controlling what the
 *   downstream Anthropic/token-count fetch mock returns.
 */
function buildFixture({ claimSucceeds = true } = {}) {
  const calls = { claimAttempts: 0, importUpdates: [] };
  const claimedRow = {
    id: IMPORT_ID, family_id: FAMILY_ID, audience: 'family', source_type: 'pasted_text',
    document_date: null, status: 'processing',
  };
  const fixture = {
    auth: authFixture(OWNER_ID),
    storage: {
      'ma-imports': async () => ({ data: { arrayBuffer: async () => Buffer.from('hello').buffer }, error: null }),
    },
    tables: {
      ma_family_members: membershipTableHandler(),
      ma_document_imports: (state) => {
        if (state.op === 'update' && state.filters.some((f) => f.col === 'status' && f.val === 'queued')) {
          calls.claimAttempts += 1;
          if (!claimSucceeds) return { data: null, error: null };
          return { data: claimedRow, error: null };
        }
        if (state.op === 'update') {
          calls.importUpdates.push(state.payload);
          return { data: null, error: null };
        }
        return { data: [], error: null };
      },
      ma_document_import_files: () => ({ data: [{ id: 'f1', import_id: IMPORT_ID, family_id: FAMILY_ID, sequence_no: 1, object_path: 'x', mime_type: 'text/plain', size_bytes: 5 }], error: null }),
      ma_document_candidates: (state) => {
        if (state.op === 'delete' || state.op === 'insert') return { data: null, error: null };
        return { data: [], error: null };
      },
    },
  };
  return { fixture, calls };
}

beforeEach(() => {
  global.fetch = async (url) => {
    if (String(url).includes('count_tokens')) return { ok: true, status: 200, json: async () => ({ input_tokens: 10 }) };
    return {
      ok: true, status: 200,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ document_summary: 's', document_warnings: [], candidates: [] }) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    };
  };
});

test('owner is verified again (non-owner request is a quiet no-op, no claim attempted)', async () => {
  const { fixture, calls } = buildFixture();
  setFixture(fixture);
  await handler(makeEvent(MEMBER_ID));
  assert.equal(calls.claimAttempts, 0);
});

test('only a still-queued row is claimed (duplicate invocation is a silent no-op)', async () => {
  const { fixture, calls } = buildFixture({ claimSucceeds: false });
  setFixture(fixture);
  const res = await handler(makeEvent(OWNER_ID));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.claimAttempts, 1);
  assert.equal(calls.importUpdates.length, 0);
});

test('success path claims the row and marks it ready, no ma_posts created', async () => {
  const { fixture, calls } = buildFixture();
  setFixture(fixture);
  const res = await handler(makeEvent(OWNER_ID));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.claimAttempts, 1);
  const readyUpdate = calls.importUpdates.find((u) => u.status === 'ready');
  assert.ok(readyUpdate);
});

test('a controlled failure (e.g. token ceiling) becomes status=failed with the safe code', async () => {
  global.fetch = async (url) => {
    if (String(url).includes('count_tokens')) return { ok: true, status: 200, json: async () => ({ input_tokens: 999999999 }) };
    throw new Error('should not reach the Messages call');
  };
  const { fixture, calls } = buildFixture();
  setFixture(fixture);
  await handler(makeEvent(OWNER_ID));
  const failUpdate = calls.importUpdates.find((u) => u.status === 'failed');
  assert.ok(failUpdate);
  assert.equal(failUpdate.error_code, 'too_many_tokens');
});

test('an unexpected failure (thrown without a controlled errorCode) becomes server_error', async () => {
  global.fetch = async () => { throw new Error('kaboom'); };
  const { fixture, calls } = buildFixture();
  // Force an unexpected throw: make the candidate insert/delete path blow up
  // by having ma_document_import_files return malformed data that trips an
  // uncontrolled exception deep in the worker (missing required fields).
  fixture.tables.ma_document_import_files = () => { throw new Error('boom - unexpected db driver error'); };
  setFixture(fixture);
  const res = await handler(makeEvent(OWNER_ID));
  assert.equal(res.statusCode, 200); // background handler always 200s the invocation itself
  const failUpdate = calls.importUpdates.find((u) => u.status === 'failed');
  assert.ok(failUpdate);
  assert.equal(failUpdate.error_code, 'server_error');
  assert.equal('message' in failUpdate, false);
});

test('no private content reaches console output', async () => {
  const { fixture } = buildFixture();
  setFixture(fixture);
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    await handler(makeEvent(OWNER_ID));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const joined = logs.join('\n');
  assert.equal(joined.includes('hello'), false);
  assert.equal(joined.toLowerCase().includes('bearer'), false);
});
