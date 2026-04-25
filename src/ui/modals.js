// src/ui/modals.js
// New project, Save, and Open file modal dialogs.

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';
import { createProject } from '../drawing/panels.js';
import { renderDisplay, fitView, drawCaptionSubtitle } from '../drawing/view.js';
// v3.9.19: shared scheduling helper so playback + export agree on per-panel
// hold duration (audio length wins, with 1/fps as the floor).
import { computePanelHoldMs } from './topbar.js';
import { renderLayersUI } from './layers-panel.js';
import { renderPanelNav } from './panel-nav.js';
import { renderRefs } from './references.js';
// v3.9.0: re-render Cast on new project so the empty state shows for the
// freshly-created project (which has characters: [] from createProject).
import { renderCast } from './cast-panel.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';
import { serializeKpz, loadKpzBlob } from '../storage/kpz-format.js';
import { downloadBlob } from '../storage/kpz-format.js';
import { exportPsdBlob } from '../storage/psd-export.js';
import { saveToWix } from '../storage/wix-bridge.js';
import { createLayer } from '../drawing/layers.js';
import { pushHistory } from '../drawing/history.js';
import { curPanel } from '../drawing/panels.js';

export function initModals() {
  // New modal
  $('newCancel')?.addEventListener('click', () => $('newModal')?.classList.remove('open'));
  $('newCreate')?.addEventListener('click', createNewProject);
  $('newPreset')?.addEventListener('change', e => {
    if (e.target.value === 'custom') return;
    const [w, h] = e.target.value.split('x');
    if ($('newW')) $('newW').value = w;
    if ($('newH')) $('newH').value = h;
  });

  // Save modal
  $('saveCancel')?.addEventListener('click', () => $('saveModal')?.classList.remove('open'));
  $$('.save-target').forEach(b => b.addEventListener('click', () => doSave(b.dataset.target)));

  // File input
  $('fileInput')?.addEventListener('change', handleFileOpen);
}

function createNewProject() {
  const name = $('newName')?.value || 'Untitled';
  const w = parseInt($('newW')?.value) || 1280;
  const h = parseInt($('newH')?.value) || 720;
  App.project = createProject(name, w, h);
  App.activePanelIdx = 0;
  App.history = []; App.historyIdx = [];
  App.currentProjectId = null;
  const disp = $('displayCanvas');
  if (disp) { disp.width = w; disp.height = h; }
  fitView();
  renderDisplay(); renderLayersUI(); renderPanelNav(); renderRefs(); renderCast();
  App.dirty = false; updateSaveStatus();
  $('newModal')?.classList.remove('open');
}

async function doSave(target) {
  $('saveModal')?.classList.remove('open');

  if (target === 'local-kpz') {
    const blob = await serializeKpz();
    await downloadBlob(blob, (App.project.name || 'untitled') + '.kpz');
    App.dirty = false; updateSaveStatus();
    toast('Saved .kpz file', 'ok');
    return;
  }
  if (target === 'local-psd') {
    try {
      const blob = exportPsdBlob();
      await downloadBlob(blob, (App.project.name || 'untitled') + '.psd');
      toast('PSD exported', 'ok');
    } catch (err) {
      toast('PSD export failed: ' + err.message, 'error');
      console.error(err);
    }
    return;
  }
  if (target === 'local-png') {
    const disp = $('displayCanvas');
    const blob = await new Promise(res => disp.toBlob(res, 'image/png'));
    await downloadBlob(blob, (App.project.name || 'untitled') + '.png');
    toast('PNG exported', 'ok');
    return;
  }
  if (target === 'local-webm') {
    // v3.9.13: animatic export
    await exportAnimaticWebm();
    return;
  }
  if (target === 'local-comic-strip') {
    // v3.9.15: comic-strip PNG export
    await exportComicStripPng();
    return;
  }
  if (target === 'wix') {
    if (!App.inWix) { toast('Open this app on indalkp.com/draw to save to your site', 'error'); return; }
    await saveToWix();
    return;
  }
}

