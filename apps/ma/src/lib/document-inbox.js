/**
 * lib/document-inbox.js
 *
 * Pure, DOM-free helpers for the Document Inbox: safe Dutch copy for
 * controlled error codes and import statuses, the review screen's polling
 * stop condition, candidate-form field normalization, Logboek sort-option
 * validation, and provenance-line formatting. Kept dependency-free so it can
 * be unit tested directly (see lib/document-inbox.test.mjs) — no Supabase
 * client, no DOM.
 */

// ─── Controlled error copy (section 17) ──────────────────────────────────────
// One mapping, not scattered strings. Every screen that shows a Document
// Inbox error routes it through errorMessage() — never a raw error_code, and
// never a raw Anthropic/Supabase/Netlify/SQL error.

const ERROR_COPY = {
  config_error:           'De verwerkingsdienst is niet goed ingesteld. Neem contact op met de beheerder.',
  not_authorized:         'Je hebt geen toegang tot deze actie.',
  invalid_state:          'Dit document kan nu niet worden verwerkt.',
  source_missing:         'Het bronbestand ontbreekt. Voeg het document opnieuw toe.',
  unsupported_type:       'Dit bestandstype kan niet worden verwerkt.',
  too_many_files:         'Te veel bestanden in dit document.',
  source_too_large:       'Dit document is te groot om veilig te verwerken.',
  duplicate_source:       'Dit document is al eerder verwerkt.',
  too_many_tokens:        'Dit document bevat te veel informatie voor één verwerking. Splits het in kleinere delen.',
  anthropic_rate_limited: 'De verwerkingsdienst is tijdelijk druk. Probeer het later opnieuw.',
  anthropic_rejected:     'Het document kon niet door de verwerkingsdienst worden geaccepteerd.',
  anthropic_unavailable:  'De verwerkingsdienst is tijdelijk niet bereikbaar.',
  output_truncated:       'De voorstellen waren te lang om volledig te verwerken. Probeer het opnieuw of splits het document.',
  invalid_output:         'De voorstellen konden niet betrouwbaar worden opgebouwd. Probeer het opnieuw of verwerk het document handmatig.',
  dispatch_failed:        'De verwerking kon niet worden gestart. Probeer het opnieuw.',
  server_error:           'Er ging iets mis tijdens de verwerking. Probeer het later opnieuw.',
};

const FALLBACK_ERROR_MESSAGE = 'Er ging iets mis. Probeer het opnieuw.';

/** Maps a controlled error_code to safe Dutch copy — never renders a raw code. */
export function errorMessage(errorCode) {
  return ERROR_COPY[errorCode] ?? FALLBACK_ERROR_MESSAGE;
}

// A duplicate can't sensibly be retried (nothing changed about the source);
// an authorization failure means retrying won't help either.
const NON_RETRYABLE_ERRORS = new Set(['duplicate_source', 'not_authorized']);

/** Whether a "Probeer opnieuw" action should be offered for this error code. */
export function isRetryableError(errorCode) {
  return !NON_RETRYABLE_ERRORS.has(errorCode);
}

// ─── Import status labels ────────────────────────────────────────────────────

const STATUS_LABELS = {
  draft:      'Concept',
  uploaded:   'Geüpload',
  queued:     'In wachtrij',
  processing: 'Wordt verwerkt',
  ready:      'Klaar voor controle',
  completed:  'Beoordeeld',
  failed:     'Mislukt',
  duplicate:  'Eerder verwerkt',
  cancelled:  'Geannuleerd',
};

/** Calm Dutch status label — falls back to the raw status for an unknown value. */
export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

// The review/progress screen keeps polling while the import is in flight;
// every other status is a resting state.
const POLLING_STATUSES = new Set(['queued', 'processing']);

/** Whether the review/progress screen should keep polling this import status. */
export function shouldPoll(status) {
  return POLLING_STATUSES.has(status);
}

// ─── Source type labels ──────────────────────────────────────────────────────

export const SOURCE_TYPE_LABELS = {
  pasted_text: 'Geplakte tekst',
  pdf:         'PDF-document',
  images:      "Foto's/scans",
};

export function sourceTypeLabel(sourceType) {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
}

// ─── Candidate field normalization ───────────────────────────────────────────

/**
 * Normalizes the raw values collected from a candidate edit form into the
 * shape saveDocumentCandidate() sends to the RPC: a blank title becomes
 * null, tags are trimmed/deduplicated/capped at 12, and the event date is
 * cleared whenever the date basis is 'unclear' — ambiguous dates stay
 * ambiguous, never guessed client-side either. This is a client-side
 * convenience only; the RPC re-validates every field server-side regardless.
 */
export function normalizeCandidateInput({
  eventDate, dateBasis, dateConfidence, kind, title, body, audience, tags, status,
}) {
  const cleanTags = Array.from(new Set(
    (tags ?? []).map((t) => String(t).trim()).filter(Boolean),
  )).slice(0, 12);

  const trimmedTitle = (title ?? '').trim();

  return {
    eventDate: dateBasis === 'unclear' ? null : (eventDate || null),
    dateBasis,
    dateConfidence,
    kind,
    title: trimmedTitle ? trimmedTitle : null,
    body: (body ?? '').trim(),
    audience,
    tags: cleanTags,
    status,
  };
}

// ─── Logboek sort option ─────────────────────────────────────────────────────

const VALID_SORTS = new Set(['event_date', 'created_at']);

/** Only 'event_date' | 'created_at' are accepted; anything else falls back to 'event_date'. */
export function validateSortOption(sort) {
  return VALID_SORTS.has(sort) ? sort : 'event_date';
}

// ─── Provenance line (section 15) ────────────────────────────────────────────

/**
 * Formats the short "Bron: <label> · <locator>" line for an approved,
 * imported Logboek entry, or null when the entry carries no provenance (an
 * ordinary, non-imported post). Returns unescaped text — the caller
 * (components/logboek-entry.js) is responsible for HTML-escaping it before
 * inserting into the DOM, same as every other user-supplied string there.
 * @param {{ source_label?: string, source_locator?: string|null } | null | undefined} source
 * @returns {string|null}
 */
export function formatProvenance(source) {
  if (!source || !source.source_label) return null;
  return source.source_locator
    ? `Bron: ${source.source_label} · ${source.source_locator}`
    : `Bron: ${source.source_label}`;
}
