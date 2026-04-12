// src/ui/projects-panel.js
// Right panel My Work tab: list and load cloud-saved projects.

import { App } from '../core/state.js';
import { $, escapeHtml } from '../utils/dom-helpers.js';

export function requestProjectsList() {
  if (!App.inWix) { const s = $('projectsStatus'); if (s) s.textContent = 'Projects only available inside your Wix site'; return; }
  if (!App.isLoggedIn) { const s = $('projectsStatus'); if (s) s.textContent = 'Log in to see your saved projects'; return; }
  const s = $('projectsStatus'); if (s) s.textContent = 'Loading...';
  window.parent.postMessage({ type: 'list-projects' }, '*');
}

export function renderProjectsList(msg) {
  const list = $('projectsList');
  const status = $('projectsStatus');
  if (!list) return;
  list.innerHTML = '';
  if (!msg.success) { if (status) status.textContent = 'Error: ' + (msg.error || 'Unknown'); return; }
  const items = msg.items || [];
  if (items.length === 0) { if (status) status.textContent = 'No saved projects yet.'; return; }
  if (status) status.textContent = '';
  items.forEach(p => {
    const card = document.createElement('div');
    card.className = 'project-card';
    const thumbUrl = p.thumbnailHttps || p.thumbnail?.url || p.thumbnail || '';
    card.innerHTML = '<img src="' + thumbUrl + '" alt="" onerror="this.style.visibility=\'hidden\'"><div class="info"><div class="t">' + escapeHtml(p.title || 'Untitled') + '</div><div class="s">' + (p.width || '?') + ' x ' + (p.height || '?') + ' - ' + (p.panelCount || 1) + ' panel' + ((p.panelCount || 1) > 1 ? 's' : '') + '</div></div>';
    card.addEventListener('click', () => window.parent.postMessage({ type: 'open-project', projectId: p._id }, '*'));
    list.appendChild(card);
  });
}
