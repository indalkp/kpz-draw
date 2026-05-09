// ============================================================================
//  src/drawing/brush-presets.js
//
//  v4.0.0-rc.2 — brush preset registry.
//
//  Each preset bundles a set of behavioural flags and parameter overrides.
//  The drawing engine (canvas.js) reads the active preset's flags to gate
//  optional pipeline stages introduced after v3.17.0:
//
//    - flags.pressureCurveRemap   (v3.18.0 — pow remap in moveStroke)
//    - flags.liftOffClamp         (v3.18.1 — Apple Pencil tail-pressure clamp)
//    - flags.dprStrokeBuffer      (v3.19.0 — project*DPR stroke buffer w/
//                                  bilinear downsample at flushStrokeBuffer.
//                                  Re-categorised at rc.3 from "fidelity-only"
//                                  to "engine-affecting": the low-quality
//                                  downsample produces visible artefacts on
//                                  every input device, including mouse, and
//                                  IS what the user calls the "grass" effect.)
//
//  Default preset: "default" — reproduces v3.17.0 movement behaviour.
//  Optional preset: "grass"   — reproduces v3.19.0 movement behaviour
//                              (renamed Grass Brush per user request).
// ============================================================================

import { App } from '../core/state.js';

export const BRUSH_PRESETS = Object.freeze({
  default: Object.freeze({
    id:          'default',
    name:        'Default (v3.17)',
    description: 'Raw stylus pressure, no lift-off clamp — the v3.17 stroke feel.',
    flags: Object.freeze({
      pressureCurveRemap: false,    // skip the v3.18.0 pow remap in moveStroke
      liftOffClamp:       false,    // skip the v3.18.1 tail-pressure clamp
      dprStrokeBuffer:    false,    // v4.0.0-rc.3: skip the v3.19.0 project*DPR
                                    // stroke buffer. The DPR buffer + low-quality
                                    // bilinear downsample at flushStrokeBuffer is
                                    // the actual cause of the v3.19 "grass" effect
                                    // — visible on every input device including
                                    // mouse, not just stylus pressure paths.
                                    // Default preset uses a project-res buffer
                                    // like v3.17, no downsample step.
    }),
    overrides: Object.freeze({
      pressureCurve: 0.5,           // forced linear (no-op) when remap is off
    }),
  }),
  grass: Object.freeze({
    id:          'grass',
    name:        'Grass Brush (v3.19)',
    description: 'v3.19 stroke pipeline: pressure-curve remap on, Apple Pencil lift-off clamp on.',
    flags: Object.freeze({
      pressureCurveRemap: true,
      liftOffClamp:       true,
      dprStrokeBuffer:    true,     // v4.0.0-rc.3: preserve the v3.19 grass
                                    // effect as the bug-as-feature for this preset.
    }),
    overrides: Object.freeze({
      pressureCurve: 0.5,           // linear by default; user can adjust slider
    }),
  }),
});

export const DEFAULT_PRESET_ID = 'default';

/**
 * Return the active preset object. Falls back to default if App.brush.preset
 * references an unknown id (e.g. an old project saved with a removed preset).
 */
export function getActivePreset() {
  const id = (App.brush && App.brush.preset) || DEFAULT_PRESET_ID;
  return BRUSH_PRESETS[id] || BRUSH_PRESETS[DEFAULT_PRESET_ID];
}

/**
 * Switch the active preset. Applies the preset's `overrides` to App.brush
 * but does NOT clobber user-edited values — overrides are intended to
 * reset the curve slider to a neutral position when entering default mode
 * so users don't end up with a stale-curve no-op surprise.
 *
 * Returns the new active preset object.
 */
export function setActivePreset(presetId) {
  const preset = BRUSH_PRESETS[presetId] || BRUSH_PRESETS[DEFAULT_PRESET_ID];
  if (!App.brush) App.brush = {};
  App.brush.preset = preset.id;
  // Apply overrides — these are deliberately small (just pressureCurve right
  // now) so users don't lose unrelated settings (size, opacity, hardness,
  // smoothing, stabilization, presSize, presOp, color).
  for (const [k, v] of Object.entries(preset.overrides || {})) {
    App.brush[k] = v;
  }
  // Persist for next session
  try { localStorage.setItem('kpzBrushPreset', preset.id); } catch (_) {}
  return preset;
}

/**
 * Read the persisted preset id (if any). Used by main.js at boot to
 * restore the user's last selection.
 */
export function loadPersistedPresetId() {
  try {
    const id = localStorage.getItem('kpzBrushPreset');
    if (id && BRUSH_PRESETS[id]) return id;
  } catch (_) {}
  return DEFAULT_PRESET_ID;
}

/**
 * Initial application — call once at boot, after App is constructed but
 * before drawing engine init. Idempotent.
 */
export function applyInitialPreset() {
  const id = loadPersistedPresetId();
  setActivePreset(id);
}

/**
 * List presets for UI rendering. Returns an array in registration order.
 */
export function listPresets() {
  return Object.values(BRUSH_PRESETS);
}
