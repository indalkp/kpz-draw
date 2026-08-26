// src/script/script-bible.js
// Rich Story Bible & Element Profiles for KPZ Draw.
// Supports Characters (Goals, Flaws, Voice, Arc, 2-Way Relationships),
// Locations, Props, Moods (Live Color Palette editor), References,
// Templates, and AI Auto-Drafting via Groq/Ollama.

import { ScriptState } from './script-state.js';
import { aiComplete, AIConfig } from './script-ai.js';
import { toast } from '../ui/toast.js';
import { App } from '../core/state.js';

export const EL_PALETTE = ['#F97316', '#EF4444', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4', '#64748B', '#78716C'];

export const ELEMENT_SCHEMA = {
  Characters: {
    label: 'Character',
    icon: '👤',
    sub: 'role',
    traits: true,
    fields: [
      { key: 'role', label: 'Role / Archetype', hint: 'Protagonist, Antagonist, Mentor, Ally, Wildcard', short: true },
      { key: 'goal', label: 'External Goal', hint: 'What they want concretely in this story', short: true },
      { key: 'motivation', label: 'Core Motivation', hint: 'Why they want it — deep psychological need', short: true },
      { key: 'conflict', label: 'Main Conflict', hint: 'What stops them (internal flaw + external opposition)', short: true },
      { key: 'appearance', label: 'Visual & Voice', hint: 'Distinguishing physical features, posture, vocal rhythm' },
      { key: 'backstory', label: 'Backstory Wound', hint: 'Past event that shaped their worldview' },
      { key: 'arc', label: 'Character Arc', hint: 'Who they are at the start → who they become at the climax' },
      { key: 'notes', label: 'Production Notes', hint: 'Mannerisms, animation cues, prop affinities' }
    ]
  },
  Locations: {
    label: 'Location',
    icon: '📍',
    sub: 'role',
    fields: [
      { key: 'role', label: 'Type & Setting', hint: 'INT / EXT, urban, fantasy, time of day', short: true },
      { key: 'atmosphere', label: 'Atmosphere & Mood', hint: 'Emotional resonance of the environment', short: true },
      { key: 'sensory', label: 'Sensory Details', hint: 'Lighting, ambient sound, textures, smell' },
      { key: 'significance', label: 'Narrative Significance', hint: 'Why this setting matters to this scene/story' },
      { key: 'notes', label: 'Layout & Art Direction', hint: 'Key angles, color palette, staging notes' }
    ]
  },
  Props: {
    label: 'Key Prop',
    icon: '◆',
    sub: 'role',
    fields: [
      { key: 'role', label: 'Owner & Category', hint: 'Who carries it · weapon, heirloom, tech, clue', short: true },
      { key: 'significance', label: 'Symbolic Weight', hint: 'What it represents (MacGuffin, pledge, memory)', short: true },
      { key: 'firstAppears', label: 'First Appearance', hint: 'Where and how it is introduced in the story', short: true },
      { key: 'payoff', label: 'Climax / Payoff', hint: 'How it factors into the resolution' },
      { key: 'notes', label: 'Design Notes', hint: 'Scale, material, visual wear and tear' }
    ]
  },
  Moods: {
    label: 'Mood & Tone',
    icon: '🎨',
    sub: 'role',
    palette: true,
    fields: [
      { key: 'role', label: 'Applies To', hint: 'Which sequences / acts carry this emotional tone', short: true },
      { key: 'feeling', label: 'Core Emotion', hint: 'Dread, exhilaration, melancholic, suspenseful', short: true },
      { key: 'light', label: 'Color & Lighting', hint: 'Key-to-fill ratio, dominant chromatic temperature' },
      { key: 'sound', label: 'Soundscape & Score', hint: 'Pacing, drone, tempo, acoustic textures' },
      { key: 'camera', label: 'Cinematography / Lens', hint: 'Framing, focal length, camera motion speed', short: true },
      { key: 'notes', label: 'Animation Style Notes', hint: 'Line weight, frame rate cadence, texture' }
    ]
  },
  References: {
    label: 'Visual Reference',
    icon: '🖼',
    sub: 'role',
    fields: [
      { key: 'role', label: 'Medium & Purpose', hint: 'Film, art piece, anime, storyboard study', short: true },
      { key: 'takeaway', label: 'What to Borrow', hint: 'The specific technique, framing, or pacing to adapt' },
      { key: 'avoid', label: 'What to Avoid', hint: 'Where our production diverges and stays unique', short: true },
      { key: 'source', label: 'Source URL / Title', hint: 'Link or artist / film attribution', short: true },
      { key: 'notes', label: 'Analysis Notes', hint: 'Timestamps, color swatches, shot breakdown' }
    ]
  }
};

let activeElementKind = null;
let activeElementId = null;

/**
 * Get items array for a given kind from ScriptState
 */
export function getElements(kind) {
  if (!ScriptState.bible) {
    ScriptState.bible = { Characters: [], Locations: [], Props: [], Moods: [], References: [], templates: {} };
  }
  if (!ScriptState.bible[kind]) {
    ScriptState.bible[kind] = [];
  }
  return ScriptState.bible[kind];
}

/**
 * Find element by kind and id
 */
export function findElement(kind, id) {
  const arr = getElements(kind);
  return arr.find(x => x.id === id);
}

/**
 * Create a new element
 */
export function createElement(kind, initialData = {}) {
  const arr = getElements(kind);
  const color = EL_PALETTE[Math.floor(Math.random() * EL_PALETTE.length)];
  const id = `${kind.toLowerCase().slice(0, 4)}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  
  const newItem = {
    id,
    name: initialData.name || `New ${ELEMENT_SCHEMA[kind].label}`,
    role: initialData.role || '',
    color: initialData.color || color,
    fields: initialData.fields || {},
    traits: initialData.traits || { strengths: [], flaws: [] },
    rels: initialData.rels || [],
    palette: initialData.palette || (kind === 'Moods' ? [color, '#292524', '#FB923C'] : undefined)
  };

  arr.push(newItem);
  ScriptState.saveToStorage();
  return newItem;
}

/**
 * Delete element
 */
export function deleteElement(kind, id) {
  const arr = getElements(kind);
  const idx = arr.findIndex(x => x.id === id);
  if (idx !== -1) {
    arr.splice(idx, 1);
    // Remove references to this character in relationships of other characters
    if (kind === 'Characters') {
      arr.forEach(c => {
        if (c.rels) c.rels = c.rels.filter(r => r.to !== id);
      });
    }
    ScriptState.saveToStorage();
  }
}

/**
 * Render the main Bible tab overview inside Script Mode
 */
export function renderBibleOverview(container) {
  if (!container) return;

  const categories = ['Characters', 'Locations', 'Props', 'Moods', 'References'];

  container.innerHTML = `
    <div class="sm-bible-wrap">
      <!-- Bible Toolbar -->
      <div class="sm-bible-topbar">
        <div class="sm-bible-title">
          <span style="font-size:18px">📖</span>
          <div>
            <div style="font-weight:700;font-size:14px;color:var(--sm-text)">Production Story Bible</div>
            <div style="font-size:11px;color:var(--sm-text-muted)">Characters, Worlds, Props, Atmosphere Palettes & Visual References</div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="sm-btn" id="btnBibleExport" title="Export Story Bible as JSON">⬇ Export Bible</button>
        </div>
      </div>

      <!-- Category Grids -->
      <div class="sm-bible-categories">
        ${categories.map(cat => renderCategorySection(cat)).join('')}
      </div>
    </div>
  `;

  // Wire Add Buttons
  categories.forEach(cat => {
    container.querySelector(`[data-add-cat="${cat}"]`)?.addEventListener('click', () => {
      const item = createElement(cat);
      openElementModal(cat, item.id);
    });
  });

  // Wire Card Clicks
  container.querySelectorAll('[data-open-el]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.el-del')) return;
      const kind = card.getAttribute('data-kind');
      const id = card.getAttribute('data-id');
      openElementModal(kind, id);
    });
  });

  // Wire Delete Buttons
  container.querySelectorAll('[data-del-el]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const kind = btn.getAttribute('data-kind');
      const id = btn.getAttribute('data-del-el');
      if (confirm(`Delete this ${ELEMENT_SCHEMA[kind].label}?`)) {
        deleteElement(kind, id);
        renderBibleOverview(container);
        toast(`${ELEMENT_SCHEMA[kind].label} deleted`, 'info');
      }
    });
  });

  // Export Bible
  container.querySelector('#btnBibleExport')?.addEventListener('click', () => {
    const data = JSON.stringify(ScriptState.bible || {}, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(App.project && App.project.name) || 'story'}_bible.json`;
    a.click();
  });
}