async function handleFileOpen(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (f.name.endsWith('.kpz')) {
    await loadKpzBlob(f);
  } else if (f.type.startsWith('image/')) {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      pushHistory();
      const layer = createLayer(App.project.width, App.project.height, f.name);
      const ctx = layer.canvas.getContext('2d');
      const r = Math.min(App.project.width / img.width, App.project.height / img.height);
      const w = img.width * r, h = img.height * r;
      ctx.drawImage(img, (App.project.width - w) / 2, (App.project.height - h) / 2, w, h);
      curPanel().layers.push(layer);
      curPanel().activeLayer = curPanel().layers.length - 1;
      renderLayersUI(); renderDisplay();
      URL.revokeObjectURL(url);
      App.dirty = true; updateSaveStatus();
    };
    img.src = url;
  }
  e.target.value = '';
}


// ===========================================================================
// v3.9.13: animatic export. Renders each panel onto an offscreen canvas
// (with caption burned in at the bottom), captures the canvas as a video
// stream via captureStream(), records to WebM via MediaRecorder, downloads
// the resulting blob.
//
// Why WebM, not MP4: MediaRecorder produces WebM natively in every modern
// browser. MP4 in-browser would require a WASM ffmpeg shim (~30MB). WebM
// plays in browsers, Discord, Twitter, OBS, VLC. For QuickTime / iMessage,
// users can convert with cloudconvert.com or similar (one-time, free).
// ===========================================================================

