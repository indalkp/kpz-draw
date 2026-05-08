// ============================================================================
//  src/ui/v3-modals.js
//
//  v4.0.0-rc.1 — Project Gallery + Settings modals from wireframes-v3-modals.jsx.
//
//  Both modals render only when v3 mode is active. Reachable from the existing
//  #profileMenu. Opening is best-effort: Project Gallery uses the existing
//  wix-bridge listMyProjects RPC when available, falling back to an empty state.
// ============================================================================

import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';

let _initialized = false;

export function initV3Modals() {
  if (_initialized) return;
  _initialized = true;

  ensureGalleryModal();
  ensureSettingsModal();
  injectProfileMenuItems();
}

// ============================================================================
// PROJECT GALLERY
// ============================================================================

function ensureGalleryModal() {
  if ($('v3GalleryModal')) return;

  const modal = document.createElement('div');
  modal.id = 'v3GalleryModal';
  modal.className = 'v3-modal';
  modal.innerHTML = `
    <div class="v3-modal-shell">
      <div class="v3-modal-head">
        <div>
          <h3>My projects</h3>
          <div class="v3-modal-sub">Open, duplicate, delete projects across the cloud.</div>
        </div>
        <button class="v3-btn" id="v3GalleryClose" title="Close">✕</button>
      </div>
      <div class="v3-modal-body" id="v3GalleryBody">
        <div class="v3-gallery-tabs">
          <button class="v3-btn v3-gallery-tab active" data-tab="all">All</button>
          <button class="v3-btn v3-gallery-tab" data-tab="starred">★ Starred</button>
          <button class="v3-btn v3-gallery-tab" data-tab="cloud">☁ Cloud</button>
          <button class="v3-btn v3-gallery-tab" data-tab="local">Local</button>
        </div>
        <div id="v3GalleryGrid" class="v3-gallery-grid">
          <div class="v3-empty">Loading projects…</div>
        </div>
      </div>
      <div class="v3-modal-foot">
        <span class="v3-modal-sub" id="v3GalleryStatus">—</span>
        <button class="v3-btn accent" id="v3GalleryNew">＋ New project</button>
      </div>
    </div>
  `;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeGallery(); });
  document.body.appendChild(modal);

  $('v3GalleryClose')?.addEventListener('click', closeGallery);
  $('v3GalleryNew')?.addEventListener('click', () => {
    closeGallery();
    $('btnNew')?.click();
  });

  modal.querySelectorAll('.v3-gallery-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.v3-gallery-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGallery(btn.dataset.tab);
    });
  });
}

let _galleryProjects = null;

export async function openProjectGallery() {
  ensureGalleryModal();
  $('v3GalleryModal')?.classList.add('open');
  if (_galleryProjects === null) await fetchProjects();
  renderGallery('all');
}

function closeGallery() {
  $('v3GalleryModal')?.classList.remove('open');
}

async function fetchProjects() {
  const grid = $('v3GalleryGrid');
  if (grid) grid.innerHTML = '<div class="v3-empty">Loading projects…</div>';

  try {
    const wb = await import('../storage/wix-bridge.js');
    if (typeof wb.listMyProjects === 'function') {
      const list = await Promise.resolve(wb.listMyProjects()).catch(() => null);
      _galleryProjects = Array.isArray(list) ? list : [];
    } else {
      _galleryProjects = [];
    }
  } catch (_) {
    _galleryProjects = [];
  }
  const status = $('v3GalleryStatus');
  if (status) status.textContent = `${_galleryProjects.length} project${_galleryProjects.length === 1 ? '' : 's'}`;
}

