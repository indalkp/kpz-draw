// src/ui/brush-panel.js
// Right panel Brush tab: size/opacity/hardness/smoothing sliders, color picker, swatches.
//
// v3.8.0: updateBrushUI now also refreshes the mobile brush dock so that
// slider changes made in the desktop right panel instantly mirror on the
// mobile vertical sliders (same App state, two visual representations).
//
// v3.8.3 (M3): exported setBrushColor() as the single entry point for
// "set the current brush colour". It updates App.brush.color and syncs
// every place that displays it — desktop picker, mobile topbar swatch,
// mobile color hex label. Previously several places (swatch click,
// eyedropper, ref color pick, mobile color modal) each set a subset,
// leaving the others stale on viewport/context switches.

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';
import { updateBrushDock } from './brush-dock.js';   // v3.8.0

const SWATCH_COLORS = [
  '#000000','#1a1a1a','#4a4a4a','#888888','#cccccc','#ffffff','#ff7a45','#ffb088',
  '#e55353','#f5a623','#f8e71c','#7ed321','#50e3c2','#4a90e2','#9013fe','#bd10e0',
];

/**
 * v3.8.3 (M3): canonical "set current colour" helper. Call this from
 * anywhere that changes App.brush.color. Syncs every UI surface that
 * shows the current colour so no surface goes stale.
 */
export function setBrushColor(hex) {
  if (!hex) return;
  App.brush.color = hex;
  // Desktop right-panel color <input type="color">
  const cp = $('colorPicker');
  if (cp) cp.value = hex;
  // Mobile topbar colour swatch
  const mtbColor = $('mtbColor');
  if (mtbColor) mtbColor.style.background = hex;
  // Mobile color modal hex readout
  const mHex = $('mColorHex');
  if (mHex) mHex.textContent = hex.toUpperCase();
}

export function initBrushPanel() {
  $('brushSize')?.addEventListener('input', e => { App.brush.size = +e.target.value; updateBrushUI(); });
  $('brushOpacity')?.addEventListener('input', e => { App.brush.opacity = +e.target.value / 100; updateBrushUI(); });
  $('brushHardness')?.addEventListener('input', e => { App.brush.hardness = +e.target.value / 100; updateBrushUI(); });
  $('brushSmoothing')?.addEventListener('input', e => { App.brush.smoothing = +e.target.value / 100; updateBrushUI(); });
  $('presSize')?.addEventListener('input', e => { App.brush.presSize = +e.target.value / 100; updateBrushUI(); });
  $('presOp')?.addEventListener('input', e => { App.brush.presOp = +e.target.value / 100; updateBrushUI(); });
  // v3.8.3 (M3): route through setBrushColor so mobile surfaces stay in sync
  $('colorPicker')?.addEventListener('input', e => setBrushColor(e.target.value));

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

  // v3.8.0: keep the mobile vertical dock in sync. No-op on desktop (dock hidden).
  updateBrushDock();
}

function renderSwatches() {
  const sw = $('swatches');
  if (!sw) return;
  sw.innerHTML = '';
  SWATCH_COLORS.forEach(c => {
    const el = document.createElement('div');
    el.className = 'swatch';
    el.style.background = c;
    // v3.8.3 (M3): use the shared helper so clicking a desktop swatch also
    // updates the mobile topbar swatch + hex label.
    el.addEventListener('click', () => setBrushColor(c));
    sw.appendChild(el);
  });
}
