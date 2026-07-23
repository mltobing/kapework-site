/**
 * Tests for src/lib/document-inbox.js — the Document Inbox's pure, DOM-free
 * helpers: controlled error copy, status labels, polling stop conditions,
 * candidate field normalization, sort-option validation, and provenance
 * formatting.
 *
 * Run: node --test apps/ma/src/lib/document-inbox.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  errorMessage, isRetryableError, statusLabel, shouldPoll, sourceTypeLabel,
  normalizeCandidateInput, validateSortOption, formatProvenance,
} from './document-inbox.js';

// ─── Controlled error copy ───────────────────────────────────────────────────

test('errorMessage returns calm Dutch copy for every controlled error code', () => {
  const codes = [
    'config_error', 'not_authorized', 'invalid_state', 'source_missing', 'unsupported_type',
    'too_many_files', 'source_too_large', 'duplicate_source', 'too_many_tokens',
    'anthropic_rate_limited', 'anthropic_rejected', 'anthropic_unavailable',
    'output_truncated', 'invalid_output', 'dispatch_failed', 'server_error',
  ];
  for (const code of codes) {
    const msg = errorMessage(code);
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
    assert.notEqual(msg, code); // never just echoes the raw code
  }
});

test('errorMessage never renders a raw/unknown error code — falls back to a generic message', () => {
  const msg = errorMessage('some_unmapped_vendor_code');
  assert.equal(msg.includes('some_unmapped_vendor_code'), false);
});

test('isRetryableError is false for duplicate_source and not_authorized, true otherwise', () => {
  assert.equal(isRetryableError('duplicate_source'), false);
  assert.equal(isRetryableError('not_authorized'), false);
  assert.equal(isRetryableError('too_many_tokens'), true);
  assert.equal(isRetryableError('server_error'), true);
});

// ─── Status labels ────────────────────────────────────────────────────────────

test('statusLabel returns a Dutch label for every controlled status', () => {
  const statuses = ['draft', 'uploaded', 'queued', 'processing', 'ready', 'completed', 'failed', 'duplicate', 'cancelled'];
  for (const s of statuses) {
    assert.notEqual(statusLabel(s), s);
  }
});

test('sourceTypeLabel returns a Dutch label for every source type', () => {
  assert.equal(sourceTypeLabel('pasted_text'), 'Geplakte tekst');
  assert.equal(sourceTypeLabel('pdf'), 'PDF-document');
  assert.equal(sourceTypeLabel('images'), "Foto's/scans");
});

// ─── Polling stop condition ───────────────────────────────────────────────────

test('shouldPoll is true only while queued or processing', () => {
  assert.equal(shouldPoll('queued'), true);
  assert.equal(shouldPoll('processing'), true);
  for (const s of ['draft', 'uploaded', 'ready', 'completed', 'failed', 'duplicate', 'cancelled']) {
    assert.equal(shouldPoll(s), false, `expected shouldPoll(${s}) to be false`);
  }
});

// ─── Candidate field normalization ───────────────────────────────────────────

test('normalizeCandidateInput turns a blank title into null', () => {
  const out = normalizeCandidateInput({
    eventDate: '2026-01-01', dateBasis: 'explicit', dateConfidence: 'high', kind: 'note',
    title: '   ', body: 'body', audience: 'family', tags: [], status: 'pending',
  });
  assert.equal(out.title, null);
});

test('normalizeCandidateInput trims, dedupes, and caps tags at 12', () => {
  const out = normalizeCandidateInput({
    eventDate: null, dateBasis: 'unclear', dateConfidence: 'low', kind: 'note',
    title: 'T', body: 'B', audience: 'family',
    tags: [' a ', 'a', 'b', ...Array.from({ length: 15 }, (_, i) => `x${i}`)],
    status: 'pending',
  });
  assert.equal(out.tags.length, 12);
  assert.deepEqual(out.tags.slice(0, 2), ['a', 'b']);
});

test('normalizeCandidateInput clears the event date whenever date_basis is unclear', () => {
  const out = normalizeCandidateInput({
    eventDate: '2026-05-01', dateBasis: 'unclear', dateConfidence: 'low', kind: 'note',
    title: null, body: 'B', audience: 'family', tags: [], status: 'pending',
  });
  assert.equal(out.eventDate, null);
});

test('normalizeCandidateInput keeps an explicit event date when the basis is not unclear', () => {
  const out = normalizeCandidateInput({
    eventDate: '2026-05-01', dateBasis: 'explicit', dateConfidence: 'high', kind: 'note',
    title: null, body: 'B', audience: 'family', tags: [], status: 'pending',
  });
  assert.equal(out.eventDate, '2026-05-01');
});

test('normalizeCandidateInput trims the body', () => {
  const out = normalizeCandidateInput({
    eventDate: null, dateBasis: 'unclear', dateConfidence: 'low', kind: 'note',
    title: null, body: '  hello  ', audience: 'family', tags: [], status: 'pending',
  });
  assert.equal(out.body, 'hello');
});

// ─── Logboek sort option ─────────────────────────────────────────────────────

test('validateSortOption accepts the two known values', () => {
  assert.equal(validateSortOption('event_date'), 'event_date');
  assert.equal(validateSortOption('created_at'), 'created_at');
});

test('validateSortOption falls back to event_date for anything else', () => {
  assert.equal(validateSortOption('bogus'), 'event_date');
  assert.equal(validateSortOption(undefined), 'event_date');
  assert.equal(validateSortOption(null), 'event_date');
});

// ─── Provenance formatting ────────────────────────────────────────────────────

test('formatProvenance returns null when there is no source', () => {
  assert.equal(formatProvenance(null), null);
  assert.equal(formatProvenance(undefined), null);
  assert.equal(formatProvenance({}), null);
});

test('formatProvenance includes the locator when present', () => {
  assert.equal(
    formatProvenance({ source_label: 'Verslag huisarts', source_locator: 'p. 2' }),
    'Bron: Verslag huisarts · p. 2',
  );
});

test('formatProvenance omits the locator when null', () => {
  assert.equal(
    formatProvenance({ source_label: 'Verslag huisarts', source_locator: null }),
    'Bron: Verslag huisarts',
  );
});

test('formatProvenance never includes a model name, token count, or confidence label', () => {
  const line = formatProvenance({ source_label: 'Brief', source_locator: 'p. 1' });
  assert.equal(/claude/i.test(line), false);
  assert.equal(/token/i.test(line), false);
  assert.equal(/confidence|betrouwbaar/i.test(line), false);
});
