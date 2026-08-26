// src/script/script-editor.js
// Script Mode UI Component for KPZ Draw.
// Manages Screenplay, Beats, Story Bible, Idea Inbox & AI Writing Layer, and Storyboard sync.

import { ScriptState } from './script-state.js';
import { App } from '../core/state.js';
import { fitView } from '../drawing/view.js';
import { InboxState, aiDevelopIdea, aiContinueDialogue, aiPolishAction } from './script-inbox.js';
import { AIConfig, testConnection } from './script-ai.js';
import { renderBibleOverview } from './script-bible.js';
import { renderBoardView } from './script-board.js';
import { toggleStoryPathDrawer } from './script-guide.js';
import { openPromptLibraryModal } from './script-prompts.js';
import { toast } from '../ui/toast.js';

let _activeBlockId = null;
let _scriptContainer = null;
let _splitGrip = null;
let _appRoot = null;

/**
 * Initialize Script Mode inside the application.
 */
export function initScriptMode() {
  _appRoot = document.getElementById('app') || document.body;
  _scriptContainer = document.getElementById('scriptContainer');
  _splitGrip = document.getElementById('splitGrip');

  if (!_scriptContainer) {
    console.warn('[ScriptEditor] Script container element not found.');
    return;
  }

  injectScriptStyles();

  const panels = (App.project && App.project.panels) || [];
  ScriptState.initForProject(App.project ? App.project.name : 'default', panels);

  wireModeSwitcher();
  wireSplitter();
  renderScriptContainer();
  setWorkspaceMode(ScriptState.mode || 'draw');

  ScriptState.subscribe((event) => {
    if (event === 'init' || event === 'blockInserted' || event === 'blockDeleted') {
      renderActiveView();
    }
  });

  window.addEventListener('kpz:panel-changed', (e) => {
    const pIdx = e.detail && typeof e.detail.panelIndex === 'number'
      ? e.detail.panelIndex
      : (App.activePanelIdx || 0);
    onPanelChanged(pIdx);
  });
}

function injectScriptStyles() {
  if (document.getElementById('kpz-script-styles')) return;
  const link = document.createElement('link');
  link.id = 'kpz-script-styles';
  link.rel = 'stylesheet';
  link.href = './src/script/script.css';
  document.head.appendChild(link);
}

