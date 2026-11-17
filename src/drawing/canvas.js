// src/drawing/canvas.js
//
// Modern, standard digital drawing canvas controller.
// Handles pointerdown, pointermove, pointerup/cancel with true hardware stylus
// pressure, smooth One-Euro adaptive filtering, continuous quadratic Bézier
// curve stamping, and clean per-stroke opacity compositing.
//
// Eliminates all speculative prediction spikes ("grass" artifacts), stray
// bridging lines, and artificial pressure-ramp distortions.

import { App, curLayer, curPanel } from '../core/state.js';
import { pushHistory } from './history.js';
import { drawQuadSegment, drawSegment, drawDot } from './brush.js';
import {
  pointerToCanvas,
  renderDisplay,
  scheduleRender,
  cancelScheduledRender,
  captureStrokeRect,
  clearStrokeRect,
  startPan,
  doPan,
  endPan,
  pickColor,
  buildStrokeStaticCaches,
  clearStrokeStaticCaches,
} from './view.js';
import { updateLayerThumb } from '../ui/layers-panel.js';
import { updateSaveStatus } from '../ui/topbar.js';
import { updateCursor, hideCursor } from '../ui/cursor-overlay.js';
import { scheduleAutosave } from '../storage/autosave.js';
import { toast } from '../ui/toast.js';
import { $ } from '../utils/dom-helpers.js';
import { makeStrokeSmoother } from './smoothing.js';
import { InputPoint, Stroke } from './stroke.js';

// Per-stroke offscreen buffer for correct opacity compositing
let strokeBuffer = null;
let strokeBufferCtx = null;

// Adaptive smoothing filter pair, rebuilt at each stroke start
let smoother = null;

// ID of the pointer owning the active stroke
let activePointerId = null;

// Touch-and-hold eyedropper timer
const LONG_PRESS_MS = 750;
const LONG_PRESS_MOVE_TOL_SQ = 144; // 12px CSS squared
let longPressTimer = null;
let longPressOriginCss = null;

/**
 * Initialize drawing event listeners on displayCanvas.
 */
export function initDrawing() {
  const disp = $('displayCanvas');
  if (!disp) return;
  disp.addEventListener('pointerdown', startStroke);
  disp.addEventListener('pointermove', moveStroke);
  disp.addEventListener('pointerup', endStroke);
  disp.addEventListener('pointercancel', endStroke);
  disp.addEventListener('pointerenter', updateCursor);
  disp.addEventListener('pointerleave', () => { hideCursor(); });
  disp.addEventListener('contextmenu', e => e.preventDefault());
}

/**
 * Allocate or resize the offscreen stroke buffer to match the active layer.
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
    strokeBufferCtx.imageSmoothingEnabled = true;
    strokeBufferCtx.imageSmoothingQuality = 'high';
  }
  strokeBufferCtx.clearRect(0, 0, w, h);
  return strokeBufferCtx;
}

/**
 * Composite the stroke buffer onto the active layer once at target opacity.
 */
function flushStrokeBuffer() {
  if (!strokeBuffer) return;
  const layer = curLayer();
  if (!layer) return;
  const layerCtx = layer.canvas.getContext('2d');
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

  if (strokeBufferCtx) {
    strokeBufferCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
  }
}

/**
 * Get active stroke buffer for display composition.
 */
export function getStrokeBuffer() {
  return App.isDrawing ? strokeBuffer : null;
}
if (typeof window !== 'undefined') {
  window.__KPZ_strokeBuffer = getStrokeBuffer;
  window.__KPZ_predictedBuffer = () => null;
}

/**
 * Calibrate pressure against user's pressure curve setting.
 */
function applyPressureCurve(rawP, curve01) {
  const c = (curve01 != null) ? curve01 : 0.5;
  if (c === 0.5) return rawP;
  const exponent = Math.pow(16, c) / 4;
  return Math.pow(Math.max(0, Math.min(1, rawP)), exponent);
}

/**
 * Extract normalized pressure from a pointer event.
 */
