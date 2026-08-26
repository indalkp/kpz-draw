// src/script/script-editor.js
// Script Mode UI Component for KPZ Draw.
// Manages screenplay rendering, keyboard navigation, tab switching, and split-pane resizing.

import { ScriptState } from './script-state.js';
import { App } from '../core/state.js';
import { fitView } from '../drawing/view.js';

let _activeBlockId = null;
let _scriptContainer = null;
let _splitGrip = null;
let _mainArea = null;
let _canvasArea = null;

/**
 * Initialize Script Mode inside the application.
 */
export function initScriptMode() {
  _mainArea = document.getElementById('main');
  _canvasArea = document.getElementById('canvasArea');
  _splitGrip = document.getElementById('splitGrip');
  _scriptContainer = document.getElementById('scriptContainer');

  if (!_mainArea || !_scriptContainer) {
    console.warn('[ScriptEditor] Main or script container element not found.');
    return;
  }

  // Load stylesheet
  injectScriptStyles();

  // Initialize state with current project panels
  const panels = (App.project && App.project.panels) || [];
  ScriptState.initForProject(App.project ? App.project.name : 'default', panels);

  // Wire Topbar Mode Buttons
  wireModeSwitcher();

  // Wire Splitter Resizing (Browser Tab Split View inspired)
  wireSplitter();

  // Render initial Script UI
  renderScriptContainer();

  // Set initial mode layout
  setWorkspaceMode(ScriptState.mode || 'canvas');

  // Listen to state changes
  ScriptState.subscribe((event, data) => {
    if (event === 'init' || event === 'blockInserted' || event === 'blockDeleted') {
      renderBlocks();
    }
  });

  // Listen for active panel changes in KPZ Draw to sync script
  window.addEventListener('kpz:panel-changed', (e) => {
    const pIdx = e.detail && typeof e.detail.panelIndex === 'number' ? e.detail.panelIndex : (App.project ? App.project.activePanelIndex : 0);
    onPanelChanged(pIdx);
  });

  console.log('KPZ Draw: Script Mode initialized.');
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
 * Wire the Canvas / Both / Script mode toggle in Topbar.
 */
function wireModeSwitcher() {
  const btnCanvas = document.getElementById('btnModeCanvas');
  const btnBoth = document.getElementById('btnModeBoth');
  const btnScript = document.getElementById('btnModeScript');

  if (btnCanvas) btnCanvas.addEventListener('click', () => setWorkspaceMode('canvas'));
  if (btnBoth) btnBoth.addEventListener('click', () => setWorkspaceMode('both'));
  if (btnScript) btnScript.addEventListener('click', () => setWorkspaceMode('script'));

  // Keyboard shortcuts Alt+1 (Canvas), Alt+2 (Both), Alt+3 (Script)
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === '1') { e.preventDefault(); setWorkspaceMode('canvas'); }
      if (e.key === '2') { e.preventDefault(); setWorkspaceMode('both'); }
      if (e.key === '3') { e.preventDefault(); setWorkspaceMode('script'); }
    }
  });
}

/**
 * Set workspace layout mode: 'canvas' | 'both' | 'script'
 */
export function setWorkspaceMode(mode) {
  ScriptState.mode = mode;
  ScriptState.saveToStorage();

  if (!_mainArea) return;

  _mainArea.classList.remove('mode-canvas', 'mode-both', 'mode-script');
  _mainArea.classList.add(`mode-${mode}`);

  // Update topbar active buttons
  const btnCanvas = document.getElementById('btnModeCanvas');
  const btnBoth = document.getElementById('btnModeBoth');
  const btnScript = document.getElementById('btnModeScript');

  if (btnCanvas) btnCanvas.classList.toggle('active', mode === 'canvas');
  if (btnBoth) btnBoth.classList.toggle('active', mode === 'both');
  if (btnScript) btnScript.classList.toggle('active', mode === 'script');

  // Adjust canvas width in both mode
  if (mode === 'both') {
    applySplitRatio(ScriptState.splitRatio || 0.5);
  } else if (mode === 'canvas') {
    if (_canvasArea) _canvasArea.style.width = '';
  }

  // Refit canvas viewport smoothly
  setTimeout(() => {
    try { fitView(); } catch (_) {}
  }, 50);
}

/**
 * Draggable Splitter Implementation
 */
