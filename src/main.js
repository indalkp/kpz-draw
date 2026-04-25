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
import { renderDisplay } from './drawing/view.js';

import { initTopbar } from './ui/topbar.js';
import { initToolRail } from './ui/toolrail.js';
import { initLayersPanel, renderLayersUI } from './ui/layers-panel.js';
import { initBrushPanel, updateBrushUI } from './ui/brush-panel.js';
import { initReferences, renderRefs } from './ui/references.js';
import { initRefViewer } from './ui/ref-viewer.js';
// v3.9.0: Cast & References — character cards, density toggle, per-card zoom
import { initCastPanel, renderCast } from './ui/cast-panel.js';
import { initDocsPanel } from './ui/docs-panel.js';
import { initPanelNav, renderPanelNav } from './ui/panel-nav.js';
import { initModals } from './ui/modals.js';
import { initLibraryModal } from './ui/library-modal.js';
import { initConfirmLeave } from './ui/confirm-leave.js';
// v3.8.0 mobile modules — do nothing on desktop, take over chrome on <1100px
import { initBrushDock } from './ui/brush-dock.js';
import { initMobileChrome, updateMobileTopbar } from './ui/mobile-chrome.js';

import { initWixBridge } from './storage/wix-bridge.js';
import { tryRestoreAutosave } from './storage/autosave.js';
import { restorePersistentRefs, restorePersistentCharacters } from './storage/persistent-refs.js';

/**
 * Initialize KPZ Draw inside the given root element.
 */
export async function init(rootSelector, opts = {}) {
  const root = typeof rootSelector === 'string'
    ? document.querySelector(rootSelector)
    : rootSelector;
  if (!root) {
    throw new Error(`KPZ Draw: root element not found (${rootSelector})`);
  }

  // 1. Load stylesheet
  await loadStylesheet(`${opts.baseUrl}/styles.css`);

  // 2. Build DOM structure
  buildAppDom(root);

  // 3. Initialize subsystems in dependency order
  initWixBridge();
  initTopbar();
  initToolRail();
  initBrushPanel();
  initLayersPanel();
  initReferences();
  // v3.9.0: cast panel sits in the same #leftPanel as refs and toggles via tabs.
  // Init AFTER initReferences so the refs DOM and listeners are wired first.
  initCastPanel();
  initRefViewer();
  initDocsPanel();
  initPanelNav();
  initModals();
  initLibraryModal();
  initConfirmLeave();
  initDrawing();
  // v3.8.0: mobile chrome after all the desktop modules are wired. These are
  // no-ops on desktop (CSS hides the elements they wire up).
  initBrushDock();
  initMobileChrome();
  wireGlobalEvents();

  // 4. Restore or create project
  const restored = await tryRestoreAutosave();
  if (!restored) {
    App.project = createProject('Untitled', 1280, 720);
    renderPanelNav();
    renderLayersUI();
    // v3.8.3: paint the blank project onto the display canvas now. Without
    // this, #displayCanvas stays at the HTML5 default of 300x150 and fitView's
    // scale collapses the visible rect to a nearly-invisible ~84x42 on mobile.
    // loadKpzBlob already calls renderDisplay; the fresh-create path did not.
    renderDisplay();
  }

  // 5. Restore session-persistent references and characters
  await restorePersistentRefs();
  // v3.9.0: characters live in their own IDB bucket parallel to refs.
  await restorePersistentCharacters();
  renderRefs();
  renderCast();

  // 6. Restore persisted UI state
  const lastDoc = localStorage.getItem('kpz_doc_url');
  if (lastDoc) {
    const input = document.getElementById('docUrl');
    if (input) input.value = lastDoc;
    document.getElementById('docUrl')?.dispatchEvent(new Event('change'));
  }

  // 7. Initial canvas fit
  updateBrushUI();
  updateMobileTopbar();  // v3.8.0: populate project name / layer count in mobile topbar
  // v3.8.4: poll for canvasArea to reach a real size before running the
  // first fitView(). The v3.8.3 double-rAF assumed iframe layout settles
  // in 2 frames, but the Wix HtmlComponent often sizes its iframe async —
  // fitView ran while canvasArea was still 0x0, hit the v3.8.1 zero-size
  // guard, and returned without setting App.view.scale. Net result: scale
  // stuck at 1.0, displayCanvas overflows canvasArea, statusbar appears
  // mid-screen on mobile.
  //
  // v3.9.5: reports came in that some iPad / mobile loads still show no
  // canvas after the v3.8.4 fix. Two extensions: (a) cap raised from ~1s
  // to ~5s so slow iframes still recover (300 frames of rAF), and (b) a
  // last-resort fallback — if the cap is reached and scale is still at
  // the default 1.0, force fitView() against whatever current size we
  // have. Worst case it fits to a small visible area; ResizeObserver then
  // re-fits when the iframe finishes settling. Better than a black canvas.
  let _firstFitTries = 0;
  const _tryFirstFit = () => {
    const ca = document.getElementById('canvasArea');
    if (ca && ca.clientWidth >= 100 && ca.clientHeight >= 100) {
      fitView();
      renderDisplay();
      return;
    }
    if (++_firstFitTries < 300) {
      requestAnimationFrame(_tryFirstFit);
      return;
    }
    // v3.9.5 last-resort: 5s have passed and we still don't have a real
    // size. If scale is at the default 1.0, the canvas is invisible (size
    // 1280x720 inside a tiny iframe). Force fitView so SOMETHING renders.
    if (App.view && App.view.scale === 1) {
      console.warn('[KPZ] canvasArea did not reach 100px in 5s — forcing fitView with current dims.');
      fitView();
      renderDisplay();
    }
  };
  _tryFirstFit();

  // 8. Prevent accidental nav-away on unsaved changes
  window.addEventListener('beforeunload', e => {
    if (App.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  console.log(`KPZ Draw ${opts.version || ''} ready.`);
}

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
