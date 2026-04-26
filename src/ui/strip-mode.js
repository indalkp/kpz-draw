// ============================================================================
//  src/ui/strip-mode.js — v3.10.0 vertical-scroll comic-strip layout
//
//  Adds a "Strip mode" view alongside the classic single-panel editor.
//  When enabled, all panels render stacked vertically inside #stripContainer,
//  and the user clicks a panel to make it the active editable one.
//
//  Architecture:
//    - Each panel slot is a .strip-panel div with .strip-panel-surface and
//      .strip-panel-caption children.
//    - For inactive panels, the surface contains a static preview <canvas>
//      that's painted by renderPanelToCanvas() once per state change.
//    - For the ACTIVE panel, the surface receives #canvasWrap (DOM-relocated
//      from #canvasArea). The existing brush/event pipeline keeps working
//      unchanged because it targets #displayCanvas via getBoundingClientRect.
//    - When the user clicks an inactive panel, we render the OLD active
//      panel's content into a preview canvas (so its strokes survive),
//      move #canvasWrap into the new slot, and switch activePanelIdx.
//
//  This module is initialized after the DOM is built (main.js calls
//  initStripMode). Public API:
//
//    initStripMode()              — wire toggle button + delegated clicks
//    enableStripMode()            — turn on strip mode
//    disableStripMode()           — turn off strip mode
//    rebuildStripContainer()      — full rebuild after panel add/delete/reorder
//    refreshStripPreview(idx)     — repaint a single inactive panel preview
//    scrollActivePanelIntoView()  — used by animatic playback auto-scroll
//
//  Called from outside this module:
//    - topbar.js wires #btnStripMode click → toggleStripMode
//    - panel-nav.js calls refreshStripPreview after panel data changes
//    - topbar.js animatic advance calls scrollActivePanelIntoView
// ============================================================================

import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';
import { renderPanelToCanvas, renderDisplay } from '../drawing/view.js';

let stripContainer = null;     // #stripContainer
let canvasArea = null;         // #canvasArea — #canvasWrap's original home
let canvasWrap = null;         // #canvasWrap — relocated in/out of strip slots
let initialized = false;

// ---------------------------------------------------------------------------
// Init / public API
// ---------------------------------------------------------------------------

export function initStripMode() {
  if (initialized) return;
  stripContainer = $('stripContainer');
  canvasArea     = $('canvasArea');
  canvasWrap     = $('canvasWrap');
  if (!stripContainer || !canvasArea || !canvasWrap) {
    console.warn('[strip-mode] DOM not ready');
    return;
  }
  // Delegated click handler for switching active panel.
  stripContainer.addEventListener('click', onStripClick);
  // Delegated pointerdown so a tap on an inactive panel switches BEFORE the
  // brush event fires. Without this, the first click on an inactive panel
  // would draw on the OLD active panel's surface (because #canvasWrap is
  // still positioned over the old slot until we relocate it).
  stripContainer.addEventListener('pointerdown', onStripPointerDown, { capture: true });
  initialized = true;
}

export function enableStripMode() {
  if (!initialized) initStripMode();
  if (App.viewMode === 'strip') return;
  App.viewMode = 'strip';
  document.body.classList.add('strip-mode');
  syncStripButton(true);
  rebuildStripContainer();
  // Render the active panel into the (now relocated) #displayCanvas so the
  // user sees their current work in the active slot.
  renderDisplay();
  // Scroll the active panel into view after a tick (let layout settle first)
  requestAnimationFrame(() => scrollActivePanelIntoView({ behavior: 'auto' }));
}

export function disableStripMode() {
  if (App.viewMode === 'single') return;
  // Move #canvasWrap back to #canvasArea before tearing down the strip
  if (canvasWrap.parentElement !== canvasArea) {
    canvasArea.appendChild(canvasWrap);
  }
  // Clear strip slots
  stripContainer.innerHTML = '';
  document.body.classList.remove('strip-mode');
  syncStripButton(false);
  App.viewMode = 'single';
  // Re-render through the classic path so view transform is restored
  renderDisplay();
}

export function toggleStripMode() {
  if (App.viewMode === 'strip') disableStripMode();
  else enableStripMode();
}

/**
 * Build (or rebuild) every slot inside the strip container. Called when
 * entering strip mode and whenever panel count/order changes (panel-nav
 * calls this on add/delete/reorder).
 */
