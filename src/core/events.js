// src/core/events.js
// Global keyboard shortcuts, window resize, and touch gesture wiring.
// Called once from main.js after all subsystems are initialized.
//
// v3.7.0: Fixed iPad stroke-kill bug.
//   The old setupCanvasTouch set `App.isDrawing = false` whenever a second
//   touch arrived — which is EXACTLY what happens when your palm rests on
//   iPad during pencil drawing. Stroke died instantly.
//
//   Fixes in this version:
//   1. Bail from all touch-gesture logic while a pointer stroke is active.
//      Pen stroke takes precedence; gestures resume after the stroke ends.
//   2. Filter out touches where touchType === 'stylus' (iOS Apple Pencil
//      reports this). Prevents the pencil from ever being counted in
//      pinch / 3-finger undo / swipe gestures.
//   3. 3-finger undo now requires all three touches to be fingers, not
//      pencil + 2 palm points.

import { App } from './state.js';
import { undo, redo } from '../drawing/history.js';
import { fitView, setZoom, applyView } from '../drawing/view.js';
import { setTool } from '../ui/toolrail.js';
import { updateBrushUI } from '../ui/brush-panel.js';
// v3.9.8: shared onion-mode cycle helper so 'O' shortcut and topbar button
// stay in sync without duplicating state transitions.
// v3.9.10: shared playback toggle so 'P' shortcut and topbar button match.
import { cycleOnionMode, togglePlayback } from '../ui/topbar.js';
import { closeRefViewer, showRef } from '../ui/ref-viewer.js';
import { $ } from '../utils/dom-helpers.js';

