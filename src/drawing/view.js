// ============================================================================
//  drawing/view.js — spatial / rendering foundation
//
//  Owns: view transform (pan/zoom/fit), display canvas rendering,
//        pointer-to-canvas coordinate mapping, pan state machine,
//        eyedropper color sampling, layer thumbnail updates.
//
//  Extracted from kpz-draw-v3.5.html sections:
//    /* View transform */, /* Render display */, /* Drawing */ (pointerToCanvas,
//    pickColor), /* Pan */, /* Layers UI */ (updateLayerThumb only).
// ============================================================================

import { App, curPanel } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';
import { setTool } from '../ui/toolrail.js';
import { setBrushColor } from '../ui/brush-panel.js';

let display, dctx, canvasWrap, canvasArea;
function ensureDom() {
  if (display) return;
  display    = $('displayCanvas');
  dctx       = display.getContext('2d');
  canvasWrap = $('canvasWrap');
  canvasArea = $('canvasArea');
}

export function applyView() {
  ensureDom();
  canvasWrap.style.transform =
    `translate(-50%,-50%) translate(${App.view.x}px,${App.view.y}px) scale(${App.view.scale})`;
  $('zoomInfo').textContent = Math.round(App.view.scale * 100) + '%';
}

export function fitView(mode) {
  ensureDom();
  const pad = 40;
  const aw = canvasArea.clientWidth - pad * 2;
  const ah = canvasArea.clientHeight - pad * 2;
  // v3.8.1: Guard against zero/negative canvasArea sizes (happens on mobile
  // when fitView is called before the layout stabilizes, e.g. before the
  // address bar settles or before 100dvh resolves). Without this guard,
  // scale collapses to the 0.05 floor and the canvas renders ~64px wide,
  // appearing invisible inside a black area. ResizeObserver will re-invoke
  // fitView once the real size arrives.
  if (aw <= 0 || ah <= 0) return;
  let s;
  if (mode === 'width')       s = aw / App.project.width;
  else if (mode === 'height') s = ah / App.project.height;
  else                        s = Math.min(aw / App.project.width, ah / App.project.height, 4);
  App.view.scale = Math.max(0.05, s);
  App.view.x = 0;
  App.view.y = 0;
  applyView();
}

export function setZoom(s, cx, cy) {
  ensureDom();
  const old = App.view.scale;
  App.view.scale = Math.max(0.05, Math.min(16, s));
  if (cx != null && cy != null) {
    const rect = canvasArea.getBoundingClientRect();
    const dx = cx - rect.width / 2 - App.view.x;
    const dy = cy - rect.height / 2 - App.view.y;
    const ratio = App.view.scale / old;
    App.view.x -= dx * (ratio - 1);
    App.view.y -= dy * (ratio - 1);
  }
  applyView();
}

export function renderDisplay() {
  ensureDom();
  const p = App.project;
  if (display.width  !== p.width)  display.width  = p.width;
  if (display.height !== p.height) display.height = p.height;
  dctx.clearRect(0, 0, p.width, p.height);
  const panel = curPanel();

  // v3.6.3: During an in-progress stroke, we need to show the stroke buffer
  // on top of the active layer at the target opacity so the user sees what
  // they're drawing. The buffer itself isn't flushed onto the layer until
  // endStroke — that's how we get correct opacity (see canvas.js).
  // Lazy-load getStrokeBuffer to avoid circular import at module init.
  let strokeBuf = null;
  if (App.isDrawing) {
    // Dynamic require: canvas.js imports view.js, so we can't import the
    // other direction at the top. Grab it off the global-ish window handle
    // we already expose in state.js for debugging, or skip if not present.
    try {
      strokeBuf = window.__KPZ_strokeBuffer?.();
    } catch (_) { /* noop */ }
  }
  const activeLayerIdx = panel.activeLayer;
  const erasing = App.tool === 'eraser';

  for (let i = 0; i < panel.layers.length; i++) {
    const layer = panel.layers[i];
    if (!layer.visible) continue;

    // Draw the layer itself
    dctx.globalAlpha = layer.opacity;
    dctx.globalCompositeOperation = layer.blend || 'source-over';
    dctx.drawImage(layer.canvas, 0, 0);

    // v3.6.3: on the active layer only, overlay the in-progress stroke buffer.
    // Brush: source-over at App.brush.opacity. Eraser: we can't live-preview
    // a destination-out cleanly on the display canvas, so we draw nothing
    // and the user sees the stamp vanish on stroke-end (matches behavior
    // of most drawing apps — eraser previews are hard).
    if (strokeBuf && i === activeLayerIdx && !erasing) {
      dctx.globalAlpha = layer.opacity * App.brush.opacity;
      dctx.globalCompositeOperation = 'source-over';
      dctx.drawImage(strokeBuf, 0, 0);
    }
  }

  dctx.globalAlpha = 1;
  dctx.globalCompositeOperation = 'source-over';
  $('canvasInfo').textContent = `${p.width} × ${p.height}`;
}

/**
 * Convert a pointer event to canvas-space {x, y, pressure}.
 *
 * v3.5.1 FIX (big-dot bug):
 * Previous version forced mouse pressure to 1.0, which combined with
 * presSize=1 made every mouse stamp the full brush diameter — causing
 * the "big dot" / bloated stroke regression. v3.4.1 just used the raw
 * event pressure (browser reports 0.5 for mouse by default). Restored.
 */
export function pointerToCanvas(e) {
  ensureDom();
  const rect = display.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width  * App.project.width;
  const y = (e.clientY - rect.top)  / rect.height * App.project.height;
  // Use raw event pressure. Only fall back to 0.5 if the browser
  // reports 0 or undefined (which shouldn't normally happen).
  const pressure = (e.pressure != null && e.pressure > 0) ? e.pressure : 0.5;
  return { x, y, pressure };
}

export function pickColor(e) {
  ensureDom();
  const p = pointerToCanvas(e);
  const data = dctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
  const hex = '#' + [data[0], data[1], data[2]]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('');
  // v3.8.3 (M3): shared setter syncs desktop picker + mobile swatch + hex label
  setBrushColor(hex);
  setTool('brush');
}

export function startPan(e) {
  ensureDom();
  display.setPointerCapture(e.pointerId);
  App.isPanning = true;
  App.panStart = {
    x: e.clientX, y: e.clientY,
    vx: App.view.x, vy: App.view.y,
  };
  canvasArea.style.cursor = 'grabbing';
}

export function doPan(e) {
  App.view.x = App.panStart.vx + (e.clientX - App.panStart.x);
  App.view.y = App.panStart.vy + (e.clientY - App.panStart.y);
  applyView();
}

export function endPan() {
  ensureDom();
  App.isPanning = false;
  canvasArea.style.cursor = '';
}

export function updateLayerThumb(i) {
  const c = document.querySelector(`#layersList canvas[data-thumb="${i}"]`);
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const layer = curPanel().layers[i];
  if (!layer) return;
  ctx.drawImage(layer.canvas, 0, 0, c.width, c.height);
}
