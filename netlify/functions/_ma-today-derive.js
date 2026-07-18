/* netlify/functions/_ma-today-derive.js
 *
 * Server-side (CommonJS) helpers for the trusted Today payload:
 *   - Amsterdam date/clock derivation via Intl (DST-safe, no offset math).
 *   - The SAME conservative title/notes parsing as apps/ma/src/lib/event-derive.js
 *     (downstairs time + contact window). The two are deliberately duplicated
 *     because Functions are CJS and the app ships without a build step to share an
 *     ES module. Keep them in sync — the regex patterns are the contract.
 *
 * Hard rule: never manufacture a time. Absent an explicit written value, return
 * null so the today-state engine emits no go-now instruction for it.
 */

const TZ = 'Europe/Amsterdam';

const AMS_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function amsParts(iso) {
  const parts = {};
  for (const p of AMS_PARTS.formatToParts(new Date(iso))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

/** `YYYY-MM-DD` Amsterdam calendar date for an instant. */
function amsDateKey(iso) {
  const p = amsParts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

// ── Conservative title/notes parsing (mirror of event-derive.js) ─────────────

const TIME = String.raw`(\d{1,2})(?:[:.u]\s*(\d{2}))?`;

function toClock(h, m) {
  const hh = Number(h);
  const mm = m == null ? 0 : Number(m);
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) return null;
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normaliseText(title, notes) {
  return `${title || ''}\n${notes || ''}`.toLowerCase();
}

function deriveDownstairsAt(title, notes) {
  const text = normaliseText(title, notes);
  const m = new RegExp(String.raw`benede\w*\b[^\d\n]{0,12}${TIME}`).exec(text);
  return m ? toClock(m[1], m[2]) : null;
}

function deriveContactWindow(title, notes) {
  const text = normaliseText(title, notes);
  const between = new RegExp(String.raw`tussen\s+${TIME}\s+en\s+${TIME}`).exec(text);
  const dashCtx = new RegExp(
    String.raw`(?:contact|bel|venster|afspraak)\w*\b[^\d\n]{0,12}${TIME}\s*[-–—]\s*${TIME}`,
  ).exec(text);
  const m = between || dashCtx;
  if (!m) return null;
  const start = toClock(m[1], m[2]);
  const end   = toClock(m[3], m[4]);
  if (!start || !end || start > end) return null;
  return { start, end };
}

/**
 * Build the sanitized, allowlisted event object for the trusted payload from a
 * raw ma_calendar_events row. Notes/external_url/status are used here but NEVER
 * returned — only the derived-safe shape leaves the server.
 */
function sanitizeEvent(row) {
  return {
    uid:           row.external_event_uid,
    title:         row.title,
    startsAt:      row.starts_at,
    endsAt:        row.ends_at ?? null,
    allDay:        row.all_day === true,
    location:      row.location ?? null,
    downstairsAt:  row.all_day ? null : deriveDownstairsAt(row.title, row.notes),
    contactWindow: row.all_day ? null : deriveContactWindow(row.title, row.notes),
  };
}

module.exports = { TZ, amsDateKey, deriveDownstairsAt, deriveContactWindow, sanitizeEvent };
