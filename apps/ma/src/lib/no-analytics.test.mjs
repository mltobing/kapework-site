/**
 * Regression test: Ma intentionally stays outside the shared Google
 * Analytics client (see apps/ma/README.md, "Waarom geen Analytics?").
 *
 * The family's activity — who did what in the app — is a sensitive signal
 * about a vulnerable person's care. It belongs only in the owner-only
 * ma_activity_events audit trail (RLS-gated, no route/scroll/keystroke
 * capture), never in a general-purpose analytics product. This test fails
 * loudly if a future change accidentally wires /shared/analytics.js, gtag,
 * or KapeworkAnalytics into any Ma entry point or app source file.
 *
 * Run with Node's built-in runner (no dependencies):
 *   node --test apps/ma/src/lib/no-analytics.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MA_ROOT = fileURLToPath(new URL('../../', import.meta.url)); // apps/ma/

const HTML_ENTRY_POINTS = [
  'index.html',
  'vandaag/index.html',
  'vandaag/koppelen/index.html',
];

const FORBIDDEN_PATTERNS = [
  /shared\/analytics\.js/,
  /KapeworkAnalytics/,
  /\bgtag\(/,
  /googletagmanager\.com/,
  /google-analytics\.com/,
];

test('no Ma HTML entry point loads the shared analytics client', () => {
  for (const relPath of HTML_ENTRY_POINTS) {
    const full = path.join(MA_ROOT, relPath);
    const html = readFileSync(full, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.doesNotMatch(html, pattern, `${relPath} unexpectedly references ${pattern}`);
    }
  }
});

test('no Ma app source file references the shared analytics client or a GA tag', () => {
  const srcRoot = path.join(MA_ROOT, 'src');
  for (const file of walk(srcRoot)) {
    // Test files themselves are allowed to *mention* what they guard against;
    // only shipped app source (never .test.mjs) is checked here.
    if (!/\.(js|mjs)$/.test(file) || file.endsWith('.test.mjs')) continue;
    const contents = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.doesNotMatch(
        contents,
        pattern,
        `${path.relative(MA_ROOT, file)} unexpectedly references ${pattern}`,
      );
    }
  }
});

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
