// ============================================================================
//  core/state.js
//
//  Single mutable App object shared across all modules.
//  Matches the structure of the global `App` in the v3.5 monolith so that
//  function bodies can be moved into modules with near-zero rewriting.
// ============================================================================

export const App = {
  // Project data
  project: null,              // { name, width, height, panels: [], refs: [] }
  activePanelIdx: 0,

  // Tool state
  tool: 'brush',              // 'brush' | 'eraser' | 'eyedropper' | 'hand'
  brush: {
    size: 8,
    opacity: 1,
    hardness: 0.8,
    smoothing: 0.4,
    presSize: 1,              // how much pressure affects size
    presOp: 0,                // how much pressure affects opacity
    color: '#000000',
  },

  // View transform
  view: { scale: 1, x: 0, y: 0 },

  // Stroke state machine
  isDrawing: false,
  isPanning: false,
  spacePan: false,            // space held for temporary pan mode
  lastPoint: null,
  smoothPoint: null,
  strokeStart: null,          // v3.5: start position for tap-to-dot
  strokeHasMoved: false,      // v3.5: did pointer actually move during stroke
  panStart: null,

  // History per-panel
  history: [],                // array of arrays of snapshot entries
  historyIdx: [],

  // Persistence state
  dirty: false,               // unsaved changes flag
  autosaveTimer: null,

  // Wix auth state
  isLoggedIn: false,
  memberId: null,
  memberSlug: null,
  memberName: null,

  // Reference viewer state
  refViewerIdx: 0,
  refView: { scale: 1, x: 0, y: 0 },
  refPickingMode: false,      // v3.5: color sampler mode
  refSampleCanvas: null,      // v3.5: offscreen canvas for pixel sampling
};

// Convenience accessors
export function curPanel() {
  return App.project?.panels[App.activePanelIdx];
}
export function curLayer() {
  const p = curPanel();
  return p?.layers[p.activeLayer];
}

// Debugging: expose in window for console inspection in development
if (typeof window !== 'undefined') {
  window.__KPZ_APP = App;
}
