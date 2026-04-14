// src/drawing/brush.js
//
// v3.6.3: Krita-style per-stroke compositing.
//   Before: every stamp drew directly on the layer with its own alpha.
//   Stamps overlap heavily (15% spacing), so opacity 0.2 actually painted
//   ~0.99 visual density over 20 stamps — strokes always looked opaque.
//
//   After: the stroke is drawn onto an offscreen buffer at alpha=1. The
//   layer receives the entire stroke as ONE composite at the real target
//   opacity. Result: opacity 0.2 looks like 20%, not 99%. Pressure→opacity
//   still varies within the stroke but is no longer compounded by overlap.
//
// Pure rendering functions that operate on a given canvas 2D context.

import { App } from '../core/state.js';
import { hexToRgb } from '../utils/color.js';

/**
 * Stamp size at a given pressure level.
 */
export function getStampSize(pressure) {
  const s = App.brush.size;
  const inf = App.brush.presSize;
  return s * (1 - inf + inf * pressure);
}

/**
 * Stamp alpha (IN-STROKE — so pressure variation still works), independent
 * of the target opacity. The target opacity is applied once when the buffer
 * composites onto the layer (see flushStrokeBuffer in canvas.js).
 */
export function getStampAlpha(pressure) {
  const inf = App.brush.presOp;
  // No opacity multiplier here — that's applied at composite time.
  // Pressure still modulates in-stroke variation:
  //   presOp=0   → every stamp fully opaque in the buffer (flat stroke)
  //   presOp=1   → pressure 0 → fully transparent, pressure 1 → fully opaque
  return 1 - inf + inf * pressure;
}

/**
 * Render a single radial-gradient stamp at (x, y) on the given context.
 * Caller passes the appropriate ctx:
 *   - stroke buffer (2d context of an offscreen canvas) for normal painting
 *   - layer canvas directly for tap-to-dot fallback (single stamp, no overlap issue)
 */
export function stamp(ctx, x, y, size, alpha) {
  const r = size / 2;
  if (r < 0.5) return;
  const erase = App.tool === 'eraser';
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.globalAlpha = alpha;
  const inner = r * App.brush.hardness;
  const grad = ctx.createRadialGradient(x, y, inner, x, y, r);
  const col = erase ? '#000' : App.brush.color;
  const { r: R, g: G, b: B } = hexToRgb(col);
  grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
  grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Render a single dot at point p — used for tap-to-dot at end of a stroke
 * that never moved. Draws on whichever ctx the caller passes (typically the
 * stroke buffer, then the caller composites it onto the layer).
 */
export function drawDot(ctx, p) {
  // For tap-to-dot we want a *single* stamp at full stamp-alpha (no overlap)
  // so that the target opacity faithfully reflects the slider.
  stamp(ctx, p.x, p.y, getStampSize(p.pressure), getStampAlpha(p.pressure));
}

/**
 * Render a series of stamps along the segment from a → b onto ctx.
 */
export function drawSegment(ctx, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const sizeA = getStampSize(a.pressure);
  const spacing = Math.max(0.5, sizeA * 0.15);
  const steps = Math.max(1, Math.ceil(dist / spacing));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const pr = a.pressure + (b.pressure - a.pressure) * t;
    stamp(ctx, x, y, getStampSize(pr), getStampAlpha(pr));
  }
}
