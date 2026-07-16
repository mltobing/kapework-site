/**
 * src/api.js
 *
 * All Supabase table queries for the Ma app.
 *
 * Every external call lives here — not scattered through UI components.
 * This layer is where caching, retries, and error surfacing would grow.
 *
 * Expected Supabase schema:
 *   ma_families, ma_profiles, ma_family_members,
 *   ma_posts, ma_comments, ma_attachments,
 *   ma_calendar_sources, ma_calendar_events, ma_briefings
 *
 * Foreign-key joins assume:
 *   ma_posts.author_id          → ma_profiles.user_id
 *   ma_comments.author_id       → ma_profiles.user_id
 *   ma_attachments.post_id      → ma_posts.id
 *   ma_family_members.user_id   → ma_profiles.user_id
 *   ma_calendar_events.source_id → ma_calendar_sources.id
 */

import { supabase } from './supabase.js';
import { todayAms, startOfTodayAmsISO } from './lib/datetime.js';

// ─── Profile & family membership ────────────────────────────────────────────

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
 * Fetch the family_id for a given auth user id.
 * Returns null if the user is not a member of any family.
 */
export async function fetchFamilyId(userId) {
  const { data, error } = await supabase
    .from('ma_family_members')
    .select('family_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.family_id ?? null;
}

// ─── Posts ───────────────────────────────────────────────────────────────────

/**
 * Fetch recent family posts, newest first.
 */
export async function fetchPosts(familyId, { limit = 20, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('ma_posts')
    .select(`
      id, title, body, kind, event_date, pinned, created_at, author_id,
      ma_profiles!author_id ( display_name, relationship, avatar_url ),
      ma_attachments ( id, object_path, mime_type )
    `)
    .eq('family_id', familyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch pinned posts for the Today view.
 */
export async function fetchPinnedPosts(familyId, { limit = 3 } = {}) {
  const { data, error } = await supabase
    .from('ma_posts')
    .select(`
      id, title, body, kind, pinned, created_at, author_id,
      ma_profiles!author_id ( display_name, relationship, avatar_url ),
      ma_attachments ( id, object_path, mime_type )
    `)
    .eq('family_id', familyId)
    .eq('pinned', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Create a new post. Returns the inserted row.
 */
export async function createPost({ familyId, authorId, kind = 'note', title = null, body = null }) {
  const { data, error } = await supabase
    .from('ma_posts')
    .insert({ family_id: familyId, author_id: authorId, kind, title, body })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Comments ────────────────────────────────────────────────────────────────

/**
 * Fetch all comments for a post, oldest first.
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
 * Add a comment to a post. Returns the inserted row.
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

// ─── Photos ──────────────────────────────────────────────────────────────────

/**
 * Fetch photo posts (kind = 'photo') with their attachments.
 * Returns a flat list of attachment objects, each with a ma_posts property.
 */
export async function fetchPhotos(familyId, { limit = 60, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('ma_posts')
    .select(`
      id, body, title, author_id, created_at,
      ma_profiles!author_id ( display_name ),
      ma_attachments ( id, object_path, mime_type )
    `)
    .eq('family_id', familyId)
    .eq('kind', 'photo')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  // Flatten: one entry per image attachment
  return (data ?? []).flatMap(post =>
    (post.ma_attachments ?? [])
      .filter(a => a.mime_type?.startsWith('image/'))
      .map(a => ({ ...a, ma_posts: post }))
  );
}

// ─── Calendar events ─────────────────────────────────────────────────────────

/**
 * Fetch upcoming calendar events from the mirrored ma_calendar_events table.
 * Events are read-only; the source of truth is the family iCloud calendar,
 * synced separately into this table.
 *
 * The default lower bound is the start of *today in Amsterdam*, not "now", so
 * that today's already-started events and all-day rows (stored at Amsterdam
 * midnight) are included rather than dropped as "past" — the schedule belongs
 * to the person in Amsterdam, not to the viewer's clock.
 */
export async function fetchEvents(familyId, { from, limit = 40 } = {}) {
  const fromDate = from ?? startOfTodayAmsISO();
  const { data, error } = await supabase
    .from('ma_calendar_events')
    .select('id, external_event_uid, title, starts_at, ends_at, all_day, location, notes, external_url')
    .eq('family_id', familyId)
    .gte('starts_at', fromDate)
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
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

// ─── People ──────────────────────────────────────────────────────────────────

/**
 * Fetch family member profiles.
 */
export async function fetchPeople(familyId) {
  const { data, error } = await supabase
    .from('ma_family_members')
    .select(`
      role, created_at,
      ma_profiles!user_id ( user_id, display_name, relationship, avatar_url )
    `)
    .eq('family_id', familyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).filter(m => m.ma_profiles);
}
