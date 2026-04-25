// src/storage/kpz-format.js
// KPZ binary format: serialize/deserialize project to a single Blob.
// Format: "KPZ2" magic + uint32 jsonLen + JSON meta + per-layer PNG blobs.

import { App } from '../core/state.js';
import { createProject, createPanel } from '../drawing/panels.js';
import { createLayer } from '../drawing/layers.js';
import { fitView, renderDisplay } from '../drawing/view.js';
import { renderLayersUI } from '../ui/layers-panel.js';
import { renderPanelNav } from '../ui/panel-nav.js';
import { renderRefs, persistRefs } from '../ui/references.js';
// v3.9.0: re-render the Cast tab after loading a project so character cards
// pick up any IDB-persisted characters for the new project key.
import { renderCast } from '../ui/cast-panel.js';
import { restorePersistentCharacters } from './persistent-refs.js';
// v3.9.11: sync the caption strip after loading a project so the input
// reflects the active panel's caption (which was just deserialized).
import { syncCaptionInput } from '../ui/panel-nav.js';
import { updateSaveStatus } from '../ui/topbar.js';
import { toast } from '../ui/toast.js';

export async function serializeKpz() {
  const meta = {
    name: App.project.name, width: App.project.width, height: App.project.height,
    version: 3,
    strokeCount: App.strokeCount || 0,
    refs: App.project.refs,
    panels: App.project.panels.map(p => ({
      activeLayer: p.activeLayer,
      // v3.9.11: persist caption alongside layers. Additive field —
      // older .kpz files don't carry it; deserializeKpz defaults to
      // empty string if absent (see below), so backward compatibility
      // is preserved.
      caption: p.caption || '',
      layers: p.layers.map(l => ({
        id: l.id, name: l.name, visible: l.visible,
        opacity: l.opacity, blend: l.blend, locked: !!l.locked,
      })),
    })),
  };
  const blobs = [];
  for (const panel of App.project.panels) {
    for (const layer of panel.layers) {
      blobs.push(await new Promise(r => layer.canvas.toBlob(r, 'image/png')));
    }
  }
  const enc = new TextEncoder();
  const jsonBytes = enc.encode(JSON.stringify(meta));
  let total = 4 + 4 + jsonBytes.length;
  const blobBufs = [];
  for (const b of blobs) {
    const buf = new Uint8Array(await b.arrayBuffer());
    blobBufs.push(buf); total += 4 + buf.length;
  }
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let off = 0;
  out.set(enc.encode('KPZ2'), off); off += 4;
  dv.setUint32(off, jsonBytes.length, true); off += 4;
  out.set(jsonBytes, off); off += jsonBytes.length;
  for (const buf of blobBufs) {
    dv.setUint32(off, buf.length, true); off += 4;
    out.set(buf, off); off += buf.length;
  }
  return new Blob([out], { type: 'application/octet-stream' });
}

export async function deserializeKpz(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const dec = new TextDecoder();
  let off = 0;
  if (dec.decode(buf.slice(0, 4)) !== 'KPZ2') throw new Error('Not a KPZ2 file');
  off += 4;
  const jsonLen = dv.getUint32(off, true); off += 4;
  const meta = JSON.parse(dec.decode(buf.slice(off, off + jsonLen)));
  off += jsonLen;

  const project = createProject(meta.name, meta.width, meta.height);
  project.refs = meta.refs || [];
  project.strokeCount = meta.strokeCount || 0;
  project.panels = [];
  for (const pmeta of meta.panels) {
    // v3.9.11: caption restored if present, default empty for older .kpz files.
    const panel = {
      activeLayer: pmeta.activeLayer || 0,
      caption: typeof pmeta.caption === 'string' ? pmeta.caption : '',
      layers: [],
    };
    for (const lmeta of pmeta.layers) {
      const blen = dv.getUint32(off, true); off += 4;
      const pngBuf = buf.slice(off, off + blen); off += blen;
      const url = URL.createObjectURL(new Blob([pngBuf], { type: 'image/png' }));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const c = document.createElement('canvas');
      c.width = meta.width; c.height = meta.height;
      c.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      panel.layers.push({
        id: lmeta.id, name: lmeta.name, canvas: c,
        visible: lmeta.visible !== false, opacity: lmeta.opacity ?? 1,
        blend: lmeta.blend || 'source-over', locked: !!lmeta.locked,
      });
    }
    project.panels.push(panel);
  }
  return project;
}

export async function loadKpzBlob(blob) {
  try {
    const project = await deserializeKpz(blob);
    App.project = project;
    App.strokeCount = project.strokeCount || 0;
    App.activePanelIdx = 0;
    App.history = []; App.historyIdx = [];
    const disp = document.getElementById('displayCanvas');
    if (disp) { disp.width = project.width; disp.height = project.height; }
    fitView(); renderDisplay(); renderLayersUI(); renderPanelNav(); renderRefs();
    // v3.6.1: persist loaded refs into the current project's bucket so they
    // show up in the library next time.
    persistRefs();
    // v3.9.0: load characters for this project from IDB, then render Cast.
    // The .kpz file itself doesn't carry characters in v3.9.0 (bundling
    // rule — save/load format change is isolated to a later release), so
    // characters for the loaded project come purely from IDB by project key.
    await restorePersistentCharacters();
    renderCast();
    // v3.9.11: caption strip reflects the loaded panel's caption.
    syncCaptionInput();
    App.dirty = false; updateSaveStatus();
    toast('Project loaded', 'ok');
  } catch (err) { toast('Load failed: ' + err.message, 'error'); }
}

export async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
