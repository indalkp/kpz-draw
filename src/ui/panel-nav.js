// src/ui/panel-nav.js
// v3.5.2: redesigned + button (filled circle, not dashed), better thumb spacing.
import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';
import { createPanel } from '../drawing/panels.js';
import { renderDisplay } from '../drawing/view.js';
import { renderLayersUI } from './layers-panel.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';

export function initPanelNav() {}

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
