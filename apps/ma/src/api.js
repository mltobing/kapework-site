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
import { loadLogboekFeedPage, hydrateLogboekEntries } from './lib/logboek-feed.js';

// Scalar columns only — deliberately no embedded relationships. PostgREST
// fails an *entire* query when a select embeds a relationship it can't
// resolve (a table a migration hasn't created yet, an ambiguous FK path,
// whatever) — see lib/logboek-feed.js's module comment for the full
// reasoning. Author profile, attachments, and provenance are hydrated
// separately and independently by loadLogboekFeedPage()/hydrateLogboekEntries()
// so that a broken *optional* relationship can never blank the feed itself.
const LOGBOEK_CORE_COLUMNS = `
  id, title, body, kind, audience, tags, event_date, linked_event_uid,
  pinned, created_at, updated_at, author_id
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
 * @param {'created_at'|'event_date'} [opts.sort='created_at'] — 'event_date' sorts
 *   historical/imported entries by the date they concern (nulls last, tie-broken
 *   by created_at desc) rather than by when they were added — see
 *   lib/document-inbox.js's validateSortOption() and views/logboek.js's
 *   "Sorteren" control.
 * @returns {Promise<{ entries: object[], usedSortFallback: boolean }>} —
 *   `usedSortFallback` is true when an 'event_date' sort failed at runtime and
 *   the page was retried once with 'created_at' instead (see
 *   lib/logboek-feed.js) — the view shows a small non-blocking notice for
 *   this, never a silently-wrong sort order.
 */
export async function fetchLogboekEntries(familyId, {
  limit = 20, offset = 0, kind = null, audience = null,
  authorId = null, search = null, dateFrom = null, dateTo = null,
  sort = 'created_at',
} = {}) {
  return loadLogboekFeedPage({
    sort,
    fetchCorePage: (effectiveSort) => fetchLogboekCorePage(familyId, {
      limit, offset, kind, audience, authorId, search, dateFrom, dateTo, sort: effectiveSort,
    }),
    fetchProfiles: fetchProfilesForAuthors,
    fetchAttachments: fetchAttachmentsForPosts,
    fetchProvenance: fetchPostSourcesByPostId,
  });
}

/**
 * The core Logboek page query — scalar ma_posts columns only, no embedded
 * relationships (see LOGBOEK_CORE_COLUMNS). A failure here is authoritative
 * and propagates; loadLogboekFeedPage() (lib/logboek-feed.js) is what applies
 * the one-time event_date → created_at sort fallback around it.
 */
async function fetchLogboekCorePage(familyId, {
  limit, offset, kind, audience, authorId, search, dateFrom, dateTo, sort,
}) {
  let query = supabase
    .from('ma_posts')
    .select(LOGBOEK_CORE_COLUMNS)
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

  query = sort === 'event_date'
    ? query.order('event_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    : query.order('created_at', { ascending: false });

  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/**
 * Author profile (display_name/relationship/avatar_url) for a set of author
 * ids, keyed by user_id. A separate query rather than a PostgREST embed —
 * see LOGBOEK_CORE_COLUMNS's comment. Left to throw naturally; the caller
 * (loadLogboekFeedPage/hydrateLogboekEntries) is what catches and swallows a
 * failure here.
 * @param {string[]} authorIds
 * @returns {Promise<Map<string, { display_name: string, relationship: string|null, avatar_url: string|null }>>}
 */
async function fetchProfilesForAuthors(authorIds) {
  if (!authorIds.length) return new Map();
  const { data, error } = await supabase
    .from('ma_profiles')
    .select('user_id, display_name, relationship, avatar_url')
    .in('user_id', authorIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.user_id, row]));
}

/**
 * Attachments (id/object_path/mime_type) for a set of post ids, grouped by
 * post_id. A separate query rather than a PostgREST embed — see
 * LOGBOEK_CORE_COLUMNS's comment. Left to throw naturally; the caller is
 * what catches and swallows a failure here.
 * @param {string[]} postIds
 * @returns {Promise<Map<string, Array<{ id: string, object_path: string, mime_type: string|null }>>>}
 */
async function fetchAttachmentsForPosts(postIds) {
  if (!postIds.length) return new Map();
  const { data, error } = await supabase
    .from('ma_attachments')
    .select('id, post_id, object_path, mime_type')
    .in('post_id', postIds);
  if (error) throw error;
  const byPostId = new Map();
  for (const row of data ?? []) {
    if (!byPostId.has(row.post_id)) byPostId.set(row.post_id, []);
    byPostId.get(row.post_id).push({ id: row.id, object_path: row.object_path, mime_type: row.mime_type });
  }
  return byPostId;
}

/**
 * Provenance metadata (source_label/source_locator) for a set of post ids,
 * keyed by post_id. A separate query rather than a PostgREST embed on
 * ma_posts: an embed targeting a relationship that doesn't exist yet (e.g.
 * before migration 011 is applied) fails the *entire* query, taking down the
 * whole Logboek feed — and even createLogboekEntry/updateLogboekEntry, since
 * they `.select()` a column list back. Provenance is a small display-only
 * enhancement, never something the feed itself should depend on to render
 * at all. Left to throw naturally here; loadLogboekFeedPage()/
 * hydrateLogboekEntries() (lib/logboek-feed.js) is what catches and swallows
 * a failure — this must stay a separate, best-effort lookup permanently,
 * not just during migration 011's rollout.
 * @param {string[]} postIds
 * @returns {Promise<Map<string, { source_label: string, source_locator: string|null }>>}
 */
async function fetchPostSourcesByPostId(postIds) {
  if (!postIds.length) return new Map();
  const { data, error } = await supabase
    .from('ma_post_sources')
    .select('post_id, source_label, source_locator')
    .in('post_id', postIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.post_id, row]));
}

const logboekHydrationDeps = {
  fetchProfiles: fetchProfilesForAuthors,
  fetchAttachments: fetchAttachmentsForPosts,
  fetchProvenance: fetchPostSourcesByPostId,
};

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
 * what they render. Same resilient core/hydration split as
 * fetchLogboekEntries(); unlike that function, callers here never need the
 * sort fallback flag (always sorted by created_at), so this returns the
 * entry array directly.
 */
export async function fetchRecentLogboekEntries(familyId, { limit = 15, audience = null } = {}) {
  const { entries } = await loadLogboekFeedPage({
    sort: 'created_at',
    fetchCorePage: () => fetchLogboekCorePage(familyId, {
      limit, offset: 0, kind: null, audience, authorId: null, search: null, dateFrom: null, dateTo: null,
      sort: 'created_at',
    }),
    ...logboekHydrationDeps,
  });
  return entries;
}

/**
 * Create a new Logboek entry. `audience` defaults to 'family' — family-only
 * is always the safe default; callers must opt into 'care_team' explicitly.
 * The insert itself is the authoritative step and its failure always
 * propagates; the returned row is hydrated with the same best-effort
 * profile/attachment/provenance lookups as the feed, so an unavailable
 * enrichment table can never turn a successful create into a thrown error.
 * Returns the hydrated inserted row.
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
    .select(LOGBOEK_CORE_COLUMNS)
    .single();
  if (error) throw error;
  const [hydrated] = await hydrateLogboekEntries([data], logboekHydrationDeps);
  return hydrated;
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
 * Same hydration guarantee as createLogboekEntry(): the update is
 * authoritative and its failure propagates, but the returned row's
 * profile/attachment/provenance hydration is best-effort. Returns the
 * hydrated updated row.
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
    .select(LOGBOEK_CORE_COLUMNS)
    .single();
  if (error) throw error;
  const [hydrated] = await hydrateLogboekEntries([data], logboekHydrationDeps);
  return hydrated;
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
    .not('last_synced_at', 'is', null)
    .order('last_synced_at', { ascending: false, nullsFirst: false })
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

// ─── Appointment notices (provider e-mail reconciliation) ─────────────────────
// A second, independent mail-reconciliation strip alongside ride notices —
// see supabase-migrations/012_ma_calendar_actions_and_appointment_notices.sql.
// Written only by the private irma-sync job (service role); this app reads
// open ones and lets a member dismiss them, exactly like ride notices.

/**
 * Fetch OPEN provider-appointment notices for a family, soonest appointment
 * first. Notices with no appointment_date (unparsed e-mails) sort last.
 */
export async function fetchOpenAppointmentNotices(familyId) {
  const { data, error } = await supabase
    .from('ma_appointment_notices')
    .select(`
      id, kind, provider_label, appointment_date, start_time, end_time,
      practitioner, location, excerpt, confidence,
      match_status, matched_event_uid, received_at
    `)
    .eq('family_id', familyId)
    .eq('state', 'open')
    .order('appointment_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Dismiss a provider appointment notice ("Negeer"). The BEFORE UPDATE guard
 * (migration 012) permits members to change only state/dismissed_by/
 * dismissed_at. Returns the updated row.
 */
export async function dismissAppointmentNotice(id, userId) {
  const { data, error } = await supabase
    .from('ma_appointment_notices')
    .update({ state: 'dismissed', dismissed_at: new Date().toISOString(), dismissed_by: userId })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Owner-confirmed calendar-write requests ──────────────────────────────────
// Rows are created by the ma-calendar-write-request Netlify Function
// (owner-authenticated) and updated by the private irma-sync job (service
// role) — this app only ever reads them, via owner-only RLS, to poll status.
// See lib/calendar-write-api.js for the client wrapper that creates a request.

const CALENDAR_WRITE_REQUEST_COLUMNS = `
  id, family_id, source_kind, ride_notice_id, appointment_notice_id,
  status, dispatch_status, write_status, mirror_status, error_code,
  requested_at, dispatched_at, finished_at
