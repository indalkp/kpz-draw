// ============================================================================
//  src/storage/cloud-audio.js — v3.11.0 audio via Wix Media Manager
//
//  Uploads per-panel audio to Wix's Media Manager so cloud project saves
//  carry only URL refs (~100 bytes/panel) instead of inline audio bytes
//  (which previously triggered HTTP 413 on projects with large audio).
//
//  Frontend flow:
//    1. User attaches/records audio (panel-nav.js).
//    2. Audio Blob stashed to IDB via panel-audio.js (unchanged path).
//    3. uploadPanelAudio(blob, audioId) called from panel-nav.js — bridges
//       through Velo to the backend uploadPanelAudio() webMethod.
//    4. On success, returned fileUrl is stored in panel.audioMediaUrl.
//
//  Cloud save path (storage/wix-bridge.js):
//    Always excludeAudio:true (audio bytes never leave via the save call).
//    Per-panel audioMediaUrl meta carries the URL through; load auto-fetches.
//
//  Load path (storage/kpz-format.js):
//    For each panel with audioMediaUrl but no IDB blob yet, fetch the audio
//    from the URL and stash to IDB so playback works on the new device.
// ============================================================================

import { App } from '../core/state.js';
import { setPanelAudio } from './panel-audio.js';

// Promise correlation map: requestId → resolver
const _pending = new Map();

// Set up the response listener once when the module is first imported. It
// listens for 'upload-audio-result' postMessages from Velo and resolves
// the matching Promise via requestId.
function ensureListener() {
  if (ensureListener._wired) return;
  ensureListener._wired = true;
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type !== 'upload-audio-result') return;
    const r = _pending.get(msg.requestId);
    if (!r) return;
    _pending.delete(msg.requestId);
    r(msg);
  });
}

/**
 * Upload an audio Blob to Wix Media Manager via the Velo bridge.
 *
 * @param {Blob} blob          The audio Blob (from MediaRecorder or file picker).
 * @param {string} audioId     The IDB key for this audio. Used as part of the
 *                             Wix Media filename to make uploads traceable.
 * @returns {Promise<{success, fileUrl?, error?}>}
 */
export async function uploadPanelAudio(blob, audioId) {
  if (!App.inWix) return { success: false, error: 'not-in-wix' };
  if (!App.isLoggedIn) return { success: false, error: 'not-logged-in' };
  if (!blob || blob.size === 0) return { success: false, error: 'empty-blob' };

  ensureListener();

  // Convert blob to base64 (Velo backend expects base64 strings, not raw bytes)
  const audioBase64 = await blobToBase64(blob);
  const mimeType = blob.type || 'audio/webm';
  const requestId = 'upload-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  return new Promise((resolve) => {
    _pending.set(requestId, resolve);

    // Safety timeout — large audio uploads can take a while; cap at 60s.
    setTimeout(() => {
      if (_pending.has(requestId)) {
        _pending.delete(requestId);
        resolve({ success: false, error: 'timeout' });
      }
    }, 60_000);

    window.parent.postMessage({
      type: 'upload-panel-audio',
      audioBase64,
      mimeType,
      audioId,
      requestId,
    }, '*');
  });
}

/**
 * Fetch an audio Blob from a Wix Media URL (or any direct https URL).
 * Used by kpz-format.js loadKpzBlob to restore audio from a project loaded
 * on a fresh device. On failure, returns null and lets playback silently
 * no-op — same UX as v3.9.21 when audio was missing from IDB.
 */
export async function fetchAudioFromUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      console.warn('cloud-audio: fetch returned', res.status, 'for', url);
      return null;
    }
    return await res.blob();
  } catch (err) {
    console.warn('cloud-audio: fetch failed for', url, err);
    return null;
  }
}

/**
 * Best-effort: fetch all panel audio that has audioMediaUrl set but no
 * matching IDB entry yet. Called on project load (kpz-format.js loadKpzBlob)
 * so a project saved from device A and opened on device B "just works."
 *
 * Runs uploads in parallel for speed. Errors are swallowed per-panel.
 */
export async function ensurePanelAudioFromUrls(panels) {
  if (!Array.isArray(panels)) return;
  const tasks = [];
  for (const panel of panels) {
    if (!panel || !panel.audioId || !panel.audioMediaUrl) continue;
    tasks.push((async () => {
      try {
        const blob = await fetchAudioFromUrl(panel.audioMediaUrl);
        if (blob && blob.size > 0) {
          await setPanelAudio(panel.audioId, blob);
        }
      } catch (err) {
        console.warn('cloud-audio: ensure failed for panel', panel.audioId, err);
      }
    })());
  }
  await Promise.all(tasks);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result || '';
      // result is a data URL: "data:<mime>;base64,<payload>" — keep it
      // intact; backend's stripDataUrl handles the prefix removal.
      resolve(String(result));
    };
    r.onerror = () => reject(r.error || new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}
