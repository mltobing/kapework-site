/**
 * components/topbar.js
 *
 * Renders the app topbar into a container element.
 * Contains the "Ma" brand and a three-dot menu with a Sign out option.
 */

/**
 * @param {HTMLElement} container
 * @param {{ onSignOut?: () => void }} options
 */
export function renderTopbar(container, { onSignOut } = {}) {
  container.innerHTML = `
    <div class="topbar-inner">
      <span class="topbar-brand">Ma</span>
      <button class="topbar-menu-btn" id="topbar-menu-btn" aria-label="Menu" aria-expanded="false">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="4"  r="1.5" fill="currentColor"/>
          <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
          <circle cx="10" cy="16" r="1.5" fill="currentColor"/>
        </svg>
      </button>
    </div>
    <div class="topbar-menu" id="topbar-menu" hidden>
      <button class="topbar-menu-item" id="topbar-signout-btn">Sign out</button>
    </div>
  `;

  const menuBtn    = container.querySelector('#topbar-menu-btn');
  const menu       = container.querySelector('#topbar-menu');
  const signOutBtn = container.querySelector('#topbar-signout-btn');

  function openMenu() {
    menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? openMenu() : closeMenu();
  });

  signOutBtn.addEventListener('click', async () => {
    closeMenu();
    if (onSignOut) await onSignOut();
  });

  // Close menu when clicking anywhere outside the topbar
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) closeMenu();
  });
}
