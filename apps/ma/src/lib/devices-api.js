/**
 * src/lib/devices-api.js
 *
 * Client wrappers for the trusted-device Netlify Functions (same-origin, under
 * /.netlify/functions). These are the *authenticated* endpoints used by the
 * signed-in Apparaten screen; each sends the caller's Supabase access token as a
 * Bearer credential so the server can verify family membership.
 *
 * The device cookie itself is never touched here — it is HttpOnly and only ever
 * set/read by the server on the care recipient's device.
 */

import { supabase } from '../supabase.js';

const BASE = '/.netlify/functions';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Niet ingelogd');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function postJson(path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Create a one-time pairing for a new device. Returns
 * { pairingId, activationUrl, code, expiresAt } — shown to the creator once.
 */
export function createPairing(familyId, label) {
  return postJson('ma-pairing-create', { familyId, label });
}

/** List the family's trusted devices (no secrets). Returns an array. */
export async function listDevices(familyId) {
  const { devices } = await postJson('ma-devices-list', { familyId });
  return devices ?? [];
}

/** Revoke a device by id. Takes effect on the device's next refresh. */
export function revokeDevice(familyId, deviceId) {
  return postJson('ma-device-revoke', { familyId, deviceId });
}
