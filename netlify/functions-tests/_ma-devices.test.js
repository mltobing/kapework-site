/* Tests for the shared trusted-device server helpers — verifyOwner()'s
 * authorization contract (dependency-injected, no fake network needed) and
 * the CORS origin allowlist. Kept OUT of netlify/functions/ (test-only).
 * Run: node --test netlify/functions-tests/_ma-devices.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// _ma-devices.js requires @supabase/supabase-js at module scope (for
// serviceClient(), unused by the functions under test here) — fake it so
// this file doesn't need the real package installed.
const { installFakeSupabase } = require('./_fake-supabase');
installFakeSupabase();

const { verifyOwner, corsHeaders, json } = require('../functions/_ma-devices');

const FAMILY_ID = 'family-syn-0001';
const OWNER_ID = 'user-owner-0001';

function fakeSupabase({ authOk = true, membershipRow = null, membershipError = null }) {
  return {
    auth: {
      getUser: async (token) => {
        if (!authOk) return { data: { user: null }, error: new Error('invalid') };
        return { data: { user: { id: OWNER_ID } }, error: null };
      },
    },
    from(table) {
      assert.equal(table, 'ma_family_members');
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: membershipRow, error: membershipError }),
              }),
            }),
          }),
        }),
      };
    },
  };
}

// ─── verifyOwner ────────────────────────────────────────────────────────────

test('verifyOwner: missing bearer header → 401, no DB call attempted', async () => {
  const supabase = fakeSupabase({});
  const result = await verifyOwner(supabase, undefined, FAMILY_ID);
  assert.deepEqual(result, { ok: false, status: 401 });
});

test('verifyOwner: missing familyId → 401', async () => {
  const supabase = fakeSupabase({});
  const result = await verifyOwner(supabase, 'Bearer sometoken', null);
  assert.deepEqual(result, { ok: false, status: 401 });
});

test('verifyOwner: invalid token → 401', async () => {
  const supabase = fakeSupabase({ authOk: false });
  const result = await verifyOwner(supabase, 'Bearer bad-token', FAMILY_ID);
  assert.deepEqual(result, { ok: false, status: 401 });
});

test('verifyOwner: valid token, owner row found → ok:true with the userId', async () => {
  const supabase = fakeSupabase({ membershipRow: { user_id: OWNER_ID } });
  const result = await verifyOwner(supabase, 'Bearer valid-token', FAMILY_ID);
  assert.deepEqual(result, { ok: true, userId: OWNER_ID });
});

test('verifyOwner: valid token, no matching owner row (member/caregiver/unrelated) → 403', async () => {
  const supabase = fakeSupabase({ membershipRow: null });
  const result = await verifyOwner(supabase, 'Bearer valid-token', FAMILY_ID);
  assert.deepEqual(result, { ok: false, status: 403 });
});

test('verifyOwner: a membership query error → 500, not a false-positive authorization', async () => {
  const supabase = fakeSupabase({ membershipError: new Error('db down') });
  const result = await verifyOwner(supabase, 'Bearer valid-token', FAMILY_ID);
  assert.deepEqual(result, { ok: false, status: 500 });
});

test('verifyOwner: an authorization header missing the "Bearer " prefix is rejected', async () => {
  const supabase = fakeSupabase({ membershipRow: { user_id: OWNER_ID } });
  const result = await verifyOwner(supabase, 'valid-token-no-prefix', FAMILY_ID);
  assert.deepEqual(result, { ok: false, status: 401 });
});

// ─── corsHeaders ────────────────────────────────────────────────────────────

test('corsHeaders: the production origin is echoed back', () => {
  const h = corsHeaders('https://ma.kapework.com');
  assert.equal(h['Access-Control-Allow-Origin'], 'https://ma.kapework.com');
});

test('corsHeaders: a kapework.com subdomain is echoed back', () => {
  const h = corsHeaders('https://vandaag.kapework.com');
  assert.equal(h['Access-Control-Allow-Origin'], 'https://vandaag.kapework.com');
});

test('corsHeaders: an unrelated/attacker origin falls back to MA_ORIGIN, never reflected', () => {
  const h = corsHeaders('https://evil-phishing-site.example');
  assert.equal(h['Access-Control-Allow-Origin'], 'https://ma.kapework.com');
});

test('corsHeaders: a kapework.com lookalike domain (suffix match, not subdomain) is rejected', () => {
  const h = corsHeaders('https://notkapework.com.evil.example');
  assert.equal(h['Access-Control-Allow-Origin'], 'https://ma.kapework.com');
});

test('corsHeaders: plain http (not https) kapework.com is rejected', () => {
  const h = corsHeaders('http://ma.kapework.com');
  assert.equal(h['Access-Control-Allow-Origin'], 'https://ma.kapework.com');
});

// ─── json() response shape ──────────────────────────────────────────────────

test('json(): sets no-store cache headers and the given status code', () => {
  const res = json(403, { error: 'not_authorized' }, 'https://ma.kapework.com');
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { error: 'not_authorized' });
});
