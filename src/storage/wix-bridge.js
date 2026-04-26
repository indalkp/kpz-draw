// src/storage/wix-bridge.js
//
// v3.6.2:
//   - saveToWix() now returns a Promise that resolves to { success, error?,
//     project?, stale? } so callers (like confirm-leave.js) can await it.
//   - On load, we stash project._updatedDate in App.projectLoadedAt so the
//     backend can detect stale writes from another tab.
//   - New 'save-result' branch for error === 'stale' → opens the stale-write
//     modal instead of a generic toast.
//
// v3.5.1 FIX (login/save regression):
// Message type names must match what Velo sends/expects:
//   Iframe → Velo: 'app-ready', 'save-project', 'list-projects',
//                  'open-project', 'request-login'
//   Velo   → Iframe: 'auth-info', 'load-project', 'save-result',
//                    'projects-list'

import { App } from '../core/state.js';
import { updateAuthUI, updateSaveStatus } from '../ui/topbar.js';
import { toast } from '../ui/toast.js';
import { renderProjectsList } from '../ui/projects-panel.js';
import { $ } from '../utils/dom-helpers.js';

// Module-local: the resolver for the currently in-flight save.
// saveToWix() creates a Promise and stores its resolver here; when
// 'save-result' comes back from Velo, we call this resolver.
let pendingSaveResolve = null;

// Module-local: whether the user has chosen "Overwrite anyway" for the
// current save cycle. Gets reset after any save attempt.
let overrideStaleOnce = false;

export function initWixBridge() {
  App.inWix = window.parent !== window;
  if (!App.inWix) return;

  // Wire stale-write modal buttons once
  $('swCancel')?.addEventListener('click', () => closeStaleModal());
  $('swReload')?.addEventListener('click', onStaleReload);
  $('swOverwrite')?.addEventListener('click', onStaleOverwrite);
  $('staleWriteModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'staleWriteModal') closeStaleModal();
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      // --- Auth state from Velo ---
      case 'auth-info':
        App.isLoggedIn = !!msg.loggedIn;
        // v3.8.3 (H1): on logout the bridge sometimes sends { loggedIn:false }
        // with no member. Previously App.member kept the ex-user's data,
        // which then flashed through the mobile more-menu dash row on the
        // NEXT login before fresh member data arrived. Explicit null on
        // logout guarantees a clean slate.
        if (msg.loggedIn) {
          App.member     = msg.member || null;
          App.memberId   = msg.member?.id   || null;
          App.memberSlug = msg.member?.slug || null;
          App.memberName = msg.member?.nickname || null;
        } else {
          App.member     = null;
          App.memberId   = null;
          App.memberSlug = null;
          App.memberName = null;
        }
        updateAuthUI();
        break;

      // --- Project list from listMyProjects() ---
      case 'projects-list':
        renderProjectsList(msg);
        break;

      // --- Save result from saveDrawingProject() ---
      case 'save-result':
        App.saving = false;
        updateSaveStatus();
        if (msg.success) {
          App.dirty = false;
          if (msg.project && msg.project._id) {
            App.currentProjectId = msg.project._id;
          }
          // v3.6.2: remember the just-saved _updatedDate for future stale checks
          if (msg.project && msg.project._updatedDate) {
            App.projectLoadedAt = msg.project._updatedDate;
          }
          updateSaveStatus();
          toast('Saved to your site', 'ok');
          resolveSave({ success: true, project: msg.project });
        } else if (msg.error === 'stale' || msg.stale === true) {
          // v3.6.2: stale-write — show modal instead of scary toast
          showStaleModal(msg);
          resolveSave({ success: false, error: 'stale', stale: msg });
        } else {
          // v3.10.1: detect oversize errors from the server (in case our
          // pre-flight estimate was off — e.g., display PNG, JSON wrapper,
          // or some other contributor pushed past the limit). Surface a
          // clearer message that points the user at the workaround.
          const errStr = String(msg.error || '').toLowerCase();
          const isOversize = errStr.includes('413') ||
                             errStr.includes('too large') ||
                             errStr.includes('payload too large') ||
                             errStr.includes('request entity too large');
          if (isOversize) {
            toast('Project too big for cloud save. Use Save → Download .kpz instead, or remove audio and try again.', 'error');
          } else {
            toast('Save failed: ' + (msg.error || 'unknown'), 'error');
          }
          resolveSave({ success: false, error: msg.error || 'unknown' });
        }
        break;

      // --- Load project from fetchProjectData() ---
      case 'load-project':
        if (msg.success && msg.kpzBase64) {
          const bin = atob(msg.kpzBase64);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          import('./kpz-format.js').then(m => {
            m.loadKpzBlob(new Blob([buf])).then(() => {
              if (msg.project && msg.project._id) {
                App.currentProjectId = msg.project._id;
              }
              // v3.6.2: stash the load timestamp for stale-write detection
              if (msg.project && msg.project._updatedDate) {
                App.projectLoadedAt = msg.project._updatedDate;
              }
            });
          });
        } else if (msg.error) {
          toast('Load failed: ' + msg.error, 'error');
        }
        break;
    }
  });

  window.parent.postMessage({ type: 'app-ready' }, '*');
}

