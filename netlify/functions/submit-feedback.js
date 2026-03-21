/* netlify/functions/submit-feedback.js
 *
 * Receives feedback submissions from the browser and writes them to Supabase
 * using the service role key (never exposed to the browser).
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { message, email, app_slug, url, device_id } = body;

  // message is required
  if (!message || !String(message).trim()) {
    return { statusCode: 400, body: 'message is required' };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { error } = await supabase.from('app_feedback').insert({
    message:   String(message).trim(),
    email:     email     ? String(email).trim()     : null,
    app_slug:  app_slug  ? String(app_slug).trim()  : 'unknown',
    url:       url       ? String(url).trim()       : null,
    device_id: device_id ? String(device_id).trim() : null
  });

  if (error) {
    console.error('[submit-feedback] insert error:', error.message);
    return { statusCode: 500, body: 'Database error' };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true })
  };
};
