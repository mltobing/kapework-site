/* netlify/functions/ma-sync-trigger.js
 *
 * Owner-only: record a request for an immediate calendar/briefing/AutoMaatje
 * sync, instead of waiting for the private irma-sync job's normal ~3-hour
 * cycle. This function does NOT itself fetch a calendar or talk to any
 * external provider — that pipeline runs entirely outside this repo (see
 * supabase-migrations/009_ma_calendar_manual_sync.sql and apps/ma/README.md).
 * It only writes an audited, single-flight, rate-limited request row the job
 * can act on once it is updated (a separate, external change) to poll for one.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const { checkRateLimit, getClientIp, requireEnvVars, logError } = require('./_utils');
const { serviceClient, verifyOwner, json, corsHeaders } = require('./_ma-devices');
const { recordActivity } = require('./_ma-activity');

const RATE_LIMIT = 10;

// A run stuck in 'running' longer than this is treated as stale/orphaned
// rather than blocking manual requests forever.
const RUNNING_STALE_MS = 20 * 60_000;
// Minimum time between requests for the same family, from either the last
// request or the last completed run — "short cooldown ... to prevent
// accidental repeated refreshes" per the brief.
const COOLDOWN_MS = 60_000;
// A pending (unclaimed) request younger than this is treated as still queued
// rather than creating a duplicate.
const PENDING_REQUEST_FRESH_MS = 20 * 60_000;

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
    console.error('[ma-sync-trigger] config error:', err.message);
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

  const now = Date.now();

  // 1. Already running? Don't start (or queue) a duplicate — surface the
  // in-progress run instead.
  const { data: latestRun, error: runErr } = await supabase
    .from('ma_integration_runs')
    .select('id, started_at, finished_at, status')
    .eq('family_id', familyId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runErr) {
    console.error('[ma-sync-trigger] run lookup error:', runErr.message);
    return json(500, { error: 'server_error' }, origin);
  }

  const runIsActive = latestRun
    && latestRun.status === 'running'
    && !latestRun.finished_at
    && (now - new Date(latestRun.started_at).getTime()) < RUNNING_STALE_MS;

  if (runIsActive) {
    return json(200, { ok: true, status: 'already_running', startedAt: latestRun.started_at }, origin);
  }

  // 2. Cooldown since the last completed run.
  if (latestRun?.finished_at && (now - new Date(latestRun.finished_at).getTime()) < COOLDOWN_MS) {
    const retryAfterSeconds = Math.ceil((COOLDOWN_MS - (now - new Date(latestRun.finished_at).getTime())) / 1000);
    return json(200, { ok: true, status: 'cooldown', retryAfterSeconds }, origin);
  }

  // 3. An existing unclaimed request that's still fresh → report it instead
  // of queuing a second one.
  const { data: pending, error: pendingErr } = await supabase
    .from('ma_sync_requests')
    .select('id, requested_at')
    .eq('family_id', familyId)
    .is('claimed_at', null)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingErr) {
    console.error('[ma-sync-trigger] pending lookup error:', pendingErr.message);
    return json(500, { error: 'server_error' }, origin);
  }

  if (pending) {
    const pendingAgeMs = now - new Date(pending.requested_at).getTime();
    if (pendingAgeMs < PENDING_REQUEST_FRESH_MS) {
      if (pendingAgeMs < COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil((COOLDOWN_MS - pendingAgeMs) / 1000);
        return json(200, { ok: true, status: 'cooldown', retryAfterSeconds }, origin);
      }
      return json(200, { ok: true, status: 'queued', requestId: pending.id, requestedAt: pending.requested_at }, origin);
    }
  }

  // 4. Record a fresh request.
  const { data: inserted, error: insertErr } = await supabase
    .from('ma_sync_requests')
    .insert({ family_id: familyId, requested_by: auth.userId })
    .select('id, requested_at')
    .single();
  if (insertErr) {
    console.error('[ma-sync-trigger] insert error:', insertErr.message);
    await logError(supabase, 'ma-sync-trigger', insertErr.message, { familyId });
    return json(500, { error: 'server_error' }, origin);
  }

  try {
    await recordActivity(supabase, {
      familyId,
      actorType: 'user',
      actorUserId: auth.userId,
      source: 'app',
      action: 'manual_sync_requested',
      objectType: 'sync_request',
      objectId: inserted.id,
      idempotencyKey: `manual-sync-requested-${inserted.id}`,
    });
  } catch (activityErr) {
    console.error('[ma-sync-trigger] activity write failed:', activityErr.message);
    await logError(supabase, 'ma-sync-trigger', activityErr.message, { familyId });
    // The request itself was recorded, but an unaudited administrative action
    // must not be reported as a clean success.
    return json(500, { error: 'server_error' }, origin);
  }

  return json(200, { ok: true, status: 'queued', requestId: inserted.id, requestedAt: inserted.requested_at }, origin);
};
