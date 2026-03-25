/**
 * views/people.js
 *
 * The People tab — cards for each family member with their name,
 * relationship label, and avatar (initial if no photo set).
 */

import { fetchPeople }              from '../api.js';
import { escapeHtml, getInitial }   from '../utils.js';

/**
 * @param {HTMLElement} container
 * @param {{ familyId: string|null }} state
 */
export async function mount(container, { familyId }) {
  container.innerHTML = `
    <div class="view-people">
      <div class="view-header">
        <h1>People</h1>
      </div>
      <div id="people-content">
        <div class="section-loading">Loading\u2026</div>
      </div>
    </div>
  `;

  const contentEl = container.querySelector('#people-content');

  if (!familyId) {
    contentEl.innerHTML = '<p class="empty-state">Family not found.</p>';
    return;
  }

  try {
    const members = await fetchPeople(familyId);
    contentEl.innerHTML = '';

    if (!members.length) {
      contentEl.innerHTML = '<p class="empty-state">No family members found.</p>';
      return;
    }

    const list = document.createElement('div');
    list.className = 'people-list';

    for (const member of members) {
      const profile = member.ma_profiles ?? {};
      const card    = document.createElement('div');
      card.className = 'person-card';

      const avatarHtml = profile.avatar_url
        ? `<div class="person-avatar">
             <img src="${escapeHtml(profile.avatar_url)}"
                  alt="${escapeHtml(profile.display_name || 'Family member')}"
                  loading="lazy">
           </div>`
        : `<div class="person-avatar person-avatar--initial">
             ${escapeHtml(getInitial(profile.display_name))}
           </div>`;

      card.innerHTML = `
        ${avatarHtml}
        <div class="person-info">
          <h3 class="person-name">
            ${escapeHtml(profile.display_name || 'Family member')}
          </h3>
          ${profile.relationship
            ? `<p class="person-relationship">${escapeHtml(profile.relationship)}</p>`
            : ''}
        </div>
      `;

      list.appendChild(card);
    }

    contentEl.appendChild(list);
  } catch (err) {
    console.error('[ma/people] Failed to load people:', err);
    contentEl.innerHTML = '<p class="empty-state">Could not load family members. Please try again.</p>';
  }
}
