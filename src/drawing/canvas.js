// src/drawing/canvas.js
//
// v3.6.3: Per-stroke compositing for correct opacity.
//   Before: every stamp drew directly on the layer at (opacity*pressure).
//   Stamps overlap heavily (spacing = size*0.15), so 20 overlapping stamps
//   at opacity 0.2 produced ~99% visual density — strokes always looked
//   opaque no matter how low you set the opacity slider.
//
//   After: a stroke is drawn onto an offscreen buffer at alpha 1. On stroke
//   end, the entire buffer composites onto the layer ONCE at App.brush.opacity
//   (or destination-out for eraser). Result: opacity 0.2 looks like 20%,
//   pressure→opacity variation still works within the stroke.
//
// v3.5 fixes preserved: tap-to-dot, sub-pixel noise filter.

import { App } from '../core/state.js';
import { curLayer, curPanel } from './panels.js';
import { pushHistory } from './history.js';
import { drawSegment, drawDot } from './brush.js';
import { pointerToCanvas, renderDisplay, startPan, doPan, endPan, pickColor } from './view.js';
import { updateLayerThumb } from '../ui/layers-panel.js';
import { updateSaveStatus } from '../ui/topbar.js';
import { updateCursor, hideCursor } from '../ui/cursor-overlay.js';
import { scheduleAutosave } from '../storage/autosave.js';
import { toast } from '../ui/toast.js';
import { $ } from '../utils/dom-helpers.js';

// v3.6.3: per-stroke offscreen buffer
let strokeBuffer = null;
let strokeBufferCtx = null;

export function initDrawing() {
  const disp = $('displayCanvas');
  if (!disp) return;
  disp.addEventListener('pointerdown', startStroke);
  disp.addEventListener('pointermove', moveStroke);
  disp.addEventListener('pointerup', endStroke);
  disp.addEventListener('pointercancel', endStroke);
  disp.addEventListener('pointerenter', updateCursor);
  disp.addEventListener('pointerleave', e => {
    hideCursor();
    if (App.isDrawing || App.isPanning) endStroke(e);
  });
  disp.addEventListener('contextmenu', e => e.preventDefault());
}

/**
 * v3.6.3: (re)allocate the stroke buffer to match the current layer.
 * Called at stroke start. Same-sized buffer is reused across strokes;
 * it's only resized if the layer size changed (panel switch etc.).
 */
function ensureStrokeBuffer() {
  const layer = curLayer();
  if (!layer) return null;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  if (!strokeBuffer || strokeBuffer.width !== w || strokeBuffer.height !== h) {
    strokeBuffer = document.createElement('canvas');
    strokeBuffer.width = w;
    strokeBuffer.height = h;
    strokeBufferCtx = strokeBuffer.getContext('2d');
  }
  // Always clear — each stroke starts from empty
  strokeBufferCtx.clearRect(0, 0, w, h);
  return strokeBufferCtx;
}

/**
 * v3.6.3: composite the buffer onto the active layer once, at target opacity.
 * This is the crux of the opacity fix. Brushes honor App.brush.opacity here;
 * eraser uses destination-out at alpha 1 (the buffer shape defines erasure).
 */
function flushStrokeBuffer() {
  if (!strokeBuffer) return;
  const layerCtx = curLayer().canvas.getContext('2d');
  const erase = App.tool === 'eraser';
  layerCtx.save();
  if (erase) {
    layerCtx.globalCompositeOperation = 'destination-out';
    layerCtx.globalAlpha = 1;
  } else {
    layerCtx.globalCompositeOperation = 'source-over';
    layerCtx.globalAlpha = App.brush.opacity;
  }
  layerCtx.drawImage(strokeBuffer, 0, 0);
  layerCtx.restore();
  strokeBufferCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
}

/** v3.6.3: exported so view.js can overlay the in-progress buffer during a live stroke. */
export function getStrokeBuffer() {
  return App.isDrawing ? strokeBuffer : null;
}

