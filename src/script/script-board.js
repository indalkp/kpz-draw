// src/script/script-board.js
// Visual Multi-Lane Beat Board, Mind Map Tree & Story Arc Engine for KPZ Draw.
// Supports Kanban lanes (by Act, Sequence, Scene), Drag-and-Drop,
// XMind-style ⑂ Mind Map, 5-stage dramatic Story Arc, and Beat Detail Modal.

import { ScriptState } from './script-state.js';
import { aiComplete } from './script-ai.js';
import { toast } from '../ui/toast.js';
import { App } from '../core/state.js';

export const BEAT_KINDS = {
  macro:     { label: 'Major Story Turn', icon: '◆', color: '#F97316', hint: 'Key milestone turning the overarching narrative' },
  story:     { label: 'Plot Progression', icon: '▲', color: '#3B82F6', hint: 'Direct progression of the main external plot' },
  character: { label: 'Character / POV',  icon: '●', color: '#10B981', hint: 'Emotional realization, relationship shift, or internal choice' },
  action:    { label: 'Action / Spectacle',icon: '⚡', color: '#EF4444', hint: 'Physical conflict, set piece, or dynamic visual sequence' },
  lore:      { label: 'World / Setup',    icon: '◷', color: '#8B5CF6', hint: 'World building rule, visual motif, or thematic setup' }
};

export const DEFAULT_LANES = {
  act: [
    { id: 'act_1', title: 'Act I — Setup', sub: 'Status Quo & Catalyst', dot: '#10B981' },
    { id: 'act_2a', title: 'Act II-A — Rising', sub: 'Promise of the Premise', dot: '#3B82F6' },
    { id: 'act_2b', title: 'Act II-B — Midpoint', sub: 'High Stakes & Turning Point', dot: '#F59E0B' },
    { id: 'act_3', title: 'Act III — Climax', sub: 'Resolution & Aftermath', dot: '#EF4444' }
  ],
  sequence: [
    { id: 'seq_1', title: 'Seq 1: Introduction', sub: 'World & Core Need', dot: '#10B981' },
    { id: 'seq_2', title: 'Seq 2: Inciting Event', sub: 'Crossing the Threshold', dot: '#3B82F6' },
    { id: 'seq_3', title: 'Seq 3: Escalation', sub: 'First Obstacle', dot: '#8B5CF6' },
    { id: 'seq_4', title: 'Seq 4: Dark Night', sub: 'Apparent Defeat', dot: '#F59E0B' },
    { id: 'seq_5', title: 'Seq 5: Climax & Clashing', sub: 'Final Confrontation', dot: '#EF4444' }
  ],
  scene: [
    { id: 'sc_1', title: 'Scene 1', sub: 'Opening', dot: '#F97316' },
    { id: 'sc_2', title: 'Scene 2', sub: 'Interaction', dot: '#3B82F6' },
    { id: 'sc_3', title: 'Scene 3', sub: 'Reversal', dot: '#10B981' }
  ]
};

let activeBeatId = null;
let activeBeatTab = 'details';

/**
 * Ensure default beats and lanes in ScriptState
 */