export function wireGlobalEvents() {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  // v3.8.3: guard against iOS address-bar-driven resize firing while layout
  // is mid-reflow (canvasArea briefly 0). Same class of bug v3.8.1 fixed for
  // ResizeObserver — window.resize had the same race.
  window.addEventListener('resize', () => {
    if (!App.project) return;
    const ca = $('canvasArea');
    if (!ca || ca.clientWidth < 100 || ca.clientHeight < 100) return;
    applyView();
  });

  setupCanvasTouch();
  setupSwipe();

  const canvasArea = $('canvasArea');
  canvasArea.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvasArea.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(App.view.scale * factor, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  if (typeof ResizeObserver !== 'undefined') {
    // v3.8.1: On mobile, the first ResizeObserver callback can arrive before
    // the mobile CSS grid row stabilizes (address bar, 100dvh, safe-area
    // insets), giving canvasArea a zero or tiny size. Previously firstFit
    // burned on that useless 0x0 callback, scale floored to 0.05, and the
    // canvas rendered invisibly small. Now we only consume firstFit once the
    // container reports a real size (> 100px each axis). Also re-fit if the
    // scale looks collapsed to the floor (sign of a prior failed fit).
    //
    // v3.9.5: also re-fit if scale is still at the default 1.0 when a real
    // size arrives. This catches the case where main.js's polling exited
    // before canvasArea was sized AND firstFit had already been consumed
    // by some earlier callback that didn't actually run fitView (e.g. the
    // last-resort path in main.js sets scale=1 by default). Without this,
    // the canvas can render at its natural 1280x720 size, way bigger than
    // the iframe, and appear "missing" because most of it is off-screen.
    let firstFit = true;
    const ro = new ResizeObserver((entries) => {
      if (!App.project) return;
      const rect = entries[0] && entries[0].contentRect;
      const hasRealSize = rect && rect.width > 100 && rect.height > 100;
      if (firstFit && hasRealSize) {
        firstFit = false;
        fitView();
      } else if (hasRealSize && (App.view.scale <= 0.06 || App.view.scale === 1)) {
        // v3.9.5: scale === 1 here means "still at default, never properly
        // fit". Treat as a fresh fit needed. Cheap (one fitView per real
        // size change) and idempotent — if scale was already correct, it
        // gets recomputed to the same value.
        fitView();
      } else {
        applyView();
      }
    });
    ro.observe(canvasArea);
  }

  window.addEventListener('beforeunload', e => {
    if (App.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

// v3.12.0: state for the hold-Alt-for-eyedropper shortcut. We snapshot
// the current tool when Alt is first pressed and restore it on release,
// matching Procreate / Photoshop's "tap Alt to colour-pick" pattern.
let _altEyedropperToolBefore = null;

function handleKeyDown(e) {
  if (e.target.matches('input,textarea,select')) return;
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); $('saveModal')?.classList.add('open'); return; }
  if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileInput')?.click(); return; }
  if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); $('newModal')?.classList.add('open'); return; }

  // v3.12.0: hold Alt (Option on macOS) to enter the eyedropper temporarily.
  // The first Alt-down snapshots the current tool, switches to eyedropper,
  // and the keyup handler restores. Repeats are suppressed so holding Alt
  // doesn't repeatedly trigger setTool.
  if (e.key === 'Alt' && !e.repeat && _altEyedropperToolBefore === null) {
    e.preventDefault();
    _altEyedropperToolBefore = App.tool;
    setTool('eyedropper');
    return;
  }

  // v3.12.0: X swaps brush ↔ eraser (Photoshop / Krita / Procreate-keyboard
  // convention). Cycles only between the two paint tools — eyedropper /
  // hand are unaffected.
  if (e.key === 'x' || e.key === 'X') {
    if (App.tool === 'brush') setTool('eraser');
    else if (App.tool === 'eraser') setTool('brush');
    return;
  }

  if (e.key === 'Escape') {
    if ($('refViewer')?.classList.contains('open')) closeRefViewer();
    else if ($('helpOverlay')?.classList.contains('open')) $('helpOverlay').classList.remove('open');
    else if (document.body.classList.contains('fullscreen')) toggleFullscreen();
    return;
  }

  if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); $('helpOverlay')?.classList.toggle('open'); return; }
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
  if (e.key === 'Tab') { e.preventDefault(); $('leftPanel')?.classList.toggle('open'); return; }
  if (e.key === ' ') { e.preventDefault(); App.spacePan = true; $('canvasArea').style.cursor = 'grab'; return; }

  if (e.key === 'b' || e.key === 'B') setTool('brush');
  if (e.key === 'e' || e.key === 'E') setTool('eraser');
  if (e.key === 'i' || e.key === 'I') setTool('eyedropper');
  if (e.key === 'h' || e.key === 'H') setTool('hand');
  if (e.key === 'f' || e.key === 'F') fitView();
  // v3.9.8: 'O' cycles onion skin off → past → both → off.
  if (e.key === 'o' || e.key === 'O') cycleOnionMode();
  // v3.9.10: 'P' toggles animatic playback (cycles panels at the chosen FPS).
  if (e.key === 'p' || e.key === 'P') togglePlayback();
  if (e.key === '1') setZoom(1);
  if (e.key === '+' || e.key === '=') setZoom(App.view.scale * 1.25);
  if (e.key === '-') setZoom(App.view.scale * 0.8);

  if (e.key === '[') {
    App.brush.size = Math.max(1, App.brush.size - 2);
    $('brushSize') && ($('brushSize').value = App.brush.size);
    updateBrushUI();
  }
  if (e.key === ']') {
    App.brush.size = Math.min(200, App.brush.size + 2);
    $('brushSize') && ($('brushSize').value = App.brush.size);
    updateBrushUI();
  }

  if ($('refViewer')?.classList.contains('open')) {
    if (e.key === 'ArrowLeft' && App.refViewerIdx > 0) showRef(App.refViewerIdx - 1);
    if (e.key === 'ArrowRight' && App.refViewerIdx < (App.project?.refs?.length ?? 0) - 1) showRef(App.refViewerIdx + 1);
  }
}

function handleKeyUp(e) {
  if (e.key === ' ') {
    App.spacePan = false;
    $('canvasArea').style.cursor = '';
  }
  // v3.12.0: release Alt → restore the tool we had before the eyedropper
  // hold. Keeps the pen-tablet flow snappy: peck Alt to sample, release
  // to keep painting.
  if (e.key === 'Alt' && _altEyedropperToolBefore !== null) {
    setTool(_altEyedropperToolBefore);
    _altEyedropperToolBefore = null;
  }
}

function toggleFullscreen() {
  document.body.classList.toggle('fullscreen');
  if (App.project) requestAnimationFrame(applyView);
}

