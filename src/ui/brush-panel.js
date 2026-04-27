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
//
// v3.9.1: anchored brush popover. A new #brushChip in the desktop topbar
// opens a popover (#brushPopover) with the same controls as the right-panel
// Brush tab. Both surfaces drive App.brush; updateBrushUI() now also
// refreshes the chip, the popover sliders/labels, and the live stroke
// preview inside the popover. Caret on the popover points back at the
// chip so the parent/child relationship is visually obvious.

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
 *
 * v3.9.1: also syncs the new brush chip swatch in the topbar and the
 * popover's color picker / live stroke preview.
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
  // v3.9.1: brush chip swatch in desktop topbar
  const chipSw = $('brushChipSwatch');
  if (chipSw) chipSw.style.background = hex;
  // v3.9.1: popover colour picker
  const bpCp = $('bpColorPicker');
  if (bpCp) bpCp.value = hex;
  // v3.9.1: popover live stroke preview
  const previewPath = $('bpStrokePath');
  if (previewPath) previewPath.setAttribute('stroke', hex);
}

export function initBrushPanel() {
  // Right-panel Brush tab inputs
  $('brushSize')?.addEventListener('input', e => { App.brush.size = +e.target.value; updateBrushUI(); });
  $('brushOpacity')?.addEventListener('input', e => { App.brush.opacity = +e.target.value / 100; updateBrushUI(); });
  $('brushHardness')?.addEventListener('input', e => { App.brush.hardness = +e.target.value / 100; updateBrushUI(); });
  $('brushSmoothing')?.addEventListener('input', e => { App.brush.smoothing = +e.target.value / 100; updateBrushUI(); });
  // v3.16.0 Phase 7a: stabilization slider (Procreate-style line lag).
  $('brushStabilization')?.addEventListener('input', e => { App.brush.stabilization = +e.target.value / 100; updateBrushUI(); });
  // v3.18.0 Phase 9: pressure curve. Stored as 0..1; mapped to a power
  // exponent at apply time in canvas.js#moveStroke.
  $('brushPressureCurve')?.addEventListener('input', e => { App.brush.pressureCurve = +e.target.value / 100; updateBrushUI(); });
  $('presSize')?.addEventListener('input', e => { App.brush.presSize = +e.target.value / 100; updateBrushUI(); });
  $('presOp')?.addEventListener('input', e => { App.brush.presOp = +e.target.value / 100; updateBrushUI(); });
  // v3.8.3 (M3): route through setBrushColor so mobile surfaces stay in sync
  $('colorPicker')?.addEventListener('input', e => setBrushColor(e.target.value));

  renderSwatches();

  // v3.9.1: anchored brush popover wiring. Uses parallel IDs (bp*) so both
  // the right-panel tab and the popover can coexist — both drive the same
  // App.brush state and updateBrushUI() refreshes BOTH surfaces.
  initBrushPopover();
}

// ---------------------------------------------------------------------------
// v3.9.1: brush popover anchored to the topbar #brushChip.
// ---------------------------------------------------------------------------

/**
 * Wire chip click → toggle popover; popover's parallel inputs → App.brush;
 * close on backdrop click and Escape.
 */
function initBrushPopover() {
  const chip = $('brushChip');
  const pop  = $('brushPopover');
  if (!chip || !pop) return;

  // Toggle on chip click
  chip.addEventListener('click', e => {
    e.stopPropagation();
    if (pop.classList.contains('open')) {
      closeBrushPopover();
    } else {
      openBrushPopover();
    }
  });

  // Close button inside popover
  $('bpClose')?.addEventListener('click', closeBrushPopover);

  // Click outside the popover closes it. Clicks on the chip itself are
  // handled by its own listener above (which toggles), so we ignore them
  // here to avoid double-close-then-reopen.
  document.addEventListener('mousedown', e => {
    if (!pop.classList.contains('open')) return;
    if (pop.contains(e.target)) return;
    if (chip.contains(e.target)) return;
    closeBrushPopover();
  });

  // Escape closes the popover. Doesn't conflict with other escape handlers
  // because we only act when the popover is open.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pop.classList.contains('open')) {
      closeBrushPopover();
      // Stop here so the same Escape doesn't also close other things on the page.
      e.stopPropagation();
    }
  });

  // Tabs inside the popover (Brush / Pressure)
  $$('#brushPopover .bp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.bpTab;
      $$('#brushPopover .bp-tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('#brushPopover .bp-tab-pane').forEach(p =>
        p.classList.toggle('active', p.dataset.bpPane === target)
      );
    });
  });

  // Parallel inputs — same App.brush state as the right-panel tab. Each
  // listener updates state then calls updateBrushUI(), which now also pushes
  // values back into the OTHER surface's sliders (see updateBrushUI below).
  $('bpSize')?.addEventListener('input', e => { App.brush.size = +e.target.value; updateBrushUI(); });
  $('bpOpacity')?.addEventListener('input', e => { App.brush.opacity = +e.target.value / 100; updateBrushUI(); });
  $('bpHardness')?.addEventListener('input', e => { App.brush.hardness = +e.target.value / 100; updateBrushUI(); });
  $('bpSmoothing')?.addEventListener('input', e => { App.brush.smoothing = +e.target.value / 100; updateBrushUI(); });
  // v3.16.0 Phase 7a: parallel stabilization slider in popover.
  $('bpStabilization')?.addEventListener('input', e => { App.brush.stabilization = +e.target.value / 100; updateBrushUI(); });
  // v3.18.0 Phase 9: parallel pressure curve slider in popover.
  $('bpPressureCurve')?.addEventListener('input', e => { App.brush.pressureCurve = +e.target.value / 100; updateBrushUI(); });
  $('bpPresSize')?.addEventListener('input', e => { App.brush.presSize = +e.target.value / 100; updateBrushUI(); });
  $('bpPresOp')?.addEventListener('input', e => { App.brush.presOp = +e.target.value / 100; updateBrushUI(); });
  $('bpColorPicker')?.addEventListener('input', e => setBrushColor(e.target.value));

  // Swatches inside popover — same set as the right-panel tab.
  renderPopoverSwatches();
}

