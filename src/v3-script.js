// ============================================================================
//  src/v3-script.js
//  KPZ Draw — v3.27.0 Essential series · Script mode UI
//
//  Third increment in the v3 design rollout. Fills the SCRIPT mode that
//  v3.26.0 left as a placeholder. Per-panel screenplay-format editor:
//
//    • Line types (cycled by Tab or by clicking the pill):
//        scene → action → character → dialogue → parenthetical → transition
//    • Auto-saves to localStorage keyed by kpz:script:<projectId>:<panelIdx>.
//      Stored separately from the canvas data so script writing doesn't bloat
//      existing project saves.
//    • Per-panel — the script panel re-binds to the active canvas panel by
//      observing the #panelInfo text node (which renderPanelNav rewrites on
//      every panel switch). No engine code needs touching to get the wiring.
//
//  Pure UI layer. The brush / canvas / panels pipeline is untouched.
//  Loaded only when body[data-v3="1"] (i.e. ?v3=1). main.js gates the dynamic
//  import on the same flag so the v3.18.1 default surface pays zero cost.
// ============================================================================

import { App } from './core/state.js';

// ---- Constants -------------------------------------------------------------

const LINE_TYPES = [
  'scene',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
];

const LINE_LABELS = {
  scene:         'Scene Heading',
  action:        'Action',
  character:     'Character',
  dialogue:      'Dialogue',
  parenthetical: 'Parenthetical',
  transition:    'Transition',
};

const LINE_PLACEHOLDERS = {
  scene:         'INT. LOCATION — TIME',
  action:        'Action description.',
  character:     'CHARACTER NAME',
  dialogue:      'Dialogue here.',
  parenthetical: '(beat)',
  transition:    'CUT TO:',
};

// Default next-line type after pressing Enter — matches screenplay convention
// (character → dialogue → character ping-pong; scene → action; etc.)
const NEXT_TYPE = {
  scene:         'action',
  action:        'action',
  character:     'dialogue',
  dialogue:      'character',
  parenthetical: 'dialogue',
  transition:    'scene',
};

// ---- Module state ----------------------------------------------------------

let currentPanelIdx = -1;
let currentScript   = null;
let saveTimer       = null;
let saveCueTimer    = null;
let panelInfoObs    = null;
let mounted         = false;

// ---- Storage helpers -------------------------------------------------------

function projectId() {
  // Sanitize project name for use in a localStorage key. Falls back to
  // 'untitled' when no project is open yet (defensive — initV3Script
  // runs after createProject in the normal flow).
  const raw = (App && App.project && App.project.name) || 'untitled';
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function storageKey(panelIdx) {
  return `kpz:script:${projectId()}:${panelIdx}`;
}

function loadScript(panelIdx) {
  try {
    const raw = localStorage.getItem(storageKey(panelIdx));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.lines) && parsed.lines.length) {
        return parsed;
      }
    }
  } catch (_) { /* corrupt JSON / private mode — fall through to default */ }
  return { lines: [{ type: 'scene', text: '' }] };
}

function saveScript(panelIdx, data) {
  try {
    localStorage.setItem(storageKey(panelIdx), JSON.stringify(data));
    showSaveCue('saved');
  } catch (_) {
    // Quota exceeded or storage disabled — still keep the in-memory copy so
    // the user's typing isn't lost mid-session.
    showSaveCue('offline');
  }
}

// ---- Public entry ----------------------------------------------------------

