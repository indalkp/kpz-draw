// src/ui/mobile-chrome.js
//
// v3.8.0: All mobile-only chrome wiring.
//   - Mobile top bar: undo/redo/gallery/refs/tool/color/layers buttons
//   - Tool popover: floating card showing brush/eraser/picker/hand
//   - Color modal: full-screen color picker with swatches
//   - "Gallery" button: opens the more-menu (new/open/save/panel/fit/fullscreen)
//
// These elements are always in the DOM but CSS hides them above 1100px so
// desktop users never see them. All controls drive the same App state and
// reuse the same functions as the desktop UI — no duplicated logic.
//
// v3.9.4: bottom dock — 5-button thumb-reach navigation aligned to the V3a
// wireframe (Draw / Script / Refs / Project / More). Reuses the existing
// drawer toggles and modals where applicable so there's a single source
// of truth. The redundant mtbRefs / mtbLayers / mtbGallery topbar buttons
// are hidden via CSS but their handlers stay wired (defensive) until v3.9.5
// removes them from the DOM after a stable production release.

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';
import { undo, redo } from '../drawing/history.js';
import { fitView } from '../drawing/view.js';
import { setTool } from './toolrail.js';
import { addPanel, deletePanel } from './panel-nav.js';
import { updateBrushUI, setBrushColor } from './brush-panel.js';
import { confirmLeaveIfDirty } from './confirm-leave.js';

const SWATCH_COLORS = [
  '#000000', '#1a1a1a', '#4a4a4a', '#888888', '#cccccc', '#ffffff', '#ff7a45', '#ffb088',
  '#e55353', '#f5a623', '#f8e71c', '#7ed321', '#50e3c2', '#4a90e2', '#9013fe', '#bd10e0',
];

export function initMobileChrome() {
  wireMobileTopbar();
  wireToolPopover();
  wireColorModal();
  wireMoreMenu();
  wireMobileDock();             // v3.9.4
  // Close all popovers when tapping outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#mobileToolPopover') && !e.target.closest('#mtbTool')) {
      $('mobileToolPopover')?.classList.remove('open');
    }
    if (!e.target.closest('#mobileMoreMenu') && !e.target.closest('#mtbGallery') && !e.target.closest('[data-md="more"]')) {
      $('mobileMoreMenu')?.classList.remove('open');
    }
  });
}

// ---- v3.9.4: Mobile bottom dock --------------------------------------------
//
// The dock is the primary mobile navigation surface. Each button maps to a
// well-defined action; "Draw" represents the canvas and is the default-active
// state. The dock keeps the active button highlighted so users always know
// which mode they're in. State is local to this module — driving #mobileDock
// classes and reusing existing handlers for actual side effects.
function wireMobileDock() {
  const dock = $('mobileDock');
  if (!dock) return;

  $$('#mobileDock .md-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const target = btn.dataset.md;
      // Update active state — every dock action settles on a specific
      // visual mode. For modal-style actions (Project, More) we still
      // light up the button briefly to confirm the tap.
      handleMobileDockAction(target, btn, e);
    });
  });
}

function setActiveDockButton(targetId) {
  $$('#mobileDock .md-btn').forEach(b => b.classList.toggle('active', b.dataset.md === targetId));
}

