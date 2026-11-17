// src/drawing/brush.js
//
// Modern, high-performance digital art brush & pen engine.
// Provides smooth, artifact-free stamping along quadratic Bézier curves
// with natural pen pressure dynamics, anti-aliased brush tips (crisp inking
// pen to soft round brush), and zero random / spiky artifacts.

import { App } from '../core/state.js';
import { hexToRgb } from '../utils/color.js';

// Canonical diameter for pre-rendered brush tip cache.
const TIP_CANONICAL_DIAMETER = 256;
let tipCanvas = null;
let tipCtx = null;
let cachedTipKey = '';

// Optional GL brush reference (kept for architectural compatibility).
let activeGLBrush = null;
export function setActiveGLBrush(gl) { activeGLBrush = gl; }

/**
 * Pre-render and cache the brush tip.
 * - For hardness >= 0.98: Solid circle with crisp anti-aliased edge (pure pen / inking).
 * - For hardness < 0.98: Radial gradient falloff (smooth soft round brush / airbrush).
 */
export function ensureTipCanvas() {
  const color = App.brush.color || '#000000';
  const hardness = (App.brush.hardness != null) ? App.brush.hardness : 0.8;
  const key = `${color}|${hardness.toFixed(2)}`;
  if (cachedTipKey === key && tipCanvas) return tipCanvas;

  if (!tipCanvas) {
    tipCanvas = document.createElement('canvas');
    tipCanvas.width = TIP_CANONICAL_DIAMETER;
    tipCanvas.height = TIP_CANONICAL_DIAMETER;
    tipCtx = tipCanvas.getContext('2d');
    tipCtx.imageSmoothingEnabled = true;
    tipCtx.imageSmoothingQuality = 'high';
  }

  const D = TIP_CANONICAL_DIAMETER;
  const cx = D / 2;
  const cy = D / 2;
  const radius = D / 2;
  const { r: R, g: G, b: B } = hexToRgb(color);

  tipCtx.clearRect(0, 0, D, D);

  if (hardness >= 0.98) {
    // Sharp solid tip (pure pen / inking brush) with clean anti-aliasing
    tipCtx.fillStyle = `rgb(${R},${G},${B})`;
    tipCtx.beginPath();
    tipCtx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    tipCtx.fill();
  } else {
    // Soft/falloff tip (airbrush / smooth round brush)
    const inner = radius * Math.max(0, hardness);
    const grad = tipCtx.createRadialGradient(cx, cy, inner, cx, cy, radius);
    grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
    grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
    tipCtx.fillStyle = grad;
    tipCtx.beginPath();
    tipCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    tipCtx.fill();
  }

  cachedTipKey = key;
  return tipCanvas;
}

/**
 * Calculate stamp diameter at a given calibrated pressure level.
 * Full natural dynamic range from ultra-fine hairline up to full brush size.
 */
export function getStampSize(pressure) {
  const baseSize = Math.max(1, App.brush.size || 1);
  const inf = (App.brush.presSize != null) ? App.brush.presSize : 1.0;
  const p = (pressure != null) ? Math.max(0, Math.min(1, pressure)) : 0.5;
  const modulated = baseSize * (1 - inf + inf * p);
  // Ensure a clean visible sub-pixel minimum so lines don't completely vanish at very light touch
  return Math.max(0.5, modulated);
}

/**
 * In-stroke stamp alpha modulation from pen pressure.
 */
export function getStampAlpha(pressure) {
  const inf = (App.brush.presOp != null) ? App.brush.presOp : 0;
  if (inf <= 0) return 1.0;
  const p = (pressure != null) ? Math.max(0, Math.min(1, pressure)) : 0.5;
  return Math.max(0.02, 1 - inf + inf * p);
}

/**
 * Render a single stamp at (x, y) on the target context.
 */
export function stamp(ctx, x, y, size, alpha) {
  if (!ctx || size < 0.2) return;
  const r = size / 2;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  const tip = ensureTipCanvas();
  ctx.drawImage(tip, x - r, y - r, size, size);
}

/**
 * Tap-to-dot: single stamp for tap / click.
 */
export function drawDot(ctx, p) {
  if (!ctx || !p) return;
  const pr = p.pressure ?? 0.5;
  stamp(ctx, p.x, p.y, getStampSize(pr), getStampAlpha(pr));
}

/**
 * Calculate dynamic stamp spacing along a path.
 * Spacing of ~12% of stamp diameter gives ~88% overlap: solid, smooth, gap-free stroke.
 */
function getAdaptiveSpacing(size) {
  return Math.max(0.5, size * 0.12);
}

/**
 * Straight-line stamp segment from a → b with dynamic step spacing and pressure interpolation.
 */
export function drawSegment(ctx, a, b) {
  if (!ctx || !a || !b) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);

  const prA = a.pressure ?? 0.5;
  const prB = b.pressure ?? 0.5;
  const sizeA = getStampSize(prA);
  const sizeB = getStampSize(prB);
  const avgSize = (sizeA + sizeB) / 2;
  const spacing = getAdaptiveSpacing(avgSize);
  const steps = Math.max(1, Math.ceil(dist / spacing));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const pr = prA + (prB - prA) * t;
    stamp(ctx, x, y, getStampSize(pr), getStampAlpha(pr));
  }
}

/**
 * Lay stamps along a quadratic Bézier curve from a → b with control cp (midpoint method).
 * Provides C1 continuous curves with smooth dynamic pressure and zero polygonal kinks.
 */
export function drawQuadSegment(ctx, a, cp, b) {
  if (!ctx || !a || !cp || !b) return;

  const dx1 = cp.x - a.x, dy1 = cp.y - a.y;
  const dx2 = b.x - cp.x, dy2 = b.y - cp.y;
  const chord = Math.hypot(dx1, dy1) + Math.hypot(dx2, dy2);

  const prA = a.pressure ?? 0.5;
  const prB = b.pressure ?? 0.5;
  const sizeA = getStampSize(prA);
  const sizeB = getStampSize(prB);
  const avgSize = (sizeA + sizeB) / 2;
  const spacing = getAdaptiveSpacing(avgSize);
  const steps = Math.max(1, Math.ceil(chord / spacing));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    // Standard quadratic Bézier: B(t) = (1-t)^2·a + 2(1-t)t·cp + t^2·b
    const x = u * u * a.x + 2 * u * t * cp.x + t * t * b.x;
    const y = u * u * a.y + 2 * u * t * cp.y + t * t * b.y;
    const pr = prA + (prB - prA) * t;
    stamp(ctx, x, y, getStampSize(pr), getStampAlpha(pr));
  }
}

/**
 * Standard Brush Presets for quick switching.
 */
export const BRUSH_PRESETS = {
  pen: {
    name: 'Pen',
    hardness: 1.0,
    presSize: 1.0,
    presOp: 0.0,
    smoothing: 0.35,
    stabilization: 0.0,
    pressureCurve: 0.5,
  },
  brush: {
    name: 'Brush',
    hardness: 0.7,
    presSize: 1.0,
    presOp: 0.45,
    smoothing: 0.3,
    stabilization: 0.0,
    pressureCurve: 0.5,
  },
  pencil: {
    name: 'Pencil',
    hardness: 0.85,
    presSize: 0.75,
    presOp: 0.6,
    smoothing: 0.15,
    stabilization: 0.0,
    pressureCurve: 0.45,
  },
  marker: {
    name: 'Marker',
    hardness: 0.98,
    presSize: 0.0,
    presOp: 0.0,
    smoothing: 0.2,
    stabilization: 0.0,
    pressureCurve: 0.5,
  },
};
