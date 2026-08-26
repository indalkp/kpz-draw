// src/script/script-format.js
// Fountain Screenplay Shortcuts, Quick-Format Floating Toolbar & Block Converter for KPZ Draw.
// Supports Ctrl+1-7 element formatting, smart Tab/Enter Fountain transitions,
// selection-based inline styling (**bold**, *italic*, _underline_, Aa case),
// and "Turn into Beat" / "Ask AI" block actions.

import { ScriptState } from './script-state.js';
import { toast } from '../ui/toast.js';
import { App } from '../core/state.js';

export const FOUNTAIN_TYPES = [
  { id: 'scene',         key: '1', icon: '🎬', label: 'Scene Heading',  hint: 'INT. / EXT. LOCATION - DAY' },
  { id: 'action',        key: '2', icon: '🏃', label: 'Action',         hint: 'What the camera sees and hears' },
  { id: 'character',     key: '3', icon: '👤', label: 'Character',      hint: 'CHARACTER NAME' },
  { id: 'parenthetical', key: '4', icon: '❪❫', label: 'Parenthetical',  hint: '(wryly, to self)' },
  { id: 'dialogue',      key: '5', icon: '💬', label: 'Dialogue',       hint: 'Spoken line' },
  { id: 'shot',          key: '6', icon: '🎞', label: 'Shot / Angle',    hint: 'CLOSE UP, WIDE SHOT' },
  { id: 'transition',    key: '7', icon: '⇥',  label: 'Transition',     hint: 'CUT TO:, DISSOLVE TO:' }
];

let floatingBarEl = null;
let activeBlockEl = null;
let activeBlockId = null;
let activeTextarea = null;

/**
 * Initialize Floating Format Toolbar and Global Shortcut Listeners
 */
export function initFormatToolbar() {
  if (!floatingBarEl) {
    floatingBarEl = document.createElement('div');
    floatingBarEl.id = 'kpzFmtBar';
    floatingBarEl.className = 'sm-fmt-bar hidden';
    document.body.appendChild(floatingBarEl);
    renderFloatingToolbar();
  }

  // Global keydown handler for Ctrl+1..7 and Escape modal dismiss
  document.removeEventListener('keydown', handleGlobalShortcuts);
  document.addEventListener('keydown', handleGlobalShortcuts);

  // Dismiss toolbar on scroll
  window.addEventListener('scroll', hideFloatingToolbar, { passive: true });
  document.addEventListener('scroll', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('sm-content-area')) {
      hideFloatingToolbar();
    }
  }, { passive: true, capture: true });

  // Dismiss dropdowns on outside click
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#kpzFmtBar') && !e.target.closest('.sm-block')) {
      hideFloatingToolbar();
    }
    const menu = floatingBarEl?.querySelector('#fmtElMenu');
    if (menu && !menu.classList.contains('hidden') && !e.target.closest('#fmtElTypeBtn') && !e.target.closest('#fmtElMenu')) {
      menu.classList.add('hidden');
    }
  });
}

function handleGlobalShortcuts(e) {
  // Global Escape key: close any open modal or drawer
  if (e.key === 'Escape') {
    hideFloatingToolbar();
    const modals = [
      '#kpzBeatModal',
      '#kpzElementModal',
      '#kpzPromptsModal',
      '#kpzProjectsModal',
      '#kpzStoryPathDrawer',
      '#kpzAIConfigModal'
    ];
    modals.forEach(sel => {
      const el = document.querySelector(sel);
      if (el && !el.classList.contains('hidden')) {
        el.classList.add('hidden');
      }
    });
    return;
  }

  if (!(e.ctrlKey || e.metaKey)) return;

  // Handle Ctrl+1..7
  if (e.key >= '1' && e.key <= '7') {
    const focused = document.activeElement;
    if (focused && focused.classList.contains('sm-block-input')) {
      e.preventDefault();
      const typeObj = FOUNTAIN_TYPES[parseInt(e.key, 10) - 1];
      if (typeObj) {
        const blockEl = focused.closest('.sm-block');
        const blockId = blockEl?.getAttribute('data-id');
        if (blockId) {
          setBlockType(blockId, typeObj.id, blockEl, focused);
        }
      }
    }
  }
}

/**
 * Render the Floating Toolbar DOM
 */
