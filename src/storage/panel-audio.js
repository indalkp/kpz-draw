// src/storage/panel-audio.js
//
// v3.9.17: per-panel voice-over audio storage. Audio Blobs live in IndexedDB
// keyed by a stable audioId that travels with the panel inside .kpz. Audio
// is NOT embedded in the .kpz blob itself — the file format only carries
// the audioId reference, the actual audio bytes stay in IDB local to the
// device. Future enhancement (v3.9.18+) can either embed audio inline in
// .kpz or sync to Wix file storage so audio survives across devices.
//
// IDB key layout: `kpz_audio::<audioId>` → Blob (audio/mpeg, audio/wav, etc.)
//
// Audio lifecycle hooks:
//   setPanelAudio(audioId, blob)  — store new clip
//   getPanelAudio(audioId)        — fetch existing clip
//   deletePanelAudio(audioId)     — remove clip + free IDB space
//   newAudioId()                  — generate a fresh stable id

import { idbGet, idbSet, idbDelete } from '../utils/idb.js';

const PREFIX = 'kpz_audio::';

/**
 * Generate a fresh audioId. Random base36 string — collision-resistant
 * for the practical scale of one user's storyboards.
 */
export function newAudioId() {
  return 'A' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4);
}

/**
 * Read a panel's audio Blob from IDB. Returns null if not found or if
 * audioId is falsy (panel has no audio attached).
 */
export async function getPanelAudio(audioId) {
  if (!audioId) return null;
  try {
    const blob = await idbGet(PREFIX + audioId);
    return blob || null;
  } catch (err) {
    console.warn('getPanelAudio failed:', err);
    return null;
  }
}

/**
 * Store an audio Blob under the given audioId. Overwrites if it
 * already exists (used when replacing an attached clip).
 */
export async function setPanelAudio(audioId, blob) {
  if (!audioId || !blob) return;
  try {
    await idbSet(PREFIX + audioId, blob);
  } catch (err) {
    console.warn('setPanelAudio failed:', err);
  }
}

/**
 * Remove an audio Blob from IDB. No-op if it didn't exist.
 */
export async function deletePanelAudio(audioId) {
  if (!audioId) return;
  try {
    await idbDelete(PREFIX + audioId);
  } catch (err) {
    console.warn('deletePanelAudio failed:', err);
  }
}