/**
 * v3.6.2: saveToWix now returns a Promise resolving to
 *   { success: true, project } on success
 *   { success: false, error: 'stale', stale } if backend detected stale write
 *   { success: false, error: <string> } on other failures
 * Callers (confirm-leave modal) can await this to sequence navigation.
 */
export function saveToWix() {
  return new Promise(async (resolve) => {
    if (!App.inWix) {
      toast('Not running inside Wix', 'error');
      resolve({ success: false, error: 'not-in-wix' });
      return;
    }
    if (!App.isLoggedIn) {
      window.parent.postMessage({ type: 'request-login' }, '*');
      toast('Please log in to save', 'error');
      resolve({ success: false, error: 'not-logged-in' });
      return;
    }

    // Only one save can be in-flight at a time — if one is still pending,
    // wait for it by queuing resolve after the current one.
    if (pendingSaveResolve) {
      // Drop this attempt: too fast double-click. User will see Saving… and
      // we just resolve with an error so the caller can try again.
      resolve({ success: false, error: 'save-already-in-progress' });
      return;
    }
    pendingSaveResolve = resolve;

    App.saving = true;
    updateSaveStatus();

    try {
      const { serializeKpz } = await import('./kpz-format.js');
      // v3.11.0: cloud saves never carry audio bytes. Audio lives in
      // Wix Media Manager (uploaded at attach-time) and the .kpz meta
      // carries only audioMediaUrl per panel. This keeps the cloud
      // payload small regardless of how much voice-over the user has —
      // 5 minutes of audio per panel doesn't change the save size.
      // Local .kpz downloads (the "Download .kpz" save target) still
      // bundle audio fully via the default serializeKpz() call in modals.js.
      let blob = await serializeKpz({ excludeAudio: true });

      // v3.10.1: defensive size guard kept as safety net even though
      // v3.11.0 should keep payloads small. If excludeAudio:true still
      // somehow exceeds the limit (giant layer PNGs, hundreds of panels),
      // fall back to the same modal flow.
      const SIZE_LIMIT = 3.5 * 1024 * 1024;
      if (blob.size > SIZE_LIMIT) {
        const choice = await showOversizeChoice(blob.size);
        if (choice === 'cancel') {
          App.saving = false;
          updateSaveStatus();
          resolveSave({ success: false, error: 'oversize-cancelled' });
          return;
        }
        if (choice === 'download') {
          // Save the FULL blob locally. Audio is preserved.
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (App.project.name || 'untitled').replace(/[^\w.-]+/g, '_') + '.kpz';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          App.saving = false;
          updateSaveStatus();
          toast('Downloaded .kpz with full audio', 'ok');
          resolveSave({ success: true, downloadedLocally: true });
          return;
        }
        // choice === 'no-audio': re-serialize without audio bytes. Per-panel
        // audioId/audioDuration meta still rides along so the structure
        // round-trips; the audio stays only in this device's IDB.
        blob = await serializeKpz({ excludeAudio: true });
        toast('Saving without audio (audio stays on this device)');
      }

      // Build base64 and send
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const kpzBase64 = btoa(bin);

      const disp = document.getElementById('displayCanvas');
      const pngBase64 = disp ? disp.toDataURL('image/png') : null;

      const payload = {
        projectId:  App.currentProjectId || null,
        kpzBase64,
        pngBase64,
        title:      App.project.name,
        width:      App.project.width,
        height:     App.project.height,
        panelCount: App.project.panels.length,
        layerCount: App.project.panels.reduce((n, p) => n + p.layers.length, 0),
        strokeCount: App.strokeCount || 0,
        // v3.6.2: stale-write detection. Backend compares this to the current
        // _updatedDate in the CMS; mismatch = another tab/device saved first.
        lastLoadedUpdate: App.projectLoadedAt || null,
        // v3.6.2: if user hit "Overwrite anyway" in the stale modal, skip the check
        forceOverwrite: overrideStaleOnce === true,
      };
      overrideStaleOnce = false; // consume the one-shot flag

      window.parent.postMessage({ type: 'save-project', payload }, '*');
    } catch (err) {
      App.saving = false;
      updateSaveStatus();
      toast('Save failed: ' + err.message, 'error');
      resolveSave({ success: false, error: err.message });
    }
  });
}

