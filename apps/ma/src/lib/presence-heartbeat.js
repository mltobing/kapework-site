/**
 * lib/presence-heartbeat.js
 *
 * Dependency-injected presence-touch scheduler. Kept free of any
 * Supabase/DOM import (main.js's own dependency chain pulls in supabase-js
 * from esm.sh, which only resolves in a real browser) so this scheduling
 * logic — start/stop/throttle — is unit-testable under plain Node.
 *
 * main.js wires this to the real touchPresence() and the real document;
 * tests wire it to fakes.
 */

export function createPresenceHeartbeat({
  touch,                      // (familyId) => Promise<void>
  intervalMs = 15 * 60 * 1000,
  clientThrottleMs = 60 * 1000,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  addVisibilityListener = null,    // (handler) => void
  removeVisibilityListener = null, // (handler) => void
  isVisible = () => true,
  onError = (err) => console.error('[ma] Presence touch failed:', err),
} = {}) {
  let timer = null;
  let visibilityHandler = null;
  let lastTouchAt = 0;

  function touchThrottled(familyId) {
    const t = now();
    if (t - lastTouchAt < clientThrottleMs) return;
    lastTouchAt = t;
    Promise.resolve(touch(familyId)).catch(onError);
  }

  function start(familyId) {
    stop();
    touchThrottled(familyId);
    timer = setIntervalFn(() => touchThrottled(familyId), intervalMs);
    if (addVisibilityListener) {
      visibilityHandler = () => { if (isVisible()) touchThrottled(familyId); };
      addVisibilityListener(visibilityHandler);
    }
  }

  function stop() {
    if (timer) { clearIntervalFn(timer); timer = null; }
    if (visibilityHandler && removeVisibilityListener) {
      removeVisibilityListener(visibilityHandler);
      visibilityHandler = null;
    }
  }

  return { start, stop };
}