function wireSplitter() {
  if (!_splitGrip || !_canvasArea || !_mainArea) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  _splitGrip.addEventListener('mousedown', (e) => {
    if (ScriptState.mode !== 'both') return;
    isDragging = true;
    startX = e.clientX;
    startWidth = _canvasArea.getBoundingClientRect().width;
    _splitGrip.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const delta = e.clientX - startX;
    const mainWidth = _mainArea.getBoundingClientRect().width;
    const newWidth = Math.max(300, Math.min(mainWidth - 320, startWidth + delta));
    const ratio = newWidth / mainWidth;
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
  if (_canvasArea && ScriptState.mode === 'both') {
    const pct = (ScriptState.splitRatio * 100).toFixed(1);
    _canvasArea.style.width = `${pct}%`;
  }
}

/**
 * Render Main Script Container Framework
 */
function renderScriptContainer() {
  if (!_scriptContainer) return;

  const currentPanel = (App.project && App.project.activePanelIndex) ? App.project.activePanelIndex + 1 : 1;
  const totalPanels = (App.project && App.project.panels) ? App.project.panels.length : 1;

  _scriptContainer.innerHTML = `
    <!-- Header Toolbar -->
    <div class="script-header">
      <div class="script-header-left">
        <div class="script-tab-pills">
          <button class="script-pill-btn active" data-tab="screenplay">Screenplay</button>
          <button class="script-pill-btn" data-tab="beats">Beats</button>
          <button class="script-pill-btn" data-tab="bible">Story Bible</button>
        </div>
        <span class="script-badge" id="scriptPanelBadge">Panel ${currentPanel} / ${totalPanels}</span>
      </div>
      <div class="script-header-right">
        <button class="script-tool-btn" id="btnScopeToggle" title="Toggle between current panel scene and full story">
          ${ScriptState.viewScope === 'full' ? '📖 Full Story' : '🔗 Panel Synced'}
        </button>
        <button class="script-tool-btn" id="btnExportScript" title="Export screenplay (.fountain / .txt)">
          ⬇ Export
        </button>
      </div>
    </div>

    <!-- Sub-toolbar for quick block insertion -->
    <div class="script-toolbar">
      <button class="script-tool-btn" data-insert="scene">+ Scene</button>
      <button class="script-tool-btn" data-insert="action">+ Action</button>
      <button class="script-tool-btn" data-insert="character">+ Character</button>
      <button class="script-tool-btn" data-insert="dialogue">+ Dialogue</button>
      <button class="script-tool-btn" data-insert="parenthetical">+ (Parenthetical)</button>
      <button class="script-tool-btn" data-insert="transition">+ Transition</button>
      <div style="flex:1"></div>
      <button class="script-tool-btn primary" id="btnSyncToBoard" title="Push script dialogue to board caption">
        ⚡ Sync to Board
      </button>
    </div>

    <!-- Script Editor Body -->
    <div class="script-editor-body" id="scriptEditorBody">
      <div class="screenplay-page" id="screenplayPage">
        <!-- Rendered Blocks -->
      </div>
    </div>
  `;

  // Wire buttons inside header & toolbar
  wireScriptHeaderControls();
  renderBlocks();
}

/**
 * Wire Header & Toolbar Controls
 */
function wireScriptHeaderControls() {
  // Tab Switching
  _scriptContainer.querySelectorAll('.script-pill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      _scriptContainer.querySelectorAll('.script-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ScriptState.activeTab = btn.getAttribute('data-tab');
      renderBlocks();
    });
  });

  // Scope Toggle (Panel Synced vs Full Story)
  const btnScope = document.getElementById('btnScopeToggle');
  if (btnScope) {
    btnScope.addEventListener('click', () => {
      ScriptState.viewScope = ScriptState.viewScope === 'panel' ? 'full' : 'panel';
      btnScope.innerHTML = ScriptState.viewScope === 'full' ? '📖 Full Story' : '🔗 Panel Synced';
      renderBlocks();
    });
  }

  // Quick Insert Buttons
  _scriptContainer.querySelectorAll('[data-insert]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-insert');
      const activeIdx = App.project ? App.project.activePanelIndex : 0;
      const newBlock = ScriptState.insertBlockAfter(_activeBlockId, {
        type,
        panelIndex: activeIdx,
        text: type === 'scene' ? 'INT. LOCATION - DAY' : (type === 'character' ? 'CHARACTER' : '')
      });
      renderBlocks();
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

  // Sync to Board (Push Dialogue / Action into Storyboard Caption)
  const btnSync = document.getElementById('btnSyncToBoard');
  if (btnSync) {
    btnSync.addEventListener('click', () => {
      syncScriptToActivePanel();
    });
  }
}

/**
 * Render Screenplay Blocks inside the editor
 */
