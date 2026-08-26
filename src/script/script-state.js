// src/script/script-state.js
// State management for Script Mode in KPZ Draw.
// Handles per-panel script beats, global screenplay, localStorage/IndexedDB persistence,
// and Fountain / plain text import/export.

export const ScriptState = {
  // Current active mode: 'canvas' | 'both' | 'script'
  mode: 'canvas',

  // Split ratio between Canvas and Script (0.2 to 0.8, default 0.5)
  splitRatio: 0.5,

  // Sync mode: 'panel' (show active panel's scene/beat) | 'full' (continuous screenplay)
  viewScope: 'panel',

  // Active sub-tab inside script container: 'screenplay' | 'beats' | 'bible' | 'adapt'
  activeTab: 'screenplay',

  // Script blocks array:
  // Each block: { id, panelId, type, text, character, parenthetical, notes }
  // Types: 'scene' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition'
  blocks: [],

  // Story Bible / Characters registry
  characters: [],

  // Listeners for state change
  listeners: new Set(),

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  notify(event, data) {
    for (const fn of this.listeners) {
      try { fn(event, data); } catch (e) { console.error('[ScriptState] listener error:', e); }
    }
  },

  /**
   * Initialize script state for a project.
   */
  initForProject(projectId, panels = []) {
    this.projectId = projectId || 'default';
    this.loadFromStorage();
    
    // If no blocks exist, initialize default blocks synced with existing storyboard panels
    if (this.blocks.length === 0) {
      this.scaffoldFromPanels(panels);
    }
    this.notify('init', { blocks: this.blocks });
  },

  /**
   * Scaffold default script blocks matching storyboard panels.
   */
  scaffoldFromPanels(panels = []) {
    this.blocks = [];
    if (!panels || panels.length === 0) {
      this.blocks = [
        { id: 'b_1', panelIndex: 0, type: 'scene', text: 'INT. STUDIO - DAY' },
        { id: 'b_2', panelIndex: 0, type: 'action', text: 'The artist sketches initial visual concepts on the digital canvas.' },
        { id: 'b_3', panelIndex: 0, type: 'character', text: 'ARTIST' },
        { id: 'b_4', panelIndex: 0, type: 'dialogue', text: 'Every great production begins with a strong script and clear boards.' }
      ];
      this.saveToStorage();
      return;
    }

    panels.forEach((p, idx) => {
      const panelId = p.id || `panel_${idx}`;
      const caption = p.caption || '';
      this.blocks.push({
        id: `b_${idx}_scene`,
        panelIndex: idx,
        panelId,
        type: 'scene',
        text: `SCENE ${idx + 1} - PANEL ${idx + 1}`
      });
      if (caption) {
        this.blocks.push({
          id: `b_${idx}_dialogue`,
          panelIndex: idx,
          panelId,
          type: 'action',
          text: caption
        });
      } else {
        this.blocks.push({
          id: `b_${idx}_action`,
          panelIndex: idx,
          panelId,
          type: 'action',
          text: `Visual action for panel ${idx + 1}...`
        });
      }
    });
    this.saveToStorage();
  },

  /**
   * Get blocks corresponding to a given panel index (or all if viewScope is 'full').
   */
  getVisibleBlocks(activePanelIndex = 0) {
    if (this.viewScope === 'full') {
      return this.blocks;
    }
    const filtered = this.blocks.filter(b => b.panelIndex === activePanelIndex);
    if (filtered.length === 0) {
      // Create at least a scene heading and action block for this panel
      const newScene = {
        id: `b_${activePanelIndex}_scene_${Date.now()}`,
        panelIndex: activePanelIndex,
        type: 'scene',
        text: `SCENE ${activePanelIndex + 1} - PANEL ${activePanelIndex + 1}`
      };
      const newAction = {
        id: `b_${activePanelIndex}_action_${Date.now() + 1}`,
        panelIndex: activePanelIndex,
        type: 'action',
        text: ''
      };
      this.blocks.push(newScene, newAction);
      this.saveToStorage();
      return [newScene, newAction];
    }
    return filtered;
  },

  /**
   * Update a specific block's text or type.
   */
  updateBlock(id, updates = {}) {
    const idx = this.blocks.findIndex(b => b.id === id);
    if (idx !== -1) {
      this.blocks[idx] = { ...this.blocks[idx], ...updates };
      this.saveToStorage();
      this.notify('blockUpdated', { block: this.blocks[idx] });
    }
  },

  /**
   * Add a new block after targetId.
   */
  insertBlockAfter(targetId, newBlock = {}) {
    const idx = this.blocks.findIndex(b => b.id === targetId);
    const block = {
      id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      panelIndex: 0,
      type: 'action',
      text: '',
      ...newBlock
    };
    if (idx !== -1) {
      block.panelIndex = this.blocks[idx].panelIndex;
      this.blocks.splice(idx + 1, 0, block);
    } else {
      this.blocks.push(block);
    }
    this.saveToStorage();
    this.notify('blockInserted', { block, index: idx + 1 });
    return block;
  },

  /**
   * Delete a block.
   */
  deleteBlock(id) {
    if (this.blocks.length <= 1) return; // Keep at least one block
    const idx = this.blocks.findIndex(b => b.id === id);
    if (idx !== -1) {
      const deleted = this.blocks.splice(idx, 1)[0];
      this.saveToStorage();
      this.notify('blockDeleted', { id, deleted, index: idx });
    }
  },

  /**
   * Storage persistence (IndexedDB + LocalStorage backup).
   */
  saveToStorage() {
    try {
      const key = `kpz_script_${this.projectId || 'active'}`;
      localStorage.setItem(key, JSON.stringify({
        blocks: this.blocks,
        characters: this.characters,
        splitRatio: this.splitRatio,
        mode: this.mode,
        updatedAt: Date.now()
      }));
    } catch (e) {
      console.warn('[ScriptState] Storage save failed:', e);
    }
  },

  loadFromStorage() {
    try {
      const key = `kpz_script_${this.projectId || 'active'}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.blocks)) this.blocks = data.blocks;
        if (Array.isArray(data.characters)) this.characters = data.characters;
        if (typeof data.splitRatio === 'number') this.splitRatio = data.splitRatio;
        if (data.mode) this.mode = data.mode;
      }
    } catch (e) {
      console.warn('[ScriptState] Storage load failed:', e);
    }
  },

  /**
   * Export to Fountain format screenplay text.
   */
  exportFountain() {
    let out = '';
    for (const b of this.blocks) {
      const txt = (b.text || '').trim();
      if (!txt) continue;
      switch (b.type) {
        case 'scene':
          out += `\n${txt.toUpperCase()}\n\n`;
          break;
        case 'character':
          out += `\n\n${txt.toUpperCase()}\n`;
          break;
        case 'dialogue':
          out += `${txt}\n`;
          break;
        case 'parenthetical':
          out += `(${txt.replace(/^\(|\)$/g, '')})\n`;
          break;
        case 'transition':
          out += `\n> ${txt.toUpperCase()}\n\n`;
          break;
        case 'action':
        default:
          out += `${txt}\n\n`;
          break;
      }
    }
    return out.trim();
  }
};
