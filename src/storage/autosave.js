// src/storage/autosave.js
// Automatic saving to IndexedDB after strokes, and restore on startup.

import { App } from '../core/state.js';
import { idbSet, idbGet } from '../utils/idb.js';
import { serializeKpz, loadKpzBlob } from './kpz-format.js';

let autosaveTimer = null;

/** Schedule an autosave 1.5 seconds after the last stroke ends. */
export function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveLocal, 1500);
}

async function autosaveLocal() {
  if (!App.project) return;
  try {
    const blob = await serializeKpz();
    localStorage.setItem('kpz_autosave_meta', JSON.stringify({
      name: App.project.name, time: Date.now(),
      width: App.project.width, height: App.project.height,
    }));
    await idbSet('kpz_autosave_data', blob);
  } catch (err) {
    console.warn('Autosave failed', err);
  }
}

/**
 * On startup, check if there is a recent autosave and offer to restore it.
 * @returns {Promise<boolean>} true if a project was restored
 */
export async function tryRestoreAutosave() {
  try {
    const meta = localStorage.getItem('kpz_autosave_meta');
    if (!meta) return false;
    const data = await idbGet('kpz_autosave_data');
    if (!data) return false;
    const m = JSON.parse(meta);
    const ago = Math.round((Date.now() - m.time) / 60000);
    if (confirm(`Found an autosaved project "${m.name}" from ${ago} min ago. Restore it?`)) {
      await loadKpzBlob(data);
      return true;
    }
  } catch (err) {
    console.warn('Restore failed', err);
  }
  return false;
}
