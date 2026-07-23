/**
 * src/router.js
 *
 * Hash-based single-page router for the Ma app.
 * Routes correspond to the bottom-tab navigation tabs.
 */

// 'devices' (Apparaten) is a routable view reached from the top-bar menu, not the
// bottom navigation — it is rarely needed and must not crowd the core tabs.
// 'people' is a temporary legacy alias for the retired Mensen tab — main.js
// redirects it to 'beheer' (owner) or 'today' (everyone else) rather than
// mounting a view for it; kept recognized here so currentRoute() doesn't
// collapse it to 'today' before that redirect logic ever sees it.
// 'documenten' / 'document-verwerken' / 'document-beoordelen' are the
// owner-only Document Inbox routes (see main.js's ROUTE_ACCESS) — not part of
// the bottom navigation either, reached from Logboek's "Documenten verwerken"
// entry point.
import { parseRouteHash, buildRouteHash } from './lib/route-parse.js';

const TABS = new Set([
  'today', 'briefing', 'logboek', 'calendar', 'beheer', 'people', 'compose', 'devices', 'prullenbak', 'uitleg',
  'documenten', 'document-verwerken', 'document-beoordelen',
]);

const _listeners = new Set();

/**
 * Returns the current route *name* from the URL hash (query params stripped),
 * defaulting to 'today'.
 */
export function currentRoute() {
  const { name } = parseRouteHash(location.hash.slice(1));
  return TABS.has(name) ? name : 'today';
}

/**
 * Query params carried on the current hash, e.g. `#document-beoordelen?id=<uuid>`
 * → `routeParams().get('id')`. Always safe to call; returns an empty
 * URLSearchParams for a route with none.
 * @returns {URLSearchParams}
 */
export function routeParams() {
  const { params } = parseRouteHash(location.hash.slice(1));
  return params;
}

/**
 * Navigate to a tab by name, optionally carrying a small set of query params
 * (e.g. `navigate('document-beoordelen', { id: importId })`). Never pass
 * source text or document content here — params belong in the URL, so only
 * short opaque identifiers.
 * @param {string} tab
 * @param {Record<string, string>} [params]
 */
export function navigate(tab, params) {
  const name = TABS.has(tab) ? tab : 'today';
  location.hash = buildRouteHash(name, params);
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
