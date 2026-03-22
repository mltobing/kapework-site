/* netlify/functions/_utils.js
 *
 * Shared utilities for Netlify Functions:
 *   - CORS helpers (locked to kapework.com and subdomains)
 *   - In-memory rate limiter (best-effort, within a warm Lambda instance)
 *   - Environment variable validation (fail-fast on misconfiguration)
 *   - Input sanitisation (strip control chars, enforce length limits)
 *   - Error logging to Supabase app_errors table
 */

// ── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost(:\d+)?|([\w-]+\.)?kapework\.com)$/;

function getCorsHeaders(origin) {
  const safe = ALLOWED_ORIGIN_RE.test(origin || '') ? origin : 'https://kapework.com';
  return {
    'Access-Control-Allow-Origin':  safe,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  };
}

function handlePreflight(event) {
  if (event.httpMethod !== 'OPTIONS') return null;
  const origin = event.headers['origin'] || '';
  return { statusCode: 204, headers: getCorsHeaders(origin), body: '' };
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
// In-memory store keyed by IP. Persists within a single warm Lambda instance.
// Not a hard guarantee across instances, but stops simple burst abuse effectively.

const _rateStore = new Map();
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip, maxRequests) {
  const now  = Date.now();
  const key  = ip || 'unknown';
  let   entry = _rateStore.get(key);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    entry = { count: 1, windowStart: now };
  } else {
    entry.count += 1;
  }
  _rateStore.set(key, entry);

  // Prune stale entries occasionally to avoid unbounded growth
  if (_rateStore.size > 500 || Math.random() < 0.01) {
    for (const [k, v] of _rateStore) {
      if (now - v.windowStart > RATE_WINDOW_MS * 2) _rateStore.delete(k);
    }
  }

  return entry.count <= maxRequests;
}

function getClientIp(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
}

// ── Environment variable validation ──────────────────────────────────────────

function requireEnvVars(...names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// ── Input sanitisation ────────────────────────────────────────────────────────

// Strip null bytes and non-printable ASCII control characters (keep \t \n \r).
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitiseString(value, maxLen) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHAR_RE, '').trim();
  return maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

// Loose email check — full validation belongs on the mail server.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email);
}

// ── Error logging ─────────────────────────────────────────────────────────────

async function logError(supabase, source, message, detail) {
  try {
    await supabase.from('app_errors').insert({
      source,
      message: String(message).slice(0, 500),
      detail:  detail ? JSON.parse(JSON.stringify(detail)) : null,
    });
  } catch {
    // Logging must never throw — fall back silently (console.error already called by caller)
  }
}

module.exports = {
  getCorsHeaders,
  handlePreflight,
  checkRateLimit,
  getClientIp,
  requireEnvVars,
  sanitiseString,
  isValidEmail,
  logError,
};
