// src/core/events.js
// Global keyboard shortcuts, window resize, and touch gesture wiring.
// Called once from main.js after all subsystems are initialized.

import { App } from './state.js';
import { undo, redo } from '../drawing/history.js';
import { fitView, setZoom, applyView } from '../drawing/view.js';
import { setTool } from '../ui/toolrail.js';
import { updateBrushUI } from '../ui/brush-panel.js';
import { closeRefViewer, showRef } from '../ui/ref-viewer.js';
import { $ } from '../utils/dom-helpers.js';

export function wireGlobalEvents() {
  // ---- Keyboard ----
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  // ---- Window resize ----
  window.addEventListener('resize', () => { if (App.project) applyView(); });

  // ---- Touch gestures on canvas area ----
  setupCanvasTouch();

  // ---- Swipe to open mobile panels ----
  setupSwipe();

  // ---- Canvas wheel zoom ----
  const canvasArea = $('canvasArea');
  canvasArea.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvasArea.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(App.view.scale * factor, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // ---- ResizeObserver for canvas area ----
  if (typeof ResizeObserver !== 'undefined') {
    let firstFit = true;
    const ro = new ResizeObserver(() => {
      if (!App.project) return;
      if (firstFit) { firstFit = false; fitView(); }
      else applyView();
    });
    ro.observe(canvasArea);
  }

  // ---- beforeunload ----
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

  // Reference viewer navigation
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

// ---- Touch pinch/zoom on canvas ----
let canvasTouchState = null;
let lastTapTime = 0;

function setupCanvasTouch() {
  const canvasArea = $('canvasArea');

  canvasArea.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      canvasTouchState = {
        d: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2,
        vx: App.view.x, vy: App.view.y, scale: App.view.scale
      };
      App.isDrawing = false;
    } else if (e.touches.length === 3) {
      undo(); canvasTouchState = 'undo';
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 320) { fitView(); e.preventDefault(); lastTapTime = 0; return; }
      lastTapTime = now;
    }
  }, { passive: false });

  canvasArea.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && canvasTouchState && canvasTouchState !== 'undo') {
      e.preventDefault();
      const [a, b] = e.touches;
      const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
      const ratio = d / canvasTouchState.d;
      App.view.scale = Math.max(0.05, Math.min(16, canvasTouchState.scale * ratio));
      App.view.x = canvasTouchState.vx + (cx - canvasTouchState.cx);
      App.view.y = canvasTouchState.vy + (cy - canvasTouchState.cy);
      applyView();
    }
  }, { passive: false });

  canvasArea.addEventListener('touchend', e => { if (e.touches.length < 2) canvasTouchState = null; });
}

function setupSwipe() {
  const canvasArea = $('canvasArea');
  let touchStartX = 0, touchStartY = 0, swipeHandled = false;

  canvasArea.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swipeHandled = false;
  }, { passive: true });

  canvasArea.addEventListener('touchend', e => {
    if (swipeHandled) return;
    if (window.innerWidth > 1100) return;
    const dx = (e.changedTouches[0]?.clientX || 0) - touchStartX;
    const dy = (e.changedTouches[0]?.clientY || 0) - touchStartY;
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
