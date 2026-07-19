/* netlify/functions/ma-pairing-create.js
 *
 * Authenticated family member creates a one-time device pairing.
 * Returns the raw activation link + code exactly ONCE; only hashes are stored.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MA_DEVICE_TOKEN_PEPPER
 */

const { checkRateLimit, getClientIp, requireEnvVars, sanitiseString, logError } = require('./_utils');
const {
  MA_ORIGIN, PAIRING_TTL_MS, hashSecret, randomToken, randomCode,
  serviceClient, verifyOwner, json, corsHeaders,
} = require('./_ma-devices');

const RATE_LIMIT = 10; // pairings/minute/IP

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);

  if (!checkRateLimit(getClientIp(event), RATE_LIMIT)) {
    return json(429, { error: 'rate_limited' }, origin);
  }

  try {
    requireEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MA_DEVICE_TOKEN_PEPPER');
  } catch (err) {
    console.error('[ma-pairing-create] config error:', err.message);
    return json(503, { error: 'service_unavailable' }, origin);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad_request' }, origin); }

  const familyId = sanitiseString(String(body.familyId || ''), 100);
  const label = sanitiseString(String(body.label || ''), 80) || 'Apparaat';
  if (!familyId) return json(400, { error: 'bad_request' }, origin);

  const supabase = serviceClient();

  const auth = await verifyOwner(supabase, event.headers['authorization'], familyId);
  if (!auth.ok) return json(auth.status, { error: 'not_authorized' }, origin);

  const pepper       = process.env.MA_DEVICE_TOKEN_PEPPER;
  const linkToken    = randomToken(32);
  const code         = randomCode();
  const expiresAt    = new Date(Date.now() + PAIRING_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from('ma_device_pairings')
    .insert({
      family_id:       familyId,
      created_by:      auth.userId,
      requested_label: label,
      link_token_hash: hashSecret(linkToken, pepper),
      code_hash:       hashSecret(code, pepper),
      expires_at:      expiresAt,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[ma-pairing-create] insert error:', error.message);
    await logError(supabase, 'ma-pairing-create', error.message, { familyId });
    return json(500, { error: 'server_error' }, origin);
  }

  // Returned once. The raw token/code are never logged or stored.
  return json(200, {
    pairingId:     data.id,
    activationUrl: `${MA_ORIGIN}/vandaag/koppelen#token=${linkToken}`,
    code,
    expiresAt,
  }, origin);
};
