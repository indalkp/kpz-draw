// src/script/script-editor.js
// Script Mode UI Component for KPZ Draw.
// Manages Draw/Script/Split workspace modes, screenplay editing, beats view, story bible, and board synchronization.

import { ScriptState } from './script-state.js';
import { App } from '../core/state.js';
import { fitView } from '../drawing/view.js';

let _activeBlockId = null;
let _scriptContainer = null;
let _splitGrip = null;
let _appRoot = null;
let _canvasWrap = null;

/**
 * Initialize Script Mode inside the application.
 */
export function initScriptMode() {
  _appRoot = document.getElementById('app') || document.body;
  _scriptContainer = document.getElementById('scriptContainer');
  _splitGrip = document.getElementById('splitGrip');
  _canvasWrap = document.getElementById('canvasWrap');

  if (!_scriptContainer) {
    console.warn('[ScriptEditor] Script container element not found.');
    return;
  }

  // Load stylesheet
  injectScriptStyles();

  // Initialize state with current project panels
  const panels = (App.project && App.project.panels) || [];
  ScriptState.initForProject(App.project ? App.project.name : 'default', panels);

  // Wire Topbar Mode Buttons
  wireModeSwitcher();

  // Wire Splitter Resizing
  wireSplitter();

  // Render initial Script UI Shell
  renderScriptContainer();

  // Set initial workspace mode
  setWorkspaceMode(ScriptState.mode || 'draw');

  // Listen to state changes
  ScriptState.subscribe((event) => {
    if (event === 'init' || event === 'blockInserted' || event === 'blockDeleted') {
      renderActiveView();
    }
  });

  // Listen for active panel changes in KPZ Draw to sync script
  window.addEventListener('kpz:panel-changed', (e) => {
    const pIdx = e.detail && typeof e.detail.panelIndex === 'number'
      ? e.detail.panelIndex
      : (App.activePanelIdx || 0);
    onPanelChanged(pIdx);
  });

  console.log('KPZ Draw: Script Mode initialized cleanly.');
}

/**
 * Dynamically inject script stylesheet.
 */
function injectScriptStyles() {
  if (document.getElementById('kpz-script-styles')) return;
  const link = document.createElement('link');
  link.id = 'kpz-script-styles';
  link.rel = 'stylesheet';
  link.href = './src/script/script.css';
  document.head.appendChild(link);
}

/**
 * Wire Mode Buttons in Topbar (Draw / Script / Split View).
 */
function wireModeSwitcher() {
  const btnDraw = document.getElementById('btnModeDraw');
  const btnScript = document.getElementById('btnModeScript');
  const btnSplit = document.getElementById('btnSplitToggle');

  if (btnDraw) btnDraw.addEventListener('click', () => setWorkspaceMode('draw'));
  if (btnScript) btnScript.addEventListener('click', () => setWorkspaceMode('script'));
  if (btnSplit) btnSplit.addEventListener('click', () => {
    // Toggle split mode: if already split, toggle back to draw (or script)
    if (ScriptState.mode === 'split') {
      setWorkspaceMode('draw');
    } else {
      setWorkspaceMode('split');
    }
  });

  // Keyboard shortcuts: Alt+1 (Draw), Alt+2 (Script), Alt+S (Split View)
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === '1') { e.preventDefault(); setWorkspaceMode('draw'); }
      if (e.key === '2') { e.preventDefault(); setWorkspaceMode('script'); }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setWorkspaceMode(ScriptState.mode === 'split' ? 'draw' : 'split');
      }
    }
  });
}

/**
 * Set workspace layout mode: 'draw' | 'script' | 'split'
 */
export function setWorkspaceMode(mode) {
  ScriptState.mode = mode;
  ScriptState.saveToStorage();

  if (!_appRoot) return;

  _appRoot.classList.remove('mode-draw', 'mode-script', 'mode-split');
  _appRoot.classList.add(`mode-${mode}`);

  // Update topbar active buttons
  const btnDraw = document.getElementById('btnModeDraw');
  const btnScript = document.getElementById('btnModeScript');
  const btnSplit = document.getElementById('btnSplitToggle');

  if (btnDraw) btnDraw.classList.toggle('active', mode === 'draw');
  if (btnScript) btnScript.classList.toggle('active', mode === 'script');
  if (btnSplit) btnSplit.classList.toggle('active', mode === 'split');

  // Trigger fitView immediately and on next frame after layout settles
  try { fitView(); } catch (_) {}
  requestAnimationFrame(() => {
    try { fitView(); } catch (_) {}
    setTimeout(() => {
      try { fitView(); } catch (_) {}
    }, 50);
  });
}