function renderBlocks() {
  const container = document.getElementById('screenplayPage');
  if (!container) return;

  const activeIdx = App.project ? App.project.activePanelIndex : 0;
  const blocks = ScriptState.getVisibleBlocks(activeIdx);

  container.innerHTML = '';

  blocks.forEach((b) => {
    const blockEl = document.createElement('div');
    blockEl.className = 'script-block';
    blockEl.setAttribute('data-id', b.id);
    blockEl.setAttribute('data-type', b.type || 'action');

    blockEl.innerHTML = `
      <div class="script-block-handle">
        <select class="script-type-select">
          <option value="scene" ${b.type === 'scene' ? 'selected' : ''}>SCENE</option>
          <option value="action" ${b.type === 'action' ? 'selected' : ''}>ACTION</option>
          <option value="character" ${b.type === 'character' ? 'selected' : ''}>CHAR</option>
          <option value="parenthetical" ${b.type === 'parenthetical' ? 'selected' : ''}>(PAR)</option>
          <option value="dialogue" ${b.type === 'dialogue' ? 'selected' : ''}>DIALOGUE</option>
          <option value="transition" ${b.type === 'transition' ? 'selected' : ''}>TRANS</option>
        </select>
      </div>
      <textarea class="script-block-input" rows="1" placeholder="${getPlaceholderForType(b.type)}">${escapeHtml(b.text || '')}</textarea>
    `;

    // Type changer select
    const select = blockEl.querySelector('.script-type-select');
    select.addEventListener('change', (e) => {
      const newType = e.target.value;
      blockEl.setAttribute('data-type', newType);
      ScriptState.updateBlock(b.id, { type: newType });
      autoResizeTextarea(textarea);
    });

    // Textarea input & keyboard flow
    const textarea = blockEl.querySelector('.script-block-input');
    autoResizeTextarea(textarea);

    textarea.addEventListener('input', () => {
      autoResizeTextarea(textarea);
      ScriptState.updateBlock(b.id, { text: textarea.value });
      // Real-time caption mirror if it's dialogue/action
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

    // Intelligent Keyboard Navigation
    textarea.addEventListener('keydown', (e) => {
      handleBlockKeydown(e, b, blockEl, textarea);
    });

    container.appendChild(blockEl);
  });
}

/**
 * Screenplay Keyboard Flow (Tab / Enter / Backspace)
 */
function handleBlockKeydown(e, block, blockEl, textarea) {
  // TAB: Cycle Type (Scene -> Action -> Character -> Dialogue -> Transition)
  if (e.key === 'Tab') {
    e.preventDefault();
    const types = ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition'];
    const nextType = types[(types.indexOf(block.type) + (e.shiftKey ? -1 : 1) + types.length) % types.length];
    blockEl.setAttribute('data-type', nextType);
    const select = blockEl.querySelector('.script-type-select');
    if (select) select.value = nextType;
    ScriptState.updateBlock(block.id, { type: nextType });
    return;
  }

  // ENTER: Smart Insert Next Block
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    let nextType = 'action';
    if (block.type === 'scene') nextType = 'action';
    else if (block.type === 'character') nextType = 'dialogue';
    else if (block.type === 'parenthetical') nextType = 'dialogue';
    else if (block.type === 'dialogue') nextType = 'action';
    else if (block.type === 'transition') nextType = 'scene';

    const activeIdx = App.project ? App.project.activePanelIndex : 0;
    const newBlock = ScriptState.insertBlockAfter(block.id, {
      type: nextType,
      panelIndex: activeIdx,
      text: ''
    });
    renderBlocks();
    focusBlock(newBlock.id);
    return;
  }

  // BACKSPACE on empty block: Delete and focus previous
  if (e.key === 'Backspace' && textarea.value === '') {
    e.preventDefault();
    const prevBlockEl = blockEl.previousElementSibling;
    ScriptState.deleteBlock(block.id);
    renderBlocks();
    if (prevBlockEl) {
      const prevId = prevBlockEl.getAttribute('data-id');
      focusBlock(prevId);
    }
  }
}

/**
 * Focus and place cursor at end of textarea for blockId.
 */
function focusBlock(blockId) {
  setTimeout(() => {
    const el = document.querySelector(`.script-block[data-id="${blockId}"] .script-block-input`);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, 20);
}

/**
 * Auto-resize textarea to fit content without scrollbars.
 */
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

/**
 * Update script view when storyboard panel changes.
 */
function onPanelChanged(panelIndex) {
  const badge = document.getElementById('scriptPanelBadge');
  const total = App.project && App.project.panels ? App.project.panels.length : 1;
  if (badge) {
    badge.textContent = `Panel ${panelIndex + 1} / ${total}`;
  }
  if (ScriptState.viewScope === 'panel') {
    renderBlocks();
  }
}

/**
 * Mirror script dialogue to KPZ Draw caption input.
 */
function mirrorToCaptionInput(text) {
  const captionInput = document.getElementById('captionInput');
  if (captionInput && App.project) {
    const activePanel = App.project.panels[App.project.activePanelIndex];
    if (activePanel) {
      activePanel.caption = text;
      captionInput.value = text;
    }
  }
}

/**
 * Explicit Sync to Storyboard Board.
 */
function syncScriptToActivePanel() {
  const activeIdx = App.project ? App.project.activePanelIndex : 0;
  const blocks = ScriptState.blocks.filter(b => b.panelIndex === activeIdx);
  const dialogueOrAction = blocks.find(b => b.type === 'dialogue') || blocks.find(b => b.type === 'action');
  if (dialogueOrAction && App.project) {
    const text = dialogueOrAction.text;
    mirrorToCaptionInput(text);
    // Show quick feedback
    const btnSync = document.getElementById('btnSyncToBoard');
    if (btnSync) {
      const orig = btnSync.innerHTML;
      btnSync.innerHTML = '✔ Synced!';
      setTimeout(() => { btnSync.innerHTML = orig; }, 1500);
    }
  }
}
