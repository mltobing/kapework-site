/**
 * lib/route-parse.js
 *
 * Pure hash-fragment parsing for the router — split out from router.js so it
 * can be unit tested without a browser `window`/`location` global (router.js
 * itself registers a `window.addEventListener('hashchange', …)` at module
 * load, which only works in a real browser). See router.js for how this is
 * actually wired into navigation, and lib/route-parse.test.mjs for the tests.
 */

/**
 * Splits a raw hash fragment (e.g. "document-beoordelen?id=<uuid>") into its
 * route name and a URLSearchParams of whatever follows the first '?'.
 * @param {string} hash
 * @returns {{ name: string, params: URLSearchParams }}
 */
export function parseRouteHash(hash) {
  const raw = String(hash || '');
  const qIndex = raw.indexOf('?');
  const name = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const search = qIndex === -1 ? '' : raw.slice(qIndex + 1);
  return { name, params: new URLSearchParams(search) };
}

/**
 * Builds the full hash string navigate() should set: the bare route name, or
 * `name?query` when params are given. Never put source text or document
 * content here — only short, opaque identifiers.
 * @param {string} name
 * @param {Record<string, string>} [params]
 * @returns {string}
 */
export function buildRouteHash(name, params) {
  if (!params || Object.keys(params).length === 0) return name;
  const search = new URLSearchParams(params).toString();
  return search ? `${name}?${search}` : name;
}
