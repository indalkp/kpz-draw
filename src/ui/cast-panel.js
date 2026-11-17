// src/ui/cast-panel.js
//
// Cast, Locations, Props & Moodboard World Building Engine (inspired by 3a Final desktop).
//
// Features:
//   1. Cast (Characters):
//      - Final Character Thumbnail / Main Avatar (upload direct, set from ref, view in RefViewer)
//      - Multi-pose / reference tiles with direct upload & attachment from project refs
//      - Interactive swatches (1-click set brush color) & custom character color palette
//      - Character Profile (Role, Voice, Wants, Fears, Lore notes)
//   2. Locations (Loc):
//      - Environment name, INT/EXT & lighting tags, wide reference art, scene notes
//   3. Props (Props):
//      - Story items, vehicles, weapons, key props with descriptions & reference art
//   4. Moodboard (Mood):
//      - Aesthetic inspiration grid, style references & project color palette
//   5. Global Controls:
//      - Search filter across all assets
//      - Master tile size slider (60px–300px)
//      - Density toggle (compact vs comfy)

import { App } from '../core/state.js';
import { $, $$, escapeHtml } from '../utils/dom-helpers.js';
import { persistWorldData } from '../storage/persistent-refs.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';
import { openRefViewer } from './ref-viewer.js';
import { renderRefs } from './references.js';

export function compressImageFile(file, maxEdge = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const longEdge = Math.max(img.width, img.height);
        const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Invalid image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const DENSITY_KEY = 'kpz_cast_density';
const ZOOM_KEY = 'kpz_cast_zoom';
const DEFAULT_PALETTE = ['#1a1a1a', '#c97244', '#e8d8c4', '#7a4a2a'];

let expandedCharId = null;
let activeTab = 'cast';
let density = (typeof localStorage !== 'undefined' && localStorage.getItem(DENSITY_KEY)) || 'compact';
let masterTileH = parseInt((typeof localStorage !== 'undefined' && localStorage.getItem(ZOOM_KEY)) || '110', 10);
let searchQuery = '';

// Target IDs for direct file inputs
let avatarTargetCharId = null;
let directRefTargetCharId = null;
let imageTargetLocId = null;
let imageTargetPropId = null;

export function initCastPanel() {
  // Dropdown selector (Cast, Locations, Props, Mood, References)
  $('castViewSelect')?.addEventListener('change', e => switchTab(e.target.value));

  // Legacy tab buttons compatibility
  $('castTabCast')?.addEventListener('click', () => switchTab('cast'));
  $('castTabLoc')?.addEventListener('click', () => switchTab('loc'));
  $('castTabProps')?.addEventListener('click', () => switchTab('props'));
  $('castTabMood')?.addEventListener('click', () => switchTab('mood'));
  $('castTabRefs')?.addEventListener('click', () => switchTab('refs'));

  // Density toggle
  $('castDensityToggle')?.addEventListener('click', toggleDensity);

  // Search toggle and input
  $('castSearchToggle')?.addEventListener('click', toggleSearch);
  $('castSearchClear')?.addEventListener('click', () => {
    const input = $('castSearchInput');
    if (input) input.value = '';
    searchQuery = '';
    renderCurrentTab();
  });
  $('castSearchInput')?.addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderCurrentTab();
  });

  // Master tile size slider
  const zoomSlider = $('castMasterZoom');
  if (zoomSlider) {
    zoomSlider.value = masterTileH;
    $('castMasterZoomVal').textContent = `${masterTileH}px`;
    applyTileZoom(masterTileH);
    zoomSlider.addEventListener('input', e => {
      const val = parseInt(e.target.value, 10);
      masterTileH = val;
      $('castMasterZoomVal').textContent = `${val}px`;
      applyTileZoom(val);
      try { localStorage.setItem(ZOOM_KEY, String(val)); } catch {}
    });
  }

  // Unified "+ Add" button
  $('btnAddWorldItem')?.addEventListener('click', handleAddWorldItem);

  // Hidden file inputs
  setupFileInputs();

  // Apply persisted density
  applyDensityClass();

  // Initial render — default to 'refs' as requested
  updateBadges();
  switchTab('refs');
}

function applyTileZoom(h) {
  const panel = $('leftPanel');
  if (panel) {
    panel.style.setProperty('--ref-tile-h', `${h}px`);
  }
}

