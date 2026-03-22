/**
 * share.js — Rainbow Rules spoiler-free share text + clipboard
 *
 * Share text format:
 *   Rainbow Rules #214
 *   Gold · 4/6
 *   Rule: All different
 *   rainbowrules.kapework.com
 *
 * The hidden code is NEVER included.
 */

'use strict';

window.RRShare = (function () {

  var MEDAL_LABEL = {
    gold:   'Gold',
    silver: 'Silver',
    bronze: 'Bronze',
    fail:   'Not solved',
  };

  function buildShareText(puzzleNum, medal, guessCount, maxGuesses, ruleLabel) {
    var label = MEDAL_LABEL[medal] || 'Played';
    return [
      'Rainbow Rules #' + puzzleNum,
      label + ' \xB7 ' + guessCount + '/' + maxGuesses,
      'Rule: ' + ruleLabel,
      'rainbowrules.kapework.com',
    ].join('\n');
  }

  function share(puzzleNum, medal, guessCount, maxGuesses, ruleLabel, onCopied) {
    var text = buildShareText(puzzleNum, medal, guessCount, maxGuesses, ruleLabel);

    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {
        copyFallback(text, onCopied);
      });
    } else {
      copyFallback(text, onCopied);
    }
  }

  function copyFallback(text, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (cb) cb();
      }).catch(function () { legacyCopy(text, cb); });
    } else {
      legacyCopy(text, cb);
    }
  }

  function legacyCopy(text, cb) {
    var ta       = document.createElement('textarea');
    ta.value     = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); if (cb) cb(); } catch (e) {}
    document.body.removeChild(ta);
  }

  return {
    share:          share,
    buildShareText: buildShareText,
  };
})();
