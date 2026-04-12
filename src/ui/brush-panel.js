// src/ui/brush-panel.js
// Right panel Brush tab: size/opacity/hardness/smoothing sliders, color picker, swatches.

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';

const SWATCH_COLORS = [
  '#000000','#1a1a1a','#4a4a4a','#888888','#cccccc','#ffffff','#ff7a45','#ffb088',
  '#e55353','#f5a623','#f8e71c','#7ed321','#50e3c2','#4a90e2','#9013fe','#bd10e0',
];

export function initBrushPanel() {
  $('brushSize')?.addEventListener('input', e => { App.brush.size = +e.target.value; updateBrushUI(); });
  $('brushOpacity')?.addEventListener('input', e => { App.brush.opacity = +e.target.value / 100; updateBrushUI(); });
  $('brushHardness')?.addEventListener('input', e => { App.brush.hardness = +e.target.value / 100; updateBrushUI(); });
  $('brushSmoothing')?.addEventListener('input', e => { App.brush.smoothing = +e.target.value / 100; updateBrushUI(); });
  $('presSize')?.addEventListener('input', e => { App.brush.presSize = +e.target.value / 100; updateBrushUI(); });
  $('presOp')?.addEventListener('input', e => { App.brush.presOp = +e.target.value / 100; updateBrushUI(); });
  $('colorPicker')?.addEventListener('input', e => { App.brush.color = e.target.value; });

  renderSwatches();
}

export function updateBrushUI() {
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('sizeVal', App.brush.size + ' px');
  set('opacityVal', Math.round(App.brush.opacity * 100) + '%');
  set('hardnessVal', Math.round(App.brush.hardness * 100) + '%');
  set('smoothingVal', Math.round(App.brush.smoothing * 100) + '%');
  set('presSizeVal', Math.round(App.brush.presSize * 100) + '%');
  set('presOpVal', Math.round(App.brush.presOp * 100) + '%');
}

function renderSwatches() {
  const sw = $('swatches');
  if (!sw) return;
  sw.innerHTML = '';
  SWATCH_COLORS.forEach(c => {
    const el = document.createElement('div');
    el.className = 'swatch';
    el.style.background = c;
    el.addEventListener('click', () => {
      App.brush.color = c;
      const cp = $('colorPicker');
      if (cp) cp.value = c;
    });
    sw.appendChild(el);
  });
}
