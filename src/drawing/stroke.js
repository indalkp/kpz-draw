// src/drawing/stroke.js
//
// v3.13.0 Phase 1 — stroke data model.
// Strokes are stored as ordered arrays of typed input samples
// instead of just stamps in a pixel buffer. Phase 2 will use
// predicted samples for speculative rendering. Phase 3 will use
// the points array for re-render-from-data recovery.

export class InputPoint {
  constructor(x, y, pressure, time, predicted = false) {
    this.x = x;
    this.y = y;
    this.pressure = pressure;
    this.time = time;
    this.predicted = predicted;
  }
}

export class Stroke {
  constructor(brush, panelIdx, layerIdx) {
    this.points = [];
    this.predicted = [];
    this.brush = brush;
    this.panelIdx = panelIdx;
    this.layerIdx = layerIdx;
  }
  add(point)        { this.points.push(point); }
  setPredicted(arr) { this.predicted = arr; }
  get sampleCount() { return this.points.length; }
  get firstPoint()  { return this.points[0] || null; }
  get lastPoint()   { return this.points[this.points.length - 1] || null; }
}