function renderCategorySection(kind) {
  const schema = ELEMENT_SCHEMA[kind];
  const items = getElements(kind);

  return `
    <div class="sm-bible-section">
      <div class="sm-bible-section-h">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">${schema.icon}</span>
          <span style="font-weight:600;font-size:13px;color:var(--sm-text)">${kind}</span>
          <span class="sm-count-badge">${items.length}</span>
        </div>
        <button class="sm-btn primary" data-add-cat="${kind}" style="padding:3px 10px;font-size:11px">
          ＋ Add ${schema.label}
        </button>
      </div>

      <div class="sm-cards-grid">
        ${items.length === 0 ? `
          <div class="sm-empty-hint">No ${kind.toLowerCase()} created yet. Click "+ Add ${schema.label}" to start.</div>
        ` : items.map(it => renderElementCard(kind, it)).join('')}
      </div>
    </div>
  `;
}

function renderElementCard(kind, it) {
  const initials = getInitials(it.name);
  const isMood = kind === 'Moods';
  const palette = it.palette || [it.color || '#F97316'];

  return `
    <div class="sm-element-card" data-open-el="true" data-kind="${kind}" data-id="${it.id}">
      <div class="sm-el-card-top">
        ${isMood ? `
          <div class="sm-mood-swatches">
            ${palette.map(c => `<span style="background:${c}"></span>`).join('')}
          </div>
        ` : `
          <div class="sm-el-avatar" style="background:${it.color || '#F97316'}">
            ${initials}
          </div>
        `}
        <div class="sm-el-meta">
          <div class="sm-el-name">${escapeHtml(it.name || 'Untitled')}</div>
          <div class="sm-el-role">${escapeHtml(it.role || 'No role assigned')}</div>
        </div>
        <button class="el-del" data-kind="${kind}" data-del-el="${it.id}" title="Delete">✕</button>
      </div>

      <!-- Key preview fields -->
      <div class="sm-el-card-body">
        ${it.fields?.goal ? `<div class="sm-el-tag">🎯 ${escapeHtml(it.fields.goal)}</div>` : ''}
        ${it.fields?.feeling ? `<div class="sm-el-tag">✨ ${escapeHtml(it.fields.feeling)}</div>` : ''}
        ${it.fields?.significance ? `<div class="sm-el-tag">⭐ ${escapeHtml(it.fields.significance)}</div>` : ''}
        ${it.rels && it.rels.length ? `<div class="sm-el-tag">🔗 ${it.rels.length} links</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * Open the Rich Element Modal Dialog
 */
export function openElementModal(kind, id) {
  activeElementKind = kind;
  activeElementId = id;

  let modal = document.getElementById('kpzElementModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'kpzElementModal';
    modal.className = 'sm-modal-overlay hidden';
    document.body.appendChild(modal);
  }

  modal.classList.remove('hidden');
  renderModalContent();
}

export function closeElementModal() {
  const modal = document.getElementById('kpzElementModal');
  if (modal) modal.classList.add('hidden');
  activeElementKind = null;
  activeElementId = null;
  ScriptState.saveToStorage();

  // Re-render current Bible tab if open
  const bibleContent = document.getElementById('smContentArea');
  if (bibleContent && ScriptState.activeTab === 'bible') {
    renderBibleOverview(bibleContent);
  }
}

function renderModalContent() {
  const modal = document.getElementById('kpzElementModal');
  if (!modal || !activeElementKind || !activeElementId) return;

  const kind = activeElementKind;
  const it = findElement(kind, activeElementId);
  if (!it) { closeElementModal(); return; }

  const schema = ELEMENT_SCHEMA[kind];
  it.fields = it.fields || {};
  it.color = it.color || EL_PALETTE[0];
  if (kind === 'Characters') it.traits = it.traits || { strengths: [], flaws: [] };
  it.rels = it.rels || [];

  const initials = getInitials(it.name);
  const templates = (ScriptState.bible?.templates && ScriptState.bible.templates[kind]) || [];

  modal.innerHTML = `
    <div class="em-card">
      <!-- Modal Header -->
      <div class="em-head">
        <span class="em-kind">${schema.icon} ${schema.label} Profile</span>
        <div style="flex:1"></div>
        <select class="em-tsel" id="emTemplateSelect">
          <option value="">Templates (${templates.length})…</option>
          ${templates.map((t, idx) => `<option value="${idx}">↺ ${escapeAttr(t.name)}</option>`).join('')}
        </select>
        <button class="em-act" id="emSaveTmpl" title="Save current profile as template">🔖 Save Tmpl</button>
        <button class="em-act" id="emDuplicate" title="Duplicate profile">⎘ Dup</button>
        <button class="em-act primary" id="emAI" title="Draft missing fields using Groq or Ollama">✦ AI Fill</button>
        <button class="em-act danger" id="emDel" title="Delete profile">🗑</button>
        <button class="em-act" id="emClose" style="font-weight:700">✕</button>
      </div>

      <!-- Modal Body -->
      <div class="em-body" id="emModalBody">
        <!-- Identity Row -->
        <div class="em-idrow">
          <div class="em-colcol">
            <span class="em-cap">Color Tag</span>
            <div class="em-swatches">
              ${EL_PALETTE.map(c => `
                <span class="em-sw ${it.color === c ? 'on' : ''}" data-col="${c}" style="background:${c}"></span>
              `).join('')}
            </div>
          </div>
          <div class="em-namecol">
            <span class="em-cap">Name & Title</span>
            <input class="em-name" id="emNameInput" value="${escapeAttr(it.name || '')}" placeholder="${schema.label} Name">
            <input class="em-role" id="emRoleInput" value="${escapeAttr(it.role || '')}" placeholder="${schema.fields[0].label} · ${schema.fields[0].hint}">
          </div>
          <div class="em-avbox">
            <span class="em-av" id="emAvatarBadge" style="background:${it.color}">${initials}</span>
          </div>
        </div>

        <!-- Schema Fields -->
        <div class="em-fields">
          ${schema.palette ? renderPaletteBlock(it) : ''}
          ${schema.fields.slice(1).map(f => `
            <div class="em-field">
              <label class="em-l">${f.label}</label>
              <div class="em-hint">${f.hint}</div>
              <textarea class="em-ta ${f.short ? 'short' : ''}" data-fk="${f.key}" rows="${f.short ? 2 : 3}" placeholder="${f.hint}…">${escapeHtml(it.fields[f.key] || '')}</textarea>
            </div>
          `).join('')}

          ${schema.traits ? renderTraitsBlock(it) : ''}
          ${kind === 'Characters' ? renderRelationshipsBlock(it) : ''}
          ${renderAppearsInBlock(kind, it)}
        </div>
      </div>
    </div>
  `;

  wireModalEvents(modal, kind, it);
}

function wireModalEvents(modal, kind, it) {
  // Color Swatches
  modal.querySelectorAll('.em-sw').forEach(sw => {
    sw.addEventListener('click', () => {
      it.color = sw.getAttribute('data-col');
      ScriptState.saveToStorage();
      renderModalContent();
    });
  });

  // Name & Role Inputs
  const nameInp = modal.querySelector('#emNameInput');
  if (nameInp) {
    nameInp.addEventListener('input', () => {
      it.name = nameInp.value;
      const av = modal.querySelector('#emAvatarBadge');
      if (av) av.textContent = getInitials(it.name);
      ScriptState.saveToStorage();
    });
  }

  const roleInp = modal.querySelector('#emRoleInput');
  if (roleInp) {
    roleInp.addEventListener('input', () => {
      it.role = roleInp.value;
      ScriptState.saveToStorage();
    });
  }

  // Dynamic Fields
  modal.querySelectorAll('[data-fk]').forEach(ta => {
    ta.addEventListener('input', () => {
      const fk = ta.getAttribute('data-fk');
      it.fields[fk] = ta.value;
      ScriptState.saveToStorage();
    });
  });

  // Mood Palette
  wirePaletteEvents(modal, it);

  // Traits
  wireTraitsEvents(modal, it);

  // Relationships
  if (kind === 'Characters') wireRelationshipsEvents(modal, it);

  // Header Actions
  modal.querySelector('#emClose')?.addEventListener('click', closeElementModal);
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'kpzElementModal') closeElementModal();
  });

  modal.querySelector('#emDel')?.addEventListener('click', () => {
    if (confirm(`Delete this ${ELEMENT_SCHEMA[kind].label}?`)) {
      deleteElement(kind, it.id);
      closeElementModal();
      toast('Profile deleted', 'info');
    }
  });

  modal.querySelector('#emDuplicate')?.addEventListener('click', () => {
    const copy = JSON.parse(JSON.stringify(it));
    copy.name = `${it.name} (Copy)`;
    const newEl = createElement(kind, copy);
    openElementModal(kind, newEl.id);
    toast('Profile duplicated', 'ok');
  });

  modal.querySelector('#emSaveTmpl')?.addEventListener('click', () => {
    if (!ScriptState.bible.templates) ScriptState.bible.templates = {};
    if (!ScriptState.bible.templates[kind]) ScriptState.bible.templates[kind] = [];
    const tmpl = JSON.parse(JSON.stringify(it));
    delete tmpl.id;
    ScriptState.bible.templates[kind].push(tmpl);
    ScriptState.saveToStorage();
    toast('Saved as reusable template', 'ok');
    renderModalContent();
  });

  modal.querySelector('#emTemplateSelect')?.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value, 10);
    if (!Number.isNaN(idx)) {
      const tmpl = ScriptState.bible.templates[kind][idx];
      if (tmpl) {
        it.fields = JSON.parse(JSON.stringify(tmpl.fields || {}));
        if (tmpl.traits) it.traits = JSON.parse(JSON.stringify(tmpl.traits));
        if (tmpl.palette) it.palette = JSON.parse(JSON.stringify(tmpl.palette));
        ScriptState.saveToStorage();
        renderModalContent();
        toast('Applied template', 'ok');
      }
    }
  });

  // AI Profile Auto-Fill
  modal.querySelector('#emAI')?.addEventListener('click', async () => {
    await runAIFill(kind, it);
  });
}