/**
 * Draggable Splitter Implementation
 */
function wireSplitter() {
  if (!_splitGrip || !_appRoot) return;

  let isDragging = false;
  let startX = 0;
  let startRatio = 0.5;

  _splitGrip.addEventListener('mousedown', (e) => {
    if (ScriptState.mode !== 'split') return;
    isDragging = true;
    startX = e.clientX;
    startRatio = ScriptState.splitRatio || 0.5;
    _splitGrip.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const splitWrap = document.getElementById('workspaceSplitWrap');
    if (!splitWrap) return;
    const rect = splitWrap.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const ratio = Math.max(0.2, Math.min(0.8, currentX / rect.width));
    applySplitRatio(ratio);
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      _splitGrip.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { fitView(); } catch (_) {}
    }
  });

  // Double-click splitter to reset to 50/50 balance
  _splitGrip.addEventListener('dblclick', () => {
    applySplitRatio(0.5);
    try { fitView(); } catch (_) {}
  });
}

function applySplitRatio(ratio) {
  ScriptState.splitRatio = Math.max(0.2, Math.min(0.8, ratio));
  ScriptState.saveToStorage();
  const pct = (ScriptState.splitRatio * 100).toFixed(1);
  if (_appRoot) {
    _appRoot.style.setProperty('--sm-split-ratio', `${pct}%`);
  }
}

/**
 * Render Main Script Container Framework
 */
function renderScriptContainer() {
  if (!_scriptContainer) return;

  const currentPanel = (App.project && typeof App.activePanelIdx === 'number')
    ? App.activePanelIdx + 1
    : 1;
  const totalPanels = (App.project && App.project.panels) ? App.project.panels.length : 1;

  _scriptContainer.innerHTML = `
    <!-- Top Header -->
    <div class="sm-header">
      <div class="sm-header-left">
        <div class="sm-view-tabs">
          <button class="sm-view-tab ${ScriptState.activeTab === 'screenplay' ? 'active' : ''}" data-view="screenplay">
            📝 Screenplay
          </button>
          <button class="sm-view-tab ${ScriptState.activeTab === 'beats' ? 'active' : ''}" data-view="beats">
            ☰ Beats
          </button>
          <button class="sm-view-tab ${ScriptState.activeTab === 'bible' ? 'active' : ''}" data-view="bible">
            📖 Bible
          </button>
        </div>
        <span class="sm-badge" id="smPanelBadge">Panel ${currentPanel} / ${totalPanels}</span>
      </div>
      <div class="sm-header-right">
        <button class="sm-btn" id="btnScopeToggle" title="Toggle between current panel scene and full story">
          ${ScriptState.viewScope === 'full' ? '📖 Full Story' : '🔗 Panel Synced'}
        </button>
        <button class="sm-btn" id="btnExportScript" title="Export screenplay (.fountain / .txt)">
          ⬇ Export
        </button>
      </div>
    </div>

    <!-- Quick Insertion Sub-toolbar (Only for Screenplay) -->
    <div class="sm-toolbar" id="smScreenplayToolbar">
      <button class="sm-insert-btn" data-insert="scene">+ Scene</button>
      <button class="sm-insert-btn" data-insert="action">+ Action</button>
      <button class="sm-insert-btn" data-insert="character">+ Character</button>
      <button class="sm-insert-btn" data-insert="dialogue">+ Dialogue</button>
      <button class="sm-insert-btn" data-insert="parenthetical">+ (Parenthetical)</button>
      <button class="sm-insert-btn" data-insert="transition">+ Transition</button>
      <div style="flex:1"></div>
      <button class="sm-btn primary" id="btnSyncToBoard" title="Push script dialogue to storyboard caption">
        ⚡ Sync to Board
      </button>
    </div>

    <!-- Main Content Area -->
    <div class="sm-content-area" id="smContentArea"></div>
  `;

  // Wire controls
  wireScriptHeaderControls();
  renderActiveView();
}

