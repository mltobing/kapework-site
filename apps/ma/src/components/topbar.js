/**
 * components/topbar.js
 *
 * Renders the app topbar into a container element. Contains the "Ma" brand
 * and a three-dot menu — secondary navigation and help, structured as:
 *
 *   Ga naar     — every destination the signed-in user's accessType can reach
 *                 (mirrors nav.js's TABS_BY_ACCESS, so Beheer only appears
 *                 for an owner, exactly like the bottom nav)
 *   Hulp        — Uitleg & veelgestelde vragen
 *   Account     — Apparaten (owner-only, preserved), Uitloggen
 *
 * The active destination is computed fresh each time the menu opens (via
 * router.currentRoute()) rather than a prop set once at mount, since the
 * topbar itself is only rendered once per app-shell render.
 */

import { currentRoute } from '../router.js';
import { TABS_BY_ACCESS } from './nav.js';
import { escapeHtml } from '../utils.js';

/**
 * @param {HTMLElement} container
 * @param {object} options
 * @param {() => void} [options.onSignOut]
 * @param {() => void} [options.onDevices]
 * @param {(route: string) => void} [options.onNavigate]
 * @param {'owner'|'member'|'caregiver'|null} [options.accessType]
 */
export function renderTopbar(container, { onSignOut, onDevices, onNavigate, accessType = null } = {}) {
  const showDevices = accessType === 'owner';
  const navItems = TABS_BY_ACCESS[accessType] ?? [];
  const active = currentRoute();

  container.innerHTML = `
    <div class="topbar-inner">
      <span class="topbar-brand">Ma</span>
      <button class="topbar-menu-btn" id="topbar-menu-btn" aria-label="Menu" aria-haspopup="menu" aria-expanded="false">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="4"  r="1.5" fill="currentColor"/>
          <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
          <circle cx="10" cy="16" r="1.5" fill="currentColor"/>
        </svg>
      </button>
    </div>
    <div class="topbar-menu" id="topbar-menu" role="menu" aria-label="Menu" hidden>
      <div class="topbar-menu-section" role="none">
        <p class="topbar-menu-label" role="none">Ga naar</p>
        ${navItems.map(item => `
          <button
            type="button" class="topbar-menu-item ${item.id === active ? 'topbar-menu-item--active' : ''}"
            role="menuitem" data-route="${item.id}"
            aria-current="${item.id === active ? 'page' : 'false'}"
          >${escapeHtml(item.label)}</button>
        `).join('')}
      </div>
      <div class="topbar-menu-section" role="none">
        <p class="topbar-menu-label" role="none">Hulp</p>
        <button type="button" class="topbar-menu-item ${active === 'uitleg' ? 'topbar-menu-item--active' : ''}" role="menuitem" data-route="uitleg">
          Uitleg &amp; veelgestelde vragen
        </button>
      </div>
      <div class="topbar-menu-section" role="none">
        <p class="topbar-menu-label" role="none">Account</p>
        ${showDevices ? '<button type="button" class="topbar-menu-item" role="menuitem" id="topbar-devices-btn">Apparaten</button>' : ''}
        <button type="button" class="topbar-menu-item" role="menuitem" id="topbar-signout-btn">Uitloggen</button>
      </div>
    </div>
  `;

  const menuBtn    = container.querySelector('#topbar-menu-btn');
  const menu       = container.querySelector('#topbar-menu');
  const signOutBtn = container.querySelector('#topbar-signout-btn');
  const devicesBtn = container.querySelector('#topbar-devices-btn');
  const menuItems  = Array.from(menu.querySelectorAll('.topbar-menu-item'));
  const routeItems = Array.from(menu.querySelectorAll('[data-route]'));

  // The topbar is rendered once per app-shell mount, but the user can
  // navigate via the bottom tab bar without ever opening this menu — so the
  // active highlight must be recomputed on each open, not baked in once.
  function syncActiveState() {
    const active = currentRoute();
    for (const btn of routeItems) {
      const isActive = btn.dataset.route === active;
      btn.classList.toggle('topbar-menu-item--active', isActive);
      btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    }
  }

  function openMenu() {
    syncActiveState();
    menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    menuItems[0]?.focus();
  }

  function closeMenu({ refocusTrigger = false } = {}) {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
    if (refocusTrigger) menuBtn.focus();
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? openMenu() : closeMenu();
  });

  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu({ refocusTrigger: true });
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const currentIndex = menuItems.indexOf(document.activeElement);
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + delta + menuItems.length) % menuItems.length;
    menuItems[nextIndex]?.focus();
  });

  menu.querySelectorAll('[data-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeMenu();
      onNavigate?.(btn.dataset.route);
    });
  });

  devicesBtn?.addEventListener('click', () => {
    closeMenu();
    onDevices?.();
  });

  signOutBtn.addEventListener('click', async () => {
    closeMenu();
    await onSignOut?.();
  });

  // Close menu when clicking anywhere outside the topbar.
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) closeMenu();
  });
}
