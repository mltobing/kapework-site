/**
 * lib/sync-api.js
 *
 * Client wrapper for the owner-only manual-sync-request Netlify Function
 * (same-origin, under /.netlify/functions) — mirrors devices-api.js's
 * pattern: sends the caller's Supabase access token as a Bearer credential
 * so the server can verify family ownership.
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
 * Request an immediate calendar/briefing/AutoMaatje sync.
 * Returns `{ ok, status: 'queued'|'already_running'|'cooldown', ... }`. Never
 * throws for the expected outcomes — the server treats "already running" and
 * "cooldown" as normal, not errors — but does throw on a real network/auth
 * failure so the caller can show a generic retry message.
 */
export async function triggerManualSync(familyId) {
  const res = await fetch(`${BASE}/ma-sync-trigger`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ familyId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `ma-sync-trigger failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
