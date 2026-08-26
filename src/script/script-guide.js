// src/script/script-guide.js
// ⛰ Story Path 7-Phase Roadmap Drawer for KPZ Draw.
// Guides writers from initial Spark → Logline → Characters → Acts → Sequences → Beat Sheet → Full Screenplay.
// Tracks live completion % and offers context-aware ✦ AI drafts for each phase.

import { ScriptState } from './script-state.js';
import { aiComplete } from './script-ai.js';
import { toast } from '../ui/toast.js';
import { App } from '../core/state.js';

export const STORY_PHASES = [
  {
    id: 'spark',
    n: 1,
    title: 'Phase 1: Spark & Idea Inbox',
    goal: 'Capture every raw image, hook, premise, or transcript fragment without filter.',
    where: '✦ Inbox & AI Tab',
    computeProgress() {
      const ideasCount = (ScriptState.inbox && ScriptState.inbox.length) || 0;
      const beatsCount = (ScriptState.board && ScriptState.board.beats && ScriptState.board.beats.length) || 0;
      const total = ideasCount + beatsCount;
      return { done: total > 0 ? 1 : 0, total: 1, label: total > 0 ? `${total} items captured` : 'Nothing captured yet' };
    }
  },
  {
    id: 'logline',
    n: 2,
    title: 'Phase 2: Logline & Premise Hook',
    goal: 'One sentence defining Protagonist + Flaw + Inciting Event + Goal + Stakes.',
    where: 'Top of Bible / Title block',
    computeProgress() {
      const ok = (ScriptState.logline || '').trim().length > 15;
      return { done: ok ? 1 : 0, total: 1, label: ok ? 'Logline established' : 'No logline yet' };
    }
  },
  {
    id: 'chars',
    n: 3,
    title: 'Phase 3: Core Cast & Conflicting Wants',
    goal: 'Establish Protagonist, Antagonist, and core relationships with conscious want & subconscious need.',
    where: '📖 Bible → Characters',
    computeProgress() {
      const chars = (ScriptState.bible && ScriptState.bible.Characters) || [];
      const withGoals = chars.filter(c => c.fields && (c.fields.goal || c.fields.conflict)).length;
      return { done: withGoals, total: Math.max(chars.length, 1), label: chars.length ? `${withGoals}/${chars.length} with goal & conflict` : 'No cast added' };
    }
  },
  {
    id: 'acts',
    n: 4,
    title: 'Phase 4: Act Structure & Turning Points',
    goal: 'Summarize the emotional and plot turning job of Act I, Act II-A, Act II-B, and Act III.',
    where: '☰ Beats → Acts',
    computeProgress() {
      const acts = (ScriptState.board && ScriptState.board.lanes && ScriptState.board.lanes.act) || [];
      return { done: acts.length > 0 ? 1 : 0, total: 1, label: `${acts.length} act columns ready` };
    }
  },
  {
    id: 'seqs',
    n: 5,
    title: 'Phase 5: Sequence Breakdown & Pacing',
    goal: 'Organize the narrative into 8-12 minute rhythmic story sequences.',
    where: '☰ Beats → Sequences',
    computeProgress() {
      const seqs = (ScriptState.board && ScriptState.board.lanes && ScriptState.board.lanes.sequence) || [];
      return { done: seqs.length > 0 ? 1 : 0, total: 1, label: `${seqs.length} sequences active` };
    }
  },
  {
    id: 'beats',
    n: 6,
    title: 'Phase 6: Beat Sheet & Scene Purposes',
    goal: 'Ensure every beat has a clear purpose and dramatic conflict driving it.',
    where: '☰ Beats → Board',
    computeProgress() {
      const beats = (ScriptState.board && ScriptState.board.beats) || [];
      const withPurpose = beats.filter(b => (b.purpose || '').trim()).length;
      return { done: withPurpose, total: Math.max(beats.length, 1), label: beats.length ? `${withPurpose}/${beats.length} beats with defined purpose` : 'No beats placed' };
    }
  },
  {
    id: 'draft',
    n: 7,
    title: 'Phase 7: Screenplay Draft & Dialogue',
    goal: 'Transform structured beats into living screenplay action, character voice, and storyboard visuals.',
    where: '📝 Screenplay / Split View',
    computeProgress() {
      const blocks = ScriptState.blocks || [];
      const drafted = blocks.filter(b => (b.text || '').trim().length > 10).length;
      return { done: drafted, total: Math.max(blocks.length, 1), label: `${drafted} screenplay blocks written` };
    }
  }
];

let isGuideOpen = false;

/**
 * Open or toggle the Story Path Roadmap Drawer
 */
export function closeStoryPathDrawer() {
  isGuideOpen = false;
  const drawer = document.getElementById('kpzStoryPathDrawer');
  if (drawer) drawer.classList.add('hidden');
}

export function openStoryPathDrawer() {
  isGuideOpen = true;
  let drawer = document.getElementById('kpzStoryPathDrawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'kpzStoryPathDrawer';
    drawer.className = 'sm-guide-drawer-overlay hidden';
    document.body.appendChild(drawer);
  }
  drawer.classList.remove('hidden');
  renderStoryPathContent();
}

export function toggleStoryPathDrawer(force = null) {
  if (force === true) openStoryPathDrawer();
  else if (force === false) closeStoryPathDrawer();
  else if (isGuideOpen) closeStoryPathDrawer();
  else openStoryPathDrawer();
}

