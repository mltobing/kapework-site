#!/usr/bin/env node
/**
 * build-longshot-lexicon.mjs
 *
 * Builds apps/longshot/data/longshot-common-words.txt from the vendored
 * wordfreq-en-25000 upstream source.
 *
 * Upstream source:
 *   Repo:  https://github.com/aparrish/wordfreq-en-25000
 *   File:  wordfreq-en-25000-log.json
 *   Vendored at: apps/longshot/data/vendor/wordfreq-en-25000-log.json
 *
 * Pipeline:
 *   1. Read wordfreq rows in rank order (most frequent first).
 *   2. Keep letters-only, 5+ char, lowercase entries.
 *   3. Take the top RANK_CUTOFF words from that filtered set.
 *   4. Apply denylist: remove names, obscure terms, etc.
 *   5. Apply allowlist: force-add specific words.
 *   6. Write sorted output to longshot-common-words.txt.
 *
 * Usage:
 *   node scripts/build-longshot-lexicon.mjs [--cutoff N] [--verbose]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = join(__dirname, '..');
const VENDOR_FILE  = join(REPO_ROOT, 'apps/longshot/data/vendor/wordfreq-en-25000-log.json');
const ALLOW_FILE   = join(REPO_ROOT, 'apps/longshot/data/longshot-allowlist.txt');
const DENY_FILE    = join(REPO_ROOT, 'apps/longshot/data/longshot-denylist.txt');
const OUT_FILE     = join(REPO_ROOT, 'apps/longshot/data/longshot-common-words.txt');

// How many words to take from the frequency-ranked 5+ letter filtered set
// before applying denylist/allowlist. 15000 is generous — the bottom of this
// range (~rank 12000-15000 of 5+ letter words) still yields ordinary English words.
const DEFAULT_CUTOFF = 15000;

// ── Argument parsing ──────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const verbose = args.includes('--verbose');
const cutoffArg = args.indexOf('--cutoff');
const RANK_CUTOFF = cutoffArg !== -1 ? parseInt(args[cutoffArg + 1], 10) : DEFAULT_CUTOFF;

// ── Load helpers ──────────────────────────────────────────────────────────────
function loadLines(file) {
  if (!existsSync(file)) return new Set();
  const raw = readFileSync(file, 'utf8');
  const out = new Set();
  for (const line of raw.split('\n')) {
    const w = line.replace(/#.*/, '').trim().toLowerCase();
    if (w.length >= 5 && /^[a-z]+$/.test(w)) out.add(w);
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  // 1. Load upstream
  if (!existsSync(VENDOR_FILE)) {
    console.error('ERROR: Vendored file not found:', VENDOR_FILE);
    console.error('Run: curl -fsSL https://raw.githubusercontent.com/aparrish/wordfreq-en-25000/main/wordfreq-en-25000-log.json \\');
    console.error('          -o apps/longshot/data/vendor/wordfreq-en-25000-log.json');
    process.exit(1);
  }

  console.log('Loading upstream wordfreq file…');
  const upstream = JSON.parse(readFileSync(VENDOR_FILE, 'utf8'));
  console.log(`  ${upstream.length} entries in upstream file`);

  // 2. Filter: lowercase, letters-only, 5+ chars
  const filtered = [];
  for (const [word, logFreq] of upstream) {
    if (typeof word !== 'string') continue;
    const w = word.toLowerCase();
    if (w.length >= 5 && /^[a-z]+$/.test(w)) {
      filtered.push({ word: w, logFreq, rank: filtered.length + 1 });
    }
  }
  console.log(`  ${filtered.length} words after letters-only/5+ filter`);

  // 3. Take top N by frequency rank
  const topN = filtered.slice(0, RANK_CUTOFF);
  console.log(`  Taking top ${RANK_CUTOFF} → ${topN.length} words`);

  // 4. Load allowlist and denylist
  const allowlist = loadLines(ALLOW_FILE);
  const denylist  = loadLines(DENY_FILE);
  console.log(`  Allowlist: ${allowlist.size} words`);
  console.log(`  Denylist:  ${denylist.size} words`);

  // 5. Build final set
  const final = new Set();

  // Start with topN, remove denylist entries
  let denied = 0;
  for (const { word } of topN) {
    if (denylist.has(word)) {
      if (verbose) console.log(`  DENY: ${word}`);
      denied++;
    } else {
      final.add(word);
    }
  }
  console.log(`  Removed by denylist: ${denied}`);

  // Add allowlist entries (force-include regardless of rank)
  let forced = 0;
  for (const word of allowlist) {
    if (!final.has(word)) {
      final.add(word);
      forced++;
      if (verbose) console.log(`  ALLOW (forced): ${word}`);
    }
  }
  console.log(`  Added by allowlist: ${forced}`);

  // 6. Write output
  const sorted = [...final].sort();
  writeFileSync(OUT_FILE, sorted.join('\n') + '\n', 'utf8');

  console.log(`\n✓ Written ${sorted.length} words → ${OUT_FILE}`);

  // Summary by length
  for (let len = 5; len <= 10; len++) {
    const count = sorted.filter(w => w.length === len).length;
    if (count > 0) console.log(`  ${len} letters: ${count}`);
  }
  const longer = sorted.filter(w => w.length > 10).length;
  if (longer > 0) console.log(`  11+ letters: ${longer}`);

  // Spot-check key words
  console.log('\nSpot-check:');
  const checks = ['rating', 'staring', 'treating', 'coating', 'floating', 'droit', 'sprue', 'groat'];
  for (const w of checks) {
    const status = final.has(w) ? '✓ INCLUDED' : '✗ excluded';
    const upstreamEntry = filtered.find(e => e.word === w);
    const rankInfo = upstreamEntry ? ` (upstream rank ${upstreamEntry.rank})` : ' (not in upstream top 25k)';
    console.log(`  ${w}: ${status}${rankInfo}`);
  }
}

main();
