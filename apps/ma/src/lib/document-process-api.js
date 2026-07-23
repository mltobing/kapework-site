/**
 * lib/document-process-api.js
 *
 * Client wrapper for the owner-only Document Inbox start-processing Netlify
 * Function (same-origin, under /.netlify/functions) — mirrors sync-api.js's
 * pattern: sends the caller's Supabase access token as a Bearer credential so
 * the server can verify family ownership independently of RLS. Never calls
 * Anthropic from the browser — this only ever asks the server to start.
 */

import { supabase } from '../supabase.js';

const BASE = '/.netlify/functions';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Niet ingelogd');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Starts (or restarts) processing for one import. Resolves to
 * `{ ok, status }` for every recognized outcome (including "already
 * queued/processing/ready/…", which the server reports rather than
 * rejecting). Throws only on a genuine network/auth/server failure — the
 * thrown error carries `err.errorCode` when the server returned a controlled
 * one, for errorMessage() in lib/document-inbox.js to render safely.
 */
export async function startDocumentProcessing(familyId, importId) {
  const res = await fetch(`${BASE}/ma-document-process`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ familyId, importId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `ma-document-process failed (${res.status})`);
    err.status = res.status;
    err.errorCode = data?.error;
    throw err;
  }
  return data;
}
