// src/drawing/panels.js
// Storyboard panel creation and active panel/layer accessors.

import { App } from '../core/state.js';
import { createLayer } from './layers.js';

/**
 * Create a new project object.
 */
export function createProject(name, w, h) {
  return {
    name: name || 'Untitled',
    width: w, height: h,
    panels: [createPanel(w, h)],
    refs: [],
    // v3.9.0: characters live alongside refs. Each character groups a set of
    // refIds (lookups into project.refs) plus its own palette + profile.
    // Persisted to IndexedDB only — NOT included in serializeKpz() to keep
    // the .kpz format and Wix CMS payload unchanged in v3.9.0. Cloud sync
    // for characters lands in a later release.
    characters: [],
    created: Date.now(),
    version: 3,
  };
}

/**
 * Create a new panel with a white background layer and a blank drawing layer.
 *
 * v3.9.11: panels now carry an optional `caption` string — used as a
 * subtitle / line of dialogue that shows in the strip below the canvas
 * and cycles automatically during animatic playback. Defaults to empty
 * so existing UI / save-load paths see no behavior change for panels
 * that don't have a caption set.
 */
export function createPanel(w, h) {
  const bg = createLayer(w, h, 'Background');
  bg.canvas.getContext('2d').fillStyle = '#ffffff';
  bg.canvas.getContext('2d').fillRect(0, 0, w, h);
  const layer = createLayer(w, h, 'Layer 1');
  // v3.9.11: caption.
  // v3.9.17: audioId reference into IDB (audio bytes don't live in the panel).
  // v3.9.19: audioDuration cached at attach time so the playback scheduler
  //          can hold this panel for the audio's full length without an
  //          async re-decode every frame. Defaults to 0 (= "use FPS timing").
  return { layers: [bg, layer], activeLayer: 1, caption: '', audioId: null, audioDuration: 0 };
}

/** Returns the currently active panel. */
export function curPanel() {
  return App.project.panels[App.activePanelIdx];
}

/** Returns the currently active layer within the active panel. */
export function curLayer() {
  const p = curPanel();
  return p.layers[p.activeLayer];
}
