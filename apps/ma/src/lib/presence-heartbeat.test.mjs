/**
 * Tests for the dependency-injected presence-touch scheduler.
 *
 * Run with Node's built-in runner (no dependencies):
 *   node --test apps/ma/src/lib/presence-heartbeat.test.mjs
 *
 * Everything here is a fake — no real timer, no real DOM, no real network —
 * so the start/stop/throttle/cleanup contract is verified without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceHeartbeat } from './presence-heartbeat.js';

// Starts well past any clientThrottleMs used below so the very first touch()
// isn't accidentally swallowed by the throttle's `lastTouchAt = 0` initial
// value — exactly as real Date.now() (always far from epoch 0) behaves.
function fakeClock(startMs = 10_000_000) {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function fakeTimers() {
  const scheduled = new Map(); // id -> { fn, intervalMs }
  let nextId = 1;
  return {
    setIntervalFn: (fn, ms) => { const id = nextId++; scheduled.set(id, { fn, ms }); return id; },
    clearIntervalFn: (id) => { scheduled.delete(id); },
    fire: (id) => { scheduled.get(id)?.fn(); },
    scheduled,
  };
}

function fakeVisibility() {
  let handler = null;
  return {
    addVisibilityListener: (fn) => { handler = fn; },
    removeVisibilityListener: (fn) => { if (handler === fn) handler = null; },
    trigger: () => handler && handler(),
    get hasHandler() { return handler !== null; },
  };
}

// ─── start() ────────────────────────────────────────────────────────────────

test('start() touches immediately for the given family', async () => {
  const calls = [];
  const clock = fakeClock();
  const timers = fakeTimers();
  const hb = createPresenceHeartbeat({
    touch: (familyId) => { calls.push(familyId); },
    now: clock.now,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });

  hb.start('fam-1');
  assert.deepEqual(calls, ['fam-1']);
});

test('start() registers exactly one interval timer at the configured cadence', () => {
  const clock = fakeClock();
  const timers = fakeTimers();
  const hb = createPresenceHeartbeat({
    touch: () => {},
    intervalMs: 900_000,
    now: clock.now,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });

  hb.start('fam-1');
  assert.equal(timers.scheduled.size, 1);
  const [[, entry]] = timers.scheduled;
  assert.equal(entry.ms, 900_000);
});

test('interval firing touches again after the client throttle window has passed', () => {
  const calls = [];
  const clock = fakeClock();
  const timers = fakeTimers();
  const hb = createPresenceHeartbeat({
    touch: () => { calls.push(clock.now()); },
    clientThrottleMs: 60_000,
    now: clock.now,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });

  hb.start('fam-1');
  assert.equal(calls.length, 1);

  clock.advance(61_000);
  const [[id]] = timers.scheduled;
  timers.fire(id);
  assert.equal(calls.length, 2);
});

// ─── client-side throttle ───────────────────────────────────────────────────

test('rapid repeated touches within the throttle window collapse to one call', () => {
  const calls = [];
  const clock = fakeClock();
  const timers = fakeTimers();
  const vis = fakeVisibility();
  const hb = createPresenceHeartbeat({
    touch: () => { calls.push(clock.now()); },
    clientThrottleMs: 60_000,
    now: clock.now,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    addVisibilityListener: vis.addVisibilityListener,
    removeVisibilityListener: vis.removeVisibilityListener,
    isVisible: () => true,
  });

  hb.start('fam-1'); // 1 call
  clock.advance(1_000);
  vis.trigger(); // within throttle window — should be swallowed
  clock.advance(1_000);
  vis.trigger(); // still within window — swallowed

  assert.equal(calls.length, 1);
});

test('visibility trigger only touches when the page reports visible', () => {
  const calls = [];
  const clock = fakeClock();
  const timers = fakeTimers();
  const vis = fakeVisibility();
  let visible = false;
  const hb = createPresenceHeartbeat({
    touch: () => { calls.push('touch'); },
    clientThrottleMs: 60_000,
    now: clock.now,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    addVisibilityListener: vis.addVisibilityListener,
    removeVisibilityListener: vis.removeVisibilityListener,
    isVisible: () => visible,
  });

  hb.start('fam-1'); // 1 call (start always touches)
  clock.advance(120_000); // clear the throttle window
  visible = false;
  vis.trigger(); // page hidden — no touch
  assert.equal(calls.length, 1);

  visible = true;
  vis.trigger(); // page visible again — touches
  assert.equal(calls.length, 2);
});

// ─── stop() / cleanup ───────────────────────────────────────────────────────

test('stop() clears the interval timer', () => {
  const clock = fakeClock();
  const timers = fakeTimers();
  const hb = createPresenceHeartbeat({
    touch: () => {},
    now: clock.now,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });

  hb.start('fam-1');
  assert.equal(timers.scheduled.size, 1);
  hb.stop();
  assert.equal(timers.scheduled.size, 0);
});

test('stop() removes the visibility listener so later events touch nothing', () => {
  const calls = [];
  const clock = fakeClock();
  const timers = fakeTimers();
  const vis = fakeVisibility();
  const hb = createPresenceHeartbeat({
    touch: () => { calls.push('touch'); },
    now: clock.now,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    addVisibilityListener: vis.addVisibilityListener,
    removeVisibilityListener: vis.removeVisibilityListener,
    isVisible: () => true,
  });

  hb.start('fam-1');
  assert.equal(vis.hasHandler, true);
  hb.stop();
  assert.equal(vis.hasHandler, false);

  vis.trigger(); // no-op — handler was removed
  assert.equal(calls.length, 1); // only the initial start() touch
});

test('stop() before start() is a safe no-op', () => {
  const hb = createPresenceHeartbeat({ touch: () => {} });
  assert.doesNotThrow(() => hb.stop());
});

test('calling start() twice does not leak a second interval timer', () => {
  const clock = fakeClock();
  const timers = fakeTimers();
  const hb = createPresenceHeartbeat({
    touch: () => {},
    now: clock.now,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });

  hb.start('fam-1');
  hb.start('fam-2');
  assert.equal(timers.scheduled.size, 1);
});

// ─── error handling ─────────────────────────────────────────────────────────

test('a rejected touch() is routed to onError, never thrown', async () => {
  const errors = [];
  const timers = fakeTimers();
  const hb = createPresenceHeartbeat({
    touch: () => Promise.reject(new Error('network down')),
    onError: (err) => errors.push(err.message),
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });

  assert.doesNotThrow(() => hb.start('fam-1'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(errors, ['network down']);
  hb.stop();
});

test('a synchronously throwing touch() propagates (onError only catches rejections) — real touch() is always async', () => {
  const errors = [];
  const timers = fakeTimers();
  const hb = createPresenceHeartbeat({
    touch: () => { throw new Error('boom'); },
    onError: (err) => errors.push(err.message),
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });

  // Documents the contract: touch() must return a Promise (as the real
  // api.js touchPresence() — an `async function` — always does), not throw
  // synchronously, or the exception bypasses onError entirely.
  assert.throws(() => hb.start('fam-1'));
  assert.deepEqual(errors, []);
});
