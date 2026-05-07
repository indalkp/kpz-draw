// src/ui/toolrail.js
// Left tool rail: brush, eraser, eyedropper, hand, zoom, clear.

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';
import { setZoom } from '../drawing/view.js';
import { renderDisplay } from '../drawing/view.js';
import { curLayer, curPanel } from '../drawing/panels.js';
import { pushHistory } from '../drawing/history.js';
import { updateLayerThumb } from './layers-panel.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';

// v3.20.0: brush chip mirrors the active tool so users can see at a glance
// which tool is wired through the chip's size/color readout. Single source
// of truth — labels are 1:1 with the four tool ids.
const TOOL_LABELS = { brush: 'Brush', eraser: 'Eraser', eyedropper: 'Picker', hand: 'Pan' };

export function initToolRail() {
  // Tool buttons
  $$('.tool-btn[data-tool]').forEach(b => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });

  // Zoom buttons
  $('btnZoomIn')?.addEventListener('click', () => setZoom(App.view.scale * 1.25));
  $('btnZoomOut')?.addEventListener('click', () => setZoom(App.view.scale * 0.8));

  // Clear layer
  $('btnClear')?.addEventListener('click', () => {
    if (!confirm('Clear current layer?')) return;
    pushHistory();
    const c = curLayer().canvas;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    renderDisplay();
    updateLayerThumb(curPanel().activeLayer);
    App.dirty = true;
    updateSaveStatus();
  });

  // Fit presets
  $$('#fitPresets button').forEach(b => {
    b.addEventListener('click', () => {
      const v = b.dataset.fit;
      if (v === 'fit') { import('../drawing/view.js').then(m => m.fitView()); }
      else if (v === 'width') { import('../drawing/view.js').then(m => m.fitView('width')); }
      else if (v === '100') setZoom(1);
    });
  });
}

/**
 * Activate a tool by name and update the tool rail button states.
 * @param {string} t - Tool name: 'brush' | 'eraser' | 'eyedropper' | 'hand'
 */
export function setTool(t) {
  App.tool = t;
  $$('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  const disp = $('displayCanvas');
  if (disp) disp.style.cursor = (t === 'hand') ? 'grab' : 'crosshair';
  const chipTool = $('brushChipTool');
  if (chipTool) chipTool.textContent = TOOL_LABELS[t] || t;
}