export function rebuildStripContainer() {
  if (!initialized) initStripMode();
  if (!stripContainer || !App.project) return;
  if (App.viewMode !== 'strip') return;

  // Clear and rebuild
  stripContainer.innerHTML = '';
  const panels = App.project.panels;
  const aspect = `${App.project.width} / ${App.project.height}`;

  for (let i = 0; i < panels.length; i++) {
    const slot = document.createElement('div');
    slot.className = 'strip-panel';
    slot.dataset.panelIdx = String(i);
    slot.style.setProperty('--strip-aspect', aspect);

    const surface = document.createElement('div');
    surface.className = 'strip-panel-surface';
    slot.appendChild(surface);

    const caption = buildCaptionRow(i, panels[i]);
    slot.appendChild(caption);

    stripContainer.appendChild(slot);
  }

  // Mark active and place #canvasWrap into it
  const activeIdx = App.activePanelIdx;
  const slots = stripContainer.children;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const surface = slot.querySelector('.strip-panel-surface');
    if (i === activeIdx) {
      slot.classList.add('active');
      surface.appendChild(canvasWrap);
    } else {
      slot.classList.remove('active');
      // Render preview canvas for this inactive panel
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = App.project.width;
      previewCanvas.height = App.project.height;
      surface.appendChild(previewCanvas);
      renderPanelToCanvas(panels[i], previewCanvas);
    }
  }
}

/**
 * Repaint a single panel's preview canvas + caption row. Used when the
 * underlying panel data changes (caption typed into the bottom strip,
 * audio attached, duration override set, undo/redo, etc).
 *
 * For the ACTIVE panel: only the caption row + badges update — the
 * canvas surface is the live #displayCanvas and re-renders itself via
 * renderDisplay() in the normal pipeline.
 *
 * For INACTIVE panels: both the preview canvas AND the caption row
 * are refreshed.
 */
export function refreshStripPreview(idx) {
  if (App.viewMode !== 'strip') return;
  if (!stripContainer || !App.project) return;
  const slot = stripContainer.querySelector(`.strip-panel[data-panel-idx="${idx}"]`);
  if (!slot) return;
  const panel = App.project.panels[idx];
  if (!panel) return;
  // Always refresh caption row (cheap)
  updateCaptionRow(slot, idx, panel);
  // Repaint preview canvas only for inactive slots
  if (idx !== App.activePanelIdx) {
    const previewCanvas = slot.querySelector('.strip-panel-surface > canvas');
    if (previewCanvas) renderPanelToCanvas(panel, previewCanvas);
  }
}

/**
 * Smooth-scroll the active panel into view. Used by animatic playback
 * to follow the auto-advancing active panel.
 */
export function scrollActivePanelIntoView(opts = { behavior: 'smooth' }) {
  if (App.viewMode !== 'strip' || !stripContainer) return;
  const activeIdx = App.activePanelIdx;
  const slot = stripContainer.querySelector(`.strip-panel[data-panel-idx="${activeIdx}"]`);
  if (!slot) return;
  slot.scrollIntoView({ behavior: opts.behavior || 'smooth', block: 'center' });
}

// ---------------------------------------------------------------------------
// Internal: click / pointer routing
// ---------------------------------------------------------------------------

function onStripClick(e) {
  // Plain click: if it landed on an inactive panel, just switch active.
  // (pointerdown handler already does the heavy lifting; this is a fallback
  // for non-pointer-event environments and keyboard activations.)
  const slot = e.target.closest('.strip-panel');
  if (!slot) return;
  const idx = parseInt(slot.dataset.panelIdx, 10);
  if (Number.isNaN(idx) || idx === App.activePanelIdx) return;
  switchActiveStripPanel(idx);
}

function onStripPointerDown(e) {
  // If user pointer-downs on an INACTIVE panel, switch active BEFORE the
  // brush pipeline sees the event. We don't stopPropagation — we want the
  // event to flow into the (newly active) #canvasWrap so a drag-from-here
  // immediately starts a brush stroke on the new panel.
  const slot = e.target.closest('.strip-panel');
  if (!slot) return;
  const idx = parseInt(slot.dataset.panelIdx, 10);
  if (Number.isNaN(idx) || idx === App.activePanelIdx) return;
  switchActiveStripPanel(idx);
  // Do NOT preventDefault — the pointer event should still reach
  // #displayCanvas now that it's positioned in the new slot.
}

/**
 * v3.10.0: Move #canvasWrap (the live editing surface) from whichever
 * .strip-panel slot it currently lives in to the slot for `newIdx`.
 * Renders the OLD slot's panel into a static preview canvas first so its
 * strokes survive the relocation. Idempotent: no-op if already in the
 * target slot.
 *
 * This is the building block. Public switchActiveStripPanel() + the
 * panel-nav switchPanel() integration both call this; switchPanel then
 * does the normal renderDisplay / layers UI / filmstrip / caption sync.
 */
