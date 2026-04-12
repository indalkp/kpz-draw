// src/ui/modals.js
// New project, Save, and Open file modal dialogs.

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';
import { createProject } from '../drawing/panels.js';
import { renderDisplay, fitView } from '../drawing/view.js';
import { renderLayersUI } from './layers-panel.js';
import { renderPanelNav } from './panel-nav.js';
import { renderRefs } from './references.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';
import { serializeKpz, loadKpzBlob } from '../storage/kpz-format.js';
import { downloadBlob } from '../storage/kpz-format.js';
import { exportPsdBlob } from '../storage/psd-export.js';
import { saveToWix } from '../storage/wix-bridge.js';
import { createLayer } from '../drawing/layers.js';
import { pushHistory } from '../drawing/history.js';
import { curPanel } from '../drawing/panels.js';

export function initModals() {
  // New modal
  $('newCancel')?.addEventListener('click', () => $('newModal')?.classList.remove('open'));
  $('newCreate')?.addEventListener('click', createNewProject);
  $('newPreset')?.addEventListener('change', e => {
    if (e.target.value === 'custom') return;
    const [w, h] = e.target.value.split('x');
    if ($('newW')) $('newW').value = w;
    if ($('newH')) $('newH').value = h;
  });

  // Save modal
  $('saveCancel')?.addEventListener('click', () => $('saveModal')?.classList.remove('open'));
  $$('.save-target').forEach(b => b.addEventListener('click', () => doSave(b.dataset.target)));

  // File input
  $('fileInput')?.addEventListener('change', handleFileOpen);
}

function createNewProject() {
  const name = $('newName')?.value || 'Untitled';
  const w = parseInt($('newW')?.value) || 1280;
  const h = parseInt($('newH')?.value) || 720;
  App.project = createProject(name, w, h);
  App.activePanelIdx = 0;
  App.history = []; App.historyIdx = [];
  App.currentProjectId = null;
  const disp = $('displayCanvas');
  if (disp) { disp.width = w; disp.height = h; }
  fitView();
  renderDisplay(); renderLayersUI(); renderPanelNav(); renderRefs();
  App.dirty = false; updateSaveStatus();
  $('newModal')?.classList.remove('open');
}

async function doSave(target) {
  $('saveModal')?.classList.remove('open');

  if (target === 'local-kpz') {
    const blob = await serializeKpz();
    await downloadBlob(blob, (App.project.name || 'untitled') + '.kpz');
    App.dirty = false; updateSaveStatus();
    toast('Saved .kpz file', 'ok');
    return;
  }
  if (target === 'local-psd') {
    try {
      const blob = exportPsdBlob();
      await downloadBlob(blob, (App.project.name || 'untitled') + '.psd');
      toast('PSD exported', 'ok');
    } catch (err) {
      toast('PSD export failed: ' + err.message, 'error');
      console.error(err);
    }
    return;
  }
  if (target === 'local-png') {
    const disp = $('displayCanvas');
    const blob = await new Promise(res => disp.toBlob(res, 'image/png'));
    await downloadBlob(blob, (App.project.name || 'untitled') + '.png');
    toast('PNG exported', 'ok');
    return;
  }
  if (target === 'wix') {
    if (!App.inWix) { toast('Open this app on indalkp.com/draw to save to your site', 'error'); return; }
    await saveToWix();
    return;
  }
}

async function handleFileOpen(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (f.name.endsWith('.kpz')) {
    await loadKpzBlob(f);
  } else if (f.type.startsWith('image/')) {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      pushHistory();
      const layer = createLayer(App.project.width, App.project.height, f.name);
      const ctx = layer.canvas.getContext('2d');
      const r = Math.min(App.project.width / img.width, App.project.height / img.height);
      const w = img.width * r, h = img.height * r;
      ctx.drawImage(img, (App.project.width - w) / 2, (App.project.height - h) / 2, w, h);
      curPanel().layers.push(layer);
      curPanel().activeLayer = curPanel().layers.length - 1;
      renderLayersUI(); renderDisplay();
      URL.revokeObjectURL(url);
      App.dirty = true; updateSaveStatus();
    };
    img.src = url;
  }
  e.target.value = '';
}
