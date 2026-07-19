/* netlify/functions/_ma-activity.js
 *
 * Shared helper for recording Beheer activity events from server-side
 * (service-role) Netlify Functions — used by the trusted-device endpoints.
 * Mirrors the DB-side ma_record_activity_event() contract: safe metadata
 * only (counts, dates, statuses, opaque ids — never tokens, codes, labels,
 * or any other family data), and idempotency_key makes a duplicate call a
 * safe no-op rather than a duplicate row.
 *
 * recordActivity() throws on a genuine write failure (anything other than
 * "already recorded") so the caller can decide whether to fail the request
 * rather than silently claim an audited administrative action succeeded.
 */

const UNIQUE_VIOLATION = '23505';

async function recordActivity(supabase, {
  familyId, actorType, actorUserId = null, source, action,
  objectType = null, objectId = null, severity = 'info', metadata = {}, idempotencyKey = null,
}) {
  const { error } = await supabase.from('ma_activity_events').insert({
    family_id: familyId,
    actor_type: actorType,
    actor_user_id: actorUserId,
    source,
    action,
    object_type: objectType,
    object_id: objectId,
    severity,
    metadata,
    idempotency_key: idempotencyKey,
  });

  if (error && error.code !== UNIQUE_VIOLATION) throw error;
}

module.exports = { recordActivity };
