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

// Lazy DOM refs — looked up on first use so this module can be imported
// before the DOM is built by core/dom.js.
let display, dctx, canvasWrap, canvasArea;
function ensureDom() {
  if (display) return;
  display    = $('displayCanvas');
  dctx       = display.getContext('2d');
  canvasWrap = $('canvasWrap');
  canvasArea = $('canvasArea');
}

// ----------------------------------------------------------------------------
//  View transform
// ----------------------------------------------------------------------------

/** Apply the current App.view transform to the canvas wrapper. */
export function applyView() {
  ensureDom();
  // v3.5: transform-origin is center center, so we translate(-50%,-50%) first
  // to offset the wrapper's top-left pivot, THEN apply the user pan/zoom.
  canvasWrap.style.transform =
    `translate(-50%,-50%) translate(${App.view.x}px,${App.view.y}px) scale(${App.view.scale})`;
  $('zoomInfo').textContent = Math.round(App.view.scale * 100) + '%';
}

/**
 * Fit the canvas to the viewport.
 * @param {'width'|'height'|undefined} mode - 'width' fits horizontally,
 *   'height' fits vertically, undefined (default) fits whole image.
 */
export function fitView(mode) {
  ensureDom();
  const pad = 40;
  const aw = canvasArea.clientWidth - pad * 2;
  const ah = canvasArea.clientHeight - pad * 2;
  let s;
  if (mode === 'width')       s = aw / App.project.width;
  else if (mode === 'height') s = ah / App.project.height;
  else                        s = Math.min(aw / App.project.width, ah / App.project.height, 4);
  App.view.scale = Math.max(0.05, s);
  App.view.x = 0;
  App.view.y = 0;
  applyView();
}

/**
 * Set zoom level, optionally pivoting around a client-space point (cx, cy).
 * When cx/cy provided, the point under the cursor stays stationary during zoom.
 */
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

// ----------------------------------------------------------------------------
//  Display canvas rendering
// ----------------------------------------------------------------------------

/** Re-composite all visible layers of the active panel onto the display canvas. */
export function renderDisplay() {
  ensureDom();
  const p = App.project;
  if (display.width  !== p.width)  display.width  = p.width;
  if (display.height !== p.height) display.height = p.height;
  dctx.clearRect(0, 0, p.width, p.height);
  const panel = curPanel();
  for (const layer of panel.layers) {
    if (!layer.visible) continue;
    dctx.globalAlpha = layer.opacity;
    dctx.globalCompositeOperation = layer.blend || 'source-over';
    dctx.drawImage(layer.canvas, 0, 0);
  }
  dctx.globalAlpha = 1;
  dctx.globalCompositeOperation = 'source-over';
  $('canvasInfo').textContent = `${p.width} × ${p.height}`;
}

// ----------------------------------------------------------------------------
//  Pointer → canvas-space coordinate mapping
// ----------------------------------------------------------------------------

/**
 * Convert a pointer event to canvas-space {x, y, pressure}.
 * Uses getBoundingClientRect so it's correct under any view transform.
 * Normalizes pressure: if the device reports 0.5 (the default for non-pressure
 * devices) we treat mouse events as full pressure (1) and touch as 0.5.
 */
export function pointerToCanvas(e) {
  ensureDom();
  const rect = display.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width  * App.project.width;
  const y = (e.clientY - rect.top)  / rect.height * App.project.height;
  const pressure = (e.pressure > 0 && e.pressure !== 0.5)
    ? e.pressure
    : (e.pointerType === 'mouse' ? 1 : 0.5);
  return { x, y, pressure };
}

// ----------------------------------------------------------------------------
//  Eyedropper
// ----------------------------------------------------------------------------

/**
 * Sample a color from the composited display canvas at the pointer location.
 * Switches back to brush tool after sampling — matches v3.5 behavior.
 */
export function pickColor(e) {
  ensureDom();
  const p = pointerToCanvas(e);
  const data = dctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
  const hex = '#' + [data[0], data[1], data[2]]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('');
  App.brush.color = hex;
  const input = $('colorPicker');
  if (input) input.value = hex;
  setTool('brush');
}

// ----------------------------------------------------------------------------
//  Pan state machine
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
//  Layer thumbnail updates
// ----------------------------------------------------------------------------

/**
 * Redraw the mini-thumbnail for layer index `i` in the Layers panel.
 * Called after every stroke end and on layer visibility changes.
 */
export function updateLayerThumb(i) {
  const c = document.querySelector(`#layersList canvas[data-thumb="${i}"]`);
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const layer = curPanel().layers[i];
  if (!layer) return;
  ctx.drawImage(layer.canvas, 0, 0, c.width, c.height);
}
