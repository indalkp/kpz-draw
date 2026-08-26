// src/script/script-panel.js
// Right-panel Script Tab integration for KPZ Draw.
// Replaces the old Google Doc iframe with direct access to screenplay,
// beats, story bible, panel-to-panel sync, and one-click Split Screen.

import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';
import { ScriptState } from './script-state.js';
import { setWorkspaceMode } from './script-editor.js';
import { aiContinueDialogue, aiPolishAction } from './script-inbox.js';
import { toast } from '../ui/toast.js';

let _container = null;

export function initScriptPanel() {
  _container = $('scriptSideBody');
  if (!_container) return;

  renderScriptSidePanel();

  // Wire side panel actions
  $('btnSideSplit')?.addEventListener('click', () => {
    setWorkspaceMode(ScriptState.mode === 'split' ? 'draw' : 'split');
  });

  $('btnSideExpand')?.addEventListener('click', () => {
    setWorkspaceMode('script');
  });

  // Listen to script state updates
  ScriptState.subscribe((event) => {
    if (event === 'init' || event === 'blockUpdated' || event === 'blockInserted' || event === 'blockDeleted') {
      renderScriptSidePanel();
    }
  });

  // Listen to panel changes
  window.addEventListener('kpz:panel-changed', () => {
    renderScriptSidePanel();
  });
}

/**
 * Render the compact Script Mode panel inside the right sidebar.
 */