function renderGallery(tab) {
  const grid = $('v3GalleryGrid');
  if (!grid) return;
  const all = _galleryProjects || [];
  const filtered = all.filter(p => {
    if (tab === 'starred') return !!p.starred;
    if (tab === 'cloud')   return p.cloud !== 'local';
    if (tab === 'local')   return p.cloud === 'local';
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="v3-empty">
      <p>No projects in this view yet.</p>
      <p style="margin-top:10px;font-size:11px">
        Click "+ New project" below to start one. Cloud sync requires being
        signed in on indalkp.com.
      </p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const cloudClass = ['synced','pending','local'].includes(p.cloud) ? p.cloud : 'synced';
    const updated = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '—';
    const panels = (p.panels != null) ? p.panels : (p.panelCount || '?');
    return `
      <div class="v3-project-card" data-id="${esc(p.id)}" title="Click to open">
        <div class="v3-project-thumb"></div>
        <div class="v3-project-name">${p.starred ? '★ ' : ''}${esc(p.name || 'Untitled')}</div>
        <div class="v3-project-meta">
          <span class="v3-cloud-dot ${cloudClass}"></span>
          <span>${esc(updated)}</span>
          <span style="margin-left:auto">${esc(panels)}p</span>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.v3-project-card').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.id;
      try {
        const wb = await import('../storage/wix-bridge.js');
        if (typeof wb.loadProjectById === 'function') {
          await wb.loadProjectById(id);
        } else {
          console.log('[v3] open project', id, '— wix-bridge.loadProjectById not implemented yet');
        }
      } catch (_) {}
      closeGallery();
    });
  });
}

// ============================================================================
// SETTINGS MODAL
// ============================================================================

const SETTINGS_DEFAULTS = {
  theme:        'light',
  accent:       '#ff7a45',
  texture:      false,
  pins:         true,
  autosave:     true,
  saveInterval: 30,
  syncOpen:     true,
  noiseSup:     true,
  autoTrim:     false,
  penTouch:     false,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem('kpzSettings');
    if (raw) return Object.assign({}, SETTINGS_DEFAULTS, JSON.parse(raw));
  } catch (_) {}
  return Object.assign({}, SETTINGS_DEFAULTS);
}

function saveSettings(s) {
  try { localStorage.setItem('kpzSettings', JSON.stringify(s)); } catch (_) {}
  document.body.setAttribute('data-theme', s.theme || 'light');
}

function ensureSettingsModal() {
  if ($('v3SettingsModal')) return;

  const modal = document.createElement('div');
  modal.id = 'v3SettingsModal';
  modal.className = 'v3-modal';
  modal.innerHTML = `
    <div class="v3-modal-shell">
      <div class="v3-modal-head">
        <div>
          <h3>Settings &amp; preferences</h3>
          <div class="v3-modal-sub">Theme, autosave, audio. Saved to this browser.</div>
        </div>
        <button class="v3-btn" id="v3SettingsClose" title="Close">✕</button>
      </div>
      <div class="v3-modal-body" id="v3SettingsBody"></div>
      <div class="v3-modal-foot">
        <span class="v3-modal-sub">Changes apply immediately.</span>
        <button class="v3-btn" id="v3SettingsReset">Reset to defaults</button>
      </div>
    </div>
  `;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeSettings(); });
  document.body.appendChild(modal);
  $('v3SettingsClose')?.addEventListener('click', closeSettings);
  $('v3SettingsReset')?.addEventListener('click', () => {
    saveSettings(Object.assign({}, SETTINGS_DEFAULTS));
    renderSettings();
  });
}

export function openSettings() {
  ensureSettingsModal();
  renderSettings();
  $('v3SettingsModal')?.classList.add('open');
}

function closeSettings() {
  $('v3SettingsModal')?.classList.remove('open');
}

function renderSettings() {
  const body = $('v3SettingsBody');
  if (!body) return;
  const s = loadSettings();

  body.innerHTML = `
    <div class="v3-settings-section">
      <h4>View</h4>
      <div class="v3-settings-row">
        <label for="setTheme">Theme</label>
        <select id="setTheme">
          <option value="light"${s.theme==='light'?' selected':''}>Light</option>
          <option value="dark"${s.theme==='dark'?' selected':''}>Dark</option>
          <option value="auto"${s.theme==='auto'?' selected':''}>Auto (system)</option>
        </select>
      </div>
      <div class="v3-settings-row">
        <label for="setAccent">Accent color</label>
        <input type="color" id="setAccent" value="${esc(s.accent)}">
      </div>
      <div class="v3-settings-row">
        <label for="setTexture">Paper texture</label>
        <input type="checkbox" id="setTexture"${s.texture?' checked':''}>
      </div>
      <div class="v3-settings-row">
        <label for="setPins">Show pins / annotations (in design mode)</label>
        <input type="checkbox" id="setPins"${s.pins?' checked':''}>
      </div>
    </div>

    <div class="v3-settings-section">
      <h4>Save</h4>
      <div class="v3-settings-row">
        <label for="setAutosave">Autosave</label>
        <input type="checkbox" id="setAutosave"${s.autosave?' checked':''}>
      </div>
      <div class="v3-settings-row">
        <label for="setInterval">Autosave interval (s)</label>
        <input type="number" id="setInterval" min="5" max="600" step="5" value="${s.saveInterval}" style="width:74px">
      </div>
      <div class="v3-settings-row">
        <label for="setSyncOpen">Sync open project across devices</label>
        <input type="checkbox" id="setSyncOpen"${s.syncOpen?' checked':''}>
      </div>
    </div>

    <div class="v3-settings-section">
      <h4>Audio (voice-over)</h4>
      <div class="v3-settings-row">
        <label for="setNoise">Noise suppression</label>
        <input type="checkbox" id="setNoise"${s.noiseSup?' checked':''}>
      </div>
      <div class="v3-settings-row">
        <label for="setTrim">Auto-trim silence at clip ends</label>
        <input type="checkbox" id="setTrim"${s.autoTrim?' checked':''}>
      </div>
      <div class="v3-settings-row">
        <label for="setPenTouch">Allow pen-touch gesture for record start</label>
        <input type="checkbox" id="setPenTouch"${s.penTouch?' checked':''}>
      </div>
    </div>

    <div class="v3-settings-section">
      <h4>v3 preview</h4>
      <div class="v3-settings-row">
        <label>You're previewing v4.0.0-rc.1.</label>
        <button class="v3-btn danger" id="setExitV3">Turn off v3 preview</button>
      </div>
    </div>
  `;

  body.querySelector('#setTheme')?.addEventListener('change', e => { s.theme = e.target.value; saveSettings(s); });
  body.querySelector('#setAccent')?.addEventListener('change', e => { s.accent = e.target.value; saveSettings(s); applyAccent(s.accent); });
  body.querySelector('#setTexture')?.addEventListener('change', e => { s.texture = e.target.checked; saveSettings(s); });
  body.querySelector('#setPins')?.addEventListener('change', e => { s.pins = e.target.checked; saveSettings(s); });
  body.querySelector('#setAutosave')?.addEventListener('change', e => { s.autosave = e.target.checked; saveSettings(s); });
  body.querySelector('#setInterval')?.addEventListener('change', e => { s.saveInterval = parseInt(e.target.value, 10) || 30; saveSettings(s); });
  body.querySelector('#setSyncOpen')?.addEventListener('change', e => { s.syncOpen = e.target.checked; saveSettings(s); });
  body.querySelector('#setNoise')?.addEventListener('change', e => { s.noiseSup = e.target.checked; saveSettings(s); });
  body.querySelector('#setTrim')?.addEventListener('change', e => { s.autoTrim = e.target.checked; saveSettings(s); });
  body.querySelector('#setPenTouch')?.addEventListener('change', e => { s.penTouch = e.target.checked; saveSettings(s); });
  body.querySelector('#setExitV3')?.addEventListener('click', () => {
    try { localStorage.setItem('kpzV3', '0'); } catch (_) {}
    document.body.removeAttribute('data-v3');
    closeSettings();
    setTimeout(() => window.location.reload(), 100);
  });
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--v3-accent', color);
}

// ============================================================================
// PROFILE MENU integration
// ============================================================================

/**
 * Inject "Settings & preferences" + "My projects" items into the existing
 * #profileMenu. Existing items stay.
 */
function injectProfileMenuItems() {
  const menu = $('profileMenu');
  if (!menu) return;
  if (menu.querySelector('[data-v3-menu-item="settings"]')) return;

  const items = [
    { id: 'pmV3Settings', icon: '⚙', label: 'Settings & preferences', tag: 'settings', action: openSettings },
    { id: 'pmV3Gallery',  icon: '📁', label: 'My projects (gallery)', tag: 'gallery',  action: openProjectGallery },
  ];

  items.forEach(it => {
    const btn = document.createElement('button');
    btn.id = it.id;
    btn.dataset.v3MenuItem = it.tag;
    btn.innerHTML = `<span>${it.icon}</span> ${it.label}`;
    btn.addEventListener('click', (e) => {
      menu.classList.remove('open');
      it.action();
      e.stopPropagation();
    });
    menu.insertBefore(btn, menu.firstChild);
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