/**
 * Mood Palette Block
 */
function renderPaletteBlock(it) {
  it.palette = it.palette && it.palette.length ? it.palette : [it.color || '#F97316', '#292524', '#FB923C'];
  return `
    <div class="em-field">
      <label class="em-l">Atmosphere Color Palette</label>
      <div class="em-hint">Key aesthetic colors that define the lighting and tone of this setting</div>
      <div class="em-pal">
        ${it.palette.map((c, idx) => `
          <label class="em-palsw" style="background:${c}">
            <input type="color" value="${c}" data-pal-idx="${idx}">
            <button class="em-palx" data-pal-del="${idx}" title="Remove color">✕</button>
          </label>
        `).join('')}
        <button class="em-paladd" id="btnAddPalDot" title="Add color dot">＋</button>
      </div>
    </div>
  `;
}

function wirePaletteEvents(modal, it) {
  modal.querySelectorAll('[data-pal-idx]').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(input.getAttribute('data-pal-idx'), 10);
      it.palette[idx] = e.target.value;
      const sw = input.closest('.em-palsw');
      if (sw) sw.style.background = e.target.value;
      it.color = it.palette[0];
      ScriptState.saveToStorage();
    });
  });

  modal.querySelectorAll('[data-pal-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = parseInt(btn.getAttribute('data-pal-del'), 10);
      if (it.palette.length > 1) {
        it.palette.splice(idx, 1);
        it.color = it.palette[0];
        ScriptState.saveToStorage();
        renderModalContent();
      }
    });
  });

  modal.querySelector('#btnAddPalDot')?.addEventListener('click', (e) => {
    e.preventDefault();
    it.palette.push('#E8743B');
    ScriptState.saveToStorage();
    renderModalContent();
  });
}

