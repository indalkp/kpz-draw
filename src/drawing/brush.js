// src/drawing/brush.js
//
// v3.7.0: Adds drawQuadSegment — lays stamps along a quadratic Bézier curve
// instead of a straight line. Canvas.js uses it via the midpoint method so
// that fast / sparse pointer samples render as smooth curves, not polylines.
// The original drawSegment is kept for the tail-end of a stroke and for the
// second-sample warm-up case (where we don't yet have a full Bézier).
//
// v3.6.3 compositing preserved: all stamps go to the offscreen stroke
// buffer at alpha=1, and the buffer is composited onto the layer ONCE at
// App.brush.opacity in flushStrokeBuffer (canvas.js). This is what keeps
// opacity 0.2 actually looking like 20%.

import { App } from '../core/state.js';
import { hexToRgb } from '../utils/color.js';

/** Stamp diameter at a given pressure level. */
export function getStampSize(pressure) {
  const s = App.brush.size;
  const inf = App.brush.presSize;
  return s * (1 - inf + inf * pressure);
}

/** In-stroke stamp alpha (target opacity is applied later at composite time). */
export function getStampAlpha(pressure) {
  const inf = App.brush.presOp;
  return 1 - inf + inf * pressure;
}

/**
 * Render a single radial-gradient stamp at (x, y) on the given context.
 *
 * v3.9.3 HOTFIX: stamps always paint into the offscreen stroke buffer with
 * `source-over` — even for the eraser. The buffer is just an opaque-shape
 * accumulator. The eraser-vs-brush distinction is applied ONCE at flush
 * time in flushStrokeBuffer() (canvas.js), where the layer composites the
 * buffer with `destination-out` for the eraser or `source-over` at
 * App.brush.opacity for the brush.
 *
 * Why this regressed in v3.6.3: that release moved opacity compositing from
 * per-stamp to the post-stroke flush, but stamp() kept its erase-time
 * `destination-out`. Setting destination-out on the EMPTY per-stroke
 * buffer removed nothing (no destination to remove from), so the buffer
 * stayed transparent, and flushStrokeBuffer's destination-out composited
 * a transparent buffer onto the layer — net effect: eraser did nothing.
 */
export function stamp(ctx, x, y, size, alpha) {
  const r = size / 2;
  if (r < 0.5) return;
  const erase = App.tool === 'eraser';
  // v3.9.3: source-over always when stamping into the per-stroke buffer.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  const inner = r * App.brush.hardness;
  const grad = ctx.createRadialGradient(x, y, inner, x, y, r);
  // Color choice doesn't affect the eraser flush (destination-out only uses
  // alpha), but black keeps the buffer image debuggable if inspected.
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

/** Tap-to-dot helper. Single stamp, no overlap. */
export function drawDot(ctx, p) {
  stamp(ctx, p.x, p.y, getStampSize(p.pressure), getStampAlpha(p.pressure));
}

/**
 * Straight-line stamp segment from a → b.
 * Kept for:
 *   - the second sample of a stroke (not enough points for a curve yet)
 *   - the stroke-end tail between the last midpoint and the final sample
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

/**
 * v3.7.0: Lay stamps along a quadratic Bézier curve from a → b with control cp.
 * Used by canvas.js with the midpoint method:
 *   a  = midpoint(prev,  last) — segment start
 *   cp = last                  — control point (an actual sample)
 *   b  = midpoint(last,  new)  — segment end
 * Each sample point ends up being a smooth control, and the drawn path passes
 * through the midpoints. Gives C1 continuity across segments — no visible
 * kinks between successive pointer moves.
 */
export function drawQuadSegment(ctx, a, cp, b) {
  // Estimate curve length via the control polygon (|a-cp| + |cp-b|). This is
  // always >= the true curve length, so we slightly over-sample which is fine
  // for stamp-based rendering — overlap is the point.
  const dx1 = cp.x - a.x, dy1 = cp.y - a.y;
  const dx2 = b.x - cp.x, dy2 = b.y - cp.y;
  const chord = Math.sqrt(dx1 * dx1 + dy1 * dy1) + Math.sqrt(dx2 * dx2 + dy2 * dy2);

  // Spacing matches the straight-line version so look is consistent.
  const sizeA = getStampSize(a.pressure);
  const spacing = Math.max(0.5, sizeA * 0.15);
  const steps = Math.max(1, Math.ceil(chord / spacing));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    // Standard quadratic Bézier: B(t) = (1-t)^2·a + 2(1-t)t·cp + t^2·b
    const x = u * u * a.x + 2 * u * t * cp.x + t * t * b.x;
    const y = u * u * a.y + 2 * u * t * cp.y + t * t * b.y;
    // Pressure interpolates linearly across the segment (cp.pressure isn't
    // special to the user — it's just "last sample", same as a and b).
    const pr = a.pressure + (b.pressure - a.pressure) * t;
    stamp(ctx, x, y, getStampSize(pr), getStampAlpha(pr));
  }
}