`;

/** One calendar-write request by id, for polling — owner-only (RLS), null if not found/not readable. */
export async function fetchCalendarWriteRequest(requestId) {
  const { data, error } = await supabase
    .from('ma_calendar_write_requests')
    .select(CALENDAR_WRITE_REQUEST_COLUMNS)
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** This request's items (1-2), in sequence order — owner-only (RLS). */
export async function fetchCalendarWriteItems(requestId) {
  const { data, error } = await supabase
    .from('ma_calendar_write_items')
    .select('id, sequence_no, title, starts_at, ends_at, location, status, error_code')
    .eq('request_id', requestId)
    .order('sequence_no', { ascending: true });
  if (error) throw error;
  return data ?? [];
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
 * Most recent private irma-sync run of one specific trigger type ('schedule'
 * or 'manual') for this family — lets Beheer show the latest automatic run
 * and the latest manual run as two separate, persistent lines instead of one
 * ambiguous "last attempt" (see views/beheer.js). Returns null if that
 * trigger type has never run yet for this family.
 */
export async function fetchLatestIntegrationRunByTrigger(familyId, triggerSource) {
  if (triggerSource !== 'schedule' && triggerSource !== 'manual') {
    throw new Error(`fetchLatestIntegrationRunByTrigger: triggerSource must be 'schedule' or 'manual', got ${JSON.stringify(triggerSource)}`);
  }
  const { data, error } = await supabase
    .from('ma_integration_runs')
    .select(INTEGRATION_RUN_COLUMNS)
    .eq('family_id', familyId)
    .eq('trigger_source', triggerSource)
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
    .not('last_synced_at', 'is', null)
    .order('last_synced_at', { ascending: false, nullsFirst: false })
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

// ─── Document Inbox (owner-only) ───────────────────────────────────────────
// Every function below is owner-only at the RLS layer (see
// supabase-migrations/011_ma_document_inbox.sql) — a non-owner request
// returns nothing (or is rejected outright by an RPC), never another
// family's data. Never returns the source body/bytes — only metadata, the
// AI's summary/warnings, and (for candidates) the model's proposed text,
// which the owner reviews before anything reaches ma_posts.

const DOCUMENT_IMPORT_COLUMNS = `
  id, family_id, created_by, audience, source_type, source_label, document_date,
  status, source_hash, duplicate_of, document_summary, document_warnings,
  model, prompt_version, input_tokens, output_tokens, candidate_count,
  error_code, processing_started_at, processed_at, completed_at,
  created_at, updated_at
