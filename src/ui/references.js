// src/ui/references.js
// Left panel references list: add, remove, size slider, drag-and-drop.

import { App } from '../core/state.js';
import { $, escapeHtml } from '../utils/dom-helpers.js';
import { openRefViewer } from './ref-viewer.js';
import { idbSet } from '../utils/idb.js';
import { updateSaveStatus } from './topbar.js';

export function initReferences() {
  $('btnAddRef')?.addEventListener('click', () => $('refFileInput')?.click());

  $('refFileInput')?.addEventListener('change', e => {
    for (const f of e.target.files) addReference(f);
    e.target.value = '';
  });

  $('refSize')?.addEventListener('input', e => {
    document.documentElement.style.setProperty('--ref-max-height', e.target.value + 'px');
    localStorage.setItem('kpz_ref_size', e.target.value);
  });

  // Restore saved size
  const savedRefSize = localStorage.getItem('kpz_ref_size');
  if (savedRefSize) {
    document.documentElement.style.setProperty('--ref-max-height', savedRefSize + 'px');
    const slider = $('refSize');
    if (slider) slider.value = savedRefSize;
  }

  // Drag-and-drop images onto canvas area
  const canvasArea = $('canvasArea');
  canvasArea?.addEventListener('dragover', e => e.preventDefault());
  canvasArea?.addEventListener('drop', e => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) {
      if (f.type.startsWith('image/')) addReference(f);
    }
  });
}

export function addReference(file) {
  const reader = new FileReader();
  reader.onload = e => {
    if (!App.project) return;
    App.project.refs.push({ id: 'R' + Math.random().toString(36).slice(2, 9), data: e.target.result, name: file.name });
    renderRefs();
    persistRefs();
    App.dirty = true; updateSaveStatus();
  };
  reader.readAsDataURL(file);
}

export function renderRefs() {
  const list = $('refList');
  const empty = $('refEmpty');
  if (!list) return;
  list.innerHTML = '';
  const refs = App.project?.refs || [];
  if (empty) empty.style.display = refs.length === 0 ? 'block' : 'none';

  refs.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'ref-item';
    el.innerHTML = `
      <img src="${r.data}" alt="${escapeHtml(r.name || '')}" loading="lazy">
      <div class="ref-name">${escapeHtml(r.name || 'reference')}</div>
      <button class="ref-del" data-i="${i}" title="Remove">✕</button>`;
    el.addEventListener('click', e => {
      if (e.target.closest('.ref-del')) return;
      openRefViewer(i);
    });
    list.appendChild(el);
  });

  list.querySelectorAll('.ref-del').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      App.project.refs.splice(+b.dataset.i, 1);
      renderRefs();
      persistRefs();
      App.dirty = true; updateSaveStatus();
    });
  });
}

async function persistRefs() {
  try { await idbSet('kpz_refs', App.project?.refs || []); }
  catch (err) { console.warn('Failed to persist refs:', err); }
}
