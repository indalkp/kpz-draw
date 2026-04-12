// src/drawing/brush.js
// Brush rendering primitives — stamp, segment, and pressure helpers.
// Pure rendering functions that operate on a given canvas 2D context.

import { App } from '../core/state.js';
import { hexToRgb } from '../utils/color.js';

/**
 * Get the stamp size at a given pressure level.
 */
export function getStampSize(pressure) {
  const s = App.brush.size;
  const inf = App.brush.presSize;
  return s * (1 - inf + inf * pressure);
}

/**
 * Get the stamp alpha at a given pressure level.
 */
export function getStampAlpha(pressure) {
  const a = App.brush.opacity;
  const inf = App.brush.presOp;
  return a * (1 - inf + inf * pressure);
}

/**
 * Render a single radial-gradient stamp at (x, y) on the given context.
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
 * Render a single dot stamp at point p (for tap-to-dot).
 */
export function drawDot(ctx, p) {
  stamp(ctx, p.x, p.y, getStampSize(p.pressure), getStampAlpha(p.pressure));
}

/**
 * Render a series of stamps along the segment from point a to point b.
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
