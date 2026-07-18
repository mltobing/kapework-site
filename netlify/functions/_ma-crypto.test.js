/* Tests for the dependency-free trusted-device crypto/cookie primitives.
 * Run: node --test netlify/functions/_ma-crypto.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  hashSecret, randomToken, randomCode, parseCookies, deviceCookie, DEVICE_COOKIE,
} = require('./_ma-crypto');

test('hashSecret is deterministic, pepper-dependent, and 64 hex chars', () => {
  const a = hashSecret('token-abc', 'pepper1');
  assert.equal(a, hashSecret('token-abc', 'pepper1'));      // stable
  assert.notEqual(a, hashSecret('token-abc', 'pepper2'));   // pepper matters
  assert.notEqual(a, hashSecret('token-abd', 'pepper1'));   // input matters
  assert.match(a, /^[0-9a-f]{64}$/);                        // sha-256 hex
});

test('randomToken is URL-safe, long, and unique', () => {
  const t = randomToken(32);
  assert.match(t, /^[A-Za-z0-9_-]+$/);           // base64url, no +/=
  assert.ok(t.length >= 43);
  assert.notEqual(randomToken(32), randomToken(32));
});

test('randomCode is a zero-padded 6-digit string', () => {
  for (let i = 0; i < 200; i++) {
    assert.match(randomCode(), /^\d{6}$/);
  }
});

test('parseCookies reads a specific cookie among several', () => {
  const jar = parseCookies(`a=1; ${DEVICE_COOKIE}=raw-token-xyz; b=2`);
  assert.equal(jar[DEVICE_COOKIE], 'raw-token-xyz');
  assert.equal(jar.a, '1');
  assert.equal(parseCookies('')[DEVICE_COOKIE], undefined);
});

test('deviceCookie carries all required security flags', () => {
  const c = deviceCookie('raw-token-xyz');
  assert.match(c, /^ma_today_device=raw-token-xyz;/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Strict/);
  assert.match(c, /Path=\//);
  assert.match(c, /Max-Age=31536000/); // one year
});