function renderStoryPathContent() {
  const drawer = document.getElementById('kpzStoryPathDrawer');
  if (!drawer) return;

  let totalPct = 0;
  const phaseStats = STORY_PHASES.map(p => {
    const prog = p.computeProgress();
    const pct = Math.min(100, Math.round((prog.done / prog.total) * 100));
    totalPct += pct;
    return { p, prog, pct };
  });
  const overallPct = Math.round(totalPct / STORY_PHASES.length);

  drawer.innerHTML = `
    <div class="sm-guide-drawer">
      <!-- Drawer Header -->
      <div class="sm-guide-header">
        <div>
          <div style="font-weight:700;font-size:15px;color:var(--sm-text);display:flex;align-items:center;gap:8px">
            <span>⛰</span>
            <span>Story Path Roadmap</span>
            <span class="sm-count-badge" style="color:var(--sm-accent)">${overallPct}% Complete</span>
          </div>
          <div style="font-size:11px;color:var(--sm-text-muted);margin-top:2px">Structured 7-phase screenwriting workflow from spark to production</div>
        </div>
        <button class="sm-btn" id="btnCloseGuideDrawer" style="font-weight:700">✕</button>
      </div>

      <!-- Live Overall Progress Bar -->
      <div class="sm-guide-progbar-wrap">
        <div class="sm-guide-progbar">
          <div class="sm-guide-progbar-fill" style="width:${overallPct}%"></div>
        </div>
      </div>

      <!-- Phase Cards List -->
      <div class="sm-guide-phases">
        ${phaseStats.map(({ p, prog, pct }, idx) => `
          <div class="sm-guide-card ${pct >= 100 ? 'done' : (pct > 0 ? 'active' : '')}">
            <div class="sm-gcard-top">
              <span class="sm-gcard-no">${p.n}</span>
              <div class="sm-gcard-title">${escapeHtml(p.title)}</div>
              <span class="sm-gcard-pct">${pct}%</span>
            </div>

            <div class="sm-gcard-goal">${escapeHtml(p.goal)}</div>

            <div class="sm-gcard-meta">
              <span class="sm-gcard-loc">📍 ${escapeHtml(p.where)}</span>
              <span class="sm-gcard-stat">${escapeHtml(prog.label)}</span>
            </div>

            ${p.id === 'logline' ? `
              <!-- Inline Logline Editor -->
              <div class="sm-gcard-logline-box">
                <input type="text" class="sm-gcard-logline-input" id="inpGuideLogline"
                       value="${escapeAttr(ScriptState.logline || '')}"
                       placeholder="e.g. When a solar storm hits, a lone animator must restore the archives before power fails.">
                <button class="sm-btn primary" id="btnSaveGuideLogline" style="padding:4px 8px;font-size:11px">Save Logline</button>
              </div>
            ` : ''}

            <!-- AI Assist Button for Phase -->
            <div class="sm-gcard-actions">
              <button class="sm-btn" data-guide-ai="${p.id}" style="padding:4px 10px;font-size:11px">
                ✦ AI Draft for ${p.title.split(':')[0]}
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  wireGuideEvents(drawer);
}

function wireGuideEvents(drawer) {
  drawer.querySelector('#btnCloseGuideDrawer')?.addEventListener('click', () => toggleStoryPathDrawer(false));
  drawer.addEventListener('click', (e) => {
    if (e.target.id === 'kpzStoryPathDrawer') toggleStoryPathDrawer(false);
  });

  // Save Logline inline
  drawer.querySelector('#btnSaveGuideLogline')?.addEventListener('click', () => {
    const input = drawer.querySelector('#inpGuideLogline');
    if (input) {
      ScriptState.logline = input.value.trim();
      ScriptState.saveToStorage();
      renderStoryPathContent();
      toast('Logline saved!', 'ok');
    }
  });

  // Phase AI drafting
  drawer.querySelectorAll('[data-guide-ai]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const phaseId = btn.getAttribute('data-guide-ai');
      await executePhaseAIDraft(phaseId);
    });
  });
}

async function executePhaseAIDraft(phaseId) {
  const projectTitle = (App.project && App.project.name) || 'Animation Production';
  toast(`✦ AI drafting guidance for ${phaseId}…`, 'info');

  let prompt = '';
  if (phaseId === 'spark') {
    prompt = `Brainstorm 5 explosive, high-concept premise sparks and scene hooks for an animation titled "${projectTitle}".
Return clean bullet points.`;
  } else if (phaseId === 'logline') {
    prompt = `Draft 3 punchy, high-stakes 1-sentence loglines for "${projectTitle}" following the formula: [Inciting Incident] + [Flawed Hero] + [Action/Goal] + [Ticking Clock Stakes].`;
  } else if (phaseId === 'chars') {
    prompt = `List the 3 essential characters (Protagonist, Antagonist, Catalyst) for "${projectTitle}" with their conscious WANT and subconscious NEED.`;
  } else if (phaseId === 'acts') {
    prompt = `Write a 1-paragraph dramatic pitch for each of the 3 acts of "${projectTitle}":
Act I: Status Quo & Disruption
Act II: Escalation, Midpoint Reversal & Dark Night
Act III: Climax, Sacrifice & Resolution`;
  } else {
    prompt = `Generate a compelling beat breakdown for the next crucial story turn in "${projectTitle}".`;
  }

  try {
    const res = await aiComplete(prompt, { temperature: 0.8 });
    if (res) {
      alert(`✦ AI Story Path Suggestions:\n\n${res}`);
    }
  } catch (err) {
    toast(`AI Draft failed: ${err.message}`, 'error');
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
