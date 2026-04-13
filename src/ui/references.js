// src/ui/references.js
//
// v3.6.1: project-scoped persistence (see storage/persistent-refs.js).
//         Adds a "📁 Library" button that opens library-modal.js so the user
//         can pull refs from past projects into the current one.
//
// v3.5.2 history: drag-and-drop, reorder, export/import JSON.
// v3.5.4 history: image compression on add (max 1600px, JPEG q=0.85).

import { App } from '../core/state.js';
import { $, escapeHtml } from '../utils/dom-helpers.js';
import { openRefViewer } from './ref-viewer.js';
import { idbSet } from '../utils/idb.js';
import { updateSaveStatus } from './topbar.js';
import { toast } from './toast.js';
import { openLibraryModal } from './library-modal.js';
import {
  currentRefsKey,
  currentProjectKey,
  updateRefIndexEntry,
} from '../storage/persistent-refs.js';

export function initReferences() {
  $('btnAddRef')?.addEventListener('click', () => $('refFileInput')?.click());
  $('btnExportRefs')?.addEventListener('click', exportRefs);
  $('btnImportRefs')?.addEventListener('click', () => $('refImportInput')?.click());
  // v3.6.1: new Library button opens the past-project refs modal
  $('btnRefLibrary')?.addEventListener('click', openLibraryModal);

  $('refFileInput')?.addEventListener('change', e => {
    for (const f of e.target.files) addReference(f);
    e.target.value = '';
  });

  $('refImportInput')?.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) importRefs(f);
    e.target.value = '';
  });

  $('refSize')?.addEventListener('input', e => {
    document.documentElement.style.setProperty('--ref-max-height', e.target.value + 'px');
    localStorage.setItem('kpz_ref_size', e.target.value);
  });

  const savedRefSize = localStorage.getItem('kpz_ref_size');
  if (savedRefSize) {
    document.documentElement.style.setProperty('--ref-max-height', savedRefSize + 'px');
    const slider = $('refSize');
    if (slider) slider.value = savedRefSize;
  }

  attachDropZone($('canvasArea'));
  attachDropZone($('refList'));
  attachDropZone($('leftPanel'));
}

function attachDropZone(el) {
  if (!el) return;
  el.addEventListener('dragover', e => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      el.classList.add('drag-over');
    }
  });
  el.addEventListener('dragleave', e => {
    if (e.target === el) el.classList.remove('drag-over');
  });
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    for (const f of e.dataTransfer.files) {
      if (f.type.startsWith('image/')) addReference(f);
    }
  });
}

export function addReference(file) {
  compressImageFile(file, 1600, 0.85).then(dataUrl => {
    if (!App.project) return;
    App.project.refs.push({
      id: 'R' + Math.random().toString(36).slice(2, 9),
      data: dataUrl,
      name: file.name,
    });
    renderRefs();
    persistRefs();
    App.dirty = true; updateSaveStatus();
  }).catch(err => {
    toast('Could not add reference: ' + err.message, 'error');
  });
}

// v3.6.1: external helper used by library-modal to append imported refs.
// Pushes each ref (with a new id to avoid collisions) and persists.
export function importRefsFromLibrary(refs) {
  if (!App.project || !Array.isArray(refs) || refs.length === 0) return 0;
  let added = 0;
  for (const r of refs) {
    if (!r || !r.data) continue;
    App.project.refs.push({
      id: 'R' + Math.random().toString(36).slice(2, 9),
      data: r.data,
      name: r.name || 'reference',
    });
    added++;
  }
  if (added > 0) {
    renderRefs();
    persistRefs();
    App.dirty = true; updateSaveStatus();
  }
  return added;
}

function compressImageFile(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const longEdge = Math.max(img.width, img.height);
        const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Invalid image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
    el.draggable = true;
    el.dataset.idx = i;
    el.innerHTML = `
      <img src="${r.data}" alt="${escapeHtml(r.name || '')}" loading="lazy">
      <div class="ref-name">${escapeHtml(r.name || 'reference')}</div>
      <button class="ref-del" data-i="${i}" title="Remove">✕</button>`;

    el.addEventListener('click', e => {
      if (e.target.closest('.ref-del')) return;
      openRefViewer(i);
    });

    el.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/kpz-ref-idx', String(i));
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('text/kpz-ref-idx')) {
        e.preventDefault();
        el.classList.add('drop-target');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', e => {
      const from = parseInt(e.dataTransfer.getData('text/kpz-ref-idx'));
      el.classList.remove('drop-target');
      if (isNaN(from) || from === i) return;
      e.preventDefault();
      e.stopPropagation();
      const [moved] = App.project.refs.splice(from, 1);
      App.project.refs.splice(i, 0, moved);
      renderRefs();
      persistRefs();
      App.dirty = true; updateSaveStatus();
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

/**
 * v3.6.1: writes refs to the current project's scoped bucket and updates
 * the ref index so the library modal can show this project's ref set.
 */
async function persistRefs() {
  try {
    const refs = App.project?.refs || [];
    await idbSet(currentRefsKey(), refs);
    await updateRefIndexEntry(currentProjectKey(), {
      title: App.project?.name || 'Untitled',
      count: refs.length,
    });
  } catch (err) {
    console.warn('Failed to persist refs:', err);
  }
}

// Exposed for modules that mutate refs without going through addReference,
// e.g. kpz-format.js after loading a project.
export { persistRefs };

function exportRefs() {
  const refs = App.project?.refs || [];
  if (refs.length === 0) { toast('No references to export', 'error'); return; }
  const blob = new Blob(
    [JSON.stringify({ kpz: 'refs-v1', refs }, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kpz-refs-${Date.now()}.json`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${refs.length} reference${refs.length > 1 ? 's' : ''}`, 'ok');
}

async function importRefs(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (parsed.kpz !== 'refs-v1' || !Array.isArray(parsed.refs)) {
      toast('Not a valid KPZ refs file', 'error'); return;
    }
    if (!App.project) return;
    for (const r of parsed.refs) App.project.refs.push(r);
    renderRefs();
    persistRefs();
    App.dirty = true; updateSaveStatus();
    toast(`Imported ${parsed.refs.length} reference${parsed.refs.length > 1 ? 's' : ''}`, 'ok');
  } catch (err) {
    toast('Import failed: ' + err.message, 'error');
  }
}
