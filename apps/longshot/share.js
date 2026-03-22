/**
 * share.js — Longshot v2 spoiler-free sharing
 *
 * Share text never reveals the actual answer words.
 */

'use strict';

var MEDAL_EMOJI = { gold: '🥇', silver: '🥈', bronze: '🥉', none: '—' };

function buildShareText(shots, medal, boardNum) {
  var best      = shots.reduce(function(max, w) { return Math.max(max, w.length); }, 0);
  var shotCount = shots.length;
  var medalEmoji = MEDAL_EMOJI[medal] || '—';

  var lines = [
    'Longshot #' + boardNum,
  ];

  if (medal === 'gold' && best >= 8) {
    lines.push('Longshot hit! ' + medalEmoji);
  } else {
    lines.push(medalEmoji + ' ' + (medal === 'none' ? 'No medal' : medal.charAt(0).toUpperCase() + medal.slice(1)));
  }

  lines.push(best + ' letters · ' + shotCount + ' shot' + (shotCount !== 1 ? 's' : ''));
  lines.push('longshot.kapework.com');

  return lines.join('\n');
}

function share(shots, medal, boardNum, onCopied) {
  var text = buildShareText(shots, medal, boardNum);

  if (navigator.share) {
    navigator.share({ text: text }).catch(function() {
      copyFallback(text, onCopied);
    });
  } else {
    copyFallback(text, onCopied);
  }
}

function copyFallback(text, onCopied) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      if (onCopied) onCopied();
    }).catch(function() {
      legacyCopy(text, onCopied);
    });
  } else {
    legacyCopy(text, onCopied);
  }
}

function legacyCopy(text, onCopied) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity  = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); if (onCopied) onCopied(); } catch (e) {}
  document.body.removeChild(ta);
}

window.LongshotShare = { share: share, buildShareText: buildShareText };