/**
 * Character Traits Block
 */
function renderTraitsBlock(it) {
  const strengths = it.traits?.strengths || [];
  const flaws = it.traits?.flaws || [];

  return `
    <div class="em-field">
      <label class="em-l">Strengths & Core Flaws</label>
      <div class="em-hint">What propels them forward · what blinds or trips them up</div>
      <div class="em-traits">
        <div class="em-traitcol">
          <div class="em-traith good">＋ Strengths / Powers</div>
          <div class="em-traitwrap" id="wrapStrengths">
            ${strengths.map((s, i) => `
              <span class="em-trait strengths">
                ${escapeHtml(s)}
                <button data-del-trait="strengths" data-i="${i}">✕</button>
              </span>
            `).join('')}
            <input class="em-traitin" data-add-trait="strengths" placeholder="Add strength + Enter…">
          </div>
        </div>

        <div class="em-traitcol">
          <div class="em-traith bad">－ Flaws & Vices</div>
          <div class="em-traitwrap" id="wrapFlaws">
            ${flaws.map((f, i) => `
              <span class="em-trait flaws">
                ${escapeHtml(f)}
                <button data-del-trait="flaws" data-i="${i}">✕</button>
              </span>
            `).join('')}
            <input class="em-traitin" data-add-trait="flaws" placeholder="Add flaw + Enter…">
          </div>
        </div>
      </div>
    </div>
  `;
}

