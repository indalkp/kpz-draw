// src/drawing/canvas.js
//
// v3.7.0: iPad stroke-break fixes + Procreate-feel upgrades.
//
//   Fixes:
//   - Pointer identity: every move/up event is checked against the captured
//     pointerId. Palm touches or second fingers can no longer clobber the
//     stroke state mid-draw. (Was the #1 cause of strokes dying on iPad.)
//   - endStroke no longer fires on pointerleave. With setPointerCapture the
//     event shouldn't happen mid-stroke anyway; when coords briefly flicker
//     outside bounds on fast strokes, we don't want to end the stroke.
//   - Pen priority: if a pen pointerdown arrives while a touch is drawing,
//     we switch to the pen and drop the touch. Pencil wins over fingers.
//   - Palm rejection: a second pointerdown while drawing is ignored entirely.
//
//   Feel upgrades:
//   - Smoothing is now a One-Euro filter (adaptive low-pass) per stroke —
//     same family Procreate / Clip Studio use. Slow moves get heavy
//     smoothing (kills jitter), fast moves pass through (no lag).
//   - Stamps are laid along a quadratic Bézier curve through the sample
//     points (midpoint method) instead of straight lines, so fast / sparse
//     samples still render as smooth curves, not polylines.
//
//   Preserved from v3.6.3:
//   - Per-stroke offscreen buffer for correct opacity compositing.
//   - Tap-to-dot when pointer never moves.
//   - Sub-pixel noise filter (<0.5px moves skipped).

import { App } from '../core/state.js';
import { curLayer, curPanel } from './panels.js';
import { pushHistory } from './history.js';
import { drawQuadSegment, drawSegment, drawDot } from './brush.js';
import { pointerToCanvas, renderDisplay, startPan, doPan, endPan, pickColor } from './view.js';
import { updateLayerThumb } from '../ui/layers-panel.js';
import { updateSaveStatus } from '../ui/topbar.js';
import { updateCursor, hideCursor } from '../ui/cursor-overlay.js';
import { scheduleAutosave } from '../storage/autosave.js';
import { toast } from '../ui/toast.js';
import { $ } from '../utils/dom-helpers.js';
import { makeStrokeSmoother } from './smoothing.js';

// Per-stroke offscreen buffer (v3.6.3 opacity compositing, unchanged)
let strokeBuffer = null;
let strokeBufferCtx = null;

// v3.7.0: smoothing filter pair, rebuilt at each stroke start
let smoother = null;

// v3.7.0: id of the pointer that owns the active stroke. Anything with a
// different pointerId is rejected until the stroke ends.
let activePointerId = null;

export function initDrawing() {
  const disp = $('displayCanvas');
  if (!disp) return;
  disp.addEventListener('pointerdown', startStroke);
  disp.addEventListener('pointermove', moveStroke);
  disp.addEventListener('pointerup', endStroke);
  disp.addEventListener('pointercancel', endStroke);
  disp.addEventListener('pointerenter', updateCursor);
  // v3.7.0: only hide the cursor indicator on leave. Do NOT end the stroke —
  // setPointerCapture keeps delivering events; ending here caused false breaks.
  disp.addEventListener('pointerleave', () => { hideCursor(); });
  disp.addEventListener('contextmenu', e => e.preventDefault());
}

// (re)allocate the stroke buffer to match the current layer. Same as v3.6.3.
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
  strokeBufferCtx.clearRect(0, 0, w, h);
  return strokeBufferCtx;
}

// Composite the buffer onto the active layer once, at target opacity. Same as v3.6.3.
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

export function getStrokeBuffer() {
  return App.isDrawing ? strokeBuffer : null;
}
if (typeof window !== 'undefined') {
  window.__KPZ_strokeBuffer = getStrokeBuffer;
}

