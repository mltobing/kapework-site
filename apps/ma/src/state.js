/**
 * src/state.js
 *
 * Minimal reactive state store for the Ma app.
 * Components subscribe to changes and get called with the full state snapshot.
 */

const _state = {
  /** @type {import('@supabase/supabase-js').User|null} */
  user:     null,
  /** @type {{ display_name: string, relationship: string, avatar_url: string }|null} */
  profile:  null,
  /** @type {string|null} UUID of the family this user belongs to (or serves, for a caregiver) */
  familyId: null,
  /** @type {'owner'|'member'|'caregiver'|null} Resolved once at sign-in — never inferred from UI or email. */
  accessType: null,
};

const _listeners = new Set();

/**
 * Returns a shallow copy of the current state.
 */
export function getState() {
  return { ..._state };
}

/**
 * Merges updates into the state and notifies all subscribers.
 * @param {Partial<typeof _state>} updates
 */
export function setState(updates) {
  Object.assign(_state, updates);
  const snapshot = getState();
  _listeners.forEach(fn => fn(snapshot));
}

/**
 * Subscribe to state changes.
 * @param {(state: typeof _state) => void} fn
 * @returns {() => void} Unsubscribe function
 */
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