export function switchTab(tab) {
  activeTab = tab;

  // Sync dropdown selector
  const select = $('castViewSelect');
  if (select && select.value !== tab) {
    select.value = tab;
  }

  // Toggle tab buttons (if present)
  const tabs = ['cast', 'loc', 'props', 'mood', 'refs'];
  tabs.forEach(t => {
    const btn = $(`castTab${capitalize(t)}`);
    if (btn) btn.classList.toggle('active', tab === t);
  });

  // Toggle container views
  const castBody = $('castList');
  const castEmpty = $('castEmpty');
  const locBody = $('locList');
  const locEmpty = $('locEmpty');
  const propsBody = $('propsList');
  const propsEmpty = $('propsEmpty');
  const moodBody = $('moodList');
  const moodEmpty = $('moodEmpty');
  const refsBody = $('refList');
  const refsEmpty = $('refEmpty');

  const castHeaderActions = document.querySelector('.cast-header-actions');
  const refHeaderActions  = document.querySelector('.ref-header-actions');
  const castZoomRow       = $('castZoomRow');
  const refSizeRow        = document.querySelector('.ref-size-row');

  if (castBody)   castBody.style.display   = tab === 'cast'  ? '' : 'none';
  if (castEmpty)  castEmpty.style.display  = tab === 'cast'  ? '' : 'none';
  if (locBody)    locBody.style.display    = tab === 'loc'   ? '' : 'none';
  if (locEmpty)   locEmpty.style.display   = tab === 'loc'   ? '' : 'none';
  if (propsBody)  propsBody.style.display  = tab === 'props' ? '' : 'none';
  if (propsEmpty) propsEmpty.style.display = tab === 'props' ? '' : 'none';
  if (moodBody)   moodBody.style.display   = tab === 'mood'  ? '' : 'none';
  if (moodEmpty)  moodEmpty.style.display  = tab === 'mood'  ? '' : 'none';
  if (refsBody)   refsBody.style.display   = tab === 'refs'  ? '' : 'none';
  if (refsEmpty)  refsEmpty.style.display  = tab === 'refs'  ? '' : 'none';

  if (tab === 'refs') {
    if (castHeaderActions) castHeaderActions.style.display = 'none';
    if (refHeaderActions)  refHeaderActions.style.display  = 'flex';
    if (castZoomRow)       castZoomRow.style.display       = 'none';
    if (refSizeRow)        refSizeRow.style.display        = 'flex';
    renderRefs();
  } else {
    if (castHeaderActions) castHeaderActions.style.display = 'flex';
    if (refHeaderActions)  refHeaderActions.style.display  = 'none';
    if (castZoomRow)       castZoomRow.style.display       = 'flex';
    if (refSizeRow)        refSizeRow.style.display        = 'none';
    renderCurrentTab();
  }

  // Update "+ Add" button title
  const addBtn = $('btnAddWorldItem');
  if (addBtn) {
    if (tab === 'cast')  addBtn.textContent = '+ Char';
    if (tab === 'loc')   addBtn.textContent = '+ Loc';
    if (tab === 'props') addBtn.textContent = '+ Prop';
    if (tab === 'mood')  addBtn.textContent = '+ Mood';
  }
}

function renderCurrentTab() {
  updateBadges();
  if (activeTab === 'cast')  renderCast();
  if (activeTab === 'loc')   renderLocations();
  if (activeTab === 'props') renderProps();
  if (activeTab === 'mood')  renderMoodboard();
}

export function updateBadges() {
  const chars = App.project?.characters || [];
  const locs  = App.project?.locations || [];
  const props = App.project?.props || [];
  const mood  = App.project?.moodboard?.images || [];
  const refs  = App.project?.refs || [];

  // Update dropdown options
  const optRefs  = $('castOptRefs');
  const optCast  = $('castOptCast');
  const optLoc   = $('castOptLoc');
  const optProps = $('castOptProps');
  const optMood  = $('castOptMood');

  if (optRefs)  optRefs.textContent  = `References (${refs.length})`;
  if (optCast)  optCast.textContent  = `Cast (${chars.length})`;
  if (optLoc)   optLoc.textContent   = `Locations (${locs.length})`;
  if (optProps) optProps.textContent = `Props (${props.length})`;
  if (optMood)  optMood.textContent  = `Moodboard (${mood.length})`;

  // Legacy tab badges compatibility
  if ($('castBadgeCast'))  $('castBadgeCast').textContent  = chars.length;
  if ($('castBadgeLoc'))   $('castBadgeLoc').textContent   = locs.length;
  if ($('castBadgeProps')) $('castBadgeProps').textContent = props.length;
  if ($('castBadgeMood'))  $('castBadgeMood').textContent  = mood.length;
  if ($('castBadgeRefs'))  $('castBadgeRefs').textContent  = refs.length;
}

function toggleSearch() {
  const row = $('castSearchRow');
  if (!row) return;
  const isHidden = row.style.display === 'none';
  row.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) {
    $('castSearchInput')?.focus();
  } else {
    searchQuery = '';
    renderCurrentTab();
  }
}

function toggleDensity() {
  density = density === 'compact' ? 'comfy' : 'compact';
  try { localStorage.setItem(DENSITY_KEY, density); } catch {}
  applyDensityClass();
  renderCurrentTab();
}

function applyDensityClass() {
  const panel = $('leftPanel');
  if (!panel) return;
  panel.classList.toggle('cast-compact', density === 'compact');
  panel.classList.toggle('cast-comfy',   density === 'comfy');
  const btn = $('castDensityToggle');
  if (btn) btn.textContent = density === 'compact' ? '⚏' : '▤';
  if (btn) btn.title = density === 'compact' ? 'Switch to comfy view' : 'Switch to compact view';
}

