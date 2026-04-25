// src/ui/panel-nav.js
// v3.5.2: redesigned + button (filled circle, not dashed), better thumb spacing.
import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';
import { createPanel } from '../drawing/panels.js';
import { renderDisplay } from '../drawing/view.js';
import { renderLayersUI } from './layers-panel.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';

export function initPanelNav() {
  // v3.9.11: caption input wiring. The input lives in #canvasArea above
  // the filmstrip; we keep it in sync with the active panel's caption,
  // and write back on every keystroke (cheap — one string assignment).
  const input = $('captionInput');
  if (input) {
    input.addEventListener('input', e => {
      if (!App.project) return;
      const panel = App.project.panels[App.activePanelIdx];
      if (!panel) return;
      panel.caption = e.target.value;
      App.dirty = true; updateSaveStatus();
    });
    // Initial population — main.js calls renderPanelNav after createProject /
    // loadKpzBlob, which now also calls syncCaptionInput, but seed it here
    // too in case any other code path leaves the input out of sync.
    syncCaptionInput();
  }
}

/**
 * v3.9.11: copy the active panel's caption into the input. Called from
 * switchPanel + playback advance + after load so the strip always reflects
 * the visible panel without us listening to every state mutation.
 */
export function syncCaptionInput() {
  const input = $('captionInput');
  if (!input) return;
  const panel = App.project?.panels?.[App.activePanelIdx];
  // Don't clobber the user's in-progress edit if they're focused on the
  // input — they're typing right now, the visible value is theirs.
  if (document.activeElement === input) return;
  input.value = panel?.caption || '';
}

export function renderPanelNav() {
  const nav = $('panelNav');
  if (!nav || !App.project) return;
  nav.innerHTML = '';

  App.project.panels.forEach((p, i) => {
    const t = document.createElement('div');
    t.className = 'panel-thumb' + (i === App.activePanelIdx ? ' active' : '');
    t.innerHTML = `<span class="num">${i + 1}</span><button class="panel-del" title="Delete panel">×</button>`;
    const tc = document.createElement('canvas');
    tc.width = 54; tc.height = 40;
    const tctx = tc.getContext('2d');
    for (const layer of p.layers) {
      if (!layer.visible) continue;
      tctx.globalAlpha = layer.opacity;
      tctx.drawImage(layer.canvas, 0, 0, 54, 40);
    }
    tctx.globalAlpha = 1;
    t.style.backgroundImage = `url(${tc.toDataURL()})`;
    t.addEventListener('click', e => {
      if (e.target.classList.contains('panel-del')) {
        e.stopPropagation();
        if (App.project.panels.length <= 1) { toast("Can't delete last panel", 'error'); return; }
        if (!confirm('Delete panel ' + (i + 1) + '?')) return;
        App.project.panels.splice(i, 1);
        App.history[i] = null;
        if (App.activePanelIdx >= App.project.panels.length) App.activePanelIdx = App.project.panels.length - 1;
        App.dirty = true; updateSaveStatus();
        renderDisplay(); renderLayersUI(); renderPanelNav();
        return;
      }
      switchPanel(i);
    });
    nav.appendChild(t);
  });

  // v3.5.2: redesigned + button — solid filled circle, matches thumb height
  const addBtn = document.createElement('button');
  addBtn.className = 'panel-add-btn';
  addBtn.title = 'Add new panel';
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
  addBtn.addEventListener('click', addPanel);
  nav.appendChild(addBtn);

  const pi = $('panelInfo');
  if (pi) pi.textContent = `Panel ${App.activePanelIdx + 1} / ${App.project.panels.length}`;
}

function switchPanel(i) {
  App.activePanelIdx = i;
  renderDisplay(); renderLayersUI(); renderPanelNav();
  scrollActiveThumbIntoView();
  syncCaptionInput();             // v3.9.11
}

/**
 * v3.9.10: lightweight panel switch for animatic playback. Skips the
 * layers UI re-render (panels share layer structure visually so the layers
 * panel doesn't need to flicker every frame) but does re-render the canvas
 * and the filmstrip, and scrolls the active thumb into view so the user
 * can follow the playback position.
 *
 * v3.9.11: also syncs the caption input so the strip below the canvas
 * shows the active panel's line of dialogue as panels cycle.
 */
export function switchPanelForPlayback(i) {
  App.activePanelIdx = i;
  renderDisplay();
  renderPanelNav();
  scrollActiveThumbIntoView();
  syncCaptionInput();
}

function scrollActiveThumbIntoView() {
  const nav = $('panelNav');
  if (!nav) return;
  const active = nav.querySelector('.panel-thumb.active');
  if (!active) return;
  // Use scrollIntoView with smooth + nearest so the user sees the
  // playback head moving along the filmstrip without jumpy resets.
  active.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

export function addPanel() {
  App.project.panels.push(createPanel(App.project.width, App.project.height));
  App.activePanelIdx = App.project.panels.length - 1;
  App.dirty = true; updateSaveStatus();
  renderDisplay(); renderLayersUI(); renderPanelNav();
}

export function deletePanel() {
  if (App.project.panels.length <= 1) { toast("Can't delete last panel", 'error'); return; }
  if (!confirm('Delete this panel?')) return;
  App.project.panels.splice(App.activePanelIdx, 1);
  App.history[App.activePanelIdx] = null;
  App.activePanelIdx = Math.max(0, App.activePanelIdx - 1);
  App.dirty = true; updateSaveStatus();
  renderDisplay(); renderLayersUI(); renderPanelNav();
}
