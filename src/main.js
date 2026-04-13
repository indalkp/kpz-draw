// ============================================================================
//  KPZ Draw — Entry Point
//
//  Called by bootstrap-embed.html once the module is fetched from jsDelivr.
//  Responsibilities:
//    1. Inject the stylesheet
//    2. Build the DOM structure inside the root element
//    3. Initialize every subsystem in dependency order
//    4. Restore persisted state (autosave, refs, docs URL)
//    5. Fit the canvas to the viewport
// ============================================================================

import { App } from './core/state.js';
import { buildAppDom } from './core/dom.js';
import { wireGlobalEvents } from './core/events.js';

import { initDrawing } from './drawing/canvas.js';
import { createProject } from './drawing/panels.js';
import { fitView } from './drawing/view.js';

import { initTopbar } from './ui/topbar.js';
import { initToolRail } from './ui/toolrail.js';
import { initLayersPanel, renderLayersUI } from './ui/layers-panel.js';
import { initBrushPanel, updateBrushUI } from './ui/brush-panel.js';
import { initReferences, renderRefs } from './ui/references.js';
import { initRefViewer } from './ui/ref-viewer.js';
import { initDocsPanel } from './ui/docs-panel.js';
import { initPanelNav, renderPanelNav } from './ui/panel-nav.js';
import { initModals } from './ui/modals.js';
import { initLibraryModal } from './ui/library-modal.js';

import { initWixBridge } from './storage/wix-bridge.js';
import { tryRestoreAutosave } from './storage/autosave.js';
import { restorePersistentRefs } from './storage/persistent-refs.js';

/**
 * Initialize KPZ Draw inside the given root element.
 *
 * @param {string|HTMLElement} rootSelector  - CSS selector or element for the mount point
 * @param {object} opts
 * @param {string} opts.baseUrl              - jsDelivr base URL (used to load styles.css)
 * @param {string} opts.version              - version string for logging
 */
export async function init(rootSelector, opts = {}) {
  const root = typeof rootSelector === 'string'
    ? document.querySelector(rootSelector)
    : rootSelector;
  if (!root) {
    throw new Error(`KPZ Draw: root element not found (${rootSelector})`);
  }

  // -------- 1. Load stylesheet --------
  await loadStylesheet(`${opts.baseUrl}/styles.css`);

  // -------- 2. Build DOM structure --------
  buildAppDom(root);

  // -------- 3. Initialize subsystems in dependency order --------
  initWixBridge();        // establishes postMessage link to Velo backend
  initTopbar();           // top bar: File/Edit/View, save/open, auth
  initToolRail();         // left rail: brush/eraser/eyedropper/hand
  initBrushPanel();       // right sidebar: Brush tab
  initLayersPanel();      // right sidebar: Layers tab
  initReferences();       // left sidebar: references list
  initRefViewer();        // fullscreen reference viewer + color sampler
  initDocsPanel();        // right sidebar: Script (Google Docs) tab
  initPanelNav();         // storyboard strip with +/- buttons
  initModals();           // new/save/open dialogs
  initLibraryModal();     // v3.6.1: reference library (per-project ref buckets)
  initDrawing();          // canvas pointer event handlers
  wireGlobalEvents();     // keyboard shortcuts, window resize, etc.

  // -------- 4. Restore or create project --------
  const restored = await tryRestoreAutosave();
  if (!restored) {
    App.project = createProject('Untitled', 1280, 720);
    renderPanelNav();
    renderLayersUI();
  }

  // -------- 5. Restore session-persistent references --------
  // (refs are treated as a personal library that survives across projects)
  await restorePersistentRefs();
  renderRefs();

  // -------- 6. Restore persisted UI state --------
  const lastDoc = localStorage.getItem('kpz_doc_url');
  if (lastDoc) {
    const input = document.getElementById('docUrl');
    if (input) input.value = lastDoc;
    // loadDoc is wired up by initDocsPanel
    document.getElementById('docUrl')?.dispatchEvent(new Event('change'));
  }

  // -------- 7. Initial canvas fit after layout settles --------
  updateBrushUI();
  requestAnimationFrame(() => {
    fitView();
  });

  // -------- 8. Prevent accidental nav-away on unsaved changes --------
  window.addEventListener('beforeunload', e => {
    if (App.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  console.log(`KPZ Draw ${opts.version || ''} ready.`);
}

// ----------------------------------------------------------------------------
//  Helpers
// ----------------------------------------------------------------------------

function loadStylesheet(href) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => {
      console.warn('KPZ Draw: stylesheet failed to load, continuing without it:', href);
      resolve();
    };
    document.head.appendChild(link);
  });
}
