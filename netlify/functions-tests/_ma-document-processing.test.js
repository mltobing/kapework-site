/* netlify/functions-tests/_ma-document-processing.test.js
 *
 * Tests for the Document Inbox worker against a fake Supabase client (see
 * _fake-supabase.js) and a mocked global.fetch for the Anthropic calls — no
 * network, no real Storage.
 *
 * Run: node --test netlify/functions-tests/_ma-document-processing.test.js
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { installFakeSupabase, setFixture } = require('./_fake-supabase');
installFakeSupabase();

const {
  validateFileBundle, downloadSourceBundle, computeSourceHash, findDuplicateImport,
  processDocumentImport, IMPORT_BUCKET,
} = require('../functions/_ma-document-processing');

const FAMILY_ID = 'family-doc-0001';
const IMPORT_ID = 'import-0001';

function fileRow(overrides = {}) {
  return {
    id: 'file-1', import_id: IMPORT_ID, family_id: FAMILY_ID, sequence_no: 1,
    object_path: `${FAMILY_ID}/${IMPORT_ID}/aaa.txt`, mime_type: 'text/plain', size_bytes: 10,
    original_filename: null,
    ...overrides,
  };
}

function importRow(overrides = {}) {
  return {
    id: IMPORT_ID, family_id: FAMILY_ID, audience: 'family', source_type: 'pasted_text',
    document_date: null,
    ...overrides,
  };
}

// ─── validateFileBundle (11.1) ────────────────────────────────────────────────

test('valid pasted text bundle passes', () => {
  const out = validateFileBundle(importRow({ source_type: 'pasted_text' }), [fileRow()]);
  assert.equal(out.ok, true);
});

test('valid PDF bundle passes', () => {
  const out = validateFileBundle(
    importRow({ source_type: 'pdf' }),
    [fileRow({ mime_type: 'application/pdf', object_path: `${FAMILY_ID}/${IMPORT_ID}/a.pdf` })],
  );
  assert.equal(out.ok, true);
});

test('valid image bundle (1-6 images) passes', () => {
  const files = [1, 2, 3].map((n) => fileRow({ id: `f${n}`, sequence_no: n, mime_type: 'image/jpeg', object_path: `${FAMILY_ID}/${IMPORT_ID}/${n}.jpg` }));
  const out = validateFileBundle(importRow({ source_type: 'images' }), files);
  assert.equal(out.ok, true);
});

test('PDF mixed with an image is rejected as unsupported_type', () => {
  const out = validateFileBundle(importRow({ source_type: 'pdf' }), [
    fileRow({ mime_type: 'application/pdf' }),
    fileRow({ id: 'f2', sequence_no: 2, mime_type: 'image/jpeg' }),
  ]);
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, 'unsupported_type');
});

test('HEIC is rejected as unsupported_type', () => {
  const out = validateFileBundle(importRow({ source_type: 'images' }), [
    fileRow({ mime_type: 'image/heic' }),
  ]);
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, 'unsupported_type');
});

test('more than 6 images is rejected as too_many_files', () => {
  const files = Array.from({ length: 7 }, (_, i) => fileRow({ id: `f${i}`, sequence_no: i + 1, mime_type: 'image/jpeg' }));
  const out = validateFileBundle(importRow({ source_type: 'images' }), files);
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, 'too_many_files');
});

test('total size over 12 MB is rejected as source_too_large before any Anthropic call', () => {
  const out = validateFileBundle(importRow({ source_type: 'pdf' }), [
    fileRow({ mime_type: 'application/pdf', size_bytes: 13 * 1024 * 1024 }),
  ]);
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, 'source_too_large');
});

test('no file rows is rejected as source_missing', () => {
  const out = validateFileBundle(importRow(), []);
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, 'source_missing');
});

// ─── computeSourceHash (11.3) ─────────────────────────────────────────────────

test('computeSourceHash is deterministic for the same ordered bytes', () => {
  const files = [{ sequenceNo: 1, mimeType: 'text/plain', bytes: Buffer.from('hello') }];
  assert.equal(computeSourceHash(files), computeSourceHash(files));
});

test('computeSourceHash changes when the bytes change', () => {
  const a = [{ sequenceNo: 1, mimeType: 'text/plain', bytes: Buffer.from('hello') }];
  const b = [{ sequenceNo: 1, mimeType: 'text/plain', bytes: Buffer.from('hellp') }];
  assert.notEqual(computeSourceHash(a), computeSourceHash(b));
});

test('computeSourceHash changes when the order changes', () => {
  const a = [
    { sequenceNo: 1, mimeType: 'image/jpeg', bytes: Buffer.from('AAA') },
    { sequenceNo: 2, mimeType: 'image/jpeg', bytes: Buffer.from('BBB') },
  ];
  const b = [
    { sequenceNo: 1, mimeType: 'image/jpeg', bytes: Buffer.from('BBB') },
    { sequenceNo: 2, mimeType: 'image/jpeg', bytes: Buffer.from('AAA') },
  ];
  assert.notEqual(computeSourceHash(a), computeSourceHash(b));
});

test('computeSourceHash produces a lowercase 64-char hex string', () => {
  const hash = computeSourceHash([{ sequenceNo: 1, mimeType: 'text/plain', bytes: Buffer.from('x') }]);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

// ─── downloadSourceBundle (11.2) ──────────────────────────────────────────────

test('downloadSourceBundle throws source_missing when the Storage object is missing', async () => {
  setFixture({ auth: async () => ({ data: { user: null }, error: null }), tables: {}, storage: {
    [IMPORT_BUCKET]: async () => ({ data: null, error: { message: 'not found' } }),
  } });
  const { serviceClientForTest } = requireServiceClientHelper();
  await assert.rejects(
    () => downloadSourceBundle(serviceClientForTest(), [fileRow()]),
    (err) => { assert.equal(err.errorCode, 'source_missing'); return true; },
  );
});

test('downloadSourceBundle returns bytes in sequence order regardless of input order', async () => {
  const bytesFor = { 1: Buffer.from('one'), 2: Buffer.from('two') };
  setFixture({ auth: async () => ({ data: { user: null }, error: null }), tables: {}, storage: {
    [IMPORT_BUCKET]: async (path) => {
      const seq = path.endsWith('2.txt') ? 2 : 1;
      return { data: { arrayBuffer: async () => bytesFor[seq].buffer.slice(bytesFor[seq].byteOffset, bytesFor[seq].byteOffset + bytesFor[seq].byteLength) }, error: null };
    },
  } });
  const { serviceClientForTest } = requireServiceClientHelper();
  const files = [
    fileRow({ id: 'f2', sequence_no: 2, object_path: `${FAMILY_ID}/${IMPORT_ID}/2.txt` }),
    fileRow({ id: 'f1', sequence_no: 1, object_path: `${FAMILY_ID}/${IMPORT_ID}/1.txt` }),
  ];
  const out = await downloadSourceBundle(serviceClientForTest(), files);
  assert.equal(out[0].sequenceNo, 1);
  assert.equal(out[0].bytes.toString(), 'one');
  assert.equal(out[1].sequenceNo, 2);
  assert.equal(out[1].bytes.toString(), 'two');
});

// ─── findDuplicateImport (11.4) ───────────────────────────────────────────────

test('findDuplicateImport finds another import with the same hash in a meaningful status', async () => {
  setFixture({
    auth: async () => ({ data: { user: null }, error: null }),
    tables: {
      ma_document_imports: () => ({
        data: [{ id: 'other-import', status: 'completed' }],
        error: null,
      }),
    },
  });
  const { serviceClientForTest } = requireServiceClientHelper();
  const dup = await findDuplicateImport(serviceClientForTest(), { familyId: FAMILY_ID, sourceHash: 'h', excludeImportId: IMPORT_ID });
  assert.equal(dup.id, 'other-import');
});

test('findDuplicateImport ignores a draft-status match', async () => {
  setFixture({
    auth: async () => ({ data: { user: null }, error: null }),
    tables: {
      ma_document_imports: () => ({ data: [{ id: 'other-import', status: 'draft' }], error: null }),
    },
  });
  const { serviceClientForTest } = requireServiceClientHelper();
  const dup = await findDuplicateImport(serviceClientForTest(), { familyId: FAMILY_ID, sourceHash: 'h', excludeImportId: IMPORT_ID });
  assert.equal(dup, null);
});

// ─── processDocumentImport (end-to-end orchestration) ─────────────────────────

function buildProcessingFixture({
  files = [fileRow()],
  storageBytes = Buffer.from('hello world'),
  duplicateImports = [],
  tokenCountResponse = { ok: true, status: 200, json: async () => ({ input_tokens: 100 }) },
  messageResponse = { ok: true, status: 200, json: async () => ({
    content: [{ type: 'text', text: JSON.stringify({
      document_summary: 'summary', document_warnings: [],
      candidates: [{
        sequence_no: 1, event_date: null, date_basis: 'unclear', date_confidence: 'low',
        kind: 'note', title: null, body: 'body text', tags: [], source_locator: null,
        source_excerpt: null, warnings: [], follow_up: null,
      }],
    }) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 20 },
  }) },
} = {}) {
  const calls = { importUpdates: [], candidateInserts: [], candidateDeletes: [] };
  const fixture = {
    auth: async () => ({ data: { user: null }, error: null }),
    storage: {
      [IMPORT_BUCKET]: async () => ({ data: { arrayBuffer: async () => storageBytes.buffer.slice(storageBytes.byteOffset, storageBytes.byteOffset + storageBytes.byteLength) }, error: null }),
    },
    tables: {
      ma_document_import_files: (state) => ({ data: files, error: null }),
      ma_document_imports: (state) => {
        if (state.op === 'update') {
          calls.importUpdates.push(state.payload);
          return { data: null, error: null };
        }
        return { data: duplicateImports, error: null };
      },
      ma_document_candidates: (state) => {
        if (state.op === 'delete') { calls.candidateDeletes.push(true); return { data: null, error: null }; }
        if (state.op === 'insert') { calls.candidateInserts.push(state.payload); return { data: null, error: null }; }
        return { data: [], error: null };
      },
    },
  };

  let fetchCallIndex = 0;
  global.fetch = async (url) => {
    fetchCallIndex += 1;
    if (String(url).includes('count_tokens')) return tokenCountResponse;
    return messageResponse;
  };

  return { fixture, calls };
}

function requireServiceClientHelper() {
  const { createClient } = require('@supabase/supabase-js');
  return { serviceClientForTest: () => createClient('http://fake', 'fake-key') };
}

const anthropic = { apiKey: 'k', model: 'claude-test', maxInputTokens: 100000, maxOutputTokens: 8000 };

test('success path inserts candidates but creates no ma_posts, audience inherited from import', async () => {
  const { fixture, calls } = buildProcessingFixture();
  setFixture(fixture);
  const { serviceClientForTest } = requireServiceClientHelper();
  const out = await processDocumentImport({
    supabase: serviceClientForTest(), anthropic, importRow: importRow({ audience: 'care_team' }),
  });
  assert.equal(out.status, 'ready');
  assert.equal(calls.candidateInserts.length, 1);
  assert.equal(calls.candidateInserts[0][0].audience, 'care_team');
  const readyUpdate = calls.importUpdates.find((u) => u.status === 'ready');
  assert.ok(readyUpdate);
  assert.equal(readyUpdate.candidate_count, 1);
  assert.equal(readyUpdate.model, 'claude-test');
  assert.equal(readyUpdate.input_tokens, 100);
  assert.equal(readyUpdate.output_tokens, 20);
});

test('duplicate-source path skips the token-count and message calls entirely', async () => {
  let fetchCalled = false;
  const { fixture, calls } = buildProcessingFixture({ duplicateImports: [{ id: 'other-import', status: 'ready' }] });
  setFixture(fixture);
  const realFetch = global.fetch;
  global.fetch = async (...args) => { fetchCalled = true; return realFetch(...args); };
  const { serviceClientForTest } = requireServiceClientHelper();
  const out = await processDocumentImport({ supabase: serviceClientForTest(), anthropic, importRow: importRow() });
  assert.equal(out.status, 'duplicate');
  assert.equal(out.duplicateOf, 'other-import');
  assert.equal(fetchCalled, false);
  const dupUpdate = calls.importUpdates.find((u) => u.status === 'duplicate');
  assert.equal(dupUpdate.error_code, 'duplicate_source');
  assert.equal(dupUpdate.duplicate_of, 'other-import');
});

test('token-threshold path skips the Message call and fails with too_many_tokens', async () => {
  const { fixture, calls } = buildProcessingFixture({
    tokenCountResponse: { ok: true, status: 200, json: async () => ({ input_tokens: 999999 }) },
  });
  setFixture(fixture);
  let messageCalled = false;
  const realFetch = global.fetch;
  global.fetch = async (url, ...rest) => {
    if (!String(url).includes('count_tokens')) messageCalled = true;
    return realFetch(url, ...rest);
  };
  const { serviceClientForTest } = requireServiceClientHelper();
  const out = await processDocumentImport({ supabase: serviceClientForTest(), anthropic, importRow: importRow() });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, 'too_many_tokens');
  assert.equal(messageCalled, false);
  assert.ok(calls.importUpdates.find((u) => u.error_code === 'too_many_tokens'));
});

test('invalid structured output stores a controlled failure, never the raw response', async () => {
  const { fixture, calls } = buildProcessingFixture({
    messageResponse: { ok: true, status: 200, json: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ document_summary: 's', document_warnings: [], candidates: [{ sequence_no: 1, kind: 'not-a-real-kind' }] }) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    }) },
  });
  setFixture(fixture);
  const { serviceClientForTest } = requireServiceClientHelper();
  const out = await processDocumentImport({ supabase: serviceClientForTest(), anthropic, importRow: importRow() });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, 'invalid_output');
  const failUpdate = calls.importUpdates.find((u) => u.error_code === 'invalid_output');
  assert.ok(failUpdate);
  assert.equal('document_summary' in failUpdate, false);
});

test('retry clears only unapproved old candidates before inserting the fresh batch', async () => {
  const { fixture, calls } = buildProcessingFixture();
  setFixture(fixture);
  const { serviceClientForTest } = requireServiceClientHelper();
  await processDocumentImport({ supabase: serviceClientForTest(), anthropic, importRow: importRow() });
  assert.equal(calls.candidateDeletes.length, 1);
});

test('no source content, filename, or path reaches console output during processing', async () => {
  const { fixture } = buildProcessingFixture();
  setFixture(fixture);
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    const { serviceClientForTest } = requireServiceClientHelper();
    await processDocumentImport({ supabase: serviceClientForTest(), anthropic, importRow: importRow() });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const joined = logs.join('\n');
  assert.equal(joined.includes('hello world'), false);
  assert.equal(joined.includes(fileRow().object_path), false);
});