function renderFloatingToolbar() {
  if (!floatingBarEl) return;

  floatingBarEl.innerHTML = `
    <!-- Element Type Selector Button & Menu -->
    <div class="sm-fmt-dropdown-wrap">
      <button class="sm-fmt-btn type-btn" id="fmtElTypeBtn" title="Element type (Ctrl+1–7)">
        <span class="sm-fmt-icon" id="fmtCurrentIcon">🏃</span>
        <span class="sm-fmt-label" id="fmtCurrentLabel">Action</span>
        <span class="sm-fmt-arrow">▾</span>
      </button>

      <!-- Dropdown Element Menu -->
      <div class="sm-fmt-menu hidden" id="fmtElMenu">
        ${FOUNTAIN_TYPES.map(t => `
          <div class="sm-fmt-menu-item" data-set-type="${t.id}">
            <span class="sm-fmi-icon">${t.icon}</span>
            <span class="sm-fmi-name">${t.label}</span>
            <span class="sm-fmi-key">CTRL+${t.key}</span>
          </div>
        `).join('')}
        <div class="sm-fmt-menu-divider"></div>
        <div class="sm-fmt-menu-item" data-action="beat">
          <span class="sm-fmi-icon">◆</span>
          <span class="sm-fmi-name">Turn into Beat</span>
        </div>
        <div class="sm-fmt-menu-item" data-action="inbox">
          <span class="sm-fmi-icon">📥</span>
          <span class="sm-fmi-name">Send to Inbox</span>
        </div>
      </div>
    </div>

    <div class="sm-fmt-sep"></div>

    <!-- Inline Formatting Buttons -->
    <button class="sm-fmt-btn" data-fmt="bold" title="Bold (**Ctrl+B**)"><b>B</b></button>
    <button class="sm-fmt-btn" data-fmt="italic" title="Italic (*Ctrl+I*)"><i>I</i></button>
    <button class="sm-fmt-btn" data-fmt="underline" title="Underline (_Ctrl+U_)"><u>U</u></button>
    <button class="sm-fmt-btn" data-fmt="case" title="Toggle Case (UPPER/lower)">Aa</button>

    <div class="sm-fmt-sep"></div>

    <!-- Quick Creative Actions -->
    <button class="sm-fmt-btn action-btn" data-action="beat" title="Turn into Story Beat">◆ Beat</button>
    <button class="sm-fmt-btn action-btn" data-action="ai" title="Ask AI about this line">✦ AI</button>
    <button class="sm-fmt-btn danger-btn" data-action="del" title="Delete block">🗑</button>
  `;

  wireFloatingToolbarEvents();
}

function wireFloatingToolbarEvents() {
  const btnType = floatingBarEl.querySelector('#fmtElTypeBtn');
  const menu = floatingBarEl.querySelector('#fmtElMenu');

  // Prevent mousedown from stealing textarea selection focus
  floatingBarEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  btnType?.addEventListener('click', (e) => {
    e.stopPropagation();
    menu?.classList.toggle('hidden');
  });

  // Type change from menu
  menu?.querySelectorAll('[data-set-type]').forEach(item => {
    item.addEventListener('click', () => {
      const typeId = item.getAttribute('data-set-type');
      if (activeBlockId && activeBlockEl && activeTextarea) {
        setBlockType(activeBlockId, typeId, activeBlockEl, activeTextarea);
      }
      menu.classList.add('hidden');
    });
  });

  // Formatting actions (Bold, Italic, Underline, Case)
  floatingBarEl.querySelectorAll('[data-fmt]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fmt = btn.getAttribute('data-fmt');
      applyInlineFormat(fmt);
    });
  });

  // Block actions
  floatingBarEl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      handleBlockAction(action);
      menu?.classList.add('hidden');
    });
  });
}

/**
 * Attach Floating Format Toolbar to an active block
 */
export function attachFormatToolbarToBlock(blockEl, blockId, textarea) {
  activeBlockEl = blockEl;
  activeBlockId = blockId;
  activeTextarea = textarea;

  const block = ScriptState.blocks.find(b => b.id === blockId);
  const typeObj = FOUNTAIN_TYPES.find(t => t.id === (block?.type || 'action')) || FOUNTAIN_TYPES[1];

  // Update button label & icon
  const iconEl = floatingBarEl?.querySelector('#fmtCurrentIcon');
  const labelEl = floatingBarEl?.querySelector('#fmtCurrentLabel');
  if (iconEl) iconEl.textContent = typeObj.icon;
  if (labelEl) labelEl.textContent = typeObj.label;

  // Position floating bar above block
  const rect = blockEl.getBoundingClientRect();
  if (floatingBarEl) {
    floatingBarEl.style.top = `${Math.max(10, rect.top - 46)}px`;
    floatingBarEl.style.left = `${Math.max(10, rect.left + 40)}px`;
    floatingBarEl.classList.remove('hidden');
  }
}

export function hideFloatingToolbar() {
  if (floatingBarEl) {
    floatingBarEl.classList.add('hidden');
    floatingBarEl.querySelector('#fmtElMenu')?.classList.add('hidden');
  }
}