function handleAddWorldItem() {
  if (activeTab === 'cast')  addCharacter();
  if (activeTab === 'loc')   addLocation();
  if (activeTab === 'props') addProp();
  if (activeTab === 'mood')  $('moodImageInput')?.click();
}

// ---------------------------------------------------------------------------
// 1. CAST & CHARACTER ENGINE
// ---------------------------------------------------------------------------

function addCharacter() {
  if (!App.project) return;
  const defName = `Character ${(App.project.characters?.length || 0) + 1}`;
  let name = defName;
  try {
    const entered = window.prompt ? prompt('Character name:', defName) : defName;
    if (entered === null) return;
    if (entered && entered.trim()) name = entered.trim();
  } catch {}
  const char = {
    id:      'C' + Math.random().toString(36).slice(2, 9),
    name,
    avatar:  null,   // Final character art thumbnail
    refIds:  [],     // Poses and references
    palette: DEFAULT_PALETTE.slice(),
    profile: { role: '', voice: '', wants: '', fears: '', notes: '' },
    zoom:    1,
    created: Date.now(),
  };
  App.project.characters = App.project.characters || [];
  App.project.characters.push(char);
  expandedCharId = char.id;
  renderCast();
  persistWorldData();
  App.dirty = true; updateSaveStatus();
}

function deleteCharacter(charId) {
  if (!App.project?.characters) return;
  const idx = App.project.characters.findIndex(c => c.id === charId);
  if (idx < 0) return;
  const char = App.project.characters[idx];
  if (!confirm(`Delete character "${char.name}"?`)) return;
  App.project.characters.splice(idx, 1);
  if (expandedCharId === charId) expandedCharId = null;
  renderCast();
  persistWorldData();
  App.dirty = true; updateSaveStatus();
}

function renameCharacter(charId) {
  const char = findChar(charId);
  if (!char) return;
  const next = (prompt('Rename character:', char.name) || '').trim();
  if (!next || next === char.name) return;
  char.name = next;
  renderCast();
  persistWorldData();
  App.dirty = true; updateSaveStatus();
}

export function renderCast() {
  const body  = $('castList');
  const empty = $('castEmpty');
  if (!body) return;
  body.innerHTML = '';

  let chars = App.project?.characters || [];
  if (searchQuery) {
    chars = chars.filter(c =>
      c.name.toLowerCase().includes(searchQuery) ||
      (c.profile?.role && c.profile.role.toLowerCase().includes(searchQuery)) ||
      (c.profile?.notes && c.profile.notes.toLowerCase().includes(searchQuery))
    );
  }

  if (empty) empty.style.display = chars.length === 0 ? 'block' : 'none';

  for (const char of chars) {
    body.appendChild(renderCharacterCard(char));
  }
}

