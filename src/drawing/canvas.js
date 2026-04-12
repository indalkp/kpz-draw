// src/drawing/canvas.js
// Stroke state machine: pointer events → brush stamps on active layer canvas.
// Implements the v3.5 tap-to-dot bug fix and sub-pixel noise filter.

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
  const ctx = curLayer().canvas.getContext('2d');

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

  renderDisplay();
}

function endStroke(e) {
  if (App.isPanning) { endPan(e); return; }
  if (!App.isDrawing) return;
  App.isDrawing = false;

  // v3.5 fix: tap-to-dot. If the pointer never moved during the stroke,
  // stamp a single dot at the start position. If it did move, the segment
  // stamps in moveStroke already covered that point.
  if (!App.strokeHasMoved && App.strokeStart) {
    const ctx = curLayer().canvas.getContext('2d');
    drawDot(ctx, App.strokeStart);
  }

  App.lastPoint   = null;
  App.strokeStart = null;
  renderDisplay();
  updateLayerThumb(curPanel().activeLayer);
  scheduleAutosave();
}
