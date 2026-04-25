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
  lastPoint: null,            // most recent smoothed sample during active stroke
  strokeStart: null,          // v3.5: start position for tap-to-dot
  strokeHasMoved: false,      // v3.5: did pointer actually move during stroke
  panStart: null,
  // v3.7.0 additions (quadratic Bezier sampling in canvas.js)
  prevPoint: null,            // sample before lastPoint — 2nd point of quad control
  lastMid: null,              // midpoint(prev, last) — start of next quad segment
  activePointerType: null,    // 'pen' | 'touch' | 'mouse' — used for pen priority
  // v3.8.3 (M4): removed unused `smoothPoint` (was v3.5 exponential lerp state;
  // replaced by the One-Euro filter instance held inside canvas.js).

  // Stroke counter (v3.6.0) — per-project, reset on new/load
  strokeCount: 0,

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

  // Wix integration
  inWix: false,               // detected at runtime by wix-bridge
  member: null,               // { _id, nickname, avatar, slug } when logged in
  saving: false,              // true while a cloud save is in progress
  currentProjectId: null,     // ID of currently-loaded cloud project

  // v3.6.2: stale-write detection (two-tab protection)
  // Stores project._updatedDate from when we loaded the project.
  // On save, backend compares this to the CMS record's current _updatedDate.
  // If different, another session modified the project after we loaded —
  // backend returns a stale error so we can show a "reload/overwrite" modal.
  projectLoadedAt: null,

  // v3.9.7 / v3.9.8: onion skin mode. Three states cycled by the topbar
  // button (and keyboard shortcut 'O'):
  //   'off'   — no onion (default)
  //   'past'  — previous panel rendered as a ghost behind the current
  //   'both'  — previous AND next panels rendered as ghosts
  // UI-only — not serialized into .kpz so each session starts clean.
  onionMode: 'off',
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