function renderCharacterCard(char) {
  const isExpanded = expandedCharId === char.id;
  const isCompact  = density === 'compact';
  const card = document.createElement('div');
  card.className = `char-card${isExpanded ? ' expanded' : ''}`;
  card.dataset.charId = char.id;
  card.style.setProperty('--char-zoom', char.zoom || 1);

  const refIds = char.refIds || [];
  const refsForChar = refIds.map(findRef).filter(Boolean);

  // Header
  const header = document.createElement('div');
  header.className = 'cc-header';

  // Final Character Thumbnail / Avatar
  const avatarWrapper = document.createElement('div');
  avatarWrapper.className = `cc-avatar ${char.avatar ? 'has-avatar' : 'no-avatar'}`;
  if (char.avatar) {
    avatarWrapper.title = `${char.name} — Final Art (Click to view, hover to edit)`;
    avatarWrapper.innerHTML = `
      <img src="${char.avatar}" class="cc-avatar-img" alt="${escapeHtml(char.name)}">
      <div class="cc-avatar-hover">
        <button class="cc-av-act" data-act="view" title="Open Fullscreen">↗</button>
        <button class="cc-av-act" data-act="change" title="Change Final Thumbnail">✎</button>
        <button class="cc-av-act" data-act="clear" title="Remove Final Thumbnail">✕</button>
      </div>
    `;
    avatarWrapper.querySelector('[data-act="view"]')?.addEventListener('click', e => {
      e.stopPropagation();
      openRefViewer(char.avatar, `${char.name} (Final Art)`);
    });
    avatarWrapper.querySelector('[data-act="change"]')?.addEventListener('click', e => {
      e.stopPropagation();
      promptAvatarUpload(char.id);
    });
    avatarWrapper.querySelector('[data-act="clear"]')?.addEventListener('click', e => {
      e.stopPropagation();
      char.avatar = null;
      renderCast();
      persistWorldData();
      App.dirty = true; updateSaveStatus();
    });
  } else {
    avatarWrapper.title = 'Upload or set Final Character Art Thumbnail';
    avatarWrapper.innerHTML = `
      <span class="cc-avatar-icon">👤</span>
      <span class="cc-avatar-add">+ Final</span>
    `;
    avatarWrapper.addEventListener('click', e => {
      e.stopPropagation();
      promptAvatarUpload(char.id);
    });
  }
  header.appendChild(avatarWrapper);

  // Name & details
  const nameCol = document.createElement('div');
  nameCol.className = 'cc-title-col';
  nameCol.innerHTML = `
    <div class="cc-name-row">
      <span class="cc-name">${escapeHtml(char.name)}</span>
      <span class="cc-count" title="${refsForChar.length} attached references">${refsForChar.length} poses</span>
    </div>
    ${char.profile?.role ? `<div class="cc-role">${escapeHtml(char.profile.role)}</div>` : ''}
  `;
  header.appendChild(nameCol);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'cc-actions';
  actions.innerHTML = `
    <button class="cc-act" data-act="upload" title="Upload direct ref/pose">↑</button>
    <button class="cc-act" data-act="rename" title="Rename character">✎</button>
    <button class="cc-act" data-act="delete" title="Delete character">✕</button>
    <span class="cc-chev">${isExpanded ? '▾' : '▸'}</span>
  `;
  actions.querySelector('[data-act="upload"]')?.addEventListener('click', e => {
    e.stopPropagation();
    promptDirectRefUpload(char.id);
  });
  actions.querySelector('[data-act="rename"]')?.addEventListener('click', e => {
    e.stopPropagation();
    renameCharacter(char.id);
  });
  actions.querySelector('[data-act="delete"]')?.addEventListener('click', e => {
    e.stopPropagation();
    deleteCharacter(char.id);
  });
  header.appendChild(actions);

  header.addEventListener('click', e => {
    if (e.target.closest('.cc-act') || e.target.closest('.cc-avatar')) return;
    expandedCharId = isExpanded ? null : char.id;
    renderCast();
  });
  card.appendChild(header);

  // Grid of Poses / Attached References
  const grid = document.createElement('div');
  grid.className = 'cc-grid';
  const limit = isExpanded ? 16 : 4;
  const visibleRefs = refsForChar.slice(0, limit);

  for (const r of visibleRefs) {
    const tile = document.createElement('div');
    tile.className = 'cc-tile';
    tile.innerHTML = `
      <img src="${r.data}" alt="${escapeHtml(r.name || '')}">
      <div class="cc-tile-overlay">
        <button class="cc-to-btn" data-act="star" title="Set as Final Character Art">★</button>
        <button class="cc-to-btn" data-act="view" title="Open Fullscreen">↗</button>
        <button class="cc-to-btn" data-act="detach" title="Detach from character">✕</button>
      </div>
    `;
    tile.querySelector('[data-act="star"]')?.addEventListener('click', e => {
      e.stopPropagation();
      char.avatar = r.data;
      toast(`Set "${r.name || 'Image'}" as Final Art for ${char.name}`, 'ok');
      renderCast();
      persistWorldData();
      App.dirty = true; updateSaveStatus();
    });
    tile.querySelector('[data-act="view"]')?.addEventListener('click', e => {
      e.stopPropagation();
      openRefViewer(r.data, `${char.name} · ${r.name || 'Pose'}`);
    });
    tile.querySelector('[data-act="detach"]')?.addEventListener('click', e => {
      e.stopPropagation();
      char.refIds = (char.refIds || []).filter(id => id !== r.id);
      renderCast();
      persistWorldData();
      App.dirty = true; updateSaveStatus();
    });
    tile.addEventListener('click', () => {
      openRefViewer(r.data, `${char.name} · ${r.name || 'Pose'}`);
    });
    grid.appendChild(tile);
  }

  // Expanded Add tiles: "+ Upload" and "+ Attach"
  if (isExpanded) {
    const uploadTile = document.createElement('div');
    uploadTile.className = 'cc-tile cc-tile-add';
    uploadTile.innerHTML = `<span>↑</span><span class="cc-tile-add-label">upload ref</span>`;
    uploadTile.title = 'Upload an image directly from your computer';
    uploadTile.addEventListener('click', () => promptDirectRefUpload(char.id));
    grid.appendChild(uploadTile);

    const attachTile = document.createElement('div');
    attachTile.className = 'cc-tile cc-tile-add';
    attachTile.innerHTML = `<span>＋</span><span class="cc-tile-add-label">attach ref</span>`;
    attachTile.title = 'Attach an existing project reference';
    attachTile.addEventListener('click', () => attachRefDialog(char));
    grid.appendChild(attachTile);
  }

  if (visibleRefs.length === 0 && !isExpanded) {
    grid.classList.add('cc-grid-empty');
    grid.innerHTML = `<div class="cc-grid-hint">No poses attached. Click to expand & upload.</div>`;
  }
  card.appendChild(grid);

  // Palette swatches
  const pal = document.createElement('div');
  pal.className = 'cc-palette';
  for (const c of (char.palette || [])) {
    const sw = document.createElement('span');
    sw.className = 'cc-swatch';
    sw.style.background = c;
    sw.title = `Color: ${c} (Click to set brush)`;
    sw.addEventListener('click', () => {
      import('./brush-panel.js').then(m => m.setBrushColor?.(c));
      toast(`Brush set to ${c}`, 'ok');
    });
    pal.appendChild(sw);
  }
  if (isExpanded) {
    const addSw = document.createElement('button');
    addSw.className = 'cc-pal-add';
    addSw.textContent = '+';
    addSw.title = 'Add current brush color to palette';
    addSw.addEventListener('click', () => {
      char.palette = char.palette || [];
      if (!char.palette.includes(App.brush.color)) {
        char.palette.push(App.brush.color);
        renderCast();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      }
    });
    pal.appendChild(addSw);
  }
  card.appendChild(pal);

  // Character Profile details (when expanded)
  if (isExpanded) {
    const prof = document.createElement('div');
    prof.className = 'cc-profile';
    const fields = [
      { key: 'role',  label: 'Role',  ph: 'e.g. Lead protagonist, detective' },
      { key: 'voice', label: 'Voice', ph: 'e.g. Fast, dry, sarcastic' },
      { key: 'wants', label: 'Wants', ph: 'e.g. Find truth, protect family' },
      { key: 'fears', label: 'Fears', ph: 'e.g. Being caught, failure' },
      { key: 'notes', label: 'Notes', ph: 'Visual design cues, clothing, weapons' },
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
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      });
      prof.appendChild(row);
    }
    card.appendChild(prof);
  }

  return card;
}

