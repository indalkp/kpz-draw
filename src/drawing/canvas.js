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
import { pointerToCanvas, renderDisplay, scheduleRender, cancelScheduledRender, captureStrokeRect, clearStrokeRect, startPan, doPan, endPan, pickColor, buildStrokeStaticCaches, clearStrokeStaticCaches } from './view.js';
import { updateLayerThumb } from '../ui/layers-panel.js';
import { updateSaveStatus } from '../ui/topbar.js';
import { updateCursor, hideCursor } from '../ui/cursor-overlay.js';
import { scheduleAutosave } from '../storage/autosave.js';
import { toast } from '../ui/toast.js';
import { $ } from '../utils/dom-helpers.js';
import { makeStrokeSmoother } from './smoothing.js';
import { InputPoint, Stroke } from './stroke.js';

// Per-stroke offscreen buffer (v3.6.3 opacity compositing, unchanged)
let strokeBuffer = null;
let strokeBufferCtx = null;

// v3.13.2 Phase 2: speculative-tip overlay buffer.
//
// PointerEvent.getPredictedEvents() returns 1–3 samples ahead of the
// current real position based on velocity / trajectory. Rendering those
// predicted samples optimistically each frame lets the visible stroke
// endpoint track the cursor in real time, masking the browser's input →
// display latency (typically 1–2 frames on iPad/Pencil and Wacom-on-PC).
//
// The predicted buffer is a separate offscreen canvas, cleared and
// re-rasterized on every moveStroke. It composites on top of the real
// strokeBuffer in renderDisplay. When the next real sample arrives at
// (or near) a previously-predicted position, the predicted overlay gets
// replaced — no double-stamping because the predicted buffer was cleared
// before re-render.
let predictedBuffer = null;
let predictedBufferCtx = null;

// v3.7.0: smoothing filter pair, rebuilt at each stroke start
let smoother = null;

// v3.7.0: id of the pointer that owns the active stroke. Anything with a
// different pointerId is rejected until the stroke ends.
let activePointerId = null;

// v3.12.0: micro-lift tolerance window.
//
// Apple Pencil firmware (and some Wacom drivers under heavy load) can
// momentarily fire pointerup followed by a fresh pointerdown at near-
// identical coordinates within ~10–25ms during a single physical drag.
// The naive code treats this as two separate strokes, which manifests
// as a visible mid-stroke gap — the user's #1 reported issue on iPad.
//
// Procreate solves this by merging the new stroke onto the previous
// one if the gap is small in BOTH time and space and the input type
// matches. We do the same: stash the last stroke's terminal sample at
// endStroke, and at startStroke check if the new pointerdown falls
// within the merge window. If so we skip the history push and pre-
// stamp a connecting segment in the new buffer so the seam is bridged.
//
// Tunable thresholds — chose conservatively so legitimate fast taps
// don't accidentally merge into an old stroke:
//   60ms time gap   — pen lifts longer than this are real strokes.
//                     v3.12.1: bumped from 30ms after field reports of
//                     iPad strokes still escaping at 35–50ms phantom
//                     up/down windows.
//   14 canvas px    — 14 pixels at project resolution. Pen wobble is
//                     usually < 2px; finger micro-lift can wobble more,
//                     so the tolerance widens to absorb both. Real
//                     gestures move > 30px, so no false merges.
const MICRO_LIFT_MAX_MS = 60;
const MICRO_LIFT_MAX_DIST_SQ = 196; // 14 * 14 in canvas px
let lastStrokeEnd = null;          // { x, y, pressure, t, pointerType }
let isContinuation = false;        // true while the current stroke is a micro-lift continuation

// v3.12.8: per-sample pressure delta clamp.
// v3.12.9: tightened from ±0.5 to ±0.2. With brush sizes 50+, even a clamp
// of ±0.5 produced visible spike stamps (a clamped value of 0.8 on brush
// 100 still draws an 80-px stamp surrounded by 30-px steady-state stamps —
// clearly visible "spike dot" artifact). ±0.2 limits a single-sample spike
// to half the visible diameter increase, which combined with the stroke
// ramp-up below eliminates the "big black blob" pattern at large brush
// sizes. Natural pressure ramps in normal drawing are ~0.05–0.10/sample
// at 120Hz, well under the ±0.2 cap.
const PRESSURE_DELTA_LIMIT = 0.2;

function clampPressureDelta(newP, oldP) {
  const delta = newP - oldP;
  if (Math.abs(delta) > PRESSURE_DELTA_LIMIT) {
    return oldP + Math.sign(delta) * PRESSURE_DELTA_LIMIT;
  }
  return newP;
}

