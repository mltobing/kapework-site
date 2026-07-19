/**
 * src/storage.js
 *
 * File upload and signed-URL helpers for the private ma-media Supabase
 * storage bucket.
 *
 * Storage path convention:
 *   <family_id>/<post_id>/<random-uuid>.<ext>
 *
 * The bucket is private; all access goes through time-limited signed URLs,
 * and read/upload permission is enforced by Storage RLS that follows the
 * parent post's audience (see supabase-migrations/006_ma_logboek_care_team.sql)
 * — this module has no authorization logic of its own.
 */

import { supabase } from './supabase.js';

const BUCKET = 'ma-media';

/**
 * Signed URL lifetime in seconds (15 minutes).
 *
 * Deliberately short: Logboek attachments can include care observations and
 * appointment documents, not just holiday snaps. URLs are re-signed on every
 * card render (never persisted or cached beyond the DOM), so 15 minutes is
 * comfortably enough to view a photo or open a PDF without leaving a
 * long-lived link that keeps working after someone's access is revoked.
 */
const SIGNED_URL_TTL = 60 * 15;

/** Client-side upload limits — start with images and PDF only for Logboek. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'application/pdf',
];
export const ALLOWED_IMAGE_TYPES = ALLOWED_MIME_TYPES.filter(t => t.startsWith('image/'));
export const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB — comfortably under the bucket's 50 MB cap

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

/** Throws a descriptive error if the file fails client-side validation. */
export function validateFile(file, { allowedTypes = ALLOWED_MIME_TYPES } = {}) {
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`Bestandstype niet ondersteund: ${file.type || 'onbekend'}`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Bestand is te groot (max ${Math.floor(MAX_FILE_SIZE / (1024 * 1024))} MB).`);
  }
}

/**
 * Upload a file to the ma-media bucket for a given post.
 * Object names use crypto.randomUUID() — never a timestamp alone — so
 * concurrent uploads can never collide and a path can't be guessed from when
 * it was created.
 * @param {string} familyId
 * @param {string} postId
 * @param {File}   file
 * @returns {Promise<string>} The storage path of the uploaded object
 */
export async function uploadFile(familyId, postId, file) {
  validateFile(file);
  const ext  = EXT_BY_MIME[file.type] ?? 'bin';
  const path = `${familyId}/${postId}/${crypto.randomUUID()}.${ext}`;

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
 * Best-effort delete of a storage object — used to clean up an orphaned
 * upload when the ma_attachments metadata insert that should follow it
 * fails. Errors are swallowed by the caller's try/catch; this never throws
 * into a path that would block the user from recovering.
 * @param {string} storagePath
 */
export async function deleteObject(storagePath) {
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
}

/**
 * Get a time-limited signed URL for a private storage object (photo or PDF).
 * @param {string} storagePath
 * @returns {Promise<string>} Signed URL
 */
export async function getFileUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);

  if (error) throw error;
  return data.signedUrl;
}