export function ensureBoardData() {
  if (!ScriptState.board) {
    ScriptState.board = {
      viewMode: 'lanes', // 'lanes' | 'map' | 'arc'
      laneBy: 'act',    // 'act' | 'sequence' | 'scene'
      arcMode: 'shape',  // 'shape' | 'matrix'
      collapsedLanes: {},
      lanes: JSON.parse(JSON.stringify(DEFAULT_LANES)),
      beats: []
    };
  }

  if (!Array.isArray(ScriptState.board.beats) || ScriptState.board.beats.length === 0) {
    // Seed initial beats mapped from screenplay blocks or panels
    const panels = (App.project && App.project.panels) || [];
    if (panels.length > 0) {
      ScriptState.board.beats = panels.map((p, idx) => ({
        id: `beat_${idx}_${Date.now()}`,
        title: `Beat ${idx + 1}: ${p.caption ? p.caption.slice(0, 30) : 'Story Event'}`,
        syn: p.caption || `Visual progression for panel ${idx + 1}`,
        act: idx === 0 ? 'act_1' : (idx < panels.length / 2 ? 'act_2a' : (idx < panels.length - 1 ? 'act_2b' : 'act_3')),
        sequence: `seq_${Math.min(5, idx + 1)}`,
        scene: `sc_${Math.min(3, idx + 1)}`,
        panelIndex: idx,
        kind: idx === 0 ? 'macro' : (idx === panels.length - 1 ? 'action' : 'story'),
        purpose: idx === 0 ? 'Hook the audience and establish tone' : '',
        pov: '',
        body: p.caption || '',
        tags: [['loc', 'Studio'], ['story', 'Main']],
        fav: idx === 0
      }));
    } else {
      ScriptState.board.beats = [
        {
          id: 'beat_init_1',
          title: 'Cold Open — The Inciting Discovery',
          syn: 'The artist initiates a new production on the digital canvas, discovering the core creative hook.',
          act: 'act_1',
          sequence: 'seq_1',
          scene: 'sc_1',
          panelIndex: 0,
          kind: 'macro',
          purpose: 'Hook the audience and plant the central question.',
          pov: 'Artist',
          body: 'The blank canvas glows. Fast brushstrokes outline the key composition.',
          tags: [['loc', 'Studio'], ['story', 'Main']],
          fav: true
        }
      ];
    }
    ScriptState.saveToStorage();
  }
}

/**
 * Main Render function for the Beats tab
 */
export function renderBoardView(container) {
  if (!container) return;
  ensureBoardData();

  const board = ScriptState.board;

  container.innerHTML = `
    <div class="sm-board-wrap">
      <!-- Board Top Controls -->
      <div class="sm-board-header">
        <div class="sm-board-mode-seg">
          <button class="sm-mode-btn ${board.viewMode === 'lanes' ? 'active' : ''}" data-bmode="lanes">
            ▦ Kanban Lanes
          </button>
          <button class="sm-mode-btn ${board.viewMode === 'map' ? 'active' : ''}" data-bmode="map">
            ⑂ Mind Map
          </button>
          <button class="sm-mode-btn ${board.viewMode === 'arc' ? 'active' : ''}" data-bmode="arc">
            📈 Story Arc
          </button>
        </div>

        ${board.viewMode === 'lanes' ? `
          <div class="sm-lane-switch">
            <span style="font-size:11px;color:var(--sm-text-muted);font-weight:600">GROUP BY:</span>
            <button class="sm-lane-btn ${board.laneBy === 'act' ? 'active' : ''}" data-laneby="act">Acts</button>
            <button class="sm-lane-btn ${board.laneBy === 'sequence' ? 'active' : ''}" data-laneby="sequence">Sequences</button>
            <button class="sm-lane-btn ${board.laneBy === 'scene' ? 'active' : ''}" data-laneby="scene">Scenes</button>
          </div>
        ` : ''}

        <div style="flex:1"></div>

        <button class="sm-btn primary" id="btnAddNewBeat" title="Create a new story beat">
          ＋ Add Beat
        </button>
      </div>

      <!-- Main Board Content -->
      <div class="sm-board-body" id="boardBodyArea">
        ${board.viewMode === 'lanes' ? renderLanesHtml() : (board.viewMode === 'map' ? renderMindMapHtml() : renderStoryArcHtml())}
      </div>
    </div>
  `;

  wireBoardHeaderEvents(container);
  if (board.viewMode === 'lanes') wireLanesEvents(container);
  else if (board.viewMode === 'map') wireMindMapEvents(container);
  else if (board.viewMode === 'arc') wireArcEvents(container);
}

