/* shared/analytics.js — Kapework shared analytics client
 *
 * Usage:
 *   Set window.GA_MEASUREMENT_ID before loading this script (optional).
 *   Call KapeworkAnalytics.init('app-slug') once on page load.
 *   Call KapeworkAnalytics.track('event_name', { extra: 'props' }) anywhere.
 */
(function () {
  'use strict';

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

  // ── GA4 injection (one snippet per page) ───────────────────────────────────
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
  function init(appSlug) {
    window._kw_app_slug = appSlug;
    injectGA(window.GA_MEASUREMENT_ID);
    trackEvent('app_open');
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.KapeworkAnalytics = {
    init:      init,
    track:     trackEvent,
    getDeviceId: getDeviceId,
    sessionId: SESSION_ID
  };
}());
