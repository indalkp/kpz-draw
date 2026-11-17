// src/ui/panel-nav.js
// v3.5.2: redesigned + button (filled circle, not dashed), better thumb spacing.
// v3.9.17: caption strip now also wires the audio attach/remove button so
// each panel can carry a voice-over clip that plays during animatic playback.
import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';
import { createPanel } from '../drawing/panels.js';
import { renderDisplay } from '../drawing/view.js';
import { renderLayersUI } from './layers-panel.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';
import { newAudioId, setPanelAudio, deletePanelAudio } from '../storage/panel-audio.js';
import { startRecording, stopRecording, cancelRecording, isRecording, detectMicAvailability } from './audio-recorder.js';
// v3.10.0: strip-mode hooks. Lazy-imported via dynamic import where called
// because most sessions never enter strip mode; static import is fine here
// because strip-mode.js has no side effects at module init.
import { relocateCanvasWrapTo, rebuildStripContainer, refreshStripPreview } from './strip-mode.js';

export function initPanelNav() {
  // v3.9.11: caption input wiring. The input lives in #canvasArea above
  // the filmstrip; we keep it in sync with the active panel's caption,
  // and write back on every keystroke (cheap — one string assignment).
  const input = $('captionInput');
  if (input) {
    input.addEventListener('input', e => {
      if (!App.project) return;
      const panel = App.project.panels[App.activePanelIdx];
      if (!panel) return;
      panel.caption = e.target.value;
      App.dirty = true; updateSaveStatus();
      // v3.10.0: in strip mode, mirror caption to the strip slot's
      // read-only caption row so what the user types is also visible
      // there (the strip is BELOW the bottom captionStrip on long lists).
      if (App.viewMode === 'strip') refreshStripPreview(App.activePanelIdx);
    });
    // Initial population — main.js calls renderPanelNav after createProject /
    // loadKpzBlob, which now also calls syncCaptionInput, but seed it here
    // too in case any other code path leaves the input out of sync.
    syncCaptionInput();
  }

  // v3.9.17: audio file-upload button.
  $('captionAudioBtn')?.addEventListener('click', onAudioBtnClick);
  $('captionAudioFileInput')?.addEventListener('change', onAudioFileChosen);
  // v3.9.20: in-browser recording button.
  $('captionRecordBtn')?.addEventListener('click', onRecordBtnClick);
  // v3.9.25: manual per-panel duration override input. Live-binds on input
  // (every keystroke / arrow click) since the field is small and changes
  // are cheap — playback timing recomputes on next advance via
  // computePanelHoldMs(panel), no separate render needed.
  $('captionDurationInput')?.addEventListener('input', e => {
    if (!App.project) return;
    const panel = App.project.panels[App.activePanelIdx];
    if (!panel) return;
    const v = parseFloat(e.target.value);
    panel.duration = (Number.isFinite(v) && v > 0) ? v : 0;
    App.dirty = true; updateSaveStatus();
  });
  // Escape cancels an in-progress recording without saving.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isRecording()) {
      cancelRecording();
      setRecordingUI(false);
      toast('Recording cancelled', 'ok');
      e.stopPropagation();
    }
  });

  // v3.9.22 / v3.9.23: detect mic availability up front. Three outcomes:
  //   - Local mic works → record button enabled, normal flow.
  //   - Local blocked but Velo bridge responds → record button enabled,
  //     tooltip notes recording goes through the parent page.
  //   - Neither → record button disabled with a clear tooltip pointing
  //     the user at the Upload alternative.
  detectMicAvailability().then(({ available, reason, mode }) => {
    const btn = $('captionRecordBtn');
    if (!btn) return;
    if (!available) {
      btn.classList.add('mic-unavailable');
      btn.disabled = true;
      btn.title = reason === 'iframe-policy'
        ? 'Recording is blocked by this page\'s iframe — use Upload instead, or paste the v3.9.23 Velo bridge handler in your Wix Editor.'
        : 'Microphone is not available in this browser';
      return;
    }
    // Available — keep the default tooltip but annotate when bridge is on.
    if (mode === 'bridge') {
      btn.title = 'Record voice-over (via Wix bridge — recorded in the parent page)';
      btn.classList.add('mic-via-bridge');
    }
  });
}

