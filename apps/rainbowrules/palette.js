/**
 * palette.js — Rainbow Rules color definitions
 *
 * 6 colors: Red, Orange, Yellow, Green, Blue, Purple.
 * Each carries a single-letter label for accessibility (no color-only reliance).
 */

'use strict';

window.RRPalette = (function () {
  var COLORS = [
    { id: 'R', name: 'Red',    label: 'R', css: '#ef4444' },
    { id: 'O', name: 'Orange', label: 'O', css: '#f97316' },
    { id: 'Y', name: 'Yellow', label: 'Y', css: '#eab308' },
    { id: 'G', name: 'Green',  label: 'G', css: '#22c55e' },
    { id: 'B', name: 'Blue',   label: 'B', css: '#3b82f6' },
    { id: 'P', name: 'Purple', label: 'P', css: '#a855f7' },
  ];

  function byId(id) {
    for (var i = 0; i < COLORS.length; i++) {
      if (COLORS[i].id === id) return COLORS[i];
    }
    return null;
  }

  return { COLORS: COLORS, byId: byId };
})();
