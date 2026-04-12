// src/ui/layers-panel.js
// Right panel Layers tab: layer list, visibility, lock, rename, add/dup/del.

import { App } from '../core/state.js';
import { $, escapeHtml } from '../utils/dom-helpers.js';
import { createLayer } from '../drawing/layers.js';
import { curPanel } from '../drawing/panels.js';
import { renderDisplay } from '../drawing/view.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';

const eyeOpenSvg = '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
const eyeClosedSvg = '<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z"/></svg>';
const lockedSvg = '<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/></svg>';
const unlockedSvg = '<svg viewBox="0 0 24 24" opacity=".5"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75-.14.54.18 1.08.72 1.22.53.14 1.08-.18 1.22-.72C9.44 3.93 10.63 3 12 3c1.65 0 3 1.35 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/></svg>';

export function initLayersPanel() {
  $('btnAddLayer')?.addEventListener('click', () => {
    const p = curPanel();
    p.layers.push(createLayer(App.project.width, App.project.height, 'Layer ' + (p.layers.length + 1)));
    p.activeLayer = p.layers.length - 1;
    renderLayersUI(); renderDisplay();
    App.dirty = true; updateSaveStatus();
  });
  $('btnDupLayer')?.addEventListener('click', () => {
    const p = curPanel();
    const src = p.layers[p.activeLayer];
    const dup = createLayer(App.project.width, App.project.height, src.name + ' copy');
    dup.canvas.getContext('2d').drawImage(src.canvas, 0, 0);
    dup.opacity = src.opacity; dup.blend = src.blend;
    p.layers.splice(p.activeLayer + 1, 0, dup);
    p.activeLayer++;
    renderLayersUI(); renderDisplay();
    App.dirty = true; updateSaveStatus();
  });
  $('btnDelLayer')?.addEventListener('click', () => {
    const p = curPanel();
    if (p.layers.length <= 1) { toast("Can't delete last layer", 'error'); return; }
    p.layers.splice(p.activeLayer, 1);
    p.activeLayer = Math.max(0, p.activeLayer - 1);
    renderLayersUI(); renderDisplay();
    App.dirty = true; updateSaveStatus();
  });
}

export function renderLayersUI() {
  const list = $('layersList');
  if (!list) return;
  list.innerHTML = '';
  const panel = curPanel();
  for (let i = panel.layers.length - 1; i >= 0; i--) {
    const layer = panel.layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (i === panel.activeLayer ? ' active' : '') + (layer.locked ? ' locked' : '');
    item.innerHTML = `
      <button class="vis" data-i="${i}" title="Toggle visibility">${layer.visible ? eyeOpenSvg : eyeClosedSvg}</button>
      <button class="lock" data-i="${i}" title="${layer.locked ? 'Unlock' : 'Lock'}">${layer.locked ? lockedSvg : unlockedSvg}</button>
      <div class="layer-thumb"><canvas data-thumb="${i}" width="40" height="40"></canvas></div>
      <div class="name" data-i="${i}">${escapeHtml(layer.name)}</div>`;

    item.addEventListener('click', e => {
      if (e.target.closest('.vis') || e.target.closest('.lock')) return;
      panel.activeLayer = i;
      renderLayersUI();
    });
    list.appendChild(item);
    updateLayerThumb(i);
  }

  list.querySelectorAll('.vis').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      panel.layers[+b.dataset.i].visible = !panel.layers[+b.dataset.i].visible;
      renderDisplay(); renderLayersUI();
    });
  });
  list.querySelectorAll('.lock').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      panel.layers[+b.dataset.i].locked = !panel.layers[+b.dataset.i].locked;
      renderLayersUI();
    });
  });
  list.querySelectorAll('.name').forEach(n => {
    n.addEventListener('dblclick', () => {
      const i = +n.dataset.i;
      const inp = document.createElement('input');
      inp.value = panel.layers[i].name;
      n.innerHTML = ''; n.appendChild(inp); inp.focus(); inp.select();
      const commit = () => { panel.layers[i].name = inp.value || 'Layer'; renderLayersUI(); };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
    });
  });
}

export function updateLayerThumb(i) {
  const c = document.querySelector(`#layersList canvas[data-thumb="${i}"]`);
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const layer = curPanel().layers[i];
  if (layer) ctx.drawImage(layer.canvas, 0, 0, c.width, c.height);
}