function promptAvatarUpload(charId) {
  avatarTargetCharId = charId;
  const input = $('castAvatarInput');
  if (input) input.click();
}

function promptDirectRefUpload(charId) {
  directRefTargetCharId = charId;
  const input = $('castDirectRefInput');
  if (input) input.click();
}

function attachRefDialog(char) {
  const allRefs = App.project?.refs || [];
  const attached = new Set(char.refIds || []);
  const unattached = allRefs.filter(r => !attached.has(r.id));
  if (unattached.length === 0) {
    toast('All project refs are already attached to this character.', 'info');
    return;
  }
  const card = document.querySelector(`.char-card[data-char-id="${char.id}"]`);
  if (!card) return;
  card.querySelector('.cc-attach-picker')?.remove();

  const picker = document.createElement('div');
  picker.className = 'cc-attach-picker';
  picker.innerHTML = `<div class="cc-attach-title">Choose from project references</div>`;

  const grid = document.createElement('div');
  grid.className = 'cc-attach-grid';
  for (const r of unattached) {
    const tile = document.createElement('div');
    tile.className = 'cc-attach-tile';
    tile.innerHTML = `<img src="${r.data}" alt=""><span>${escapeHtml(r.name || 'Ref')}</span>`;
    tile.addEventListener('click', () => {
      char.refIds = char.refIds || [];
      char.refIds.push(r.id);
      renderCast();
      persistWorldData();
      App.dirty = true; updateSaveStatus();
    });
    grid.appendChild(tile);
  }
  picker.appendChild(grid);
  picker.addEventListener('click', e => {
    if (e.target === picker) picker.remove();
  });
  card.appendChild(picker);
}

// ---------------------------------------------------------------------------
// 2. LOCATIONS (LOC) ENGINE
// ---------------------------------------------------------------------------

function addLocation() {
  if (!App.project) return;
  const defName = `Location ${(App.project.locations?.length || 0) + 1}`;
  let name = defName;
  try {
    const entered = window.prompt ? prompt('Location name:', defName) : defName;
    if (entered === null) return;
    if (entered && entered.trim()) name = entered.trim();
  } catch {}
  const loc = {
    id:      'L' + Math.random().toString(36).slice(2, 9),
    name,
    tags:    ['INT', 'Day'],
    image:   null,
    desc:    '',
    created: Date.now(),
  };
  App.project.locations = App.project.locations || [];
  App.project.locations.push(loc);
  renderLocations();
  persistWorldData();
  App.dirty = true; updateSaveStatus();
}

function deleteLocation(locId) {
  if (!App.project?.locations) return;
  const idx = App.project.locations.findIndex(l => l.id === locId);
  if (idx < 0) return;
  const loc = App.project.locations[idx];
  if (!confirm(`Delete location "${loc.name}"?`)) return;
  App.project.locations.splice(idx, 1);
  renderLocations();
  persistWorldData();
  App.dirty = true; updateSaveStatus();
}

