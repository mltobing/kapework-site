/**
 * components/calendar-write-modal.js
 *
 * Owner-only "Toevoegen aan agenda" — a complete, editable preview the owner
 * must actively review and confirm before anything is ever written to the
 * calendar. Nothing here talks to CalDAV directly; submitting calls the
 * owner-authenticated ma-calendar-write-request Netlify Function, which
 * re-validates and re-verifies everything server-side (see brief §9) before
 * dispatching the private irma-sync workflow that does the actual write.
 *
 * Never invents a fact the source e-mail didn't state: an unstated
 * destination/return place/practitioner/end time stays blank for the owner
 * to fill in, never guessed. A ride's proposed end time is a clearly-labelled
 * 15-minute suggestion the owner must review, never presented as a fact from
 * the e-mail. Mirrors components/logboek-edit-modal.js's modal shell
 * (backdrop tap, close button, Escape).
 */

import { escapeHtml } from '../utils.js';
import { formatClock } from '../lib/datetime.js';
import { requestCalendarWrite, suggestCalendarWrite, pollCalendarWrite, calendarWriteErrorMessage } from '../lib/calendar-write-api.js';

const MAX_LEGS = 2;

function addMinutesToClock(hhmm, minutes) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** One leg's initial, prefilled-or-blank state — never inventing an unstated fact. */
function buildInitialLegs(sourceKind, notice) {
  if (notice.match_status === 'unparsed') {
    const title = sourceKind === 'appointment_notice' && notice.provider_label
      ? `${notice.provider_label} — afspraak`
      : 'Rit';
    return [{ title, date: '', startTime: '', endTime: '', location: '', suggestedEnd: false, endRequired: true }];
  }

  if (sourceKind === 'appointment_notice') {
    return [{
      title: notice.provider_label ? `${notice.provider_label} — afspraak` : 'Afspraak',
      date: notice.appointment_date || '',
      startTime: formatClock(notice.start_time),
      endTime: '', // the direct confirmation never states one — never invented
      location: notice.location || '',
      notes: notice.practitioner ? `Behandelaar: ${notice.practitioner}` : '',
      suggestedEnd: false,
      endRequired: true,
    }];
  }

  // ride_notice, missing
  const legs = [];
  if (notice.pickup_time) {
    const start = formatClock(notice.pickup_time);
    legs.push({
      title: notice.driver ? `Rit met ${notice.driver}` : 'Rit',
      date: notice.ride_date || '', startTime: start, endTime: addMinutesToClock(start, 15),
      location: notice.destination || '', notes: '', suggestedEnd: true, endRequired: false,
    });
  }
  if (notice.return_time) {
    const start = formatClock(notice.return_time);
    legs.push({
      title: notice.driver ? `Terugrit met ${notice.driver}` : 'Terugrit',
      date: notice.ride_date || '', startTime: start, endTime: addMinutesToClock(start, 15),
      location: notice.return_place || '', notes: '', suggestedEnd: true, endRequired: false,
    });
  }
  if (!legs.length) {
    legs.push({
      title: notice.driver ? `Rit met ${notice.driver}` : 'Rit',
      date: notice.ride_date || '', startTime: '', endTime: '', location: '', notes: '',
      suggestedEnd: false, endRequired: true,
    });
  }
  return legs;
}

/**
 * @param {object} opts
 * @param {string} opts.familyId
 * @param {'ride_notice'|'appointment_notice'} opts.sourceKind
 * @param {object} opts.notice — the notice row (fetchOpenRideNotices/fetchOpenAppointmentNotices shape)
 * @param {() => void} opts.onResolved — called once the flow reaches a terminal
 *   state that should refresh the notices list (success/partial) — the
 *   caller re-fetches from scratch rather than this modal optimistically
 *   removing anything.
 */
