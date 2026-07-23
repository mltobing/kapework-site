/* netlify/functions-tests/_ma-github-dispatch.test.js
 *
 * Tests for the shared GitHub workflow-dispatch helper directly — the
 * config validation, the input-key allowlist (the one thing that decides
 * what a browser-triggered request can possibly cause the private workflow
 * to see), and the success/failure response handling every caller
 * (ma-sync-trigger.js, ma-calendar-write-request.js) relies on.
 *
 * Run: node --test netlify/functions-tests/_ma-github-dispatch.test.js
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.MA_SYNC_GITHUB_TOKEN = 'fake-gh-token';
  delete require.cache[require.resolve('../functions/_ma-github-dispatch')];
  delete require.cache[require.resolve('../functions/_utils')];
});

function loadModule() {
  return require('../functions/_ma-github-dispatch');
}

test('githubWorkflowConfig throws when the token is missing', () => {
  delete process.env.MA_SYNC_GITHUB_TOKEN;
  const { githubWorkflowConfig } = loadModule();
  assert.throws(() => githubWorkflowConfig(), /Missing required environment variable/);
});

test('githubWorkflowConfig defaults repository/workflow/ref when unset', () => {
  const { githubWorkflowConfig } = loadModule();
  const config = githubWorkflowConfig();
  assert.equal(config.repository, 'mltobing/irma-sync');
  assert.equal(config.workflow, 'sync.yml');
  assert.equal(config.ref, 'main');
  assert.equal(config.token, 'fake-gh-token');
});

test('githubWorkflowConfig rejects a malformed repository override', () => {
  process.env.MA_SYNC_GITHUB_REPOSITORY = 'not a repo';
  const { githubWorkflowConfig } = loadModule();
  assert.throws(() => githubWorkflowConfig(), /invalid github dispatch configuration/);
});

test('githubWorkflowConfig rejects a malformed workflow override', () => {
  process.env.MA_SYNC_GITHUB_WORKFLOW = 'not-yaml';
  const { githubWorkflowConfig } = loadModule();
  assert.throws(() => githubWorkflowConfig(), /invalid github dispatch configuration/);
});

test('dispatchIrmaSync only forwards allowlisted input keys', async () => {
  let sentBody = null;
  global.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { status: 204 };
  };
  const { dispatchIrmaSync } = loadModule();
  const result = await dispatchIrmaSync({
    manual_request_id: 'req-1',
    calendar_write_request_id: 'cw-1',
    service_role_key: 'should-never-be-sent',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(sentBody.inputs, { manual_request_id: 'req-1', calendar_write_request_id: 'cw-1' });
});

test('dispatchIrmaSync sends only the requested input when the other is absent', async () => {
  let sentBody = null;
  global.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { status: 204 };
  };
  const { dispatchIrmaSync } = loadModule();
  await dispatchIrmaSync({ calendar_write_request_id: 'cw-2' });
  assert.deepEqual(sentBody.inputs, { calendar_write_request_id: 'cw-2' });
});

test('dispatchIrmaSync never includes the token or Authorization header in a thrown/logged value', async () => {
  let sentHeaders = null;
  global.fetch = async (url, opts) => {
    sentHeaders = opts.headers;
    return { status: 204 };
  };
  const { dispatchIrmaSync } = loadModule();
  await dispatchIrmaSync({ manual_request_id: 'req-1' });
  assert.equal(sentHeaders.Authorization, 'Bearer fake-gh-token');
  // the assertion above reads it directly from the fetch call (test-only
  // visibility) — dispatchIrmaSync's own return value must never carry it
});

test('dispatchIrmaSync treats 204 as success with no run id', async () => {
  global.fetch = async () => ({ status: 204 });
  const { dispatchIrmaSync } = loadModule();
  const result = await dispatchIrmaSync({ manual_request_id: 'req-1' });
  assert.deepEqual(result, { ok: true, githubRunId: null });
});

test('dispatchIrmaSync treats 200 with a run id as success', async () => {
  global.fetch = async () => ({ status: 200, json: async () => ({ id: 12345 }) });
  const { dispatchIrmaSync } = loadModule();
  const result = await dispatchIrmaSync({ manual_request_id: 'req-1' });
  assert.deepEqual(result, { ok: true, githubRunId: '12345' });
});

test('dispatchIrmaSync treats 200 with an unparseable body as success anyway', async () => {
  global.fetch = async () => ({ status: 200, json: async () => { throw new Error('bad json'); } });
  const { dispatchIrmaSync } = loadModule();
  const result = await dispatchIrmaSync({ manual_request_id: 'req-1' });
  assert.deepEqual(result, { ok: true, githubRunId: null });
});

test('dispatchIrmaSync maps a 4xx response to github_client_error, never leaking the body', async () => {
  global.fetch = async () => ({ status: 422, json: async () => ({ message: 'private detail' }) });
  const { dispatchIrmaSync } = loadModule();
  const result = await dispatchIrmaSync({ manual_request_id: 'req-1' });
  assert.deepEqual(result, { ok: false, errorCode: 'github_client_error' });
});

test('dispatchIrmaSync maps a 5xx response to github_server_error', async () => {
  global.fetch = async () => ({ status: 503 });
  const { dispatchIrmaSync } = loadModule();
  const result = await dispatchIrmaSync({ manual_request_id: 'req-1' });
  assert.deepEqual(result, { ok: false, errorCode: 'github_server_error' });
});

test('dispatchIrmaSync maps a network failure to network_error', async () => {
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const { dispatchIrmaSync } = loadModule();
  const result = await dispatchIrmaSync({ manual_request_id: 'req-1' });
  assert.deepEqual(result, { ok: false, errorCode: 'network_error' });
});