export function initV3Script() {
  if (document.body.getAttribute('data-v3') !== '1') return;
  if (mounted) return;

  const host = document.getElementById('scriptPanel');
  if (!host) {
    console.warn('[KPZ] #scriptPanel not found — script mode UI cannot mount.');
    return;
  }

  // Replace the placeholder with the real editor shell.
  host.innerHTML = `
    <div class="v3-script">
      <div class="v3-script-header">
        <div class="v3-script-titlewrap">
          <div class="v3-script-title" id="v3ScriptTitle">Script</div>
          <div class="v3-script-subtitle" id="v3ScriptSubtitle"></div>
        </div>
        <div class="v3-script-meta">
          <span class="v3-script-savecue" id="v3ScriptSaveCue" data-state="saved" title="Auto-save status">&#9729;&#xFE0E; saved</span>
        </div>
      </div>
      <div class="v3-script-body" id="v3ScriptBody" role="textbox" aria-label="Script editor"></div>
      <div class="v3-script-footer">
        <span class="v3-script-hint">Tab cycles line type &middot; Enter adds line &middot; auto-saves locally</span>
      </div>
    </div>
  `;

  // First render against whatever panel is active right now.
  refreshForPanel(/* force */ true);

  // Observe #panelInfo — renderPanelNav() updates its text content to
  // "Panel X / Y" on every switch, so a single MutationObserver gives
  // us a free panel-changed signal without modifying core code.
  const panelInfo = document.getElementById('panelInfo');
  if (panelInfo) {
    panelInfoObs = new MutationObserver(() => refreshForPanel(false));
    panelInfoObs.observe(panelInfo, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  // The mode toggle (both/canvas/script) just adjusts grid-template-columns;
  // we don't need to do anything when it fires, but listen anyway so we
  // re-evaluate the title in case the active panel changed during a load.
  document.addEventListener('kpz:v3-mode-changed', () => refreshForPanel(false));

  mounted = true;
}

// ---- Render ----------------------------------------------------------------

function refreshForPanel(force) {
  const idx = (App && typeof App.activePanelIdx === 'number') ? App.activePanelIdx : 0;
  if (!force && idx === currentPanelIdx) {
    updateTitle();
    return;
  }
  currentPanelIdx = idx;
  currentScript   = loadScript(idx);
  renderLines();
  updateTitle();
}

function updateTitle() {
  const sub = document.getElementById('v3ScriptSubtitle');
  if (!sub) return;
  const total = (App.project && App.project.panels) ? App.project.panels.length : 1;
  sub.textContent = `Panel ${currentPanelIdx + 1} of ${total}`;
  const t = document.getElementById('v3ScriptTitle');
  if (t) {
    const projName = (App.project && App.project.name) || 'Untitled';
    t.textContent = projName;
  }
}

function renderLines() {
  const body = document.getElementById('v3ScriptBody');
  if (!body) return;
  body.innerHTML = '';
  if (!currentScript.lines.length) {
    currentScript.lines.push({ type: 'scene', text: '' });
  }
  currentScript.lines.forEach((line, i) => {
    body.appendChild(buildLineRow(line, i));
  });
}

function buildLineRow(line, i) {
  const row = document.createElement('div');
  row.className = `v3-script-line v3-line-${line.type}`;
  row.dataset.idx = String(i);

  // Type pill — click cycles. Lives in the gutter so it doesn't disturb the
  // monospace screenplay column.
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'v3-line-pill';
  pill.textContent = LINE_LABELS[line.type];
  pill.title = 'Cycle line type (or press Tab while editing)';
  pill.addEventListener('click', () => cycleType(i));

  // Editable text. contentEditable beats <textarea> here because we need
  // per-line styles (caps for character, italic for parenthetical) without
  // shipping a real document model — each line is a single contenteditable
  // node and the type controls the cascade.
  const ed = document.createElement('div');
  ed.className = 'v3-line-text';
  ed.contentEditable = 'true';
  ed.spellcheck = true;
  ed.dataset.placeholder = LINE_PLACEHOLDERS[line.type] || '';
  ed.textContent = line.text || '';
  ed.addEventListener('input', () => {
    currentScript.lines[i].text = ed.textContent;
    queueSave();
  });
  ed.addEventListener('keydown', (e) => onLineKey(e, i));

  row.appendChild(pill);
  row.appendChild(ed);
  return row;
}

// ---- Editing handlers ------------------------------------------------------

function cycleType(i) {
  if (!currentScript.lines[i]) return;
  // Persist whatever's in the live editable before we re-render — otherwise
  // unsaved keystrokes since the last input event get clobbered.
  const editable = document.querySelector(`#v3ScriptBody [data-idx="${i}"] .v3-line-text`);
  if (editable) currentScript.lines[i].text = editable.textContent;

  const cur = currentScript.lines[i].type;
  const k = LINE_TYPES.indexOf(cur);
  currentScript.lines[i].type = LINE_TYPES[(k + 1) % LINE_TYPES.length];
  renderLines();
  focusLine(i);
  queueSave();
}

function focusLine(i) {
  const body = document.getElementById('v3ScriptBody');
  if (!body) return;
  const ed = body.querySelector(`[data-idx="${i}"] .v3-line-text`);
  if (!ed) return;
  ed.focus();
  // Caret at end so cycling type doesn't drop the user back to position 0.
  const r = document.createRange();
  r.selectNodeContents(ed);
  r.collapse(false);
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(r); }
}

function onLineKey(e, i) {
  if (e.key === 'Tab') {
    e.preventDefault();
    cycleType(i);
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    // Mirror live edit before splicing.
    const ed = e.currentTarget;
    currentScript.lines[i].text = ed.textContent;
    const cur  = currentScript.lines[i].type;
    const next = NEXT_TYPE[cur] || 'action';
    currentScript.lines.splice(i + 1, 0, { type: next, text: '' });
    renderLines();
    focusLine(i + 1);
    queueSave();
    return;
  }
  if (e.key === 'Backspace') {
    const ed = e.currentTarget;
    if (!ed.textContent && currentScript.lines.length > 1) {
      e.preventDefault();
      currentScript.lines.splice(i, 1);
      renderLines();
      focusLine(Math.max(0, i - 1));
      queueSave();
    }
  }
}

// ---- Save indicator --------------------------------------------------------

function queueSave() {
  showSaveCue('saving');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveScript(currentPanelIdx, currentScript);
  }, 350);
}

function showSaveCue(state) {
  const cue = document.getElementById('v3ScriptSaveCue');
  if (!cue) return;
  cue.dataset.state = state;
  const text = state === 'saved'
    ? '☁︎ saved'
    : state === 'saving'
      ? '☁ saving…'
      : '⚠ offline';
  cue.textContent = text;
  if (saveCueTimer) clearTimeout(saveCueTimer);
  if (state === 'saved') {
    // Fade the cue back to a quieter "idle" colour after 2s. Pure cosmetic.
    saveCueTimer = setTimeout(() => {
      if (cue.dataset.state === 'saved') cue.classList.add('idle');
    }, 2000);
    cue.classList.remove('idle');
  } else {
    cue.classList.remove('idle');
  }
}