function wireBoardHeaderEvents(container) {
  container.querySelectorAll('[data-bmode]').forEach(btn => {
    btn.addEventListener('click', () => {
      ScriptState.board.viewMode = btn.getAttribute('data-bmode');
      ScriptState.saveToStorage();
      renderBoardView(container);
    });
  });

  container.querySelectorAll('[data-laneby]').forEach(btn => {
    btn.addEventListener('click', () => {
      ScriptState.board.laneBy = btn.getAttribute('data-laneby');
      ScriptState.saveToStorage();
      renderBoardView(container);
    });
  });

  container.querySelector('#btnAddNewBeat')?.addEventListener('click', () => {
    const dim = ScriptState.board.laneBy || 'act';
    const lanes = ScriptState.board.lanes[dim] || [];
    const firstLaneId = lanes[0]?.id || 'act_1';
    
    const newBeat = {
      id: `beat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      title: 'New Story Beat',
      syn: '',
      [dim]: firstLaneId,
      kind: 'story',
      purpose: '',
      pov: '',
      body: '',
      tags: [],
      fav: false
    };

    ScriptState.board.beats.push(newBeat);
    ScriptState.saveToStorage();
    renderBoardView(container);
    openBeatModal(newBeat.id);
  });
}

/**
 * ════════════════════════════════════════════════════════════
 * 1. KANBAN LANES VIEW
 * ════════════════════════════════════════════════════════════
 */
function renderLanesHtml() {
  const dim = ScriptState.board.laneBy || 'act';
  const lanes = ScriptState.board.lanes[dim] || [];
  const beats = ScriptState.board.beats || [];
  const collapsed = ScriptState.board.collapsedLanes || {};

  return `
    <div class="sm-lanes-container">
      ${lanes.map(lane => {
        const isCollapsed = !!collapsed[lane.id];
        const laneBeats = beats.filter(b => b[dim] === lane.id);

        if (isCollapsed) {
          return `
            <div class="sm-lane collapsed" data-lane-id="${lane.id}">
              <div class="sm-lane-spine-title" data-toggle-lane="${lane.id}">
                <span class="sm-lane-dot" style="background:${lane.dot}"></span>
                <span>${escapeHtml(lane.title)} (${laneBeats.length})</span>
              </div>
            </div>
          `;
        }

        return `
          <div class="sm-lane" data-lane-id="${lane.id}">
            <!-- Lane Header -->
            <div class="sm-lane-header">
              <span class="sm-lane-dot" style="background:${lane.dot}"></span>
              <div class="sm-lane-meta">
                <div class="sm-lane-title" contenteditable="true" data-edit-lane="${lane.id}">${escapeHtml(lane.title)}</div>
                <div class="sm-lane-sub">${escapeHtml(lane.sub || '')}</div>
              </div>
              <span class="sm-count-badge">${laneBeats.length}</span>
              <button class="sm-lane-tool-btn" data-toggle-lane="${lane.id}" title="Collapse lane">⇤</button>
            </div>

            <!-- Beats Drop Target Area -->
            <div class="sm-lane-body" data-drop-lane="${lane.id}">
              ${laneBeats.length === 0 ? `
                <div class="sm-empty-lane">Drop beats here or click "+ Add"</div>
              ` : laneBeats.map((b, i) => renderBeatCardHtml(b, i + 1)).join('')}
            </div>

            <!-- Lane Footer Quick Add -->
            <button class="sm-lane-add-btn" data-add-to-lane="${lane.id}">
              ＋ Add beat
            </button>
          </div>
        `;
      }).join('')}

      <!-- Ghost Add Lane Button -->
      <button class="sm-ghost-add-lane" id="btnAddLaneBtn">
        <span>＋ Add ${dim.toUpperCase()} Lane</span>
      </button>
    </div>
  `;
}

function renderBeatCardHtml(b, idx) {
  const kindMeta = BEAT_KINDS[b.kind || 'story'] || BEAT_KINDS.story;

  return `
    <div class="sm-beat-card ${b.fav ? 'fav' : ''}" draggable="true" data-beat-id="${b.id}">
      <div class="sm-beat-top">
        <span class="sm-beat-kind" style="color:${kindMeta.color}" title="${kindMeta.label}">
          ${kindMeta.icon}
        </span>
        <span class="sm-beat-no">${idx}</span>
        <div class="sm-beat-title" contenteditable="true" data-edit-btitle="${b.id}">
          ${escapeHtml(b.title || 'Untitled Beat')}
        </div>
        <button class="sm-beat-more" data-open-bmodal="${b.id}" title="Deep Editor">⋯</button>
      </div>

      <div class="sm-beat-syn" contenteditable="true" data-edit-bsyn="${b.id}" placeholder="Add short synopsis…">
        ${escapeHtml(b.syn || '')}
      </div>

      <!-- Tag Chips -->
      <div class="sm-beat-tags">
        ${(b.tags || []).slice(0, 3).map(([type, val]) => `
          <span class="sm-btag ${type}">#${escapeHtml(val)}</span>
        `).join('')}
        ${(b.tags || []).length > 3 ? `<span class="sm-btag more">+${b.tags.length - 3}</span>` : ''}
      </div>

      <!-- Beat Footer -->
      <div class="sm-beat-footer">
        <div class="sm-bf-left">
          ${b.purpose ? `
            <span class="sm-purp-chip set" data-open-bmodal="${b.id}" title="${escapeAttr(b.purpose)}">◉ Purpose</span>
          ` : `
            <span class="sm-purp-chip none" data-open-bmodal="${b.id}">+ purpose</span>
          `}
          ${b.pov ? `<span class="sm-pov-chip">👤 ${escapeHtml(b.pov)}</span>` : ''}
        </div>
        <button class="sm-beat-star ${b.fav ? 'on' : ''}" data-star-beat="${b.id}" title="${b.fav ? 'Unstar' : 'Star'}">
          ${b.fav ? '★' : '☆'}
        </button>
      </div>
    </div>
  `;
}

function wireLanesEvents(container) {
  const dim = ScriptState.board.laneBy || 'act';

  // Toggle Collapse
  container.querySelectorAll('[data-toggle-lane]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const laneId = btn.getAttribute('data-toggle-lane');
      ScriptState.board.collapsedLanes[laneId] = !ScriptState.board.collapsedLanes[laneId];
      ScriptState.saveToStorage();
      renderBoardView(container);
    });
  });

  // Edit Lane Title
  container.querySelectorAll('[data-edit-lane]').forEach(el => {
    el.addEventListener('blur', () => {
      const laneId = el.getAttribute('data-edit-lane');
      const lane = ScriptState.board.lanes[dim].find(l => l.id === laneId);
      if (lane) {
        lane.title = el.textContent.trim() || lane.title;
        ScriptState.saveToStorage();
      }
    });
  });

  // Add Beat to Lane
  container.querySelectorAll('[data-add-to-lane]').forEach(btn => {
    btn.addEventListener('click', () => {
      const laneId = btn.getAttribute('data-add-to-lane');
      const newBeat = {
        id: `beat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        title: 'New Beat',
        syn: '',
        [dim]: laneId,
        kind: 'story',
        purpose: '',
        pov: '',
        body: '',
        tags: [],
        fav: false
      };
      ScriptState.board.beats.push(newBeat);
      ScriptState.saveToStorage();
      renderBoardView(container);
      openBeatModal(newBeat.id);
    });
  });

  // Ghost Add Lane
  container.querySelector('#btnAddLaneBtn')?.addEventListener('click', () => {
    const title = prompt(`Enter title for new ${dim} lane:`);
    if (title && title.trim()) {
      const newLane = {
        id: `${dim}_${Date.now()}`,
        title: title.trim(),
        sub: '',
        dot: '#F97316'
      };
      ScriptState.board.lanes[dim].push(newLane);
      ScriptState.saveToStorage();
      renderBoardView(container);
      toast(`Lane added`, 'ok');
    }
  });

  // Beat Card Inline Edits
  container.querySelectorAll('[data-edit-btitle]').forEach(el => {
    el.addEventListener('blur', () => {
      const id = el.getAttribute('data-edit-btitle');
      const beat = ScriptState.board.beats.find(b => b.id === id);
      if (beat) {
        beat.title = el.textContent.trim();
        ScriptState.saveToStorage();
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });

  container.querySelectorAll('[data-edit-bsyn]').forEach(el => {
    el.addEventListener('blur', () => {
      const id = el.getAttribute('data-edit-bsyn');
      const beat = ScriptState.board.beats.find(b => b.id === id);
      if (beat) {
        beat.syn = el.textContent.trim();
        ScriptState.saveToStorage();
      }
    });
  });

  // Favorite Stars
  container.querySelectorAll('[data-star-beat]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-star-beat');
      const beat = ScriptState.board.beats.find(b => b.id === id);
      if (beat) {
        beat.fav = !beat.fav;
        ScriptState.saveToStorage();
        renderBoardView(container);
      }
    });
  });

  // Open Beat Detail Modal
  container.querySelectorAll('[data-open-bmodal]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-open-bmodal');
      openBeatModal(id);
    });
  });

  // Wire HTML5 Drag & Drop
  wireDragAndDrop(container, dim);
}

