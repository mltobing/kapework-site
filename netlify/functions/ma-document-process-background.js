/* netlify/functions/ma-document-process-background.js
 *
 * Netlify Background Function (legacy CommonJS `-background` naming
 * convention — Netlify accepts the invocation immediately and runs this
 * handler asynchronously, so a slow PDF/image request never depends on the
 * calling request's own timeout).
 *
 * Verifies the owner again (never trusts the synchronous start function's
 * check alone), atomically claims only a row still 'queued', and delegates
 * everything else to processDocumentImport() in _ma-document-processing.js.
 *
 * Logs only an opaque import id, stage, controlled error code, counts, and
 * duration — never filename, source label, source content, date, excerpt,
 * candidate text, prompt, response, hash, or Storage path, and never a raw
 * exception message into the import row itself.
 */

const { requireEnvVars } = require('./_utils');
const { serviceClient, verifyOwner } = require('./_ma-devices');
const { processDocumentImport } = require('./_ma-document-processing');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_INPUT_TOKENS = 100000;
const DEFAULT_MAX_OUTPUT_TOKENS = 12000;

function anthropicConfig() {
  requireEnvVars('ANTHROPIC_API_KEY');
  return {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.MA_DOCUMENT_MODEL || DEFAULT_MODEL,
    maxInputTokens: Number(process.env.MA_DOCUMENT_MAX_INPUT_TOKENS) || DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens: Number(process.env.MA_DOCUMENT_MAX_OUTPUT_TOKENS) || DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

exports.handler = async (event) => {
  const startedAt = Date.now();

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 200, body: '' }; }

  const familyId = String(body.familyId || '');
  const importId = String(body.importId || '');
  if (!familyId || !importId) return { statusCode: 200, body: '' };

  const supabase = serviceClient();

  const auth = await verifyOwner(supabase, event.headers && event.headers['authorization'], familyId);
  if (!auth.ok) {
    console.error('[ma-document-process-background] not_authorized import=%s', importId);
    return { statusCode: 200, body: '' };
  }

  // Atomically claim only a row still 'queued' — a duplicate/racing
  // invocation for the same import finds zero matching rows and exits
  // quietly rather than double-processing.
  const { data: claimed, error: claimErr } = await supabase
    .from('ma_document_imports')
    .update({ status: 'processing', processing_started_at: new Date().toISOString() })
    .eq('id', importId)
    .eq('family_id', familyId)
    .eq('status', 'queued')
    .select('id, family_id, audience, source_type, document_date, status')
    .maybeSingle();

  if (claimErr) {
    console.error('[ma-document-process-background] claim error import=%s', importId);
    return { statusCode: 200, body: '' };
  }
  if (!claimed) {
    return { statusCode: 200, body: '' };
  }

  let anthropic;
  try {
    anthropic = anthropicConfig();
  } catch (err) {
    console.error('[ma-document-process-background] config_error import=%s', importId);
    try {
      await supabase.from('ma_document_imports')
        .update({ status: 'failed', error_code: 'config_error', processed_at: new Date().toISOString() })
        .eq('id', importId);
    } catch (writeErr) {
      console.error('[ma-document-process-background] failed to record config_error import=%s', importId);
    }
    return { statusCode: 200, body: '' };
  }

  try {
    const result = await processDocumentImport({ supabase, anthropic, importRow: claimed });
    const durationMs = Date.now() - startedAt;
    console.log(
      '[ma-document-process-background] done import=%s status=%s duration_ms=%d%s%s',
      importId, result.status, durationMs,
      result.errorCode ? ` error_code=${result.errorCode}` : '',
      result.candidateCount != null ? ` candidates=${result.candidateCount}` : '',
    );
    return { statusCode: 200, body: '' };
  } catch (err) {
    const errorCode = (err && err.errorCode) || 'server_error';
    console.error('[ma-document-process-background] unexpected failure import=%s error_code=%s', importId, errorCode);
    try {
      await supabase.from('ma_document_imports')
        .update({ status: 'failed', error_code: errorCode, processed_at: new Date().toISOString() })
        .eq('id', importId);
    } catch (writeErr) {
      console.error('[ma-document-process-background] failed to record failure import=%s', importId);
    }
    return { statusCode: 200, body: '' };
  }
};