function wireTraitsEvents(modal, it) {
  modal.querySelectorAll('[data-del-trait]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-del-trait');
      const idx = parseInt(btn.getAttribute('data-i'), 10);
      it.traits[type].splice(idx, 1);
      ScriptState.saveToStorage();
      renderModalContent();
    });
  });

  modal.querySelectorAll('[data-add-trait]').forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && inp.value.trim()) {
        e.preventDefault();
        const type = inp.getAttribute('data-add-trait');
        it.traits[type].push(inp.value.trim());
        inp.value = '';
        ScriptState.saveToStorage();
        renderModalContent();
      }
    });
  });
}

/**
 * Character Relationships Block
 */
function renderRelationshipsBlock(it) {
  const characters = getElements('Characters');
  const otherChars = characters.filter(c => c.id !== it.id);
  const outbound = it.rels || [];

  // Inbound links from other characters pointing to this character
  const inbound = characters.filter(c => c.id !== it.id && (c.rels || []).some(r => r.to === it.id) && !outbound.some(r => r.to === c.id));

  return `
    <div class="em-field">
      <label class="em-l">Cast Relationships (Two-Way Links)</label>
      <div class="em-hint">Dynamic connections, rivalries, alliances & history with other characters</div>
      <div class="em-rels">
        ${outbound.length === 0 && inbound.length === 0 ? `
          <div class="em-rel-empty">No character relationships mapped yet.</div>
        ` : ''}

        ${outbound.map((rel, idx) => {
          const target = characters.find(c => c.id === rel.to);
          if (!target) return '';
          return `
            <div class="em-rel" data-jump-char="${target.id}">
              <span class="em-rel-av" style="background:${target.color}">${getInitials(target.name)}</span>
              <span class="em-rel-nm">${escapeHtml(target.name)}</span>
              <span class="em-rel-lb">${escapeHtml(rel.label || 'Connected')}</span>
              <button class="em-rel-x" data-del-rel="${idx}" title="Remove link">✕</button>
            </div>
          `;
        }).join('')}

        ${inbound.map(target => {
          const rel = target.rels.find(r => r.to === it.id);
          return `
            <div class="em-rel ghost" data-jump-char="${target.id}">
              <span class="em-rel-av" style="background:${target.color}">${getInitials(target.name)}</span>
              <span class="em-rel-nm">${escapeHtml(target.name)}</span>
              <span class="em-rel-lb">${escapeHtml(rel.label || 'Connected')} <span class="em-rel-in">links here ↩</span></span>
              <button class="em-rel-mirror" data-mirror-rel="${target.id}">＋ Link Back</button>
            </div>
          `;
        }).join('')}
      </div>

      ${otherChars.length > 0 ? `
        <div class="em-rel-add">
          <select class="em-rel-sel" id="selRelTarget">
            ${otherChars.map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}
          </select>
          <input class="em-rel-inp" id="inpRelLabel" placeholder="e.g. Mentor & pupil, bitter rivals, hidden debt…">
          <button class="em-rel-go" id="btnAddRelBtn">＋ Add Link</button>
        </div>
      ` : ''}
    </div>
  `;
}