function wireDragAndDrop(container, dim) {
  let draggedBeatId = null;

  container.querySelectorAll('.sm-beat-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedBeatId = card.getAttribute('data-beat-id');
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', draggedBeatId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedBeatId = null;
    });
  });

  container.querySelectorAll('[data-drop-lane]').forEach(laneEl => {
    laneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      laneEl.classList.add('dragover');
    });

    laneEl.addEventListener('dragleave', () => {
      laneEl.classList.remove('dragover');
    });

    laneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      laneEl.classList.remove('dragover');
      const targetLaneId = laneEl.getAttribute('data-drop-lane');
      if (draggedBeatId && targetLaneId) {
        const beat = ScriptState.board.beats.find(b => b.id === draggedBeatId);
        if (beat && beat[dim] !== targetLaneId) {
          beat[dim] = targetLaneId;
          ScriptState.saveToStorage();
          renderBoardView(container);
          toast('Beat moved', 'info');
        }
      }
    });
  });
}

/**
 * ════════════════════════════════════════════════════════════
 * 2. ⑂ MIND MAP HIERARCHICAL TREE VIEW
 * ════════════════════════════════════════════════════════════
 */
function renderMindMapHtml() {
  const projectTitle = (App.project && App.project.name) || 'Animation Project';
  const acts = ScriptState.board.lanes.act || [];
  const seqs = ScriptState.board.lanes.sequence || [];
  const beats = ScriptState.board.beats || [];

  return `
    <div class="sm-mindmap-wrap">
      <div class="mm-inner">
        <!-- Root Project Node -->
        <div class="mm-entry root">
          <div class="mm-card root">
            <div class="mm-rt">🎬 ${escapeHtml(projectTitle)}</div>
            <div class="mm-rl">${beats.length} Total Beats · ${acts.length} Acts</div>
          </div>

          <!-- Act Branches -->
          <div class="mm-kids">
            ${acts.map(act => {
              const actBeats = beats.filter(b => b.act === act.id);
              return `
                <div class="mm-branch">
                  <div class="mm-entry">
                    <div class="mm-card t-act">
                      <span class="mm-dot" style="background:${act.dot}"></span>
                      <div class="mm-cmain">
                        <div class="mm-lbl">${escapeHtml(act.title)}</div>
                        <div class="mm-sum">${escapeHtml(act.sub || '')}</div>
                      </div>
                      <span class="sm-count-badge">${actBeats.length}</span>
                    </div>

                    <!-- Sequence / Beat Children -->
                    <div class="mm-kids">
                      ${actBeats.map(b => `
                        <div class="mm-branch">
                          <div class="mm-card beatleaf" data-open-bmodal="${b.id}">
                            <span class="mm-bdot" style="background:${(BEAT_KINDS[b.kind || 'story'] || {}).color || '#F97316'}"></span>
                            <div class="mm-cmain">
                              <div class="mm-lbl">${escapeHtml(b.title)}</div>
                              <div class="mm-sum">${escapeHtml(b.syn || '')}</div>
                            </div>
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function wireMindMapEvents(container) {
  container.querySelectorAll('[data-open-bmodal]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-open-bmodal');
      openBeatModal(id);
    });
  });
}

/**
 * ════════════════════════════════════════════════════════════
 * 3. 📈 STORY ARC 5-STAGE DRAMATIC CURVE
 * ════════════════════════════════════════════════════════════
 */
const ARC_STAGES = [
  { name: 'Exposition', color: '#10B981', defaultDesc: 'Establish status quo, hero world, and initial yearning.' },
  { name: 'Rising Action', color: '#3B82F6', defaultDesc: 'Inciting incident pushes protagonist into escalating conflict.' },
  { name: 'Climax', color: '#EF4444', defaultDesc: 'Point of maximum tension where the main choice is made.' },
  { name: 'Falling Action', color: '#8B5CF6', defaultDesc: 'Immediate fallout and cost of the climactic decision.' },
  { name: 'Resolution', color: '#F59E0B', defaultDesc: 'Transformed status quo reveals new state of the world.' }
];

function renderStoryArcHtml() {
  const projectTitle = (App.project && App.project.name) || 'Current Story';
  const beats = ScriptState.board.beats || [];

  return `
    <div class="sm-arc-wrap">
      <!-- Arc Analysis AI Bar -->
      <div class="sm-arc-ai-bar">
        <span style="color:var(--sm-accent);font-size:16px">✦</span>
        <input type="text" id="inpArcQuery" placeholder="Analyze story arc for this project or prompt... (e.g. Hero's Journey breakdown)" value="${escapeAttr(projectTitle)}">
        <button class="sm-btn primary" id="btnRunArcAI">Analyze Arc</button>
      </div>

      <!-- SVG Curve -->
      <div class="sm-arc-canvas">
        <svg class="sm-arc-svg" viewBox="0 0 1000 280" preserveAspectRatio="xMidYMid meet">
          <path d="M 60,240 C 180,240 220,160 320,150 C 420,140 480,70 560,50 C 650,30 700,120 760,150 C 840,180 880,200 940,210"
                fill="none" stroke="var(--sm-border)" stroke-width="3" stroke-dasharray="6,4"/>
          <!-- Circle Nodes -->
          <circle cx="60" cy="240" r="14" fill="#10B981" stroke="#1c1917" stroke-width="3"/>
          <circle cx="320" cy="150" r="14" fill="#3B82F6" stroke="#1c1917" stroke-width="3"/>
          <circle cx="560" cy="50" r="14" fill="#EF4444" stroke="#1c1917" stroke-width="3"/>
          <circle cx="760" cy="150" r="14" fill="#8B5CF6" stroke="#1c1917" stroke-width="3"/>
          <circle cx="940" cy="210" r="14" fill="#F59E0B" stroke="#1c1917" stroke-width="3"/>
          
          <text x="60" y="244" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">1</text>
          <text x="320" y="154" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">2</text>
          <text x="560" y="54" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">3</text>
          <text x="760" y="154" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">4</text>
          <text x="940" y="214" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">5</text>
        </svg>

        <div class="sm-arc-stage-labels">
          ${ARC_STAGES.map(s => `<div>${s.name}</div>`).join('')}
        </div>
      </div>

      <!-- Stage Cards -->
      <div class="sm-arc-cards">
        ${ARC_STAGES.map((s, idx) => `
          <div class="sm-arc-card" style="border-top-color:${s.color}">
            <div class="sm-arc-cno">STAGE ${idx + 1}</div>
            <div class="sm-arc-cnm" style="color:${s.color}">${s.name}</div>
            <div class="sm-arc-cdesc" id="arcDesc_${idx}">${s.defaultDesc}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function wireArcEvents(container) {
  container.querySelector('#btnRunArcAI')?.addEventListener('click', async () => {
    const query = container.querySelector('#inpArcQuery')?.value || 'Animation Story';
    toast('✦ AI analyzing 5-stage dramatic arc…', 'info');

    const prompt = `Break down the classic 5-stage story arc for "${query}".
Return ONLY a JSON object with these 5 keys:
{
  "exposition": "<1 sentence on status quo / discovery>",
  "rising_action": "<1 sentence on progressive conflict / stakes>",
  "climax": "<1 sentence on the peak clash / choice>",
  "falling_action": "<1 sentence on the fallout / aftermath>",
  "resolution": "<1 sentence on the changed world>"
}`;

    try {
      const raw = await aiComplete(prompt, { json: true, temperature: 0.7 });
      const match = raw.match(/\{[\s\S]*\}/);
      const data = JSON.parse(match ? match[0] : raw);

      const keys = ['exposition', 'rising_action', 'climax', 'falling_action', 'resolution'];
      keys.forEach((k, idx) => {
        const el = container.querySelector(`#arcDesc_${idx}`);
        if (el && data[k]) el.textContent = data[k];
      });
      toast('✦ Dramatic Arc analyzed!', 'ok');
    } catch (err) {
      toast(`Arc analysis failed: ${err.message}`, 'error');
    }
  });
}

