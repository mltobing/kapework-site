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
 *
 * Standard event helpers (each app wires these in at the right moment):
 *   KapeworkAnalytics.firstInteraction(props?)   — once per session
 *   KapeworkAnalytics.runStart(props?)           — when a run/game/generation begins
 *   KapeworkAnalytics.runEnd(props?)             — when it ends; adds duration_ms automatically
 *   KapeworkAnalytics.primaryAction(action, props?) — share, download, play_again, etc.
 *
 * Explicit-slug form (useful in ES-module apps):
 *   KapeworkAnalytics.trackEvent('event_name', 'app-slug', props?)
 */
(function () {
  'use strict';

  // ── Read GA measurement ID (build-time config takes precedence) ────────────
  function getMeasurementId() {
    var cfg = window.KapeworkConfig;
    if (cfg && cfg.gaMeasurementId) return cfg.gaMeasurementId;
    return ''; // no fallback — config.js is the source
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

  // ── Once-per-load guards ───────────────────────────────────────────────────
  var _appOpenFired        = false;
  var _firstInteractionFired = false;

  // ── Run lifecycle ──────────────────────────────────────────────────────────
  var _runStartTime = null;

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

  function postEvent(payload) {
    // GA4 — fire-and-forget
    if (_gtag) {
      try { _gtag('event', payload.event_name, payload); } catch (e) {}
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

  function getCompletionMirror(eventName, props) {
    var outcome = null;
    var completionType = null;

    if (eventName === 'solve_success') {
      completionType = 'run_complete';
      outcome = 'win';
    } else if (eventName === 'solve_fail' || eventName === 'game_over') {
      completionType = 'run_fail';
      outcome = 'fail';
    } else if (eventName === 'game_end' || eventName === 'session_end') {
      completionType = 'run_complete';
      outcome = 'complete';
    }

    if (!completionType) return null;

    var mirroredProps = {};
    if (props) {
      for (var k in props) {
        if (Object.prototype.hasOwnProperty.call(props, k)) mirroredProps[k] = props[k];
      }
    }
    if (!mirroredProps.outcome) mirroredProps.outcome = outcome;

    return { completionType: completionType, props: mirroredProps };
  }

  // ── Core trackEvent ────────────────────────────────────────────────────────
  // Signature: trackEvent(eventName, appSlug, props?)
  //   appSlug — pass null/undefined to fall back to window._kw_app_slug
  //   props   — merged into payload; reserved keys (event_name, app_slug,
  //             device_id, session_id, url) are ignored to prevent collisions
  function trackEvent(eventName, appSlug, props) {
    if (!eventName) return;

    var slug = appSlug || window._kw_app_slug || 'unknown';
    if (slug === 'unknown') {
      try {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[KapeworkAnalytics] Missing appSlug for event:', eventName);
        }
      } catch (e) {}
    }

    var payload = {
      event_name: eventName,
      app_slug:   slug,
      device_id:  getDeviceId(),
      session_id: SESSION_ID,
      url:        location.href,
      ts:         new Date().toISOString()
    };

    if (props) {
      for (var k in props) {
        if (Object.prototype.hasOwnProperty.call(props, k) &&
            payload[k] === undefined) {
          payload[k] = props[k];
        }
      }
    }

    postEvent(payload);

    // Mirror common app-specific terminal events into standard completion events.
    // This keeps dashboards stable even when individual apps use custom names.
    if (eventName !== 'run_end') {
      if (eventName === 'run_complete' || eventName === 'run_fail') {
        var terminalProps = {};
        if (props) {
          for (var tp in props) {
            if (Object.prototype.hasOwnProperty.call(props, tp)) terminalProps[tp] = props[tp];
          }
        }
        if (!terminalProps.outcome) terminalProps.outcome = (eventName === 'run_complete' ? 'win' : 'fail');
        runEnd(terminalProps, slug);
        return;
      }

      var mirror = getCompletionMirror(eventName, props);
      if (mirror) {
        var completionPayload = {
          event_name: mirror.completionType,
          app_slug: slug,
          device_id: getDeviceId(),
          session_id: SESSION_ID,
          url: location.href,
          ts: new Date().toISOString()
        };

        for (var cp in mirror.props) {
          if (Object.prototype.hasOwnProperty.call(mirror.props, cp) &&
              completionPayload[cp] === undefined) {
            completionPayload[cp] = mirror.props[cp];
          }
        }

        postEvent(completionPayload);

        // Guarantee a normalized run_end event for all terminal states.
        runEnd(mirror.props, slug);
      }
    }
  }

  // ── Standard event: app_open ───────────────────────────────────────────────
  // Fires once per page load. Called automatically by init().
  // props: { referrer? }
  function fireAppOpen(appSlug) {
    if (_appOpenFired) return;
    _appOpenFired = true;
    trackEvent('app_open', appSlug, { referrer: document.referrer || null });
  }

  // ── Standard event: first_interaction ─────────────────────────────────────
  // Fires once per session on the first meaningful user action.
  // Guard prevents duplicate firing even if called from multiple code paths.
  // props: any summary context the app wants to include
  function firstInteraction(props, appSlug) {
    if (_firstInteractionFired) return;
    _firstInteractionFired = true;
    trackEvent('first_interaction', appSlug || null, props || null);
  }

  // ── Standard event: run_start ──────────────────────────────────────────────
  // Marks the start of a run. Resets the run timer so runEnd() gets duration.
  // props: identifying context (puzzle_num, board_id, level, etc.)
  function runStart(props, appSlug) {
    _runStartTime = Date.now();
    trackEvent('run_start', appSlug || null, props || null);
  }

  // ── Standard event: run_end ────────────────────────────────────────────────
  // Fires when the run ends. Automatically adds duration_ms if runStart was called.
  // props: outcome + summary metrics the app already tracks
  function runEnd(props, appSlug) {
    var extra = {};
    if (props) {
      for (var k in props) {
        if (Object.prototype.hasOwnProperty.call(props, k)) extra[k] = props[k];
      }
    }
    if (_runStartTime !== null) {
      extra.duration_ms = Date.now() - _runStartTime;
      _runStartTime = null;
    }
    var merged = Object.keys(extra).length > 0 ? extra : null;
    trackEvent('run_end', appSlug || null, merged);
  }

  // ── Standard event: primary_action ────────────────────────────────────────
  // Fires on a high-intent post-run action (share, download, play_again, etc.).
  // action: string — e.g. 'share', 'download', 'play_again', 'new_puzzle'
  // props: any extra context
  function primaryAction(action, props, appSlug) {
    var extra = { action: action };
    if (props) {
      for (var k in props) {
        if (Object.prototype.hasOwnProperty.call(props, k)) extra[k] = props[k];
      }
    }
    trackEvent('primary_action', appSlug || null, extra);
  }

  // ── init ───────────────────────────────────────────────────────────────────
  // Call once per app. Sets the app slug and fires app_open (guarded).
  function init(appSlug) {
    window._kw_app_slug = appSlug;
    injectGA(getMeasurementId()); // no-op if already injected at load time
    fireAppOpen(appSlug);
  }

  // ── Auto-init: inject GA as soon as this script loads ─────────────────────
  // GA4 queues a page_view automatically via gtag('config', id).
  // This covers every app that loads config.js + analytics.js,
  // even those that never call KapeworkAnalytics.init().
  injectGA(getMeasurementId());

  // ── Public API ─────────────────────────────────────────────────────────────
  window.KapeworkAnalytics = {
    // Setup
    init: init,

    // Core — explicit-slug form
    trackEvent: trackEvent,

    // Backward-compatible shorthand (uses stored window._kw_app_slug)
    track: function (eventName, props) {
      trackEvent(eventName, null, props);
    },

    // Standard event helpers
    firstInteraction: firstInteraction,
    runStart:         runStart,
    runEnd:           runEnd,
    primaryAction:    primaryAction,

    // Metadata
    getDeviceId: getDeviceId,
    sessionId:   SESSION_ID,
  };
}());
