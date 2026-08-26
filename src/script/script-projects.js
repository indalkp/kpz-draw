// src/script/script-projects.js
// Screenplay Multi-Project Dashboard, Fountain / JSON / Text Exporter & Importer for KPZ Draw.
// Supports Clean & Annotated Fountain (.fountain), Plain Text (.txt), Full Backup (.json),
// and auto-parsing pasted/uploaded screenplays into Blocks + Story Bible.

import { ScriptState } from './script-state.js';
import { toast } from '../ui/toast.js';
import { App } from '../core/state.js';

export const RE_SLUG  = /^(INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E)\b/i;
export const RE_TRANS = /(^|\s)(CUT TO:|SMASH CUT(?: TO:)?|MATCH CUT(?: TO:)?|FADE OUT\.?|FADE IN:|FADE TO:|DISSOLVE TO:|INTERCUT)\s*$/i;
export const TIME_RE  = /\s*[—\-–]\s*(DAY|NIGHT|MORNING|EVENING|DAWN|DUSK|LATER|CONTINUOUS|MOMENTS LATER|SAME)[\s\S]*$/i;

let activeProjectModalTab = 'export'; // 'projects' | 'export' | 'import'

/**
 * Open the Project Dashboard / Export / Import Modal
 */
export function openProjectDashboardModal(tab = 'export') {
  activeProjectModalTab = tab;

  let modal = document.getElementById('kpzProjectsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'kpzProjectsModal';
    modal.className = 'sm-modal-overlay hidden';
    document.body.appendChild(modal);
  }

  modal.classList.remove('hidden');
  renderProjectModalContent();
}

export function closeProjectDashboardModal() {
  const modal = document.getElementById('kpzProjectsModal');
  if (modal) modal.classList.add('hidden');
}

function renderProjectModalContent() {
  const modal = document.getElementById('kpzProjectsModal');
  if (!modal) return;

  modal.innerHTML = `
    <div class="sm-pmodal-card">
      <!-- Modal Header -->
      <div class="sm-pmodal-head">
        <div>
          <div class="sm-pmodal-title">📁 Screenplay Projects &amp; Export Engine</div>
          <div class="sm-pmodal-sub">Manage story projects, export industry Fountain files, or import existing screenplays</div>
        </div>
        <button class="sm-btn" id="btnCloseProjectModal" style="font-weight:700">✕</button>
      </div>

      <!-- Navigation Tabs -->
      <div class="sm-pmodal-tabs">
        <button class="sm-pmodal-tab ${activeProjectModalTab === 'export' ? 'on' : ''}" data-ptab="export">
          ⬇ Export Deliverables
        </button>
        <button class="sm-pmodal-tab ${activeProjectModalTab === 'import' ? 'on' : ''}" data-ptab="import">
          ⬆ Import Screenplay / Backup
        </button>
        <button class="sm-pmodal-tab ${activeProjectModalTab === 'projects' ? 'on' : ''}" data-ptab="projects">
          🗂 Saved Projects
        </button>
      </div>

      <!-- Body Area -->
      <div class="sm-pmodal-body">
        ${activeProjectModalTab === 'export' ? renderExportTab() : (activeProjectModalTab === 'import' ? renderImportTab() : renderProjectsTab())}
      </div>
    </div>
  `;

  wireProjectModalEvents(modal);
}

/**
 * ════════════════════════════════════════════════════════════
 * 1. EXPORT TAB
 * ════════════════════════════════════════════════════════════
 */
