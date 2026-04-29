# KPZ Draw

> A browser drawing app built inside Wix. WebGL2 brush rasterizer, three-cache layer compositing, DPR-aware Retina rendering, Procreate-style line stabilization, Velo backend for save/load.

**Live**: [indalkp.com/draw](https://www.indalkp.com/draw)
**Source**: this repo · **Releases**: [tags](https://github.com/indalkp/kpz-draw/tags) (v3.19.0 latest) · **Built by**: [Indal KP](https://www.indalkp.com)

---

## What this is

I'm a creative technologist. I make animation, illustration, and writing — and I build the tools I need when nothing on the market fits.

KPZ Draw is one of those tools. It runs as a custom HTML embed inside my Wix site, talks to a Velo backend, and stores work in the Wix CMS. Members log in, draw, and save projects to the cloud. The whole pipeline — UI engine, rendering, backend, deployment — is an honest, working demonstration of what's possible when you treat Wix as a real platform instead of a brochure-site builder.

Seventy tagged production releases (v3.5.0 → v3.19.0). Every commit message is a real engineering decision log.

## Architecture at a glance

```
indalkp.com/draw  (Wix page)
  └── HTML Embed element
        └── bootstrap-embed.html  ──→  jsDelivr CDN @ git tag
              └── ES modules (src/main.js + src/drawing/* + src/core/*)
                    ├── postMessage RPC ──→  Velo Page Code (auth, navigation)
                    │                          └── Velo backend web modules
                    │                                └── Wix CMS (DrawingProjects)
                    │                                └── Wix Media Manager (refs, exports)
                    └── WebGL2 + Canvas 2D rendering pipeline
```

This same architectural pattern — custom embed + Velo backend + Wix CMS, deployed via jsDelivr — is what I now build for clients on Upwork.

## Engineering highlights

Each release ships isolated, tagged, and reversible. Some of the bigger architectural moves:

- **v3.19.0 — Stroke buffer at native screen resolution**. Active strokes rasterize at `project × devicePixelRatio` so in-progress lines render at native device pixels. Visibly crisper on Retina iPad (DPR=2), HiDPI Wacom-on-PC, and any device past 1× pixel ratio.
- **v3.18.1 — Apple Pencil lift-off pressure clamp**. Apple Pencil firmware briefly reports a high pressure value as the pen leaves the screen. Caps the tail-segment's end-pressure against the average of the previous 4 raw samples; kills the spike without affecting deliberate pressure swells.
- **v3.18.0 — Per-stylus pressure curve calibration**. User-facing slider remaps pressure response: soft (0.25 exponent), linear (1.0), firm (4.0). Skipped entirely at the linear default so existing users see no extra cost.
- **v3.17.0 — WebGL2 brush rasterizer**. Instanced textured-quad stamps on the GPU. Vertex shader: per-instance (x, y, size, alpha). Fragment shader: alpha mask × stroke color. Batches up to 4096 stamps in one `drawArraysInstanced` call. Falls back transparently to Canvas 2D when WebGL2 isn't available.
- **v3.16.0 — Procreate-style line stabilization**. "Lazy mouse" position lag with a Streamline-equivalent slider. App.lazyPos chases the One-Euro-smoothed cursor with `alpha = 1 - stab × 0.95`. Use case: ink line work, calligraphy, deliberate slow strokes.
- **v3.15.0 — Pre-rendered brush tip cache**. Per-stamp gradient build → single textured blit. Browsers hardware-accelerate canvas-to-canvas drawImage via the GPU compositor; per-stamp cost drops to one cached drawImage with destination scaling for size.
- **v3.14.1 — DPR-aware display canvas**. Display canvas internal buffer sized at `project × DPR`; CSS size stays at project dimensions so the browser shrinks back to native device pixels — crisp 1:1 device-pixel rendering on Retina/HiDPI without changing project resolution.
- **v3.14.0 — Three-cache layer compositing**. At `startStroke`, pre-composite all layers below the active one into `staticBelowCache` and all layers above into `staticAboveCache`. During the stroke, render with 4-5 fixed `drawImage` calls regardless of layer count — versus the previous `O(n)` per-frame cost.
- **v3.13.3 — Cheap gap-bridge replaces O(n²) re-rasterize**. When pointer events report a suspicious gap, bridge with a straight-line segment instead of replaying every stored sample. O(1) per call, visually indistinguishable at normal zoom.
- **v3.5.4 — Reference image auto-compression**. Phone photos (20 MB+) compress to 300-500 KB on upload at 1600 px long edge / JPEG quality 0.85. No visible quality loss at reference-viewer size, save uploads complete within timeout.

For the full release history: [github.com/indalkp/kpz-draw/tags](https://github.com/indalkp/kpz-draw/tags).

## Tech stack

| Layer | Stack |
|-------|-------|
| Frontend | ES6 modules · Canvas 2D · WebGL2 · vanilla JS (no framework) |
| Wix integration | HTML Embed element · postMessage RPC · jsDelivr CDN pinned to git tags |
| Backend | Velo web modules · Velo HTTP functions |
| Data | Wix CMS Collections · Wix Media Manager |
| Deployment | git tag → jsDelivr cache → `KPZ_VERSION` in Velo Page Code (Draw.w52ay.js, indalkp-wix repo) |

## Deployment pipeline

```
git push origin main                                   →  GitHub
git push origin v3.X.Y                                 →  tag visible on GitHub
                                                       →  jsDelivr CDN caches tag (~2 min)
edit KPZ_VERSION in Draw.w52ay.js (indalkp-wix repo)   →  push, run `wix publish --source remote -y`
                                                       →  live on indalkp.com/draw (~10s)
```

The HTML Embed (`bootstrap-embed.html`) was pasted into the Wix Editor once and never touched again. At runtime it asks the parent Wix page over postMessage for the pinned version, and Velo's `KPZ_VERSION` constant is the single source of truth. Falls back to `@main` if Velo doesn't reply within 5 seconds.

Every release is rollback-safe: edit `KPZ_VERSION` to a previous tag (e.g. `'v3.18.1'`), `wix publish`, and the older tag is already cached on jsDelivr.

## Repo layout

```
kpz-draw/
├── src/
│   ├── main.js                  ← entry point
│   ├── core/                    ← DOM, events, app state
│   ├── drawing/                 ← brush, canvas, view, layers, gl-brush
│   ├── ui/                      ← panels, toolbars, inputs
│   └── data/                    ← project save/load, ref handling
├── bootstrap-embed.html         ← pasted into the Wix HTML Embed
└── README.md
```

## Built by Indal KP

I'm a solo creative technologist in India. Animation, illustration, writing, and tools/automation are my four crafts. I build inside Wix because that's where my own platform lives — and because most clients underestimate what Wix can do until they see it.

If you're hitting the wall of "the Wix Editor can't do this," I take over from there. Custom HTML/JS embeds, Velo backend code, Wix CMS architecture, real engineering inside the platform.

- **Site**: [indalkp.com](https://www.indalkp.com)
- **Email**: [indalkp@gmail.com](mailto:indalkp@gmail.com)
- **Studio**: Kpz_Art

## License

Source visible for transparency and portfolio purposes. Not yet under a permissive license — please reach out if you want to use parts of it.

---

*"I build the things the Wix Editor can't."*
# KPZ Draw

> A browser drawing app built inside Wix. WebGL2 brush rasterizer, three-cache layer compositing, DPR-aware Retina rendering, Procreate-style line stabilization, Velo backend for save/load.

**Live**: [indalkp.com/draw](https://www.indalkp.com/draw)
**Source**: this repo · **Releases**: [v3.19.0 latest](https://github.com/indalkp/kpz-draw/releases) · **Built by**: [Indal KP](https://www.indalkp.com)

---

## What this is

I'm a creative technologist. I make animation, illustration, and writing — and I build the tools I need when nothing on the market fits.

KPZ Draw is one of those tools. It runs as a custom HTML embed inside my Wix site, talks to a Velo backend, and stores work in the Wix CMS. Members log in, draw, and save projects to the cloud. The whole pipeline — UI engine, rendering, backend, deployment — is an honest, working demonstration of what's possible when you treat Wix as a real platform instead of a brochure-site builder.

Nineteen tagged production releases. Every commit message is a real engineering decision log.

## Architecture at a glance

```
indalkp.com/draw  (Wix page)
  └── HTML Embed element
        └── bootstrap-embed.html  ──→  jsDelivr CDN @ git tag
              └── ES modules (src/main.js + src/drawing/* + src/core/*)
                    ├── postMessage RPC ──→  Velo Page Code (auth, navigation)
                    │                          └── Velo backend web modules
                    │                                └── Wix CMS (DrawingProjects)
                    │                                └── Wix Media Manager (refs, exports)
                    └── WebGL2 + Canvas 2D rendering pipeline
```

This same architectural pattern — custom embed + Velo backend + Wix CMS, deployed via jsDelivr — is what I now build for clients on Upwork.

## Engineering highlights

Each release ships isolated, tagged, and reversible. Some of the bigger architectural moves:

- **v3.19.0 — Stroke buffer at native screen resolution**. Active strokes rasterize at `project × devicePixelRatio` so in-progress lines render at native device pixels. Visibly crisper on Retina iPad (DPR=2), HiDPI Wacom-on-PC, and any device past 1× pixel ratio.
- **v3.18.1 — Apple Pencil lift-off pressure clamp**. Apple Pencil firmware briefly reports a high pressure value as the pen leaves the screen. Caps the tail-segment's end-pressure against the average of the previous 4 raw samples; kills the spike without affecting deliberate pressure swells.
- **v3.18.0 — Per-stylus pressure curve calibration**. User-facing slider remaps pressure response: soft (0.25 exponent), linear (1.0), firm (4.0). Skipped entirely at the linear default so existing users see no extra cost.
- **v3.17.0 — WebGL2 brush rasterizer**. Instanced textured-quad stamps on the GPU. Vertex shader: per-instance (x, y, size, alpha). Fragment shader: alpha mask × stroke color. Batches up to 4096 stamps in one `drawArraysInstanced` call. Falls back transparently to Canvas 2D when WebGL2 isn't available.
- **v3.16.0 — Procreate-style line stabilization**. "Lazy mouse" position lag with a Streamline-equivalent slider. App.lazyPos chases the One-Euro-smoothed cursor with `alpha = 1 - stab × 0.95`. Use case: ink line work, calligraphy, deliberate slow strokes.
- **v3.15.0 — Pre-rendered brush tip cache**. Per-stamp gradient build → single textured blit. Browsers hardware-accelerate canvas-to-canvas drawImage via the GPU compositor; per-stamp cost drops to one cached drawImage with destination scaling for size.
- **v3.14.1 — DPR-aware display canvas**. Display canvas internal buffer sized at `project × DPR`; CSS size stays at project dimensions so the browser shrinks back to native device pixels — crisp 1:1 device-pixel rendering on Retina/HiDPI without changing project resolution.
- **v3.14.0 — Three-cache layer compositing**. At `startStroke`, pre-composite all layers below the active one into `staticBelowCache` and all layers above into `staticAboveCache`. During the stroke, render with 4-5 fixed `drawImage` calls regardless of layer count — versus the previous `O(n)` per-frame cost.
- **v3.13.3 — Cheap gap-bridge replaces O(n²) re-rasterize**. When pointer events report a suspicious gap, bridge with a straight-line segment instead of replaying every stored sample. O(1) per call, visually indistinguishable at normal zoom.
- **v3.5.4 — Reference image auto-compression**. Phone photos (20 MB+) compress to 300-500 KB on upload at 1600 px long edge / JPEG quality 0.85. No visible quality loss at reference-viewer size, save uploads complete within timeout.

For the full release notes: [github.com/indalkp/kpz-draw/releases](https://github.com/indalkp/kpz-draw/releases)

## Tech stack

| Layer | Stack |
|-------|-------|
| Frontend | ES6 modules · Canvas 2D · WebGL2 · vanilla JS (no framework) |
| Wix integration | HTML Embed element · postMessage RPC · jsDelivr CDN pinned to git tags |
| Backend | Velo web modules · Velo HTTP functions |
| Data | Wix CMS Collections · Wix Media Manager |
| Deployment | git tag → jsDelivr cache → `VERSION` constant in HTML embed |

## Deployment pipeline

```
git push origin main                  →  GitHub
git push origin v3.X.Y                →  tag visible on GitHub
                                      →  jsDelivr CDN caches tag (~2 min)
update VERSION in bootstrap-embed.html →  paste into Wix HTML Embed
publish in Wix Editor                 →  live on indalkp.com/draw
```

Every release is rollback-safe: revert the `VERSION` constant in the Wix embed and the previous tag is still cached on jsDelivr.

## Repo layout

```
kpz-draw/
├── src/
│   ├── main.js                  ← entry point
│   ├── core/                    ← DOM, events, app state
│   ├── drawing/                 ← brush, canvas, view, layers, gl-brush
│   ├── ui/                      ← panels, toolbars, inputs
│   └── data/                    ← project save/load, ref handling
├── bootstrap-embed.html         ← pasted into the Wix HTML Embed
└── README.md
```

## Built by Indal KP

I'm a solo creative technologist in India. Animation, illustration, writing, and tools/automation are my four crafts. I build inside Wix because that's where my own platform lives — and because most clients underestimate what Wix can do until they see it.

If you're hitting the wall of "the Wix Editor can't do this," I take over from there. Custom HTML/JS embeds, Velo backend code, Wix CMS architecture, real engineering inside the platform.

- **Site**: [indalkp.com](https://www.indalkp.com)
- **Email**: [indalkp@gmail.com](mailto:indalkp@gmail.com)
- **Studio**: Kpz_Art

## License

Source visible for transparency and portfolio purposes. Not yet under a permissive license — please reach out if you want to use parts of it.

---

*"I build the things the Wix Editor can't."*
