// ============================================================================
//  src/ui/v3-shell.js
//
//  v4.0.0-rc.1 — v3 design preview shell.
//
//  Behind a feature flag — `?v3=1` query string OR `localStorage.kpzV3 === "1"`.
//  When the flag is on:
//    • <body> gets `data-v3="1"`
//    • v3-theme.css and Google Fonts (Caveat / Kalam) are injected lazily
//    • Mode toggle pill (Both / Canvas / Script) is inserted into #topbar
//    • Script view container is created and mounted
//
//  When the flag is OFF, this module is a no-op. The default v3.19.0 surface
//  continues to render exactly as before.
//
//  Why opt-in: the live indalkp.com/draw site reads its version pin from
//  Velo's KPZ_VERSION constant. While v4.0.0-rc.1 is on jsDelivr, the live
//  site stays on v3.19.0. Anyone wanting to preview the v3 chrome before
//  KPZ_VERSION is bumped adds `?v3=1` to the URL.
// ============================================================================

import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';

const V3_TAG = 'v4.0.0-rc.1';

/**
 * Detect whether v3 preview should activate this session.
 * Priority: explicit query param wins over stored preference, so users can
 * always force off with `?v3=0` even if they previously enabled it.
 */
function detectV3Flag() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('v3')) {
      const v = params.get('v3');
      try { localStorage.setItem('kpzV3', v === '1' ? '1' : '0'); } catch (_) {}
      return v === '1';
    }
  } catch (_) {}
  try { return localStorage.getItem('kpzV3') === '1'; } catch (_) { return false; }
}

/**
 * Inject the v3 theme stylesheet + Google Fonts. Idempotent.
 */
function injectV3Stylesheets(baseUrl) {
  if (document.getElementById('v3-theme-css')) return;

  // Google Fonts (Caveat + Kalam) — display=swap so they don't block paint
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Kalam:wght@300;400;700&display=swap';
  document.head.appendChild(fonts);

  // v3-theme.css — relative to baseUrl. baseUrl = .../src so v3-theme.css
  // sits in the same dir; resolve via `<base>/v3-theme.css`.
  const theme = document.createElement('link');
  theme.id   = 'v3-theme-css';
  theme.rel  = 'stylesheet';
  theme.href = (baseUrl ? baseUrl.replace(/\/$/, '') : '.') + '/v3-theme.css';
  document.head.appendChild(theme);
}

/**
 * Insert the mode-toggle pill into the topbar. Idempotent.
 */
function ensureModeToggle(setMode, getMode) {
  if ($('v3ModeToggle')) return;
  const topbar = $('topbar');
  if (!topbar) return;

  const wrapper = document.createElement('span');
  wrapper.id = 'v3ModeToggle';
  wrapper.className = 'v3-mode-toggle';
  wrapper.title = 'v3 mode toggle — Both shows canvas + script preview, Script hides canvas for distraction-free writing';

  const modes = [
    { id: 'both',   label: '📖 Both' },
    { id: 'canvas', label: '🎬 Canvas' },
    { id: 'script', label: '📜 Script' },
  ];

  modes.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.mode = m.id;
    b.textContent = m.label;
    b.addEventListener('click', () => setMode(m.id));
    wrapper.appendChild(b);
  });

  // Insert before the right-side spacer so it sits between brush/play groups
  // and the auth area. The exact position is forgiving.
  const spacer = topbar.querySelector('div[style*="flex:1"]');
  if (spacer && spacer.parentNode === topbar) {
    topbar.insertBefore(wrapper, spacer);
  } else {
    topbar.appendChild(wrapper);
  }

  syncModeToggleActive(getMode());
}

function syncModeToggleActive(mode) {
  const toggle = $('v3ModeToggle');
  if (!toggle) return;
  toggle.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

/**
 * Ensure the script container exists in the DOM. Hidden by default; the
 * theme CSS shows it when body[data-v3-mode="script"].
 */
function ensureScriptContainer() {
  if ($('scriptView')) return;
  const app = $('app');
  if (!app) return;
  const div = document.createElement('div');
  div.id = 'scriptView';
  div.innerHTML = `
    <div class="v3-script-header">
      <h2 id="scriptViewTitle">Script</h2>
      <div class="v3-script-actions">
        <button class="v3-btn" id="scriptBackBtn" title="Back to canvas + script (Both mode)">↩ Back to canvas</button>
      </div>
    </div>
    <div id="scriptViewBody"><div class="v3-beat-empty">Loading script…</div></div>
  `;
  app.appendChild(div);
  $('scriptBackBtn')?.addEventListener('click', () => setMode('both'));
}

// ---- Mode state ------------------------------------------------------------

let _renderScript = null;

function getMode() {
  return App.v3Mode || 'both';
}

function setMode(mode) {
  if (!['both', 'canvas', 'script'].includes(mode)) mode = 'both';
  App.v3Mode = mode;
  document.body.setAttribute('data-v3-mode', mode);
  syncModeToggleActive(mode);
  try { localStorage.setItem('kpzV3Mode', mode); } catch (_) {}
  if (mode === 'script' && _renderScript) _renderScript();
}

/**
 * Initialize v3 shell. Returns true if v3 mode activated, false if no-op.
 */
export function initV3Shell(opts = {}) {
  const active = detectV3Flag();
  if (!active) return false;

  injectV3Stylesheets(opts.baseUrl);
  document.body.setAttribute('data-v3', '1');

  let initialMode = 'both';
  try {
    const stored = localStorage.getItem('kpzV3Mode');
    if (['both', 'canvas', 'script'].includes(stored)) initialMode = stored;
  } catch (_) {}
  App.v3Mode = initialMode;

  ensureScriptContainer();
  ensureModeToggle(setMode, getMode);
  setMode(initialMode);

  // Lazy-import the script-view renderer
  import('./script-view.js').then(m => {
    _renderScript = () => m.renderScriptView();
    if (App.v3Mode === 'script') _renderScript();
  }).catch(err => { console.warn('[v3] failed to load script-view.js', err); });

  // Lazy-import the v3 modals (project gallery + settings)
  import('./v3-modals.js').then(m => { m.initV3Modals(); })
    .catch(err => { console.warn('[v3] failed to load v3-modals.js', err); });

  // Lazy-import the v3 mobile dock — no-op above 1100px (CSS hides it)
  import('./v3-mobile-dock.js').then(m => { m.initV3MobileDock(); })
    .catch(err => { console.warn('[v3] failed to load v3-mobile-dock.js', err); });

  console.log('[v3] preview active —', V3_TAG);
  return true;
}

export { setMode, getMode };
