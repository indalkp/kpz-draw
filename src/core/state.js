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
    // v3.16.0 Phase 7a: stabilization (0..1). Procreate-style "Streamline".
    // Higher values make the rendered stroke lag the cursor with exponential
    // smoothing, producing intentional, shake-free inking lines. 0 = off.
    stabilization: 0,
    // v3.18.0 Phase 9: pressure-response curve. 0..1, default 0.5 = linear
    // response. Mapped to a power exponent at moveStroke time:
    //   exponent = 16^curve / 4
    //   curve=0   → exponent=0.25 (very soft: light press feels heavy)
    //   curve=0.5 → exponent=1.0  (linear, current default behaviour)
    //   curve=1   → exponent=4.0  (very firm: need more force for full size)
    // Magma's pressure-curve feature (Aug 2025 release) does the same thing.
    pressureCurve: 0.5,
  },

  // v3.16.0 Phase 7a: lazy-mouse position used to apply stabilization lag.
  // Initialized fresh at every startStroke; cleared at endStroke.
  lazyPos: null,

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

  // v3.9.10: animatic playback. When `playing` is true, an interval (managed
  // in topbar.js) auto-advances activePanelIdx at `playFps` panels per
  // second. Drawing on the canvas (canvas.js startStroke) flips this back
  // to false to avoid fighting the user. Not serialized — transient view
  // state for storyboard timing review.
  playing: false,
  playFps: 2,

  // v3.10.0: view mode. 'single' (default, classic single-panel-at-a-time
  // editor) or 'strip' (vertical-scroll comic-strip layout — all panels
  // visible stacked, click any panel to make it the active editable one).
  // Toggled by the #btnStripMode toolbar button. UI-only state, not
  // serialized into .kpz.
  viewMode: 'single',
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
