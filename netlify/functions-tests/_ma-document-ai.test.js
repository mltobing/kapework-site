/* netlify/functions-tests/_ma-document-ai.test.js
 *
 * Pure tests for the Claude helper (schema shape, prompt safety language,
 * local structured-output validation, Anthropic error classification). No
 * network — countMessageTokens()/createStructuredMessage() are exercised
 * against a mocked global.fetch, same pattern as ma-sync-trigger.test.js's
 * mockGithubDispatch().
 *
 * Run: node --test netlify/functions-tests/_ma-document-ai.test.js
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  DOCUMENT_PROMPT_VERSION, DOCUMENT_OUTPUT_SCHEMA,
  buildSystemPrompt, buildMessagesContent, validateStructuredResult,
  classifyAnthropicError, countMessageTokens, createStructuredMessage,
} = require('../functions/_ma-document-ai');

function validResult(overrides = {}) {
  return {
    document_summary: 'Korte samenvatting.',
    document_warnings: [],
    candidates: [
      {
        sequence_no: 1,
        event_date: '2026-03-14',
        date_basis: 'explicit',
        date_confidence: 'high',
        kind: 'note',
        title: 'Titel',
        body: 'Body tekst.',
        tags: ['tag-een'],
        source_locator: 'p.1',
        source_excerpt: 'excerpt',
        warnings: [],
        follow_up: null,
      },
    ],
    ...overrides,
  };
}

// ─── Schema shape ────────────────────────────────────────────────────────────

test('schema requires exactly the documented top-level fields, additionalProperties false', () => {
  assert.deepEqual(DOCUMENT_OUTPUT_SCHEMA.required, ['document_summary', 'document_warnings', 'candidates']);
  assert.equal(DOCUMENT_OUTPUT_SCHEMA.additionalProperties, false);
});

test('schema candidate items require every documented field, additionalProperties false, no audience', () => {
  const itemSchema = DOCUMENT_OUTPUT_SCHEMA.properties.candidates.items;
  assert.equal(itemSchema.additionalProperties, false);
  assert.deepEqual(itemSchema.required, [
    'sequence_no', 'event_date', 'date_basis', 'date_confidence', 'kind',
    'title', 'body', 'tags', 'source_locator', 'source_excerpt', 'warnings', 'follow_up',
  ]);
  assert.equal('audience' in itemSchema.properties, false);
  assert.equal(JSON.stringify(DOCUMENT_OUTPUT_SCHEMA).includes('audience'), false);
});

test('schema caps candidates at 50, tags at 12, warnings at 8', () => {
  assert.equal(DOCUMENT_OUTPUT_SCHEMA.properties.candidates.maxItems, 50);
  assert.equal(DOCUMENT_OUTPUT_SCHEMA.properties.document_warnings.maxItems, 8);
  assert.equal(DOCUMENT_OUTPUT_SCHEMA.properties.candidates.items.properties.tags.maxItems, 12);
  assert.equal(DOCUMENT_OUTPUT_SCHEMA.properties.candidates.items.properties.warnings.maxItems, 8);
});

test('DOCUMENT_PROMPT_VERSION is a non-empty versioned string', () => {
  assert.equal(typeof DOCUMENT_PROMPT_VERSION, 'string');
  assert.ok(DOCUMENT_PROMPT_VERSION.length > 0);
});

// ─── Prompt safety language ───────────────────────────────────────────────────

test('system prompt explicitly treats the source as untrusted data, not instructions', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /untrusted data/i);
  assert.match(prompt, /[Nn]ever follow instructions/);
});

test('system prompt prohibits diagnosis, invention, and automatic completed-action claims', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /Do not diagnose/);
  assert.match(prompt, /Do not speculate/);
  assert.match(prompt, /Do not infer medication doses/);
  assert.match(prompt, /Do not claim that an action was completed/);
});

test('buildMessagesContent wraps pasted text with an untrusted-data label and never bare', () => {
  const content = buildMessagesContent({ sourceType: 'pasted_text', documentDate: null, textContent: 'hallo' });
  const joined = JSON.stringify(content);
  assert.match(joined, /onbetrouwbare data/);
  assert.ok(joined.includes('hallo'));
});

test('buildMessagesContent sends a PDF as a base64 document block', () => {
  const content = buildMessagesContent({ sourceType: 'pdf', documentDate: null, pdfBase64: 'QUJD' });
  const docBlock = content.find((b) => b.type === 'document');
  assert.ok(docBlock);
  assert.equal(docBlock.source.type, 'base64');
  assert.equal(docBlock.source.media_type, 'application/pdf');
  assert.equal(docBlock.source.data, 'QUJD');
});

test('buildMessagesContent labels each image with a locatable "Afbeelding N" marker', () => {
  const content = buildMessagesContent({
    sourceType: 'images',
    documentDate: null,
    images: [{ base64: 'AAA', mediaType: 'image/jpeg' }, { base64: 'BBB', mediaType: 'image/png' }],
  });
  const labels = content.filter((b) => b.type === 'text').map((b) => b.text).join(' | ');
  assert.match(labels, /Afbeelding 1/);
  assert.match(labels, /Afbeelding 2/);
  const imageBlocks = content.filter((b) => b.type === 'image');
  assert.equal(imageBlocks.length, 2);
});

test('buildMessagesContent never sends a signed URL — only base64 source blocks', () => {
  const content = buildMessagesContent({
    sourceType: 'images', documentDate: null, images: [{ base64: 'AAA', mediaType: 'image/jpeg' }],
  });
  const joined = JSON.stringify(content);
  assert.equal(joined.includes('http://'), false);
  assert.equal(joined.includes('https://'), false);
});

// ─── Local result validation ──────────────────────────────────────────────────

test('accepts a fully valid structured result', () => {
  const out = validateStructuredResult(validResult());
  assert.equal(out.valid, true);
  assert.equal(out.result.candidates.length, 1);
  assert.equal(out.result.candidates[0].sequenceNo, 1);
});

test('rejects an invalid enum value', () => {
  const bad = validResult();
  bad.candidates[0].kind = 'diagnosis';
  const out = validateStructuredResult(bad);
  assert.equal(out.valid, false);
  assert.equal(out.errorCode, 'invalid_output');
});

test('rejects an invalid (non-calendar) date', () => {
  const bad = validResult();
  bad.candidates[0].event_date = '2026-02-30';
  const out = validateStructuredResult(bad);
  assert.equal(out.valid, false);
  assert.equal(out.errorCode, 'invalid_output');
});

test('rejects date_basis=unclear paired with a non-null event_date', () => {
  const bad = validResult();
  bad.candidates[0].date_basis = 'unclear';
  bad.candidates[0].event_date = '2026-03-14';
  const out = validateStructuredResult(bad);
  assert.equal(out.valid, false);
});

test('accepts date_basis=unclear paired with a null event_date', () => {
  const ok = validResult();
  ok.candidates[0].date_basis = 'unclear';
  ok.candidates[0].event_date = null;
  const out = validateStructuredResult(ok);
  assert.equal(out.valid, true);
});

test('rejects a duplicate sequence number', () => {
  const bad = validResult();
  bad.candidates.push({ ...validResult().candidates[0], sequence_no: 1 });
  const out = validateStructuredResult(bad);
  assert.equal(out.valid, false);
});

test('rejects a title longer than 120 characters', () => {
  const bad = validResult();
  bad.candidates[0].title = 'x'.repeat(121);
  assert.equal(validateStructuredResult(bad).valid, false);
});

test('rejects a body longer than 4000 characters', () => {
  const bad = validResult();
  bad.candidates[0].body = 'x'.repeat(4001);
  assert.equal(validateStructuredResult(bad).valid, false);
});

test('rejects more than 12 tags', () => {
  const bad = validResult();
  bad.candidates[0].tags = Array.from({ length: 13 }, (_, i) => `tag-${i}`);
  assert.equal(validateStructuredResult(bad).valid, false);
});

test('rejects a warning longer than 300 characters', () => {
  const bad = validResult();
  bad.candidates[0].warnings = ['x'.repeat(301)];
  assert.equal(validateStructuredResult(bad).valid, false);
});

test('detects a duplicate candidate (same normalized date/title/body)', () => {
  const bad = validResult();
  bad.candidates.push({ ...bad.candidates[0], sequence_no: 2 });
  const out = validateStructuredResult(bad);
  assert.equal(out.valid, false);
});

test('rejects when the response stopped due to max_tokens, with a distinct error code', () => {
  const out = validateStructuredResult(validResult(), { stopReason: 'max_tokens' });
  assert.equal(out.valid, false);
  assert.equal(out.errorCode, 'output_truncated');
});

test('rejects an unexpected top-level field', () => {
  const bad = validResult();
  bad.extra_field = 'nope';
  assert.equal(validateStructuredResult(bad).valid, false);
});

test('rejects an unexpected candidate field', () => {
  const bad = validResult();
  bad.candidates[0].confidence_score = 0.9;
  assert.equal(validateStructuredResult(bad).valid, false);
});

test('rejects more than 50 candidates', () => {
  const bad = validResult();
  bad.candidates = Array.from({ length: 51 }, (_, i) => ({
    ...validResult().candidates[0], sequence_no: i + 1, event_date: null, date_basis: 'unclear',
  }));
  assert.equal(validateStructuredResult(bad).valid, false);
});

test('never carries the raw invalid payload in the error result', () => {
  const bad = validResult();
  bad.candidates[0].kind = 'private-medical-fact-should-not-leak';
  const out = validateStructuredResult(bad);
  assert.equal(out.valid, false);
  assert.equal('result' in out, false);
  assert.equal(JSON.stringify(out).includes('private-medical-fact'), false);
});

// ─── Anthropic error classification ──────────────────────────────────────────

test('classifyAnthropicError maps 429 to anthropic_rate_limited', () => {
  assert.equal(classifyAnthropicError(429), 'anthropic_rate_limited');
});

test('classifyAnthropicError maps 5xx to anthropic_unavailable', () => {
  assert.equal(classifyAnthropicError(500), 'anthropic_unavailable');
  assert.equal(classifyAnthropicError(503), 'anthropic_unavailable');
});

test('classifyAnthropicError maps other 4xx to anthropic_rejected', () => {
  assert.equal(classifyAnthropicError(400), 'anthropic_rejected');
  assert.equal(classifyAnthropicError(401), 'anthropic_rejected');
});

// ─── Anthropic API call wrappers (mocked fetch, no network) ──────────────────

beforeEach(() => {
  global.fetch = async () => { throw new Error('unexpected fetch call in this test'); };
});

test('countMessageTokens returns input_tokens on success', async () => {
  global.fetch = async (url) => {
    assert.match(url, /\/v1\/messages\/count_tokens$/);
    return { ok: true, status: 200, json: async () => ({ input_tokens: 1234 }) };
  };
  const out = await countMessageTokens({ apiKey: 'k', model: 'm', system: 's', messages: [] });
  assert.equal(out.inputTokens, 1234);
});

test('countMessageTokens throws a controlled, classified error on a non-ok response, never the vendor body', async () => {
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'internal vendor detail' } }) });
  await assert.rejects(
    () => countMessageTokens({ apiKey: 'k', model: 'm', system: 's', messages: [] }),
    (err) => {
      assert.equal(err.errorCode, 'anthropic_rate_limited');
      assert.equal(String(err.message).includes('internal vendor detail'), false);
      return true;
    },
  );
});

test('countMessageTokens throws anthropic_unavailable on a network failure', async () => {
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(
    () => countMessageTokens({ apiKey: 'k', model: 'm', system: 's', messages: [] }),
    (err) => { assert.equal(err.errorCode, 'anthropic_unavailable'); return true; },
  );
});

test('createStructuredMessage returns the text block, stop reason, and usage on success', async () => {
  global.fetch = async (url, opts) => {
    assert.match(url, /\/v1\/messages$/);
    const body = JSON.parse(opts.body);
    assert.equal(body.output_config.format.type, 'json_schema');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
  };
  const out = await createStructuredMessage({
    apiKey: 'k', model: 'm', maxTokens: 100, system: 's', messages: [], schema: DOCUMENT_OUTPUT_SCHEMA,
  });
  assert.equal(out.rawText, '{"ok":true}');
  assert.equal(out.stopReason, 'end_turn');
  assert.deepEqual(out.usage, { inputTokens: 10, outputTokens: 5 });
});

test('createStructuredMessage throws a classified error on a non-ok response', async () => {
  global.fetch = async () => ({ ok: false, status: 529, json: async () => ({}) });
  await assert.rejects(
    () => createStructuredMessage({ apiKey: 'k', model: 'm', maxTokens: 100, system: 's', messages: [], schema: DOCUMENT_OUTPUT_SCHEMA }),
    (err) => { assert.equal(err.errorCode, 'anthropic_unavailable'); return true; },
  );
});
