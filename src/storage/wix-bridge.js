// src/storage/wix-bridge.js
// PostMessage bridge between the iframe and the Wix Velo page code.
//
// v3.5.1 FIX (login/save regression):
// Message type names must match what Velo sends/expects:
//   Iframe → Velo: 'app-ready', 'save-project', 'list-projects',
//                  'open-project', 'request-login'
//   Velo   → Iframe: 'auth-info', 'load-project', 'save-result',
//                    'projects-list'
// Previous version used 'iframe-ready', 'auth-state', 'project-loaded'
// which Velo never listens for / never sends, so auth and load silently
// failed.

import { App } from '../core/state.js';
import { updateAuthUI, updateSaveStatus } from '../ui/topbar.js';
import { toast } from './toast-bridge.js';
import { renderProjectsList } from '../ui/projects-panel.js';

export function initWixBridge() {
  App.inWix = window.parent !== window;
  if (!App.inWix) return;

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      // --- Auth state from Velo ---
      case 'auth-info':
        App.isLoggedIn = !!msg.loggedIn;
        App.member     = msg.member || null;
        App.memberId   = msg.member?.id   || null;
        App.memberSlug = msg.member?.slug || null;
        App.memberName = msg.member?.nickname || null;
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
          // Backend returns the full saved record under msg.project
          if (msg.project && msg.project._id) {
            App.currentProjectId = msg.project._id;
          }
          updateSaveStatus();
          toast('Saved to your site', 'ok');
        } else {
          toast('Save failed: ' + (msg.error || 'unknown'), 'error');
        }
        break;

      // --- Load project from fetchProjectData() ---
      // Backend returns { success, project, kpzBase64 }
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
            });
          });
        } else if (msg.error) {
          toast('Load failed: ' + msg.error, 'error');
        }
        break;
    }
  });

  // Tell Velo the iframe is ready — Velo listens for 'app-ready'
  window.parent.postMessage({ type: 'app-ready' }, '*');
}

export async function saveToWix() {
  if (!App.inWix) { toast('Not running inside Wix', 'error'); return; }
  if (!App.isLoggedIn) {
    // Ask Velo to open the login prompt
    window.parent.postMessage({ type: 'request-login' }, '*');
    toast('Please log in to save', 'error');
    return;
  }
  App.saving = true;
  updateSaveStatus();
  try {
    const { serializeKpz } = await import('./kpz-format.js');
    const blob = await serializeKpz();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const kpzBase64 = btoa(bin);

    const disp = document.getElementById('displayCanvas');
    const pngBase64 = disp ? disp.toDataURL('image/png') : null;

    // Payload must match backend saveDrawingProject() signature:
    //   { projectId, kpzBase64, pngBase64, title, width, height,
    //     panelCount, layerCount, description, tags }
    const payload = {
      projectId:  App.currentProjectId || null,
      kpzBase64,
      pngBase64,
      title:      App.project.name,
      width:      App.project.width,
      height:     App.project.height,
      panelCount: App.project.panels.length,
      layerCount: App.project.panels.reduce((n, p) => n + p.layers.length, 0),
    };

    window.parent.postMessage({ type: 'save-project', payload }, '*');
  } catch (err) {
    App.saving = false;
    updateSaveStatus();
    toast('Save failed: ' + err.message, 'error');
  }
}
