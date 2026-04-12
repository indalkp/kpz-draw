// src/storage/wix-bridge.js
// PostMessage bridge between the iframe and the Wix Velo page code.

import { App } from '../core/state.js';
import { updateAuthUI, updateSaveStatus } from '../ui/topbar.js';
import { toast } from '../ui/toast.js';
import { renderProjectsList } from '../ui/projects-panel.js';

export function initWixBridge() {
  App.inWix = window.parent !== window;
  if (!App.inWix) return;

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'auth-state':
        App.isLoggedIn = !!msg.isLoggedIn;
        App.member = msg.member || null;
        App.memberId = msg.member?._id || null;
        App.memberSlug = msg.member?.slug || null;
        updateAuthUI();
        break;
      case 'projects-list':
        renderProjectsList(msg);
        break;
      case 'save-result':
        App.saving = false; updateSaveStatus();
        if (msg.success) {
          App.dirty = false; updateSaveStatus();
          App.currentProjectId = msg.projectId || App.currentProjectId;
          toast('Saved to your site', 'ok');
        } else { toast('Save failed: ' + (msg.error || 'unknown'), 'error'); }
        break;
      case 'project-loaded':
        if (msg.kpzBase64) {
          const bin = atob(msg.kpzBase64);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          import('./kpz-format.js').then(m => m.loadKpzBlob(new Blob([buf])));
        }
        break;
    }
  });

  window.parent.postMessage({ type: 'iframe-ready' }, '*');
}

export async function saveToWix() {
  if (!App.inWix) { toast('Not running inside Wix', 'error'); return; }
  if (!App.isLoggedIn) { toast('Log in first', 'error'); return; }
  App.saving = true; updateSaveStatus();
  try {
    const { serializeKpz } = await import('./kpz-format.js');
    const blob = await serializeKpz();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const kpzBase64 = btoa(bin);
    const disp = document.getElementById('displayCanvas');
    const thumbnail = disp ? disp.toDataURL('image/png') : null;
    window.parent.postMessage({
      type: 'save-project', kpzBase64, thumbnail,
      projectId: App.currentProjectId,
      meta: {
        title: App.project.name, width: App.project.width, height: App.project.height,
        panelCount: App.project.panels.length,
        layerCount: App.project.panels.reduce((n, p) => n + p.layers.length, 0),
      },
    }, '*');
  } catch (err) {
    App.saving = false; updateSaveStatus();
    toast('Save failed: ' + err.message, 'error');
  }
}
