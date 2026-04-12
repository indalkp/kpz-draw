// src/storage/psd-export.js
// PSD export via the ag-psd library loaded by bootstrap-embed.html.

import { App } from '../core/state.js';
import { curPanel } from '../drawing/panels.js';

export function exportPsdBlob() {
  if (typeof window.agPsd === 'undefined') {
    throw new Error('ag-psd library not loaded');
  }
  const panel = curPanel();
  const psd = {
    width: App.project.width,
    height: App.project.height,
    children: panel.layers.map(l => ({
      name: l.name,
      canvas: l.canvas,
      hidden: !l.visible,    // ag-psd inverts visibility: hidden=true means invisible
      opacity: Math.round(l.opacity * 255),
    })),
  };
  const buffer = window.agPsd.writePsd(psd);
  return new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
}