async function exportAnimaticWebm() {
  if (!App.project) return;
  if (App.project.panels.length < 2) {
    toast('Need at least 2 panels to export an animatic', 'error');
    return;
  }
  if (typeof MediaRecorder === 'undefined') {
    toast('Your browser does not support video recording. Try Chrome or Firefox.', 'error');
    return;
  }

  const fps = App.playFps || 2;
  const w = App.project.width;
  const h = App.project.height;
  const panels = App.project.panels;

  // v3.9.19: each panel has its own hold duration. Audio panels hold for
  // the full clip length, silent panels hold for 1/fps. Pre-compute each
  // panel's hold ms (and a running offset) so audio scheduling and the
  // paint loop stay in lockstep.
  const panelHoldMs = panels.map(p => computePanelHoldMs(p));
  const panelOffsetMs = [];
  let acc = 0;
  for (const ms of panelHoldMs) { panelOffsetMs.push(acc); acc += ms; }

  // Offscreen render canvas - sized to the project, used as the recorder source
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = w;
  exportCanvas.height = h;
  const exportCtx = exportCanvas.getContext('2d');

  // -------------------------------------------------------------------------
  // v3.9.18: per-panel voice-over audio in the recorded video.
  // v3.9.19: each clip is scheduled at its panel's exact start offset
  //          (panelOffsetMs) so the audio + visual stay aligned even when
  //          panels have variable durations.
  // -------------------------------------------------------------------------
  const anyAudio = panels.some(p => p.audioId);
  let audioCtx = null;
  let audioDest = null;
  let audioBuffers = null;
  if (anyAudio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      try {
        audioCtx = new Ctx();
        audioDest = audioCtx.createMediaStreamDestination();
        audioBuffers = [];
        const { getPanelAudio } = await import('../storage/panel-audio.js');
        for (const p of panels) {
          if (!p.audioId) { audioBuffers.push(null); continue; }
          try {
            const blob = await getPanelAudio(p.audioId);
            if (!blob) { audioBuffers.push(null); continue; }
            const arr = await blob.arrayBuffer();
            const buf = await audioCtx.decodeAudioData(arr);
            audioBuffers.push(buf);
          } catch (err) {
            console.warn('audio decode failed for panel', err);
            audioBuffers.push(null);
          }
        }
      } catch (err) {
        console.warn('Audio context init failed; export will be silent:', err);
        audioCtx = null; audioDest = null; audioBuffers = null;
      }
    }
  }

  // Pick a supported MIME type; opus is the standard WebM audio codec.
  const mimeCandidates = audioDest
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  let mimeType = '';
  for (const c of mimeCandidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) {
      mimeType = c;
      break;
    }
  }

  // Build the combined media stream - canvas video + (optional) audio
  const videoStream = exportCanvas.captureStream();
  const tracks = [...videoStream.getVideoTracks()];
  if (audioDest) tracks.push(...audioDest.stream.getAudioTracks());
  const stream = new MediaStream(tracks);

  let recorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (err) {
    toast('Could not start recorder: ' + err.message, 'error');
    if (audioCtx) try { await audioCtx.close(); } catch (_) {}
    return;
  }

  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const audioNote = audioBuffers ? ' with audio' : '';
  const totalSec = (acc / 1000).toFixed(1);
  toast(`Exporting ${panels.length} panels (${totalSec}s${audioNote})...`, 'info');

  // Paint the FIRST panel before starting the recorder so the very first
  // frame doesn't capture a blank canvas.
  paintPanelForExport(exportCtx, panels[0], w, h);

  // v3.9.18 / v3.9.19: schedule audio sources at exact panel start offsets.
  const audioLeadMs = audioCtx ? 50 : 0;
  if (audioCtx) {
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (_) { /* noop */ }
    }
    const baseTime = audioCtx.currentTime + (audioLeadMs / 1000);
    for (let i = 0; i < panels.length; i++) {
      const buf = audioBuffers[i];
      if (!buf) continue;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioDest);
      const startAt = baseTime + (panelOffsetMs[i] / 1000);
      const stopAt  = startAt + (panelHoldMs[i] / 1000);
      src.start(startAt);
      try { src.stop(stopAt); } catch (_) { /* already stopped */ }
    }
  }

  recorder.start();
  if (audioLeadMs) await sleep(audioLeadMs);
  // Hold the first panel for ITS duration, not a uniform 1/fps.
  await sleep(panelHoldMs[0]);

  // Cycle through remaining panels with each one's own hold duration.
  for (let i = 1; i < panels.length; i++) {
    paintPanelForExport(exportCtx, panels[i], w, h);
    await sleep(panelHoldMs[i]);
  }

  // Small tail so the encoder flushes the last frame's data
  await sleep(120);
  recorder.stop();

  await new Promise((res) => { recorder.onstop = res; });

  if (audioCtx) {
    try { await audioCtx.close(); } catch (_) { /* noop */ }
  }

  const blob = new Blob(chunks, { type: 'video/webm' });
  if (blob.size === 0) {
    toast('Recording produced an empty file. Try a different browser.', 'error');
    return;
  }

  await downloadBlob(blob, (App.project.name || 'animatic') + '.webm');
  const sizeMb = (blob.size / 1024 / 1024).toFixed(1);
  toast(`Animatic exported (${sizeMb} MB${audioBuffers ? ', with audio' : ''})`, 'ok');
}

/**
 * Paint one panel onto the export canvas, with caption burned in at the
 * bottom as a subtitle bar. Composites visible layers in order.
 */
function paintPanelForExport(ctx, panel, w, h) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  for (const layer of panel.layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend || 'source-over';
    ctx.drawImage(layer.canvas, 0, 0);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

// v3.9.16: caption rendering moved to drawCaptionSubtitle in view.js
  // — single source of truth shared with the in-app playback preview.
  drawCaptionSubtitle(ctx, panel.caption, w, h);
  ctx.restore();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}


// ===========================================================================
// v3.9.15: comic-strip export. Stacks every panel into one tall PNG with
// caption bands between them — a static, single-image artifact of the
// whole storyboard. Direct progression toward the user's stated future
// vision of a vertical-scroll comic-strip layout, without yet making
// the architectural shift inside the editor.
//
// Layout per panel: panel image (project_width × project_height) followed
// by a caption band (only if the panel has a caption). Bands are sized
// proportional to the panel height so they read at any project resolution.
// ===========================================================================

