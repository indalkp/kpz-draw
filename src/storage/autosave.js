// src/storage/autosave.js
//
// Automatic saving to IndexedDB after strokes, and restore on startup.
//
// v3.6.4: Session-gate restore.
//   Before: every page load showed a blocking `confirm()` modal asking
//           "Restore from previous session?" — annoying on every refresh.
//   After:  autosave is tagged with a sessionId that lives in sessionStorage.
//           - If the current sessionId MATCHES the stored one, the user just
//             refreshed the same tab → restore silently, no prompt.
//           - If it DOESN'T match (new tab / new browser / returned later)
//             AND the autosave is recent, restore silently too.
//           - The non-blocking toast in main.js tells the user what happened
//             (see v3.6.5 plan for the toast; for now, just a console log).
//   The confirm() dialog is GONE. Restore always succeeds silently; if the
//   user wanted the blank project, they click File → New.

import { App } from '../core/state.js';
import { idbSet, idbGet } from '../utils/idb.js';
import { serializeKpz, loadKpzBlob } from './kpz-format.js';

let autosaveTimer = null;

/**
 * Get (or generate) the sessionId for this browser tab.
 * sessionStorage scopes to a single tab/window — perfect for detecting
 * "did the user just refresh vs open a new tab".
 */
function getSessionId() {
  let id = sessionStorage.getItem('kpz_session_id');
  if (!id) {
    // Short random ID — doesn't need to be crypto-grade, just unique per tab
    id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('kpz_session_id', id);
  }
  return id;
}

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
      name: App.project.name,
      time: Date.now(),
      width: App.project.width,
      height: App.project.height,
      sessionId: getSessionId(), // v3.6.4: tag with current tab's session
    }));
    await idbSet('kpz_autosave_data', blob);
  } catch (err) {
    console.warn('Autosave failed', err);
  }
}

/**
 * On startup, check if there is a recent autosave and restore it.
 *
 * v3.6.4: Restore is now ALWAYS silent (no confirm dialog). The user can
 * always start fresh via File → New. The old modal was overkill — most of
 * the time the user wants their work back, that's the whole point of autosave.
 *
 * @returns {Promise<boolean>} true if a project was restored
 */
export async function tryRestoreAutosave() {
  try {
    const metaRaw = localStorage.getItem('kpz_autosave_meta');
    if (!metaRaw) return false;
    const data = await idbGet('kpz_autosave_data');
    if (!data) return false;

    const meta = JSON.parse(metaRaw);
    const ageMin = Math.round((Date.now() - meta.time) / 60000);
    const currentSession = getSessionId();
    const sameTab = meta.sessionId && meta.sessionId === currentSession;

    // v3.6.4: always restore silently. Log context so we can see it in
    // devtools if something feels off.
    console.log(
      `KPZ Draw: restoring autosave "${meta.name}" ` +
      `(${ageMin} min old, ${sameTab ? 'same tab refresh' : 'cross-session'})`
    );
    await loadKpzBlob(data);
    return true;
  } catch (err) {
    console.warn('Restore failed', err);
  }
  return false;
}
