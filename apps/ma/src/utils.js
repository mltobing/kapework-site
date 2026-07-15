/**
 * src/utils.js
 *
 * Shared, non-date helpers used throughout the Ma app.
 *
 * All date/time formatting lives in src/lib/datetime.js and is rendered in
 * Europe/Amsterdam regardless of the viewer's device timezone. Import the
 * formatters (formatTime, formatDayHeader, formatRelative, todayAms, …) from
 * there — do not format dates with the device timezone anywhere in this app.
 */

/**
 * Safely escapes a string for insertion into innerHTML.
 * Use this any time user-supplied text is rendered via HTML templates.
 */
export function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/**
 * Returns the first letter of a name, uppercased, or '?' if empty.
 */
export function getInitial(name) {
  return name ? name.trim().charAt(0).toUpperCase() : '?';
}