`;

const DOCUMENT_CANDIDATE_COLUMNS = `
  id, import_id, sequence_no, status, event_date, date_basis, date_confidence,
  kind, title, body, audience, tags, source_locator, source_excerpt, warnings,
  follow_up, post_id, created_at, updated_at
`;

/**
 * Create a new Document Inbox import row (status 'draft'). The owner-selected
 * `audience` becomes the default every resulting candidate inherits — the AI
 * never chooses it. Returns the inserted row.
 */
export async function createDocumentImport({
  familyId, createdBy, audience, sourceType, sourceLabel, documentDate = null,
}) {
  const { data, error } = await supabase
    .from('ma_document_imports')
    .insert({
      family_id: familyId,
      created_by: createdBy,
      audience,
      source_type: sourceType,
      source_label: sourceLabel,
      document_date: documentDate,
    })
    .select(DOCUMENT_IMPORT_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Record one uploaded source object's metadata. RLS only allows this while
 * the parent import is still 'draft'. Returns the inserted row.
 */
export async function createDocumentImportFile({
  importId, familyId, uploadedBy, sequenceNo, objectPath, mimeType, sizeBytes, originalFilename = null,
}) {
  const { data, error } = await supabase
    .from('ma_document_import_files')
    .insert({
      import_id: importId,
      family_id: familyId,
      uploaded_by: uploadedBy,
      sequence_no: sequenceNo,
      object_path: objectPath,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      original_filename: originalFilename,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Marks a draft import 'uploaded' once every source object has been written.
 * Only ever transitions draft → uploaded — never marks an import queued,
 * ready, or completed (those transitions are server-side only, driven by
 * ma-document-process / the background worker). Returns null if the import
 * wasn't in 'draft' (e.g. a duplicate call), the updated row otherwise.
 */
export async function markDocumentImportUploaded(importId) {
  const { data, error } = await supabase
    .from('ma_document_imports')
    .update({ status: 'uploaded' })
    .eq('id', importId)
    .eq('status', 'draft')
    .select(DOCUMENT_IMPORT_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Owner-only imports for this family, newest first. Never the source body. */
export async function fetchDocumentImports(familyId, { limit = 20, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('ma_document_imports')
    .select(DOCUMENT_IMPORT_COLUMNS)
    .eq('family_id', familyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/** One import's processing metadata/status/summary/warnings/token counts. */
export async function fetchDocumentImport(importId) {
  const { data, error } = await supabase
    .from('ma_document_imports')
    .select(DOCUMENT_IMPORT_COLUMNS)
    .eq('id', importId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The source object metadata (not the bytes) for one import, in upload order. */
export async function fetchDocumentImportFiles(importId) {
  const { data, error } = await supabase
    .from('ma_document_import_files')
    .select('id, sequence_no, object_path, mime_type, size_bytes, original_filename, created_at')
    .eq('import_id', importId)
    .order('sequence_no', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Draft candidates for one import, in the order the AI proposed them. */
export async function fetchDocumentCandidates(importId) {
  const { data, error } = await supabase
    .from('ma_document_candidates')
    .select(DOCUMENT_CANDIDATE_COLUMNS)
    .eq('import_id', importId)
    .order('sequence_no', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Owner edit of one still-pending-or-rejected candidate — date/type/title/
 * body/audience/tags, and a status move between 'pending' and 'rejected'
 * only. Goes through the ma_save_document_candidate() RPC, which re-verifies
 * ownership and every field constraint server-side; this can never set a
 * candidate 'approved'. Returns the updated row.
 */
export async function saveDocumentCandidate(candidateId, {
  eventDate, dateBasis, dateConfidence, kind, title, body, audience, tags, status,
}) {
  const { data, error } = await supabase.rpc('ma_save_document_candidate', {
    p_candidate_id:    candidateId,
    p_event_date:      eventDate,
    p_date_basis:      dateBasis,
    p_date_confidence: dateConfidence,
    p_kind:            kind,
    p_title:           title,
    p_body:            body,
    p_audience:        audience,
    p_tags:            tags ?? [],
    p_status:          status,
  });
  if (error) throw error;
  return data;
}

/**
 * Owner approval of one or more selected pending candidates — one
 * transactional, idempotent RPC call. Creates one ordinary `ma_posts` row
 * (the approving owner as author) plus one `ma_post_sources` provenance row
 * per newly-approved candidate; a repeated call with the same ids returns the
 * same mapping rather than creating duplicates. Returns an array of
 * `{ candidate_id, post_id }`.
 */
export async function approveDocumentCandidates(importId, candidateIds) {
  const { data, error } = await supabase.rpc('ma_approve_document_candidates', {
    p_import_id:     importId,
    p_candidate_ids: candidateIds,
  });
  if (error) throw error;
  return data ?? [];
}
