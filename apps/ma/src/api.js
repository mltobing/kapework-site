/**
 * src/api.js
 *
 * All Supabase table queries for the Ma app.
 *
 * Every external call lives here — not scattered through UI components.
 * This layer is where caching, retries, and error surfacing would grow.
 *
 * Expected Supabase schema:
 *   ma_families, ma_profiles, ma_family_members, ma_care_team_members,
 *   ma_posts, ma_comments, ma_attachments,
 *   ma_calendar_sources, ma_calendar_events, ma_briefings
 *
 * Foreign-key joins assume:
 *   ma_posts.author_id          → ma_profiles.user_id
 *   ma_comments.author_id       → ma_profiles.user_id
 *   ma_attachments.post_id      → ma_posts.id
 *   ma_family_members.user_id   → ma_profiles.user_id
 *   ma_calendar_events.source_id → ma_calendar_sources.id
 *
 * Authorization is enforced by RLS (see supabase-migrations/006_ma_logboek_care_team.sql),
 * not by anything in this file — every function here trusts the server to reject
 * what the current user isn't allowed to read or write.
 */

import { supabase } from './supabase.js';
import { todayAms, addDaysKey, startOfTodayAmsISO } from './lib/datetime.js';

const LOGBOEK_ENTRY_COLUMNS = `
  id, title, body, kind, audience, tags, event_date, linked_event_uid,
  pinned, created_at, updated_at, author_id,
  ma_profiles!author_id ( display_name, relationship, avatar_url ),
  ma_attachments ( id, object_path, mime_type )
`;

// Compact columns for the owner-only Prullenbak (trash) view — a preview, not
// the full entry (no attachments/comments; see views/prullenbak.js). Both
// embeds target ma_profiles, so each needs an explicit alias — otherwise
// PostgREST returns them under the same `ma_profiles` key and one clobbers
// the other.
const LOGBOEK_TRASH_COLUMNS = `
  id, title, body, kind, audience, event_date, created_at, author_id,
  deleted_at, deleted_by,
  author:ma_profiles!author_id ( display_name ),
  deleter:ma_profiles!deleted_by ( display_name )
`;

/**
 * Escapes a free-text search term for safe interpolation into a PostgREST
 * `.or()`/`.ilike()` filter string: strips characters that are structurally
 * significant to the filter grammar (comma separates conditions, parens
 * group them) so a stray "," or "(" in what someone typed can't break the
 * query or be misread as a second condition.
 */
function escapeSearchTerm(term) {
  return String(term).replace(/[,()%]/g, ' ').trim();
}

// ─── Profile & access ───────────────────────────────────────────────────────

/**
 * Fetch the ma_profiles row for a given auth user id.
 * Returns null if no profile exists yet (new user not yet set up).
 */
export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('ma_profiles')
    .select('user_id, display_name, relationship, avatar_url')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Create the ma_profiles row for the current user on first sign-in.
 * Permitted by the `ma_profiles: insert own` RLS policy (user_id = auth.uid()).
 * `relationship` is left null — it isn't required.
 * Returns the inserted row.
 */
