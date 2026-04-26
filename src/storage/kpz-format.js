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
// v3.9.21: bundle per-panel audio into the .kpz so projects round-trip
// across devices. getPanelAudio reads on serialize, setPanelAudio writes
// on deserialize.
import { getPanelAudio, setPanelAudio } from './panel-audio.js';

/**
 * Serialize the current project to a .kpz Blob.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.excludeAudio=false]
 *        When true, skip bundling audio bytes (audioBundleCount=0). Per-panel
 *        meta still carries audioId + audioDuration so the project structure
 *        round-trips, but the audio is NOT in the saved blob. Used by the
 *        v3.10.1 cloud-save oversize fallback so a project that's too big for
 *        Wix's request limit can still cloud-save its drawings + structure;
 *        the audio bytes stay only in IDB on the local device.
 *        For local .kpz downloads the default (false) is correct — we want
 *        audio bundled so projects round-trip across devices.
 */
export async function serializeKpz(opts = {}) {
  const excludeAudio = !!opts.excludeAudio;
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
      // v3.9.17: persist audioId reference. The audio bytes themselves
      // live in IndexedDB (storage/panel-audio.js), keyed by this id —
      // the .kpz only carries the reference so projects round-trip
      // small. Older .kpz files have no audioId; defaults to null on
      // load. NOTE: opening a .kpz on a different device WON'T have
      // the audio in IDB, so the audio button shows attached but
      // playback silently no-ops. v3.9.18+ can either embed audio in
      // .kpz or sync via Wix file storage.
      audioId: p.audioId || null,
      // v3.9.19: cached audio duration (seconds). Used by the playback
      // scheduler so audio-bearing panels hold for their full clip
      // length. Defaults to 0 = "use FPS timing" on older files.
      audioDuration: typeof p.audioDuration === 'number' ? p.audioDuration : 0,
      // v3.9.25: optional manual hold duration (seconds). Older .kpz files
      // have no duration field; defaults to 0 (= "auto") on load.
      duration: typeof p.duration === 'number' ? p.duration : 0,
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

  // v3.9.21: collect per-panel audio Blobs so they ride along with the .kpz.
  // The reference (audioId + audioDuration) is already in the per-panel meta.
  // We append the audio bytes after the layer-PNG section, length-prefixed
  // with a per-entry header [audioId len + audioId + blob len + blob bytes].
  // Older readers stop after the layer iteration — they just see the audio
  // section as trailing bytes they ignore. The new audioBundleCount sentinel
  // in `meta` tells new readers how many entries to read back.
  const audioEntries = [];
  // v3.10.1: optional audio-skip path. excludeAudio=true means we still
  // record per-panel audioId/audioDuration in meta (so the structure
  // round-trips), but no audio bytes are bundled. audioBundleCount=0.
  if (!excludeAudio) {
    for (const panel of App.project.panels) {
      if (!panel.audioId) continue;
      try {
        const blob = await getPanelAudio(panel.audioId);
        if (blob && blob.size > 0) {
          audioEntries.push({
            audioId: panel.audioId,
            mime: blob.type || 'audio/webm',
            buf: new Uint8Array(await blob.arrayBuffer()),
          });
        }
      } catch (err) {
        console.warn('serialize: failed to read audio for panel', panel.audioId, err);
      }
    }
  }
  meta.audioBundleCount = audioEntries.length;

  const jsonBytes = enc.encode(JSON.stringify(meta));
  // Header (8) + json + per-layer (4 + blob) + per-audio (4 + idLen + 4 + mimeLen + 4 + blobLen)
  let total = 4 + 4 + jsonBytes.length;
  const blobBufs = [];
  for (const b of blobs) {
    const buf = new Uint8Array(await b.arrayBuffer());
    blobBufs.push(buf); total += 4 + buf.length;
  }
  // v3.9.21: pre-encode audio metadata strings + sum into total
  const audioEncoded = audioEntries.map(e => ({
    idBytes: enc.encode(e.audioId),
    mimeBytes: enc.encode(e.mime),
    buf: e.buf,
  }));
  for (const a of audioEncoded) {
    total += 4 + a.idBytes.length + 4 + a.mimeBytes.length + 4 + a.buf.length;
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
  // v3.9.21: append audio entries — each one length-prefixed independently.
  for (const a of audioEncoded) {
    dv.setUint32(off, a.idBytes.length, true);   off += 4;
    out.set(a.idBytes, off);                      off += a.idBytes.length;
    dv.setUint32(off, a.mimeBytes.length, true); off += 4;
    out.set(a.mimeBytes, off);                    off += a.mimeBytes.length;
    dv.setUint32(off, a.buf.length, true);       off += 4;
    out.set(a.buf, off);                          off += a.buf.length;
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
      // v3.9.17: audioId is optional. null when absent or when loading
      // an older .kpz file. The actual audio Blob is looked up from IDB
      // by topbar.js's playback path.
      audioId: typeof pmeta.audioId === 'string' ? pmeta.audioId : null,
      // v3.9.19: cached audio duration in seconds. Older .kpz files have no
      // audioDuration field and default to 0 (= use FPS timing).
      audioDuration: typeof pmeta.audioDuration === 'number' ? pmeta.audioDuration : 0,
      // v3.9.25: manual duration override. Older files default to 0 (auto).
      duration: typeof pmeta.duration === 'number' ? pmeta.duration : 0,
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

  // v3.9.21: if this .kpz carries bundled audio, restore the Blobs into IDB
  // so playback + export find them under the same audioIds. Older files
  // have no audioBundleCount — skip the read entirely. New files always
  // write the count even when zero (the loop below is a no-op then).
  const audioCount = (typeof meta.audioBundleCount === 'number') ? meta.audioBundleCount : 0;
  for (let i = 0; i < audioCount; i++) {
    if (off + 4 > buf.length) break; // defensive — truncated file
    const idLen = dv.getUint32(off, true); off += 4;
    if (off + idLen > buf.length) break;
    const audioId = dec.decode(buf.slice(off, off + idLen)); off += idLen;
    if (off + 4 > buf.length) break;
    const mimeLen = dv.getUint32(off, true); off += 4;
    if (off + mimeLen > buf.length) break;
    const mime = dec.decode(buf.slice(off, off + mimeLen)); off += mimeLen;
    if (off + 4 > buf.length) break;
    const blen = dv.getUint32(off, true); off += 4;
    if (off + blen > buf.length) break;
    const audioBlob = new Blob([buf.slice(off, off + blen)], { type: mime || 'audio/webm' });
    off += blen;
    try {
      await setPanelAudio(audioId, audioBlob);
    } catch (err) {
      console.warn('deserialize: failed to restore audio for', audioId, err);
    }
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
