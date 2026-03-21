/* netlify/functions/track-event.js
 *
 * Receives analytics events from the browser and writes them to Supabase
 * using the service role key (never exposed to the browser).
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

const REQUIRED_FIELDS = ['event_name', 'app_slug'];

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

  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (!body[field]) {
      return { statusCode: 400, body: `Missing required field: ${field}` };
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
    event_name,
    app_slug,
    device_id:  device_id  || null,
    session_id: session_id || null,
    url:        url        || null,
    props:      props,
    created_at: ts         || new Date().toISOString()
  });

  if (error) {
    console.error('[track-event] insert error:', error.message);
    return { statusCode: 500, body: 'Database error' };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true })
  };
};