export async function createProfile({ userId, displayName }) {
  const { data, error } = await supabase
    .from('ma_profiles')
    .insert({ user_id: userId, display_name: displayName })
    .select('user_id, display_name, relationship, avatar_url')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Resolve what kind of access the current user has, without ever inferring it
 * from the UI or an email address: a family membership row wins (owner or
 * member); otherwise an active (non-revoked) care-team membership makes them
 * a caregiver; otherwise they have no access at all yet.
 *
 * @returns {Promise<{ accessType: 'owner'|'member'|'caregiver'|null, familyId: string|null }>}
 */
export async function fetchAccessContext(userId) {
  const { data: familyRow, error: familyErr } = await supabase
    .from('ma_family_members')
    .select('family_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (familyErr) throw familyErr;

  if (familyRow) {
    return { accessType: familyRow.role === 'owner' ? 'owner' : 'member', familyId: familyRow.family_id };
  }

  const { data: careRow, error: careErr } = await supabase
    .from('ma_care_team_members')
    .select('family_id')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle();
  if (careErr) throw careErr;

  if (careRow) {
    return { accessType: 'caregiver', familyId: careRow.family_id };
  }

  return { accessType: null, familyId: null };
}

// ─── Logboek entries (ma_posts) ─────────────────────────────────────────────

/**
 * Fetch a page of Logboek entries, newest-created first. Trashed entries
 * (deleted_at set) are always excluded — this is the normal feed, not the
 * owner-only Prullenbak (see fetchTrashedLogboekEntries).
 *
 * Family users see every entry for their family (RLS: `ma_is_family_member`);
 * care-team users see only `audience = 'care_team'` entries regardless of what
 * `audience` is passed here — RLS filters that server-side either way, this
 * parameter just lets the family UI offer "Alleen familie" / "Met zorgteam"
 * chips without a second code path.
 *
 * @param {string} familyId
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {number} [opts.offset=0]
 * @param {string|null} [opts.kind]      — filter to one entry type, or null for all
 * @param {string|null} [opts.audience]  — filter to 'family' | 'care_team', or null for all
 * @param {string|null} [opts.authorId]  — filter to one author, or null for all
 * @param {string|null} [opts.search]    — free-text match against title/body
 * @param {string|null} [opts.dateFrom]  — YYYY-MM-DD, inclusive lower bound on event_date
 * @param {string|null} [opts.dateTo]    — YYYY-MM-DD, inclusive upper bound on event_date
 */
export async function fetchLogboekEntries(familyId, {
  limit = 20, offset = 0, kind = null, audience = null,
  authorId = null, search = null, dateFrom = null, dateTo = null,
} = {}) {
  let query = supabase
    .from('ma_posts')
    .select(LOGBOEK_ENTRY_COLUMNS)
    .eq('family_id', familyId)
    .is('deleted_at', null);

  if (kind)     query = query.eq('kind', kind);
  if (audience) query = query.eq('audience', audience);
  if (authorId) query = query.eq('author_id', authorId);
  if (dateFrom) query = query.gte('event_date', dateFrom);
  if (dateTo)   query = query.lte('event_date', dateTo);
  if (search && search.trim()) {
    const term = escapeSearchTerm(search);
    if (term) query = query.or(`title.ilike.%${term}%,body.ilike.%${term}%`);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/**
 * Distinct authors who have a (non-trashed) Logboek entry in this family, for
 * the "Filter by author" control — a small, bounded lookup rather than a new
 * roster RPC, since a member (not just the owner) needs this list too.
 * @param {string} familyId
 * @returns {Promise<Array<{ id: string, displayName: string }>>}
 */
export async function fetchLogboekAuthors(familyId) {
  const { data, error } = await supabase
    .from('ma_posts')
    .select('author_id, ma_profiles!author_id ( display_name )')
    .eq('family_id', familyId)
    .is('deleted_at', null)
    .limit(500);
  if (error) throw error;

  const seen = new Map();
  for (const row of data ?? []) {
    if (!row.author_id || seen.has(row.author_id)) continue;
    seen.set(row.author_id, row.ma_profiles?.display_name || 'Onbekend');
  }
  return Array.from(seen, ([id, displayName]) => ({ id, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Fetch a small, bounded set of the most recent entries — used for the Today
 * tab's "added today" indicator (family: count of today's care-team entries;
 * caregiver: a short today-only list). Never grows into a feed; callers cap
 * what they render.
 */
export async function fetchRecentLogboekEntries(familyId, { limit = 15, audience = null } = {}) {
  let query = supabase
    .from('ma_posts')
    .select(LOGBOEK_ENTRY_COLUMNS)
    .eq('family_id', familyId)
    .is('deleted_at', null);
  if (audience) query = query.eq('audience', audience);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Create a new Logboek entry. `audience` defaults to 'family' — family-only
 * is always the safe default; callers must opt into 'care_team' explicitly.
 * Returns the inserted row.
 */
export async function createLogboekEntry({
  familyId, authorId, kind, title = null, body = null,
  eventDate = null, audience = 'family', tags = [], linkedEventUid = null,
}) {
  const { data, error } = await supabase
    .from('ma_posts')
    .insert({
      family_id: familyId,
      author_id: authorId,
      kind,
      title,
      body,
      event_date: eventDate,
      audience,
      tags,
      linked_event_uid: linkedEventUid,
    })
    .select(LOGBOEK_ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Delete a Logboek entry (RLS: author or family owner for a family entry;
 * author only for a care_team entry). Used to recover from a failed compose
 * (e.g. the entry saved but its attachment never did) rather than leaving a
 * misleading half-finished post behind.
 */
export async function deleteLogboekEntry(id) {
  const { error } = await supabase.from('ma_posts').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Edit the content of a Logboek entry — title, body, the date it concerns, and
 * tags. RLS (author-own or owner-any) is the real permission boundary; the UI
 * only ever offers "Bewerken" to an entry's own author (see logboek-entry.js).
 * Never touches audience/kind/attachments — out of scope for this edit form.
 * Returns the updated row.
 */
export async function updateLogboekEntry(id, { title, body, eventDate, tags }, userId) {
  const { data, error } = await supabase
    .from('ma_posts')
    .update({
      title: title || null,
      body: body || null,
      event_date: eventDate || null,
      tags: tags ?? [],
      updated_by: userId,
    })
    .eq('id', id)
    .select(LOGBOEK_ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Move an entry to the trash (Prullenbak) — the entry's own author or the
 * family owner. Goes through the ma_trash_logboek_entry() RPC rather than a
 * plain `.update()`: PostgreSQL requires a row to still satisfy the table's
 * SELECT policy after an UPDATE, even without .select() chained, and the
 * owner-only-trash SELECT policy (migration 008) would deny exactly that for
 * a non-owner author soft-deleting their own entry. The SECURITY DEFINER RPC
 * bypasses that entirely while enforcing the identical author-or-owner rule
 * itself — see the migration's comments for the full explanation.
 *
 * Resolves to `false` (not a throw) if the entry doesn't exist, is already
 * trashed, or the caller isn't permitted — throws only on a genuine
 * network/server error.
 */
export async function softDeleteLogboekEntry(id) {
  const { data, error } = await supabase.rpc('ma_trash_logboek_entry', { p_post_id: id });
  if (error) throw error;
  return data === true;
}

/**
 * Restore a trashed entry — the immediate "Ongedaan maken" undo, or an
 * owner's Herstellen action from Prullenbak. Same RPC-based reasoning as
 * softDeleteLogboekEntry(). Resolves to `false` if nothing was restored.
 */
export async function restoreLogboekEntry(id) {
  const { data, error } = await supabase.rpc('ma_restore_logboek_entry', { p_post_id: id });
  if (error) throw error;
  return data === true;
}

/**
 * Permanently delete an entry — owner-only once trashed; an author may still
 * permanently delete their own not-yet-trashed entry directly (preserves
 * compose.js's failed-upload cleanup). Same RPC-based reasoning as above.
 * Resolves to `false` if nothing was deleted.
 */
export async function permanentlyDeleteLogboekEntry(id) {
  const { data, error } = await supabase.rpc('ma_permanently_delete_logboek_entry', { p_post_id: id });
  if (error) throw error;
  return data === true;
}

/**
 * Owner-only: count of trashed Logboek entries, for the Beheer summary card.
 * RLS (migration 008) returns 0 for a non-owner rather than an error.
 */
export async function fetchTrashedLogboekCount(familyId) {
  const { count, error } = await supabase
    .from('ma_posts')
    .select('id', { count: 'exact', head: true })
    .eq('family_id', familyId)
    .not('deleted_at', 'is', null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Owner-only: fetch a page of trashed Logboek entries for the Prullenbak view,
 * newest-deleted first. RLS (migration 008) returns nothing for a non-owner.
 * @param {string} familyId
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {number} [opts.offset=0]
 * @param {string|null} [opts.search] — free-text match against title/body
 */
export async function fetchTrashedLogboekEntries(familyId, { limit = 20, offset = 0, search = null } = {}) {
  let query = supabase
    .from('ma_posts')
    .select(LOGBOEK_TRASH_COLUMNS)
    .eq('family_id', familyId)
    .not('deleted_at', 'is', null);

  if (search && search.trim()) {
    const term = escapeSearchTerm(search);
    if (term) query = query.or(`title.ilike.%${term}%,body.ilike.%${term}%`);
  }

  const { data, error } = await query
    .order('deleted_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

// ─── Comments ────────────────────────────────────────────────────────────────

/**
 * Fetch all comments for an entry, oldest first.
 */
export async function fetchComments(postId) {
  const { data, error } = await supabase
    .from('ma_comments')
    .select(`
      id, body, created_at, author_id,
      ma_profiles!author_id ( display_name )
    `)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Add a comment to an entry. Returns the inserted row.
 * RLS pins the comment's family_id to the parent entry's own family_id and
 * requires the parent to be readable under the same audience rules — a
 * mismatched familyId here is rejected server-side, not just ignored.
 */
export async function addComment(postId, familyId, authorId, body) {
  const { data, error } = await supabase
    .from('ma_comments')
    .insert({ post_id: postId, family_id: familyId, author_id: authorId, body })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Attachments ─────────────────────────────────────────────────────────────

/**
 * Record an attachment in ma_attachments after a successful storage upload.
 */
export async function createAttachment({ postId, familyId, uploaderId, objectPath, mimeType }) {
  const { data, error } = await supabase
    .from('ma_attachments')
    .insert({
      post_id:     postId,
      family_id:   familyId,
      uploader_id: uploaderId,
      object_path: objectPath,
      mime_type:   mimeType,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Calendar events ─────────────────────────────────────────────────────────

/**
 * Fetch upcoming calendar events from the mirrored ma_calendar_events table.
 * Events are read-only; the source of truth is the family iCloud calendar,
 * synced separately into this table.
 *
 * Family-only: RLS has no care-team policy on ma_calendar_events (deliberately
 * out of scope for this PR — see apps/ma/README.md "Follow-up risks"), so a
 * caregiver's request here always returns an empty list, never an error.
 *
 * The default lower bound is the start of *today in Amsterdam*, not "now", so
 * that today's already-started events and all-day rows (stored at Amsterdam
 * midnight) are included rather than dropped as "past" — the schedule belongs
 * to the person in Amsterdam, not to the viewer's clock.
 *
 * `to` (exclusive) and `offset` exist for the Agenda view's bounded, paginated
 * six-month window (see views/calendar.js) — Today/Briefing/compose keep
 * calling this with neither, so their narrow, task-focused windows are
 * unaffected.
 */
export async function fetchEvents(familyId, { from, to, limit = 40, offset = 0 } = {}) {
  const fromDate = from ?? startOfTodayAmsISO();
  let query = supabase
    .from('ma_calendar_events')
    .select('id, external_event_uid, title, starts_at, ends_at, all_day, location, notes, external_url, status')
    .eq('family_id', familyId)
    .gte('starts_at', fromDate);
  if (to) query = query.lt('starts_at', to);
  const { data, error } = await query
    .order('starts_at', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/**
 * Most recent calendar sync time for a family (max last_synced_at across its
 * sources), or null if unknown. Feeds the today-state engine's freshness check so
 * it can suppress "go now" instructions when the mirror has gone stale.
 */
export async function fetchCalendarLastSyncedAt(familyId) {
  const { data, error } = await supabase
    .from('ma_calendar_sources')
    .select('last_synced_at')
    .eq('family_id', familyId)
    .order('last_synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.last_synced_at ?? null;
}

// ─── Briefings ────────────────────────────────────────────────────────────────

/**
 * Fetch generated briefings from today onward (Europe/Amsterdam), soonest first.
 * Texts are written only by the sync job; this app reads them and flips status.
 */
export async function fetchBriefings(familyId, { limit = 7 } = {}) {
  const { data, error } = await supabase
    .from('ma_briefings')
    .select('id, family_id, briefing_date, caren_text, whatsapp_text, status, sent_at, sent_by, generated_at')
    .eq('family_id', familyId)
    .gte('briefing_date', todayAms())
    .order('briefing_date', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Mark a briefing as sent by the current user. Returns the updated row.
 */
export async function markBriefingSent(id, userId) {
  const { data, error } = await supabase
    .from('ma_briefings')
    .update({ status: 'sent', sent_at: new Date().toISOString(), sent_by: userId })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Reopen a briefing (undo "sent"), clearing the sent metadata. Returns the row.
 */
export async function reopenBriefing(id) {
  const { data, error } = await supabase
    .from('ma_briefings')
    .update({ status: 'ready', sent_at: null, sent_by: null })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Ride notices (e-mail reconciliation) ─────────────────────────────────────

/**
 * Fetch OPEN ride-reconciliation notices for a family, soonest ride first.
 *
 * Each notice is a discrepancy the private irma-sync job found between a forwarded
 * ride e-mail and the mirrored calendar: a ride the calendar is missing, a time
 * that differs, a cancellation the calendar still shows, or an e-mail it couldn't
 * parse. Rows are written only by that job (service role); this app reads open
 * ones and lets a member dismiss them. Notices with no ride_date (unparsed
 * e-mails) sort last, after every dated one.
 *
 * Only 'open' rows are returned: once the job auto-resolves a notice (the missing
 * event now exists) or a member dismisses one, it drops out here on the next load,
 * so the strip clears itself with no further action.
 */
export async function fetchOpenRideNotices(familyId) {
  const { data, error } = await supabase
    .from('ma_ride_notices')
    .select(`
      id, kind, ride_date, driver, pickup_time, return_time,
      destination, return_place, excerpt, confidence,
      match_status, matched_event_uid, received_at
    `)
    .eq('family_id', familyId)
    .eq('state', 'open')
    .order('ride_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Dismiss a ride notice ("Negeer"): records who dismissed it and when. The
 * BEFORE UPDATE guard permits members to change only these three columns.
 * There is deliberately no "accept" — accepting a ride means opening Apple
 * Calendar and entering the event by hand, which lives outside this app.
 * Returns the updated row.
 */
export async function dismissRideNotice(id, userId) {
  const { data, error } = await supabase
    .from('ma_ride_notices')
    .update({ state: 'dismissed', dismissed_at: new Date().toISOString(), dismissed_by: userId })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Presence ────────────────────────────────────────────────────────────────

/**
 * Touch the current user's "last active" signal for this family. Safe to call
 * liberally — ma_touch_presence() throttles at the database layer (~10 min)
 * and silently no-ops for anyone who isn't an active family member or active
 * care-team member of familyId. Never sends the route/URL/title.
 */
export async function touchPresence(familyId) {
  const { error } = await supabase.rpc('ma_touch_presence', { p_family_id: familyId });
  if (error) throw error;
}

// ─── Beheer (owner-only admin dashboard) ──────────────────────────────────────
// Every function below is owner-only at the RLS/RPC layer (see
// supabase-migrations/007_ma_admin_dashboard.sql) — a non-owner request
// returns an empty result, never an error, and never a leak.

// Shared column list for both "latest run" and "one exact run" lookups (see
// fetchIntegrationRunById below, used by the request/run-correlated poll in
// views/beheer.js).
const INTEGRATION_RUN_COLUMNS = `
  id, run_key, started_at, finished_at, status, trigger_source,
  calendar_status, briefing_status, notices_status,
  events_seen, events_created, events_updated, events_unchanged, events_cancelled,
  briefings_updated, briefings_unchanged, briefings_failed,
  mail_messages_seen, mail_extract_calls, notice_rows_written,
  notices_superseded, notices_auto_resolved, mail_parse_failures,
  mail_dropped_non_ride, mail_dropped_no_excerpt, error_stage
`;

/**
 * Most recent private irma-sync pipeline run for this family, or null if none
 * has ever reported in yet (rendered as a calm "no data yet" state, not a
 * failure — see views/beheer.js).
 */
export async function fetchLatestIntegrationRun(familyId) {
  const { data, error } = await supabase
    .from('ma_integration_runs')
    .select(INTEGRATION_RUN_COLUMNS)
    .eq('family_id', familyId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * One exact integration run by id — used once a manual sync request's
 * `run_id` is known, so Beheer can poll the precise run it caused instead of
 * inferring it from "whatever's newest" (see fetchSyncRequestStatus below and
 * views/beheer.js's pollForRunByRequest). Returns null if the id doesn't
 * exist or isn't readable (RLS still applies — owner-only, as above).
 */
export async function fetchIntegrationRunById(runId) {
  const { data, error } = await supabase
    .from('ma_integration_runs')
    .select(INTEGRATION_RUN_COLUMNS)
    .eq('id', runId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Status of one owner-triggered manual sync request — polled after
 * triggerManualSync() returns a requestId, until `run_id` appears (set by the
 * private irma-sync job once it claims the request; see irma-sync's
 * classify_trigger()/ma_claim_sync_request()). Owner-only SELECT (migration
 * 009); returns null if the request doesn't exist or isn't the caller's.
 */
export async function fetchSyncRequestStatus(requestId) {
  const { data, error } = await supabase
    .from('ma_sync_requests')
    .select('id, run_id, claimed_at, dispatch_status')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Most recent calendar source sync timestamp, for the Agenda & synchronisatie
 * card (independent of ma_integration_runs, so a stale/missing run doesn't
 * also blank this — the two are cross-checked in the view, not here).
 */
export async function fetchCalendarSourceAdminStatus(familyId) {
  const { data, error } = await supabase
    .from('ma_calendar_sources')
    .select('label, last_synced_at')
    .eq('family_id', familyId)
    .order('last_synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Tomorrow's briefing (Europe/Amsterdam), if any, with who marked it sent
 * where available. Returns null when there simply isn't one yet — not
 * automatically a failure (see views/beheer.js health rules).
 */
export async function fetchTomorrowBriefingAdminStatus(familyId) {
  const tomorrow = addDaysKey(todayAms(), 1);
  const { data, error } = await supabase
    .from('ma_briefings')
    .select(`
      id, briefing_date, status, generated_at, sent_at, sent_by,
      ma_profiles!sent_by ( display_name )
    `)
    .eq('family_id', familyId)
    .eq('briefing_date', tomorrow)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Open ride-reconciliation notice count + newest received timestamp, for the
 * AutoMaatje card. Never returns sender/excerpt/driver/destination/times —
 * those must never surface in Beheer.
 */
export async function fetchRideNoticeAdminSummary(familyId) {
  const { data, error } = await supabase
    .from('ma_ride_notices')
    .select('id, received_at')
    .eq('family_id', familyId)
    .eq('state', 'open')
    .order('received_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  return { openCount: rows.length, newestReceivedAt: rows[0]?.received_at ?? null };
}

/**
 * A page of the owner-only activity timeline, newest first. Familie/Zorgteam
 * filtering happens in the view (cross-referenced against fetchAdminRoster —
 * ma_activity_events itself has no actor-role column), so this always
 * returns the raw page; only pagination lives here.
 */
export async function fetchAdminActivity(familyId, { limit = 30, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('ma_activity_events')
    .select(`
      id, occurred_at, actor_type, actor_user_id, source, action,
      object_type, object_id, severity, metadata,
      ma_profiles!actor_user_id ( display_name )
    `)
    .eq('family_id', familyId)
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/**
 * Family + care-team roster with access status and last-active/last-action
 * timestamps, via the ma_admin_roster() RPC (verifies ownership server-side;
 * returns no rows for anyone else). No email addresses, no auth metadata.
 */
export async function fetchAdminRoster(familyId) {
  const { data, error } = await supabase.rpc('ma_admin_roster', { p_family_id: familyId });
  if (error) throw error;
  return data ?? [];
}
