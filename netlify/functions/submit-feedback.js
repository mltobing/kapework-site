/* netlify/functions/submit-feedback.js
 *
 * Receives feedback submissions from the browser and writes them to Supabase
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
  isValidEmail,
  logError,
} = require('./_utils');

// 5 feedback submissions per minute per IP
const RATE_LIMIT = 5;

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

  // Validate env vars
  try {
    requireEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  } catch (err) {
    console.error('[submit-feedback] configuration error:', err.message);
    return { statusCode: 503, headers: corsHeaders, body: 'Service misconfigured' };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: 'Invalid JSON' };
  }

  const { message, email, app_slug, url, device_id } = body;

  // message is required; enforce a reasonable maximum length
  const cleanMessage = sanitiseString(message, 2000);
  if (!cleanMessage) {
    return { statusCode: 400, headers: corsHeaders, body: 'message is required' };
  }

  // email is optional but must look valid if supplied
  const cleanEmail = email ? sanitiseString(String(email), 254) : null;
  if (cleanEmail && !isValidEmail(cleanEmail)) {
    return { statusCode: 400, headers: corsHeaders, body: 'Invalid email address' };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { error } = await supabase.from('app_feedback').insert({
    message:   cleanMessage,
    email:     cleanEmail,
    app_slug:  app_slug  ? sanitiseString(String(app_slug), 50)  : 'unknown',
    url:       url       ? sanitiseString(String(url), 500)      : null,
    device_id: device_id ? sanitiseString(String(device_id), 100): null,
  });

  if (error) {
    console.error('[submit-feedback] insert error:', error.message);
    await logError(supabase, 'submit-feedback', error.message, { app_slug });
    return { statusCode: 500, headers: corsHeaders, body: 'Database error' };
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
