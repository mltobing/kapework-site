/**
 * src/document-storage.js
 *
 * File/text upload and signed-URL helpers for the private `ma-imports`
 * Supabase Storage bucket — the Document Inbox's immutable source snapshots.
 *
 * Deliberately separate from storage.js (the ordinary Logboek `ma-media`
 * helper): a different bucket, a different path shape
 * (`<family_id>/<import_id>/<random-uuid>.<ext>`, never the `ma-media`
 * `<family_id>/<post_id>/...` shape), different limits, and owner-only
 * access — see supabase-migrations/011_ma_document_inbox.sql. Ordinary
 * Logboek attachment upload (storage.js) is completely unaffected by this
 * module.
 *
 * Pasted text is uploaded here too, as a `text/plain` blob — every import
 * source type (pasted text, PDF, images) becomes an immutable Storage object
 * before processing starts, so there is exactly one "what did we actually
 * send" record regardless of source type.
 */

import { supabase } from './supabase.js';

export const IMPORT_BUCKET = 'ma-imports';

export const ALLOWED_IMPORT_MIME_TYPES = [
  'text/plain', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
];
const ALLOWED_IMPORT_IMAGE_TYPES = ALLOWED_IMPORT_MIME_TYPES.filter((t) => t.startsWith('image/'));

export const MAX_IMPORT_TOTAL_BYTES = 12 * 1024 * 1024; // 12 MB total per import
export const MAX_IMPORT_IMAGES = 6;
export const MAX_PASTED_TEXT_CHARS = 60_000;

const EXT_BY_MIME = {
  'text/plain':       'txt',
  'application/pdf':  'pdf',
  'image/jpeg':        'jpg',
  'image/png':        'png',
  'image/webp':       'webp',
};

// Signed URL lifetime — short by design; original import sources are
// owner-only and re-signed fresh on every render, never cached or persisted.
const SIGNED_URL_TTL = 60 * 15;

function megabytes(bytes) {
  return Math.floor(bytes / (1024 * 1024));
}

/**
 * Throws a descriptive Dutch error if the chosen source doesn't fit the
 * MVP limits for its type. Enforces mutual exclusivity by construction — the
 * caller must already have committed to exactly one of 'pasted_text', 'pdf',
 * 'images' before calling this (the New import view offers three mutually
 * exclusive modes, never a mixed one).
 *
 * @param {'pasted_text'|'pdf'|'images'} sourceType
 * @param {{ text?: string, files?: File[] }} source
 */
export function validateImportSource(sourceType, { text = '', files = [] } = {}) {
  if (sourceType === 'pasted_text') {
    const trimmed = (text || '').trim();
    if (!trimmed) throw new Error('Vul tekst in om te verwerken.');
    if (text.length > MAX_PASTED_TEXT_CHARS) {
      throw new Error(`Tekst is te lang (max ${MAX_PASTED_TEXT_CHARS.toLocaleString('nl-NL')} tekens).`);
    }
    return;
  }

  if (sourceType === 'pdf') {
    if (files.length !== 1) {
      throw new Error('Voeg precies één PDF-bestand toe.');
    }
    const [file] = files;
    if (file.type !== 'application/pdf') {
      throw new Error('Alleen een PDF-bestand is toegestaan.');
    }
    if (file.size > MAX_IMPORT_TOTAL_BYTES) {
      throw new Error(`Bestand is te groot (max ${megabytes(MAX_IMPORT_TOTAL_BYTES)} MB).`);
    }
    return;
  }

  if (sourceType === 'images') {
    if (files.length < 1 || files.length > MAX_IMPORT_IMAGES) {
      throw new Error(`Kies 1 tot ${MAX_IMPORT_IMAGES} foto's of scans.`);
    }
    for (const file of files) {
      if (!ALLOWED_IMPORT_IMAGE_TYPES.includes(file.type)) {
        throw new Error(`Bestandstype niet ondersteund: ${file.type || 'onbekend'}. Gebruik JPEG, PNG of WebP.`);
      }
    }
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
      throw new Error(`Samen zijn de bestanden te groot (max ${megabytes(MAX_IMPORT_TOTAL_BYTES)} MB).`);
    }
    return;
  }

  throw new Error('Onbekend brontype.');
}

/**
 * Upload one immutable source blob to the ma-imports bucket. Object names use
 * crypto.randomUUID() — never a timestamp or the original filename — so a
 * path can't be guessed and concurrent uploads can never collide. Uploads
 * with `upsert: false`: an import source is written once and never replaced.
 *
 * @param {string} familyId
 * @param {string} importId
 * @param {Blob|File} blob
 * @param {string} mimeType
 * @returns {Promise<string>} the Storage object path
 */
export async function uploadImportFile(familyId, importId, blob, mimeType) {
  const ext  = EXT_BY_MIME[mimeType] ?? 'bin';
  const path = `${familyId}/${importId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(IMPORT_BUCKET)
    .upload(path, blob, { contentType: mimeType, upsert: false });

  if (error) throw error;
  return path;
}

/**
 * Best-effort delete of an import source object — used when an upload fails
 * partway through and the draft import is abandoned/cancelled. Never called
 * automatically once an import has been marked 'uploaded' (see
 * apps/ma/README.md — sources are owner-deletable while draft/uploaded/failed,
 * never auto-deleted).
 * @param {string} objectPath
 */
export async function deleteImportObject(objectPath) {
  const { error } = await supabase.storage.from(IMPORT_BUCKET).remove([objectPath]);
  if (error) throw error;
}

/**
 * Time-limited signed URL for an owner-only import source object ("Bron
 * openen" in the review view). Never a public URL, never persisted.
 * @param {string} objectPath
 * @returns {Promise<string>}
 */
export async function getImportFileUrl(objectPath) {
  const { data, error } = await supabase.storage
    .from(IMPORT_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL);

  if (error) throw error;
  return data.signedUrl;
}

/**
 * SHA-256 hex digest of a Blob, via the Web Crypto API. Purely a client-side
 * convenience (e.g. a future "this looks like something you already
 * processed" hint before upload) — the server always recomputes its own
 * fingerprint over the downloaded bytes and that is the only one duplicate
 * detection ever relies on.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function sha256Blob(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
