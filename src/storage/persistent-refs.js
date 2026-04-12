// src/storage/persistent-refs.js
// Restores reference images from IndexedDB on startup so the user's
// reference library survives across sessions and project switches.

import { App } from '../core/state.js';
import { idbGet } from '../utils/idb.js';

export async function restorePersistentRefs() {
  if (!App.project) return;
  if (App.project.refs && App.project.refs.length > 0) return;
  try {
    const saved = await idbGet('kpz_refs');
    if (Array.isArray(saved) && saved.length > 0) {
      App.project.refs = saved;
    }
  } catch (err) { console.warn('restorePersistentRefs failed:', err); }
}
