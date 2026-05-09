// ============================================================================
//  src/v3-mode-toggle.js
//  KPZ Draw — v3.26.0 Essential mode toggle (Both / Canvas / Script)
//
//  Pure UI layer. Toggles `body[data-mode="..."]` between three values:
//    - "both"   → canvas + script panel side-by-side (default for v3)
//    - "canvas" → canvas fills, script hidden
//    - "script" → script fills, canvas hidden  (placeholder until v3.27.0)
//
//  CSS in src/v3-theme.css (sections 15–17) reacts to the data-mode attribute
//  by adjusting #main's grid-template-columns. No engine changes — the brush
//  / canvas / panel pipeline is untouched.
//
//  Runs only when body[data-v3="1"] is set by the bootstrap (i.e. when ?v3=1
//  is on the URL). main.js gates the import on the same flag so the default
//  surface never pays the parse cost.
//
//  State persistence: localStorage["kpz_v3_mode"] — survives page reloads,
//  scoped per origin so the indalkp.com surface and a local preview keep
//  separate prefs.
// ============================================================================

const STORAGE_KEY = 'kpz_v3_mode';
const VALID = ['both', 'canvas', 'script'];

export function initV3ModeToggle() {
  // Bail unless v3 surface is active. Defensive — main.js already checks.
  if (document.body.getAttribute('data-v3') !== '1') return;

  const pill = document.getElementById('v3ModeToggle');
  if (!pill) return;

  // 1. Resolve initial mode: persisted → "both" default.
  let initial = 'both';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && VALID.includes(saved)) initial = saved;
  } catch (_) { /* private mode / disabled storage */ }
  setMode(initial, /* persist */ false);

  // 2. Wire click handlers on each segment.
  pill.querySelectorAll('.v3-mode-seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-mode');
      if (!VALID.includes(next)) return;
      setMode(next, /* persist */ true);
    });
  });
}

function setMode(mode, persist) {
  document.body.setAttribute('data-mode', mode);

  // Update aria-selected on each segment so screen readers reflect state.
  const pill = document.getElementById('v3ModeToggle');
  if (pill) {
    pill.querySelectorAll('.v3-mode-seg').forEach((btn) => {
      const selected = btn.getAttribute('data-mode') === mode;
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) { /* ignore */ }
  }

  // Notify the rest of the app that the canvas viewport may have changed.
  // The drawing layer's ResizeObserver on #canvasArea picks up the actual
  // size change; this dispatch is a hint for any future listener that
  // wants to react synchronously.
  document.dispatchEvent(new CustomEvent('kpz:v3-mode-changed', { detail: { mode } }));
}
