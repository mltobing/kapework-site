/**
 * lib/calendar-write-api.js
 *
 * Client wrapper for the owner-only calendar-write-request Netlify Function
 * (same-origin, under /.netlify/functions) — mirrors sync-api.js/document-
 * process-api.js's pattern: sends the caller's Supabase access token as a
 * Bearer credential so the server can verify family ownership independently
 * of RLS. Never talks to CalDAV or GitHub directly, and never sends a
 * service-role key — the browser only ever gets an authenticated user token.
 */

import { supabase } from '../supabase.js';
import { fetchCalendarWriteRequest, fetchCalendarWriteItems } from '../api.js';

const BASE = '/.netlify/functions';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Niet ingelogd');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Submit an owner-confirmed calendar-write request for a reviewed notice.
 * `events` is the owner-reviewed, editable event list (1-2 for a ride,
 * exactly 1 for an appointment) — the server re-validates every field and
 * re-loads the source notice itself; nothing here is trusted at face value.
 *
 * Resolves to `{ ok, requestId, status }` for every recognized outcome
 * (including reattaching to an existing request — "duplicate/existing" is
 * not an error). Throws only on a genuine network/auth/server failure; the
 * thrown error carries `err.errorCode` when the server returned a
 * controlled one, for calendarWriteErrorMessage() to render safely.
 */
export async function requestCalendarWrite({ familyId, sourceKind, noticeId, events, confirmedEditedFields }) {
  const res = await fetch(`${BASE}/ma-calendar-write-request`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ familyId, sourceKind, noticeId, events, confirmedEditedFields }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `ma-calendar-write-request failed (${res.status})`);
    err.status = res.status;
    err.errorCode = data?.error;
    throw err;
  }
  return data;
}

/**
 * Poll one calendar-write request (owner-only, via RLS — no separate GET
 * function) until it reaches a final status or `timeoutMs` elapses. Calls
 * `onUpdate({ request, items })` on every tick. Cancels automatically once
 * `el.isConnected` is false (the view was left), same convention as
 * views/beheer.js's sync polling. A timeout calls `onTimeout()` but never
 * marks the backend failed — the request keeps running server-side; the UI
 * is just done waiting.
 *
 * @param {HTMLElement} el — polling stops once this element leaves the DOM
 * @param {string} requestId
 * @param {(state: { request: object, items: object[] }) => void} onUpdate
 * @param {() => void} onTimeout
 * @param {{ intervalMs?: number, timeoutMs?: number }} [opts]
 * @returns {() => void} cancel — call to stop polling immediately
 */
export function pollCalendarWrite(el, requestId, onUpdate, onTimeout, { intervalMs = 2000, timeoutMs = 5 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let cancelled = false;
  let timer = null;

  async function tick() {
    if (cancelled || !el.isConnected) return;
    if (Date.now() > deadline) { onTimeout(); return; }

    let request = null;
    try {
      request = await fetchCalendarWriteRequest(requestId);
    } catch (err) {
      console.error('[ma/calendar-write-api] Poll for request failed:', err);
      timer = setTimeout(tick, intervalMs);
      return;
    }

    if (!request) {
      timer = setTimeout(tick, intervalMs);
      return;
    }

    let items = [];
    try {
      items = await fetchCalendarWriteItems(requestId);
    } catch (err) {
      console.error('[ma/calendar-write-api] Poll for items failed:', err);
    }

    onUpdate({ request, items });

    if (['success', 'partial', 'failed', 'cancelled'].includes(request.status)) return;
    timer = setTimeout(tick, intervalMs);
  }

  timer = setTimeout(tick, intervalMs);

  return function cancel() {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

// ─── Controlled error copy (brief §15) ───────────────────────────────────────
// Never a raw vendor/database error — every screen that shows a
// calendar-write error routes it through calendarWriteErrorMessage().

const ERROR_COPY = {
  invalid_notice:          'Deze melding kan niet meer worden toegevoegd. Ververs de pagina.',
  invalid_event:           'Controleer de ingevulde datum, tijden, titel en locatie.',
  outside_calendar_window: 'Deze datum ligt te ver in het verleden of de toekomst.',
  already_processing:      'Wordt al aan de agenda toegevoegd.',
  uid_conflict:            'Er staat al iets anders op dit moment in de agenda. Neem contact op met de beheerder.',
  caldav_unavailable:      'De agenda is nu niet bereikbaar. Probeer het later opnieuw.',
  calendar_write_failed:   'Kon niet aan de agenda worden toegevoegd. Probeer het opnieuw.',
  mirror_failed:           'Toegevoegd, maar Ma kon de agenda nog niet volledig verversen.',
  dispatch_failed:         'Kon de aanvraag niet versturen. Probeer het opnieuw.',
  server_error:            'Er ging iets mis. Probeer het opnieuw.',
  not_authorized:          'Je hebt geen toegang tot deze actie.',
  rate_limited:            'Te veel pogingen. Probeer het over een minuut opnieuw.',
};

const FALLBACK_ERROR_MESSAGE = 'Er ging iets mis. Probeer het opnieuw.';

/** Maps a controlled error_code to safe Dutch copy — never renders a raw code. */
export function calendarWriteErrorMessage(errorCode) {
  return ERROR_COPY[errorCode] ?? FALLBACK_ERROR_MESSAGE;
}