// ============================================================================
// Touch gestures on canvas — v3.12.0 Procreate-aligned mappings
//
//   1 finger          : draw / select (handled by pointer events in canvas.js,
//                       not here)
//   1 finger long-hold: eyedropper (also in canvas.js — long-press timer)
//   2-finger tap      : undo
//   3-finger tap      : redo
//   4-finger tap      : toggle fullscreen / hide UI
//   2-finger pinch    : pan + zoom canvas (sustained)
//   Quick 2-finger    : fit to screen (touch + immediate release with
//   "snap" pinch       a >20% scale change in <250ms)
//   Double tap (1)    : fit to screen (kept from v3.7)
//
// State machine notes:
//   - We collect tap intent on touchstart. Movement past ~10 CSS px or
//     duration past 250ms invalidates the tap.
//   - The 2-finger pinch path activates when tap intent is invalidated
//     by movement (so a still 2-finger touch is a tap, not a pinch).
//   - Apple Pencil touches (touchType === 'stylus') are filtered out
//     entirely — pencil drawing flows through pointer events only.
// ============================================================================
let canvasTouchState = null;        // sustained pinch state — set when 2-finger movement begins
let lastTapTime = 0;
let tapIntent = null;               // { count, startTime, originX, originY, startScale, peakScale, troughScale }

const TAP_MAX_MS         = 250;
const TAP_MAX_MOVE_PX_SQ = 100;     // 10px squared
const QUICK_PINCH_MIN_RATIO = 1.2;  // 20% scale change qualifies as a "snap pinch"

/**
 * v3.7.0 helper: return only the "real finger" touches from a TouchEvent.
 * On iOS, Apple Pencil touches carry touchType === 'stylus'; fingers are
 * 'direct'. Android doesn't set touchType, so we treat unset as finger.
 */
function fingerTouches(touchList) {
  const out = [];
  for (let i = 0; i < touchList.length; i++) {
    const t = touchList[i];
    // iOS: skip stylus. Other platforms: include everything.
    if (t.touchType && t.touchType === 'stylus') continue;
    out.push(t);
  }
  return out;
}