function wireModeSwitcher() {
  const btnDraw = document.getElementById('btnModeDraw');
  const btnScript = document.getElementById('btnModeScript');
  const btnSplit = document.getElementById('btnSplitToggle');

  if (btnDraw) btnDraw.addEventListener('click', () => setWorkspaceMode('draw'));
  if (btnScript) btnScript.addEventListener('click', () => setWorkspaceMode('script'));
  if (btnSplit) btnSplit.addEventListener('click', () => {
    setWorkspaceMode(ScriptState.mode === 'split' ? 'draw' : 'split');
  });

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

export function setWorkspaceMode(mode) {
  ScriptState.mode = mode;
  ScriptState.saveToStorage();

  if (!_appRoot) return;

  _appRoot.classList.remove('mode-draw', 'mode-script', 'mode-split');
  _appRoot.classList.add(`mode-${mode}`);

  const btnDraw = document.getElementById('btnModeDraw');
  const btnScript = document.getElementById('btnModeScript');
  const btnSplit = document.getElementById('btnSplitToggle');

  if (btnDraw) btnDraw.classList.toggle('active', mode === 'draw');
  if (btnScript) btnScript.classList.toggle('active', mode === 'script');
  if (btnSplit) btnSplit.classList.toggle('active', mode === 'split');

  try { fitView(); } catch (_) {}
  requestAnimationFrame(() => {
    try { fitView(); } catch (_) {}
    setTimeout(() => {
      try { fitView(); } catch (_) {}
    }, 50);
  });
}

function wireSplitter() {
  if (!_splitGrip || !_appRoot) return;

  let isDragging = false;

  _splitGrip.addEventListener('mousedown', (e) => {
    if (ScriptState.mode !== 'split') return;
    isDragging = true;
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
          <button class="sm-view-tab ${ScriptState.activeTab === 'inbox' ? 'active' : ''}" data-view="inbox">
            ✦ Inbox & AI
          </button>
        </div>
        <span class="sm-badge" id="smPanelBadge">Panel ${currentPanel} / ${totalPanels}</span>
      </div>
      <div class="sm-header-right">
        <button class="sm-btn" id="btnOpenStoryPath" title="7-Phase guided story roadmap">
          ⛰ Story Path
        </button>
        <button class="sm-btn" id="btnOpenPromptLibrary" title="AI Prompt Collection & Writing Copilot">
          ✦ Prompts
        </button>
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
      <button class="sm-btn" id="btnAIContinue" title="AI auto-continues the active scene dialogue">
        ✦ AI Continue
      </button>
      <button class="sm-btn" id="btnAIPolish" title="AI tightens and polishes the focused action line">
        ✦ AI Polish
      </button>
      <button class="sm-btn primary" id="btnSyncToBoard" title="Push script dialogue to storyboard caption">
        ⚡ Sync to Board
      </button>
    </div>

    <!-- Main Content Area -->
    <div class="sm-content-area" id="smContentArea"></div>
  `;

  wireScriptHeaderControls();
  renderActiveView();
}

function wireScriptHeaderControls() {
  _scriptContainer.querySelectorAll('.sm-view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _scriptContainer.querySelectorAll('.sm-view-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ScriptState.activeTab = btn.getAttribute('data-view');
      renderActiveView();
    });
  });

  const btnStoryPath = document.getElementById('btnOpenStoryPath');
  if (btnStoryPath) {
    btnStoryPath.addEventListener('click', () => toggleStoryPathDrawer());
  }

  const btnPromptLib = document.getElementById('btnOpenPromptLibrary');
  if (btnPromptLib) {
    btnPromptLib.addEventListener('click', () => openPromptLibraryModal());
  }

  const btnScope = document.getElementById('btnScopeToggle');
  if (btnScope) {
    btnScope.addEventListener('click', () => {
      ScriptState.viewScope = ScriptState.viewScope === 'panel' ? 'full' : 'panel';
      btnScope.innerHTML = ScriptState.viewScope === 'full' ? '📖 Full Story' : '🔗 Panel Synced';
      renderActiveView();
    });
  }

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

  // AI Continue button
  document.getElementById('btnAIContinue')?.addEventListener('click', async () => {
    const activeIdx = (App.project && typeof App.activePanelIdx === 'number') ? App.activePanelIdx : 0;
    const blocks = ScriptState.getVisibleBlocks(activeIdx);
    const context = blocks.map(b => `${b.type.toUpperCase()}: ${b.text}`).join('\n');
    toast('✦ AI drafting continuation…', 'info');
    try {
      const completion = await aiContinueDialogue(context);
      if (completion) {
        ScriptState.insertBlockAfter(_activeBlockId, {
          type: 'dialogue',
          panelIndex: activeIdx,
          text: completion
        });
        renderActiveView();
        toast('✦ Scene continued!', 'ok');
      }
    } catch (err) {
      toast(`AI failed: ${err.message}`, 'error');
    }
  });

  // AI Polish button
  document.getElementById('btnAIPolish')?.addEventListener('click', async () => {
    if (!_activeBlockId) { toast('Click an action block to polish first.', 'info'); return; }
    const block = ScriptState.blocks.find(b => b.id === _activeBlockId);
    if (!block || !block.text) return;
    toast('✦ Polishing line…', 'info');
    try {
      const polished = await aiPolishAction(block.text);
      if (polished) {
        ScriptState.updateBlock(_activeBlockId, { text: polished });
        renderActiveView();
        toast('✦ Line polished!', 'ok');
      }
    } catch (err) {
      toast(`AI failed: ${err.message}`, 'error');
    }
  });

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

  const btnSync = document.getElementById('btnSyncToBoard');
  if (btnSync) {
    btnSync.addEventListener('click', () => {
      syncScriptToActivePanel();
    });
  }
}

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
  } else if (ScriptState.activeTab === 'inbox') {
    renderInboxView(contentArea);
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

    const select = blockEl.querySelector('.sm-block-type-select');
    select.addEventListener('change', (e) => {
      const newType = e.target.value;
      blockEl.setAttribute('data-type', newType);
      ScriptState.updateBlock(b.id, { type: newType });
      autoResizeTextarea(textarea);
    });

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

    textarea.addEventListener('keydown', (e) => {
      handleBlockKeydown(e, b, blockEl, textarea);
    });

    container.appendChild(blockEl);
  });

  requestAnimationFrame(() => {
    container.querySelectorAll('.sm-block-input').forEach(autoResizeTextarea);
  });
}

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
 * Render Beats / Visual Cards View (Multi-Lane Kanban, Mind Map, Story Arc)
 */
function renderBeatsView(contentArea) {
  renderBoardView(contentArea);
}

/**
 * Render Story Bible View
 */
function renderBibleView(contentArea) {
  renderBibleOverview(contentArea);
}

/**
 * Render Idea Inbox & AI Layer View
 */
function renderInboxView(contentArea) {
  contentArea.innerHTML = `
    <div class="sm-inbox-wrap">
      <!-- Top Capture Box -->
      <div class="sm-inbox-capture">
        <div style="font-weight:600;font-size:13px;color:var(--sm-accent)">💡 Idea Inbox & AI Story Engine</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <textarea class="sm-inbox-input" id="inboxIdeaInput" rows="2" placeholder="Capture a premise, scene twist, raw dialogue, or paste transcript..."></textarea>
          <button class="sm-btn primary" id="btnAddIdeaBtn" style="align-self:flex-end;padding:8px 16px">
            ＋ Add Idea
          </button>
        </div>
      </div>

      <!-- AI Provider Settings Bar -->
      <div class="sm-ai-bar">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;font-weight:600;color:var(--sm-text-muted)">AI ENGINE:</span>
          <select id="aiProviderSelect" class="sm-block-type-select" style="font-size:11px;padding:3px 6px">
            <option value="groq" ${AIConfig.provider === 'groq' ? 'selected' : ''}>Groq Cloud</option>
            <option value="ollama" ${AIConfig.provider === 'ollama' ? 'selected' : ''}>Ollama Local (Offline)</option>
          </select>
          <button class="sm-btn" id="btnConfigAIKey" title="Configure Groq API Key or Ollama URL">⚙ Settings</button>
        </div>
        <button class="sm-btn" id="btnTestAIPing">✦ Test Ping</button>
      </div>

      <!-- Ideas List -->
      <div class="sm-ideas-grid" id="ideasGrid">
        ${renderIdeasListHtml()}
      </div>
    </div>
  `;

  document.getElementById('btnAddIdeaBtn')?.addEventListener('click', () => {
    const input = document.getElementById('inboxIdeaInput');
    if (input && input.value.trim()) {
      InboxState.addIdea(input.value.trim());
      input.value = '';
      renderActiveView();
      toast('Idea added to inbox', 'ok');
    }
  });

  document.getElementById('aiProviderSelect')?.addEventListener('change', (e) => {
    AIConfig.provider = e.target.value;
    AIConfig.save();
    toast(`AI Provider set to ${AIConfig.provider}`, 'info');
  });

  document.getElementById('btnConfigAIKey')?.addEventListener('click', () => {
    if (AIConfig.provider === 'groq') {
      const key = prompt('Enter your Groq API Key (from console.groq.com):', AIConfig.groqKey || '');
      if (key !== null) {
        AIConfig.groqKey = key.trim();
        AIConfig.save();
        toast('Groq API Key saved!', 'ok');
      }
    } else {
      const url = prompt('Enter Ollama URL:', AIConfig.ollamaUrl || 'http://localhost:11434');
      if (url !== null) {
        AIConfig.ollamaUrl = url.trim();
        AIConfig.save();
        toast('Ollama URL saved!', 'ok');
      }
    }
  });

  document.getElementById('btnTestAIPing')?.addEventListener('click', async () => {
    toast('Testing AI engine connection…', 'info');
    const res = await testConnection(AIConfig.provider);
    if (res.ok) {
      toast(`✔ AI Engine Ready (${AIConfig.provider})`, 'ok');
    } else {
      toast(`AI Error: ${res.error}`, 'error');
    }
  });

  // Wire AI Develop buttons on idea cards
  contentArea.querySelectorAll('[data-ai-develop]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-ai-develop');
      const idea = InboxState.ideas.find(i => i.id === id);
      if (!idea) return;

      btn.disabled = true;
      btn.innerHTML = '✦ Developing…';
      toast('✦ AI is developing story proposal…', 'info');

      try {
        const proposal = await aiDevelopIdea(idea.text);
        showProposalModal(proposal);
      } catch (err) {
        toast(`AI develop error: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '✦ AI Develop';
      }
    });
  });

  // Wire Delete buttons
  contentArea.querySelectorAll('[data-del-idea]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del-idea');
      InboxState.removeIdea(id);
      renderActiveView();
    });
  });
}

