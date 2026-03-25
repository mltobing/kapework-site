/**
 * components/nav.js
 *
 * Renders the bottom tab bar into a container element.
 * Clicking a tab navigates via the router (hash change).
 */

import { navigate } from '../router.js';

const TABS = [
  { id: 'today',    label: 'Today',    icon: iconToday()    },
  { id: 'family',   label: 'Family',   icon: iconFamily()   },
  { id: 'photos',   label: 'Photos',   icon: iconPhotos()   },
  { id: 'calendar', label: 'Calendar', icon: iconCalendar() },
  { id: 'people',   label: 'People',   icon: iconPeople()   },
];

/**
 * @param {HTMLElement} container
 * @param {string} activeTab  — one of the tab ids above
 */
export function renderNav(container, activeTab) {
  container.innerHTML = `
    <div class="nav-inner">
      ${TABS.map(tab => `
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

function iconFamily() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconPhotos() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
    <polyline points="21,15 16,10 5,21"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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

function iconPeople() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
