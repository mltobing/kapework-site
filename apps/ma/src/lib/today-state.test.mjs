/**
 * Tests for the deterministic today-state engine.
 *
 * Run with Node's built-in runner (no dependencies):
 *   node --test apps/ma/src/lib/today-state.test.mjs
 *
 * The engine pins every comparison to Europe/Amsterdam via Intl, so its output
 * must be identical no matter what timezone the process runs in. The npm script
 * "test:today-state" runs this file under UTC, America/New_York, Europe/Amsterdam
 * and Asia/Jakarta to prove that invariance; the assertions below are the same in
 * every one.
 *
 * Instants are written with an explicit Amsterdam offset (+02:00 in CEST/summer,
 * +01:00 in CET/winter) so each event's wall-clock time is unambiguous.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTodayState } from './today-state.js';

// Fresh sync = "now minus 10 minutes" unless a test overrides it, so nothing is
// stale by accident.
function ev(startsAt, opts = {}) {
  return {
    uid:           opts.uid ?? startsAt,
    title:         opts.title ?? 'Afspraak',
    startsAt,
    endsAt:        opts.endsAt ?? null,
    allDay:        opts.allDay ?? false,
    location:      opts.location ?? null,
    status:        opts.status ?? 'confirmed',
    downstairsAt:  opts.downstairsAt ?? null,
    contactWindow: opts.contactWindow ?? null,
  };
}

function state(events, now, extra = {}) {
  return computeTodayState({
    events,
    now,
    calendarLastSyncedAt: extra.sync ?? new Date(new Date(now).getTime() - 10 * 60_000).toISOString(),
    ...(extra.staleThresholdMs ? { staleThresholdMs: extra.staleThresholdMs } : {}),
  });
}

// ─── Empty ────────────────────────────────────────────────────────────────────

test('empty day → "Vandaag geen afspraken."', () => {
  const s = state([], '2026-07-21T08:00:00+02:00');
  assert.equal(s.nu.kind, 'empty');
  assert.equal(s.nu.headline, 'Vandaag geen afspraken.');
  assert.equal(s.isEmpty, true);
  assert.equal(s.stale, false);
});

// ─── Before / during / after ────────────────────────────────────────────────

test('before the next timed event states the exact source time', () => {
  const s = state([ev('2026-07-21T09:30:00+02:00')], '2026-07-21T08:00:00+02:00');
  assert.equal(s.nu.kind, 'before');
  assert.equal(s.nu.headline, 'De volgende afspraak is om 09:30.');
  assert.equal(s.nu.detail, null);
});

test('during an event shows Nu + the source end time when present', () => {
  const s = state(
    [ev('2026-07-21T09:30:00+02:00', { endsAt: '2026-07-21T10:30:00+02:00', title: 'Fysio' })],
    '2026-07-21T10:00:00+02:00',
  );
  assert.equal(s.nu.kind, 'during');
  assert.equal(s.nu.headline, 'Nu: Fysio');
  assert.equal(s.nu.detail, 'Tot 10:30.');
});

test('during an event with no end shows no end time', () => {
  const s = state(
    [ev('2026-07-21T09:30:00+02:00'), ev('2026-07-21T11:00:00+02:00')],
    '2026-07-21T10:00:00+02:00',
  );
  assert.equal(s.nu.kind, 'during');
  assert.equal(s.nu.detail, null);
});

test('after the final timed event', () => {
  const s = state(
    [ev('2026-07-21T09:30:00+02:00', { endsAt: '2026-07-21T10:00:00+02:00' })],
    '2026-07-21T12:00:00+02:00',
  );
  assert.equal(s.nu.kind, 'after');
  assert.equal(s.nu.headline, 'Uw afspraken voor vandaag zijn afgelopen.');
});

test('multiple events: past ones are flagged, next drives the Nu card', () => {
  const s = state(
    [
      ev('2026-07-21T08:00:00+02:00', { endsAt: '2026-07-21T08:30:00+02:00' }),
      ev('2026-07-21T14:00:00+02:00'),
    ],
    '2026-07-21T10:00:00+02:00',
  );
  assert.equal(s.schedule.timed.length, 2);
  assert.equal(s.schedule.timed[0].past, true);
  assert.equal(s.schedule.timed[1].past, false);
  assert.equal(s.nu.headline, 'De volgende afspraak is om 14:00.');
});

// ─── All-day ─────────────────────────────────────────────────────────────────

test('all-day event is listed but creates no go-now instruction', () => {
  const s = state(
    [ev('2026-07-21T00:00:00+02:00', { allDay: true, title: 'Verjaardag' })],
    '2026-07-21T10:00:00+02:00',
  );
  assert.equal(s.schedule.allDay.length, 1);
  assert.equal(s.schedule.timed.length, 0);
  assert.equal(s.nu.kind, 'empty_allday');
  assert.equal(s.isEmpty, false);
});

// ─── Downstairs boundary ─────────────────────────────────────────────────────

test('downstairs: before the explicit time → wait', () => {
  const s = state(
    [ev('2026-07-21T09:30:00+02:00', { downstairsAt: '09:00' })],
    '2026-07-21T08:50:00+02:00',
  );
  assert.equal(s.nu.kind, 'downstairs_wait');
  assert.equal(s.nu.headline, 'U hoeft nog niet naar beneden.');
  assert.match(s.nu.detail, /om 09:00 naar beneden/);
  assert.match(s.nu.detail, /om 09:30/);
});

test('downstairs: exactly at the explicit time → go', () => {
  const s = state(
    [ev('2026-07-21T09:30:00+02:00', { downstairsAt: '09:00' })],
    '2026-07-21T09:00:00+02:00',
  );
  assert.equal(s.nu.kind, 'downstairs_go');
  assert.equal(s.nu.headline, 'U kunt nu naar beneden.');
});

test('downstairs: after the explicit time, before start → go', () => {
  const s = state(
    [ev('2026-07-21T09:30:00+02:00', { downstairsAt: '09:00' })],
    '2026-07-21T09:15:00+02:00',
  );
  assert.equal(s.nu.kind, 'downstairs_go');
});

test('no downstairs source time → never manufactured, just the next time', () => {
  const s = state([ev('2026-07-21T09:30:00+02:00')], '2026-07-21T09:15:00+02:00');
  assert.equal(s.nu.kind, 'before');
  assert.equal(s.nu.headline, 'De volgende afspraak is om 09:30.');
});

// ─── Contact window ──────────────────────────────────────────────────────────

test('contact window stays a window; its start is not an arrival time', () => {
  const s = state(
    [ev('2026-07-21T10:00:00+02:00', { contactWindow: { start: '09:30', end: '10:00' } })],
    '2026-07-21T09:00:00+02:00',
  );
  assert.equal(s.nu.kind, 'before');
  assert.equal(s.nu.headline, 'De volgende afspraak is om 10:00.'); // start, not 09:30
  assert.equal(s.nu.detail, 'Contact tussen 09:30 en 10:00.');
});

// ─── Cancelled ───────────────────────────────────────────────────────────────

test('cancelled events are ignored', () => {
  const s = state(
    [ev('2026-07-21T09:30:00+02:00', { status: 'cancelled' })],
    '2026-07-21T08:00:00+02:00',
  );
  assert.equal(s.nu.kind, 'empty');
  assert.equal(s.schedule.timed.length, 0);
});

// ─── Staleness ───────────────────────────────────────────────────────────────

test('stale calendar suppresses the actionable "go now" cue', () => {
  const s = state(
    [ev('2026-07-21T09:30:00+02:00', { downstairsAt: '09:00' })],
    '2026-07-21T09:15:00+02:00',
    { sync: '2026-07-21T00:00:00+02:00' }, // ~9h old
  );
  assert.equal(s.stale, true);
  assert.notEqual(s.nu.kind, 'downstairs_go');
  assert.equal(s.nu.headline, 'De volgende afspraak is om 09:30.');
  assert.equal(s.staleNotice, 'De informatie is misschien niet actueel.');
});

test('unknown last-sync is treated as stale', () => {
  const s = computeTodayState({
    events: [ev('2026-07-21T09:30:00+02:00')],
    now: '2026-07-21T08:00:00+02:00',
    calendarLastSyncedAt: null,
  });
  assert.equal(s.stale, true);
  assert.equal(s.staleNotice, 'De informatie is misschien niet actueel.');
});

test('stale does not suppress a non-actionable state, only flags it', () => {
  const s = state(
    [ev('2026-07-21T14:00:00+02:00')],
    '2026-07-21T08:00:00+02:00',
    { sync: '2026-07-21T00:00:00+02:00' },
  );
  assert.equal(s.stale, true);
  assert.equal(s.nu.kind, 'before');
  assert.equal(s.nu.headline, 'De volgende afspraak is om 14:00.');
});

// ─── CET vs CEST ─────────────────────────────────────────────────────────────

test('CET (winter) date formats the Amsterdam wall-clock time', () => {
  const s = state([ev('2026-01-15T09:30:00+01:00')], '2026-01-15T08:00:00+01:00');
  assert.equal(s.nu.headline, 'De volgende afspraak is om 09:30.');
});

test('CEST (summer) date formats the Amsterdam wall-clock time', () => {
  const s = state([ev('2026-07-15T09:30:00+02:00')], '2026-07-15T08:00:00+02:00');
  assert.equal(s.nu.headline, 'De volgende afspraak is om 09:30.');
});

// ─── Midnight / day boundary ─────────────────────────────────────────────────

test('tomorrow\'s event does not appear in today', () => {
  const s = state(
    [ev('2026-07-22T09:30:00+02:00')],
    '2026-07-21T23:30:00+02:00',
  );
  assert.equal(s.isEmpty, true);
  assert.equal(s.nu.kind, 'empty');
});

test('late-evening event on today is still today', () => {
  const s = state([ev('2026-07-21T23:45:00+02:00')], '2026-07-21T23:30:00+02:00');
  assert.equal(s.nu.kind, 'before');
  assert.equal(s.nu.headline, 'De volgende afspraak is om 23:45.');
});

test('event running past midnight is "during" until end of day, showing its end', () => {
  const s = state(
    [ev('2026-07-21T23:00:00+02:00', { endsAt: '2026-07-22T00:30:00+02:00', title: 'Concert' })],
    '2026-07-21T23:30:00+02:00',
  );
  assert.equal(s.nu.kind, 'during');
  assert.equal(s.nu.headline, 'Nu: Concert');
  assert.equal(s.nu.detail, 'Tot 00:30.');
});
