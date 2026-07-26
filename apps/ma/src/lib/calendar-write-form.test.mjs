/**
 * Tests for the "Toevoegen aan agenda" submit gate, plus a source-level guard
 * on the event binding that made the gate impossible to satisfy on mobile.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { legIsComplete, blockingReason } from './calendar-write-form.js';

const COMPLETE = {
  title: 'Rit met Voorbeeld Chauffeur',
  date: '2026-08-09',
  startTime: '16:45',
  endTime: '17:00',
  location: 'Voorbeeldlocatie',
};

// ── legIsComplete ──────────────────────────────────────────────────────────

test('a fully filled leg is complete', () => {
  assert.equal(legIsComplete(COMPLETE), true);
});

test('a leg is incomplete while any required field is blank', () => {
  for (const field of ['title', 'date', 'startTime', 'endTime']) {
    assert.equal(legIsComplete({ ...COMPLETE, [field]: '' }), false, `blank ${field}`);
  }
});

test('a whitespace-only title does not count as a title', () => {
  assert.equal(legIsComplete({ ...COMPLETE, title: '   ' }), false);
});

test('an end time at or before the start time is rejected', () => {
  assert.equal(legIsComplete({ ...COMPLETE, endTime: '16:45' }), false);
  assert.equal(legIsComplete({ ...COMPLETE, endTime: '16:30' }), false);
});

test('times compare ordinally across the hour boundary', () => {
  assert.equal(legIsComplete({ ...COMPLETE, startTime: '09:45', endTime: '10:00' }), true);
});

test('a missing leg object is never complete', () => {
  assert.equal(legIsComplete(undefined), false);
  assert.equal(legIsComplete(null), false);
});

// ── blockingReason ─────────────────────────────────────────────────────────

test('a complete, confirmed single leg is not blocked', () => {
  assert.equal(blockingReason([COMPLETE], true), null);
});

test('an unchecked confirmation blocks submission', () => {
  assert.equal(blockingReason([COMPLETE], false), 'Vink aan dat je alles hebt gecontroleerd.');
});

test('an empty leg list is blocked', () => {
  assert.equal(blockingReason([], true), 'Er is niets om toe te voegen.');
  assert.equal(blockingReason(undefined, true), 'Er is niets om toe te voegen.');
});

test('each missing field names itself', () => {
  assert.match(blockingReason([{ ...COMPLETE, title: '' }], true), /titel/);
  assert.match(blockingReason([{ ...COMPLETE, date: '' }], true), /datum/);
  assert.match(blockingReason([{ ...COMPLETE, startTime: '' }], true), /begintijd/);
  assert.match(blockingReason([{ ...COMPLETE, endTime: '' }], true), /eindtijd/);
  assert.match(blockingReason([{ ...COMPLETE, endTime: '16:00' }], true), /na de begintijd/);
});

test('field problems are reported before the confirmation checkbox', () => {
  // Telling the owner to tick a box while a field is still empty would send
  // them back and forth; the field is the nearer problem.
  assert.match(blockingReason([{ ...COMPLETE, date: '' }], false), /datum/);
});

test('a two-leg ride labels which leg is incomplete', () => {
  assert.match(blockingReason([COMPLETE, { ...COMPLETE, endTime: '' }], true), /^Terug: /);
  assert.match(blockingReason([{ ...COMPLETE, date: '' }, COMPLETE], true), /^Heen: /);
});

test('a single leg is not labelled Heen/Terug', () => {
  const reason = blockingReason([{ ...COMPLETE, date: '' }], true);
  assert.ok(!reason.startsWith('Heen:') && !reason.startsWith('Terug:'), reason);
});

// ── Regression guard: the mobile date/time picker binding ──────────────────
//
// The original modal bound only `input`. iOS Safari's native date and time
// pickers commit on `change` and do not reliably fire `input`, so the legs
// state never caught up with the visible form: the submit button stayed
// disabled and tapping "Toevoegen" did nothing, with no error shown. There is
// no DOM in this test runner, so this asserts the binding at the source level
// — enough to stop the bug being reintroduced by a future edit.

const MODAL_SOURCE = readFileSync(
  fileURLToPath(new URL('../components/calendar-write-modal.js', import.meta.url)),
  'utf8',
);

test('the modal binds change as well as input on its fields', () => {
  assert.match(MODAL_SOURCE, /addEventListener\('input', syncFromDom\)/);
  assert.match(MODAL_SOURCE, /addEventListener\('change', syncFromDom\)/);
});

test('the modal re-reads the form before submitting', () => {
  // A field still being edited when "Toevoegen" is tapped must reach the
  // payload — the rendered inputs are the source of truth, not the cache.
  const submitHandler = MODAL_SOURCE.slice(MODAL_SOURCE.indexOf("submitBtn.addEventListener('click'"));
  const syncAt = submitHandler.indexOf('syncFromDom()');
  const requestAt = submitHandler.indexOf('requestCalendarWrite(');
  assert.ok(syncAt > -1, 'submit handler syncs from the DOM');
  assert.ok(requestAt > syncAt, 'the sync happens before the request is built');
});