/**
 * Open + position the popover below the chip. Recompute on every open so
 * the popover follows the chip if the topbar reflows (e.g. window resize
 * while popover was previously visible).
 */
function openBrushPopover() {
  const chip = $('brushChip');
  const pop  = $('brushPopover');
  if (!chip || !pop) return;
  const r = chip.getBoundingClientRect();
  // Popover top: just below the chip with a small gap for the caret.
  // Popover left: aligned with the chip's left edge, but clamped to viewport
  // so it never overflows the right side on small windows.
  const POP_W = 280; // matches the .bp-pop CSS width
  const margin = 8;
  let left = r.left;
  if (left + POP_W + margin > window.innerWidth) {
    left = window.innerWidth - POP_W - margin;
  }
  pop.style.top  = (r.bottom + 10) + 'px';
  pop.style.left = left + 'px';
  // Caret needs to point back at the chip — adjust its horizontal offset
  // relative to the popover so it visually lines up under the chip swatch.
  const caret = pop.querySelector('.bp-caret');
  if (caret) {
    const chipCenter = r.left + r.width / 2;
    const caretLeft = Math.max(8, Math.min(POP_W - 26, chipCenter - left - 9));
    caret.style.left = caretLeft + 'px';
  }
  pop.classList.add('open');
  pop.setAttribute('aria-hidden', 'false');
  // Ensure all popover values reflect current App.brush state before showing
  updateBrushUI();
}

function closeBrushPopover() {
  const pop = $('brushPopover');
  if (!pop) return;
  pop.classList.remove('open');
  pop.setAttribute('aria-hidden', 'true');
}

function renderPopoverSwatches() {
  const sw = $('bpSwatches');
  if (!sw) return;
  sw.innerHTML = '';
  SWATCH_COLORS.forEach(c => {
    const el = document.createElement('div');
    el.className = 'bp-swatch';
    el.style.background = c;
    el.title = c;
    el.addEventListener('click', () => setBrushColor(c));
    sw.appendChild(el);
  });
}

// v3.18.0: human-friendly label for the pressure curve slider.
// Slider 0..1, default 0.5 = Linear; below 0.5 = softer response; above = firmer.
function pressureCurveLabel(curve01) {
  const c = curve01 ?? 0.5;
  if (c < 0.42) return 'Soft';
  if (c > 0.58) return 'Firm';
  return 'Linear';
}

export function updateBrushUI() {
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  const setVal = (id, val) => { const el = $(id); if (el && document.activeElement !== el) el.value = val; };

  // Right-panel tab labels
  set('sizeVal', App.brush.size + ' px');
  set('opacityVal', Math.round(App.brush.opacity * 100) + '%');
  set('hardnessVal', Math.round(App.brush.hardness * 100) + '%');
  set('smoothingVal', Math.round(App.brush.smoothing * 100) + '%');
  set('stabilizationVal', Math.round((App.brush.stabilization || 0) * 100) + '%');
  set('pressureCurveVal', pressureCurveLabel(App.brush.pressureCurve));
  set('presSizeVal', Math.round(App.brush.presSize * 100) + '%');
  set('presOpVal', Math.round(App.brush.presOp * 100) + '%');

  // v3.9.1: brush chip in topbar — small live readout
  const chipSize = $('brushChipSize');
  if (chipSize) chipSize.textContent = App.brush.size + 'px';

  // v3.9.1: popover sliders + value labels. setVal skips the input that's
  // currently focused so a user mid-drag doesn't get their value clobbered
  // by a feedback loop.
  setVal('bpSize', App.brush.size);
  setVal('bpOpacity', Math.round(App.brush.opacity * 100));
  setVal('bpHardness', Math.round(App.brush.hardness * 100));
  setVal('bpSmoothing', Math.round(App.brush.smoothing * 100));
  setVal('bpStabilization', Math.round((App.brush.stabilization || 0) * 100));
  setVal('bpPressureCurve', Math.round((App.brush.pressureCurve ?? 0.5) * 100));
  setVal('bpPresSize', Math.round(App.brush.presSize * 100));
  setVal('bpPresOp', Math.round(App.brush.presOp * 100));
  set('bpSizeVal', App.brush.size + ' px');
  set('bpOpacityVal', Math.round(App.brush.opacity * 100) + '%');
  set('bpHardnessVal', Math.round(App.brush.hardness * 100) + '%');
  set('bpSmoothingVal', Math.round(App.brush.smoothing * 100) + '%');
  set('bpStabilizationVal', Math.round((App.brush.stabilization || 0) * 100) + '%');
  set('bpPressureCurveVal', pressureCurveLabel(App.brush.pressureCurve));
  set('bpPresSizeVal', Math.round(App.brush.presSize * 100) + '%');
  set('bpPresOpVal', Math.round(App.brush.presOp * 100) + '%');

  // v3.9.1: live stroke preview path width — clamped so very large brushes
  // don't blow out the small preview swatch.
  const previewPath = $('bpStrokePath');
  if (previewPath) {
    const w = Math.max(1, Math.min(20, App.brush.size / 4));
    previewPath.setAttribute('stroke-width', w);
    previewPath.setAttribute('stroke', App.brush.color);
    previewPath.setAttribute('stroke-opacity', App.brush.opacity);
  }

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
