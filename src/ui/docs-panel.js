// src/ui/docs-panel.js
// Right panel Script tab: embed a Google Doc with zoom + persistence.

import { $ } from '../utils/dom-helpers.js';

export function initDocsPanel() {
  $('docUrl')?.addEventListener('change', e => loadDoc(e.target.value.trim()));
  $('docUrl')?.addEventListener('paste', () => {
    setTimeout(() => loadDoc($('docUrl').value.trim()), 10);
  });
  let inputTimer = null;
  $('docUrl')?.addEventListener('input', e => {
    if (inputTimer) clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      const url = e.target.value.trim();
      if (url) localStorage.setItem('kpz_doc_url', url);
    }, 600);
  });

  $('btnDocZoomIn')?.addEventListener('click', () => {
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--doc-zoom')) || 1;
    setDocZoom(cur + 0.1);
  });
  $('btnDocZoomOut')?.addEventListener('click', () => {
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--doc-zoom')) || 1;
    setDocZoom(cur - 0.1);
  });
  $('btnDocZoomReset')?.addEventListener('click', () => setDocZoom(1));
  $('btnDocClear')?.addEventListener('click', () => {
    const inp = $('docUrl'); if (inp) inp.value = '';
    loadDoc('');
    localStorage.removeItem('kpz_doc_url');
  });
  $('btnDocExpand')?.addEventListener('click', () => {
    $('rightPanel')?.classList.toggle('docs-expanded');
  });

  // Restore zoom on init
  const savedZoom = localStorage.getItem('kpz_doc_zoom');
  if (savedZoom) setDocZoom(parseFloat(savedZoom));
}

export function loadDoc(url) {
  const frame = $('docFrame');
  if (!frame) return;
  if (!url) { frame.src = 'about:blank'; return; }
  let embed = url;
  if (url.includes('docs.google.com/document')) {
    embed = url.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
    if (!embed.endsWith('/preview')) embed = embed.replace(/\/$/, '') + '/preview';
  }
  frame.src = embed;
  localStorage.setItem('kpz_doc_url', url);
}

export function setDocZoom(v) {
  v = Math.max(0.5, Math.min(2.5, v));
  document.documentElement.style.setProperty('--doc-zoom', v);
  const valEl = $('docZoomVal');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  localStorage.setItem('kpz_doc_zoom', v);
}