function renderExportTab() {
  const projectTitle = (App.project && App.project.name) || 'Untitled Production';
  const blockCount = (ScriptState.blocks && ScriptState.blocks.length) || 0;
  const beatCount = (ScriptState.board && ScriptState.board.beats && ScriptState.board.beats.length) || 0;
  const charCount = (ScriptState.bible && ScriptState.bible.Characters && ScriptState.bible.Characters.length) || 0;

  return `
    <div class="sm-pexport-grid">
      <!-- Clean Fountain Card -->
      <div class="sm-pexp-card">
        <div class="sm-pexp-icon">📄</div>
        <div class="sm-pexp-info">
          <div class="sm-pexp-title">Clean Screenplay (.fountain)</div>
          <div class="sm-pexp-desc">Industry-standard Fountain plain-text script ready for Final Draft, Highland, WriterDuet, and production reading.</div>
        </div>
        <button class="sm-btn primary" id="btnExportFountainClean">Export .fountain</button>
      </div>

      <!-- Annotated Fountain Card -->
      <div class="sm-pexp-card">
        <div class="sm-pexp-icon">🗂</div>
        <div class="sm-pexp-info">
          <div class="sm-pexp-title">Annotated Screenplay (.fountain)</div>
          <div class="sm-pexp-desc">Includes # Acts, ## Sequences, panel index links, and beat purpose commentary notes.</div>
        </div>
        <button class="sm-btn" id="btnExportFountainAnnotated">Export Annotated</button>
      </div>

      <!-- Plain Text Script Card -->
      <div class="sm-pexp-card">
        <div class="sm-pexp-icon">📋</div>
        <div class="sm-pexp-info">
          <div class="sm-pexp-title">Formatted Text (.txt)</div>
          <div class="sm-pexp-desc">Clean standard-spaced ASCII script with centered dialogue cues and capitalized action lines.</div>
        </div>
        <button class="sm-btn" id="btnExportText">Export .txt</button>
      </div>

      <!-- Full Project JSON Backup Card -->
      <div class="sm-pexp-card highlight">
        <div class="sm-pexp-icon">💾</div>
        <div class="sm-pexp-info">
          <div class="sm-pexp-title">Complete KPZ Project Archive (.json)</div>
          <div class="sm-pexp-desc">Lossless backup containing all Screenplay blocks (${blockCount}), Beats (${beatCount}), Story Bible (${charCount} cast), Story Path roadmap, and AI tools.</div>
        </div>
        <button class="sm-btn primary" id="btnExportProjectJson">Download .json Archive</button>
      </div>
    </div>
  `;
}

/**
 * ════════════════════════════════════════════════════════════
 * 2. IMPORT TAB
 * ════════════════════════════════════════════════════════════
 */
function renderImportTab() {
  return `
    <div class="sm-pimport-wrap">
      <div class="sm-pimport-dropzone" id="impDropZone">
        <div class="sm-pidz-icon">📥</div>
        <div class="sm-pidz-msg">Drop a <b>.fountain</b>, <b>.txt</b>, or <b>.json</b> file here</div>
        <label class="sm-btn primary" style="cursor:pointer;margin-top:6px">
          Choose File…
          <input type="file" id="inpImportFileInput" accept=".fountain,.txt,.md,.json,text/plain" style="display:none">
        </label>
      </div>

      <div style="font-size:11px;font-weight:700;color:var(--sm-text-muted);text-transform:uppercase;margin:12px 0 6px">Or Paste Raw Screenplay / Fountain Text</div>
      <textarea class="sm-pimport-textarea" id="taImportText" rows="7" placeholder="Paste screenplay here:
INT. COFFEE SHOP - DAY
ALICE enters in a hurry, clutching a blueprint.

ALICE
We have less than twenty minutes before the server locks."></textarea>

      <div class="sm-pimport-actions">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--sm-text-muted);cursor:pointer">
          <input type="checkbox" id="chkAutoExtractBible" checked> Auto-extract Characters &amp; Locations into Story Bible
        </label>
        <button class="sm-btn primary" id="btnParseAndImport">✦ Parse &amp; Build Script</button>
      </div>
    </div>
  `;
}

/**
 * ════════════════════════════════════════════════════════════
 * 3. SAVED PROJECTS TAB
 * ════════════════════════════════════════════════════════════
 */
