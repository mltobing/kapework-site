/* netlify/functions/health.js
 *
 * Lightweight health-check endpoint. Returns 200 when Supabase is reachable,
 * 503 otherwise. No auth required — safe to call from monitoring services.
 *
 * GET /.netlify/functions/health
 */

const { createClient } = require('@supabase/supabase-js');
const { requireEnvVars } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  try {
    requireEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  } catch (err) {
    console.error('[health] configuration error:', err.message);
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ ok: false, reason: 'misconfigured' }),
    };
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Minimal query — just confirm the DB connection is alive
    const { error } = await supabase
      .from('app_feedback')
      .select('id', { count: 'exact', head: true })
      .limit(0);

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('[health] check failed:', err.message);
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ ok: false, reason: 'database_unreachable' }),
    };
  }
};
