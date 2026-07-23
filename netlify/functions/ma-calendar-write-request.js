/* netlify/functions/ma-calendar-write-request.js
 *
 * Owner-only: create (or resume) an owner-confirmed calendar-write request
 * from a reviewed ride or appointment notice, validate every field server-
 * side, then dispatch the private irma-sync workflow to actually write it to
 * iCloud. This function never talks to CalDAV itself, never stores iCloud
 * credentials, and never writes ma_calendar_events directly — see irma-sync/
 * calendar_actions.py for the only place that writes to the pinned calendar,
 * and ma_calendar_events remains a read-only mirror populated by the normal
 * sync pipeline that always runs after the write attempt.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MA_SYNC_GITHUB_TOKEN
 * (the same fine-grained token ma-sync-trigger.js already uses — see
 * _ma-github-dispatch.js).
 *
 * Never logs event titles/times/locations/notes, the notice's extracted
 * content, the GitHub token, or the GitHub response body — only opaque ids
 * and controlled status/error codes.
 */

const { checkRateLimit, getClientIp, requireEnvVars } = require('./_utils');
const { serviceClient, verifyOwner, json, corsHeaders } = require('./_ma-devices');
const { recordActivity } = require('./_ma-activity');
const { githubWorkflowConfig, dispatchIrmaSync } = require('./_ma-github-dispatch');

const RATE_LIMIT = 10;
const TZ = 'Europe/Amsterdam';

const SOURCE_KINDS = new Set(['ride_notice', 'appointment_notice']);
const MAX_TITLE = 120;
const MAX_LOCATION = 300;
const MAX_NOTES = 1200;
const MAX_NOTES_LINES = 20;
const MONTHS_AHEAD = 6;

// ─── Amsterdam wall-clock → UTC (DST-safe, no library) ───────────────────────
// Node has no bundled timezone-conversion helper for "local wall time ->
// instant"; Intl only goes the other way (instant -> local parts). This
// derives the real UTC offset for the given date from Intl (correct across
// the CET/CEST boundary) and applies it, rather than a hard-coded ±1/±2.