function renderProjectsTab() {
  const projects = getSavedProjectsList();

  return `
    <div class="sm-pprojects-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:12px;color:var(--sm-text-muted)">Stored in browser local storage &amp; indexed state</div>
        <button class="sm-btn primary" id="btnCreateNewProjectModal">＋ New Story Project</button>
      </div>

      <div class="sm-pprojects-list">
        ${projects.length === 0 ? `
          <div style="text-align:center;padding:24px;color:var(--sm-text-dim);font-style:italic">No other saved projects found.</div>
        ` : projects.map(p => `
          <div class="sm-pproj-row">
            <div class="sm-pproj-dot"></div>
            <div class="sm-pproj-info">
              <div class="sm-pproj-title">${escapeHtml(p.title || 'Untitled Story')}</div>
              <div class="sm-pproj-meta">${p.blockCount || 0} blocks · Last edited ${new Date(p.updatedAt).toLocaleDateString()}</div>
            </div>
            <button class="sm-btn primary" data-load-project="${p.id}">Load Project</button>
            <button class="sm-btn danger" data-del-project="${p.id}">🗑</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function wireProjectModalEvents(modal) {
  modal.querySelector('#btnCloseProjectModal')?.addEventListener('click', closeProjectDashboardModal);
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'kpzProjectsModal') closeProjectDashboardModal();
  });

  // Tab switching
  modal.querySelectorAll('[data-ptab]').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      activeProjectModalTab = tabBtn.getAttribute('data-ptab');
      renderProjectModalContent();
    });
  });

  // Export handlers
  modal.querySelector('#btnExportFountainClean')?.addEventListener('click', () => {
    const text = buildFountainScript(false);
    downloadFile(text, `${getProjectSlug()}_clean.fountain`, 'text/plain');
    toast('Clean .fountain screenplay exported!', 'ok');
  });

  modal.querySelector('#btnExportFountainAnnotated')?.addEventListener('click', () => {
    const text = buildFountainScript(true);
    downloadFile(text, `${getProjectSlug()}_annotated.fountain`, 'text/plain');
    toast('Annotated .fountain screenplay exported!', 'ok');
  });

  modal.querySelector('#btnExportText')?.addEventListener('click', () => {
    const text = buildPlainTextScript();
    downloadFile(text, `${getProjectSlug()}_screenplay.txt`, 'text/plain');
    toast('Formatted .txt script exported!', 'ok');
  });

  modal.querySelector('#btnExportProjectJson')?.addEventListener('click', () => {
    const archive = buildProjectArchiveJson();
    downloadFile(JSON.stringify(archive, null, 2), `${getProjectSlug()}_backup.json`, 'application/json');
    toast('Complete KPZ Project Archive exported!', 'ok');
  });

  // Import File Handler
  const fileInput = modal.querySelector('#inpImportFileInput');
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target.result;
        if (file.name.endsWith('.json')) {
          importProjectArchiveJson(content);
        } else {
          modal.querySelector('#taImportText').value = content;
          toast(`Loaded ${file.name}`, 'info');
        }
      };
      reader.readAsText(file);
    }
  });

  // Parse & Import text
  modal.querySelector('#btnParseAndImport')?.addEventListener('click', () => {
    const raw = modal.querySelector('#taImportText')?.value || '';
    if (!raw.trim()) { toast('Paste or drop a screenplay file first', 'error'); return; }

    const autoBible = modal.querySelector('#chkAutoExtractBible')?.checked ?? true;
    parseAndImportScreenplayText(raw, autoBible);
  });

  // Saved Projects handlers
  modal.querySelector('#btnCreateNewProjectModal')?.addEventListener('click', () => {
    const title = prompt('Enter new project title:');
    if (title && title.trim()) {
      createNewProject(title.trim());
    }
  });

  modal.querySelectorAll('[data-load-project]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-load-project');
      loadSavedProject(id);
    });
  });

  modal.querySelectorAll('[data-del-project]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del-project');
      if (confirm('Permanently delete this project backup?')) {
        deleteSavedProject(id);
        renderProjectModalContent();
      }
    });
  });
}

/**
 * ════════════════════════════════════════════════════════════
 * FOUNTAIN & TEXT GENERATOR ENGINES
 * ════════════════════════════════════════════════════════════
 */
