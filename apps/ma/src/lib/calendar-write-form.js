/**
 * lib/calendar-write-form.js
 *
 * Pure validation for the "Toevoegen aan agenda" form — no DOM, no network,
 * no Supabase import, so it can be unit-tested directly.
 *
 * This is the gate that decides whether the owner may submit a calendar
 * write. It is a *usability* gate only: the Netlify Function re-validates
 * every field server-side and is the actual security boundary (CLAUDE.md §4 —
 * the UI preventing an action is not a security control).
 */

/** All times here are "HH:MM" strings in Amsterdam time; lexical compare is ordinal. */
export function legIsComplete(leg) {
  if (!leg) return false;
  return Boolean(leg.title?.trim())
    && Boolean(leg.date)
    && Boolean(leg.startTime)
    && Boolean(leg.endTime)
    && leg.endTime > leg.startTime;
}

/**
 * Why submission is blocked, phrased for the owner — or null when it isn't.
 *
 * Every disabled state must be able to explain itself. A greyed-out button
 * with no reason given is indistinguishable from a broken one, which is
 * exactly how the missing `change` binding on the mobile date/time pickers
 * presented: the form looked filled in, and "Toevoegen" simply did nothing.
 *
 * @param {Array<object>} legs
 * @param {boolean} confirmed — the "ik heb alles gecontroleerd" checkbox
 * @returns {string|null}
 */
export function blockingReason(legs, confirmed) {
  if (!Array.isArray(legs) || !legs.length) return 'Er is niets om toe te voegen.';

  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i] || {};
    const where = legs.length > 1 ? (i === 0 ? 'Heen: ' : 'Terug: ') : '';
    if (!leg.title?.trim()) return `${where}vul een titel in.`;
    if (!leg.date) return `${where}kies een datum.`;
    if (!leg.startTime) return `${where}kies een begintijd.`;
    if (!leg.endTime) return `${where}kies een eindtijd.`;
    if (leg.endTime <= leg.startTime) return `${where}de eindtijd moet na de begintijd liggen.`;
  }

  if (!confirmed) return 'Vink aan dat je alles hebt gecontroleerd.';
  return null;
}
