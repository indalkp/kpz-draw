// src/drawing/smoothing.js
//
// v3.7.0: One-Euro filter — replaces the old first-order exponential lerp
// used in canvas.js. This is the same family of smoothing that Procreate /
// Clip Studio use. The trick: heavy smoothing at low velocity (kills hand
// jitter at rest) and light smoothing at high velocity (doesn't lag behind
// fast intentional strokes). A plain exponential lerp can't do both.
//
// Reference: Casiez, Roussel, Vogel —
// "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input" (CHI 2012).
//
// Usage per stroke:
//   const fx = new OneEuroFilter();     // one filter per axis
//   const fy = new OneEuroFilter();
//   const x = fx.filter(rawX, event.timeStamp);
//   const y = fy.filter(rawY, event.timeStamp);
// Reset at the start of each new stroke (or construct fresh ones).

export class OneEuroFilter {
  /**
   * @param {number} minCutoff — cutoff Hz at zero velocity. Lower = smoother at rest.
   *                             Try 0.5 (heavy) to 20 (barely smoothed).
   * @param {number} beta      — how fast the cutoff rises with velocity.
   *                             Higher = more responsive to fast motion. Try 0.01..0.15.
   * @param {number} dCutoff   — cutoff for the velocity signal itself. 1.0 is standard.
   */
  constructor(minCutoff = 2.0, beta = 0.08, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.xPrev = null;   // last smoothed value
    this.dxPrev = 0;     // last smoothed derivative (velocity)
    this.tPrev = null;   // last timestamp (ms)
  }

  // Standard one-pole low-pass alpha for a given cutoff freq (Hz) and dt (seconds)
  _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /**
   * Feed one raw sample, get back the smoothed value.
   * @param {number} x — raw input (e.g. pointer X in canvas space)
   * @param {number} t — event timestamp in ms (use event.timeStamp)
   */
  filter(x, t) {
    // First sample: nothing to smooth against, seed state and return as-is
    if (this.tPrev == null) {
      this.tPrev = t;
      this.xPrev = x;
      return x;
    }
    // dt in seconds. Clamp to tiny positive to avoid divide-by-zero on same-frame events.
    const dt = Math.max(1e-6, (t - this.tPrev) / 1000);

    // Raw velocity, then smooth it at a fixed cutoff (dCutoff). This is the key trick:
    // we low-pass the *velocity* so that the adaptive cutoff below isn't itself noisy.
    const dx = (x - this.xPrev) / dt;
    const aD = this._alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    // Adaptive cutoff: rises linearly with |velocity|. Fast motion passes through
    // almost unfiltered; slow motion is heavily smoothed.
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this._alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }
}

/**
 * Map the existing App.brush.smoothing slider (0..1) to One-Euro parameters.
 *   smoothing = 0   → minCutoff=20, beta=0.01  → effectively raw input
 *   smoothing = 0.4 → minCutoff=~4, beta=~0.05 → Procreate-like balanced
 *   smoothing = 1   → minCutoff=0.5, beta=0.12 → heavy lag-stabilised
 *
 * Returns a fresh {fx, fy} pair — one filter per axis. NEW pressure
 * outlier handling lives in canvas.js (delta-clamp), not here.
 *
 * v3.12.7 added an fp One-Euro filter for pressure to attenuate iPad
 * pressure spikes. v3.12.8 reverted that approach: One-Euro introduces
 * latency during real pressure ramps (Wacom users on PC reported the
 * line not thinning when they pressed lighter — the filter was lagging
 * the actual pressure decrease). One-Euro smooths *steady* signals
 * well but is not the right tool for rejecting *single-sample* spikes;
 * it both lags genuine ramps AND lets fast spikes mostly through.
 *
 * The replacement is a delta-clamp in canvas.js: per-sample pressure
 * change is capped at ±0.5. Natural pressure ramps (deltas 0.05–0.15)
 * pass through completely unaffected; spike outliers get attenuated
 * by half on the spike sample with zero lag elsewhere.
 */
export function makeStrokeSmoother(smoothing01) {
  const s = Math.max(0, Math.min(1, smoothing01));
  // Quadratic falloff so small slider values don't kill responsiveness
  const minCutoff = 20 * (1 - s) * (1 - s) + 0.5;
  const beta = 0.01 + 0.11 * s;
  return {
    fx: new OneEuroFilter(minCutoff, beta),
    fy: new OneEuroFilter(minCutoff, beta),
  };
}
