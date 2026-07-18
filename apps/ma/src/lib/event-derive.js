/**
 * src/lib/event-derive.js
 *
 * Deterministic, conservative extraction of two *optional* safe fields from a
 * calendar event's free-text title/notes:
 *
 *   - downstairsAt  — an explicitly written "naar beneden" time (when the care
 *                     recipient should go down to meet a ride). Returned ONLY
 *                     when a time is literally present next to that phrase.
 *   - contactWindow — an explicitly written time window ("tussen 8:30 en 9:00").
 *                     A window stays a window; its start is never an arrival time.
 *
 * Hard rule: never manufacture a time. If nothing explicit is written, return
 * null. The today-state engine treats null as "no such time" and will not emit a
 * go-now instruction for it. Both values are bare Amsterdam wall-clock "HH:MM"
 * strings (the calendar is authored in Amsterdam local time).
 *
 * NOTE: the trusted-device server payload (netlify/functions/_ma-today-derive.js)
 * intentionally re-implements these exact patterns in CommonJS, because the
 * Netlify Functions runtime is CJS and this app ships with no build step to share
 * one ES module across both. Keep the two in sync; the patterns are the contract.
 */

// A single clock time: 8:45, 08.45, 8u45, 8 uur. Captures hour and (optional) min.
const TIME = String.raw`(\d{1,2})(?:[:.u]\s*(\d{2}))?`;

/** Normalise a captured (hour, minute) pair to "HH:MM", or null if out of range. */
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

/**
 * Explicit "naar beneden" time, or null.
 * Matches e.g. "naar beneden om 8:45", "beneden: 08.45", "naar beneden 8u45".
 * Requires the phrase and a time close together — never a bare appointment time.
 */
export function deriveDownstairsAt(title, notes) {
  const text = normaliseText(title, notes);
  const re = new RegExp(String.raw`benede\w*\b[^\d\n]{0,12}${TIME}`);
  const m = re.exec(text);
  return m ? toClock(m[1], m[2]) : null;
}

/**
 * Explicit contact/afspraak window "{start}–{end}", or null.
 * Matches "tussen 8:30 en 9:00", "contact tussen 8.30-9.00", "venster 8:30 – 9:00".
 * Returns { start, end } only when both ends parse and start <= end.
 */
export function deriveContactWindow(title, notes) {
  const text = normaliseText(title, notes);
  // "tussen A en B"  |  "A - B" following a context word (contact/bel/venster/tussen)
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
 * Map a raw ma_calendar_events row into the sanitized shape the today-state
 * engine consumes — deriving the two safe fields and DROPPING notes entirely.
 * Used by the signed-in Today view (which reads events client-side). The trusted
 * server payload builds the same shape server-side.
 */
export function sanitizeEventForState(row) {
  return {
    uid:           row.external_event_uid ?? row.id ?? null,
    title:         row.title ?? '',
    startsAt:      row.starts_at,
    endsAt:        row.ends_at ?? null,
    allDay:        row.all_day === true,
    location:      row.location ?? null,
    status:        row.status ?? 'confirmed',
    downstairsAt:  row.all_day ? null : deriveDownstairsAt(row.title, row.notes),
    contactWindow: row.all_day ? null : deriveContactWindow(row.title, row.notes),
  };
}
