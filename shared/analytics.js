/* shared/analytics.js — Kapework shared analytics client
 *
 * Requires: /shared/config.js loaded before this script (sets window.KapeworkConfig).
 *
 * Basic usage (page_view fires automatically — no JS needed):
 *   <script src="/shared/config.js"></script>
 *   <script src="/shared/analytics.js"></script>
 *
 * Full usage (also fires app_open + custom events):
 *   KapeworkAnalytics.init('app-slug');
 *   KapeworkAnalytics.track('event_name', { extra: 'props' });
 */
(function () {
  'use strict';

  // ── Read GA measurement ID (build-time config takes precedence) ────────────
  function getMeasurementId() {
    var cfg = window.KapeworkConfig;
    if (cfg && cfg.gaMeasurementId) return cfg.gaMeasurementId;
    return ''; // no fallback to window.GA_MEASUREMENT_ID — config.js is the source
  }

  // ── device_id (anonymous, persistent across sessions) ──────────────────────
  function getDeviceId() {
    var KEY = 'kw_device_id';
    var id = null;
    try { id = localStorage.getItem(KEY); } catch (e) {}
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem(KEY, id); } catch (e) {}
    }
    return id;
  }

  // ── session_id (per page-load, not persisted) ──────────────────────────────
  var SESSION_ID = 'ses_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // ── GA4 injection (idempotent — safe to call multiple times) ───────────────
  var _gtag = null;

  function injectGA(measurementId) {
    if (!measurementId) return;
    if (document.getElementById('kw-gtag-script')) return; // already injected

    var s = document.createElement('script');
    s.id = 'kw-gtag-script';
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    // GA4 fires page_view automatically on this call
    gtag('config', measurementId);
    _gtag = gtag;
  }

  // ── trackEvent ─────────────────────────────────────────────────────────────
  function trackEvent(eventName, props) {
    if (!eventName) return;

    var payload = {
      event_name: eventName,
      app_slug:   window._kw_app_slug || 'unknown',
      device_id:  getDeviceId(),
      session_id: SESSION_ID,
      url:        location.href,
      ts:         new Date().toISOString()
    };

    // Merge extra props (exclude reserved keys to avoid collisions)
    if (props) {
      for (var k in props) {
        if (Object.prototype.hasOwnProperty.call(props, k) &&
            payload[k] === undefined) {
          payload[k] = props[k];
        }
      }
    }

    // GA4 — fire-and-forget
    if (_gtag) {
      try { _gtag('event', eventName, payload); } catch (e) {}
    }

    // Netlify function — fire-and-forget, never blocks the user
    try {
      fetch('/.netlify/functions/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  // ── init ───────────────────────────────────────────────────────────────────
  // Call this for apps that need app_open tracking and custom events.
  // injectGA is idempotent — calling init() after the auto-init below is safe.
  function init(appSlug) {
    window._kw_app_slug = appSlug;
    injectGA(getMeasurementId()); // no-op if already injected at load time
    trackEvent('app_open');
  }

  // ── Auto-init: inject GA as soon as this script loads ─────────────────────
  // GA4 queues a page_view automatically via gtag('config', id).
  // This covers every app that loads config.js + analytics.js,
  // even those that never call KapeworkAnalytics.init().
  injectGA(getMeasurementId());

  // ── Public API ─────────────────────────────────────────────────────────────
  window.KapeworkAnalytics = {
    init:        init,
    track:       trackEvent,
    getDeviceId: getDeviceId,
    sessionId:   SESSION_ID
  };
}());
