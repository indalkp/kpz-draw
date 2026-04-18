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
import { closeRefViewer, showRef } from '../ui/ref-viewer.js';
import { $ } from '../utils/dom-helpers.js';

export function wireGlobalEvents() {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('resize', () => { if (App.project) applyView(); });

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
    let firstFit = true;
    const ro = new ResizeObserver((entries) => {
      if (!App.project) return;
      const rect = entries[0] && entries[0].contentRect;
      const hasRealSize = rect && rect.width > 100 && rect.height > 100;
      if (firstFit && hasRealSize) {
        firstFit = false;
        fitView();
      } else if (hasRealSize && App.view.scale <= 0.06) {
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

function handleKeyDown(e) {
  if (e.target.matches('input,textarea,select')) return;
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); $('saveModal')?.classList.add('open'); return; }
  if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileInput')?.click(); return; }
  if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); $('newModal')?.classList.add('open'); return; }

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
}

function toggleFullscreen() {
  document.body.classList.toggle('fullscreen');
  if (App.project) requestAnimationFrame(applyView);
}

// ============================================================================
// Touch pinch/zoom on canvas — v3.7.0 hardened
// ============================================================================
let canvasTouchState = null;
let lastTapTime = 0;

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

function setupCanvasTouch() {
  const canvasArea = $('canvasArea');

  canvasArea.addEventListener('touchstart', e => {
    // v3.7.0: if a pointer stroke is already in progress, stay out of the way.
    // The pen (or the active finger) owns the canvas until it lifts.
    if (App.isDrawing) return;

    // v3.7.0: ignore pencil touches entirely — they're handled via pointer
    // events. Only fingers should ever trigger pinch / tap / 3-finger-undo.
    const fingers = fingerTouches(e.touches);

    if (fingers.length === 2) {
      e.preventDefault();
      const [a, b] = fingers;
      canvasTouchState = {
        d: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2,
        vx: App.view.x, vy: App.view.y, scale: App.view.scale
      };
    } else if (fingers.length === 3) {
      undo(); canvasTouchState = 'undo';
    } else if (fingers.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 320) { fitView(); e.preventDefault(); lastTapTime = 0; return; }
      lastTapTime = now;
    }
  }, { passive: false });

  canvasArea.addEventListener('touchmove', e => {
    // v3.7.0: drawing takes priority — don't pinch-zoom mid-stroke
    if (App.isDrawing) return;

    const fingers = fingerTouches(e.touches);
    if (fingers.length === 2 && canvasTouchState && canvasTouchState !== 'undo') {
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
    if (fingers.length < 2) canvasTouchState = null;
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
      $('leftPanel')?.classList.add('open');
      $('panelBackdrop')?.classList.add('show');
      swipeHandled = true;
    } else if (dx < 0 && touchStartX > window.innerWidth - 40) {
      $('rightPanel')?.classList.add('open');
      $('panelBackdrop')?.classList.add('show');
      swipeHandled = true;
    }
  }, { passive: true });
}