function amsterdamOffsetMinutes(dateKey) {
  // Noon UTC is never within hours of a EU DST transition (which happens at
  // 01:00/02:00 UTC), so probing there is always unambiguous.
  const probe = new Date(`${dateKey}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(probe);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+1';
  const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(tzName);
  if (!match) return 60; // conservative CET fallback; should never be hit
  const sign = match[1].startsWith('-') ? -1 : 1;
  const hours = Math.abs(parseInt(match[1], 10));
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  return sign * (hours * 60 + minutes);
}

/** `dateKey` "YYYY-MM-DD" + `hhmm` "HH:MM", both Amsterdam wall-clock, to a UTC ISO instant. */
function amsterdamWallTimeToUtcIso(dateKey, hhmm) {
  const offsetMinutes = amsterdamOffsetMinutes(dateKey);
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000).toISOString();
}

const AMS_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today's date, as Amsterdam sees it right now. */
function amsterdamTodayKey() {
  const parts = {};
  for (const p of AMS_DATE_FORMAT.formatToParts(new Date())) if (p.type !== 'literal') parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function addMonthsKey(dateKey, months) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

// ─── Input validation ─────────────────────────────────────────────────────────

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Trims/strips control characters; returns undefined (never a value) if a NUL is present. */
function cleanText(value) {
  if (typeof value !== 'string') return undefined;
  if (value.includes('\0')) return undefined;
  return value.replace(CONTROL_CHAR_RE, '').trim();
}

function isValidDateKey(dateKey) {
  if (typeof dateKey !== 'string' || !DATE_KEY_RE.test(dateKey)) return false;
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validates one event exactly against brief §9.2's schema — title 1-120,
 * optional location <=300 / notes <=1200 (never invented, never HTML,
 * always plain text), a real date within [yesterday, +6 months], HH:MM
 * start/end with end after start. No all-day/recurrence support at all —
 * the schema simply has no field for either, so there is nothing to accept.
 * Returns { event } on success or { error } (a safe, controlled code).
 */
function validateEvent(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'invalid_event' };

  const title = cleanText(raw.title);
  if (title === undefined || title.length < 1 || title.length > MAX_TITLE) return { error: 'invalid_event' };

  if (!isValidDateKey(raw.date)) return { error: 'invalid_event' };

  const today = amsterdamTodayKey();
  const minDate = addDaysKey(today, -1);
  const maxDate = addMonthsKey(today, MONTHS_AHEAD);
  if (raw.date < minDate || raw.date > maxDate) return { error: 'outside_calendar_window' };

  if (typeof raw.startTime !== 'string' || !TIME_RE.test(raw.startTime)) return { error: 'invalid_event' };
  if (typeof raw.endTime !== 'string' || !TIME_RE.test(raw.endTime)) return { error: 'invalid_event' };
  const [sh, sm] = raw.startTime.split(':').map(Number);
  const [eh, em] = raw.endTime.split(':').map(Number);
  if (sh > 23 || sm > 59 || eh > 23 || em > 59) return { error: 'invalid_event' };

  let location = null;
  if (raw.location != null) {
    location = cleanText(raw.location);
    if (location === undefined || location.length > MAX_LOCATION) return { error: 'invalid_event' };
    if (!location) location = null;
  }

  let notes = null;
  if (raw.notes != null) {
    notes = cleanText(raw.notes);
    if (notes === undefined || notes.length > MAX_NOTES) return { error: 'invalid_event' };
    if (notes.split('\n').length > MAX_NOTES_LINES) return { error: 'invalid_event' };
    if (!notes) notes = null;
  }

  const startsAt = amsterdamWallTimeToUtcIso(raw.date, raw.startTime);
  const endsAt = amsterdamWallTimeToUtcIso(raw.date, raw.endTime);
  if (new Date(endsAt) <= new Date(startsAt)) return { error: 'invalid_event' };

  // date/startTime (the original Amsterdam wall-clock values) are kept
  // alongside startsAt/endsAt (the UTC instants used for storage) because
  // requiresConfirmedEdit() below compares against the notice's own
  // date/time fields, which are Amsterdam-local values, not UTC instants.
  return { event: { title, date: raw.date, startTime: raw.startTime, startsAt, endsAt, location, notes } };
}

// ─── Source notice verification (brief §9.3) — never trust the card's own
// data; always re-load the notice and compare server-side. ────────────────

async function loadNotice(supabase, sourceKind, noticeId, familyId) {
  const table = sourceKind === 'ride_notice' ? 'ma_ride_notices' : 'ma_appointment_notices';
  const { data, error } = await supabase.from(table).select('*').eq('id', noticeId).eq('family_id', familyId).maybeSingle();
  if (error) throw error;
  return data;
}

function hhmmPrefix(pgTime) {
  return typeof pgTime === 'string' ? pgTime.slice(0, 5) : null;
}

/** Whether the owner's proposed events differ from what the ride notice itself extracted. */
function rideFieldsChanged(events, notice) {
  const outbound = events[0];
  if (outbound.date !== notice.ride_date) return true;
  if (notice.pickup_time && outbound.startTime !== hhmmPrefix(notice.pickup_time)) return true;
  if (notice.destination && (outbound.location || '') !== notice.destination) return true;
  if (events.length === 2) {
    const back = events[1];
    if (back.date !== notice.ride_date) return true;
    if (notice.return_time && back.startTime !== hhmmPrefix(notice.return_time)) return true;
    if (notice.return_place && (back.location || '') !== notice.return_place) return true;
  }
  return false;
}

/**
 * Whether this request may proceed given the notice's match_status and
 * whether the owner explicitly confirmed having reviewed/edited the fields.
 * `unparsed` always requires confirmation (manual completion, brief §10.2).
 * `missing` requires it only when the proposed fields actually differ from
 * what the notice extracted — an appointment's end time is *always* an
 * addition (the direct confirmation template never states one), so it
 * always counts as requiring confirmation.
 */
function requiresConfirmedEdit(sourceKind, events, notice) {
  if (notice.match_status === 'unparsed') return true;
  if (sourceKind === 'appointment_notice') return true;
  return rideFieldsChanged(events, notice);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);

  if (!checkRateLimit(getClientIp(event), RATE_LIMIT)) {
    return json(429, { error: 'rate_limited' }, origin);
  }

  try {
    requireEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
    githubWorkflowConfig();
  } catch (err) {
    console.error('[ma-calendar-write-request] config error:', err.message);
    return json(503, { error: 'server_error' }, origin);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad_request' }, origin); }

  const familyId = String(body.familyId || '');
  const sourceKind = String(body.sourceKind || '');
  const noticeId = String(body.noticeId || '');
  const confirmedEditedFields = body.confirmedEditedFields === true;
  const rawEvents = Array.isArray(body.events) ? body.events : null;

  if (!familyId || !SOURCE_KINDS.has(sourceKind) || !noticeId || !rawEvents) {
    return json(400, { error: 'bad_request' }, origin);
  }

  const allowedCounts = sourceKind === 'appointment_notice' ? [1] : [1, 2];
  if (!allowedCounts.includes(rawEvents.length)) {
    return json(400, { error: 'invalid_event' }, origin);
  }

  const supabase = serviceClient();
  const auth = await verifyOwner(supabase, event.headers['authorization'], familyId);
  if (!auth.ok) return json(auth.status, { error: 'not_authorized' }, origin);

  const events = [];
  for (const raw of rawEvents) {
    const result = validateEvent(raw);
    if (result.error) return json(400, { error: result.error }, origin);
    events.push(result.event);
  }

  let notice;
  try {
    notice = await loadNotice(supabase, sourceKind, noticeId, familyId);
  } catch (err) {
    console.error('[ma-calendar-write-request] notice lookup error:', err.message);
    return json(500, { error: 'server_error' }, origin);
  }
  if (!notice) return json(404, { error: 'invalid_notice' }, origin);
  if (notice.state !== 'open') return json(409, { error: 'invalid_notice' }, origin);
  if (notice.match_status !== 'missing' && notice.match_status !== 'unparsed') {
    return json(409, { error: 'invalid_notice' }, origin);
  }
  if (requiresConfirmedEdit(sourceKind, events, notice) && !confirmedEditedFields) {
    return json(400, { error: 'invalid_notice' }, origin);
  }

  const noticeIdColumn = sourceKind === 'ride_notice' ? 'ride_notice_id' : 'appointment_notice_id';

  // A retry must reuse the same request rather than create a second one.
  const { data: existing, error: existingErr } = await supabase
    .from('ma_calendar_write_requests')
    .select('id, status')
    .eq(noticeIdColumn, noticeId)
    .eq('family_id', familyId)
    .maybeSingle();
  if (existingErr) {
    console.error('[ma-calendar-write-request] existing lookup error:', existingErr.message);
    return json(500, { error: 'server_error' }, origin);
  }

  if (existing && existing.status !== 'failed') {
    // queued/processing/success/partial: already in flight or resolved —
    // report it rather than creating a second, competing request.
    return json(200, { ok: true, requestId: existing.id, status: existing.status }, origin);
  }

  let requestId = existing?.id;

  if (existing) {
    // status === 'failed': reset for reuse only after confirming no item
    // was actually written — never silently discard/duplicate a real write.
    const { data: writtenItems, error: itemsErr } = await supabase
      .from('ma_calendar_write_items')
      .select('id')
      .eq('request_id', existing.id)
      .eq('status', 'written')
      .limit(1);
    if (itemsErr) {
      console.error('[ma-calendar-write-request] item lookup error:', itemsErr.message);
      return json(500, { error: 'server_error' }, origin);
    }
    if (writtenItems && writtenItems.length > 0) {
      return json(200, { ok: true, requestId: existing.id, status: existing.status }, origin);
    }

    const { error: resetErr } = await supabase
      .from('ma_calendar_write_requests')
      .update({
        status: 'queued', write_status: 'pending', mirror_status: 'pending',
        dispatch_status: 'pending', error_code: null, claimed_at: null, finished_at: null,
      })
      .eq('id', existing.id);
    if (resetErr) {
      console.error('[ma-calendar-write-request] reset error:', resetErr.message);
      return json(500, { error: 'server_error' }, origin);
    }
    const { error: clearItemsErr } = await supabase.from('ma_calendar_write_items').delete().eq('request_id', existing.id);
    if (clearItemsErr) {
      console.error('[ma-calendar-write-request] clear items error:', clearItemsErr.message);
      return json(500, { error: 'server_error' }, origin);
    }
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('ma_calendar_write_requests')
      .insert({ family_id: familyId, requested_by: auth.userId, source_kind: sourceKind, [noticeIdColumn]: noticeId })
      .select('id')
      .single();
    if (insertErr) {
      console.error('[ma-calendar-write-request] insert error:', insertErr.message);
      return json(500, { error: 'server_error' }, origin);
    }
    requestId = inserted.id;
  }

  // Deterministic, server-generated UIDs — never derived from names/dates/e-mail ids.
  const itemRows = events.map((e, i) => ({
    request_id: requestId,
    family_id: familyId,
    sequence_no: i + 1,
    event_uid: `ma-${requestId}-${i + 1}@kapework.invalid`,
    title: e.title,
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    location: e.location,
    notes: e.notes,
  }));

  const { error: itemsInsertErr } = await supabase.from('ma_calendar_write_items').insert(itemRows);
  if (itemsInsertErr) {
    console.error('[ma-calendar-write-request] items insert error:', itemsInsertErr.message);
    return json(500, { error: 'server_error' }, origin);
  }

  try {
    await recordActivity(supabase, {
      familyId,
      actorType: 'user',
      actorUserId: auth.userId,
      source: 'app',
      action: 'calendar_write_requested',
      objectType: 'calendar_write_request',
      objectId: requestId,
      metadata: { source_kind: sourceKind, event_count: events.length },
      idempotencyKey: `calendar-write-requested-${requestId}`,
    });
  } catch (activityErr) {
    console.error('[ma-calendar-write-request] activity write failed:', activityErr.message);
    // The request/items were recorded, but an unaudited administrative
    // action must not be reported as a clean success.
    return json(500, { error: 'server_error' }, origin);
  }

  // Only now — after the request/items/activity are safely recorded — does
  // this dispatch the private irma-sync workflow.
  const dispatch = await dispatchIrmaSync({ calendar_write_request_id: requestId });

  if (!dispatch.ok) {
    const { error: updateErr } = await supabase
      .from('ma_calendar_write_requests')
      .update({
        dispatch_status: 'failed',
        dispatch_attempted_at: new Date().toISOString(),
        status: 'failed',
        write_status: 'failed',
        error_code: 'dispatch_failed',
      })
      .eq('id', requestId);
    if (updateErr) console.error('[ma-calendar-write-request] dispatch-failure update error:', updateErr.message);
    return json(502, { error: 'dispatch_failed' }, origin);
  }

  const dispatchedAt = new Date().toISOString();
  const { error: dispatchedUpdateErr } = await supabase
    .from('ma_calendar_write_requests')
    .update({
      dispatch_status: 'dispatched',
      dispatch_attempted_at: dispatchedAt,
      dispatched_at: dispatchedAt,
      github_run_id: dispatch.githubRunId,
    })
    .eq('id', requestId);
  if (dispatchedUpdateErr) console.error('[ma-calendar-write-request] dispatched update error:', dispatchedUpdateErr.message);

  return json(202, { ok: true, requestId, status: 'queued' }, origin);
};
