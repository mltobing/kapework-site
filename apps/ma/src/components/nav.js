/**
 * components/nav.js
 *
 * Renders the bottom tab bar into a container element.
 * Clicking a tab navigates via the router (hash change).
 *
 * The tab set depends on accessType: an owner gets Beheer instead of Mensen
 * (which is retired entirely — see apps/ma/README.md); a plain member gets
 * the same bar minus that slot; a caregiver gets a deliberately short one —
 * no Briefing, Agenda, or Beheer (care-team users must never see those).
 */

import { navigate } from '../router.js';

const OWNER_TABS = [
  { id: 'today',    label: 'Vandaag',  icon: iconToday()    },
  { id: 'briefing', label: 'Briefing', icon: iconBriefing() },
  { id: 'logboek',  label: 'Logboek',  icon: iconLogboek()  },
  { id: 'calendar', label: 'Agenda',   icon: iconCalendar() },
  { id: 'beheer',   label: 'Beheer',   icon: iconBeheer()   },
];

const MEMBER_TABS = [
  { id: 'today',    label: 'Vandaag',  icon: iconToday()    },
  { id: 'briefing', label: 'Briefing', icon: iconBriefing() },
  { id: 'logboek',  label: 'Logboek',  icon: iconLogboek()  },
  { id: 'calendar', label: 'Agenda',   icon: iconCalendar() },
];

const CAREGIVER_TABS = [
  { id: 'today',   label: 'Vandaag', icon: iconToday()   },
  { id: 'logboek', label: 'Logboek', icon: iconLogboek() },
];

// Exported so components/topbar.js's "Ga naar" menu can offer exactly the
// same destinations as the bottom nav for the signed-in user's accessType —
// one hand-maintained list, not two that could drift apart.
export const TABS_BY_ACCESS = {
  owner:     OWNER_TABS,
  member:    MEMBER_TABS,
  caregiver: CAREGIVER_TABS,
};

/**
 * @param {HTMLElement} container
 * @param {string} activeTab    — one of the tab ids above
 * @param {'owner'|'member'|'caregiver'|null} [accessType]
 */
export function renderNav(container, activeTab, accessType = null) {
  const tabs = TABS_BY_ACCESS[accessType] ?? MEMBER_TABS;

  container.innerHTML = `
    <div class="nav-inner">
      ${tabs.map(tab => `
        <button
          class="nav-tab ${activeTab === tab.id ? 'nav-tab--active' : ''}"
          data-tab="${tab.id}"
          aria-label="${tab.label}"
          aria-current="${activeTab === tab.id ? 'page' : 'false'}"
        >
          <span class="nav-tab-icon">${tab.icon}</span>
          <span class="nav-tab-label">${tab.label}</span>
        </button>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.tab));
  });
}

// ─── SVG icons ───────────────────────────────────────────────────────────────

function iconToday() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="4" fill="currentColor"/>
    <line x1="12" y1="2"  x2="12" y2="5"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="2"  y1="12" x2="5"  y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="19" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="4.22"  y1="4.22"  x2="6.34"  y2="6.34"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="4.22"  y1="19.78" x2="6.34"  y2="17.66" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="17.66" y1="6.34"  x2="19.78" y2="4.22"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

function iconBriefing() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="8" y="3" width="8" height="4" rx="1" stroke="currentColor" stroke-width="2"/>
    <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="8"  y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="8"  y1="16" x2="13" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

function iconLogboek() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="9" y1="7" x2="15" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="9" y1="11" x2="15" y2="11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

function iconCalendar() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
    <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="8"  y1="2" x2="8"  y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="3"  y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2"/>
  </svg>`;
}

function iconBeheer() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 20a8 8 0 1 1 16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="12" y1="20" x2="15.5" y2="13.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="12" cy="20" r="1.4" fill="currentColor"/>
  </svg>`;
}
