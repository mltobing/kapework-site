/* netlify/functions/_ma-devices.js
 *
 * Shared server-only helpers for the trusted-device endpoints.
 *
 * Security model:
 *   - Only SHA-256(secret + pepper) is ever stored or compared. Raw tokens/codes
 *     live only in transit and in the HttpOnly cookie — never in the DB, JSON,
 *     logs, or any browser-readable storage.
 *   - The device credential is an HttpOnly + Secure + SameSite=Strict, same-origin
 *     cookie for ma.kapework.com.
 *   - All DB access uses the service-role key (RLS default-denies these tables to
 *     browser roles). Family *ownership* (not just membership) is verified
 *     server-side before any administrative device action.
 *
 * Logging rule: never log tokens, codes, labels, names, or family data — counts,
 * statuses, and opaque ids only.
 */

const { createClient } = require('@supabase/supabase-js');
const {
  DEVICE_COOKIE, MA_ORIGIN, DEVICE_TTL_MS, PAIRING_TTL_MS,
  hashSecret, randomToken, randomCode, parseCookies, deviceCookie,
} = require('./_ma-crypto');

// ── Supabase service client ────────────────────────────────────────────────────

function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Auth: validate a Supabase access token and confirm family ownership ────────

/**
 * Returns { ok:true, userId } when the bearer token is a valid Supabase session
 * whose user is an `owner` of `familyId`; otherwise { ok:false, status }.
 * Trusted-device administration is owner-only (see apps/ma/README.md) — a plain
 * family member no longer passes this check. Uses the service client to both
 * validate the JWT and read membership (itself RLS-protected, hence service role).
 */
async function verifyOwner(supabase, authHeader, familyId) {
  const token = /^Bearer\s+(.+)$/i.exec(String(authHeader || ''))?.[1];
  if (!token || !familyId) return { ok: false, status: 401 };

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, status: 401 };
  const userId = userData.user.id;

  const { data: membership, error: memErr } = await supabase
    .from('ma_family_members')
    .select('user_id')
    .eq('family_id', familyId)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .maybeSingle();
  if (memErr) return { ok: false, status: 500 };
  if (!membership) return { ok: false, status: 403 };

  return { ok: true, userId };
}

// ── Response helpers ────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const safe = /^https:\/\/([\w-]+\.)?kapework\.com$/.test(origin || '') ? origin : MA_ORIGIN;
  return {
    'Access-Control-Allow-Origin':      safe,
    'Access-Control-Allow-Methods':     'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary':                             'Origin',
  };
}

function json(statusCode, obj, origin, extraHeaders) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(obj),
  };
}

module.exports = {
  DEVICE_COOKIE,
  MA_ORIGIN,
  DEVICE_TTL_MS,
  PAIRING_TTL_MS,
  hashSecret,
  randomToken,
  randomCode,
  serviceClient,
  parseCookies,
  deviceCookie,
  verifyOwner,
  corsHeaders,
  json,
};
