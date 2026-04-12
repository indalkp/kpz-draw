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
    created: Date.now(),
    version: 3,
  };
}

/**
 * Create a new panel with a white background layer and a blank drawing layer.
 */
export function createPanel(w, h) {
  const bg = createLayer(w, h, 'Background');
  bg.canvas.getContext('2d').fillStyle = '#ffffff';
  bg.canvas.getContext('2d').fillRect(0, 0, w, h);
  const layer = createLayer(w, h, 'Layer 1');
  return { layers: [bg, layer], activeLayer: 1 };
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