// v3.12.9: stroke ramp-up factor.
//
// Pen first-contact pressure is hardware-noisy. Apple Pencil firmware and
// many Wacom drivers report pressure 0.9–1.0 for the first sample of a
// stroke, then settle to whatever the user is actually pressing within
// 30–80 ms. Using that raw first-sample pressure produces the "large
// black dot at the start of every stroke" pattern that the user reports
// at brush sizes 50+ on both iPad and PC.
//
// Procreate / Krita / Clip Studio all apply a "lead-in damping" — the
// first ~60 ms of a stroke uses a fade-in pressure factor (start at 30%,
// linear ramp to 100%). The first stamp is small even if the OS reports
// full pressure; by the time the user has actually moved a few mm the
// hardware-stable pressure has taken over.
//
// Tap-to-dot is preserved separately: drawDot uses App.strokeStartRawPressure
// (the unramped first-sample pressure) so quick taps still produce a
// visible dot at the natural size.
const RAMP_UP_MS = 60;
const RAMP_UP_START_FACTOR = 0.3;

function strokeRampFactor(elapsedMs) {
  if (elapsedMs >= RAMP_UP_MS) return 1;
  const t = Math.max(0, elapsedMs) / RAMP_UP_MS;
  return RAMP_UP_START_FACTOR + (1 - RAMP_UP_START_FACTOR) * t;
}

// v3.12.0: long-press color-pick gesture. After a hold without significant
// movement, we treat it as Procreate-style "touch-and-hold to eyedrop" —
// sample the color under the pointer, abort the stroke.
//
// v3.12.3: thresholds widened after field reports of slow / precision /
// passive-stylus drawing accidentally triggering this and silently
// switching the brush colour to whatever was under the pointer (commonly
// the white background → all subsequent strokes invisible). 12-px / 750-ms
// keeps the gesture intentional without false-firing on careful detail work.
const LONG_PRESS_MS = 750;
const LONG_PRESS_MOVE_TOL_SQ = 144; // 12 CSS-px squared
let longPressTimer = null;
let longPressOriginCss = null;     // { x, y } in client/CSS px

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
    // v3.15.1: high-quality smoothing for the per-stamp drawImage from
    // the cached brush tip (256-px tip down-sampled to the stamp's
    // diameter). Default quality on most browsers is 'low' which
    // visibly aliases at small stamp sizes.
    strokeBufferCtx.imageSmoothingEnabled = true;
    strokeBufferCtx.imageSmoothingQuality = 'high';
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

// v3.13.2 Phase 2: helpers for the speculative-tip overlay.
function ensurePredictedBuffer() {
  if (!strokeBuffer) return null;
  const w = strokeBuffer.width;
  const h = strokeBuffer.height;
  if (!predictedBuffer || predictedBuffer.width !== w || predictedBuffer.height !== h) {
    predictedBuffer = document.createElement('canvas');
    predictedBuffer.width  = w;
    predictedBuffer.height = h;
    predictedBufferCtx = predictedBuffer.getContext('2d');
    // v3.15.1: same high-quality smoothing as strokeBuffer so the
    // speculative-tip overlay matches the real stroke's anti-aliasing.
    predictedBufferCtx.imageSmoothingEnabled = true;
    predictedBufferCtx.imageSmoothingQuality = 'high';
  }
  return predictedBufferCtx;
}

function clearPredictedBuffer() {
  if (predictedBuffer && predictedBufferCtx) {
    predictedBufferCtx.clearRect(0, 0, predictedBuffer.width, predictedBuffer.height);
  }
}

export function getPredictedBuffer() {
  return App.isDrawing ? predictedBuffer : null;
}
if (typeof window !== 'undefined') {
  window.__KPZ_predictedBuffer = getPredictedBuffer;
}

