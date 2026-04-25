// src/ui/cast-panel.js
//
// v3.9.0: Cast & References — character cards with palette, profile, per-card
// zoom slider, and density toggle. Character cards group existing refs by
// referencing ref ids (NOT by duplicating ref data) so a single ref can
// belong to a character without copying its blob.
//
// Storage strategy (v3.9.0):
//   - characters live on App.project.characters[] in memory
//   - persisted to IndexedDB via persistCharacters() in storage/persistent-refs.js
//   - NOT included in serializeKpz() or Wix CMS payload (bundling rule —
//     save/load format changes are isolated to a later release)
//
// Per-card zoom: each character has its own `zoom` (0.5–2.5). Applied as
// transform: scale() on the thumbnail content inside that card. Independent
// of the global #refSize slider on the Refs tab.
//
// Density toggle: 'compact' (default) shows header + 3 thumbs only; 'comfy'
// also shows palette + zoom slider on every card without expanding.
// Persisted to localStorage as kpz_cast_density.

import { App } from '../core/state.js';
import { $, escapeHtml } from '../utils/dom-helpers.js';
import { persistCharacters } from '../storage/persistent-refs.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';

const DENSITY_KEY = 'kpz_cast_density';
const DEFAULT_PALETTE = ['#1a1a1a', '#c97244', '#e8d8c4'];
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;

// One source of truth for which card is expanded — only one open at a time
// keeps the panel's mental model simple.
let expandedCharId = null;

// Density state — 'compact' | 'comfy'. Read once on init from localStorage.
let density = (typeof localStorage !== 'undefined' && localStorage.getItem(DENSITY_KEY)) || 'compact';

// Active tab — 'cast' | 'refs'. Refs tab keeps the existing flat list visible.
let activeTab = 'cast';

export function initCastPanel() {
  // Wire the tab buttons
  $('castTabCast')?.addEventListener('click', () => switchTab('cast'));
  $('castTabRefs')?.addEventListener('click', () => switchTab('refs'));

  // Density toggle
  $('castDensityToggle')?.addEventListener('click', toggleDensity);

  // Add character button
  $('btnAddChar')?.addEventListener('click', addCharacter);

  // Apply persisted density immediately
  applyDensityClass();

  // Initial render — runs after restorePersistentCharacters() has populated
  // App.project.characters in main.js.
  renderCast();
  // Default tab on first load: Cast (matches v3.9.0 IA — Cast leads)
  switchTab('cast');
}

function switchTab(tab) {
  activeTab = tab;
  // Toggle button visual state
  $('castTabCast')?.classList.toggle('active', tab === 'cast');
  $('castTabRefs')?.classList.toggle('active', tab === 'refs');
  // Show/hide the body containers. Refs panel keeps its existing DOM, just
  // hidden when Cast is active. Cast container shows only when Cast is active.
  const castBody = $('castList');
  const refsBody = $('refList');
  const refsEmpty = $('refEmpty');
  const refsActions = document.querySelector('.ref-header-actions');
  const castActions = document.querySelector('.cast-header-actions');
  const refsSizeRow = document.querySelector('.ref-size-row');
  const castEmpty = $('castEmpty');
  if (castBody)    castBody.style.display    = tab === 'cast' ? '' : 'none';
  if (castEmpty)   castEmpty.style.display   = tab === 'cast' ? '' : 'none';
  if (refsBody)    refsBody.style.display    = tab === 'refs' ? '' : 'none';
  if (refsEmpty)   refsEmpty.style.display   = tab === 'refs' ? '' : 'none';
  if (refsActions) refsActions.style.display = tab === 'refs' ? '' : 'none';
  if (castActions) castActions.style.display = tab === 'cast' ? '' : 'none';
  if (refsSizeRow) refsSizeRow.style.display = tab === 'refs' ? '' : 'none';
  if (tab === 'cast') renderCast();
}

function toggleDensity() {
  density = density === 'compact' ? 'comfy' : 'compact';
  try { localStorage.setItem(DENSITY_KEY, density); } catch {}
  applyDensityClass();
  renderCast();
}

function applyDensityClass() {
  const panel = $('leftPanel');
  if (!panel) return;
  panel.classList.toggle('cast-compact', density === 'compact');
  panel.classList.toggle('cast-comfy',   density === 'comfy');
  // Keep the toggle button label in sync — it shows the OPPOSITE state (the
  // mode you'd switch INTO), matching the convention used by similar toggles.
  const btn = $('castDensityToggle');
  if (btn) btn.textContent = density === 'compact' ? '⚏' : '▤';
  if (btn) btn.title = density === 'compact' ? 'Switch to comfy view' : 'Switch to compact view';
}

function addCharacter() {
  if (!App.project) return;
  const name = (prompt('Character name', 'New character') || '').trim();
  if (!name) return;
  const char = {
    id:      'C' + Math.random().toString(36).slice(2, 9),
    name,
    refIds:  [],
    palette: DEFAULT_PALETTE.slice(),
    profile: { role: '', voice: '', wants: '', fears: '' },
    zoom:    1,
    created: Date.now(),
  };
  App.project.characters = App.project.characters || [];
  App.project.characters.push(char);
  expandedCharId = char.id;          // expand the new card so user can edit immediately
  renderCast();
  persistCharacters();
  App.dirty = true; updateSaveStatus();
}

