# V3-COMING-SOON.md

Items prescribed by the v3 design (kpz-draw-design PR #1) that did NOT ship in
`v4.0.0-rc.1`. Each entry includes the wireframe source file, scope, and a
rough estimate of the work to land it.

---

## 1. Layer groups + blend modes + opacity + mask + clip

- **Source:** `wireframes-v3-rightpanel.jsx` (`Layers` panel, `BlendDropdown`)
- **Current state in kpz-draw:** `src/ui/layers-panel.js` (104 lines, flat list);
  `src/drawing/layers.js` (20 lines, no blend modes); blend handled implicitly
  in `canvas.js` via globalCompositeOperation only on a stroke-by-stroke basis.
- **What's needed:**
  - UI: nested groups, blend dropdown (Normal / Multiply / Screen / Overlay /
    etc., grouped by category as in the wireframe), opacity slider per layer,
    mask + clip toggles, drag-to-reorder.
  - Engine: `Layer.blend` field + `Layer.opacity` honored by the
    three-cache compositor in `canvas.js` (the `staticBelowCache` /
    `staticAboveCache` machinery from v3.14.0). Group support means a layer's
    composite op is applied once per group, not per child.
- **Estimate:** 400–600 lines UI, 100–200 lines compositor changes. ~2–3 days.

---

## 2. Unified anim bar

- **Source:** `wireframes-v3-anim.jsx` (`UnifiedAnimBar`)
- **Current state:** undo/redo, brush chip, play/fps, onion are scattered
  across multiple `tb-group` divs in `#topbar` (see `src/core/dom.js`).
- **What's needed:** consolidate into a single ~46 px row beneath the canvas
  with: undo/redo · brush chip · transport · frame counter · fps · onion-mode
  popover · ⋯ more menu (export GIF/PNG/MP4, tween, reverse, clear). Each
  control's existing handler in `topbar.js` rewired into the new bar's IDs.
  Keyboard shortcuts (`P`, `O`, etc.) preserved via existing `events.js`.
- **Estimate:** ~250 lines new module + dom.js patch + ~20 sed-equivalent
  tweaks across topbar.js. ~1 day.

---

## 3. Vertical collapsible tool rail

- **Source:** `wireframes-v3-tier1.jsx` (`ToolRail`), `wireframes-v3.jsx`
- **Current state:** `src/ui/toolrail.js` (56 lines, thin slot).
- **What's needed:** vertical rail with tool buttons (brush, eraser, fill,
  picker, lasso, transform, etc.), `»` expand to reveal tool labels, `«`
  collapse. Script-mode swap (the rail switches to script tools per
  `wireframes-v3-rightpanel.jsx` ScriptToolRail).
- **Estimate:** ~300 lines + dom.js layout shift. ~1 day.

---

## 4. Brush popover tabs (Pressure, Presets)

- **Source:** `wireframes-v3-brush.jsx` (`BrushPopover` with `TABS`)
- **Current state:** brush popover exists in `src/ui/brush-panel.js`, single
  view (color + size).
- **What's needed:**
  - Pressure tab: slider hooked into `App.pressureCurve` (already exists since
    v3.18.0 — soft 0.25 / linear 1.0 / firm 4.0).
  - Presets tab: named-preset list with localStorage persistence.
- **Estimate:** ~150 lines. ~half-day.

---

## 5. Reference Library — cross-project

- **Source:** `wireframes-v3-tier1.jsx` (`RefLibrary`)
- **Current state:** `src/ui/library-modal.js` lists refs for the open project.
- **What's needed:** new Velo backend method `listAllProjectRefs()` returning
  refs from all the user's projects with project ID/name attribution. Frontend
  filter by project + drag-to-current-project import.
- **Estimate:** ~80 lines frontend + Velo backend addition. ~half-day.

---

## 6. Strip mode — per-panel inline voice-over

- **Source:** `wireframes-v3-tier1.jsx` (`StripView`)
- **Current state:** `src/ui/strip-mode.js` (360 lines) renders the vertical
  comic view but without inline audio controls per row.
- **What's needed:** record / upload / duration UI on each panel row, sharing
  state with the existing per-panel `panel-audio.js`.
- **Estimate:** ~120 lines. ~half-day.

---

## 7. Mobile edge-peek tabs (refs / layers)

- **Source:** `wireframes-mobile-issues.jsx` (edge-peek tabs)
- **Current state:** rc.1 ships the 5-button bottom dock. Edge-peek tabs are
  separate.
- **What's needed:** ▶ refs and layers ◀ tabs anchored to viewport edges with
  swipe-to-open drawer animation. Touch gesture handler (already partial in
  `mobile-chrome.js`).
- **Estimate:** ~150 lines. ~half-day.

---

## 8. Cast & References — master zoom slider

- **Source:** `wireframes-v3-refs.jsx`
- **Current state:** `src/ui/cast-panel.js` and `src/ui/references.js` both
  have per-card sizing approximating the wireframe's intent. Master slider
  (single source of truth for `--ref-tile-h`) not yet implemented.
- **What's needed:** single slider in the sidebar header that drives the CSS
  variable for the whole panel. Per-card sliders removed.
- **Estimate:** ~60 lines. ~2–3 hours.

---

## Total deferred scope

~6–8 engineering days. Recommended sequencing for v4.1.0:
1. Unified anim bar (high visibility, low risk)
2. Layer groups + blend modes (engine-heavy, schedule isolated)
3. Brush popover tabs (small)
4. Vertical tool rail
5. Mobile edge-peek tabs
6. Cast & References master zoom
7. Strip mode per-panel audio
8. Cross-project Library (last — depends on Velo backend extension)
