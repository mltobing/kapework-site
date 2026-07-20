/**
 * Tests for src/lib/datetime.js's monthsAheadISO() — the Agenda view's
 * six-month fetch upper bound (brief §B4: "do not fetch an unbounded lifetime
 * history"). Only an approximate fetch boundary matters here (unlike the
 * private irma-sync job's exact calendar-month clamping), so this checks it
 * lands in the right neighbourhood and moves forward as `months` grows —
 * not day-exact leap/month-end behavior (see irma-sync's own test suite for
 * that).
 *
 * Run with Node's built-in runner:
 *   node --test apps/ma/src/lib/datetime.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthsAheadISO } from './datetime.js';

test('monthsAheadISO(6) is roughly six months in the future', () => {
  const now = Date.now();
  const sixMonthsOut = new Date(monthsAheadISO(6)).getTime();
  const days = (sixMonthsOut - now) / 86_400_000;
  // 6 calendar months is somewhere between ~28*6 and ~31*6 days.
  assert.ok(days > 168 && days < 190, `expected ~6 months out, got ${days} days`);
});

test('monthsAheadISO(0) is essentially now', () => {
  const now = Date.now();
  const zeroOut = new Date(monthsAheadISO(0)).getTime();
  assert.ok(Math.abs(zeroOut - now) < 5000);
});

test('monthsAheadISO grows monotonically with more months', () => {
  const threeOut = new Date(monthsAheadISO(3)).getTime();
  const sixOut = new Date(monthsAheadISO(6)).getTime();
  assert.ok(sixOut > threeOut);
});

test('monthsAheadISO returns a parseable ISO string', () => {
  const iso = monthsAheadISO(6);
  assert.equal(typeof iso, 'string');
  assert.ok(!Number.isNaN(new Date(iso).getTime()));
});