/**
 * v3.9.11: copy the active panel's caption into the input. Called from
 * switchPanel + playback advance + after load so the strip always reflects
 * the visible panel without us listening to every state mutation.
 *
 * v3.9.17: also sync the audio button's visual state — `has-audio` class
 * when this panel has an audioId, so users can tell at a glance whether
 * a voice-over is attached.
 */
export function syncCaptionInput() {
  const panel = App.project?.panels?.[App.activePanelIdx];
  const input = $('captionInput');
  if (input && document.activeElement !== input) {
    input.value = panel?.caption || '';
  }
  const audioBtn = $('captionAudioBtn');
  if (audioBtn) {
    const hasAudio = !!panel?.audioId;
    audioBtn.classList.toggle('has-audio', hasAudio);
    audioBtn.title = hasAudio
      ? 'Voice-over attached — click to remove'
      : 'Attach voice-over audio for this panel';
  }
  // v3.9.25: sync the manual duration input. Skip when the user is editing
  // the field (active focus) to avoid clobbering their in-progress typing.
  const durInput = $('captionDurationInput');
  if (durInput && document.activeElement !== durInput) {
    durInput.value = (panel?.duration && panel.duration > 0) ? panel.duration : 0;
  }
}

// v3.9.17: audio button click handler. Two states:
//   - No audio attached → trigger the hidden file picker
//   - Audio attached    → confirm + remove from IDB and the panel
function onAudioBtnClick() {
  const panel = App.project?.panels?.[App.activePanelIdx];
  if (!panel) return;
  if (panel.audioId) {
    if (!confirm('Remove the voice-over from this panel?')) return;
    const oldId = panel.audioId;
    panel.audioId = null;
    panel.audioDuration = 0;     // v3.9.19: clear cached duration too
    deletePanelAudio(oldId);
    syncCaptionInput();
    App.dirty = true; updateSaveStatus();
    toast('Voice-over removed', 'ok');
  } else {
    // Reset value so the same file can be re-picked after a remove + re-add
    const fi = $('captionAudioFileInput');
    if (fi) fi.value = '';
    fi?.click();
  }
}

// v3.9.17: file picker change handler. Reads the chosen audio file as a
// Blob and stores it in IDB under a fresh audioId. The panel keeps only
// the audioId (small string), so .kpz round-trips cleanly without the
// audio bytes inflating the project file.
async function onAudioFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // reset for next pick
  if (!file) return;
  if (!App.project) return;
  const panel = App.project.panels[App.activePanelIdx];
  if (!panel) return;

  // Hard cap on size to avoid bloating IDB. 25MB covers a few minutes
  // of voice-over at reasonable quality. Anything larger is probably
  // accidentally-picked music or a phone recording.
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    toast(`Audio too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`, 'error');
    return;
  }
  // Type sanity check — accept anything that decodes as audio
  if (file.type && !file.type.startsWith('audio/')) {
    toast('That file does not look like audio (' + (file.type || 'unknown') + ').', 'error');
    return;
  }

  // If panel already had audio, free the old IDB entry so we don't leak.
  if (panel.audioId) {
    await deletePanelAudio(panel.audioId);
  }

  // v3.9.19: probe duration via an Audio element + loadedmetadata so the
  // playback scheduler can hold this panel for the full clip length.
  // Fallback to 0 = "use FPS timing" if probing fails for any reason.
  let durationSec = 0;
  try {
    durationSec = await probeAudioDuration(file);
  } catch (err) {
    console.warn('audio duration probe failed:', err);
  }

  const audioId = newAudioId();
  await setPanelAudio(audioId, file);
  panel.audioId = audioId;
  panel.audioMediaUrl = null;   // v3.11.0: clear stale URL from previous attach
  panel.audioDuration = durationSec;

  syncCaptionInput();
  App.dirty = true; updateSaveStatus();
  const durNote = durationSec > 0 ? `, ${durationSec.toFixed(1)}s` : '';
  toast(`Voice-over attached (${(file.size / 1024).toFixed(0)} KB${durNote})`, 'ok');

  // v3.11.0: kick off background upload to Wix Media Manager so a future
  // cloud save can carry just the URL, not the audio bytes (avoids 413).
  uploadAudioToCloud(panel, file, audioId);
}