/**
 * Wire Header & Toolbar Controls
 */
function wireScriptHeaderControls() {
  // Tab Switching
  _scriptContainer.querySelectorAll('.sm-view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _scriptContainer.querySelectorAll('.sm-view-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ScriptState.activeTab = btn.getAttribute('data-view');
      renderActiveView();
    });
  });

  // Scope Toggle (Panel Synced vs Full Story)
  const btnScope = document.getElementById('btnScopeToggle');
  if (btnScope) {
    btnScope.addEventListener('click', () => {
      ScriptState.viewScope = ScriptState.viewScope === 'panel' ? 'full' : 'panel';
      btnScope.innerHTML = ScriptState.viewScope === 'full' ? '📖 Full Story' : '🔗 Panel Synced';
      renderActiveView();
    });
  }

  // Quick Insert Buttons
  _scriptContainer.querySelectorAll('[data-insert]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-insert');
      const activeIdx = (App.project && typeof App.activePanelIdx === 'number') ? App.activePanelIdx : 0;
      const newBlock = ScriptState.insertBlockAfter(_activeBlockId, {
        type,
        panelIndex: activeIdx,
        text: type === 'scene' ? 'INT. LOCATION - DAY' : (type === 'character' ? 'CHARACTER' : '')
      });
      renderActiveView();
      focusBlock(newBlock.id);
    });
  });

  // Export Screenplay (.fountain)
  const btnExport = document.getElementById('btnExportScript');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const fountainText = ScriptState.exportFountain();
      const blob = new Blob([fountainText], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(App.project && App.project.name) || 'screenplay'}.fountain`;
      a.click();
    });
  }

  // Sync to Board
  const btnSync = document.getElementById('btnSyncToBoard');
  if (btnSync) {
    btnSync.addEventListener('click', () => {
      syncScriptToActivePanel();
    });
  }
}

/**
 * Render the currently selected tab view (Screenplay, Beats, Bible).
 */
function renderActiveView() {
  const contentArea = document.getElementById('smContentArea');
  const toolbar = document.getElementById('smScreenplayToolbar');
  if (!contentArea) return;

  if (toolbar) {
    toolbar.style.display = ScriptState.activeTab === 'screenplay' ? 'flex' : 'none';
  }

  if (ScriptState.activeTab === 'screenplay') {
    renderScreenplayView(contentArea);
  } else if (ScriptState.activeTab === 'beats') {
    renderBeatsView(contentArea);
  } else if (ScriptState.activeTab === 'bible') {
    renderBibleView(contentArea);
  }
}

/**
 * Render Screenplay View
 */
function renderScreenplayView(contentArea) {
  contentArea.innerHTML = `
    <div class="sm-screenplay-wrap">
      <div class="sm-screenplay-page" id="smScreenplayPage"></div>
    </div>
  `;

  const container = document.getElementById('smScreenplayPage');
  if (!container) return;

  const activeIdx = (App.project && typeof App.activePanelIdx === 'number') ? App.activePanelIdx : 0;
  const blocks = ScriptState.getVisibleBlocks(activeIdx);

  container.innerHTML = '';

  blocks.forEach((b) => {
    const blockEl = document.createElement('div');
    blockEl.className = 'sm-block';
    blockEl.setAttribute('data-id', b.id);
    blockEl.setAttribute('data-type', b.type || 'action');

    blockEl.innerHTML = `
      <div class="sm-block-handle">
        <select class="sm-block-type-select">
          <option value="scene" ${b.type === 'scene' ? 'selected' : ''}>SCENE</option>
          <option value="action" ${b.type === 'action' ? 'selected' : ''}>ACTION</option>
          <option value="character" ${b.type === 'character' ? 'selected' : ''}>CHAR</option>
          <option value="parenthetical" ${b.type === 'parenthetical' ? 'selected' : ''}>(PAR)</option>
          <option value="dialogue" ${b.type === 'dialogue' ? 'selected' : ''}>DIALOGUE</option>
          <option value="transition" ${b.type === 'transition' ? 'selected' : ''}>TRANS</option>
        </select>
      </div>
      <textarea class="sm-block-input" rows="1" placeholder="${getPlaceholderForType(b.type)}">${escapeHtml(b.text || '')}</textarea>
    `;

    // Type changer select
    const select = blockEl.querySelector('.sm-block-type-select');
    select.addEventListener('change', (e) => {
      const newType = e.target.value;
      blockEl.setAttribute('data-type', newType);
      ScriptState.updateBlock(b.id, { type: newType });
      autoResizeTextarea(textarea);
    });

    // Textarea input & keyboard flow
    const textarea = blockEl.querySelector('.sm-block-input');
    autoResizeTextarea(textarea);

    textarea.addEventListener('input', () => {
      autoResizeTextarea(textarea);
      ScriptState.updateBlock(b.id, { text: textarea.value });
      if (b.type === 'dialogue' || b.type === 'action') {
        mirrorToCaptionInput(textarea.value);
      }
    });

    textarea.addEventListener('focus', () => {
      _activeBlockId = b.id;
      blockEl.classList.add('focused');
    });

    textarea.addEventListener('blur', () => {
      blockEl.classList.remove('focused');
    });

    // Keyboard Flow
    textarea.addEventListener('keydown', (e) => {
      handleBlockKeydown(e, b, blockEl, textarea);
    });

    container.appendChild(blockEl);
  });

  // Batch auto-resize all textareas once in DOM layout
  requestAnimationFrame(() => {
    container.querySelectorAll('.sm-block-input').forEach(autoResizeTextarea);
  });
}

/**
 * Screenplay Keyboard Flow (Tab / Enter / Backspace)
 */
function handleBlockKeydown(e, block, blockEl, textarea) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const types = ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition'];
    const nextType = types[(types.indexOf(block.type) + (e.shiftKey ? -1 : 1) + types.length) % types.length];
    blockEl.setAttribute('data-type', nextType);
    const select = blockEl.querySelector('.sm-block-type-select');
    if (select) select.value = nextType;
    ScriptState.updateBlock(block.id, { type: nextType });
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    let nextType = 'action';
    if (block.type === 'scene') nextType = 'action';
    else if (block.type === 'character') nextType = 'dialogue';
    else if (block.type === 'parenthetical') nextType = 'dialogue';
    else if (block.type === 'dialogue') nextType = 'action';
    else if (block.type === 'transition') nextType = 'scene';

    const activeIdx = (App.project && typeof App.activePanelIdx === 'number') ? App.activePanelIdx : 0;
    const newBlock = ScriptState.insertBlockAfter(block.id, {
      type: nextType,
      panelIndex: activeIdx,
      text: ''
    });
    renderActiveView();
    focusBlock(newBlock.id);
    return;
  }

  if (e.key === 'Backspace' && textarea.value === '') {
    e.preventDefault();
    const prevBlockEl = blockEl.previousElementSibling;
    ScriptState.deleteBlock(block.id);
    renderActiveView();
    if (prevBlockEl) {
      const prevId = prevBlockEl.getAttribute('data-id');
      focusBlock(prevId);
    }
  }
}

/**
 * Render Beats / Visual Cards View
 */
function renderBeatsView(contentArea) {
  const panels = (App.project && App.project.panels) || [];
  let html = '<div class="sm-beats-wrap">';

  panels.forEach((p, idx) => {
    const sceneBlocks = ScriptState.blocks.filter(b => b.panelIndex === idx);
    const sceneHeading = sceneBlocks.find(b => b.type === 'scene')?.text || `SCENE ${idx + 1}`;
    const dialogueOrAction = sceneBlocks.find(b => b.type === 'dialogue')?.text || sceneBlocks.find(b => b.type === 'action')?.text || p.caption || 'No action/dialogue yet';

    html += `
      <div class="sm-beat-card" data-idx="${idx}">
        <div class="sm-beat-header">
          <span>PANEL ${idx + 1}</span>
          <span style="color:var(--sm-text-dim)">#${idx + 1}</span>
        </div>
        <div class="sm-beat-title">${escapeHtml(sceneHeading)}</div>
        <div class="sm-beat-desc">${escapeHtml(dialogueOrAction)}</div>
      </div>
    `;
  });

  html += '</div>';
  contentArea.innerHTML = html;

  contentArea.querySelectorAll('.sm-beat-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.getAttribute('data-idx'), 10);
      if (typeof idx === 'number' && App.project) {
        import('../ui/panel-nav.js').then(({ switchPanel }) => switchPanel(idx));
      }
    });
  });
}

/**
 * Render Story Bible View
 */
function renderBibleView(contentArea) {
  contentArea.innerHTML = `
    <div class="sm-bible-wrap">
      <div class="sm-bible-section">
        <div class="sm-bible-h">
          <span>👥 Characters & Cast</span>
          <button class="sm-btn" id="btnAddChar">+ Add Character</button>
        </div>
        <div id="smCharList" style="display:flex;flex-direction:column;gap:8px">
          ${renderCharactersHtml()}
        </div>
      </div>

      <div class="sm-bible-section">
        <div class="sm-bible-h">
          <span>🗺 World & Locations</span>
        </div>
        <textarea class="sm-block-input" rows="4" placeholder="Describe world rules, environment, recurring visual motifs..." style="background:var(--sm-surface-2);padding:10px;border-radius:6px;border:1px solid var(--sm-border)"></textarea>
      </div>
    </div>
  `;

  const btnAddChar = document.getElementById('btnAddChar');
  if (btnAddChar) {
    btnAddChar.addEventListener('click', () => {
      const name = prompt('Character Name:');
      if (name && name.trim()) {
        ScriptState.characters.push({ name: name.trim(), role: 'Lead / Supporting', bio: '' });
        ScriptState.saveToStorage();
        renderActiveView();
      }
    });
  }
}

function renderCharactersHtml() {
  if (!ScriptState.characters || ScriptState.characters.length === 0) {
    return `<div style="color:var(--sm-text-dim);font-size:12px">No characters added yet. Click + Add Character above.</div>`;
  }
  return ScriptState.characters.map((c, i) => `
    <div style="background:var(--sm-surface-2);border:1px solid var(--sm-border);padding:8px 12px;border-radius:6px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <strong style="color:var(--sm-accent)">${escapeHtml(c.name)}</strong>
        <span style="color:var(--sm-text-muted);font-size:11px;margin-left:8px">${escapeHtml(c.role || '')}</span>
      </div>
      <button class="sm-btn" data-del-char="${i}" style="padding:2px 6px;color:var(--danger)">×</button>
    </div>
  `).join('');
}

function focusBlock(blockId) {
  setTimeout(() => {
    const el = document.querySelector(`.sm-block[data-id="${blockId}"] .sm-block-input`);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, 20);
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(24, textarea.scrollHeight)}px`;
}

