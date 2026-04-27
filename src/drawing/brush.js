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

// v3.15.0 Phase 4-lite: pre-rendered brush tip cache.
//
// The original stamp() rebuilt a CanvasRadialGradient + beginPath + arc +
// fill on every single stamp. For a single fast stroke that's hundreds of
// gradient allocations + path tessellations per second. Magma / Procreate
// solve this on the GPU with a textured-quad shader; we get most of the
// benefit on Canvas 2D by pre-rendering the brush tip ONCE at a canonical
// size, then drawImage'ing it (with scale) on every stamp. Browsers
// hardware-accelerate canvas-to-canvas drawImage; the cost drops to a
// single textured blit per stamp.
//
// The cache invalidates only on color or hardness change. Size doesn't
// matter — drawImage handles per-stamp scaling. Pressure-modulated size
// just changes the destination rect, never invalidates the tip.
//
// Full WebGL2 rasterizer (Phase 4 proper) is a future v3.16+ task once
// textured / scatter / dual brushes are on the roadmap.
const TIP_CANONICAL_DIAMETER = 256;
let tipCanvas = null;
let tipCtx = null;
let cachedTipKey = '';

function ensureTipCanvas() {
  const key = `${App.brush.color}|${App.brush.hardness}`;
  if (cachedTipKey === key && tipCanvas) return tipCanvas;

  if (!tipCanvas) {
    tipCanvas = document.createElement('canvas');
    tipCanvas.width  = TIP_CANONICAL_DIAMETER;
    tipCanvas.height = TIP_CANONICAL_DIAMETER;
    tipCtx = tipCanvas.getContext('2d');
    // v3.15.1: ensure the canonical-tip rasterization itself uses the
    // best filter kernel available (only matters for the gradient/arc
    // primitives below, but free to set).
    tipCtx.imageSmoothingEnabled = true;
    tipCtx.imageSmoothingQuality = 'high';
  }

  const D = TIP_CANONICAL_DIAMETER;
  const cx = D / 2, cy = D / 2;
  const radius = D / 2;
  const inner = radius * App.brush.hardness;

  tipCtx.clearRect(0, 0, D, D);
  const { r: R, g: G, b: B } = hexToRgb(App.brush.color);
  const grad = tipCtx.createRadialGradient(cx, cy, inner, cx, cy, radius);
  grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
  grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
  tipCtx.fillStyle = grad;
  tipCtx.beginPath();
  tipCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  tipCtx.fill();

  cachedTipKey = key;
  return tipCanvas;
}

/**
 * v3.12.5: minimum effective brush diameter, in canvas-px.
 *
 * Below ~5 px, stamps fall into sub-pixel territory once pressure
 * modulation kicks in: the radial-gradient + arc rasterization can
 * only place tiny amounts of alpha at integer canvas coordinates,
 * and at typical display zooms those alpha contributions sum to
 * sub-display-pixel intensity → "stroke disappears" reports.
 *
 * Per-user feedback we calibrate brush size 1 to render with the
 * same effective stamp size as the previous brush size 5. The slider
 * still goes 1–200 for familiarity; values 1–5 are clamped to the
 * 5-px minimum, values 6+ pass through unchanged.
 */
const MIN_EFFECTIVE_BRUSH_PX = 5;

/** Stamp diameter at a given pressure level.
 *
 * Two clamps:
 *
 * 1. Effective brush size floor at MIN_EFFECTIVE_BRUSH_PX (= 5). Slider
 *    values 1–5 all render as size 5 — guarantees the smallest
 *    selectable brush is always a visible thin pen.
 *
 * 2. Stamp size floor at MIN_VISIBLE_STAMP_PX (= 1, ABSOLUTE).
 *
 * v3.12.6 — IMPORTANT design correction: the v3.12.5 floor was 20%
 * of brush size (`s * 0.2`), which scaled with the brush. At brush 30
 * the floor was 6 px; at brush 100 it was 20 px. Light pressure
 * could never produce thinner strokes than 20% of the nominal brush
 * width, eating most of the dynamic range and killing the natural
 * pressure-controls-line-weight feel that pro tablets are calibrated
 * around.
 *
 * The correct design is an ABSOLUTE pixel floor — light pen pressure
 * on a brush 30 should produce roughly the same thin line as light
 * pressure on a brush 5, with the FULL-pressure stamp scaling with
 * brush size. This is what Procreate / Krita / Clip Studio do:
 *
 *     stamp_size = max(min_visible_px, brush * pressure)
 *
 * The 1-px absolute floor only kicks in for extreme low-pressure
 * cases (raw pressure < 1/brush_size), preventing total invisibility
 * without otherwise affecting the pressure curve. Brush 30 with
 * pressure 0.05 now produces a 1.5-px stamp; brush 30 with pressure
 * 1.0 produces a 30-px stamp — full natural dynamic range restored.
 */
const MIN_VISIBLE_STAMP_PX = 1;

export function getStampSize(pressure) {
  const s = Math.max(MIN_EFFECTIVE_BRUSH_PX, App.brush.size);
  const inf = App.brush.presSize;
  const modulated = s * (1 - inf + inf * pressure);
  return Math.max(MIN_VISIBLE_STAMP_PX, modulated);
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
  // v3.12.5: lowered radius-skip floor from 0.25 to 0.15 canvas-px.
  // Combined with getStampSize's two clamps (5px minimum brush, 20%
  // pressure floor), this is essentially a no-op now — stamps that
  // make it here are already guaranteed ≥0.5 radius. The floor stays
  // as a defensive last resort against future regressions.
  if (r < 0.15) return;
  // v3.9.3: source-over always when stamping into the per-stroke buffer.
  // The eraser-vs-brush distinction is applied ONCE at flush time in
  // flushStrokeBuffer (canvas.js); stamp() always paints into the
  // accumulator. Eraser doesn't need a different colour here because
  // destination-out at flush time uses only the buffer's alpha channel.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  // v3.15.0: drawImage from the cached canonical tip. Bilinear filter
  // handles the per-stamp scaling for free; same visual output as the
  // old radialGradient + arc + fill but a fraction of the cost.
  const tip = ensureTipCanvas();
  ctx.drawImage(tip, x - r, y - r, size, size);
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
// v3.12.4: small-brush spacing override.
//
// The default spacing factor of 0.15 of stamp diameter gives ~85%
// stamp overlap, which is plenty when stamps are large enough that
// adjacent stamps' anti-aliased edges paper over any single dropped
// sample. Below ~10 px diameter that's no longer true: a single
// dropped input sample at brush size 8 leaves a clear gap (~30% of
// stroke width) because the small stamps don't have enough soft
// edge to bridge it. Field reports at brush sizes ≤ 8 confirmed
// "skipping" was directly tied to this perceptual threshold.
//
// Fix: drop the spacing factor to 0.08 (≈92% overlap) for small
// brushes, plus a hard floor at 0.3 canvas-px so very small brushes
// (size 2–3) still get sub-pixel-tight stamping. Large brushes
// keep the cheaper 0.15 factor — they don't need the extra density.
function smallBrushSpacing(sizeA) {
  if (sizeA >= 12) return Math.max(0.5, sizeA * 0.15);
  return Math.max(0.3, sizeA * 0.08);
}

export function drawSegment(ctx, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const sizeA = getStampSize(a.pressure);
  const spacing = smallBrushSpacing(sizeA);
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
  // v3.12.4: same small-brush-aware spacing.
  const sizeA = getStampSize(a.pressure);
  const spacing = smallBrushSpacing(sizeA);
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