// v3.13.3: gap-bridge (replaces v3.13.2 full re-rasterization).
//
// When moveStroke detects a "suspicious gap" — a new sample whose
// distance or time gap from the previous one is large enough to
// indicate a dropped intermediate sample — we want to cover the gap
// visually so the user doesn't see a permanent skip.
//
// v3.13.2's rerasterizeFromPoints() did this by clearing strokeBuffer
// and replaying every stored InputPoint through the full pipeline.
// That works visually but is O(n) per call — and on a fast pen at
// 240 Hz a long stroke could see gap-detection fire multiple times,
// turning the work into O(n²) total. Field reports of "sometimes lags
// on tablet" traced to this.
//
// The cheap version: drawSegment from the previous-accepted smoothed
// point to the current one, in the live strokeBuffer. O(1) per call.
// Visually the gap-bridge is a straight-line approximation of what
// the dropped intermediate samples would have stamped — for sub-50ms
// gaps spanning <200 canvas-px, indistinguishable from a curve at
// normal viewing zooms. Users can't tell.
//
// We keep the InputPoint[] data structure for future use (undo
// granularity, network sync if we ever do collab, recovery from
// truly catastrophic input loss) — Phase 1 still stands.
function bridgeSuspiciousGap(prevSmoothed, currentSmoothed) {
  if (!strokeBufferCtx || !prevSmoothed || !currentSmoothed) return;
  drawSegment(strokeBufferCtx, prevSmoothed, currentSmoothed);
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

  // v3.12.2: PHANTOM POINTERDOWN RESTART
  //
  // Apple Pencil firmware (and some other styluses + iOS Safari combos)
  // fires a fresh pointerdown MID-STROKE without ever firing the matching
  // pointerup for the original pointerId. The naive paths through this
  // function were:
  //   - same-type-pen branch → "Same-type non-touch... palm. Ignore." →
  //     the new pointerId was dropped and our pointerId-lock rejected
  //     all subsequent moveStroke events for it. The stroke became
  //     invisible / "skipped". Field reports of ~80% pencil-only stroke
  //     loss on iPad were exactly this path.
  //   - same-type-touch branch (v3.12.1) → abandoned the stroke for
  //     "gesture handoff", which manifested as fragmentary strokes.
  //
  // Procreate / Clip Studio handle this with a "phantom restart" —
  // recognise that a same-type pointerdown landing very close in space
  // to the current stroke is a firmware glitch, not a real second
  // input. Adopt the new pointerId via setPointerCapture and let the
  // stroke continue uninterrupted. Real second-finger gestures always
  // land farther away from a moving pen, so the 50-canvas-px tolerance
  // differentiates them safely (humans don't tap fingers atop a
  // moving stylus tip).
  if (App.isDrawing && App.activePointerType === e.pointerType) {
    const p = pointerToCanvas(e);
    const lastP = App.lastPoint || App.strokeStart;
    if (lastP) {
      const dx = p.x - lastP.x;
      const dy = p.y - lastP.y;
      // v3.12.3: bumped from 50px to 100px after reports that some firmware
      // glitches land farther apart during fast strokes. Real second-finger
      // gestures still land much farther than 100px from a moving pen,
      // so this stays unambiguous.
      const PHANTOM_RESTART_DIST_SQ = 10000; // 100 canvas-px squared
      // v3.12.9: also require pressure-similarity. Real firmware phantoms
      // (pen tip stays in contact, OS just dropped pointerup) preserve
      // pressure across the glitch. A new pointerdown landing close in
      // space but with very different pressure is almost certainly a
      // genuine new stroke disguised by a missing pointerup — not a
      // phantom — and adopting it would carry the new pressure forward,
      // producing the "thick burst mid-stroke" artifact at large brush
      // sizes. If pressures differ by > 0.3, fall through to the normal
      // pen-priority / palm-rejection path so the stroke ends cleanly.
      const newP   = (e.pressure != null && e.pressure > 0) ? e.pressure : 0.5;
      const oldP   = (lastP.pressure != null) ? lastP.pressure : 0.5;
      const PRESSURE_SIMILARITY_THRESHOLD = 0.3;
      const pressuresSimilar = Math.abs(newP - oldP) < PRESSURE_SIMILARITY_THRESHOLD;
      if (dx * dx + dy * dy < PHANTOM_RESTART_DIST_SQ && pressuresSimilar) {
        // Phantom restart: adopt the new pointer, keep the same stroke.
        // setPointerCapture on a fresh pointerId implicitly releases the
        // old capture; if it throws (rare on some browsers), we still
        // update activePointerId so the move handler accepts the new id.
        try { $('displayCanvas').setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
        activePointerId = e.pointerId;
        // Cancel the long-press eyedropper timer — we're past the
        // initial hold window once a phantom restart has fired (the
        // user is clearly drawing, not holding still).
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        return;
      }
    }
  }

  // v3.7.0: PEN PRIORITY. If a touch is currently drawing and a pen arrives,
  // drop the touch stroke and let the pen take over. Pencil always wins.
  // v3.12.1: ALSO drop the touch stroke if a SECOND finger arrives — that
  // means the user wants a multi-finger gesture (pan / pinch / undo / redo /
  // fullscreen / eyedropper-hold) rather than to keep drawing. Without this
  // the second pointerdown was silently rejected, the touchstart in
  // events.js bailed on isDrawing=true, and gestures became unreachable
  // once any finger had touched the canvas. This is THE fix for "2-finger
  // pinch and 2/3/4-finger taps don't work on iPad / Android tablet".
  if (App.isDrawing) {
    const wasTouch = App.activePointerType === 'touch';
    const isPen   = e.pointerType === 'pen';
    const isTouch = e.pointerType === 'touch';

    if ((wasTouch && isPen) || (wasTouch && isTouch)) {
      // v3.8.3 (C2): the abandoned touch stroke pushed a history entry at
      // the top of its own startStroke. That entry was never paired with
      // a commit — Cmd+Z saw a phantom "nothing changed" undo step. Pop it
      // before we abandon. historyIdx always tracks length after a push
      // (see pushHistory in history.js), so keep them aligned.
      // (Skip if the abandoned stroke was itself a continuation — its
      // history entry belongs to the previous stroke, not this one.)
      if (!isContinuation) {
        const hIdx = App.activePanelIdx;
        if (App.history[hIdx]?.length) {
          App.history[hIdx].pop();
          App.historyIdx[hIdx] = App.history[hIdx].length;
        }
      }
      // Abandon the touch stroke silently (no commit)
      App.isDrawing = false;
      isContinuation = false;
      // v3.12.9: clear pressure-ramp state too so the abandoned stroke
      // doesn't leak its raw-pressure tracker into the next stroke.
      App.strokeStartTime = null;
      App.strokeStartRawPressure = null;
      App.lastRawPressure = null;
      App.lazyPos = null;
      // v3.13.0: drop the abandoned stroke's data object too.
      // v3.13.2: clear predicted-tip overlay.
      // v3.14.0: invalidate layer caches.
      App.activeStroke = null;
      clearPredictedBuffer();
      clearStrokeStaticCaches();
      // v3.8.3 (L3): optional-chain the clear, and guard strokeBuffer access
      // separately — the property read on null would still throw.
      if (strokeBuffer && strokeBufferCtx) {
        strokeBufferCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
      }
      activePointerId = null;
      App.activePointerType = null;
      // v3.12.1: long-press timer was armed for the abandoned stroke; cancel
      // it so it doesn't fire mid-gesture and surprise the user with an
      // eyedropper.
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      longPressOriginCss = null;
      // Cached display rect from captureStrokeRect goes stale if the
      // gesture ends up changing the view (pan / zoom / fit) — invalidate.
      clearStrokeRect();
      // Repaint without the abandoned stroke buffer overlay.
      cancelScheduledRender();
      renderDisplay();

      if (wasTouch && isTouch) {
        // v3.12.1: critical — when the handoff is touch→touch, return
        // WITHOUT starting a new stroke for this 2nd finger. Drawing
        // resumes only when the user lifts all fingers and starts a
        // fresh single-pointer gesture. The next touchstart in
        // events.js will see isDrawing=false and arm tap/pinch state.
        return;
      }
      // touch → pen: fall through to start a fresh pen stroke below.
    } else {
      // Same-type non-touch (e.g. pen+pen, mouse+anything) → palm / extra. Ignore.
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

  // v3.12.0: cache the display canvas's bounding rect for the duration of
  // this stroke so pointerToCanvas doesn't pay the layout cost on every
  // sample (and so we can't be tripped by a mid-stroke layout reflow).
  captureStrokeRect();

  // v3.12.0: micro-lift continuation detection. If a pointerdown lands
  // very close in time AND space to the previous stroke's terminal
  // sample, AND the input type matches, treat it as a phantom up/down
  // from Pencil firmware rather than a fresh stroke. This is the iPad
  // skipping fix.
  const p = pointerToCanvas(e);
  isContinuation = false;
  if (lastStrokeEnd
      && e.pointerType === lastStrokeEnd.pointerType
      && (e.timeStamp - lastStrokeEnd.t) < MICRO_LIFT_MAX_MS) {
    const dx = p.x - lastStrokeEnd.x;
    const dy = p.y - lastStrokeEnd.y;
    if (dx * dx + dy * dy < MICRO_LIFT_MAX_DIST_SQ) {
      isContinuation = true;
    }
  }

  // Only push history for genuinely new strokes — continuations append to
  // the previous stroke's history slot so Cmd+Z undoes the whole motion.
  if (!isContinuation) {
    pushHistory();
  }
  App.isDrawing = true;
  App.dirty = true;
  updateSaveStatus();

  ensureStrokeBuffer();

  // v3.7.0: fresh smoother per stroke. Parameters are derived from the
  // existing smoothing slider — zero-config for the user.
  smoother = makeStrokeSmoother(App.brush.smoothing);

  // Feed the first sample through the smoother so subsequent samples have a
  // reference. Returned value equals p on first call.
  // v3.12.9: capture stroke-start timestamp, raw first-pressure, and
  // initialize the raw-pressure tracker for the delta-clamp logic.
  // First stamp's *visual* pressure is at the ramp-start factor (30%
  // of raw) so we never start a stroke with a full-pressure stamp.
  // App.strokeStartRawPressure preserves the unramped first pressure
  // for endStroke's tap-to-dot path.
  App.strokeStartTime = e.timeStamp;
  App.strokeStartRawPressure = p.pressure;
  App.lastRawPressure = p.pressure;
  App.lazyPos = null; // v3.16.0: fresh lazy-mouse position per stroke

  // v3.13.0 Phase 1: instantiate the stroke data object. Every sample
  // arriving in moveStroke gets pushed into App.activeStroke.points as
  // an InputPoint. Predicted samples (from getPredictedEvents) get
  // stored separately in App.activeStroke.predicted, replaced each
  // frame.
  App.activeStroke = new Stroke(
    { ...App.brush },          // immutable snapshot
    App.activePanelIdx,
    curPanel().activeLayer,
  );
  App.activeStroke.add(new InputPoint(p.x, p.y, p.pressure, e.timeStamp));

  // v3.14.0 Phase 5: pre-composite the static layers below + above the
  // active one into reusable cache canvases. renderDisplay's fast path
  // uses these throughout the stroke instead of looping every layer
  // every frame. Caches are valid until endStroke clears them, so any
  // mid-stroke layer-state change (which can't normally happen anyway)
  // would not be picked up — but the next stroke rebuilds from scratch.
  buildStrokeStaticCaches();
  const sx = smoother.fx.filter(p.x, e.timeStamp);
  const sy = smoother.fy.filter(p.y, e.timeStamp);
  const first = {
    x: sx, y: sy,
    pressure: p.pressure * RAMP_UP_START_FACTOR,
  };

  // v3.12.0: when continuing across a micro-lift, pre-stamp a short
  // connecting segment from the saved end point to the new entry point
  // so the visual seam is bridged. The segment goes into the fresh
  // strokeBuffer and gets composited at brush.opacity along with the
  // rest of the new sub-stroke.
  if (isContinuation && strokeBufferCtx) {
    const bridgeFrom = {
      x: lastStrokeEnd.x,
      y: lastStrokeEnd.y,
      pressure: lastStrokeEnd.pressure,
    };
    drawSegment(strokeBufferCtx, bridgeFrom, first);
  }

  App.lastPoint   = first;   // most recent smoothed sample (also the quad control point on next seg)
  App.prevPoint   = null;    // the one before that — needed for quad-bezier midpoint method
  App.lastMid     = null;    // cached midpoint(prev, last) — start of the next quad segment
  App.strokeStart = first;
  App.strokeHasMoved = isContinuation;  // continuation already produced visible pixels
  // No dot drawn here — tap-to-dot is handled in endStroke if nothing moved.

  // v3.12.0: arm the long-press eyedropper timer. If the user holds the
  // pointer down for LONG_PRESS_MS without significant motion, we abort
  // the stroke and pick the color under the pointer instead. This is the
  // Procreate "touch and hold to color drop" gesture.
  // Skip on continuation — those aren't the start of a deliberate hold.
  longPressOriginCss = { x: e.clientX, y: e.clientY };
  if (longPressTimer) clearTimeout(longPressTimer);
  if (!isContinuation) {
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      // Only fire if we're still in the same stroke, no movement happened,
      // and the pointer hasn't switched to something else mid-hold.
      if (!App.isDrawing || App.strokeHasMoved) return;
      // Convert the original pointerdown to canvas coords for picking.
      // pickColor uses pointerToCanvas internally and reads the display
      // canvas pixels — works as long as the canvas already shows what
      // the user sees, which it does (no in-progress stamps yet).
      pickColor(e);
      // Cancel the in-progress stroke cleanly: clear the buffer, pop the
      // history entry we pushed at startStroke (if any), and reset state.
      App.isDrawing = false;
      if (strokeBuffer && strokeBufferCtx) {
        strokeBufferCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
      }
      if (!isContinuation) {
        const hIdx = App.activePanelIdx;
        if (App.history[hIdx]?.length) {
          App.history[hIdx].pop();
          App.historyIdx[hIdx] = App.history[hIdx].length;
        }
      }
      activePointerId = null;
      App.activePointerType = null;
      smoother = null;
      App.activeStroke = null; // v3.13.0: long-press abandoned the stroke
      App.lazyPos = null;      // v3.16.0: clear lazy-mouse state
      clearPredictedBuffer();  // v3.13.2: clear speculative overlay
      clearStrokeStaticCaches(); // v3.14.0: invalidate layer caches
      clearStrokeRect();
      cancelScheduledRender();
      renderDisplay();
    }, LONG_PRESS_MS);
  }
}

function moveStroke(e) {
  if (App.isPanning) { doPan(e); return; }
  updateCursor(e);
  if (!App.isDrawing) return;

  // v3.7.0: hard-reject any pointer that isn't the one that started this stroke.
  // Silences palm touches and second fingers completely.
  if (e.pointerId !== activePointerId) return;

  // v3.12.0: cancel the long-press eyedropper timer the moment we see
  // any real movement. The 4px CSS-px tolerance below distinguishes a
  // user who's holding still vs starting a stroke.
  if (longPressTimer && longPressOriginCss) {
    const cdx = e.clientX - longPressOriginCss.x;
    const cdy = e.clientY - longPressOriginCss.y;
    if (cdx * cdx + cdy * cdy > LONG_PRESS_MOVE_TOL_SQ) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  // v3.12.0: getCoalescedEvents fallback. Some browser/version combos
  // (older iOS Safari especially) return an empty array even when there
  // are real coalesced samples in the underlying event. Treat empty as
  // "use the parent event" so we never silently drop a sample.
  let events = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
  if (!events || events.length === 0) events = [e];
  const ctx = strokeBufferCtx;
  if (!ctx) return;

  // v3.12.3: any pointermove that reaches this point means the pointer
  // moved between the last sample and now (the browser fires pointermove
  // only when position changes). Set strokeHasMoved BEFORE the sub-pixel
  // noise filter, otherwise slow / precision drawing falls below the
  // filter threshold, leaves strokeHasMoved=false, and the long-press
  // eyedropper timer fires mid-stroke — silently swapping the brush
  // colour to whatever was under the pointer (commonly the white
  // background, producing invisible strokes thereafter).
  App.strokeHasMoved = true;

  for (const ev of events) {
    const raw = pointerToCanvas(ev);

    // v3.13.0 Phase 1: capture this real sample in the stroke data model.
    // The point gets pushed BEFORE any smoothing / clamping / ramping so
    // the data array is the unmodified ground truth.
    //
    // v3.13.3: detect suspicious gaps but DON'T re-rasterize the whole
    // stroke (was too expensive on long strokes — v3.13.2 perf regression
    // surfaced as "lags on tablet"). Just flag the gap so the rendering
    // block below uses a straight-line drawSegment bridge instead of the
    // bezier midpoint method, covering the gap with a single stamp pass.
    let suspiciousGap = false;
    if (App.activeStroke) {
      App.activeStroke.add(new InputPoint(raw.x, raw.y, raw.pressure, ev.timeStamp));
      const pts = App.activeStroke.points;
      if (pts.length >= 2) {
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        const timeGap = b.time - a.time;
        // 200 canvas-px squared, OR 50 ms — either signals a probable
        // dropped intermediate sample.
        if (distSq > 40000 || timeGap > 50) {
          suspiciousGap = true;
        }
      }
    }

    // v3.12.10: sub-pixel noise filter REMOVED.
    //
    // The old `if (dx² + dy² < 0.04) continue;` was dropping every coalesced
    // sample whose movement from the previous sample was < 0.2 canvas-px.
    // On PC this dropped legitimate fine-detail input — drawing a tiny dot,
    // circling in a small area for a pupil, or holding the cursor steady
    // with hand tremor produced no visible stamps because every sample fell
    // under the threshold. iPad didn't hit this because Pencil events at
    // 240 Hz over 1 mm of motion always exceed 0.2 canvas-px between samples.
    //
    // Same-position overlap is correct: stamps land at the same spot in
    // the offscreen buffer and the radial-gradient edges accumulate to a
    // slightly-saturated dot — exactly what a "small dot" should look like.
    // Per-frame composite cost is rAF-throttled so processing every sample
    // (including identical-position ones) has negligible overhead. Canvas
    // 2D arc+fill at sub-pixel precision is fast.

    // v3.7.0: smooth via One-Euro (adaptive). Each event carries its own
    // timeStamp so variable frame rates are handled correctly.
    //
    // Pressure pipeline (v3.12.8 + v3.12.9):
    //   raw → delta-clamp against previous raw (spike rejection)
    //       → multiply by ramp factor (stroke fade-in)
    //       → store as sp.pressure (used for stamp size)
    //
    // Raw and ramped values are tracked separately. Spike rejection
    // operates on raw deltas (so it doesn't get confused by the ramp
    // factor changing each sample); the ramp factor is a pure final
    // multiplier that decays to 1.0 after 60ms.
    const t = ev.timeStamp;
    const elapsedSinceStart = t - (App.strokeStartTime || t);
    const rampFactor = strokeRampFactor(elapsedSinceStart);
    const lastRaw = (App.lastRawPressure != null) ? App.lastRawPressure : raw.pressure;
    const clampedRaw = clampPressureDelta(raw.pressure, lastRaw);
    App.lastRawPressure = clampedRaw;
    const sp = {
      x: smoother.fx.filter(raw.x, t),
      y: smoother.fy.filter(raw.y, t),
      pressure: clampedRaw * rampFactor,
    };

    // v3.16.0 Phase 7a: stabilization (lazy-mouse). When the stabilization
    // slider is > 0, the rendered position chases the One-Euro-smoothed
    // position with exponential lag — Procreate's "Streamline" pattern.
    // The user sees their cursor pull a smoothly-trailing line that
    // ignores hand jitter entirely. App.lazyPos holds the lagged
    // position; cleared at startStroke / endStroke so each stroke
    // starts fresh.
    //
    // Mapped so stabilization=0 → lazyAlpha=1 (no lag), stabilization=1
    // → lazyAlpha=0.05 (very heavy lag but still finite — never fully
    // freezes). Predicted-tip overlay is unaffected; it uses
    // App.lastPoint = lazyPos so it naturally leads from the lagged
    // position rather than the raw cursor.
    const stab = App.brush.stabilization || 0;
    if (stab > 0) {
      if (!App.lazyPos) App.lazyPos = { x: sp.x, y: sp.y };
      const lazyAlpha = 1 - stab * 0.95;
      App.lazyPos.x += (sp.x - App.lazyPos.x) * lazyAlpha;
      App.lazyPos.y += (sp.y - App.lazyPos.y) * lazyAlpha;
      sp.x = App.lazyPos.x;
      sp.y = App.lazyPos.y;
    }

    // v3.7.0: draw as quadratic Bézier curve through the samples, not as
    // straight stamp-lines. Midpoint method: control point is the previous
    // sample, segment endpoints are midpoints with the one before and after.
    //
    // v3.13.3: if a suspicious gap was just detected (likely-dropped
    // intermediate sample), fall back to a straight-line drawSegment so
    // we cover the gap without the bezier curve corkscrewing through
    // a wrong control point. Reset lastMid/prevPoint so the next
    // segment starts a fresh bezier sequence.
    if (suspiciousGap) {
      drawSegment(ctx, App.lastPoint, sp);
      App.lastMid = { x: (App.lastPoint.x + sp.x) / 2,
                      y: (App.lastPoint.y + sp.y) / 2,
                      pressure: (App.lastPoint.pressure + sp.pressure) / 2 };
      App.prevPoint = null; // restart bezier chain from this point
    } else if (App.prevPoint) {
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

  // v3.13.0 Phase 1 + v3.13.2 Phase 2: capture predicted samples and
  // rasterize them into the speculative-tip overlay.
  //
  // PointerEvent.getPredictedEvents() returns 1–3 samples ahead of the
  // current real position based on velocity / trajectory. We render
  // them into predictedBuffer (a separate offscreen canvas) which gets
  // composited on top of strokeBuffer in renderDisplay. Because the
  // predicted buffer is cleared and re-rasterized on every moveStroke,
  // the latest prediction always shows; old predictions disappear when
  // new real samples arrive.
  //
  // Net effect: visible stroke endpoint tracks the cursor in real
  // time, masking browser input → display latency on iPad/Pencil
  // and Wacom-on-PC. Empty / no-op on browsers without
  // getPredictedEvents support.
  if (App.activeStroke && typeof e.getPredictedEvents === 'function') {
    const rawPredicted = e.getPredictedEvents();
    const predictedPoints = [];
    for (const pe of rawPredicted) {
      const p = pointerToCanvas(pe);
      predictedPoints.push(new InputPoint(p.x, p.y, p.pressure, pe.timeStamp, true));
    }
    App.activeStroke.setPredicted(predictedPoints);

    const predCtx = ensurePredictedBuffer();
    if (predCtx) {
      // Always start from a clean overlay so old predictions don't
      // accumulate as the user moves.
      clearPredictedBuffer();

      // Bridge from the last accepted real sample through each
      // predicted point. Use the same pressure as the last real
      // sample (predicted points don't have meaningful pressure
      // dynamics — they're trajectory extrapolation).
      let prev = App.lastPoint;
      if (prev && predictedPoints.length > 0) {
        for (const pred of predictedPoints) {
          const sp = { x: pred.x, y: pred.y, pressure: prev.pressure };
          drawSegment(predCtx, prev, sp);
          prev = sp;
        }
      }
    }
  }

  // v3.11.1: rAF-throttle the display recomposite. The expensive part of
  // moveStroke is renderDisplay() — it clears the entire #displayCanvas
  // and re-drawImage's every layer of the active panel. At 120Hz pen
  // input rate that runs 120x/sec, eats most of the frame budget on
  // multi-layer panels, and is the single biggest source of perceived
  // lag vs Procreate / Clip Studio.
  //
  // Stamping into strokeBuffer above stays synchronous so coalesced
  // samples land in order; only the display composite is deferred to
  // the next vsync. scheduleRender() is idempotent: many calls within
  // one frame collapse to a single renderDisplay() call.
  scheduleRender();
}

function endStroke(e) {
  if (App.isPanning) { endPan(e); return; }
  if (!App.isDrawing) return;

  // v3.7.0: only the pointer that started the stroke can end it.
  // Exception: pointercancel without a matching id should still tear down —
  // but pointercancel always carries the correct id so the check is safe.
  if (e && e.pointerId != null && e.pointerId !== activePointerId) return;

  // v3.12.0: cancel the long-press timer if it didn't fire — user lifted
  // before the threshold, so they meant a tap-to-dot or short stroke.
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  longPressOriginCss = null;

  App.isDrawing = false;

  // v3.7.0: flush the last pending curve tail. Between the last midpoint and
  // the final sample there's a small unrendered stub — stamp it as a line.
  if (App.strokeHasMoved && App.lastMid && App.lastPoint && strokeBufferCtx) {
    drawSegment(strokeBufferCtx, App.lastMid, App.lastPoint);
  }

  // Tap-to-dot. Skipped on continuations because the previous stroke
  // already produced the dot (or its contribution).
  // v3.12.9: tap-to-dot uses the UNRAMPED first-contact pressure
  // (App.strokeStartRawPressure), not the ramped strokeStart.pressure.
  // A quick tap should produce a visible dot at the natural pressure
  // size; the ramp-up only applies to actively moving strokes where
  // the first-contact spike artifact is visible.
  if (!App.strokeHasMoved && App.strokeStart && strokeBufferCtx && !isContinuation) {
    const dotPoint = {
      x: App.strokeStart.x,
      y: App.strokeStart.y,
      pressure: App.strokeStartRawPressure ?? App.strokeStart.pressure,
    };
    drawDot(strokeBufferCtx, dotPoint);
  }

  flushStrokeBuffer();
  // v3.12.0: only count this as a NEW stroke if it wasn't a micro-lift
  // continuation of the previous one. Keeps stroke counts honest for
  // analytics / dashboard surfaces.
  if (!isContinuation) {
    App.strokeCount = (App.strokeCount || 0) + 1;
  }

  // v3.12.0: stash the terminal sample for the next pointerdown's
  // micro-lift check. Fall back to strokeStart for tap-and-release where
  // lastPoint is the start point too.
  const endPoint = App.lastPoint || App.strokeStart;
  if (endPoint && e) {
    lastStrokeEnd = {
      x: endPoint.x,
      y: endPoint.y,
      pressure: endPoint.pressure ?? 0.5,
      t: e.timeStamp,
      pointerType: App.activePointerType,
    };
  }

  App.lastPoint   = null;
  App.prevPoint   = null;
  App.lastMid     = null;
  App.strokeStart = null;
  App.strokeStartTime = null;        // v3.12.9
  App.strokeStartRawPressure = null; // v3.12.9
  App.lastRawPressure = null;        // v3.12.9
  App.lazyPos = null;                // v3.16.0
  // v3.13.0 Phase 1: stroke is now committed to the layer; clear the
  // data object. v3.13.2 Phase 2: clear the predicted-tip overlay too
  // so it doesn't linger past the stroke's end.
  // v3.14.0 Phase 5: invalidate the layer caches so any subsequent
  // layer-state change picks up cleanly on the next stroke.
  App.activeStroke = null;
  clearPredictedBuffer();
  clearStrokeStaticCaches();
  activePointerId = null;
  App.activePointerType = null;
  smoother = null;
  isContinuation = false;
  clearStrokeRect();

  // v3.11.1: cancel any rAF-scheduled mid-stroke render before we paint
  // the final committed state. Without this, a queued frame from the
  // last moveStroke could fire AFTER flushStrokeBuffer has already moved
  // the pixels onto the active layer — the second paint would be
  // identical to the first but waste a frame and could briefly flash
  // wrong opacity if a layer-state update interleaved.
  cancelScheduledRender();
  renderDisplay();
  updateLayerThumb(curPanel().activeLayer);
  scheduleAutosave();
}
