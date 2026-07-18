/* netlify/functions/ma-today.js
 *
 * Read-only trusted Today payload for a paired device. Authenticated ONLY by the
 * HttpOnly device cookie — never a Supabase session. Returns a server-built,
 * sanitized, allowlisted snapshot of *today in Europe/Amsterdam* and nothing else:
 * no notes, no external URLs, no posts/comments/attachments, no ride excerpts, no
 * profiles/emails/roles, no briefing management metadata.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MA_DEVICE_TOKEN_PEPPER
 */

const { requireEnvVars } = require('./_utils');
const { hashSecret, serviceClient, parseCookies, DEVICE_COOKIE, json, corsHeaders } = require('./_ma-devices');
const { amsDateKey, sanitizeEvent } = require('./_ma-today-derive');

// Refresh last_seen_at / roll expiry at most once per hour to avoid a write on
// every 60-second poll.
const SEEN_THROTTLE_MS = 60 * 60 * 1000;
const DEVICE_TTL_MS    = 365 * 24 * 60 * 60 * 1000;

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, origin);
  }

  try {
    requireEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MA_DEVICE_TOKEN_PEPPER');
  } catch (err) {
    console.error('[ma-today] config error:', err.message);
    return json(503, { error: 'service_unavailable' }, origin);
  }

  const rawToken = parseCookies(event.headers['cookie'])[DEVICE_COOKIE];
  if (!rawToken) return json(401, { error: 'unauthorized' }, origin);

  const supabase = serviceClient();
  const nowIso   = new Date().toISOString();

  // 1. Resolve one active device by cookie hash.
  const { data: device, error: devErr } = await supabase
    .from('ma_trusted_devices')
    .select('id, family_id, last_seen_at')
    .eq('token_hash', hashSecret(rawToken, process.env.MA_DEVICE_TOKEN_PEPPER))
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (devErr) {
    console.error('[ma-today] device lookup error:', devErr.message);
    return json(500, { error: 'server_error' }, origin);
  }
  if (!device) return json(401, { error: 'unauthorized' }, origin);

  const familyId = device.family_id;

  // 2. Throttled heartbeat: refresh last_seen and roll expiry forward (keeps the
  //    device alive without ever forcing the care recipient to reauthenticate).
  const lastSeenMs = device.last_seen_at ? Date.parse(device.last_seen_at) : 0;
  if (Date.now() - lastSeenMs > SEEN_THROTTLE_MS) {
    await supabase
      .from('ma_trusted_devices')
      .update({ last_seen_at: nowIso, expires_at: new Date(Date.now() + DEVICE_TTL_MS).toISOString() })
      .eq('id', device.id);
  }

  // 3. Build the payload for today (Amsterdam). Fetch a ±36h window and bucket by
  //    Amsterdam date so all-day rows (stored at Amsterdam midnight) land right.
  const todayKey = amsDateKey(nowIso);
  const windowLo = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const windowHi = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

  const [eventsRes, sourceRes, briefingRes] = await Promise.all([
    supabase
      .from('ma_calendar_events')
      .select('external_event_uid, title, starts_at, ends_at, all_day, location, notes, status')
      .eq('family_id', familyId)
      .neq('status', 'cancelled')
      .gte('starts_at', windowLo)
      .lt('starts_at', windowHi)
      .order('starts_at', { ascending: true }),
    supabase
      .from('ma_calendar_sources')
      .select('last_synced_at')
      .eq('family_id', familyId)
      .order('last_synced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ma_briefings')
      .select('whatsapp_text')
      .eq('family_id', familyId)
      .eq('briefing_date', todayKey)
      .maybeSingle(),
  ]);

  if (eventsRes.error) {
    console.error('[ma-today] events error:', eventsRes.error.message);
    return json(500, { error: 'server_error' }, origin);
  }

  const events = (eventsRes.data || [])
    .filter(row => amsDateKey(row.starts_at) === todayKey)
    .map(sanitizeEvent);

  const payload = {
    dateKey: todayKey,
    calendarLastSyncedAt: sourceRes.data?.last_synced_at ?? null,
    briefingText: briefingRes.data?.whatsapp_text ?? null,
    events,
  };

  return json(200, payload, origin);
};
