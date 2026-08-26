// src/script/script-prompts.js
// AI Prompt Collection Library & Custom Prompt Manager for KPZ Draw.
// Contains curated system craft prompts + custom user prompts with {variable} expansion.

import { ScriptState } from './script-state.js';
import { aiComplete } from './script-ai.js';
import { toast } from '../ui/toast.js';

export const SYSTEM_PROMPTS = [
  {
    id: 'sys_scene_tension',
    cat: 'Scene Doctor',
    title: 'Scene Tension & Conflict Pass',
    desc: 'Heighten stakes and eliminate dead air by forcing opposing goals.',
    system: 'You are a ruthless script doctor and dramatic story editor.',
    prompt: 'Rewrite the following scene to sharpen the dramatic conflict. Make both characters want opposing things with immediate urgency. Bury explicit intent in subtext.\n\nSCENE:\n{scene_text}'
  },
  {
    id: 'sys_dialogue_subtext',
    cat: 'Dialogue & Polish',
    title: 'Dialogue Subtext & Voice Polish',
    desc: 'Transform on-the-nose lines into filmable subtext, pacing and vocal rhythm.',
    system: 'You are an award-winning dialogue specialist and screenwriter.',
    prompt: 'Polish the dialogue below so characters never state their emotions directly. Use misdirection, deflection, silence, and idiosyncratic speech patterns.\n\nDIALOGUE:\n{dialogue_text}'
  },
  {
    id: 'sys_logline_formula',
    cat: 'Concept & Logline',
    title: 'High-Concept Logline Generator',
    desc: 'Derive a compelling 1-sentence logline (Protagonist + Flaw + Inciting Event + Goal + Stakes).',
    system: 'You are a Hollywood development executive specializing in pitch loglines.',
    prompt: 'Given the following story concept, generate 3 high-impact logline options following the formula: [When an inciting incident occurs], [a flawed protagonist] must [pursue an active external goal] before [high-stakes ticking clock consequences].\n\nSTORY CONCEPT:\n{concept}'
  },
  {
    id: 'sys_micro_drama_hook',
    cat: 'Short-Form & Vertical',
    title: 'Vertical Mini-Drama Beat Engine (0-60s)',
    desc: 'Generate Hook (0-15s) → Friction (15-40s) → Spike (40-55s) → Cliffhanger Button (55-58s).',
    system: 'You are a top-performing vertical micro-drama showrunner and viral content engineer.',
    prompt: 'Draft an explosive 60-second vertical episode beat sheet following the Beat Engine:\n1. Hook / Explosion (0-15s): Instant in-medias-res jolt.\n2. Friction (15-40s): Direct power clash with zero small talk.\n3. Spike (40-55s): Major secret or reversal revealed.\n4. Cliffhanger Button (55-58s): Freeze on an unanswered question.\n\nPREMISE:\n{premise}'
  },
  {
    id: 'sys_character_conflict',
    cat: 'Character & Voice',
    title: 'Character Interpersonal Conflict Engine',
    desc: 'Derive ideological and personal friction between two characters based on their core wounds.',
    system: 'You are a master character development consultant.',
    prompt: 'Analyze these two characters and list 3 specific, combustible points of friction where their core beliefs and external goals will violently collide:\n\nCHARACTER A:\n{character_a}\n\nCHARACTER B:\n{character_b}'
  }
];

let selectedPromptId = 'sys_scene_tension';

/**
 * Get all available prompt groups (System + User Prompts)
 */
export function getPromptGroups() {
  if (!ScriptState.userPrompts) {
    ScriptState.userPrompts = [];
  }

  const groups = {
    'My Custom Prompts': ScriptState.userPrompts.slice()
  };

  SYSTEM_PROMPTS.forEach(p => {
    if (!groups[p.cat]) groups[p.cat] = [];
    groups[p.cat].push(p);
  });

  return groups;
}

export function findPrompt(id) {
  return (ScriptState.userPrompts || []).find(p => p.id === id) || SYSTEM_PROMPTS.find(p => p.id === id) || null;
}

export function isUserPrompt(id) {
  return (ScriptState.userPrompts || []).some(p => p.id === id);
}

/**
 * Open the Prompt Collection Library Modal
 */
export function openPromptLibraryModal(initialPromptId = null) {
  selectedPromptId = initialPromptId || selectedPromptId || SYSTEM_PROMPTS[0].id;

  let modal = document.getElementById('kpzPromptsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'kpzPromptsModal';
    modal.className = 'sm-modal-overlay hidden';
    document.body.appendChild(modal);
  }

  modal.classList.remove('hidden');
  renderPromptLibraryContent();
}

export function closePromptLibraryModal() {
  const modal = document.getElementById('kpzPromptsModal');
  if (modal) modal.classList.add('hidden');
}

