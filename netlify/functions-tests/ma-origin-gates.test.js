/* Browser-origin boundaries for private Ma functions. Synthetic data only. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeSupabase, setFixture } = require('./_fake-supabase');
installFakeSupabase();

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-key';
process.env.MA_DEVICE_TOKEN_PEPPER = 'synthetic-pepper';
process.env.CONTEXT = 'production';
delete process.env.NETLIFY_DEV;

const names = ['ma-today', 'ma-device-activate', 'ma-pairing-create', 'ma-devices-list',
  'ma-device-revoke', 'ma-sync-trigger', 'ma-calendar-suggest', 'ma-calendar-write-request',
  'ma-document-process', 'ma-document-process-background'];
const handlers = Object.fromEntries(names.map(name => [name, require(`../functions/${name}`).handler]));

function event(method, origin) {
  return { httpMethod: method,
    headers: { ...(origin === undefined ? {} : { origin }),
      authorization: 'Bearer synthetic-owner-token', cookie: 'ma_today_device=synthetic-device-token',
      'x-nf-client-connection-ip': '192.0.2.10' },
    body: JSON.stringify({ familyId: 'synthetic-family', importId: 'synthetic-import',
      token: 'synthetic-pairing', deviceId: 'synthetic-device' }) };
}

for (const name of names) {
  test(`${name}: sibling-origin request is rejected before auth or database work`, async () => {
    let calls = 0;
    setFixture({ auth: async () => { calls++; throw new Error('Unexpected auth work'); },
      tables: new Proxy({}, { get() { calls++; throw new Error('Unexpected database work'); } }) });
    const result = await handlers[name](event(name === 'ma-today' ? 'GET' : 'POST', 'https://create.kapework.com'));
    assert.equal(result.statusCode, 403);
    assert.equal(JSON.parse(result.body).error, 'origin_not_allowed');
    assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(result.headers['Access-Control-Allow-Credentials'], undefined);
    assert.equal(calls, 0);
  });
}

test('cookie endpoint rejects sibling preflight and opaque browser origins', async () => {
  for (const origin of ['https://create.kapework.com', 'null', 'https://ma.kapework.com.evil.example']) {
    assert.equal((await handlers['ma-today'](event('OPTIONS', origin))).statusCode, 403);
    assert.equal((await handlers['ma-device-activate'](event('POST', origin))).statusCode, 403);
  }
});

test('Ma browser preflight keeps all ordinary endpoint flows available', async () => {
  for (const name of names.filter(name => name !== 'ma-document-process-background')) {
    const result = await handlers[name](event('OPTIONS', 'https://ma.kapework.com'));
    assert.equal(result.statusCode, 204, name);
    assert.equal(result.headers['Access-Control-Allow-Origin'], 'https://ma.kapework.com');
    assert.equal(result.headers['Access-Control-Allow-Credentials'], 'true');
  }
});

test('same-origin GET without Origin still reaches the paired-device credential check', async () => {
  let lookups = 0;
  setFixture({ tables: { ma_trusted_devices: () => { lookups++; return { data: null, error: null }; } } });
  const result = await handlers['ma-today'](event('GET', undefined));
  assert.equal(result.statusCode, 401); // Unknown synthetic device, not an origin denial.
  assert.equal(JSON.parse(result.body).error, 'unauthorized');
  assert.equal(lookups, 1);
  assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
});

test('native activation without Origin still checks the presented pairing secret', async () => {
  let lookups = 0;
  setFixture({ tables: { ma_device_pairings: () => { lookups++; return { data: null, error: null }; } } });
  const result = await handlers['ma-device-activate'](event('POST', undefined));
  assert.equal(result.statusCode, 401);
  assert.equal(JSON.parse(result.body).error, 'activation_failed');
  assert.equal(lookups, 1);
});
