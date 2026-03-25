/**
 * src/utils.js
 *
 * Shared helpers used throughout the Ma app.
 */

/**
 * Format a date string as "Wednesday, March 25, 2026"
 * Uses the user's local timezone for display.
 */
export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
    year:    'numeric',
  });
}

/**
 * Format a date string as "Mar 25"
 */
export function formatDateShort(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
  });
}

/**
 * Format a date string as "3:30 PM"
 */
export function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour:   'numeric',
    minute: '2-digit',
  });
}

/**
 * Returns a human-friendly relative time label:
 * "Just now", "5m ago", "3h ago", "Yesterday", "Mar 22", etc.
 */
export function formatRelative(dateStr) {
  const d       = new Date(dateStr);
  const now     = new Date();
  const diffMs  = now - d;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr  = Math.floor(diffMin  / 60);
  const diffDay = Math.floor(diffHr   / 24);

  if (diffMin < 1)   return 'Just now';
  if (diffMin < 60)  return `${diffMin}m ago`;
  if (diffHr  < 24)  return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay <  7)  return `${diffDay} days ago`;
  return formatDateShort(dateStr);
}

/**
 * Returns today's date formatted as "Wednesday, March 25, 2026"
 */
export function todayDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
    year:    'numeric',
  });
}

/**
 * Returns a greeting appropriate for the current local hour.
 */
export function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

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