export function buildFountainScript(annotated = false) {
  const projectTitle = (App.project && App.project.name) || 'UNTITLED SCREENPLAY';
  const author = 'KP Preproduction Studio';
  const blocks = ScriptState.blocks || [];

  const lines = [];
  lines.push(`Title: ${projectTitle.toUpperCase()}`);
  lines.push(`Credit: Written & Storyboarded by`);
  lines.push(`Author: ${author}`);
  lines.push(`Draft date: ${new Date().toLocaleDateString()}`);
  lines.push(`Contact: KP Studio`);
  lines.push('');
  lines.push('===');
  lines.push('');

  let currentPanel = -1;

  blocks.forEach((b) => {
    if (annotated && typeof b.panelIndex === 'number' && b.panelIndex !== currentPanel) {
      currentPanel = b.panelIndex;
      lines.push('');
      lines.push(`/* --- STORYBOARD PANEL ${currentPanel + 1} --- */`);
    }

    const txt = (b.text || '').trim();
    if (!txt) return;

    if (b.type === 'scene') {
      lines.push('');
      lines.push(txt.toUpperCase());
      lines.push('');
    } else if (b.type === 'character') {
      lines.push('');
      lines.push(`          ${txt.toUpperCase()}`);
    } else if (b.type === 'parenthetical') {
      lines.push(`        (${txt.replace(/^\(|\)$/g, '')})`);
    } else if (b.type === 'dialogue') {
      lines.push(`    ${txt}`);
    } else if (b.type === 'transition') {
      lines.push('');
      lines.push(`> ${txt.toUpperCase()}`);
      lines.push('');
    } else if (b.type === 'shot') {
      lines.push('');
      lines.push(txt.toUpperCase());
      lines.push('');
    } else {
      // action
      lines.push('');
      lines.push(txt);
    }
  });

  return lines.join('\n');
}

export function buildPlainTextScript() {
  const projectTitle = (App.project && App.project.name) || 'UNTITLED SCREENPLAY';
  const blocks = ScriptState.blocks || [];

  const lines = [];
  lines.push('================================================================');
  lines.push(`                      ${projectTitle.toUpperCase()}`);
  lines.push('================================================================');
  lines.push('');

  blocks.forEach(b => {
    const txt = (b.text || '').trim();
    if (!txt) return;

    if (b.type === 'scene') {
      lines.push('');
      lines.push(txt.toUpperCase());
      lines.push('');
    } else if (b.type === 'character') {
      lines.push('');
      lines.push(`                        ${txt.toUpperCase()}`);
    } else if (b.type === 'dialogue') {
      lines.push(`              ${txt}`);
    } else {
      lines.push(txt);
    }
  });

  return lines.join('\n');
}

export function buildProjectArchiveJson() {
  return {
    version: '3.31.6',
    exportedAt: Date.now(),
    project: App.project || {},
    script: {
      blocks: ScriptState.blocks,
      characters: ScriptState.characters,
      bible: ScriptState.bible,
      board: ScriptState.board,
      logline: ScriptState.logline,
      inbox: ScriptState.inbox,
      userPrompts: ScriptState.userPrompts
    }
  };
}

export function importProjectArchiveJson(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (data.script) {
      if (Array.isArray(data.script.blocks)) ScriptState.blocks = data.script.blocks;
      if (data.script.bible) ScriptState.bible = data.script.bible;
      if (data.script.board) ScriptState.board = data.script.board;
      if (data.script.logline) ScriptState.logline = data.script.logline;
      if (Array.isArray(data.script.inbox)) ScriptState.inbox = data.script.inbox;
      if (Array.isArray(data.script.userPrompts)) ScriptState.userPrompts = data.script.userPrompts;

      ScriptState.saveToStorage();
      closeProjectDashboardModal();
      import('./script-editor.js').then(({ renderActiveView }) => renderActiveView());
      toast('Project archive successfully imported!', 'ok');
    }
  } catch (err) {
    toast(`Invalid JSON archive: ${err.message}`, 'error');
  }
}

/**
 * ════════════════════════════════════════════════════════════
 * SCREENPLAY TEXT PARSER
 * ════════════════════════════════════════════════════════════
 */
