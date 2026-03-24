/* share.js — Proof Grid 6×6: spoiler-free share text */

"use strict";

var PG36Share = (function () {

  /**
   * Build share text.
   * @param {object} opts
   *   opts.dayIndex   - integer day index used as puzzle number
   *   opts.tier       - 'Perfect' | 'Clean' | 'Solved'
   *   opts.failed     - number of failed checks (0 or 1)
   *   opts.maxChecks  - total checks allowed (1 for 6×6 mode)
   *   opts.timeMs     - solve time in milliseconds
   */
  function buildText(opts) {
    var number    = opts.dayIndex || PG36Generator.dayIndex();
    var tier      = opts.tier || 'Solved';
    var failed    = opts.failed || 0;
    var maxChecks = opts.maxChecks || 1;
    var timeStr   = formatTime(opts.timeMs || 0);

    return (
      'Proof Grid 6\u00d76 #' + number + '\n' +
      tier + '\n' +
      failed + '/' + maxChecks + ' checks \u00b7 ' + timeStr + '\n' +
      'proofgrid36.kapework.com'
    );
  }

  function formatTime(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60), sec = s % 60;
    return m + 'm' + (sec > 0 ? ' ' + sec + 's' : '');
  }

  /**
   * Share or copy the text.
   * @param {string} text
   * @param {HTMLElement} btn  - the Share button element (for feedback copy)
   */
  function share(text, btn) {
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        if (btn) {
          var orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(function () { btn.textContent = orig; }, 2000);
        }
      }).catch(function () {});
    }
  }

  return { buildText: buildText, share: share };

})();
