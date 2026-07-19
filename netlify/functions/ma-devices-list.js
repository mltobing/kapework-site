/* netlify/functions/ma-devices-list.js
 *
 * Authenticated family member lists the family's trusted devices for management.
 * Never exposes token_hash or any raw secret.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const { checkRateLimit, getClientIp, requireEnvVars } = require('./_utils');
const { serviceClient, verifyOwner, json, corsHeaders } = require('./_ma-devices');

const RATE_LIMIT = 30;

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);

  if (!checkRateLimit(getClientIp(event), RATE_LIMIT)) {
    return json(429, { error: 'rate_limited' }, origin);
  }

  try {
    requireEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  } catch (err) {
    console.error('[ma-devices-list] config error:', err.message);
    return json(503, { error: 'service_unavailable' }, origin);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad_request' }, origin); }

  const familyId = String(body.familyId || '');
  if (!familyId) return json(400, { error: 'bad_request' }, origin);

  const supabase = serviceClient();
  const auth = await verifyOwner(supabase, event.headers['authorization'], familyId);
  if (!auth.ok) return json(auth.status, { error: 'not_authorized' }, origin);

  const { data, error } = await supabase
    .from('ma_trusted_devices')
    .select('id, label, created_at, last_seen_at, expires_at, revoked_at')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[ma-devices-list] query error:', error.message);
    return json(500, { error: 'server_error' }, origin);
  }

  return json(200, { devices: data ?? [] }, origin);
};