export function parseAndImportScreenplayText(text, autoBible = true) {
  const lines = text.replace(/\r/g, '').split('\n');
  const newBlocks = [];
  const charsSet = new Set();
  const locsSet = new Set();

  let panelIdx = 0;

  lines.forEach(raw => {
    const s = raw.trim();
    if (!s) return;
    if (/^(Title|Credit|Authors?|Source|Draft date|Contact|Copyright):/i.test(s)) return;
    if (s === '===' || s === '==') return;

    if (RE_SLUG.test(s)) {
      newBlocks.push({
        id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'scene',
        panelIndex: panelIdx,
        text: s.toUpperCase()
      });
      const loc = s.replace(RE_SLUG, '').replace(TIME_RE, '').trim();
      if (loc) locsSet.add(loc);
    } else if (RE_TRANS.test(s)) {
      newBlocks.push({
        id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'transition',
        panelIndex: panelIdx,
        text: s.toUpperCase()
      });
    } else if (/^\(.*\)$/.test(s)) {
      newBlocks.push({
        id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'parenthetical',
        panelIndex: panelIdx,
        text: s
      });
    } else if (s === s.toUpperCase() && s.length <= 35 && !/[.!?]$/.test(s) && /[A-Z]/.test(s)) {
      newBlocks.push({
        id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'character',
        panelIndex: panelIdx,
        text: s
      });
      charsSet.add(s);
    } else {
      const prevBlock = newBlocks[newBlocks.length - 1];
      const isDialogue = prevBlock && (prevBlock.type === 'character' || prevBlock.type === 'parenthetical');
      newBlocks.push({
        id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: isDialogue ? 'dialogue' : 'action',
        panelIndex: panelIdx,
        text: s
      });
    }
  });

  if (newBlocks.length > 0) {
    ScriptState.blocks = newBlocks;

    // Auto-extract into Bible if requested
    if (autoBible) {
      if (!ScriptState.bible) {
        ScriptState.bible = { Characters: [], Locations: [], Props: [], Moods: [], References: [], templates: {} };
      }
      const palette = ['#F97316', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444'];
      charsSet.forEach((charName, i) => {
        if (!ScriptState.bible.Characters.some(c => c.name.toLowerCase() === charName.toLowerCase())) {
          ScriptState.bible.Characters.push({
            id: `char_${Date.now()}_${i}`,
            name: charName,
            role: i === 0 ? 'Protagonist' : (i === 1 ? 'Antagonist' : 'Supporting'),
            color: palette[i % palette.length],
            avatar: charName.slice(0, 2).toUpperCase(),
            fields: { goal: '', conflict: '', wound: '' },
            traits: [],
            relationships: []
          });
        }
      });

      locsSet.forEach((locName, i) => {
        if (!ScriptState.bible.Locations.some(l => l.name.toLowerCase() === locName.toLowerCase())) {
          ScriptState.bible.Locations.push({
            id: `loc_${Date.now()}_${i}`,
            name: locName,
            role: 'Primary Location',
            color: palette[i % palette.length],
            avatar: '📍',
            fields: { description: '' }
          });
        }
      });
    }

    ScriptState.saveToStorage();
    closeProjectDashboardModal();
    import('./script-editor.js').then(({ renderActiveView }) => renderActiveView());
    toast(`✦ Imported ${newBlocks.length} screenplay blocks and built Story Bible!`, 'ok');
  }
}

/**
 * ════════════════════════════════════════════════════════════
 * LOCAL PROJECT STORAGE HELPERS
 * ════════════════════════════════════════════════════════════
 */
function getSavedProjectsList() {
  const list = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('kpz_script_')) {
        const raw = localStorage.getItem(key);
        const data = JSON.parse(raw);
        list.push({
          id: key.replace('kpz_script_', ''),
          title: (App.project && App.project.name) || 'Screenplay Project',
          blockCount: Array.isArray(data.blocks) ? data.blocks.length : 0,
          updatedAt: data.updatedAt || Date.now()
        });
      }
    }
  } catch (_) {}
  return list;
}

function createNewProject(title) {
  ScriptState.blocks = [
    { id: 'blk_1', type: 'scene', panelIndex: 0, text: 'INT. STUDIO - DAY' },
    { id: 'blk_2', type: 'action', panelIndex: 0, text: 'The story begins with a fresh blank canvas.' }
  ];
  ScriptState.logline = '';
  ScriptState.board = null;
  ScriptState.bible = { Characters: [], Locations: [], Props: [], Moods: [], References: [], templates: {} };
  ScriptState.saveToStorage();
  closeProjectDashboardModal();
  import('./script-editor.js').then(({ renderActiveView }) => renderActiveView());
  toast(`Project "${title}" created!`, 'ok');
}

function loadSavedProject(id) {
  ScriptState.projectId = id;
  ScriptState.loadFromStorage();
  closeProjectDashboardModal();
  import('./script-editor.js').then(({ renderActiveView }) => renderActiveView());
  toast(`Project loaded`, 'ok');
}

function deleteSavedProject(id) {
  try {
    localStorage.removeItem(`kpz_script_${id}`);
    toast('Project deleted', 'info');
  } catch (_) {}
}

function getProjectSlug() {
  const name = (App.project && App.project.name) || 'screenplay';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function downloadFile(content, fileName, contentType) {
  const a = document.createElement('a');
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