function getPlaceholderForType(type) {
  switch (type) {
    case 'scene': return 'INT./EXT. LOCATION - DAY';
    case 'character': return 'CHARACTER NAME';
    case 'parenthetical': return '(wryly)';
    case 'dialogue': return 'Dialogue line…';
    case 'transition': return 'CUT TO:';
    case 'action':
    default: return 'Action / visual description…';
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function onPanelChanged(panelIndex) {
  const badge = document.getElementById('smPanelBadge');
  const total = App.project && App.project.panels ? App.project.panels.length : 1;
  if (badge) {
    badge.textContent = `Panel ${panelIndex + 1} / ${total}`;
  }
  if (ScriptState.viewScope === 'panel') {
    renderActiveView();
  }
}

function mirrorToCaptionInput(text) {
  const captionInput = document.getElementById('captionInput');
  if (captionInput && App.project) {
    const activePanel = App.project.panels[App.activePanelIdx];
    if (activePanel) {
      activePanel.caption = text;
      captionInput.value = text;
    }
  }
}

function syncScriptToActivePanel() {
  const activeIdx = (App.project && typeof App.activePanelIdx === 'number') ? App.activePanelIdx : 0;
  const blocks = ScriptState.blocks.filter(b => b.panelIndex === activeIdx);
  const dialogueOrAction = blocks.find(b => b.type === 'dialogue') || blocks.find(b => b.type === 'action');
  if (dialogueOrAction && App.project) {
    const text = dialogueOrAction.text;
    mirrorToCaptionInput(text);
    const btnSync = document.getElementById('btnSyncToBoard');
    if (btnSync) {
      const orig = btnSync.innerHTML;
      btnSync.innerHTML = '✔ Synced!';
      setTimeout(() => { btnSync.innerHTML = orig; }, 1500);
    }
  }
}
