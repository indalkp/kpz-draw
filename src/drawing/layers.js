// src/drawing/layers.js
// Layer creation and management helpers.

/**
 * Create a new blank layer canvas with the given dimensions.
 */
export function createLayer(w, h, name) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return {
    id: 'L' + Math.random().toString(36).slice(2, 9),
    name: name || 'Layer',
    canvas: c,
    visible: true,
    opacity: 1,
    blend: 'source-over',
    locked: false,
  };
}