function deleteCharacter(charId) {
  if (!App.project?.characters) return;
  const idx = App.project.characters.findIndex(c => c.id === charId);
  if (idx < 0) return;
  const char = App.project.characters[idx];
  if (!confirm(`Delete character "${char.name}"? This won't delete its refs.`)) return;
  App.project.characters.splice(idx, 1);
  if (expandedCharId === charId) expandedCharId = null;
  renderCast();
  persistCharacters();
  App.dirty = true; updateSaveStatus();
}

function renameCharacter(charId) {
  const char = findChar(charId);
  if (!char) return;
  const next = (prompt('Rename character', char.name) || '').trim();
  if (!next || next === char.name) return;
  char.name = next;
  renderCast();
  persistCharacters();
  App.dirty = true; updateSaveStatus();
}

function findChar(charId) {
  return (App.project?.characters || []).find(c => c.id === charId);
}

function findRef(refId) {
  return (App.project?.refs || []).find(r => r.id === refId);
}

/**
 * v3.9.0: render the Cast tab body. Re-renders the entire list — small (a
 * handful of cards) so DOM diffing isn't worth the complexity.
 */
export function renderCast() {
  const body  = $('castList');
  const empty = $('castEmpty');
  if (!body) return;
  body.innerHTML = '';

  const chars = App.project?.characters || [];
  if (empty) empty.style.display = chars.length === 0 ? 'block' : 'none';

  for (const char of chars) {
    body.appendChild(renderCharacterCard(char));
  }
}

/**
 * Render one character card. Compact-mode and comfy-mode differ in what's
 * shown when collapsed; expanded mode is identical for both densities.
 */