/** Centroid + spread of a finger array (for pinch calculations). */
function centroid(fingers) {
  let sx = 0, sy = 0;
  for (const f of fingers) { sx += f.clientX; sy += f.clientY; }
  return { x: sx / fingers.length, y: sy / fingers.length };
}
function pinchSpread(fingers) {
  if (fingers.length < 2) return 0;
  const [a, b] = fingers;
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function setupCanvasTouch() {
  const canvasArea = $('canvasArea');

  canvasArea.addEventListener('touchstart', e => {
    // v3.7.0: if a pointer stroke is already in progress, stay out of the way.
    // The pen (or the active finger) owns the canvas until it lifts.
    if (App.isDrawing) return;

    const fingers = fingerTouches(e.touches);

    // Multi-finger gesture: arm tap intent for the new finger count.
    // We have to reset on every count change (e.g. 1→2, 2→3) so the
    // user landing 3 fingers in quick succession registers as 3-finger,
    // not 2-finger.
    if (fingers.length >= 2 && fingers.length <= 4) {
      e.preventDefault();
      lastTapTime = 0;  // pinch / multi-finger cancels any pending double-tap-to-fit
      const c = centroid(fingers);
      const spread = pinchSpread(fingers);
      tapIntent = {
        count: fingers.length,
        startTime: Date.now(),
        originX: c.x,
        originY: c.y,
        startScale: spread,
        peakRatio: 1,
      };
      // For 2-finger we ALSO seed pinch state so a sustained pinch (after
      // tap intent is invalidated by movement) flows directly into pan/zoom.
      if (fingers.length === 2) {
        canvasTouchState = {
          d: spread,
          cx: c.x, cy: c.y,
          vx: App.view.x, vy: App.view.y, scale: App.view.scale,
        };
      } else {
        canvasTouchState = null;
      }
    } else if (fingers.length === 1) {
      // Double-tap to fit — kept from earlier versions.
      const now = Date.now();
      if (now - lastTapTime < 320) { fitView(); e.preventDefault(); lastTapTime = 0; return; }
      lastTapTime = now;
      tapIntent = null;
    }
  }, { passive: false });

  canvasArea.addEventListener('touchmove', e => {
    // v3.7.0: drawing takes priority — don't pinch-zoom mid-stroke
    if (App.isDrawing) return;

    const fingers = fingerTouches(e.touches);

    // Track movement against tap intent — past the tolerance, the gesture
    // is no longer a tap. Track peak scale ratio for quick-pinch detection.
    if (tapIntent && fingers.length === tapIntent.count) {
      const c = centroid(fingers);
      const dx = c.x - tapIntent.originX;
      const dy = c.y - tapIntent.originY;
      if (dx * dx + dy * dy > TAP_MAX_MOVE_PX_SQ) {
        // Centroid moved — definitely not a tap. Drop tap intent and let
        // pinch handler take over below.
        tapIntent = null;
      } else if (fingers.length === 2) {
        // Track scale ratio even if centroid hasn't moved (fingers spreading
        // outward equidistantly leaves the centroid stationary).
        const spread = pinchSpread(fingers);
        if (tapIntent.startScale > 0) {
          const r = spread / tapIntent.startScale;
          if (r > tapIntent.peakRatio || (1/r) > tapIntent.peakRatio) {
            tapIntent.peakRatio = Math.max(r, 1 / r);
          }
        }
      }
    }

    // Sustained 2-finger pinch (pan + zoom). Activates only once tap
    // intent has been invalidated by movement, so a still 2-finger touch
    // doesn't accidentally jitter the view.
    if (fingers.length === 2 && canvasTouchState && !tapIntent) {
      e.preventDefault();
      const [a, b] = fingers;
      const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
      const ratio = d / canvasTouchState.d;
      App.view.scale = Math.max(0.05, Math.min(16, canvasTouchState.scale * ratio));
      App.view.x = canvasTouchState.vx + (cx - canvasTouchState.cx);
      App.view.y = canvasTouchState.vy + (cy - canvasTouchState.cy);
      applyView();
    }
  }, { passive: false });

  canvasArea.addEventListener('touchend', e => {
    const fingers = fingerTouches(e.touches);

    // If tap intent is still alive AND duration was short AND fingers all
    // lifted (or count is dropping), classify the gesture.
    if (tapIntent && fingers.length < tapIntent.count) {
      const elapsed = Date.now() - tapIntent.startTime;
      if (elapsed < TAP_MAX_MS) {
        // Quick 2-finger gesture: was it a tap (no scale change) or a
        // snap-pinch (large scale change)?
        if (tapIntent.count === 2) {
          if (tapIntent.peakRatio >= QUICK_PINCH_MIN_RATIO) {
            fitView();           // snap pinch → fit
          } else {
            undo();              // 2-finger tap → undo (Procreate canon)
          }
        } else if (tapIntent.count === 3) {
          redo();                // 3-finger tap → redo (Procreate canon)
        } else if (tapIntent.count === 4) {
          toggleFullscreen();    // 4-finger tap → fullscreen toggle
        }
      }
      tapIntent = null;
    }

    // Clear pinch state once we're back below 2 fingers.
    if (fingers.length < 2) canvasTouchState = null;
  });

  // touchcancel: defensive cleanup if iOS preempts the gesture (e.g. a
  // system swipe-from-edge). Drop both states so the next gesture starts
  // clean instead of continuing a stale pinch.
  canvasArea.addEventListener('touchcancel', () => {
    tapIntent = null;
    canvasTouchState = null;
  });
}

function setupSwipe() {
  const canvasArea = $('canvasArea');
  let touchStartX = 0, touchStartY = 0, swipeHandled = false;

  canvasArea.addEventListener('touchstart', e => {
    // v3.7.0: never start a swipe while a stroke is active, and only count
    // finger touches (pencil shouldn't open panels).
    if (App.isDrawing) return;
    const fingers = fingerTouches(e.touches);
    if (fingers.length !== 1) return;
    touchStartX = fingers[0].clientX;
    touchStartY = fingers[0].clientY;
    swipeHandled = false;
  }, { passive: true });

  canvasArea.addEventListener('touchend', e => {
    if (swipeHandled) return;
    if (window.innerWidth > 1100) return;
    const changed = fingerTouches(e.changedTouches);
    if (changed.length === 0) return;
    const dx = changed[0].clientX - touchStartX;
    const dy = changed[0].clientY - touchStartY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 80) return;
    if (dx > 0 && touchStartX < 40) {
      // v3.8.3 (C3): close the opposite panel so we don't stack both drawers.
      // Matches the toggle-button behavior in topbar.js + mobile-chrome.js.
      $('rightPanel')?.classList.remove('open');
      $('leftPanel')?.classList.add('open');
      $('panelBackdrop')?.classList.add('show');
      swipeHandled = true;
    } else if (dx < 0 && touchStartX > window.innerWidth - 40) {
      // v3.8.3 (C3): mirror of the above — opening right drawer closes left.
      $('leftPanel')?.classList.remove('open');
      $('rightPanel')?.classList.add('open');
      $('panelBackdrop')?.classList.add('show');
      swipeHandled = true;
    }
  }, { passive: true });
}
