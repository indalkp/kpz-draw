/**
 * A single stroke — input points + the brush settings captured at
 * stroke start.
 *
 * The brush snapshot is taken at stroke start so subsequent UI changes
 * (size slider, color change, opacity adjustment) do not retroactively
 * mutate strokes already drawn. This matches the "stroke is committed
 * art at endStroke" model used by every pro app.
 *
 * panelIdx and layerIdx remember which surface this stroke targets, so
 * future re-rasterization (Phase 3) knows where to write.
 */
export class Stroke {
  constructor(brush, panelIdx, layerIdx) {
    /** Real samples, in chronological order. Source of truth. */
    this.points = [];
    /** Latest predicted-future samples. Replaced each frame; never
     *  accumulated. Used by Phase 2's speculative overlay. */
    this.predicted = [];
    /** Brush settings at stroke start (snapshot, never mutated). */
    this.brush = brush;
    /** Which panel + layer this stroke targets. */
    this.panelIdx = panelIdx;
    this.layerIdx = layerIdx;
  }

  add(point)            { this.points.push(point); }
  setPredicted(arr)     { this.predicted = arr; }
  get sampleCount()     { return this.points.length; }
  get firstPoint()      { return this.points[0] || null; }
  get lastPoint()       { return this.points[this.points.length - 1] || null; }
  get durationMs() {
    if (this.points.length < 2) return 0;
    return this.points[this.points.length - 1].time - this.points[0].time;
  }
}
</content>
<parameter name="mode">append