function renderCharacterCard(char) {
  const isExpanded = expandedCharId === char.id;
  const isCompact  = density === 'compact';
  const card = document.createElement('div');
  card.className = `char-card${isExpanded ? ' expanded' : ''}`;
  card.dataset.charId = char.id;
  card.style.setProperty('--char-zoom', char.zoom || 1);

  const refIds = char.refIds || [];
  const refsForChar = refIds.map(findRef).filter(Boolean);

  // Header — always visible. Tap header to toggle expand.
  const header = document.createElement('div');
  header.className = 'cc-header';
  header.innerHTML = `
    <span class="cc-icon">👤</span>
    <span class="cc-name">${escapeHtml(char.name)}</span>
    <span class="cc-count">${refsForChar.length}</span>
    ${isCompact && !isExpanded ? `<span class="cc-zoom-badge" title="Open card to zoom">⊕ ${Math.round((char.zoom || 1) * 100)}%</span>` : ''}
    <span class="cc-actions">
      <button class="cc-act" data-act="rename" title="Rename">✎</button>
      <button class="cc-act" data-act="delete" title="Delete">✕</button>
      <span class="cc-chev">${isExpanded ? '▾' : '▸'}</span>
    </span>
  `;
  header.addEventListener('click', e => {
    if (e.target.closest('.cc-act')) return;       // action button — handled below
    expandedCharId = isExpanded ? null : char.id;
    renderCast();
  });
  header.querySelector('[data-act="rename"]')?.addEventListener('click', e => {
    e.stopPropagation(); renameCharacter(char.id);
  });
  header.querySelector('[data-act="delete"]')?.addEventListener('click', e => {
    e.stopPropagation(); deleteCharacter(char.id);
  });
  card.appendChild(header);

  // Per-card zoom slider — visible in comfy mode (always) or compact-expanded.
  // Compact-collapsed shows only the zoom badge in the header.
  const showZoom = !isCompact || isExpanded;
  if (showZoom) {
    const zoomRow = document.createElement('div');
    zoomRow.className = 'cc-zoom';
    zoomRow.innerHTML = `
      <span class="cc-zoom-min" title="Smaller">⊖</span>
      <input type="range" class="cc-zoom-slider"
             min="${ZOOM_MIN}" max="${ZOOM_MAX}" step="0.05"
             value="${char.zoom || 1}">
      <span class="cc-zoom-max" title="Larger">⊕</span>
      <span class="cc-zoom-val">${Math.round((char.zoom || 1) * 100)}%</span>
    `;
    const slider = zoomRow.querySelector('.cc-zoom-slider');
    slider.addEventListener('input', e => {
      char.zoom = parseFloat(e.target.value);
      card.style.setProperty('--char-zoom', char.zoom);
      const valEl = zoomRow.querySelector('.cc-zoom-val');
      if (valEl) valEl.textContent = `${Math.round(char.zoom * 100)}%`;
    });
    slider.addEventListener('change', () => {
      // Persist on release so we don't hammer IDB during a drag.
      persistCharacters();
    });
    card.appendChild(zoomRow);
  }

  // Thumbnail grid — 3 thumbs collapsed, up to 6 + add-tile expanded.
  const grid = document.createElement('div');
  grid.className = 'cc-grid';
  const limit = isExpanded ? 6 : 3;
  const visibleRefs = refsForChar.slice(0, limit);
  for (const r of visibleRefs) {
    const tile = document.createElement('div');
    tile.className = 'cc-tile';
    tile.innerHTML = `<img src="${r.data}" alt="${escapeHtml(r.name || '')}" loading="lazy">`;
    tile.title = r.name || 'reference';
    // Zoom transform via CSS var on the card so all tiles inside scale together
    grid.appendChild(tile);
  }
  // "+" tile to attach a ref. Only shown when expanded — keeps collapsed cards quiet.
  if (isExpanded) {
    const addTile = document.createElement('div');
    addTile.className = 'cc-tile cc-tile-add';
    addTile.innerHTML = '<span>＋</span><span class="cc-tile-add-label">attach ref</span>';
    addTile.title = 'Attach a reference image to this character';
    addTile.addEventListener('click', () => attachRefDialog(char));
    grid.appendChild(addTile);
  }
  // Empty state — no refs yet
  if (visibleRefs.length === 0 && !isExpanded) {
    grid.classList.add('cc-grid-empty');
    grid.innerHTML = `<div class="cc-grid-hint">no refs yet — open card to attach</div>`;
  }
  card.appendChild(grid);

  // Palette — comfy always, compact only when expanded
  if (showZoom) {
    const pal = document.createElement('div');
    pal.className = 'cc-palette';
    for (const c of (char.palette || [])) {
      const sw = document.createElement('span');
      sw.className = 'cc-swatch';
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => {
        // Set the brush color to this swatch — uses the v3.8.3 single entry point.
        // Lazy-imported so the cast panel doesn't pull in brush-panel at module load.
        import('./brush-panel.js').then(m => m.setBrushColor?.(c));
      });
      pal.appendChild(sw);
    }
    if (isExpanded) {
      const add = document.createElement('button');
      add.className = 'cc-pal-add';
      add.textContent = '+';
      add.title = 'Add swatch from current brush color';
      add.addEventListener('click', () => {
        char.palette = char.palette || [];
        char.palette.push(App.brush.color);
        renderCast();
        persistCharacters();
        App.dirty = true; updateSaveStatus();
      });
      pal.appendChild(add);
    }
    card.appendChild(pal);
  }

  // Profile accordion — only when expanded
  if (isExpanded) {
    const prof = document.createElement('div');
    prof.className = 'cc-profile';
    const fields = [
      { key: 'role',  label: 'role',  ph: 'who they are' },
      { key: 'voice', label: 'voice', ph: 'how they speak' },
      { key: 'wants', label: 'wants', ph: 'what drives them' },
      { key: 'fears', label: 'fears', ph: 'what stops them' },
    ];
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'cc-profile-row';
      row.innerHTML = `
        <label class="cc-profile-label">${f.label}</label>
        <input class="cc-profile-input" type="text"
               placeholder="${f.ph}"
               value="${escapeHtml((char.profile?.[f.key]) || '')}">
      `;
      const input = row.querySelector('input');
      input.addEventListener('change', e => {
        char.profile = char.profile || {};
        char.profile[f.key] = e.target.value;
        persistCharacters();
        App.dirty = true; updateSaveStatus();
      });
      prof.appendChild(row);
    }
    card.appendChild(prof);
  }

  return card;
}

/**
 * Simple "attach ref" dialog: lists all project refs not yet attached to
 * this character. User picks one. Multi-select can come in v3.9.x.
 */
function attachRefDialog(char) {
  const allRefs = App.project?.refs || [];
  const attached = new Set(char.refIds || []);
  const unattached = allRefs.filter(r => !attached.has(r.id));
  if (unattached.length === 0) {
    toast('All refs are already attached. Add new refs in the Refs tab.', 'info');
    return;
  }
  // Build a tiny picker right inside the card grid — no modal needed for v3.9.0.
  const card = document.querySelector(`.char-card[data-char-id="${char.id}"]`);
  if (!card) return;
  // Remove any existing picker
  card.querySelector('.cc-attach-picker')?.remove();
  const picker = document.createElement('div');
  picker.className = 'cc-attach-picker';
  picker.innerHTML = `<div class="cc-attach-title">Attach a reference</div>`;
  const grid = document.createElement('div');
  grid.className = 'cc-attach-grid';
  for (const r of unattached) {
    const tile = document.createElement('div');
    tile.className = 'cc-attach-tile';
    tile.innerHTML = `<img src="${r.data}" alt=""><span>${escapeHtml(r.name || '')}</span>`;
    tile.addEventListener('click', () => {
      char.refIds = char.refIds || [];
      char.refIds.push(r.id);
      renderCast();
      persistCharacters();
      App.dirty = true; updateSaveStatus();
    });
    grid.appendChild(tile);
  }
  picker.appendChild(grid);
  // Close on backdrop click
  picker.addEventListener('click', e => {
    if (e.target === picker) picker.remove();
  });
  card.appendChild(picker);
}
