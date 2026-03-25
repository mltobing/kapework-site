/**
 * src/storage.js
 *
 * File upload and signed-URL helpers for the private ma-media Supabase
 * storage bucket.
 *
 * Storage path convention:
 *   <family_id>/<post_id>/<timestamp>.<ext>
 *
 * The bucket is private; all access goes through time-limited signed URLs.
 */

import { supabase } from './supabase.js';

const BUCKET = 'ma-media';

/** Signed URL lifetime in seconds (24 hours) */
const SIGNED_URL_TTL = 60 * 60 * 24;

/**
 * Upload a photo file to the ma-media bucket.
 * @param {string} familyId
 * @param {string} postId
 * @param {File}   file
 * @returns {Promise<string>} The storage path of the uploaded object
 */
export async function uploadPhoto(familyId, postId, file) {
  const ext  = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${familyId}/${postId}/${Date.now()}.${ext || 'jpg'}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) throw error;
  return path;
}

/**
 * Get a time-limited signed URL for a private storage object.
 * @param {string} storagePath
 * @returns {Promise<string>} Signed URL
 */
export async function getPhotoUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);

  if (error) throw error;
  return data.signedUrl;
}