function handleMobileDockAction(target, btn, e) {
  switch (target) {
    case 'draw':
      // Close any open drawers / popovers; canvas takes center stage.
      $('leftPanel')?.classList.remove('open');
      $('rightPanel')?.classList.remove('open');
      $('panelBackdrop')?.classList.remove('show');
      $('mobileMoreMenu')?.classList.remove('open');
      setActiveDockButton('draw');
      break;

    case 'layers':
      // v3.9.5: toggle the layers panel via the dock. Same handler as the
      // hidden mtbLayers button — opens the right drawer and activates
      // the Layers tab so the user lands on the right thing.
      {
        const open = $('rightPanel')?.classList.toggle('open');
        $('leftPanel')?.classList.remove('open');
        $('panelBackdrop')?.classList.toggle('show', !!open);
        const layersTab = document.querySelector('.tab-btn[data-tab="layers"]');
        layersTab?.click();
        setActiveDockButton(open ? 'layers' : 'draw');
      }
      break;

    case 'refs':
      // Toggle the references drawer (same as the now-hidden mtbRefs).
      // Cast & Refs panel lives in #leftPanel; v3.9.0 added the Cast tab.
      {
        const open = $('leftPanel')?.classList.toggle('open');
        $('rightPanel')?.classList.remove('open');
        $('panelBackdrop')?.classList.toggle('show', !!open);
        setActiveDockButton(open ? 'refs' : 'draw');
      }
      break;

    case 'project':
      // Open the existing Save/Export modal (covers .kpz / Wix / PSD / PNG).
      $('saveModal')?.classList.add('open');
      // Don't permanently activate — modals close back to Draw.
      flashDockButton(btn);
      break;

    case 'more':
      // Reuse the existing #mobileMoreMenu popover (gallery button).
      // Position above the dock instead of below the chip — anchor is the
      // dock button at the bottom of the viewport.
      e.stopPropagation();
      positionPopoverAbove($('mobileMoreMenu'), btn);
      $('mobileMoreMenu')?.classList.toggle('open');
      $('mobileToolPopover')?.classList.remove('open');
      flashDockButton(btn);
      break;
  }
}

/**
 * Briefly highlight a dock button to confirm a modal-style action. Returns
 * to the previously-active button after a short delay so users get visual
 * feedback without permanently changing dock state for one-shot actions.
 */
function flashDockButton(btn) {
  const prev = document.querySelector('#mobileDock .md-btn.active');
  setActiveDockButton(btn.dataset.md);
  setTimeout(() => {
    if (prev) prev.classList.add('active');
    btn.classList.remove('active');
  }, 220);
}

/**
 * Position a popover ABOVE its anchor (used for dock buttons that sit at the
 * bottom of the viewport). Mirrors positionPopover() but flips vertically.
 */
function positionPopoverAbove(popover, anchor) {
  if (!popover || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  // Account for the popover's own height — measured after it renders, so
  // make the popover briefly visible-but-hidden to grab dimensions, or rely
  // on a CSS bottom-anchored position. Simpler: anchor by bottom: viewport-rect.top.
  popover.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
  popover.style.top = 'auto';
  // Center over the dock button, clamped to viewport
  const popW = 200; // approximate; mtp-item-row width
  let left = rect.left + (rect.width / 2) - (popW / 2);
  left = Math.max(8, Math.min(window.innerWidth - popW - 8, left));
  popover.style.left = left + 'px';
  popover.style.right = 'auto';
}

// ---- Mobile top bar --------------------------------------------------------
function wireMobileTopbar() {
  // Undo / redo — reuse desktop handlers
  $('mtbUndo')?.addEventListener('click', undo);
  $('mtbRedo')?.addEventListener('click', redo);

  // References — toggle left drawer (same state as desktop #toggleLeft)
  $('mtbRefs')?.addEventListener('click', () => {
    $('leftPanel')?.classList.toggle('open');
    $('rightPanel')?.classList.remove('open');
    $('panelBackdrop')?.classList.toggle('show', $('leftPanel')?.classList.contains('open'));
  });

  // Layers — toggle right drawer
  $('mtbLayers')?.addEventListener('click', () => {
    $('rightPanel')?.classList.toggle('open');
    $('leftPanel')?.classList.remove('open');
    $('panelBackdrop')?.classList.toggle('show', $('rightPanel')?.classList.contains('open'));
    // Ensure the Layers tab is active when opened from this button
    const layersTab = document.querySelector('.tab-btn[data-tab="layers"]');
    layersTab?.click();
  });

  // Tool — toggle popover
  $('mtbTool')?.addEventListener('click', (e) => {
    e.stopPropagation();
    positionPopover($('mobileToolPopover'), e.currentTarget);
    $('mobileToolPopover')?.classList.toggle('open');
    $('mobileMoreMenu')?.classList.remove('open');
  });

  // Color — open color modal
  $('mtbColor')?.addEventListener('click', () => {
    const mPicker = $('mColorPicker');
    const mHex = $('mColorHex');
    if (mPicker) mPicker.value = App.brush.color;
    if (mHex)    mHex.textContent = App.brush.color.toUpperCase();
    $('mobileColorModal')?.classList.add('open');
  });

  // Gallery / menu button — opens the more-menu popover
  $('mtbGallery')?.addEventListener('click', (e) => {
    e.stopPropagation();
    positionPopover($('mobileMoreMenu'), e.currentTarget, 'left');
    $('mobileMoreMenu')?.classList.toggle('open');
    $('mobileToolPopover')?.classList.remove('open');
  });
}

// ---- Tool popover ----------------------------------------------------------
function wireToolPopover() {
  $$('#mobileToolPopover .mtp-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      setTool(tool);
      $$('#mobileToolPopover .mtp-item').forEach(b => b.classList.toggle('active', b === btn));
      // Also mirror on the top bar tool button colour so it reflects the current tool
      updateMobileToolIcon(tool);
      $('mobileToolPopover')?.classList.remove('open');
    });
  });
}