function startStroke(e) {
  // v3.9.10: any pointer-down on the canvas stops animatic playback. Drawing
  // and auto-cycling-panels would fight each other; user wins. We import
  // lazily to avoid circular import (topbar -> panel-nav -> ... -> canvas).
  if (App.playing) {
    import('../ui/topbar.js').then(m => m.stopPlayback?.());
  }

  // Pan modes (middle-click, right-click, space-held, hand tool) — unchanged
  if (e.button === 1 || e.button === 2 || App.spacePan || App.tool === 'hand') {
    startPan(e);
    return;
  }

  // Eyedropper — unchanged
  if (App.tool === 'eyedropper') {
    pickColor(e);
    return;
  }

  // v3.7.0: PEN PRIORITY. If a touch is currently drawing and a pen arrives,
  // drop the touch stroke and let the pen take over. Pencil always wins.
  if (App.isDrawing) {
    const wasTouch = App.activePointerType === 'touch';
    const isPen = e.pointerType === 'pen';
    if (wasTouch && isPen) {
      // v3.8.3 (C2): the abandoned touch stroke pushed a history entry at
      // the top of its own startStroke. That entry was never paired with
      // a commit — Cmd+Z saw a phantom "nothing changed" undo step. Pop it
      // before we take over with the pen. historyIdx always tracks length
      // after a push (see pushHistory in history.js), so keep them aligned.
      const hIdx = App.activePanelIdx;
      if (App.history[hIdx]?.length) {
        App.history[hIdx].pop();
        App.historyIdx[hIdx] = App.history[hIdx].length;
      }
      // Abandon the touch stroke silently (no commit)
      App.isDrawing = false;
      // v3.8.3 (L3): optional-chain the clear, and guard strokeBuffer access
      // separately — the property read on null would still throw.
      if (strokeBuffer && strokeBufferCtx) {
        strokeBufferCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
      }
      activePointerId = null;
      App.activePointerType = null;
    } else {
      // Second pointer of same type → palm / extra finger. Ignore completely.
      return;
    }
  }

  // Layer lock check — unchanged
  if (curLayer().locked) {
    toast('Layer is locked', 'error');
    return;
  }

  const disp = $('displayCanvas');
  disp.setPointerCapture(e.pointerId);

  // v3.7.0: lock the stroke to this specific pointer. Any other pointer's
  // move/up events will be ignored until this stroke ends.
  activePointerId = e.pointerId;
  App.activePointerType = e.pointerType;  // 'pen' | 'touch' | 'mouse'

  pushHistory();
  App.isDrawing = true;
  App.dirty = true;
  updateSaveStatus();

  ensureStrokeBuffer();

  // v3.7.0: fresh smoother per stroke. Parameters are derived from the
  // existing smoothing slider — zero-config for the user.
  smoother = makeStrokeSmoother(App.brush.smoothing);

  const p = pointerToCanvas(e);
  // Feed the first sample through the smoother so subsequent samples have a
  // reference. Returned value equals p on first call.
  const sx = smoother.fx.filter(p.x, e.timeStamp);
  const sy = smoother.fy.filter(p.y, e.timeStamp);
  const first = { x: sx, y: sy, pressure: p.pressure };

  App.lastPoint   = first;   // most recent smoothed sample (also the quad control point on next seg)
  App.prevPoint   = null;    // the one before that — needed for quad-bezier midpoint method
  App.lastMid     = null;    // cached midpoint(prev, last) — start of the next quad segment
  App.strokeStart = first;
  App.strokeHasMoved = false;
  // No dot drawn here — tap-to-dot is handled in endStroke if nothing moved.
}

function moveStroke(e) {
  if (App.isPanning) { doPan(e); return; }
  updateCursor(e);
  if (!App.isDrawing) return;

  // v3.7.0: hard-reject any pointer that isn't the one that started this stroke.
  // Silences palm touches and second fingers completely.
  if (e.pointerId !== activePointerId) return;

  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  const ctx = strokeBufferCtx;
  if (!ctx) return;

  for (const ev of events) {
    const raw = pointerToCanvas(ev);

    // Sub-pixel noise filter — unchanged from v3.5 fix
    const dx0 = raw.x - App.lastPoint.x;
    const dy0 = raw.y - App.lastPoint.y;
    if (dx0 * dx0 + dy0 * dy0 < 0.25) continue;

    App.strokeHasMoved = true;

    // v3.7.0: smooth via One-Euro (adaptive). Each event carries its own
    // timeStamp so variable frame rates are handled correctly.
    const t = ev.timeStamp;
    const sp = {
      x: smoother.fx.filter(raw.x, t),
      y: smoother.fy.filter(raw.y, t),
      pressure: raw.pressure,
    };

    // v3.7.0: draw as quadratic Bézier curve through the samples, not as
    // straight stamp-lines. Midpoint method: control point is the previous
    // sample, segment endpoints are midpoints with the one before and after.
    if (App.prevPoint) {
      const midNow = { x: (App.lastPoint.x + sp.x) / 2,
                       y: (App.lastPoint.y + sp.y) / 2,
                       pressure: (App.lastPoint.pressure + sp.pressure) / 2 };
      // Draw curve from the previous midpoint through lastPoint to the new midpoint
      drawQuadSegment(ctx, App.lastMid, App.lastPoint, midNow);
      App.lastMid = midNow;
    } else {
      // Second sample only — we can't form a full Bézier yet. Lay a short
      // straight segment and seed lastMid for the next iteration.
      drawSegment(ctx, App.lastPoint, sp);
      App.lastMid = { x: (App.lastPoint.x + sp.x) / 2,
                      y: (App.lastPoint.y + sp.y) / 2,
                      pressure: (App.lastPoint.pressure + sp.pressure) / 2 };
    }

    App.prevPoint = App.lastPoint;
    App.lastPoint = sp;
  }

  renderDisplay();
}

function endStroke(e) {
  if (App.isPanning) { endPan(e); return; }
  if (!App.isDrawing) return;

  // v3.7.0: only the pointer that started the stroke can end it.
  // Exception: pointercancel without a matching id should still tear down —
  // but pointercancel always carries the correct id so the check is safe.
  if (e && e.pointerId != null && e.pointerId !== activePointerId) return;

  App.isDrawing = false;

  // v3.7.0: flush the last pending curve tail. Between the last midpoint and
  // the final sample there's a small unrendered stub — stamp it as a line.
  if (App.strokeHasMoved && App.lastMid && App.lastPoint && strokeBufferCtx) {
    drawSegment(strokeBufferCtx, App.lastMid, App.lastPoint);
  }

  // Tap-to-dot — unchanged
  if (!App.strokeHasMoved && App.strokeStart && strokeBufferCtx) {
    drawDot(strokeBufferCtx, App.strokeStart);
  }

  flushStrokeBuffer();
  App.strokeCount = (App.strokeCount || 0) + 1;

  App.lastPoint   = null;
  App.prevPoint   = null;
  App.lastMid     = null;
  App.strokeStart = null;
  activePointerId = null;
  App.activePointerType = null;
  smoother = null;

  renderDisplay();
  updateLayerThumb(curPanel().activeLayer);
  scheduleAutosave();
}
