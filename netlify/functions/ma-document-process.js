/* netlify/functions/ma-document-process.js
 *
 * Owner-only: start (or restart) processing of a Document Inbox import. This
 * function does NOT talk to Anthropic itself — it verifies the owner, checks
 * the import's current state, flips it to 'queued', and hands off to the
 * Netlify Background Function (ma-document-process-background.js) so a
 * longer PDF/image request never depends on this request's own timeout. See
 * apps/ma/README.md "Document Inbox" for the full architecture.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 * (checked here so a misconfigured deploy fails fast instead of queuing a
 * background run that can only ever fail).
 *
 * Never logs the Authorization header, source metadata, or any candidate/
 * document content — only opaque ids and controlled status/error codes.
 */

const { checkRateLimit, getClientIp, requireEnvVars } = require('./_utils');
const { serviceClient, verifyOwner, json, corsHeaders } = require('./_ma-devices');

const RATE_LIMIT = 10;

// Only these two states may (re)start processing — everything else either has
// a run already in flight, is already resolved, or is terminal.
const STARTABLE_STATUSES = new Set(['uploaded', 'failed']);

function backgroundFunctionUrl() {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/.netlify/functions/ma-document-process-background`;
}

async function markDispatchFailed(supabase, importId) {
  const { error } = await supabase
    .from('ma_document_imports')
    .update({ status: 'failed', error_code: 'dispatch_failed', processed_at: new Date().toISOString() })
    .eq('id', importId);
  if (error) console.error('[ma-document-process] dispatch-failure update error:', error.message);
}

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);

  if (!checkRateLimit(getClientIp(event), RATE_LIMIT)) {
    return json(429, { error: 'rate_limited' }, origin);
  }

  try {
    requireEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY');
  } catch (err) {
    console.error('[ma-document-process] config error:', err.message);
    return json(503, { error: 'config_error' }, origin);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad_request' }, origin); }

  const familyId = String(body.familyId || '');
  const importId = String(body.importId || '');
  if (!familyId || !importId) return json(400, { error: 'bad_request' }, origin);

  const supabase = serviceClient();
  const authHeader = event.headers['authorization'];
  const auth = await verifyOwner(supabase, authHeader, familyId);
  if (!auth.ok) return json(auth.status, { error: 'not_authorized' }, origin);

  const { data: importRow, error: importErr } = await supabase
    .from('ma_document_imports')
    .select('id, family_id, status')
    .eq('id', importId)
    .maybeSingle();
  if (importErr) {
    console.error('[ma-document-process] import lookup error:', importErr.message);
    return json(500, { error: 'server_error' }, origin);
  }
  if (!importRow || importRow.family_id !== familyId) {
    return json(404, { error: 'invalid_state' }, origin);
  }

  if (!STARTABLE_STATUSES.has(importRow.status)) {
    // queued/processing/ready/completed/duplicate/cancelled: report the
    // current state rather than starting a second, competing run.
    return json(200, { ok: true, status: importRow.status }, origin);
  }

  const { data: anyFile, error: fileErr } = await supabase
    .from('ma_document_import_files')
    .select('id')
    .eq('import_id', importId)
    .limit(1);
  if (fileErr) {
    console.error('[ma-document-process] file lookup error:', fileErr.message);
    return json(500, { error: 'server_error' }, origin);
  }
  if (!anyFile || anyFile.length === 0) {
    return json(400, { error: 'source_missing' }, origin);
  }

  const { error: queueErr } = await supabase
    .from('ma_document_imports')
    .update({ status: 'queued', error_code: null, processing_started_at: null, processed_at: null })
    .eq('id', importId)
    .eq('status', importRow.status);
  if (queueErr) {
    console.error('[ma-document-process] queue update error:', queueErr.message);
    return json(500, { error: 'server_error' }, origin);
  }

  const bgUrl = backgroundFunctionUrl();
  if (!bgUrl) {
    console.error('[ma-document-process] no site URL available for background dispatch');
    await markDispatchFailed(supabase, importId);
    return json(502, { error: 'dispatch_failed' }, origin);
  }

  let dispatchOk = false;
  try {
    const res = await fetch(bgUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body: JSON.stringify({ familyId, importId }),
    });
    // Netlify accepts a background-function invocation with 202 (some local
    // dev shims respond 200) and runs it asynchronously — anything else means
    // it was never actually queued.
    dispatchOk = res.status === 202 || res.status === 200;
  } catch (err) {
    console.error('[ma-document-process] background dispatch network error:', err.message);
    dispatchOk = false;
  }

  if (!dispatchOk) {
    await markDispatchFailed(supabase, importId);
    return json(502, { error: 'dispatch_failed' }, origin);
  }

  return json(202, { ok: true, status: 'queued' }, origin);
};
