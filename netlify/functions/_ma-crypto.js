/* netlify/functions/_ma-crypto.js
 *
 * Dependency-free (stdlib crypto only) security primitives for trusted devices,
 * split out from _ma-devices.js so they can be unit-tested without the Supabase
 * SDK. Nothing here touches the network or the database.
 *
 *   - Only SHA-256(secret + pepper) is ever produced for storage/comparison.
 *   - Raw tokens/codes exist only in transit and in the HttpOnly cookie.
 */

const crypto = require('crypto');

const DEVICE_COOKIE  = 'ma_today_device';
const MA_ORIGIN      = 'https://ma.kapework.com';
const DEVICE_TTL_MS  = 365 * 24 * 60 * 60 * 1000; // 1 year
const PAIRING_TTL_MS = 15 * 60 * 1000;            // 15 minutes

function hashSecret(raw, pepper) {
  return crypto.createHash('sha256').update(`${raw}${pepper}`, 'utf8').digest('hex');
}

/** URL-safe high-entropy token (default 32 bytes → 43 chars base64url). */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Cryptographically-random 6-digit code, zero-padded. */
function randomCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** The long-lived device cookie. HttpOnly so JS can never read the raw token. */
function deviceCookie(rawToken) {
  const maxAge = Math.floor(DEVICE_TTL_MS / 1000);
  return `${DEVICE_COOKIE}=${rawToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

module.exports = {
  DEVICE_COOKIE,
  MA_ORIGIN,
  DEVICE_TTL_MS,
  PAIRING_TTL_MS,
  hashSecret,
  randomToken,
  randomCode,
  parseCookies,
  deviceCookie,
};