function renderIdeasListHtml() {
  if (!InboxState.ideas || InboxState.ideas.length === 0) {
    return `<div style="color:var(--sm-text-dim);font-size:12px;padding:20px;text-align:center">Inbox is empty. Capture your first idea above!</div>`;
  }

  return InboxState.ideas.map(idea => `
    <div class="sm-idea-card">
      <div class="sm-idea-text">${escapeHtml(idea.text)}</div>
      <div class="sm-idea-footer">
        <span style="font-size:10px;color:var(--sm-text-dim)">${new Date(idea.createdAt).toLocaleDateString()}</span>
        <div style="display:flex;gap:6px">
          <button class="sm-btn primary" data-ai-develop="${idea.id}" title="Develop into structured beats and scenes">
            ✦ AI Develop
          </button>
          <button class="sm-btn" data-del-idea="${idea.id}" style="color:var(--danger)">✕</button>
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Interactive AI Proposal Review Modal
 */
function showProposalModal(proposal) {
  let modal = document.getElementById('aiProposalModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'aiProposalModal';
    modal.className = 'sm-modal-bg';
    document.body.appendChild(modal);
  }

  const scenesHtml = (proposal.scenes || []).map((s, idx) => `
    <div style="background:var(--sm-surface-2);border:1px solid var(--sm-border);padding:10px;border-radius:6px;margin-bottom:8px">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;color:var(--sm-accent);cursor:pointer">
        <input type="checkbox" checked data-prop-sc="${idx}">
        <span>${escapeHtml(s.heading || `SCENE ${idx + 1}`)}</span>
      </label>
      <div style="font-size:12px;color:var(--sm-text-muted);margin:4px 0 0 24px">${escapeHtml(s.summary || '')}</div>
      ${s.dialogue ? `<div style="font-size:12px;color:var(--sm-text);margin:4px 0 0 24px;font-style:italic">"${escapeHtml(s.dialogue)}"</div>` : ''}
    </div>
  `).join('');

  const charsHtml = (proposal.characters || []).map((c, idx) => `
    <div style="background:var(--sm-surface-2);border:1px solid var(--sm-border);padding:8px 12px;border-radius:6px;display:flex;align-items:center;justify-content:space-between">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" checked data-prop-char="${idx}">
        <strong style="color:var(--sm-accent)">${escapeHtml(c.name)}</strong>
      </label>
      <span style="font-size:11px;color:var(--sm-text-muted)">${escapeHtml(c.role || '')}</span>
    </div>
  `).join('');

  modal.innerHTML = `
    <div class="sm-modal-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 style="margin:0;color:var(--sm-accent)">✦ AI Story Proposal</h3>
        <button class="sm-btn" id="btnClosePropModal">✕</button>
      </div>

      ${proposal.logline ? `
        <div style="margin-bottom:14px;background:var(--sm-surface-3);padding:10px;border-radius:6px;border:1px solid var(--sm-border)">
          <div style="font-size:10px;font-weight:700;color:var(--sm-accent);text-transform:uppercase">Logline</div>
          <div style="font-size:13px;color:var(--sm-text);margin-top:2px">${escapeHtml(proposal.logline)}</div>
        </div>
      ` : ''}

      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:var(--sm-text-muted);text-transform:uppercase;margin-bottom:6px">Characters (${(proposal.characters || []).length})</div>
        <div style="display:flex;flex-direction:column;gap:6px">${charsHtml}</div>
      </div>

      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:var(--sm-text-muted);text-transform:uppercase;margin-bottom:6px">Scenes & Beats (${(proposal.scenes || []).length})</div>
        <div>${scenesHtml}</div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="sm-btn" id="btnCancelPropModal">Cancel</button>
        <button class="sm-btn primary" id="btnApplyPropModal">✔ Apply to Project</button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  document.getElementById('btnClosePropModal')?.addEventListener('click', () => { modal.style.display = 'none'; });
  document.getElementById('btnCancelPropModal')?.addEventListener('click', () => { modal.style.display = 'none'; });

  document.getElementById('btnApplyPropModal')?.addEventListener('click', () => {
    // Apply selected characters
    (proposal.characters || []).forEach((c, idx) => {
      const chk = modal.querySelector(`[data-prop-char="${idx}"]`);
      if (chk && chk.checked) {
        if (!ScriptState.characters.some(x => x.name.toLowerCase() === c.name.toLowerCase())) {
          ScriptState.characters.push({ name: c.name, role: c.role || 'Supporting', bio: c.goal || '' });
        }
      }
    });

    // Apply selected scenes
    (proposal.scenes || []).forEach((s, idx) => {
      const chk = modal.querySelector(`[data-prop-sc="${idx}"]`);
      if (chk && chk.checked) {
        const scIndex = ScriptState.blocks.length;
        ScriptState.blocks.push({
          id: `b_${Date.now()}_sc_${idx}`,
          panelIndex: scIndex,
          type: 'scene',
          text: s.heading || `SCENE ${scIndex + 1}`
        });
        if (s.summary) {
          ScriptState.blocks.push({
            id: `b_${Date.now()}_act_${idx}`,
            panelIndex: scIndex,
            type: 'action',
            text: s.summary
          });
        }
        if (s.dialogue) {
          ScriptState.blocks.push({
            id: `b_${Date.now()}_dia_${idx}`,
            panelIndex: scIndex,
            type: 'dialogue',
            text: s.dialogue
          });
        }
      }
    });

    ScriptState.saveToStorage();
    modal.style.display = 'none';
    renderActiveView();
    toast('✔ Proposal applied to screenplay and story bible!', 'ok');
  });
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
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
