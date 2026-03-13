/**
 * subdomain-nav.js
 *
 * Injects a subtle "← Kapework" footer strip when a page is served from a
 * *.kapework.com subdomain (e.g. make24.kapework.com).
 *
 * Does nothing on kapework.com, www.kapework.com, or localhost.
 * Safe to include in every app — activates only when relevant.
 */
(function () {
  'use strict';

  var host = location.hostname;
  var m    = host.match(/^([a-z0-9-]+)\.kapework\.com$/i);
  if (!m || m[1] === 'www') return;

  var bar  = document.createElement('div');
  bar.id   = 'kw-home-bar';
  bar.innerHTML =
    '<a href="https://kapework.com">' +
      '\u2190 Kapework' +   // ← Kapework
    '</a>';

  /* Layout — fixed footer strip */
  var bs = bar.style;
  bs.position         = 'fixed';
  bs.bottom           = '0';
  bs.left             = '0';
  bs.right            = '0';
  bs.zIndex           = '9999';
  bs.padding          = '10px 16px';
  bs.paddingBottom    = 'calc(10px + env(safe-area-inset-bottom, 0px))';
  bs.background       = 'rgba(10,22,40,0.88)';
  bs.backdropFilter   = 'blur(6px)';
  bs.webkitBackdropFilter = 'blur(6px)';
  bs.borderTop        = '1px solid rgba(232,237,245,0.06)';
  bs.textAlign        = 'center';

  /* Link style */
  var a  = bar.querySelector('a');
  var as = a.style;
  as.color          = 'rgba(232,237,245,0.55)';
  as.textDecoration = 'none';
  as.fontFamily     = '"DM Sans",-apple-system,BlinkMacSystemFont,sans-serif';
  as.fontSize       = '13px';
  as.letterSpacing  = '0.02em';

  function inject() {
    if (!document.getElementById('kw-home-bar')) {
      document.body.appendChild(bar);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
}());
