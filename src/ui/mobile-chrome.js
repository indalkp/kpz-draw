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

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';
import { undo, redo } from '../drawing/history.js';
import { fitView } from '../drawing/view.js';
import { setTool } from './toolrail.js';
import { addPanel, deletePanel } from './panel-nav.js';
import { updateBrushUI } from './brush-panel.js';
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
  // Close all popovers when tapping outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#mobileToolPopover') && !e.target.closest('#mtbTool')) {
      $('mobileToolPopover')?.classList.remove('open');
    }
    if (!e.target.closest('#mobileMoreMenu') && !e.target.closest('#mtbGallery')) {
      $('mobileMoreMenu')?.classList.remove('open');
    }
  });
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
  App.brush.color = hex;
  // Sync the color swatch visible in the mobile top bar
  const mtbColor = $('mtbColor');
  if (mtbColor) mtbColor.style.background = hex;
  // Sync the desktop right-panel color picker + hex display
  const cp = $('colorPicker');
  if (cp) cp.value = hex;
  const hexLabel = $('mColorHex');
  if (hexLabel) hexLabel.textContent = hex.toUpperCase();
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
