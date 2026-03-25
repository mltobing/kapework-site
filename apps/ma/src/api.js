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
 *   ma_calendar_sources, ma_calendar_events
 *
 * Foreign-key joins assume:
 *   ma_posts.author_id          → ma_profiles.user_id
 *   ma_comments.author_id       → ma_profiles.user_id
 *   ma_attachments.post_id      → ma_posts.id
 *   ma_family_members.user_id   → ma_profiles.user_id
 *   ma_calendar_events.source_id → ma_calendar_sources.id
 */

import { supabase } from './supabase.js';

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
 */
export async function fetchEvents(familyId, { from, limit = 40 } = {}) {
  const fromDate = from ?? new Date().toISOString();
  const { data, error } = await supabase
    .from('ma_calendar_events')
    .select('id, title, starts_at, ends_at, all_day, location, notes, external_url')
    .eq('family_id', familyId)
    .gte('starts_at', fromDate)
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
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
