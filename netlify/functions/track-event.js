/* netlify/functions/track-event.js
 *
 * Receives analytics events from the browser and writes them to Supabase
 * using the service role key (never exposed to the browser).
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');
const {
  getCorsHeaders,
  handlePreflight,
  checkRateLimit,
  getClientIp,
  requireEnvVars,
  sanitiseString,
  logError,
} = require('./_utils');

// 120 analytics pings per minute per IP is generous for normal use
const RATE_LIMIT = 120;

const REQUIRED_FIELDS = ['event_name', 'app_slug'];

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';

  // Preflight
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  const corsHeaders = getCorsHeaders(origin);

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method not allowed' };
  }

  // Rate limit
  const ip = getClientIp(event);
  if (!checkRateLimit(ip, RATE_LIMIT)) {
    return { statusCode: 429, headers: corsHeaders, body: 'Too many requests' };
  }

  // Validate env vars (fail fast with a clear message if misconfigured)
  try {
    requireEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  } catch (err) {
    console.error('[track-event] configuration error:', err.message);
    return { statusCode: 503, headers: corsHeaders, body: 'Service misconfigured' };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: 'Invalid JSON' };
  }

  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (!body[field]) {
      return { statusCode: 400, headers: corsHeaders, body: `Missing required field: ${field}` };
    }
  }

  // Destructure known columns; everything else goes into props
  const { event_name, app_slug, device_id, session_id, url, ts, ...rest } = body;

  // Strip any empty-string values from rest to keep props clean
  const props = Object.keys(rest).length > 0 ? rest : null;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { error } = await supabase.from('app_events').insert({
    event_name:  sanitiseString(event_name, 100),
    app_slug:    sanitiseString(app_slug, 50),
    device_id:   device_id  ? sanitiseString(String(device_id), 100)  : null,
    session_id:  session_id ? sanitiseString(String(session_id), 100) : null,
    url:         url        ? sanitiseString(String(url), 500)        : null,
    props,
    created_at:  ts || new Date().toISOString(),
  });

  if (error) {
    console.error('[track-event] insert error:', error.message);
    await logError(supabase, 'track-event', error.message, { app_slug, event_name });
    return { statusCode: 500, headers: corsHeaders, body: 'Database error' };
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