export function relocateCanvasWrapTo(newIdx) {
  if (App.viewMode !== 'strip') return;
  if (!stripContainer || !App.project) return;
  if (newIdx < 0 || newIdx >= App.project.panels.length) return;

  const slots = Array.from(stripContainer.children);
  const targetSlot = slots[newIdx];
  if (!targetSlot) return;
  // Find the slot currently holding #canvasWrap
  const currentSlot = slots.find(s => s.contains(canvasWrap));
  if (currentSlot === targetSlot) return;   // already there, idempotent

  // 1. Render the current slot's panel into a fresh preview canvas
  if (currentSlot) {
    const currentIdx = parseInt(currentSlot.dataset.panelIdx, 10);
    const oldSurface = currentSlot.querySelector('.strip-panel-surface');
    if (oldSurface && canvasWrap.parentElement === oldSurface) {
      oldSurface.removeChild(canvasWrap);
    }
    if (oldSurface && !Number.isNaN(currentIdx)) {
      const oldPreview = document.createElement('canvas');
      oldPreview.width = App.project.width;
      oldPreview.height = App.project.height;
      oldSurface.innerHTML = '';
      oldSurface.appendChild(oldPreview);
      renderPanelToCanvas(App.project.panels[currentIdx], oldPreview);
    }
    currentSlot.classList.remove('active');
  }

  // 2. Wipe the new slot's preview canvas and insert #canvasWrap
  const targetSurface = targetSlot.querySelector('.strip-panel-surface');
  if (targetSurface) {
    targetSurface.innerHTML = '';
    targetSurface.appendChild(canvasWrap);
  }
  targetSlot.classList.add('active');
}

/**
 * Switch active panel from inside strip mode. Calls relocateCanvasWrapTo
 * for the DOM moves, then defers to panel-nav's switchPanel for all the
 * normal side effects (filmstrip highlight, layers panel re-render,
 * caption sync, history pointer change, audio refresh).
 */
function switchActiveStripPanel(newIdx) {
  if (newIdx === App.activePanelIdx) return;
  // The DOM relocate is also called from panel-nav.switchPanel itself
  // in strip mode (so filmstrip clicks work too), so the relocate is
  // idempotent. Calling it here ensures the DOM is right BEFORE the
  // pointerdown event finishes propagating to the brush handlers — so
  // a drag-from-here starts a stroke on the NEW panel, not the old one.
  relocateCanvasWrapTo(newIdx);
  import('./panel-nav.js').then(m => {
    if (typeof m.switchPanel === 'function') m.switchPanel(newIdx);
    else { App.activePanelIdx = newIdx; renderDisplay(); }
  });
}

// ---------------------------------------------------------------------------
// Internal: caption row builder
// ---------------------------------------------------------------------------

function buildCaptionRow(idx, panel) {
  const row = document.createElement('div');
  row.className = 'strip-panel-caption';
  updateCaptionRow(row, idx, panel);
  return row;
}

function updateCaptionRow(slotOrRow, idx, panel) {
  const row = slotOrRow.classList?.contains('strip-panel-caption')
    ? slotOrRow
    : slotOrRow.querySelector('.strip-panel-caption');
  if (!row) return;
  row.innerHTML = '';

  // Index badge
  const idxEl = document.createElement('span');
  idxEl.className = 'strip-panel-idx';
  idxEl.textContent = `Panel ${idx + 1}`;
  row.appendChild(idxEl);

  // Caption text
  const text = (panel.caption || '').trim();
  const textEl = document.createElement('span');
  textEl.className = 'strip-panel-caption-text';
  if (text) {
    textEl.textContent = text;
  } else {
    textEl.textContent = '(no caption)';
    textEl.classList.add('strip-panel-caption-empty');
  }
  row.appendChild(textEl);

  // Audio badge if attached
  if (panel.audioId) {
    const audio = document.createElement('span');
    audio.className = 'strip-panel-badge';
    audio.textContent = panel.audioDuration
      ? `🔊 ${panel.audioDuration.toFixed(1)}s`
      : '🔊';
    row.appendChild(audio);
  }

  // Manual duration override badge if set
  if (panel.duration && panel.duration > 0) {
    const dur = document.createElement('span');
    dur.className = 'strip-panel-badge';
    dur.textContent = `⏱ ${panel.duration}s`;
    row.appendChild(dur);
  }
}

// ---------------------------------------------------------------------------
// Internal: button sync
// ---------------------------------------------------------------------------

function syncStripButton(active) {
  const btn = $('btnStripMode');
  if (!btn) return;
  btn.classList.toggle('active', active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.title = active
    ? 'Exit strip mode (return to single-panel editor)'
    : 'Strip mode (vertical-scroll comic-strip layout)';
}
