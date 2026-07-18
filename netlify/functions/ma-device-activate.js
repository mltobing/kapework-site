/* netlify/functions/ma-device-activate.js
 *
 * Anonymous, but requires possession of a valid unconsumed pairing (high-entropy
 * link token OR the fallback 6-digit code). On success it mints a fresh device
 * token, stores only its hash, and sets the HttpOnly device cookie.
 *
 * Defenses: strict per-IP rate limit (bounds code brute force), 15-minute pairing
 * expiry, and atomic single-consumption (a pairing can never be consumed twice).
 * All failures return the same calm generic error — never reveal whether a token
 * or code exists.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MA_DEVICE_TOKEN_PEPPER
 */

const { checkRateLimit, getClientIp, requireEnvVars, sanitiseString, logError } = require('./_utils');
const {
  DEVICE_TTL_MS, hashSecret, randomToken, serviceClient, deviceCookie, json, corsHeaders,
} = require('./_ma-devices');

// Deliberately tight: at most 6 activation attempts/minute/IP. With a 15-minute
// window that caps a 6-digit brute force far below the 1,000,000 keyspace.
const RATE_LIMIT = 6;
const GENERIC_FAIL = { error: 'activation_failed' };

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);

  if (!checkRateLimit(getClientIp(event), RATE_LIMIT)) {
    return json(429, GENERIC_FAIL, origin);
  }

  try {
    requireEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MA_DEVICE_TOKEN_PEPPER');
  } catch (err) {
    console.error('[ma-device-activate] config error:', err.message);
    return json(503, { error: 'service_unavailable' }, origin);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, GENERIC_FAIL, origin); }

  const rawToken = body.token ? sanitiseString(String(body.token), 200) : null;
  const rawCode  = body.code  ? sanitiseString(String(body.code), 12)   : null;
  if (!rawToken && !rawCode) return json(400, GENERIC_FAIL, origin);

  const supabase = serviceClient();
  const pepper   = process.env.MA_DEVICE_TOKEN_PEPPER;

  // 1. Locate a candidate unconsumed pairing by the presented secret's hash.
  const column = rawToken ? 'link_token_hash' : 'code_hash';
  const hash   = hashSecret(rawToken || rawCode, pepper);

  const { data: candidate, error: findErr } = await supabase
    .from('ma_device_pairings')
    .select('id')
    .eq(column, hash)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (findErr) {
    console.error('[ma-device-activate] lookup error:', findErr.message);
    return json(500, GENERIC_FAIL, origin);
  }
  if (!candidate) return json(401, GENERIC_FAIL, origin);

  // 2. Atomically consume it. The WHERE clause guarantees exactly one winner even
  //    under concurrent requests — a second attempt returns no row.
  const { data: consumed, error: consumeErr } = await supabase
    .from('ma_device_pairings')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .is('consumed_at', null)
    .select('family_id, requested_label, created_by')
    .maybeSingle();

  if (consumeErr) {
    console.error('[ma-device-activate] consume error:', consumeErr.message);
    return json(500, GENERIC_FAIL, origin);
  }
  if (!consumed) return json(401, GENERIC_FAIL, origin); // lost the race → already consumed

  // 3. Mint the device token; store only its hash.
  const deviceToken = randomToken(32);
  const { error: devErr } = await supabase.from('ma_trusted_devices').insert({
    family_id:  consumed.family_id,
    label:      consumed.requested_label || 'Apparaat',
    token_hash: hashSecret(deviceToken, pepper),
    created_by: consumed.created_by,
    expires_at: new Date(Date.now() + DEVICE_TTL_MS).toISOString(),
  });

  if (devErr) {
    console.error('[ma-device-activate] device insert error:', devErr.message);
    await logError(supabase, 'ma-device-activate', devErr.message, {});
    return json(500, GENERIC_FAIL, origin);
  }

  // 4. Set the HttpOnly cookie; never return the raw token in the body.
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
    },
    multiValueHeaders: { 'Set-Cookie': [deviceCookie(deviceToken)] },
    body: JSON.stringify({ ok: true }),
  };
};