function renderPromptLibraryContent() {
  const modal = document.getElementById('kpzPromptsModal');
  if (!modal) return;

  const groups = getPromptGroups();
  const current = findPrompt(selectedPromptId) || SYSTEM_PROMPTS[0];
  const isMine = isUserPrompt(current.id);
  const vars = extractVariables(`${current.system || ''} ${current.prompt || ''}`);

  modal.innerHTML = `
    <div class="pc-card">
      <!-- Header -->
      <div class="pc-head">
        <div>
          <div class="pc-title">✦ Screenplay Prompt Library & AI Copilot Tools</div>
          <div class="pc-sub">System craft prompts & custom reusable writing tools</div>
        </div>
        <div style="flex:1"></div>
        <button class="sm-btn primary" id="btnCreateUserPrompt">＋ New Custom Prompt</button>
        <button class="sm-btn" id="btnClosePromptModal" style="font-weight:700">✕</button>
      </div>

      <!-- Main Body: Split Sidebar + Editor -->
      <div class="pc-body">
        <!-- Left Sidebar List -->
        <div class="pc-side">
          <div class="pc-sidetop">
            <input type="text" class="pc-search" id="inpPromptSearch" placeholder="Search prompts...">
          </div>
          <div class="pc-list" id="promptListContainer">
            ${Object.entries(groups).map(([cat, items]) => `
              <div class="pc-group">
                <div class="pc-group-h">
                  <span>${cat}</span>
                  <span class="pc-gn">${items.length}</span>
                </div>
                ${items.map(item => `
                  <div class="pc-row ${item.id === selectedPromptId ? 'on' : ''}" data-select-prompt="${item.id}">
                    <span class="pc-rdot ${isUserPrompt(item.id) ? 'mine' : ''}"></span>
                    <span class="pc-rname">${escapeHtml(item.title)}</span>
                    <span class="pc-tag ${isUserPrompt(item.id) ? 'mine' : ''}">${isUserPrompt(item.id) ? 'Custom' : 'System'}</span>
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Right Editor & Test Pane -->
        <div class="pc-editor">
          ${!isMine ? `
            <div class="pc-notice">
              <span class="pc-i">i</span>
              <span>This is a built-in <b>System Craft Prompt</b>. Clone it to customize role and instructions.</span>
              <button class="sm-btn" id="btnClonePrompt">⧉ Clone to My Prompts</button>
            </div>
          ` : ''}

          <label class="pc-l">Prompt Title</label>
          <input class="pc-name" id="inpPTitle" value="${escapeAttr(current.title || '')}" ${isMine ? '' : 'readonly'}>

          <label class="pc-l">Description</label>
          <input class="pc-name sm" id="inpPDesc" value="${escapeAttr(current.desc || '')}" placeholder="What this prompt does…" ${isMine ? '' : 'readonly'}>

          <div class="pc-msg">
            <div class="pc-msg-h">
              <span>System Persona & Rules</span>
              <span class="pc-role">SYSTEM</span>
            </div>
            <textarea class="pc-code" id="inpPSystem" rows="2" placeholder="Define the AI persona and writing style..." ${isMine ? '' : 'readonly'}>${escapeHtml(current.system || '')}</textarea>
          </div>

          <div class="pc-msg">
            <div class="pc-msg-h">
              <span>Instruction Template</span>
              <span class="pc-role">USER INSTRUCTION</span>
            </div>
            <textarea class="pc-code" id="inpPPrompt" rows="5" placeholder="Enter prompt instruction with {variables} for dynamic values..." ${isMine ? '' : 'readonly'}>${escapeHtml(current.prompt || '')}</textarea>
          </div>

          <div class="pc-vars">
            ${vars.length > 0 ? `
              <span>Detected Variables:</span>
              ${vars.map(v => `<span class="pc-vchip">{${v}}</span>`).join('')}
            ` : '<span class="pc-vnone">No template variables. Use {curly_braces} for fill-in slots.</span>'}
          </div>

          <!-- Action Buttons -->
          <div class="pc-acts">
            ${isMine ? `
              <button class="sm-btn primary" id="btnSavePrompt">💾 Save Changes</button>
              <button class="sm-btn danger" id="btnDeletePrompt">🗑 Delete</button>
            ` : ''}
            <div style="flex:1"></div>
            <button class="sm-btn primary" id="btnExecutePrompt">✦ Run Prompt</button>
          </div>

          <!-- Execution Output Area -->
          <div class="pc-output-area hidden" id="promptOutputArea">
            <label class="pc-l" style="color:var(--sm-accent)">AI Response</label>
            <div class="pc-output-box" id="promptOutputText"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  wirePromptLibraryEvents(modal, current, isMine);
}

function wirePromptLibraryEvents(modal, current, isMine) {
  modal.querySelector('#btnClosePromptModal')?.addEventListener('click', closePromptLibraryModal);
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'kpzPromptsModal') closePromptLibraryModal();
  });

  // Prompt Selection
  modal.querySelectorAll('[data-select-prompt]').forEach(row => {
    row.addEventListener('click', () => {
      selectedPromptId = row.getAttribute('data-select-prompt');
      renderPromptLibraryContent();
    });
  });

  // Create User Prompt
  modal.querySelector('#btnCreateUserPrompt')?.addEventListener('click', () => {
    const newP = {
      id: `up_${Date.now()}`,
      cat: 'My Custom Prompts',
      title: 'New Screenplay Tool',
      desc: 'Custom creative prompt',
      system: 'You are a creative screenplay collaborator.',
      prompt: 'Refine and polish the following passage with dynamic pacing:\n\n{text}'
    };
    if (!ScriptState.userPrompts) ScriptState.userPrompts = [];
    ScriptState.userPrompts.unshift(newP);
    selectedPromptId = newP.id;
    ScriptState.saveToStorage();
    renderPromptLibraryContent();
    toast('Custom prompt created', 'ok');
  });

  // Clone Prompt
  modal.querySelector('#btnClonePrompt')?.addEventListener('click', () => {
    const clone = {
      id: `up_${Date.now()}`,
      cat: 'My Custom Prompts',
      title: `${current.title} (Custom Copy)`,
      desc: current.desc,
      system: current.system,
      prompt: current.prompt
    };
    if (!ScriptState.userPrompts) ScriptState.userPrompts = [];
    ScriptState.userPrompts.unshift(clone);
    selectedPromptId = clone.id;
    ScriptState.saveToStorage();
    renderPromptLibraryContent();
    toast('Cloned to My Prompts', 'ok');
  });

  // Save Prompt
  if (isMine) {
    modal.querySelector('#btnSavePrompt')?.addEventListener('click', () => {
      current.title = modal.querySelector('#inpPTitle')?.value || current.title;
      current.desc = modal.querySelector('#inpPDesc')?.value || current.desc;
      current.system = modal.querySelector('#inpPSystem')?.value || current.system;
      current.prompt = modal.querySelector('#inpPPrompt')?.value || current.prompt;
      ScriptState.saveToStorage();
      renderPromptLibraryContent();
      toast('Prompt saved', 'ok');
    });

    modal.querySelector('#btnDeletePrompt')?.addEventListener('click', () => {
      if (confirm(`Delete "${current.title}"?`)) {
        const idx = ScriptState.userPrompts.findIndex(p => p.id === current.id);
        if (idx !== -1) {
          ScriptState.userPrompts.splice(idx, 1);
          selectedPromptId = SYSTEM_PROMPTS[0].id;
          ScriptState.saveToStorage();
          renderPromptLibraryContent();
          toast('Prompt deleted', 'info');
        }
      }
    });
  }

  // Run Prompt
  modal.querySelector('#btnExecutePrompt')?.addEventListener('click', async () => {
    const outputArea = modal.querySelector('#promptOutputArea');
    const outputText = modal.querySelector('#promptOutputText');
    const runBtn = modal.querySelector('#btnExecutePrompt');

    if (outputArea) outputArea.classList.remove('hidden');
    if (outputText) outputText.textContent = '✦ Drafting with AI…';
    if (runBtn) { runBtn.textContent = '✦ Running…'; runBtn.disabled = true; }

    try {
      // Gather relevant context from active screenplay / beats
      const activeIdx = (App.project && typeof App.activePanelIdx === 'number') ? App.activePanelIdx : 0;
      const blocks = ScriptState.getVisibleBlocks(activeIdx);
      const sceneText = blocks.map(b => `${b.type.toUpperCase()}: ${b.text}`).join('\n');

      let compiledPrompt = current.prompt
        .replace(/{scene_text}/g, sceneText)
        .replace(/{dialogue_text}/g, sceneText)
        .replace(/{concept}/g, sceneText)
        .replace(/{premise}/g, sceneText)
        .replace(/{text}/g, sceneText);

      const response = await aiComplete(compiledPrompt, {
        system: current.system,
        temperature: 0.8
      });

      if (outputText) outputText.textContent = response;
      toast('✦ Prompt completed!', 'ok');
    } catch (err) {
      if (outputText) outputText.textContent = `Error: ${err.message}`;
      toast(`Prompt failed: ${err.message}`, 'error');
    } finally {
      if (runBtn) { runBtn.textContent = '✦ Run Prompt'; runBtn.disabled = false; }
    }
  });
}

function extractVariables(str) {
  const matches = str.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
