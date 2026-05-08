// ============================================================================
//  src/ui/script-view.js
//
//  v4.0.0-rc.1 — script mode renderer.
//
//  Reads beats from `App.project.script.beats`. If the project has no script
//  yet, renders an empty state with a "Create script" affordance.
//
//  Beat shape (from wireframes-v3-script.jsx):
//    { beat: 1, panel: 1, head: 'EXT. ROOFTOP — NIGHT',
//      body: 'Wide. Rain. Mira lands silent on the gravel.', current: false }
//
//  Clicking a beat's panel-link thumbnail jumps the storyboard to that panel.
// ============================================================================

import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';

/**
 * Re-render the script view from current App state. Idempotent — safe to call
 * any time the project changes.
 */
export function renderScriptView() {
  const body = $('scriptViewBody');
  const title = $('scriptViewTitle');
  if (!body) return;

  const project = App.project;
  if (!project) {
    body.innerHTML = `<div class="v3-beat-empty">No project loaded.</div>`;
    return;
  }

  if (title) {
    title.textContent = project.name ? `Script — ${project.name}` : 'Script';
  }

  const beats = (project.script && Array.isArray(project.script.beats))
    ? project.script.beats : [];

  if (beats.length === 0) {
    body.innerHTML = `
      <div class="v3-beat-empty">
        <p>No script yet for this project.</p>
        <p style="margin-top:14px">
          <button class="v3-btn accent" id="scriptCreateBtn">+ Add first beat</button>
        </p>
        <p style="margin-top:18px;font-size:11px;color:var(--v3-ink-mute,#8a857d)">
          Beats are tied to storyboard panels — each beat references a panel
          number, so jumping between script and canvas keeps you in sync.
        </p>
      </div>
    `;
    $('scriptCreateBtn')?.addEventListener('click', addFirstBeat);
    return;
  }

  const html = beats.map(b => {
    const isCurrent = !!b.current;
    const headHtml = b.head ? `<div style="font-weight:bold;margin-bottom:4px">${esc(b.head)}</div>` : '';
    const bodyHtml = `<div style="white-space:pre-line">${esc(b.body || '')}</div>`;
    return `
      <div class="v3-beat ${isCurrent ? 'current' : ''}" data-panel="${b.panel || ''}">
        <div class="v3-beat-meta">
          <span>Beat ${b.beat || '?'}</span>
          ${b.panel != null
            ? `<span class="v3-beat-link" data-jump="${b.panel}" title="Jump to panel ${b.panel}">${b.panel}</span>
               <span>→ Panel ${b.panel}</span>`
            : ''}
          ${isCurrent ? '<span style="color:var(--v3-accent,#ff7a45)">◀ now</span>' : ''}
        </div>
        ${headHtml}
        ${bodyHtml}
      </div>
    `;
  }).join('');

  body.innerHTML = html;

  body.querySelectorAll('[data-jump]').forEach(el => {
    el.addEventListener('click', (e) => {
      const panel1 = parseInt(el.dataset.jump, 10);
      if (Number.isNaN(panel1)) return;
      jumpToPanel(panel1 - 1);
      e.stopPropagation();
    });
  });
}

/**
 * Create a new empty script with one starter beat tied to the first panel.
 */
function addFirstBeat() {
  if (!App.project) return;
  if (!App.project.script) App.project.script = {};
  if (!Array.isArray(App.project.script.beats)) App.project.script.beats = [];
  App.project.script.beats.push({
    beat: 1, panel: 1, head: '', body: '', current: true,
  });
  App.dirty = true;
  renderScriptView();
}

/**
 * Switch active storyboard panel. Best-effort — uses lazy-imported renderers
 * so this module doesn't introduce circular deps.
 */
function jumpToPanel(panelIdx0) {
  if (panelIdx0 < 0) panelIdx0 = 0;
  if (App.project && App.project.panels && panelIdx0 >= App.project.panels.length) {
    panelIdx0 = App.project.panels.length - 1;
  }
  App.activePanelIdx = panelIdx0;
  Promise.all([
    import('../drawing/view.js'),
    import('./panel-nav.js'),
  ]).then(([view, nav]) => {
    if (typeof nav.renderPanelNav === 'function') nav.renderPanelNav();
    if (typeof view.renderDisplay === 'function') view.renderDisplay();
  }).catch(() => {});
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