// v3.9.20: in-browser recording. Same save path as upload — once recording
// stops, the recorded Blob flows through the same probeAudioDuration +
// IDB-store + audioId-on-panel + dirty-flag pipeline as a file pick.
async function onRecordBtnClick() {
  if (!App.project) return;
  const panel = App.project.panels[App.activePanelIdx];
  if (!panel) return;

  if (isRecording()) {
    // Stop and save
    setRecordingUI(false);
    const blob = await stopRecording();
    if (!blob || blob.size === 0) {
      toast('Recording produced no audio', 'error');
      return;
    }
    // Cap at 25 MB (same as upload path)
    if (blob.size > 25 * 1024 * 1024) {
      toast('Recording too large (>25 MB). Try a shorter clip.', 'error');
      return;
    }

    // Probe duration
    let durationSec = 0;
    try { durationSec = await probeAudioDuration(blob); } catch (_) { /* noop */ }

    // Free old audio if any, then store the new clip
    if (panel.audioId) await deletePanelAudio(panel.audioId);
    const audioId = newAudioId();
    await setPanelAudio(audioId, blob);
    panel.audioId = audioId;
    panel.audioMediaUrl = null;     // v3.11.0: clear stale URL
    panel.audioDuration = durationSec;

    syncCaptionInput();
    App.dirty = true; updateSaveStatus();
    toast(`Voice-over recorded (${durationSec.toFixed(1)}s)`, 'ok');

    // v3.11.0: background upload to Wix Media Manager (fire-and-forget;
    // cloud save can carry the URL once upload completes).
    uploadAudioToCloud(panel, blob, audioId);
    return;
  }

  // Not recording yet — start. Mic permission is requested by getUserMedia.
  try {
    await startRecording();
    setRecordingUI(true);
    toast('Recording — click the mic again to stop, or press Escape to cancel', 'info');
  } catch (err) {
    console.warn('startRecording failed:', err);
    // v3.9.22: differentiate the failure so users know what to do next.
    // The most confusing case is iframe Permissions-Policy denial —
    // browser refuses the request silently, no permission prompt shows up,
    // user sees "denied" without ever having said no.
    const inIframe = window.self !== window.top;
    let msg;
    const name = err && err.name;
    if (name === 'NotAllowedError' && inIframe) {
      msg = 'Recording blocked by this iframe\'s permissions policy. Use Upload instead, or open KPZ Draw outside the embed.';
    } else if (name === 'NotAllowedError') {
      msg = 'Microphone permission denied. Allow it in your browser site settings and try again.';
    } else if (name === 'NotFoundError') {
      msg = 'No microphone found on this device.';
    } else if (name === 'NotReadableError') {
      msg = 'Microphone is in use by another app — close it and try again.';
    } else if (name === 'SecurityError') {
      msg = 'Microphone disabled (site is not on HTTPS or context is restricted).';
    } else {
      msg = 'Recording failed: ' + (err && (err.message || err.name) || 'unknown error');
    }
    toast(msg, 'error');
  }
}

/**
 * v3.9.20: paint the record button red + pulse during a live recording so
 * users see at a glance that the mic is hot. Reset to grey when idle.
 */
function setRecordingUI(recording) {
  const btn = $('captionRecordBtn');
  if (!btn) return;
  btn.classList.toggle('recording', recording);
  btn.title = recording
    ? 'Recording — click to stop (Esc to cancel)'
    : 'Record voice-over for this panel';
}

/**
 * v3.9.19: read the audio file's duration without decoding the whole thing
 * in the main thread. Resolves with the duration in seconds (0 if unknown).
 * Uses an Audio element + 'loadedmetadata' event because that's universally
 * supported and metadata loads cheaply (no full decode needed).
 */
/**
 * v3.11.0: fire-and-forget background upload of a panel's audio Blob to
 * Wix Media Manager. On success, sets panel.audioMediaUrl + marks dirty
 * so the next cloud save carries the URL. On failure, surfaces a one-time
 * toast — the audio still works locally via IDB, just won't sync across
 * devices via cloud save.
 */
function uploadAudioToCloud(panel, blob, audioId) {
  if (!App.inWix || !App.isLoggedIn) return;   // no auth = local only
  (async () => {
    try {
      const { uploadPanelAudio } = await import('../storage/cloud-audio.js');
      const r = await uploadPanelAudio(blob, audioId);
      if (r && r.success && r.fileUrl) {
        // Verify the panel still has the same audioId (user could have
        // re-attached or deleted while upload was in flight). If yes,
        // bind the URL and mark dirty so the next save picks it up.
        if (panel.audioId === audioId) {
          panel.audioMediaUrl = r.fileUrl;
          App.dirty = true;
          updateSaveStatus();
        }
      } else {
        console.warn('cloud-audio: upload failed', r);
        toast('Audio attached locally — cloud upload failed. It will not sync to other devices.', 'error');
      }
    } catch (err) {
      console.warn('cloud-audio: upload error', err);
    }
  })();
}

function probeAudioDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      try { URL.revokeObjectURL(url); } catch (_) { /* noop */ }
      resolve(val);
    };
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      const d = audio.duration;
      finish(Number.isFinite(d) && d > 0 ? d : 0);
    });
    audio.addEventListener('error', () => finish(0));
    // Hard timeout — some browsers stall on certain formats
    setTimeout(() => finish(0), 4000);
    audio.src = url;
  });
}

export function renderPanelNav() {
  const nav = $('panelNav');
  if (!nav || !App.project) return;
  nav.innerHTML = '';

  App.project.panels.forEach((p, i) => {
    const t = document.createElement('div');
    t.className = 'panel-thumb' + (i === App.activePanelIdx ? ' active' : '');
    t.innerHTML = `<span class="num">${i + 1}</span><button class="panel-del" title="Delete panel">×</button>`;
    // v3.9.12: thumbs are draggable for reorder
    t.draggable = true;
    t.dataset.idx = String(i);

    const tc = document.createElement('canvas');
    tc.width = 54; tc.height = 40;
    const tctx = tc.getContext('2d');
    for (const layer of p.layers) {
      if (!layer.visible) continue;
      tctx.globalAlpha = layer.opacity;
      tctx.drawImage(layer.canvas, 0, 0, 54, 40);
    }
    tctx.globalAlpha = 1;
    t.style.backgroundImage = `url(${tc.toDataURL()})`;

    t.addEventListener('click', e => {
      if (e.target.classList.contains('panel-del')) {
        e.stopPropagation();
        if (App.project.panels.length <= 1) { toast("Can't delete last panel", 'error'); return; }
        if (!confirm('Delete panel ' + (i + 1) + '?')) return;
        App.project.panels.splice(i, 1);
        App.history[i] = null;
        if (App.activePanelIdx >= App.project.panels.length) App.activePanelIdx = App.project.panels.length - 1;
        App.dirty = true; updateSaveStatus();
        renderDisplay(); renderLayersUI(); renderPanelNav();
        return;
      }
      switchPanel(i);
    });

    // v3.9.12: drag-and-drop reorder. Same pattern the references panel
    // already uses (see ui/references.js) — set a custom mime type on
    // dragstart so we can distinguish panel drags from arbitrary file
    // drags, then on drop swap the array indices and adjust activePanelIdx
    // so the same panel object stays focused after the reorder.
    t.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/kpz-panel-idx', String(i));
      t.classList.add('dragging');
    });
    t.addEventListener('dragend', () => t.classList.remove('dragging'));
    t.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('text/kpz-panel-idx')) {
        e.preventDefault();
        t.classList.add('drop-target');
      }
    });
    t.addEventListener('dragleave', () => t.classList.remove('drop-target'));
    t.addEventListener('drop', e => {
      const fromStr = e.dataTransfer.getData('text/kpz-panel-idx');
      const from = parseInt(fromStr, 10);
      t.classList.remove('drop-target');
      if (Number.isNaN(from) || from === i) return;
      e.preventDefault();
      e.stopPropagation();
      reorderPanel(from, i);
    });

    nav.appendChild(t);
  });

  // v3.5.2: redesigned + button — solid filled circle, matches thumb height
  const addBtn = document.createElement('button');
  addBtn.className = 'panel-add-btn';
  addBtn.title = 'Add new panel';
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
  addBtn.addEventListener('click', addPanel);
  nav.appendChild(addBtn);

  const pi = $('panelInfo');
  if (pi) pi.textContent = `Panel ${App.activePanelIdx + 1} / ${App.project.panels.length}`;
}

export function switchPanel(i) {
  // v3.10.0: in strip mode, relocate the live editing surface (#canvasWrap)
  // to the new panel's slot BEFORE updating activePanelIdx + rendering, so
  // renderDisplay paints into the correct visual location. Idempotent —
  // no-op if already there.
  if (App.viewMode === 'strip' && i !== App.activePanelIdx) {
    relocateCanvasWrapTo(i);
  }
  App.activePanelIdx = i;
  renderDisplay(); renderLayersUI(); renderPanelNav();
  scrollActiveThumbIntoView();
  syncCaptionInput();             // v3.9.11
}