export function renderScriptSidePanel() {
  const container = $('scriptSideBody');
  const badge = $('sidePanelBadge');
  if (!container) return;

  const activeIdx = (App.project && typeof App.activePanelIdx === 'number') ? App.activePanelIdx : 0;
  const totalPanels = (App.project && App.project.panels) ? App.project.panels.length : 1;

  if (badge) {
    badge.textContent = `Panel ${activeIdx + 1} / ${totalPanels}`;
  }

  // Get blocks for the active panel
  const panelBlocks = ScriptState.blocks.filter(b => b.panelIndex === activeIdx);
  const sceneBlock = panelBlocks.find(b => b.type === 'scene') || { text: `SCENE ${activeIdx + 1}` };
  const charBlock = panelBlocks.find(b => b.type === 'character') || { text: '' };
  const dialogueBlock = panelBlocks.find(b => b.type === 'dialogue') || { text: '' };
  const actionBlock = panelBlocks.find(b => b.type === 'action') || { text: '' };

  container.innerHTML = `
    <div class="side-script-wrap">
      <!-- Quick Mode Switcher Banner -->
      <div class="side-script-banner">
        <span>Screenplay, Beats & Story Bible</span>
        <button class="sm-btn primary" id="btnSideOpenSplit" title="Open Split Screen in canvas area">
          ◫ Split Screen
        </button>
      </div>

      <!-- Active Panel Scene Editor -->
      <div class="side-script-card">
        <div class="side-card-h">🎬 Scene Heading</div>
        <input type="text" class="side-script-input scene-input" id="sideSceneInput"
               placeholder="INT./EXT. LOCATION - DAY" value="${escapeAttr(sceneBlock.text || '')}">
      </div>

      <div class="side-script-card">
        <div class="side-card-h">👤 Character</div>
        <input type="text" class="side-script-input char-input" id="sideCharInput"
               placeholder="CHARACTER NAME" value="${escapeAttr(charBlock.text || '')}">
      </div>

      <div class="side-script-card">
        <div class="side-card-h" style="display:flex;justify-content:space-between;align-items:center">
          <span>💬 Dialogue / Caption (Synced)</span>
          <button class="sm-btn" id="btnSideAIContinue" style="padding:1px 6px;font-size:10px">✦ AI Continue</button>
        </div>
        <textarea class="side-script-textarea dialogue-input" id="sideDialogueInput" rows="2"
                  placeholder="Dialogue line for this panel…">${escapeHtml(dialogueBlock.text || '')}</textarea>
      </div>

      <div class="side-script-card">
        <div class="side-card-h" style="display:flex;justify-content:space-between;align-items:center">
          <span>📝 Action / Visual Notes</span>
          <button class="sm-btn" id="btnSideAIPolish" style="padding:1px 6px;font-size:10px">✦ AI Polish</button>
        </div>
        <textarea class="side-script-textarea action-input" id="sideActionInput" rows="3"
                  placeholder="Visual action, lighting, camera movement…">${escapeHtml(actionBlock.text || '')}</textarea>
      </div>

      <!-- Quick Actions -->
      <div class="side-script-actions">
        <button class="sm-btn" id="btnSideSyncCaption" title="Push this dialogue to storyboard caption">
          ⚡ Sync to Board
        </button>
        <button class="sm-btn" id="btnSideFullScript" title="Open full screenplay workspace">
          📝 Full Screenplay
        </button>
      </div>
    </div>
  `;

  // Wire inputs for real-time synchronization
  const sceneInput = $('sideSceneInput');
  const charInput = $('sideCharInput');
  const dialogueInput = $('sideDialogueInput');
  const actionInput = $('sideActionInput');

  if (sceneInput) {
    sceneInput.addEventListener('input', () => {
      let b = ScriptState.blocks.find(x => x.panelIndex === activeIdx && x.type === 'scene');
      if (!b) {
        b = ScriptState.insertBlockAfter(null, { panelIndex: activeIdx, type: 'scene', text: sceneInput.value });
      } else {
        ScriptState.updateBlock(b.id, { text: sceneInput.value });
      }
    });
  }

  if (charInput) {
    charInput.addEventListener('input', () => {
      let b = ScriptState.blocks.find(x => x.panelIndex === activeIdx && x.type === 'character');
      if (!b) {
        b = ScriptState.insertBlockAfter(null, { panelIndex: activeIdx, type: 'character', text: charInput.value.toUpperCase() });
      } else {
        ScriptState.updateBlock(b.id, { text: charInput.value.toUpperCase() });
      }
    });
  }

  if (dialogueInput) {
    dialogueInput.addEventListener('input', () => {
      let b = ScriptState.blocks.find(x => x.panelIndex === activeIdx && x.type === 'dialogue');
      if (!b) {
        b = ScriptState.insertBlockAfter(null, { panelIndex: activeIdx, type: 'dialogue', text: dialogueInput.value });
      } else {
        ScriptState.updateBlock(b.id, { text: dialogueInput.value });
      }
      // Mirror directly to storyboard caption
      mirrorCaption(dialogueInput.value);
    });
  }

  if (actionInput) {
    actionInput.addEventListener('input', () => {
      let b = ScriptState.blocks.find(x => x.panelIndex === activeIdx && x.type === 'action');
      if (!b) {
        b = ScriptState.insertBlockAfter(null, { panelIndex: activeIdx, type: 'action', text: actionInput.value });
      } else {
        ScriptState.updateBlock(b.id, { text: actionInput.value });
      }
    });
  }

  $('btnSideOpenSplit')?.addEventListener('click', () => setWorkspaceMode('split'));
  $('btnSideFullScript')?.addEventListener('click', () => setWorkspaceMode('script'));
  $('btnSideSyncCaption')?.addEventListener('click', () => {
    if (dialogueInput) mirrorCaption(dialogueInput.value);
  });

  // AI Continue in side panel
  $('btnSideAIContinue')?.addEventListener('click', async () => {
    const context = `${sceneInput?.value || ''}\n${charInput?.value || ''}\n${dialogueInput?.value || ''}`;
    toast('✦ AI drafting dialogue…', 'info');
    try {
      const completion = await aiContinueDialogue(context);
      if (completion && dialogueInput) {
        dialogueInput.value = (dialogueInput.value ? `${dialogueInput.value} ` : '') + completion;
        dialogueInput.dispatchEvent(new Event('input'));
        toast('✦ Dialogue generated!', 'ok');
      }
    } catch (err) {
      toast(`AI Error: ${err.message}`, 'error');
    }
  });

  // AI Polish in side panel
  $('btnSideAIPolish')?.addEventListener('click', async () => {
    if (!actionInput || !actionInput.value.trim()) {
      toast('Type some action notes first.', 'info');
      return;
    }
    toast('✦ Polishing action…', 'info');
    try {
      const polished = await aiPolishAction(actionInput.value);
      if (polished) {
        actionInput.value = polished;
        actionInput.dispatchEvent(new Event('input'));
        toast('✦ Action polished!', 'ok');
      }
    } catch (err) {
      toast(`AI Error: ${err.message}`, 'error');
    }
  });
}

function mirrorCaption(text) {
  const captionInput = $('captionInput');
  if (captionInput && App.project) {
    const activePanel = App.project.panels[App.activePanelIdx || 0];
    if (activePanel) {
      activePanel.caption = text;
      captionInput.value = text;
      App.dirty = true;
    }
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