/**
 * Flip the small icon inside #mtbTool to reflect the current tool. Keeps the
 * top bar honest about what's active without needing a text label.
 */
export function updateMobileToolIcon(tool) {
  const btn = $('mtbTool');
  if (!btn) return;
  const icons = {
    brush:      '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-6-6"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2" fill="currentColor"/>',
    eraser:     '<path d="M3 17l7-7 4 4 7-7"/><path d="M17 7l4 4"/>',
    eyedropper: '<path d="M17 3l4 4-11 11H6v-4l11-11z"/><path d="M2 22l4-4"/>',
    hand:       '<path d="M18 11V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v6M10 10.5V6a2 2 0 00-4 0v8l1.5 3"/>',
  };
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[tool] || icons.brush}</svg>`;
}

// ---- Color modal -----------------------------------------------------------
function wireColorModal() {
  // Populate swatches (reuses the same palette as the desktop right panel)
  const sw = $('mColorSwatches');
  if (sw) {
    sw.innerHTML = '';
    SWATCH_COLORS.forEach(c => {
      const el = document.createElement('div');
      el.className = 'swatch';
      el.style.background = c;
      el.addEventListener('click', () => applyColor(c));
      sw.appendChild(el);
    });
  }

  // Live picker
  $('mColorPicker')?.addEventListener('input', e => applyColor(e.target.value));

  // Done button + backdrop dismiss
  $('mColorDone')?.addEventListener('click', () => $('mobileColorModal')?.classList.remove('open'));
  $('mobileColorModal')?.addEventListener('click', e => {
    if (e.target.id === 'mobileColorModal') $('mobileColorModal').classList.remove('open');
  });
}

function applyColor(hex) {
  // v3.8.3 (M3): single source of truth for colour changes. setBrushColor
  // updates App.brush.color, #colorPicker.value, #mtbColor.style.background
  // and #mColorHex.textContent in one place.
  setBrushColor(hex);
}

// ---- "More" menu (gallery button) ------------------------------------------
function wireMoreMenu() {
  $$('#mobileMoreMenu .mtp-item-row').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      $('mobileMoreMenu')?.classList.remove('open');

      switch (action) {
        case 'new':
          if (!(await confirmLeaveIfDirty({ context: 'new project' }))) return;
          $('newModal')?.classList.add('open');
          break;
        case 'open':
          if (!(await confirmLeaveIfDirty({ context: 'opening another file' }))) return;
          $('fileInput')?.click();
          break;
        case 'save':
          $('saveModal')?.classList.add('open');
          break;
        case 'addPanel':
          addPanel();
          break;
        case 'delPanel':
          deletePanel();
          break;
        case 'fit':
          fitView();
          break;
        case 'fullscreen':
          document.body.classList.toggle('fullscreen');
          break;
        case 'help':
          $('helpOverlay')?.classList.add('open');
          break;
        // v3.8.2: mobile auth rows — mirror the desktop #authBox / #profileMenu
        // behavior. When in Wix, postMessage to the parent; when standalone,
        // fall back to a helpful toast.
        case 'auth-login':
          if (App.inWix) window.parent.postMessage({ type: 'request-login' }, '*');
          else import('./toast.js').then(m => m.toast('Log in via the Wix site header', 'error'));
          break;
        case 'auth-dashboard':
          if (!(await confirmLeaveIfDirty({ context: 'dashboard' }))) return;
          if (App.inWix) window.parent.postMessage({ type: 'nav-dashboard' }, '*');
          break;
        case 'auth-mywork':
          // Open right drawer + activate Projects tab (no navigation, safe without dirty-check)
          document.querySelector('.tab-btn[data-tab="projects"]')?.click();
          $('rightPanel')?.classList.add('open');
          $('leftPanel')?.classList.remove('open');
          $('panelBackdrop')?.classList.add('show');
          break;
        case 'auth-logout':
          if (!(await confirmLeaveIfDirty({ context: 'logout' }))) return;
          if (App.inWix) window.parent.postMessage({ type: 'request-logout' }, '*');
          break;
      }
    });
  });
}

// ---- Popover positioning ---------------------------------------------------
/**
 * Position a popover below an anchor button, clamped to the viewport.
 * side: 'right' (default) aligns popover's right edge to anchor's right,
 *       'left' aligns popover's left edge to anchor's left.
 */
function positionPopover(popover, anchor, side = 'right') {
  if (!popover || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  popover.style.top = (rect.bottom + 6) + 'px';
  if (side === 'left') {
    popover.style.left = rect.left + 'px';
    popover.style.right = 'auto';
  } else {
    popover.style.right = (window.innerWidth - rect.right) + 'px';
    popover.style.left = 'auto';
  }
}

/**
 * Keep the mobile top bar's project name + layer count in sync. Called from
 * other modules when project / layer state changes.
 */
export function updateMobileTopbar() {
  const nameEl = $('mtbProjectName');
  if (nameEl && App.project) nameEl.textContent = App.project.name || 'Untitled';

  const layersBtn = $('mtbLayers');
  if (layersBtn && App.project) {
    const count = App.project.panels?.[App.activePanelIdx]?.layers?.length || 0;
    layersBtn.setAttribute('data-count', String(count));
  }
}

/**
 * v3.8.2: Show/hide the 4 auth rows in #mobileMoreMenu based on login state.
 * Called from topbar.js updateAuthUI() so desktop + mobile stay in sync.
 * When logged-in, the Dashboard row gets the member nickname for clarity.
 *
 * v3.8.3 (H1): on logout, explicitly reset the dashboard row's textContent
 * to a neutral default. Otherwise the previous user's personalised label
 * ("📊 Alex's Dashboard") stayed in the DOM, hidden by display:none, and
 * flashed visible for one frame when the NEXT user logged in before their
 * own nickname finished loading from the Wix auth round-trip.
 */
export function updateMobileAuthMenu() {
  const loggedIn = !!App.isLoggedIn;
  const loginRow = $('mtbAuthLogin');
  const dashRow  = $('mtbAuthDashboard');
  const workRow  = $('mtbAuthMyWork');
  const outRow   = $('mtbAuthLogout');
  if (loginRow) loginRow.style.display = loggedIn ? 'none' : '';
  if (dashRow)  dashRow.style.display  = loggedIn ? '' : 'none';
  if (workRow)  workRow.style.display  = loggedIn ? '' : 'none';
  if (outRow)   outRow.style.display   = loggedIn ? '' : 'none';
  if (dashRow) {
    if (loggedIn && App.member?.nickname) {
      dashRow.textContent = `📊 ${App.member.nickname}'s Dashboard`;
    } else {
      // v3.8.3: neutral default — no ex-user nickname sticking around
      dashRow.textContent = '📊 Dashboard';
    }
  }
}
