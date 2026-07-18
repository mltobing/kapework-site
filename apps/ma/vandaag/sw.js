/* apps/ma/vandaag/sw.js
 *
 * Minimal service worker for the installable Vandaag display.
 *
 * It caches ONLY the static shell (HTML, CSS, the JS modules). It never caches
 * authenticated API responses — every /.netlify/functions/* request (the Today
 * payload, activation) is passed straight to the network — so no personal data or
 * credential ever lands in the cache.
 *
 *   - navigations      → network-first, fall back to a cached shell when offline
 *   - other GET assets → stale-while-revalidate (fast, self-updating)
 */

const CACHE = 'ma-vandaag-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // only our own origin
  if (url.pathname.includes('/.netlify/')) return;      // never cache API/auth

  // Navigations: prefer fresh HTML, fall back to any cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => { cachePut(req, res); return res; })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))),
    );
    return;
  }

  // Static assets: serve cache immediately, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then(res => { cachePut(req, res); return res; })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

function cachePut(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then(cache => cache.put(req, copy));
  }
}
