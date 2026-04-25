// src/core/dom.js
// Builds the entire application DOM structure and injects it into the root element.
// All IDs used here must match the IDs referenced in the other modules.
//
// v3.8.0: added mobile chrome elements (topbar, brush dock, tool popover, color modal).
// These are all children of #app, shown only below 1100px via CSS media query.
// The existing desktop DOM is unchanged — no IDs moved, no modules need refactoring.

export function buildAppDom(root) {
  root.innerHTML = `
<div id="app">
  <!-- ===== TOP BAR (desktop) ===== -->
  <div id="topbar">
    <div class="brand">KPZ Draw <small>v3.9.14</small></div>
    <div class="tb-group">
      <button class="btn" id="btnNew" title="New (Ctrl+N)">New</button>
      <button class="btn" id="btnOpen" title="Open file (Ctrl+O)">Open</button>
      <button class="btn" id="btnSave" title="Save (Ctrl+S)">Save</button>
    </div>
    <div class="tb-group">
      <button class="btn" id="btnUndo" title="Undo (Ctrl+Z)">
        <svg viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
      </button>
      <button class="btn" id="btnRedo" title="Redo (Ctrl+Shift+Z)">
        <svg viewBox="0 0 24 24"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
      </button>
    </div>
    <!--
      v3.9.1: brush chip in the desktop topbar. Anchored popover (defined at
      the bottom of #app) opens below this chip on click. The right-panel
      Brush tab is preserved as-is — popover and tab are two views of the
      same App.brush state, both updated by updateBrushUI().
    -->
    <div class="tb-group" id="brushChipGroup">
      <button class="btn brush-chip" id="brushChip" title="Brush settings (Ctrl+B)">
        <span class="brush-chip-swatch" id="brushChipSwatch" style="background:#1a1a1a"></span>
        <span class="brush-chip-size" id="brushChipSize">8px</span>
        <span class="brush-chip-gear">⚙</span>
      </button>
    </div>
    <div class="tb-group">
      <button class="btn" id="btnAddPanel" title="Add storyboard panel">+ Panel</button>
      <button class="btn" id="btnDelPanel" title="Delete current panel">− Panel</button>
    </div>
    <!--
      v3.9.10: animatic playback. Auto-advances through panels at the chosen
      frame rate so storyboard sequences play like a rough animatic. Drawing
      on the canvas auto-stops playback. Keyboard 'P' toggles play/pause.
      No saved state — playback is a transient view.
    -->
    <div class="tb-group" id="playbackGroup">
      <button class="btn" id="btnPlay" title="Play animatic (P)" aria-pressed="false">
        <svg id="btnPlayIcon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
      </button>
      <label class="fps-label" title="Playback frame rate (panels per second)">
        <input type="number" id="playFps" min="1" max="12" value="2"> fps
      </label>
    </div>
    <div class="tb-group">
      <button class="btn" id="btnFit" title="Fit to screen (F)">Fit</button>
      <button class="btn" id="btnFullscreen" title="Fullscreen drawing (F11)">
        <svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
      </button>
      <!--
        v3.9.7: onion-skin toggle. When on, the previous storyboard panel
        is rendered as a faint ghost behind the current panel — useful for
        continuity / animation timing within a sequence. Pure visual; the
        underlying panel data is unchanged.
      -->
      <button class="btn" id="btnOnion" title="Onion skin (show previous panel as ghost)" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18V4a8 8 0 0 1 0 16z"/>
        </svg>
      </button>
    </div>
    <div style="flex:1"></div>
    <div class="tb-group" style="border-right:none">
      <div id="authBox" class="logged-out" title="Click for menu">
        <div id="authAvatar"></div>
        <div id="authName" class="prompt">Log in to save</div>
        <svg id="authCaret" width="10" height="10" viewBox="0 0 10 10"><path fill="currentColor" d="M1 3l4 4 4-4z"/></svg>
      </div>
      <div id="profileMenu">
        <button id="pmDashboard"><span>📊</span> My Dashboard</button>
        <button id="pmMyWork"><span>🎨</span> My Work</button>
        <button id="pmLogout"><span>↩</span> Log out</button>
      </div>
    </div>
  </div>

  <!-- ===== MOBILE TOPBAR (shown <1100px only) ===== -->
  <!-- Stroke-fix + mobile redesign v3.8.0 — sits above #topbar in DOM so the -->
  <!-- safe-area-inset top padding works, but CSS hides whichever one isn't in use. -->
  <div id="mobileTopbar">
    <button id="mtbGallery" class="mtb-btn" aria-label="Menu" title="Menu">
      <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <button id="mtbUndo" class="mtb-btn" aria-label="Undo" title="Undo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a6 6 0 016 6v2"/></svg>
    </button>
    <button id="mtbRedo" class="mtb-btn" aria-label="Redo" title="Redo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l4-4-4-4"/><path d="M19 10h-9a6 6 0 00-6 6v2"/></svg>
    </button>
    <div class="mtb-spacer"></div>
    <span class="mtb-project" id="mtbProjectName">Untitled</span>
    <!-- v3.9.2: compact save chip mirrors the desktop one — same state classes -->
    <span id="mtbSaveStatus" class="save-chip save-chip-mini ss-saved" title="Save status" aria-hidden="false">
      <span class="ss-icon" aria-hidden="true">☁</span>
    </span>
    <div class="mtb-spacer"></div>
    <button id="mtbRefs" class="mtb-btn" aria-label="References" title="References">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
    </button>
    <button id="mtbTool" class="mtb-btn active" aria-label="Tool" title="Tool">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-6-6"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2" fill="currentColor"/></svg>
    </button>
    <button id="mtbColor" class="mtb-color-swatch" aria-label="Color" title="Color" style="background:#1a1a1a"></button>
    <button id="mtbLayers" class="mtb-btn mtb-badge" aria-label="Layers" title="Layers" data-count="1">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    </button>
  </div>

  <!-- ===== MAIN GRID ===== -->
  <div id="main">
    <!-- LEFT: CAST & REFERENCES (v3.9.0) -->
    <!--
      v3.9.0 introduces a Cast tab alongside the existing Refs flat list.
      Cast renders character cards that group refs by referencing ref ids.
      The Refs tab keeps today's UX as a fallback so power users aren't
      forced into the cast model. Tab body containers are toggled via
      display:none in cast-panel.js#switchTab — the underlying #refList /
      #refEmpty / .ref-header-actions / .ref-size-row elements are NEVER
      removed, so all existing references.js logic keeps working.
    -->
    <div id="leftPanel" class="cast-compact">
      <div class="panel-header">
        <div class="cast-tabstrip" id="castTabstrip">
          <button class="cast-tab active" id="castTabCast">Cast</button>
          <button class="cast-tab" id="castTabRefs">Refs</button>
        </div>
        <div class="cast-header-actions">
          <button class="btn icon-btn" id="castDensityToggle" title="Switch to comfy view">⚏</button>
          <button class="btn" id="btnAddChar" title="Add a character">+ Char</button>
        </div>
        <div class="ref-header-actions" style="display:none">
          <button class="btn icon-btn" id="btnRefLibrary" title="Import refs from past projects">📁</button>
          <button class="btn icon-btn" id="btnImportRefs" title="Import refs from file">↓</button>
          <button class="btn icon-btn" id="btnExportRefs" title="Export refs to file">↑</button>
          <button class="btn" id="btnAddRef">+ Add</button>
        </div>
      </div>
      <div class="ref-size-row" style="display:none">
        <label>Size</label>
        <input type="range" id="refSize" min="100" max="480" value="220" step="20">
      </div>
      <div class="panel-body">
        <!-- Cast body -->
        <div id="castList"></div>
        <div id="castEmpty">
          No characters yet.<br>
          Click <b>+ Char</b> to add one and group your refs by character.
        </div>
        <!-- Refs body — same DOM as before, just hidden when Cast is active -->
        <div id="refList" style="display:none"></div>
        <div id="refEmpty" style="display:none">No references yet.<br>Click <b>+ Add</b> or drag images here.</div>
      </div>
    </div>

    <div class="resize-handle" id="resizeLeft" title="Drag to resize"></div>

    <!-- TOOL RAIL (desktop) -->
    <div id="toolRail">
      <button class="tool-btn active" data-tool="brush" title="Brush (B)">
        <svg viewBox="0 0 24 24"><path d="M7 14c-1.66 0-3 1.34-3 3 0 1.31-1.16 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3zm13.71-9.37l-1.34-1.34a1 1 0 0 0-1.41 0L9 12.25 11.75 15l8.96-8.96a1 1 0 0 0 0-1.41z"/></svg>
      </button>
      <button class="tool-btn" data-tool="eraser" title="Eraser (E)">
        <svg viewBox="0 0 24 24"><path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4 4 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0M4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53l-6.36-6.36l-3.54 3.53c-.78.79-.78 2.05 0 2.83z"/></svg>
      </button>
      <button class="tool-btn" data-tool="eyedropper" title="Eyedropper (I)">
        <svg viewBox="0 0 24 24"><path d="M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12a1 1 0 0 0 .01-1.42zM6.92 19L5 17.08l8.06-8.06 1.92 1.92L6.92 19z"/></svg>
      </button>
      <button class="tool-btn" data-tool="hand" title="Pan (H, hold Space)">
        <svg viewBox="0 0 24 24"><path d="M13 24c-3.26 0-6.19-1.99-7.4-5.02l-3.03-7.61a1 1 0 0 1 .47-1.27c.94-.5 2.13-.18 2.69.71l1.78 2.92V4a2 2 0 0 1 4 0v8h.5V2a2 2 0 0 1 4 0v10h.5V3a2 2 0 0 1 4 0v9h.5V6a2 2 0 0 1 4 0v11c0 3.86-3.14 7-7 7h-5z"/></svg>
      </button>
      <div class="tool-divider"></div>
      <button class="tool-btn" id="btnZoomIn" title="Zoom in (+)">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.51 6.51 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm-2.5-4h2v2h1v-2h2V9h-2V7H9v2H7v1z"/></svg>
      </button>
      <button class="tool-btn" id="btnZoomOut" title="Zoom out (-)">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.51 6.51 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z"/></svg>
      </button>
      <button class="tool-btn" id="btnClear" title="Clear layer" style="margin-top:auto;color:var(--danger)">
        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    </div>

    <!-- CANVAS AREA -->
    <div id="canvasArea">
      <div id="canvasWrap">
        <canvas id="displayCanvas"></canvas>
      </div>
      <div id="cursorOverlay"></div>

      <!-- v3.8.0: mobile brush dock — vertical size/opacity sliders on left edge -->
      <div id="brushDock" aria-hidden="true">
        <div class="bd-track" data-kind="size">
          <span class="bd-label">size</span>
          <div class="bd-fill"></div>
          <div class="bd-thumb">8</div>
        </div>
        <div class="bd-track" data-kind="opacity">
          <span class="bd-label">opacity</span>
          <div class="bd-fill"></div>
          <div class="bd-thumb">100</div>
        </div>
      </div>

      <!--
        v3.9.11: caption strip. Shows the current panel's caption / line of
        dialogue and lets the user edit it inline. Sits just above the
        filmstrip so the user can read it AND see which panel it belongs
        to during playback. Auto-updates as panels cycle.
      -->
      <div id="captionStrip" title="Caption / dialogue for this panel">
        <span class="cs-label" aria-hidden="true">CAPTION</span>
        <input id="captionInput" type="text" maxlength="240"
               placeholder="Add a caption / line of dialogue for this panel…"
               aria-label="Panel caption">
      </div>
      <div id="panelNav"></div>
      <div id="mobileToggles">
        <button id="toggleLeft" title="References">
          <svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
        </button>
        <button id="toggleRight" title="Layers">
          <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
        </button>
      </div>
      <div id="fitPresets">
        <button data-fit="fit" title="Fit to screen">Fit</button>
        <button data-fit="width" title="Fit width">Width</button>
        <button data-fit="100" title="100%">100%</button>
      </div>
      <div id="panelBackdrop"></div>
    </div>

    <div class="resize-handle" id="resizeRight" title="Drag to resize"></div>

    <!-- RIGHT PANEL -->
    <div id="rightPanel">
      <div class="tab-bar">
        <button class="tab-btn active" data-tab="layers">Layers</button>
        <button class="tab-btn" data-tab="brush">Brush</button>
        <button class="tab-btn" data-tab="projects">My Work</button>
        <button class="tab-btn" data-tab="docs">Script</button>
      </div>
      <div class="tab-content active" data-tab="layers">
        <div id="toolProps">
          <div id="colorRow">
            <div id="colorPickerWrap"><input type="color" id="colorPicker" value="#1a1a1a"></div>
            <div class="swatches" id="swatches"></div>
          </div>
        </div>
        <div id="layersList"></div>
        <div class="layer-actions">
          <button id="btnAddLayer">+ Add</button>
          <button id="btnDupLayer">Dup</button>
          <button id="btnDelLayer">Del</button>
        </div>
      </div>
      <div class="tab-content" data-tab="brush">
        <div id="toolProps" style="border-bottom:none">
          <div class="prop"><label>Size <span id="sizeVal">8 px</span></label><input type="range" id="brushSize" min="1" max="200" value="8"></div>
          <div class="prop"><label>Opacity <span id="opacityVal">100%</span></label><input type="range" id="brushOpacity" min="1" max="100" value="100"></div>
          <div class="prop"><label>Hardness <span id="hardnessVal">80%</span></label><input type="range" id="brushHardness" min="0" max="100" value="80"></div>
          <div class="prop"><label>Smoothing <span id="smoothingVal">40%</span></label><input type="range" id="brushSmoothing" min="0" max="100" value="40"></div>
          <div class="prop"><label>Pressure → Size <span id="presSizeVal">100%</span></label><input type="range" id="presSize" min="0" max="100" value="100"></div>
          <div class="prop"><label>Pressure → Opacity <span id="presOpVal">0%</span></label><input type="range" id="presOp" min="0" max="100" value="0"></div>
        </div>
      </div>
      <div class="tab-content" data-tab="projects">
        <div id="projectsPanel">
          <div id="projectsStatus">Log in to see your saved projects</div>
          <div id="projectsList"></div>
          <button class="btn" id="btnRefreshProjects" style="margin-top:8px;display:none">Refresh</button>
        </div>
      </div>
      <div class="tab-content" data-tab="docs">
        <div id="docsPanel">
          <div class="docs-controls">
            <button class="btn primary" id="btnDocAdd" style="flex:1">+ Add Script</button>
            <button class="expand-btn" id="btnDocExpand" title="Expand/collapse panel">
              <svg viewBox="0 0 24 24"><path d="M10 21v-2H6.41l4.5-4.5-1.41-1.41L5 17.59V14H3v7h7zm4-18v2h3.59l-4.5 4.5 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            </button>
          </div>
          <div id="scriptList"></div>
          <div class="docs-controls">
            <button class="zoom-btn" id="btnDocZoomOut" title="Smaller text">A−</button>
            <span class="zoom-val" id="docZoomVal">100%</span>
            <button class="zoom-btn" id="btnDocZoomIn" title="Larger text">A+</button>
            <button class="zoom-btn" id="btnDocZoomReset" title="Reset zoom" style="width:auto;padding:0 10px">Reset</button>
          </div>
          <div id="docsIframeWrap">
            <iframe id="docFrame" src="about:blank"></iframe>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== STATUS BAR ===== -->
  <!--
    v3.9.2: #saveStatus is now a cloud-chip span. State classes set the
    background and icon: .ss-saved (green) / .ss-saving (orange + pulse) /
    .ss-dirty (orange) / .ss-offline (grey). updateSaveStatus() in
    topbar.js mutates the inner spans + class. Click cycles through a
    short status history dropdown (v3.9.x stretch); plain hover for now.
  -->
  <div id="statusbar">
    <span id="saveStatus" class="save-chip ss-saved" title="Save status">
      <span class="ss-icon" aria-hidden="true">☁</span>
      <span class="ss-label">Saved</span>
    </span>
    <div class="sep"></div>
    <span id="canvasInfo">1280 × 720</span>
    <div class="sep"></div>
    <span id="zoomInfo">100%</span>
    <div class="sep"></div>
    <span id="panelInfo">Panel 1 / 1</span>
    <button class="help-btn" id="btnHelp" title="Keyboard shortcuts (?)">? Help</button>
  </div>

  <!-- ===== v3.8.0 MOBILE POPOVERS & MODALS ===== -->

  <!-- Mobile tool popover (shown when mtbTool is tapped) -->
  <div id="mobileToolPopover" class="m-popover" aria-hidden="true">
    <div class="mtp-grid">
      <button class="mtp-item active" data-tool="brush">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-6-6M2 2l7.586 7.586"/></svg>
        <span>Brush</span>
      </button>
      <button class="mtp-item" data-tool="eraser">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l7-7 4 4 7-7"/><path d="M17 7l4 4"/></svg>
        <span>Eraser</span>
      </button>
      <button class="mtp-item" data-tool="eyedropper">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-11 11H6v-4l11-11z"/><path d="M2 22l4-4"/></svg>
        <span>Picker</span>
      </button>
      <button class="mtp-item" data-tool="hand">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v6M10 10.5V6a2 2 0 00-4 0v8l1.5 3"/></svg>
        <span>Hand</span>
      </button>
    </div>
  </div>

  <!-- Mobile color modal (full-screen takeover for depth) -->
  <div class="modal-bg" id="mobileColorModal">
    <div class="modal m-color-modal">
      <h2>Color</h2>
      <div class="m-color-picker-row">
        <input type="color" id="mColorPicker" value="#1a1a1a">
        <span class="m-color-hex" id="mColorHex">#1A1A1A</span>
      </div>
      <div class="swatches" id="mColorSwatches"></div>
      <div class="modal-actions">
        <button class="btn primary" id="mColorDone">Done</button>
      </div>
    </div>
  </div>

  <!-- Mobile "more" menu (gallery button reuses this) -->
  <!-- v3.8.2: added 4 auth rows at top so login/logout/dashboard/mywork are -->
  <!-- reachable on mobile (desktop has #authBox in topbar; mobile topbar had -->
  <!-- no auth control). Rows are shown/hidden via updateMobileAuthMenu(). -->
  <div id="mobileMoreMenu" class="m-popover" aria-hidden="true">
    <button class="mtp-item-row" data-action="auth-login" id="mtbAuthLogin">🔑 Log in to save</button>
    <button class="mtp-item-row" data-action="auth-dashboard" id="mtbAuthDashboard" style="display:none">📊 My Dashboard</button>
    <button class="mtp-item-row" data-action="auth-mywork" id="mtbAuthMyWork" style="display:none">🎨 My Work</button>
    <button class="mtp-item-row" data-action="auth-logout" id="mtbAuthLogout" style="display:none">↩ Log out</button>
    <div class="mtp-divider"></div>
    <button class="mtp-item-row" data-action="new">New project</button>
    <button class="mtp-item-row" data-action="open">Open file</button>
    <button class="mtp-item-row" data-action="save">Save…</button>
    <div class="mtp-divider"></div>
    <button class="mtp-item-row" data-action="addPanel">+ Add panel</button>
    <button class="mtp-item-row" data-action="delPanel">− Delete panel</button>
    <div class="mtp-divider"></div>
    <button class="mtp-item-row" data-action="fit">Fit to screen</button>
    <button class="mtp-item-row" data-action="fullscreen">Immersive mode</button>
    <button class="mtp-item-row" data-action="help">Keyboard shortcuts</button>
  </div>

  <!--
    v3.9.4: mobile bottom dock. 5-button thumb-reach navigation aligned to
    the V3a wireframe: Draw / Script / Refs / Project / More. Hidden on
    desktop via CSS (only renders below 1100px). Each button drives the
    same handlers as the existing mobile topbar buttons where applicable
    (Refs → leftPanel toggle, More → mobileMoreMenu) so there's a single
    source of truth for state. Script is a placeholder (v4.0 feature) —
    tapping it shows a toast. Project opens the existing save modal.

    The redundant mtbRefs / mtbLayers / mtbGallery buttons in the mobile
    topbar are hidden via CSS in v3.9.4 (their handlers are kept wired in
    case anything else triggers them). v3.9.5+ can remove them from the
    DOM entirely after the dock has lived in production for a release.
  -->
  <nav id="mobileDock" aria-label="Mobile navigation">
    <button class="md-btn active" data-md="draw" aria-label="Draw">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 19l7-7 3 3-7 7-3-3z"/>
        <path d="M18 13l-6-6"/>
        <path d="M2 2l7.586 7.586"/>
        <circle cx="11" cy="11" r="2" fill="currentColor"/>
      </svg>
      <span class="md-label">Draw</span>
    </button>
    <button class="md-btn" data-md="refs" aria-label="Refs">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
      <span class="md-label">Refs</span>
    </button>
    <!--
      v3.9.5: replaced the Script placeholder dock button with Layers.
      Layers became unreachable on mobile in v3.9.4 (mtbLayers got hidden
      by CSS but no dock entry was added) — clear navigation regression.
      Script returns when v4.0 ships its real editor.
    -->
    <button class="md-btn" data-md="layers" aria-label="Layers">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
      <span class="md-label">Layers</span>
    </button>
    <button class="md-btn" data-md="project" aria-label="Project">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
      </svg>
      <span class="md-label">Project</span>
    </button>
    <button class="md-btn" data-md="more" aria-label="More">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
      <span class="md-label">More</span>
    </button>
  </nav>

  <!--
    v3.9.1: anchored brush popover. Opens from #brushChip in the topbar.
    Caret SVG points back to the chip — visually clearly its child. Same
    sliders as the right-panel Brush tab but two-way bound through
    updateBrushUI(); both surfaces stay in sync.
    Tabs inside: Brush (size/opacity/hardness/smoothing + colors) and
    Pressure (presSize/presOp). Presets is a v3.9.x stretch.
  -->
  <div id="brushPopover" class="bp-pop" aria-hidden="true">
    <svg class="bp-caret" viewBox="0 0 18 10" aria-hidden="true">
      <polygon points="9,0 18,10 0,10"/>
    </svg>
    <div class="bp-head">
      <span class="bp-title">🖌 Brush</span>
      <button class="bp-close" id="bpClose" aria-label="Close" title="Close">✕</button>
    </div>
    <div class="bp-tabs" role="tablist">
      <button class="bp-tab active" data-bp-tab="brush" role="tab">Brush</button>
      <button class="bp-tab"        data-bp-tab="pressure" role="tab">Pressure</button>
    </div>
    <!-- Brush tab content -->
    <div class="bp-tab-pane active" data-bp-pane="brush">
      <div class="bp-stroke-preview" id="bpStrokePreview" aria-hidden="true">
        <svg viewBox="0 0 240 38" preserveAspectRatio="none">
          <path id="bpStrokePath" d="M10 26 Q 60 6 120 20 T 230 14" fill="none"
                stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="bp-color-row">
        <input type="color" id="bpColorPicker" value="#1a1a1a" title="Pick color">
        <div class="bp-swatches" id="bpSwatches"></div>
      </div>
      <div class="bp-prop">
        <label>Size <span class="bp-val" id="bpSizeVal">8 px</span></label>
        <input type="range" id="bpSize" min="1" max="200" value="8">
      </div>
      <div class="bp-prop">
        <label>Opacity <span class="bp-val" id="bpOpacityVal">100%</span></label>
        <input type="range" id="bpOpacity" min="1" max="100" value="100">
      </div>
      <div class="bp-prop">
        <label>Hardness <span class="bp-val" id="bpHardnessVal">80%</span></label>
        <input type="range" id="bpHardness" min="0" max="100" value="80">
      </div>
      <div class="bp-prop">
        <label>Smoothing <span class="bp-val" id="bpSmoothingVal">40%</span></label>
        <input type="range" id="bpSmoothing" min="0" max="100" value="40">
      </div>
    </div>
    <!-- Pressure tab content -->
    <div class="bp-tab-pane" data-bp-pane="pressure">
      <div class="bp-prop">
        <label>Pressure → Size <span class="bp-val" id="bpPresSizeVal">100%</span></label>
        <input type="range" id="bpPresSize" min="0" max="100" value="100">
      </div>
      <div class="bp-prop">
        <label>Pressure → Opacity <span class="bp-val" id="bpPresOpVal">0%</span></label>
        <input type="range" id="bpPresOp" min="0" max="100" value="0">
      </div>
      <p class="bp-hint">
        Pressure response only applies on stylus / pen input —
        mouse and touch use fixed brush settings.
      </p>
    </div>
  </div>
</div>

<!-- Exit fullscreen -->
<button id="exitFullscreen" title="Exit fullscreen (Esc)">
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
</button>

<!-- Reference viewer -->
<div id="refViewer">
  <button class="close" id="refClose" title="Close (Esc)">✕</button>
  <div class="counter" id="refCounter">1 / 1</div>
  <button class="nav-btn nav-prev" id="refPrev">‹</button>
  <div id="refViewerStage">
    <img id="refViewerImg" draggable="false" alt="">
  </div>
  <button class="nav-btn nav-next" id="refNext">›</button>
  <div id="refViewerControls">
    <button id="refZoomOut">− Zoom</button>
    <span class="zoomVal" id="refZoomVal">100%</span>
    <button id="refZoomIn">Zoom +</button>
    <button id="refZoomFit">Fit</button>
    <button id="refZoom100">100%</button>
    <button id="refPickColor" title="Sample color from image">🎨 Pick Color</button>
    <span id="refPickedColor" style="display:none;padding:4px 10px;border-radius:6px;font-family:monospace;font-size:12px"></span>
  </div>
</div>

<!-- Keyboard shortcuts help -->
<div id="helpOverlay">
  <div class="help-content">
    <h2>KPZ Draw — Keyboard Shortcuts</h2>
    <p class="subtitle">Press <b>?</b> to toggle this help.</p>
    <div class="help-grid">
      <div class="help-section">
        <h3>Tools</h3>
        <div class="help-row"><span class="label">Brush</span><span class="key">B</span></div>
        <div class="help-row"><span class="label">Eraser</span><span class="key">E</span></div>
        <div class="help-row"><span class="label">Eyedropper</span><span class="key">I</span></div>
        <div class="help-row"><span class="label">Pan (hand)</span><span class="key">H / Space</span></div>
        <div class="help-row"><span class="label">Brush size −/+</span><span class="key">[ / ]</span></div>
      </div>
      <div class="help-section">
        <h3>View</h3>
        <div class="help-row"><span class="label">Fit to screen</span><span class="key">F</span></div>
        <div class="help-row"><span class="label">Actual size</span><span class="key">1</span></div>
        <div class="help-row"><span class="label">Zoom in / out</span><span class="key">+ / −</span></div>
        <div class="help-row"><span class="label">Fullscreen</span><span class="key">F11</span></div>
        <div class="help-row"><span class="label">Toggle references</span><span class="key">Tab</span></div>
      </div>
      <div class="help-section">
        <h3>File</h3>
        <div class="help-row"><span class="label">New project</span><span class="key">Ctrl+N</span></div>
        <div class="help-row"><span class="label">Open file</span><span class="key">Ctrl+O</span></div>
        <div class="help-row"><span class="label">Save</span><span class="key">Ctrl+S</span></div>
        <div class="help-row"><span class="label">Undo</span><span class="key">Ctrl+Z</span></div>
        <div class="help-row"><span class="label">Redo</span><span class="key">Ctrl+Shift+Z</span></div>
      </div>
      <div class="help-section">
        <h3>Touch</h3>
        <div class="help-row"><span class="label">Zoom / Pan canvas</span><span class="key">2 fingers</span></div>
        <div class="help-row"><span class="label">Undo</span><span class="key">3 finger tap</span></div>
        <div class="help-row"><span class="label">Fit to screen</span><span class="key">Double tap</span></div>
        <div class="help-row"><span class="label">Open References</span><span class="key">Swipe right</span></div>
        <div class="help-row"><span class="label">Open Layers</span><span class="key">Swipe left</span></div>
      </div>
    </div>
    <button class="help-close" id="helpClose">Got it</button>
  </div>
</div>

<!-- New project modal -->
<div class="modal-bg" id="newModal">
  <div class="modal">
    <h2>New Project</h2>
    <div class="row"><label>Name</label><input type="text" id="newName" value="Untitled"></div>
    <div class="row"><label>Width</label><input type="number" id="newW" value="1280"></div>
    <div class="row"><label>Height</label><input type="number" id="newH" value="720"></div>
    <div class="row"><label>Preset</label>
      <select id="newPreset">
        <option value="custom">Custom</option>
        <option value="1280x720">Storyboard 16:9 (1280×720)</option>
        <option value="1920x1080">Storyboard HD (1920×1080)</option>
        <option value="1080x1920">Webtoon panel (1080×1920)</option>
        <option value="2048x2048">Square 2K (2048×2048)</option>
        <option value="800x600">Quick sketch (800×600)</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn" id="newCancel">Cancel</button>
      <button class="btn primary" id="newCreate">Create</button>
    </div>
  </div>
</div>

<!-- Save modal -->
<div class="modal-bg" id="saveModal">
  <div class="modal">
    <h2>Save Project</h2>
    <p><b>Save to my site</b> stores it in your account so you can access it from any device.</p>
    <button class="save-target" data-target="wix"><strong>☁ Save to my Wix site</strong><small>Stores to indalkp.com with a shareable link.</small></button>
    <button class="save-target" data-target="local-kpz"><strong>💾 Download .kpz file</strong><small>Editable project, all layers preserved.</small></button>
    <button class="save-target" data-target="local-psd"><strong>🎨 Export .psd (Photoshop)</strong><small>Open in Photoshop, Krita, Clip Studio, or Photopea.</small></button>
    <button class="save-target" data-target="local-png"><strong>🖼 Export .png</strong><small>Flattened image. Best for sharing/posting.</small></button>
    <!--
      v3.9.13: animatic export. Records the panel sequence at the chosen
      FPS into a WebM video, captions burned at the bottom of each frame.
      Disabled inline for 1-panel projects; doSave handles the actual gating.
    -->
    <button class="save-target" data-target="local-webm"><strong>🎬 Export animatic (.webm)</strong><small>Plays your panels at the chosen FPS, captions baked in. Share your storyboard as a video.</small></button>
    <div class="modal-actions"><button class="btn" id="saveCancel">Cancel</button></div>
  </div>
</div>

<input type="file" id="fileInput">
<input type="file" id="refFileInput" multiple accept="image/*">
<input type="file" id="refImportInput" accept="application/json">
<div id="toast"></div>

<!-- v3.6.1: Reference Library modal -->
<div class="modal-bg" id="refLibraryModal">
  <div class="modal lib-modal">
    <div class="lib-header">
      <button class="btn icon-btn" id="refLibraryBack" title="Back to list" style="display:none">‹</button>
      <h2 id="refLibraryTitle">Reference Library</h2>
      <button class="btn icon-btn" id="refLibraryClose" title="Close">✕</button>
    </div>
    <div class="lib-body">
      <div id="refLibraryBuckets"></div>
      <div id="refLibraryRefs" style="display:none"></div>
    </div>
    <div class="lib-footer">
      <button class="btn" id="refLibrarySelectAll" style="display:none">Select all</button>
      <button class="btn danger" id="refLibraryDelete" style="display:none" title="Remove this set from the library">🗑 Delete set</button>
      <div style="flex:1"></div>
      <button class="btn" id="refLibraryCancel">Cancel</button>
      <button class="btn primary" id="refLibraryImport" style="display:none" disabled>Select refs to import</button>
    </div>
  </div>
</div>

<!-- v3.6.2: Confirm-leave modal (asks before discarding unsaved changes) -->
<div class="modal-bg" id="confirmLeaveModal">
  <div class="modal">
    <h2>Unsaved changes</h2>
    <p id="confirmLeaveMsg">You have unsaved changes in this project. What would you like to do before leaving?</p>
    <div class="modal-actions" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
      <button class="btn" id="clCancel">Cancel</button>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn danger" id="clDiscard">Discard &amp; go</button>
        <button class="btn primary" id="clSave">Save &amp; go</button>
      </div>
    </div>
  </div>
</div>

<!-- v3.6.2: Stale-write modal (another tab/session updated this project) -->
<div class="modal-bg" id="staleWriteModal">
  <div class="modal">
    <h2>Project updated elsewhere</h2>
    <p id="staleWriteMsg">This project was updated in another tab, window, or device since you opened it. Saving now would overwrite those changes.</p>
    <div class="modal-actions" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
      <button class="btn" id="swCancel">Keep working (don't save)</button>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" id="swReload">Reload latest (lose my changes)</button>
        <button class="btn danger" id="swOverwrite">Overwrite anyway</button>
      </div>
    </div>
  </div>
</div>
`;
}