/**
 * v3.9.10: lightweight panel switch for animatic playback. Skips the
 * layers UI re-render (panels share layer structure visually so the layers
 * panel doesn't need to flicker every frame) but does re-render the canvas
 * and the filmstrip, and scrolls the active thumb into view so the user
 * can follow the playback position.
 *
 * v3.9.11: also syncs the caption input so the strip below the canvas
 * shows the active panel's line of dialogue as panels cycle.
 */
export function switchPanelForPlayback(i) {
  // v3.10.0: also relocate live editing surface in strip mode so playback's
  // active highlight visibly walks down the strip in real time.
  if (App.viewMode === 'strip' && i !== App.activePanelIdx) {
    relocateCanvasWrapTo(i);
  }
  App.activePanelIdx = i;
  renderDisplay();
  renderPanelNav();
  scrollActiveThumbIntoView();
  syncCaptionInput();
}

function scrollActiveThumbIntoView() {
  const nav = $('panelNav');
  if (!nav) return;
  const active = nav.querySelector('.panel-thumb.active');
  if (!active) return;
  // Use scrollIntoView with smooth + nearest so the user sees the
  // playback head moving along the filmstrip without jumpy resets.
  active.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

export function addPanel() {
  App.project.panels.push(createPanel(App.project.width, App.project.height));
  App.activePanelIdx = App.project.panels.length - 1;
  App.dirty = true; updateSaveStatus();
  renderDisplay(); renderLayersUI(); renderPanelNav();
  // v3.10.0: rebuild the strip if it's open so the new panel slot appears
  if (App.viewMode === 'strip') rebuildStripContainer();
}

/**
 * v3.9.12: move a panel from index `from` to index `to`. Adjusts
 * activePanelIdx so the same PANEL OBJECT (not the same numeric index)
 * stays selected after the move — matches user expectation that the
 * panel they're working on follows their drag, not the slot it left.
 *
 * Also reorders the parallel App.history[] / App.historyIdx[] arrays so
 * undo/redo keeps working against the right per-panel stacks. The history
 * arrays are sparse (one entry per panel), so we splice them in lockstep.
 */
export function reorderPanel(from, to) {
  if (!App.project) return;
  const panels = App.project.panels;
  if (from === to) return;
  if (from < 0 || to < 0 || from >= panels.length || to >= panels.length) return;

  // Move the panel
  const moved = panels.splice(from, 1)[0];
  panels.splice(to, 0, moved);

  // Move the matching history slot (same indexing as panels)
  const movedHist = App.history.splice(from, 1)[0];
  App.history.splice(to, 0, movedHist);
  const movedHistIdx = App.historyIdx.splice(from, 1)[0];
  App.historyIdx.splice(to, 0, movedHistIdx);

  // Recompute activePanelIdx so the user-focused panel follows the drag.
  // Three cases:
  //   - The dragged panel WAS the active one → it just moved to `to`.
  //   - Active panel sat between `from` and `to` (exclusive `from`,
  //     inclusive `to`) and got shifted by the splice — adjust by ±1.
  //   - Otherwise unchanged.
  if (App.activePanelIdx === from) {
    App.activePanelIdx = to;
  } else if (from < App.activePanelIdx && App.activePanelIdx <= to) {
    App.activePanelIdx -= 1;
  } else if (from > App.activePanelIdx && App.activePanelIdx >= to) {
    App.activePanelIdx += 1;
  }

  App.dirty = true; updateSaveStatus();
  renderDisplay(); renderLayersUI(); renderPanelNav();
  syncCaptionInput();
  // v3.10.0: panel order changed — rebuild strip so slot order matches
  if (App.viewMode === 'strip') rebuildStripContainer();
}

export function deletePanel() {
  if (App.project.panels.length <= 1) { toast("Can't delete last panel", 'error'); return; }
  if (!confirm('Delete this panel?')) return;
  App.project.panels.splice(App.activePanelIdx, 1);
  App.history[App.activePanelIdx] = null;
  App.activePanelIdx = Math.max(0, App.activePanelIdx - 1);
  App.dirty = true; updateSaveStatus();
  renderDisplay(); renderLayersUI(); renderPanelNav();
  // v3.10.0: a panel disappeared — rebuild strip; relocateCanvasWrapTo
  // is called inside rebuildStripContainer because it places #canvasWrap
  // into the (new) active slot.
  if (App.viewMode === 'strip') rebuildStripContainer();
}