async function exportComicStripPng() {
  if (!App.project) return;
  const panels = App.project.panels;
  if (!panels || panels.length === 0) {
    toast('No panels to export', 'error');
    return;
  }

  const w = App.project.width;
  const panelH = App.project.height;
  // Caption band sizes ~12% of panel height — keeps text readable at any
  // resolution without dominating the image. Padding is included.
  const captionBandH = Math.round(panelH * 0.12);
  const dividerH = 4; // thin separator between panels for visual rhythm

  // Compute total height: each panel contributes its image + (optional caption band)
  // + a divider (except after the last panel).
  const heights = panels.map((p, i) => {
    const cap = (p.caption || '').trim() ? captionBandH : 0;
    const div = i < panels.length - 1 ? dividerH : 0;
    return panelH + cap + div;
  });
  const totalH = heights.reduce((a, b) => a + b, 0);

  // Sanity check — VERY large strips (>16384px on any axis) blow up most
  // browser canvas implementations. Warn the user and bail rather than
  // producing a corrupted image.
  if (totalH > 16384) {
    toast(
      `Strip would be ${totalH}px tall — too large for browser canvas. ` +
      `Try fewer panels or a smaller project size.`, 'error'
    );
    return;
  }

  toast(`Building comic strip (${panels.length} panels)…`, 'info');
  // Yield once so the toast renders before the heavy paint blocks the thread.
  await new Promise((r) => setTimeout(r, 50));

  const stripCanvas = document.createElement('canvas');
  stripCanvas.width = w;
  stripCanvas.height = totalH;
  const ctx = stripCanvas.getContext('2d');

  // Solid white background so PNG compositing is predictable.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, totalH);

  let y = 0;
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];

    // 1. Paint panel layers at this y offset
    ctx.save();
    ctx.translate(0, y);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const layer of panel.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend || 'source-over';
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.restore();
    y += panelH;

    // 2. Caption band — dark bar with light text, only when caption exists
    const captionText = (panel.caption || '').trim();
    if (captionText) {
      ctx.fillStyle = '#1f1d1b';
      ctx.fillRect(0, y, w, captionBandH);

      const fontSize = Math.max(18, Math.round(captionBandH * 0.42));
      const padX = Math.round(fontSize * 0.8);
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Word-wrap the caption to the band width — long captions need
      // multiple lines, otherwise text overflows or gets clipped.
      const maxW = w - padX * 2;
      const lines = wrapStripCaption(ctx, captionText, maxW);
      const lineH = Math.round(fontSize * 1.25);
      const totalTextH = lines.length * lineH;
      const startY = y + (captionBandH - totalTextH) / 2 + lineH / 2;
      for (let li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], w / 2, startY + li * lineH);
      }
      y += captionBandH;
    }

    // 3. Divider between panels — thin horizontal line, except after last
    if (i < panels.length - 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.fillRect(0, y, w, dividerH);
      y += dividerH;
    }
  }

  // Encode to PNG and download
  const blob = await new Promise((res) => stripCanvas.toBlob(res, 'image/png'));
  if (!blob || blob.size === 0) {
    toast('Comic strip encoding failed. Try fewer or smaller panels.', 'error');
    return;
  }
  await downloadBlob(blob, (App.project.name || 'comic-strip') + '.png');
  toast(`Comic strip exported (${(blob.size / 1024 / 1024).toFixed(1)} MB)`, 'ok');
}

/**
 * Greedy word-wrap for the comic-strip caption bands. Same logic as
 * wrapTextLines used in the WebM export path — kept local so the strip
 * export module is self-contained.
 */
function wrapStripCaption(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (ctx.measureText(test).width <= maxWidth) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