function getEventPressure(e) {
  if (e.pointerType === 'pen') {
    // Stylus pressure: if 0, use light baseline so line starts cleanly on touch
    return (e.pressure != null && e.pressure > 0) ? e.pressure : 0.05;
  }
  // Mouse / Touch without pressure sensitivity: default 0.5
  return (e.pressure != null && e.pressure > 0) ? e.pressure : 0.5;
}

/**
 * Stroke start handler.
 */
function startStroke(e) {
  // Stop playback if animatic is playing
  if (App.playing) {
    import('../ui/topbar.js').then(m => m.stopPlayback?.());
  }

  // Pan tool / modes
  if (e.button === 1 || e.button === 2 || App.spacePan || App.tool === 'hand') {
    startPan(e);
    return;
  }

  // Eyedropper tool
  if (App.tool === 'eyedropper') {
    pickColor(e);
    return;
  }

  // Pen priority & palm rejection
  if (App.isDrawing) {
    const wasTouch = App.activePointerType === 'touch';
    const isPen = e.pointerType === 'pen';
    const isTouch = e.pointerType === 'touch';

    if (wasTouch && isPen) {
      // Pen priority: drop touch stroke and let pen take over immediately
      App.isDrawing = false;
      if (strokeBufferCtx) strokeBufferCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
      activePointerId = null;
      App.activePointerType = null;
      smoother = null;
      clearStrokeRect();
      clearStrokeStaticCaches();
      renderDisplay();
    } else if (wasTouch && isTouch) {
      // Second finger arrives: cancel drawing so multi-touch gestures (pinch/pan/undo) work
      App.isDrawing = false;
      if (strokeBufferCtx) strokeBufferCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
      activePointerId = null;
      App.activePointerType = null;
      smoother = null;
      clearStrokeRect();
      clearStrokeStaticCaches();
      renderDisplay();
      return;
    } else {
      // Already drawing with active pointer, ignore extra touches
      return;
    }
  }

  // Check layer lock
  const layer = curLayer();
  if (!layer || layer.locked) {
    toast('Layer is locked', 'error');
    return;
  }

  const disp = $('displayCanvas');
  try { disp.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }

  activePointerId = e.pointerId;
  App.activePointerType = e.pointerType;

  captureStrokeRect();
  pushHistory();

  App.isDrawing = true;
  App.dirty = true;
  updateSaveStatus();

  ensureStrokeBuffer();

  // Fresh smoother initialized with user's smoothing setting
  smoother = makeStrokeSmoother(App.brush.smoothing);

  const p = pointerToCanvas(e);
  const rawPressure = getEventPressure(e);
  const calibratedPressure = applyPressureCurve(rawPressure, App.brush.pressureCurve);

  const sx = smoother.fx.filter(p.x, e.timeStamp);
  const sy = smoother.fy.filter(p.y, e.timeStamp);
  const first = { x: sx, y: sy, pressure: calibratedPressure };

  App.strokeStart = first;
  App.lastPoint   = first;
  App.prevPoint   = null;
  App.lastMid     = null;
  App.strokeHasMoved = false;
  App.lazyPos     = { x: sx, y: sy };

  // Data model record
  App.activeStroke = new Stroke(
    { ...App.brush },
    App.activePanelIdx,
    curPanel().activeLayer
  );
  App.activeStroke.add(new InputPoint(p.x, p.y, calibratedPressure, e.timeStamp));

  buildStrokeStaticCaches();

  // Arm touch-and-hold eyedropper timer (canceled immediately on motion)
  longPressOriginCss = { x: e.clientX, y: e.clientY };
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (!App.isDrawing || App.strokeHasMoved) return;
    pickColor(e);
    App.isDrawing = false;
    if (strokeBufferCtx) strokeBufferCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
    activePointerId = null;
    App.activePointerType = null;
    smoother = null;
    clearStrokeRect();
    clearStrokeStaticCaches();
    renderDisplay();
  }, LONG_PRESS_MS);
}

/**
 * Stroke move handler.
 */
