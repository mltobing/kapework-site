/**
 * src/router.js
 *
 * Hash-based single-page router for the Ma app.
 * Routes correspond to the bottom-tab navigation tabs.
 */

// 'devices' (Apparaten) is a routable view reached from the top-bar menu, not the
// bottom navigation — it is rarely needed and must not crowd the six core tabs.
const TABS = new Set(['today', 'briefing', 'logboek', 'calendar', 'people', 'compose', 'devices']);

const _listeners = new Set();

/**
 * Returns the current route from the URL hash, defaulting to 'today'.
 */
export function currentRoute() {
  const hash = location.hash.slice(1);
  return TABS.has(hash) ? hash : 'today';
}

/**
 * Navigate to a tab by name.
 * @param {string} tab
 */
export function navigate(tab) {
  location.hash = TABS.has(tab) ? tab : 'today';
}

/**
 * Subscribe to route changes.
 * @param {(route: string) => void} fn
 * @returns {() => void} Unsubscribe function
 */
export function onRoute(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

window.addEventListener('hashchange', () => {
  const route = currentRoute();
  _listeners.forEach(fn => fn(route));
});