/**
 * ════════════════════════════════════════════════════════════
 * 4. BEAT DETAIL MODAL (Deep Editor)
 * ════════════════════════════════════════════════════════════
 */
export function openBeatModal(beatId) {
  activeBeatId = beatId;

  let modal = document.getElementById('kpzBeatModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'kpzBeatModal';
    modal.className = 'sm-modal-overlay hidden';
    document.body.appendChild(modal);
  }

  modal.classList.remove('hidden');
  renderBeatModalContent();
}

export function closeBeatModal() {
  const modal = document.getElementById('kpzBeatModal');
  if (modal) modal.classList.add('hidden');
  activeBeatId = null;
  ScriptState.saveToStorage();

  const container = document.getElementById('smContentArea');
  if (container && ScriptState.activeTab === 'beats') {
    renderBoardView(container);
  }
}

function renderBeatModalContent() {
  const modal = document.getElementById('kpzBeatModal');
  if (!modal || !activeBeatId) return;

  const beat = ScriptState.board.beats.find(b => b.id === activeBeatId);
  if (!beat) { closeBeatModal(); return; }

  const characters = (ScriptState.bible && ScriptState.bible.Characters) || [];

  modal.innerHTML = `
    <div class="bd-card">
      <!-- Modal Header -->
      <div class="bd-head">
        <div style="flex:1;min-width:0">
          <div class="bd-where" id="bdWhere">Act: ${beat.act?.toUpperCase() || 'ACT I'} · ${beat.kind?.toUpperCase() || 'STORY'}</div>
          <input class="bd-title" id="bdTitleInput" value="${escapeAttr(beat.title || '')}" placeholder="Beat Title…">
        </div>
        <button class="sm-btn danger" id="btnDeleteBeat" title="Delete Beat">🗑</button>
        <button class="sm-btn" id="btnCloseBeatModal" style="font-weight:700">✕</button>
      </div>

      <!-- Sub Tabs -->
      <div class="bd-tabs">
        <button class="bd-tab ${activeBeatTab === 'details' ? 'on' : ''}" data-btab="details">
          ◉ Purpose & POV
        </button>
        <button class="bd-tab ${activeBeatTab === 'content' ? 'on' : ''}" data-btab="content">
          📝 Notes & Draft
        </button>
      </div>

      <!-- Tab Body -->
      <div class="bd-body">
        ${activeBeatTab === 'details' ? `
          <!-- Beat Type Selector -->
          <div class="bd-field">
            <div class="bd-fh">Beat Dramatic Type</div>
            <div class="bd-chips" id="bdKindChips">
              ${Object.entries(BEAT_KINDS).map(([k, v]) => `
                <button class="bd-chip ${beat.kind === k ? 'on' : ''}" data-set-kind="${k}">
                  <span class="bd-cdot" style="background:${v.color}"></span>
                  ${v.label}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Conflict & Purpose Hero Box -->
          <div class="bd-field hero">
            <div class="bd-fh">⚑ Dramatic Conflict & Purpose <span class="bd-req">CRITICAL</span></div>
            <div class="bd-hint">Why does this beat exist? What turns or changes in this moment?</div>
            <textarea class="bd-ta" id="bdPurposeTa" rows="3" placeholder="e.g. Point of no return — they breach the perimeter and trigger the silent alert.">${escapeHtml(beat.purpose || '')}</textarea>
          </div>

          <!-- Character POV Focus -->
          <div class="bd-field">
            <div class="bd-fh">Character POV Focus</div>
            <div class="bd-hint">Whose subjective experience drives this scene?</div>
            <div class="bd-chips" id="bdPovChips">
              ${characters.map(c => `
                <button class="bd-chip ${beat.pov === c.name ? 'on' : ''}" data-set-pov="${escapeAttr(c.name)}">
                  <span class="bd-cdot" style="background:${c.color || '#F97316'}"></span>
                  ${escapeHtml(c.name)}
                </button>
              `).join('')}
            </div>
            <input class="bd-in" id="bdPovInput" value="${escapeAttr(beat.pov || '')}" placeholder="Or type a custom POV character...">
          </div>
        ` : `
          <!-- Content & Notes Tab -->
          <div class="bd-field">
            <label class="bd-l">Synopsis</label>
            <textarea class="bd-ta" id="bdSynopsisTa" rows="2" placeholder="One-line summary of the event...">${escapeHtml(beat.syn || '')}</textarea>
          </div>

          <div class="bd-field">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <label class="bd-l" style="margin:0">Draft & Action Notes</label>
              <button class="sm-btn" id="btnAIBeatDraft" style="padding:2px 8px;font-size:11px">✦ AI Flesh Out</button>
            </div>
            <textarea class="bd-ta bd-bodyta" id="bdDraftTa" rows="7" placeholder="Write screenplay action lines, dialogue cues, and visual staging...">${escapeHtml(beat.body || '')}</textarea>
          </div>
        `}
      </div>
    </div>
  `;

  wireBeatModalEvents(modal, beat);
}

function wireBeatModalEvents(modal, beat) {
  // Tabs
  modal.querySelectorAll('[data-btab]').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      activeBeatTab = tabBtn.getAttribute('data-btab');
      renderBeatModalContent();
    });
  });

  // Title
  modal.querySelector('#bdTitleInput')?.addEventListener('input', (e) => {
    beat.title = e.target.value;
    ScriptState.saveToStorage();
  });

  // Delete
  modal.querySelector('#btnDeleteBeat')?.addEventListener('click', () => {
    if (confirm('Delete this story beat?')) {
      const idx = ScriptState.board.beats.findIndex(b => b.id === beat.id);
      if (idx !== -1) {
        ScriptState.board.beats.splice(idx, 1);
        closeBeatModal();
        toast('Beat deleted', 'info');
      }
    }
  });

  // Close
  modal.querySelector('#btnCloseBeatModal')?.addEventListener('click', closeBeatModal);
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'kpzBeatModal') closeBeatModal();
  });

  // Kind Chips
  modal.querySelectorAll('[data-set-kind]').forEach(btn => {
    btn.addEventListener('click', () => {
      beat.kind = btn.getAttribute('data-set-kind');
      ScriptState.saveToStorage();
      renderBeatModalContent();
    });
  });

  // Purpose
  modal.querySelector('#bdPurposeTa')?.addEventListener('input', (e) => {
    beat.purpose = e.target.value;
    ScriptState.saveToStorage();
  });

  // POV
  modal.querySelectorAll('[data-set-pov]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pov = btn.getAttribute('data-set-pov');
      beat.pov = beat.pov === pov ? '' : pov;
      ScriptState.saveToStorage();
      renderBeatModalContent();
    });
  });

  modal.querySelector('#bdPovInput')?.addEventListener('input', (e) => {
    beat.pov = e.target.value;
    ScriptState.saveToStorage();
  });

  // Synopsis
  modal.querySelector('#bdSynopsisTa')?.addEventListener('input', (e) => {
    beat.syn = e.target.value;
    ScriptState.saveToStorage();
  });

  // Draft
  modal.querySelector('#bdDraftTa')?.addEventListener('input', (e) => {
    beat.body = e.target.value;
    ScriptState.saveToStorage();
  });

  // AI Flesh out
  modal.querySelector('#btnAIBeatDraft')?.addEventListener('click', async () => {
    toast('✦ AI fleshing out beat draft…', 'info');
    const prompt = `Flesh out this storyboard beat into rich screenplay action lines:
TITLE: ${beat.title}
SYNOPSIS: ${beat.syn}
PURPOSE: ${beat.purpose}
POV: ${beat.pov}

Write 2-4 concise, visually dynamic screenplay action/dialogue paragraphs ready for storyboarding.`;

    try {
      const completion = await aiComplete(prompt, { temperature: 0.8 });
      if (completion) {
        beat.body = (beat.body ? `${beat.body}\n\n` : '') + completion.trim();
        ScriptState.saveToStorage();
        renderBeatModalContent();
        toast('✦ Beat draft expanded!', 'ok');
      }
    } catch (err) {
      toast(`AI Error: ${err.message}`, 'error');
    }
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