export function renderLocations() {
  const body  = $('locList');
  const empty = $('locEmpty');
  if (!body) return;
  body.innerHTML = '';

  let locs = App.project?.locations || [];
  if (searchQuery) {
    locs = locs.filter(l =>
      l.name.toLowerCase().includes(searchQuery) ||
      (l.tags && l.tags.some(t => t.toLowerCase().includes(searchQuery))) ||
      (l.desc && l.desc.toLowerCase().includes(searchQuery))
    );
  }

  if (empty) empty.style.display = locs.length === 0 ? 'block' : 'none';

  for (const loc of locs) {
    const card = document.createElement('div');
    card.className = 'loc-card';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'loc-header';
    hdr.innerHTML = `
      <span class="loc-icon">📍</span>
      <span class="loc-name">${escapeHtml(loc.name)}</span>
      <div class="loc-acts">
        <button class="cc-act" data-act="upload" title="Upload Reference Image">↑</button>
        <button class="cc-act" data-act="rename" title="Rename Location">✎</button>
        <button class="cc-act" data-act="delete" title="Delete Location">✕</button>
      </div>
    `;
    hdr.querySelector('[data-act="upload"]')?.addEventListener('click', () => {
      imageTargetLocId = loc.id;
      $('locImageInput')?.click();
    });
    hdr.querySelector('[data-act="rename"]')?.addEventListener('click', () => {
      const next = (prompt('Rename location:', loc.name) || '').trim();
      if (next && next !== loc.name) {
        loc.name = next;
        renderLocations();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      }
    });
    hdr.querySelector('[data-act="delete"]')?.addEventListener('click', () => deleteLocation(loc.id));
    card.appendChild(hdr);

    // Tags
    const tagsRow = document.createElement('div');
    tagsRow.className = 'loc-tags';
    (loc.tags || []).forEach((t, i) => {
      const tag = document.createElement('span');
      tag.className = `loc-tag ${i === 0 ? 'primary' : ''}`;
      tag.textContent = t;
      tag.title = 'Click to edit tag';
      tag.addEventListener('click', () => {
        const next = (prompt('Edit tag:', t) || '').trim();
        if (next) {
          loc.tags[i] = next;
        } else {
          loc.tags.splice(i, 1);
        }
        renderLocations();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      });
      tagsRow.appendChild(tag);
    });
    const addTag = document.createElement('button');
    addTag.className = 'loc-add-tag';
    addTag.textContent = '+ tag';
    addTag.addEventListener('click', () => {
      const next = (prompt('Add tag (e.g. INT, EXT, Night, Rain):', '') || '').trim();
      if (next) {
        loc.tags = loc.tags || [];
        loc.tags.push(next);
        renderLocations();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      }
    });
    tagsRow.appendChild(addTag);
    card.appendChild(tagsRow);

    // Location Image
    const imgBox = document.createElement('div');
    imgBox.className = 'loc-image-box';
    if (loc.image) {
      imgBox.innerHTML = `
        <img src="${loc.image}" alt="${escapeHtml(loc.name)}">
        <div class="loc-img-hover">
          <button class="cc-av-act" data-act="view" title="Open Fullscreen">↗</button>
          <button class="cc-av-act" data-act="change" title="Change Image">✎</button>
          <button class="cc-av-act" data-act="clear" title="Remove Image">✕</button>
        </div>
      `;
      imgBox.querySelector('[data-act="view"]')?.addEventListener('click', e => {
        e.stopPropagation();
        openRefViewer(loc.image, `${loc.name} (Location)`);
      });
      imgBox.querySelector('[data-act="change"]')?.addEventListener('click', e => {
        e.stopPropagation();
        imageTargetLocId = loc.id;
        $('locImageInput')?.click();
      });
      imgBox.querySelector('[data-act="clear"]')?.addEventListener('click', e => {
        e.stopPropagation();
        loc.image = null;
        renderLocations();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      });
      imgBox.addEventListener('click', () => openRefViewer(loc.image, `${loc.name} (Location)`));
    } else {
      imgBox.classList.add('loc-image-empty');
      imgBox.innerHTML = `<span>+ Upload Location Art</span>`;
      imgBox.addEventListener('click', () => {
        imageTargetLocId = loc.id;
        $('locImageInput')?.click();
      });
    }
    card.appendChild(imgBox);

    // Description / Notes
    const descBox = document.createElement('div');
    descBox.className = 'loc-desc-box';
    descBox.innerHTML = `
      <input type="text" class="loc-desc-input" placeholder="Scene notes, lighting, atmosphere…"
             value="${escapeHtml(loc.desc || '')}">
    `;
    descBox.querySelector('input')?.addEventListener('change', e => {
      loc.desc = e.target.value;
      persistWorldData();
      App.dirty = true; updateSaveStatus();
    });
    card.appendChild(descBox);

    body.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// 3. PROPS ENGINE
// ---------------------------------------------------------------------------

function addProp() {
  if (!App.project) return;
  const defName = `Prop ${(App.project.props?.length || 0) + 1}`;
  let name = defName;
  try {
    const entered = window.prompt ? prompt('Prop / Item name:', defName) : defName;
    if (entered === null) return;
    if (entered && entered.trim()) name = entered.trim();
  } catch {}
  const prop = {
    id:      'P' + Math.random().toString(36).slice(2, 9),
    name,
    desc:    '',
    image:   null,
    created: Date.now(),
  };
  App.project.props = App.project.props || [];
  App.project.props.push(prop);
  renderProps();
  persistWorldData();
  App.dirty = true; updateSaveStatus();
}

function deleteProp(propId) {
  if (!App.project?.props) return;
  const idx = App.project.props.findIndex(p => p.id === propId);
  if (idx < 0) return;
  const p = App.project.props[idx];
  if (!confirm(`Delete prop "${p.name}"?`)) return;
  App.project.props.splice(idx, 1);
  renderProps();
  persistWorldData();
  App.dirty = true; updateSaveStatus();
}

export function renderProps() {
  const body  = $('propsList');
  const empty = $('propsEmpty');
  if (!body) return;
  body.innerHTML = '';

  let props = App.project?.props || [];
  if (searchQuery) {
    props = props.filter(p =>
      p.name.toLowerCase().includes(searchQuery) ||
      (p.desc && p.desc.toLowerCase().includes(searchQuery))
    );
  }

  if (empty) empty.style.display = props.length === 0 ? 'block' : 'none';

  for (const p of props) {
    const card = document.createElement('div');
    card.className = 'prop-card';

    // Prop Image
    const imgBox = document.createElement('div');
    imgBox.className = 'prop-img-box';
    if (p.image) {
      imgBox.innerHTML = `
        <img src="${p.image}" alt="${escapeHtml(p.name)}">
        <div class="prop-img-hover">
          <button class="cc-av-act" data-act="view" title="Open Fullscreen">↗</button>
          <button class="cc-av-act" data-act="change" title="Change Art">✎</button>
          <button class="cc-av-act" data-act="clear" title="Remove Art">✕</button>
        </div>
      `;
      imgBox.querySelector('[data-act="view"]')?.addEventListener('click', e => {
        e.stopPropagation();
        openRefViewer(p.image, `${p.name} (Prop)`);
      });
      imgBox.querySelector('[data-act="change"]')?.addEventListener('click', e => {
        e.stopPropagation();
        imageTargetPropId = p.id;
        $('propImageInput')?.click();
      });
      imgBox.querySelector('[data-act="clear"]')?.addEventListener('click', e => {
        e.stopPropagation();
        p.image = null;
        renderProps();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      });
      imgBox.addEventListener('click', () => openRefViewer(p.image, `${p.name} (Prop)`));
    } else {
      imgBox.classList.add('prop-img-empty');
      imgBox.innerHTML = `<span>+ Prop Art</span>`;
      imgBox.addEventListener('click', () => {
        imageTargetPropId = p.id;
        $('propImageInput')?.click();
      });
    }
    card.appendChild(imgBox);

    // Info
    const info = document.createElement('div');
    info.className = 'prop-info';
    info.innerHTML = `
      <div class="prop-hdr">
        <span class="prop-name">${escapeHtml(p.name)}</span>
        <div class="prop-acts">
          <button class="cc-act" data-act="rename" title="Rename Prop">✎</button>
          <button class="cc-act" data-act="delete" title="Delete Prop">✕</button>
        </div>
      </div>
      <input type="text" class="prop-desc-input" placeholder="Prop lore, owner, details…"
             value="${escapeHtml(p.desc || '')}">
    `;
    info.querySelector('[data-act="rename"]')?.addEventListener('click', () => {
      const next = (prompt('Rename prop:', p.name) || '').trim();
      if (next && next !== p.name) {
        p.name = next;
        renderProps();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      }
    });
    info.querySelector('[data-act="delete"]')?.addEventListener('click', () => deleteProp(p.id));
    info.querySelector('.prop-desc-input')?.addEventListener('change', e => {
      p.desc = e.target.value;
      persistWorldData();
      App.dirty = true; updateSaveStatus();
    });
    card.appendChild(info);

    body.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// 4. MOODBOARD ENGINE
// ---------------------------------------------------------------------------

export function renderMoodboard() {
  const body  = $('moodList');
  const empty = $('moodEmpty');
  if (!body) return;
  body.innerHTML = '';

  const mood = App.project?.moodboard || { images: [], palette: [] };
  const images = mood.images || [];

  if (empty) empty.style.display = images.length === 0 ? 'block' : 'none';

  // Palette strip
  const palSec = document.createElement('div');
  palSec.className = 'mood-palette-sec';
  palSec.innerHTML = `<span class="mood-pal-label">Aesthetic Palette</span>`;
  const palRow = document.createElement('div');
  palRow.className = 'mood-pal-row';
  (mood.palette || ['#1a1a2a', '#3a2a3a', '#c97244', '#e8d8c4']).forEach(c => {
    const sw = document.createElement('span');
    sw.className = 'cc-swatch';
    sw.style.background = c;
    sw.title = `Color: ${c} (Click to set brush)`;
    sw.addEventListener('click', () => {
      import('./brush-panel.js').then(m => m.setBrushColor?.(c));
      toast(`Brush set to ${c}`, 'ok');
    });
    palRow.appendChild(sw);
  });
  const addPalBtn = document.createElement('button');
  addPalBtn.className = 'cc-pal-add';
  addPalBtn.textContent = '+';
  addPalBtn.title = 'Add current brush color to aesthetic palette';
  addPalBtn.addEventListener('click', () => {
    mood.palette = mood.palette || [];
    if (!mood.palette.includes(App.brush.color)) {
      mood.palette.push(App.brush.color);
      renderMoodboard();
      persistWorldData();
      App.dirty = true; updateSaveStatus();
    }
  });
  palRow.appendChild(addPalBtn);
  palSec.appendChild(palRow);
  body.appendChild(palSec);

  // Mood image grid
  const grid = document.createElement('div');
  grid.className = 'mood-grid';
  images.forEach((imgSrc, idx) => {
    const tile = document.createElement('div');
    tile.className = 'mood-tile';
    tile.innerHTML = `
      <img src="${imgSrc}" alt="Mood ${idx + 1}">
      <div class="mood-tile-overlay">
        <button class="cc-to-btn" data-act="view" title="Open in RefViewer">↗</button>
        <button class="cc-to-btn" data-act="del" title="Remove from Moodboard">✕</button>
      </div>
    `;
    tile.querySelector('[data-act="view"]')?.addEventListener('click', e => {
      e.stopPropagation();
      openRefViewer(imgSrc, `Mood Reference ${idx + 1}`);
    });
    tile.querySelector('[data-act="del"]')?.addEventListener('click', e => {
      e.stopPropagation();
      mood.images.splice(idx, 1);
      renderMoodboard();
      persistWorldData();
      App.dirty = true; updateSaveStatus();
    });
    tile.addEventListener('click', () => openRefViewer(imgSrc, `Mood Reference ${idx + 1}`));
    grid.appendChild(tile);
  });

  // Add Mood Image tile
  const addTile = document.createElement('div');
  addTile.className = 'mood-tile mood-tile-add';
  addTile.innerHTML = `<span>+</span><span class="mood-tile-label">Add Art</span>`;
  addTile.title = 'Upload image to moodboard';
  addTile.addEventListener('click', () => $('moodImageInput')?.click());
  grid.appendChild(addTile);

  body.appendChild(grid);
}

// ---------------------------------------------------------------------------
// 5. FILE UPLOAD HANDLERS
// ---------------------------------------------------------------------------

function setupFileInputs() {
  // Avatar upload for character
  $('castAvatarInput')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !avatarTargetCharId) return;
    try {
      const dataUrl = await compressImageFile(file, 800, 0.88);
      const char = findChar(avatarTargetCharId);
      if (char) {
        char.avatar = dataUrl;
        toast(`Uploaded final art for "${char.name}"`, 'ok');
        renderCast();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      }
    } catch (err) {
      toast('Avatar upload failed: ' + err.message, 'error');
    }
  });

  // Direct ref/pose upload for character
  $('castDirectRefInput')?.addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0 || !directRefTargetCharId) return;
    const char = findChar(directRefTargetCharId);
    if (!char) return;

    for (const f of files) {
      try {
        const dataUrl = await compressImageFile(f, 1600, 0.85);
        const refId = 'R' + Math.random().toString(36).slice(2, 9);
        App.project.refs = App.project.refs || [];
        App.project.refs.push({ id: refId, data: dataUrl, name: f.name });
        char.refIds = char.refIds || [];
        char.refIds.push(refId);
      } catch (err) {
        toast(`Failed uploading "${f.name}": ${err.message}`, 'error');
      }
    }
    toast(`Attached ${files.length} refs to "${char.name}"`, 'ok');
    renderCast();
    persistWorldData();
    App.dirty = true; updateSaveStatus();
  });

  // Location image upload
  $('locImageInput')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !imageTargetLocId) return;
    try {
      const dataUrl = await compressImageFile(file, 1600, 0.85);
      const loc = (App.project?.locations || []).find(l => l.id === imageTargetLocId);
      if (loc) {
        loc.image = dataUrl;
        toast(`Updated location art for "${loc.name}"`, 'ok');
        renderLocations();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      }
    } catch (err) {
      toast('Location image upload failed: ' + err.message, 'error');
    }
  });

  // Prop image upload
  $('propImageInput')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !imageTargetPropId) return;
    try {
      const dataUrl = await compressImageFile(file, 1200, 0.85);
      const prop = (App.project?.props || []).find(p => p.id === imageTargetPropId);
      if (prop) {
        prop.image = dataUrl;
        toast(`Updated prop art for "${prop.name}"`, 'ok');
        renderProps();
        persistWorldData();
        App.dirty = true; updateSaveStatus();
      }
    } catch (err) {
      toast('Prop image upload failed: ' + err.message, 'error');
    }
  });

  // Moodboard multi-image upload
  $('moodImageInput')?.addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    App.project.moodboard = App.project.moodboard || { images: [], palette: [] };
    for (const f of files) {
      try {
        const dataUrl = await compressImageFile(f, 1600, 0.85);
        App.project.moodboard.images.push(dataUrl);
      } catch (err) {
        toast(`Mood upload failed for "${f.name}": ${err.message}`, 'error');
      }
    }
    toast(`Added ${files.length} images to Moodboard`, 'ok');
    renderMoodboard();
    persistWorldData();
    App.dirty = true; updateSaveStatus();
  });
}

function findChar(charId) {
  return (App.project?.characters || []).find(c => c.id === charId);
}

function findRef(refId) {
  return (App.project?.refs || []).find(r => r.id === refId);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