// v3.6.3: view.js imports this module indirectly (canvas → view), so to avoid
// a circular import we expose getStrokeBuffer on a well-known window hook.
// view.js's renderDisplay() calls window.__KPZ_strokeBuffer() when App.isDrawing.
if (typeof window !== 'undefined') {
  window.__KPZ_strokeBuffer = getStrokeBuffer;
}

function startStroke(e) {
  // Pan modes: middle-click, right-click, space-held, or hand tool
  if (e.button === 1 || e.button === 2 || App.spacePan || App.tool === 'hand') {
    startPan(e);
    return;
  }

  // Eyedropper: pickColor() in view.js already sets App.brush.color,
  // updates #colorPicker, and switches back to brush tool.
  if (App.tool === 'eyedropper') {
    pickColor(e);
    return;
  }

  // Layer lock check
  if (curLayer().locked) {
    toast('Layer is locked', 'error');
    return;
  }

  const disp = $('displayCanvas');
  disp.setPointerCapture(e.pointerId);
  pushHistory();
  App.isDrawing = true;
  App.dirty = true;
  updateSaveStatus();

  // v3.6.3: allocate fresh stroke buffer for this stroke
  ensureStrokeBuffer();

  const p = pointerToCanvas(e);
  App.lastPoint     = { x: p.x, y: p.y, pressure: p.pressure };
  App.smoothPoint   = { x: p.x, y: p.y, pressure: p.pressure };
  App.strokeStart   = { x: p.x, y: p.y, pressure: p.pressure };
  App.strokeHasMoved = false;
  // v3.5 fix: do NOT draw a dot here. If we did, it would combine with the
  // first segment from moveStroke and accumulate into a visible blob at the
  // stroke's start point. Tap-to-dot is handled in endStroke() instead.
}

function moveStroke(e) {
  if (App.isPanning) { doPan(e); return; }
  updateCursor(e);
  if (!App.isDrawing) return;

  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  // v3.6.3: draw to the offscreen buffer instead of the layer directly
  const ctx = strokeBufferCtx;
  if (!ctx) return;

  for (const ev of events) {
    const p = pointerToCanvas(ev);

    // v3.5 fix: sub-pixel noise filter — ignore micro-jitters under 0.5px
    const dx0 = p.x - App.lastPoint.x;
    const dy0 = p.y - App.lastPoint.y;
    if (dx0 * dx0 + dy0 * dy0 < 0.25) continue;

    App.strokeHasMoved = true;

    // Smoothing: exponential lerp toward raw pointer position
    const sm = App.brush.smoothing;
    if (sm > 0) {
      App.smoothPoint.x += (p.x - App.smoothPoint.x) * (1 - sm * 0.85);
      App.smoothPoint.y += (p.y - App.smoothPoint.y) * (1 - sm * 0.85);
      App.smoothPoint.pressure = p.pressure;
    } else {
      App.smoothPoint.x = p.x;
      App.smoothPoint.y = p.y;
      App.smoothPoint.pressure = p.pressure;
    }

    const sp = {
      x: App.smoothPoint.x,
      y: App.smoothPoint.y,
      pressure: App.smoothPoint.pressure,
    };
    drawSegment(ctx, App.lastPoint, sp);
    App.lastPoint = sp;
  }

  // renderDisplay composes layer + in-progress stroke buffer (view.js patch)
  renderDisplay();
}

function endStroke(e) {
  if (App.isPanning) { endPan(e); return; }
  if (!App.isDrawing) return;
  App.isDrawing = false;

  // v3.5 fix: tap-to-dot. If the pointer never moved during the stroke,
  // stamp a single dot into the buffer at the start position.
  if (!App.strokeHasMoved && App.strokeStart && strokeBufferCtx) {
    drawDot(strokeBufferCtx, App.strokeStart);
  }

  // v3.6.3: composite the entire stroke onto the layer ONCE at target opacity
  flushStrokeBuffer();

  // v3.6.0: count every completed stroke (moved stroke OR tap-to-dot)
  App.strokeCount = (App.strokeCount || 0) + 1;

  App.lastPoint   = null;
  App.strokeStart = null;
  renderDisplay();
  updateLayerThumb(curPanel().activeLayer);
  scheduleAutosave();
}
