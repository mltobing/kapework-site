/* Tests for the server-side Amsterdam/derive helpers.
 * Kept OUT of netlify/functions/ so Netlify never bundles it as a function.
 * Run: node --test netlify/functions-tests/_ma-today-derive.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { amsDateKey, deriveDownstairsAt, deriveContactWindow, sanitizeEvent } = require('../functions/_ma-today-derive');

test('amsDateKey buckets an instant onto its Amsterdam calendar date', () => {
  // 22:30 UTC on 20 July is 00:30 Amsterdam on 21 July (CEST, +02:00).
  assert.equal(amsDateKey('2026-07-20T22:30:00Z'), '2026-07-21');
  assert.equal(amsDateKey('2026-07-21T06:45:00Z'), '2026-07-21');
});

test('deriveDownstairsAt only fires on an explicit "beneden" time', () => {
  assert.equal(deriveDownstairsAt('Taxi', 'Naar beneden om 8:45'), '08:45');
  assert.equal(deriveDownstairsAt('', 'beneden: 08.45'), '08:45');
  assert.equal(deriveDownstairsAt('Taxi om 9:00', 'Geen bijzonderheden'), null); // bare appt time ignored
  assert.equal(deriveDownstairsAt('Fysio', null), null);
});

test('deriveContactWindow returns a window, never a single time', () => {
  assert.deepEqual(deriveContactWindow('Taxi', 'Contact tussen 8:30 en 9:00'), { start: '08:30', end: '09:00' });
  assert.deepEqual(deriveContactWindow('', 'venster 8:30 - 9:00'), { start: '08:30', end: '09:00' });
  assert.equal(deriveContactWindow('Taxi', 'om 9:00'), null);
  // Reversed window is rejected (start must be <= end).
  assert.equal(deriveContactWindow('', 'tussen 9:00 en 8:30'), null);
});

test('sanitizeEvent drops notes and exposes only allowlisted + derived fields', () => {
  const row = {
    external_event_uid: 'uid-1', title: 'Taxi', starts_at: '2026-07-21T06:45:00Z',
    ends_at: null, all_day: false, location: 'Thuis', notes: 'Naar beneden om 8:45',
    status: 'confirmed', external_url: 'https://secret',
  };
  const s = sanitizeEvent(row);
  assert.deepEqual(Object.keys(s).sort(),
    ['allDay', 'contactWindow', 'downstairsAt', 'endsAt', 'location', 'startsAt', 'title', 'uid']);
  assert.equal(s.uid, 'uid-1');
  assert.equal(s.downstairsAt, '08:45');
  assert.equal(s.notes, undefined);
  assert.equal(s.external_url, undefined);
});

test('all-day events never carry a derived downstairs/window time', () => {
  const s = sanitizeEvent({
    external_event_uid: 'uid-2', title: 'Verjaardag beneden om 9:00', starts_at: '2026-07-21T00:00:00+02:00',
    ends_at: null, all_day: true, location: null, notes: null, status: 'confirmed',
  });
  assert.equal(s.allDay, true);
  assert.equal(s.downstairsAt, null);
  assert.equal(s.contactWindow, null);
});
