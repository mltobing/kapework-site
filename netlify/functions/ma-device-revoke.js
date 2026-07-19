/* netlify/functions/ma-device-revoke.js
 *
 * Authenticated family owner revokes a trusted device. Takes effect on the
 * device's next payload refresh (ma-today rejects revoked devices). Idempotent.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const { checkRateLimit, getClientIp, requireEnvVars, logError } = require('./_utils');
const { serviceClient, verifyOwner, json, corsHeaders } = require('./_ma-devices');
const { recordActivity } = require('./_ma-activity');

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
    console.error('[ma-device-revoke] config error:', err.message);
    return json(503, { error: 'service_unavailable' }, origin);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad_request' }, origin); }

  const familyId = String(body.familyId || '');
  const deviceId = String(body.deviceId || '');
  if (!familyId || !deviceId) return json(400, { error: 'bad_request' }, origin);

  const supabase = serviceClient();
  const auth = await verifyOwner(supabase, event.headers['authorization'], familyId);
  if (!auth.ok) return json(auth.status, { error: 'not_authorized' }, origin);

  // Scope the update by family_id too, so an owner can only revoke their own
  // family's devices even if a deviceId from elsewhere is supplied.
  const { data, error } = await supabase
    .from('ma_trusted_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', deviceId)
    .eq('family_id', familyId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[ma-device-revoke] update error:', error.message);
    await logError(supabase, 'ma-device-revoke', error.message, { familyId });
    return json(500, { error: 'server_error' }, origin);
  }

  // Only a first-time revoke (data present) gets an activity row — a repeat
  // call against an already-revoked or unknown device is a silent no-op, not
  // a second event. No label/token/hash in the metadata, only the device id.
  if (data) {
    try {
      await recordActivity(supabase, {
        familyId,
        actorType: 'user',
        actorUserId: auth.userId,
        source: 'trusted_device',
        action: 'trusted_device_revoked',
        objectType: 'trusted_device',
        objectId: data.id,
        idempotencyKey: `trusted-device-revoked-${data.id}`,
      });
    } catch (activityErr) {
      console.error('[ma-device-revoke] activity write failed:', activityErr.message);
      await logError(supabase, 'ma-device-revoke', activityErr.message, { familyId });
      // The revoke itself already happened — but we must not claim a fully
      // audited administrative action succeeded when the audit trail didn't.
      return json(500, { error: 'server_error' }, origin);
    }
  }

  return json(200, { ok: true, revoked: Boolean(data) }, origin);
};