/**
 * v3.10.1: Promise-based oversize-prompt modal. Resolves to one of:
 *   'no-audio' — user wants cloud save without audio bytes
 *   'download' — user wants local .kpz with full audio
 *   'cancel'   — user dismissed
 *
 * Wires its own click listeners and tears them down on close so repeated
 * opens don't stack handlers. The modal HTML lives in dom.js#oversizeSaveModal.
 */
function showOversizeChoice(blobBytes) {
  return new Promise((resolve) => {
    const modal = document.getElementById('oversizeSaveModal');
    const msg = document.getElementById('oversizeMsg');
    if (!modal) { resolve('cancel'); return; }
    const sizeMB = (blobBytes / (1024 * 1024)).toFixed(1);
    if (msg) {
      msg.innerHTML = `Your project is <b>${sizeMB} MB</b>. Wix's cloud-save limit is about 4 MB. The audio files are taking up most of the space.`;
    }
    modal.classList.add('open');
    const buttons = Array.from(modal.querySelectorAll('[data-oversize]'));
    const cancelBtn = document.getElementById('oversizeCancel');
    const cleanup = () => {
      modal.classList.remove('open');
      buttons.forEach(b => b.removeEventListener('click', onChoice));
      cancelBtn?.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
    };
    const onChoice = (e) => {
      const c = e.currentTarget.dataset.oversize || 'cancel';
      cleanup();
      resolve(c);
    };
    const onCancel = () => { cleanup(); resolve('cancel'); };
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    buttons.forEach(b => b.addEventListener('click', onChoice));
    cancelBtn?.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
  });
}

// ============================================================================
//  Internal helpers — stale-write modal + save-promise resolver
// ============================================================================

/** Resolve whatever save is in-flight and clear the pending slot. */
function resolveSave(result) {
  const r = pendingSaveResolve;
  pendingSaveResolve = null;
  if (r) r(result);
}

function showStaleModal(msg) {
  const el = $('staleWriteMsg');
  if (el) {
    let text = 'This project was updated in another tab, window, or device since you opened it.';
    if (msg?.updatedBy) text += ` Last edit by: ${msg.updatedBy}.`;
    text += ' Saving now would overwrite those changes.';
    el.textContent = text;
  }
  $('staleWriteModal')?.classList.add('open');
}

function closeStaleModal() {
  $('staleWriteModal')?.classList.remove('open');
}

function onStaleReload() {
  // Reload whichever project is currently open, discarding local changes
  closeStaleModal();
  if (!App.currentProjectId) {
    toast('No cloud project to reload', 'error');
    return;
  }
  App.dirty = false; // don't get asked about unsaved changes during reload
  updateSaveStatus();
  window.parent.postMessage({
    type: 'open-project',
    projectId: App.currentProjectId,
  }, '*');
}

function onStaleOverwrite() {
  // User wants to force-overwrite. Set the one-shot flag and trigger a new
  // save. The stale check on the backend will be skipped for this one save.
  closeStaleModal();
  overrideStaleOnce = true;
  saveToWix().then((r) => {
    if (r.success) toast('Overwrote latest with your version', 'ok');
  });
}