/**
 * Convert block element type with visual update
 */
export function setBlockType(blockId, newType, blockEl, textarea) {
  const typeObj = FOUNTAIN_TYPES.find(t => t.id === newType) || FOUNTAIN_TYPES[1];

  ScriptState.updateBlock(blockId, { type: newType });
  if (blockEl) {
    blockEl.setAttribute('data-type', newType);
    const select = blockEl.querySelector('.sm-block-type-select');
    if (select) select.value = newType;
  }

  // Update floating bar label
  const iconEl = floatingBarEl?.querySelector('#fmtCurrentIcon');
  const labelEl = floatingBarEl?.querySelector('#fmtCurrentLabel');
  if (iconEl) iconEl.textContent = typeObj.icon;
  if (labelEl) labelEl.textContent = typeObj.label;

  // Update placeholder
  if (textarea) {
    textarea.placeholder = typeObj.hint;
    textarea.focus();
  }

  toast(`Element · ${typeObj.label}`, 'info');
}

/**
 * Apply inline Markdown / Fountain formatting to selection
 */
function applyInlineFormat(fmt) {
  if (!activeTextarea) return;

  const start = activeTextarea.selectionStart;
  const end = activeTextarea.selectionEnd;
  const val = activeTextarea.value;
  const selected = val.substring(start, end);

  if (fmt === 'bold') {
    wrapSelection(activeTextarea, '**', '**');
  } else if (fmt === 'italic') {
    wrapSelection(activeTextarea, '*', '*');
  } else if (fmt === 'underline') {
    wrapSelection(activeTextarea, '_', '_');
  } else if (fmt === 'case') {
    if (selected) {
      const isUpper = selected === selected.toUpperCase();
      const toggled = isUpper ? selected.toLowerCase() : selected.toUpperCase();
      activeTextarea.setRangeText(toggled, start, end, 'select');
    }
  }

  if (activeBlockId) {
    ScriptState.updateBlock(activeBlockId, { text: activeTextarea.value });
  }
}

function wrapSelection(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;
  const selected = val.substring(start, end);

  const wrapped = `${before}${selected || 'text'}${after}`;
  textarea.setRangeText(wrapped, start, end, 'select');
  textarea.focus();
}

/**
 * Handle block creative conversion actions
 */
function handleBlockAction(action) {
  if (!activeBlockId || !activeTextarea) return;

  const block = ScriptState.blocks.find(b => b.id === activeBlockId);
  const text = (activeTextarea.value || '').trim();

  if (action === 'del') {
    ScriptState.deleteBlock(activeBlockId);
    hideFloatingToolbar();
    const container = document.getElementById('smContentArea');
    if (container && ScriptState.activeTab === 'screenplay') {
      import('./script-editor.js').then(({ renderActiveView }) => renderActiveView());
    }
    toast('🗑 Block deleted', 'info');
    return;
  }

  if (!text) {
    toast('Write something in the block first', 'info');
    return;
  }

  if (action === 'beat') {
    if (!ScriptState.board) {
      ScriptState.board = { viewMode: 'lanes', laneBy: 'act', beats: [], lanes: {} };
    }
    if (!Array.isArray(ScriptState.board.beats)) ScriptState.board.beats = [];

    const firstLine = text.split('\n')[0].slice(0, 60);
    const newBeat = {
      id: `beat_${Date.now()}`,
      title: firstLine || 'New Beat from Script',
      syn: text.length > firstLine.length ? text : '',
      act: 'act_1',
      sequence: 'seq_1',
      scene: 'sc_1',
      panelIndex: block?.panelIndex || 0,
      kind: block?.type === 'action' ? 'action' : (block?.type === 'character' ? 'character' : 'story'),
      purpose: '',
      pov: '',
      body: text,
      tags: [['story', 'Script']],
      fav: false
    };

    ScriptState.board.beats.push(newBeat);
    ScriptState.saveToStorage();
    toast('◆ Beat created from script — check Beats tab', 'ok');
  } else if (action === 'inbox') {
    if (!Array.isArray(ScriptState.inbox)) ScriptState.inbox = [];
    ScriptState.inbox.unshift({
      id: `idea_${Date.now()}`,
      text: text,
      createdAt: Date.now(),
      status: 'raw',
      tags: ['from-script']
    });
    ScriptState.saveToStorage();
    toast('📥 Sent to Inbox & AI tab', 'ok');
  } else if (action === 'ai') {
    import('./script-prompts.js').then(({ openPromptLibraryModal }) => {
      openPromptLibraryModal('sys_scene_tension');
    });
  }
}
