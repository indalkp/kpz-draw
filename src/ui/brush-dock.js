// src/ui/brush-dock.js
//
// v3.8.0: Procreate-style vertical brush sliders, pinned to the left edge of
// the canvas on mobile/tablet. Two tracks: size (1..200px) and opacity (0..1).
// Drag vertically — the fill height tracks your finger, the thumb shows the
// current value, and the same App.brush.size / App.brush.opacity state that
// the right-panel desktop sliders write to is updated here.
//
// This module is init'd by main.js alongside initBrushPanel. On desktop the
// dock is hidden via CSS so none of this interferes with the desktop UI.
// updateBrushDock() is called from updateBrushUI() in brush-panel.js so that
// slider changes in the desktop panel stay in sync with the mobile dock.

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';

export function initBrushDock() {
  const dock = $('brushDock');
  if (!dock) return;

  // Wire both tracks with a shared drag handler
  $$('#brushDock .bd-track').forEach(track => bindTrack(track));

  // Initialize visuals to match current state
  updateBrushDock();
}

/**
 * Attach pointer handlers to a single dock track.
 * kind is derived from data-kind (size | opacity).
 */
function bindTrack(track) {
  const kind = track.dataset.kind;                     // 'size' or 'opacity'
  const fill  = track.querySelector('.bd-fill');
  const thumb = track.querySelector('.bd-thumb');
  let dragging = false;

  /**
   * Map a pointer Y coordinate onto [0..1] where 1 is the top of the track.
   * Then write into App.brush and update the visuals.
   */
  const updateFromY = (clientY) => {
    const rect = track.getBoundingClientRect();
    let v = 1 - (clientY - rect.top) / rect.height;
    v = Math.max(0, Math.min(1, v));
    if (kind === 'size') {
      // Exponential-ish mapping: low end gets fine-grained control of 1..20px,
      // upper end covers 20..200px more coarsely. Feels closer to Procreate.
      const size = Math.max(1, Math.round(1 + v * v * 199));
      App.brush.size = size;
    } else {
      App.brush.opacity = v;
    }
    // Also keep the desktop right-panel sliders in sync so switching
    // viewports shows the same value everywhere.
    syncDesktopSlider(kind);
    updateBrushDock();
  };

  // Pointer events: pointerdown snaps to tap position, move drags, up ends.
  track.addEventListener('pointerdown', e => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    track.classList.add('dragging');
    updateFromY(e.clientY);
  });
  track.addEventListener('pointermove', e => {
    if (dragging) updateFromY(e.clientY);
  });
  const end = (e) => {
    dragging = false;
    track.classList.remove('dragging');
    try { track.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
}

/**
 * Write current App.brush state into the dock visuals.
 * Exported so brush-panel.js can call this from updateBrushUI().
 */
export function updateBrushDock() {
  const dock = $('brushDock');
  if (!dock) return;

  // SIZE track: invert the exponential map used on drag, so desktop slider
  // changes (linear 1..200) still position the thumb at the right height.
  const size = App.brush.size;
  // v = sqrt((size - 1) / 199)  — inverse of v*v*199 + 1
  const sizeV = Math.sqrt(Math.max(0, (size - 1) / 199));
  setTrack('size', sizeV, size);

  // OPACITY track: plain 0..1
  setTrack('opacity', App.brush.opacity, Math.round(App.brush.opacity * 100));
}

function setTrack(kind, normalized, labelNumber) {
  const track = document.querySelector(`#brushDock .bd-track[data-kind="${kind}"]`);
  if (!track) return;
  const fill  = track.querySelector('.bd-fill');
  const thumb = track.querySelector('.bd-thumb');
  const pct = Math.round(normalized * 100);
  fill.style.height  = pct + '%';
  thumb.style.bottom = pct + '%';
  thumb.textContent  = labelNumber;
}

/**
 * When we change App.brush from the dock, mirror the change into the desktop
 * right-panel slider so if the user opens that panel the value matches.
 * Fires an 'input' event so any listeners (e.g. UI text labels) update too.
 */
function syncDesktopSlider(kind) {
  if (kind === 'size') {
    const s = $('brushSize');
    if (s) { s.value = App.brush.size; s.dispatchEvent(new Event('input', { bubbles: false })); }
  } else if (kind === 'opacity') {
    const s = $('brushOpacity');
    if (s) { s.value = Math.round(App.brush.opacity * 100); s.dispatchEvent(new Event('input', { bubbles: false })); }
  }
}