export function openCalendarWriteModal({ familyId, sourceKind, notice, onResolved }) {
  document.getElementById('ma-calendar-write-modal')?.remove();

  let legs = buildInitialLegs(sourceKind, notice);
  const isUnparsed = notice.match_status === 'unparsed';
  let cancelPoll = null;

  const modal = document.createElement('div');
  modal.id = 'ma-calendar-write-modal';
  modal.className = 'edit-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'calendar-write-modal-title');

  modal.innerHTML = `
    <div class="edit-modal-backdrop"></div>
    <div class="edit-modal-content">
      <div class="edit-modal-header">
        <button type="button" class="edit-modal-cancel" id="cw-modal-cancel">Annuleer</button>
        <h2 id="calendar-write-modal-title">Toevoegen aan agenda</h2>
        <button type="button" class="edit-modal-save" id="cw-modal-submit" disabled>Toevoegen</button>
      </div>
      <div class="edit-modal-body">
        <blockquote class="ride-notice-excerpt">${escapeHtml(notice.excerpt || '')}</blockquote>
        ${isUnparsed ? `
          <p class="compose-error" id="cw-unparsed-notice">
            Deze e-mail kon niet betrouwbaar worden gelezen. Controleer en vul alles zelf in.
          </p>
        ` : ''}
        ${notice.excerpt ? `
          <div class="cw-suggest-row">
            <button type="button" class="btn-ghost" id="cw-suggest-btn">Laat Ma de details voorstellen</button>
          </div>
          <p class="cw-suggest-hint" id="cw-suggest-hint" hidden></p>
        ` : ''}
        <div id="cw-legs"></div>
        <label class="cw-confirm-row">
          <input type="checkbox" id="cw-confirm-checkbox">
          Ik heb datum, tijden, titel en locatie gecontroleerd.
        </label>
        <div id="cw-modal-error" class="compose-error" hidden></div>
        <div id="cw-modal-status" class="cw-modal-status" hidden></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  const legsEl = modal.querySelector('#cw-legs');
  const submitBtn = modal.querySelector('#cw-modal-submit');
  const cancelBtn = modal.querySelector('#cw-modal-cancel');
  const confirmCheckbox = modal.querySelector('#cw-confirm-checkbox');
  const errorEl = modal.querySelector('#cw-modal-error');
  const statusEl = modal.querySelector('#cw-modal-status');

  function close() {
    if (cancelPoll) cancelPoll();
    modal.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  modal.querySelector('.edit-modal-backdrop').addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  function renderLegs() {
    legsEl.innerHTML = legs.map((leg, i) => `
      <fieldset class="cw-leg" data-leg="${i}">
        <legend>${legs.length > 1 ? (i === 0 ? 'Heen' : 'Terug') : 'Afspraak'}</legend>
        <div class="compose-field">
          <label class="compose-label" for="cw-title-${i}">Titel</label>
          <input class="compose-title" id="cw-title-${i}" type="text" maxlength="120" value="${escapeHtml(leg.title || '')}">
        </div>
        <div class="compose-field">
          <label class="compose-label" for="cw-date-${i}">Datum</label>
          <input class="compose-date" id="cw-date-${i}" type="date" value="${escapeHtml(leg.date || '')}">
        </div>
        <div class="cw-time-row">
          <div class="compose-field">
            <label class="compose-label" for="cw-start-${i}">Begintijd</label>
            <input class="compose-date" id="cw-start-${i}" type="time" value="${escapeHtml(leg.startTime || '')}">
          </div>
          <div class="compose-field">
            <label class="compose-label" for="cw-end-${i}">Eindtijd</label>
            <input class="compose-date" id="cw-end-${i}" type="time" value="${escapeHtml(leg.endTime || '')}">
          </div>
        </div>
        <p class="cw-tz-note">Alle tijden zijn in Amsterdamse tijd.</p>
        ${leg.suggestedEnd ? '<p class="cw-suggested-end">Voorgestelde eindtijd — controleer</p>' : ''}
        ${leg.endRequired ? `<p class="cw-suggested-end cw-end-hint" id="cw-endhint-${i}"${leg.endTime ? ' hidden' : ''}>De e-mail noemt geen eindtijd. Kies en controleer de eindtijd.</p>` : ''}
        <div class="compose-field">
          <label class="compose-label" for="cw-location-${i}">Locatie (optioneel)</label>
          <input class="compose-title" id="cw-location-${i}" type="text" maxlength="300" value="${escapeHtml(leg.location || '')}">
        </div>
        ${legs.length > 1 ? `<button type="button" class="btn-ghost" data-remove-leg="${i}">Verwijder deze rit</button>` : ''}
      </fieldset>
    `).join('');

    legsEl.querySelectorAll('.cw-leg').forEach((fieldset) => {
      fieldset.querySelectorAll('input').forEach((input) => {
        input.addEventListener('input', () => {
          const i = Number(fieldset.dataset.leg);
          legs[i] = {
            ...legs[i],
            title: modal.querySelector(`#cw-title-${i}`).value,
            date: modal.querySelector(`#cw-date-${i}`).value,
            startTime: modal.querySelector(`#cw-start-${i}`).value,
            endTime: modal.querySelector(`#cw-end-${i}`).value,
            location: modal.querySelector(`#cw-location-${i}`).value,
          };
          // Keep the "no end time in the e-mail" hint in step with the field —
          // it must clear the moment the owner supplies one.
          const endHint = modal.querySelector(`#cw-endhint-${i}`);
          if (endHint) endHint.hidden = Boolean(legs[i].endTime);
          updateSubmitState();
        });
      });
    });

    legsEl.querySelectorAll('[data-remove-leg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        legs.splice(Number(btn.dataset.removeLeg), 1);
        renderLegs();
        updateSubmitState();
      });
    });
  }

  function legIsComplete(leg) {
    return Boolean(leg.title?.trim()) && Boolean(leg.date) && Boolean(leg.startTime) && Boolean(leg.endTime)
      && leg.endTime > leg.startTime;
  }

  function updateSubmitState() {
    const allComplete = legs.length > 0 && legs.every(legIsComplete);
    submitBtn.disabled = !(allComplete && confirmCheckbox.checked);
  }

  confirmCheckbox.addEventListener('change', updateSubmitState);
  renderLegs();
  updateSubmitState();

  // ─── "Laat Ma de details voorstellen" — owner-triggered Claude prefill ──────
  // Replaces the legs with a *suggestion* the owner still reviews, edits, and
  // confirms. A failed suggestion never blocks manual entry; the confirm
  // checkbox and per-field completeness gate submission exactly as before.
  const suggestBtn = modal.querySelector('#cw-suggest-btn');
  const suggestHint = modal.querySelector('#cw-suggest-hint');

  function applySuggestion(events) {
    legs = events.map((e) => ({
      title: e.title || (sourceKind === 'appointment_notice' ? 'Afspraak' : 'Rit'),
      date: e.date || '',
      startTime: e.startTime || '',
      endTime: e.endTime || '',
      location: e.location || '',
      notes: '',
      suggestedEnd: false,
      endRequired: !e.endTime,
      suggested: true,
    }));
    renderLegs();
    updateSubmitState();
  }

  if (suggestBtn) {
    suggestBtn.addEventListener('click', async () => {
      const originalLabel = suggestBtn.textContent;
      suggestBtn.disabled = true;
      suggestBtn.textContent = 'Ma leest de e-mail…';
      suggestHint.hidden = true;
      try {
        const { events, reliable } = await suggestCalendarWrite({
          familyId, sourceKind, noticeId: notice.id,
        });
        if (!events.length) {
          suggestHint.textContent = 'Ma kon geen gegevens uit dit bericht halen. Vul de velden hieronder zelf in.';
        } else {
          applySuggestion(events);
          suggestHint.textContent = reliable
            ? 'Voorstel van Ma ingevuld — controleer datum, tijden, titel en locatie voordat je toevoegt.'
            : 'Voorstel van Ma ingevuld, maar niet zeker — controleer alles extra goed.';
        }
      } catch (err) {
        console.error('[ma/calendar-write-modal] Suggestion failed:', err);
        suggestHint.textContent = calendarWriteErrorMessage(err.errorCode);
      } finally {
        suggestHint.hidden = false;
        suggestBtn.disabled = false;
        suggestBtn.textContent = originalLabel;
      }
    });
  }

  submitBtn.addEventListener('click', async () => {
    errorEl.hidden = true;
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    statusEl.hidden = false;
    statusEl.textContent = 'Wordt aan de agenda toegevoegd…';

    const events = legs.map((leg) => ({
      title: leg.title.trim(),
      date: leg.date,
      startTime: leg.startTime,
      endTime: leg.endTime,
      location: leg.location?.trim() || null,
      notes: leg.notes?.trim() || null,
    }));

    let result;
    try {
      result = await requestCalendarWrite({
        familyId, sourceKind, noticeId: notice.id, events,
        confirmedEditedFields: true, // the checkbox above is required for every submission
      });
    } catch (err) {
      console.error('[ma/calendar-write-modal] Request failed:', err);
      statusEl.hidden = true;
      errorEl.textContent = calendarWriteErrorMessage(err.errorCode);
      errorEl.hidden = false;
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      return;
    }

    cancelPoll = pollCalendarWrite(
      modal,
      result.requestId,
      ({ request }) => renderStatus(request),
      () => {
        statusEl.textContent = 'Dit duurt langer dan verwacht. Je kunt dit venster sluiten — de aanvraag loopt door.';
      },
    );
    renderStatus({ status: result.status });
  });

  function renderStatus(request) {
    if (request.status === 'success') {
      statusEl.textContent = 'Toegevoegd aan de agenda.';
      cancelBtn.textContent = 'Sluiten';
      cancelBtn.disabled = false;
      onResolved?.();
      return;
    }
    if (request.status === 'partial') {
      statusEl.textContent = 'Toegevoegd, maar Ma kon de agenda nog niet volledig verversen.';
      cancelBtn.textContent = 'Sluiten';
      cancelBtn.disabled = false;
      onResolved?.();
      return;
    }
    if (request.status === 'failed') {
      statusEl.hidden = true;
      errorEl.textContent = calendarWriteErrorMessage(request.error_code || 'calendar_write_failed');
      errorEl.hidden = false;
      cancelBtn.textContent = 'Sluiten';
      cancelBtn.disabled = false;
      submitBtn.hidden = true;
      return;
    }
    // queued/processing — keep the "wordt toegevoegd" status visible.
  }
}