function moveStroke(e) {
  if (App.isPanning) { doPan(e); return; }
  updateCursor(e);
  if (!App.isDrawing || e.pointerId !== activePointerId) return;

  // Cancel long-press timer once motion is detected
  if (longPressTimer && longPressOriginCss) {
    const cdx = e.clientX - longPressOriginCss.x;
    const cdy = e.clientY - longPressOriginCss.y;
    if (cdx * cdx + cdy * cdy > LONG_PRESS_MOVE_TOL_SQ) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  const ctx = strokeBufferCtx;
  if (!ctx) return;

  App.strokeHasMoved = true;

  // Read high-frequency coalesced events if provided by browser
  let events = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
  if (!events || events.length === 0) events = [e];

  for (const ev of events) {
    const raw = pointerToCanvas(ev);
    const rawP = getEventPressure(ev);
    const pressure = applyPressureCurve(rawP, App.brush.pressureCurve);

    const t = ev.timeStamp;
    const sx = smoother.fx.filter(raw.x, t);
    const sy = smoother.fy.filter(raw.y, t);
    let sp = { x: sx, y: sy, pressure };

    // Streamline / stabilization lag if enabled
    const stab = App.brush.stabilization || 0;
    if (stab > 0) {
      if (!App.lazyPos) App.lazyPos = { x: sp.x, y: sp.y };
      const lazyAlpha = Math.max(0.05, 1 - stab * 0.95);
      App.lazyPos.x += (sp.x - App.lazyPos.x) * lazyAlpha;
      App.lazyPos.y += (sp.y - App.lazyPos.y) * lazyAlpha;
      sp.x = App.lazyPos.x;
      sp.y = App.lazyPos.y;
    }

    if (App.activeStroke) {
      App.activeStroke.add(new InputPoint(raw.x, raw.y, pressure, t));
    }

    // Lay stamps along quadratic Bézier curve through midpoints
    if (App.prevPoint) {
      const midNow = {
        x: (App.lastPoint.x + sp.x) / 2,
        y: (App.lastPoint.y + sp.y) / 2,
        pressure: (App.lastPoint.pressure + sp.pressure) / 2,
      };
      drawQuadSegment(ctx, App.lastMid, App.lastPoint, midNow);
      App.lastMid = midNow;
    } else {
      // Second sample: draw straight segment and seed midNow
      drawSegment(ctx, App.lastPoint, sp);
      App.lastMid = {
        x: (App.lastPoint.x + sp.x) / 2,
        y: (App.lastPoint.y + sp.y) / 2,
        pressure: (App.lastPoint.pressure + sp.pressure) / 2,
      };
    }

    App.prevPoint = App.lastPoint;
    App.lastPoint = sp;
  }

  // Defer display recomposite to vsync for smooth, high-framerate rendering
  scheduleRender();
}

/**
 * Stroke end / cancel handler.
 */
function endStroke(e) {
  if (App.isPanning) { endPan(e); return; }
  if (!App.isDrawing) return;

  if (e && e.pointerId != null && e.pointerId !== activePointerId) return;

  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressOriginCss = null;

  App.isDrawing = false;

  // Finalize stroke: finish tail curve or draw single tap dot
  if (App.strokeHasMoved && App.lastMid && App.lastPoint && strokeBufferCtx) {
    drawSegment(strokeBufferCtx, App.lastMid, App.lastPoint);
  } else if (!App.strokeHasMoved && App.strokeStart && strokeBufferCtx) {
    drawDot(strokeBufferCtx, App.strokeStart);
  }

  flushStrokeBuffer();
  App.strokeCount = (App.strokeCount || 0) + 1;

  // Reset stroke state
  App.lastPoint   = null;
  App.prevPoint   = null;
  App.lastMid     = null;
  App.strokeStart = null;
  App.lazyPos     = null;
  App.activeStroke = null;
  activePointerId = null;
  App.activePointerType = null;
  smoother = null;

  clearStrokeRect();
  clearStrokeStaticCaches();

  try { $('displayCanvas').releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }

  cancelScheduledRender();
  renderDisplay();
  updateLayerThumb(curPanel().activeLayer);
  scheduleAutosave();
}