function wireRelationshipsEvents(modal, it) {
  modal.querySelector('#btnAddRelBtn')?.addEventListener('click', () => {
    const sel = modal.querySelector('#selRelTarget');
    const inp = modal.querySelector('#inpRelLabel');
    if (!sel || !sel.value) return;
    const to = sel.value;
    const label = inp ? inp.value.trim() : '';

    if (it.rels.some(r => r.to === to)) {
      toast('Relationship already exists', 'info');
      return;
    }

    it.rels.push({ to, label: label || 'Connected' });
    ScriptState.saveToStorage();
    renderModalContent();
    toast('Relationship linked', 'ok');
  });

  modal.querySelectorAll('[data-del-rel]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-del-rel'), 10);
      it.rels.splice(idx, 1);
      ScriptState.saveToStorage();
      renderModalContent();
    });
  });

  modal.querySelectorAll('[data-mirror-rel]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = btn.getAttribute('data-mirror-rel');
      const target = findElement('Characters', targetId);
      const incomingRel = target?.rels?.find(r => r.to === it.id);
      it.rels.push({ to: targetId, label: incomingRel?.label || 'Connected' });
      ScriptState.saveToStorage();
      renderModalContent();
      toast('Mirror link created', 'ok');
    });
  });

  modal.querySelectorAll('[data-jump-char]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const targetId = row.getAttribute('data-jump-char');
      openElementModal('Characters', targetId);
    });
  });
}

/**
 * Appears-in block linking to screenplay blocks/panels
 */
function renderAppearsInBlock(kind, it) {
  const blocks = ScriptState.blocks || [];
  const nameUpper = (it.name || '').toUpperCase();
  const matchingBlocks = blocks.filter(b => (b.text || '').toUpperCase().includes(nameUpper));

  return `
    <div class="em-field">
      <label class="em-l">Story Presence <span class="em-count">${matchingBlocks.length} mentions</span></label>
      <div class="em-hint">Scenes and panels where this ${ELEMENT_SCHEMA[kind].label.toLowerCase()} appears</div>
      <div class="em-beats">
        ${matchingBlocks.length === 0 ? `
          <div class="em-rel-empty">No script mentions yet. Write this name in screenplay action/dialogue to track appearances.</div>
        ` : matchingBlocks.slice(0, 8).map(b => `
          <div class="em-beat">
            <span class="em-beat-t">${escapeHtml(b.text.slice(0, 70))}</span>
            <span class="em-beat-w">Panel ${(b.panelIndex || 0) + 1}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * ✦ AI Auto-Draft Missing Profile Fields
 */
async function runAIFill(kind, it) {
  const schema = ELEMENT_SCHEMA[kind];
  const btn = document.getElementById('emAI');
  const origText = btn ? btn.textContent : '✦ AI Fill';

  const emptyFields = schema.fields.filter(f => f.key === 'role' ? !it.role : !it.fields[f.key]);
  if (emptyFields.length === 0) {
    toast('Profile is already fully drafted! Clear any field to redraft it.', 'info');
    return;
  }

  if (btn) {
    btn.textContent = '✦ Drafting…';
    btn.disabled = true;
  }

  // Build Context
  const known = [];
  if (it.name) known.push(`Name: ${it.name}`);
  if (it.role) known.push(`${schema.fields[0].label}: ${it.role}`);
  schema.fields.slice(1).forEach(f => {
    if (it.fields[f.key]) known.push(`${f.label}: ${it.fields[f.key]}`);
  });
  if (kind === 'Characters' && it.traits) {
    if (it.traits.strengths?.length) known.push(`Strengths: ${it.traits.strengths.join(', ')}`);
    if (it.traits.flaws?.length) known.push(`Flaws: ${it.traits.flaws.join(', ')}`);
  }

  const requestedKeys = emptyFields.map(f => `"${f.key}": "<concise 1-2 sentence description for ${f.label} (${f.hint})>"`).join(',\n    ');
  const projectTitle = (App.project && App.project.name) || 'Animation Production';

  const prompt = `You are an expert story bible supervisor and screenwriter for the production "${projectTitle}".
Flesh out this ${schema.label.toLowerCase()} profile. Be vivid, concrete, distinct, and directly useful for storyboard artists and animators.

KNOWN CONTEXT:
${known.join('\n') || '(Only name is known so far)'}

Draft ONLY the missing fields as a clean JSON object.
JSON format:
{
    ${requestedKeys}
}`;

  try {
    toast('✦ AI generating profile details…', 'info');
    const raw = await aiComplete(prompt, { json: true, temperature: 0.8 });
    let data = null;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      data = JSON.parse(match ? match[0] : raw);
    } catch (_) {
      console.warn('[BibleAI] JSON parse failed on raw output:', raw);
    }

    if (data && typeof data === 'object') {
      let filled = 0;
      emptyFields.forEach(f => {
        if (data[f.key] && typeof data[f.key] === 'string' && data[f.key].trim()) {
          if (f.key === 'role') it.role = data[f.key].trim();
          else it.fields[f.key] = data[f.key].trim();
          filled++;
        }
      });
      ScriptState.saveToStorage();
      renderModalContent();
      toast(`✦ AI drafted ${filled} profile fields!`, 'ok');
    } else {
      toast('AI returned unstructured text; please try again.', 'info');
    }
  } catch (err) {
    toast(`AI generation failed: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.textContent = origText;
      btn.disabled = false;
    }
  }
}

function getInitials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
