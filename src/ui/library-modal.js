// src/ui/library-modal.js
//
// v3.6.1: Reference Library modal.
//
// What it does:
//   Lists every ref bucket saved on this device (i.e. refs from past projects
//   the user has opened or saved). User picks a bucket, selects individual
//   refs (checkboxes), and imports them into the current project.
//
// Where the data comes from:
//   IndexedDB key "kpz_ref_index" is maintained by persistent-refs.js and
//   references.js. Each entry: { [projectKey]: { title, count, updatedAt } }.
//   The actual refs for each bucket live at "kpz_refs::<projectKey>".
//
// Not connected to Wix:
//   This is a local (per-device) library. It grows as the user opens/saves
//   projects. No backend round-trips needed, which also means no new Velo
//   page-code changes required for this feature.

import { $, escapeHtml } from '../utils/dom-helpers.js';
import { toast } from './toast.js';
import {
  getRefIndex,
  readRefsBucket,
  deleteRefBucket,
  currentProjectKey,
} from '../storage/persistent-refs.js';
import { importRefsFromLibrary } from './references.js';

// Module-local state while the modal is open
let activeBucketKey = null;   // which project's refs are currently shown
let activeBucketRefs = [];    // the refs array of the active bucket
let selectedIds = new Set();  // ids of refs the user has ticked

// ---------- public API ----------

/** Called by references.js when the 📁 Library button is clicked. */
export async function openLibraryModal() {
  const modal = $('refLibraryModal');
  if (!modal) return;
  modal.classList.add('open');
  await renderBucketList();
}

export function initLibraryModal() {
  $('refLibraryClose')?.addEventListener('click', closeModal);
  $('refLibraryCancel')?.addEventListener('click', closeModal);
  $('refLibraryImport')?.addEventListener('click', doImportSelected);
  $('refLibraryDelete')?.addEventListener('click', doDeleteActiveBucket);
  $('refLibrarySelectAll')?.addEventListener('click', selectAll);
  $('refLibraryBack')?.addEventListener('click', backToBucketList);
}

// ---------- list of buckets ----------

async function renderBucketList() {
  activeBucketKey = null;
  activeBucketRefs = [];
  selectedIds.clear();

  // Show bucket-list view, hide refs-grid view
  $('refLibraryBuckets').style.display = 'block';
  $('refLibraryRefs').style.display = 'none';
  $('refLibraryTitle').textContent = 'Reference Library';
  $('refLibraryImport').style.display = 'none';
  $('refLibraryDelete').style.display = 'none';
  $('refLibrarySelectAll').style.display = 'none';
  $('refLibraryBack').style.display = 'none';

  const list = $('refLibraryBuckets');
  list.innerHTML = '<div class="lib-loading">Loading…</div>';

  const idx = await getRefIndex();
  // Current project is hidden from the library — no point importing into itself
  const currentKey = currentProjectKey();
  const entries = Object.entries(idx)
    .filter(([key]) => key !== currentKey)
    .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="lib-empty">
        <p>Your reference library is empty.</p>
        <p style="font-size:13px;color:#888">
          As you save or open projects with references, they'll show up here
          and you can re-use their refs in new projects.
        </p>
      </div>`;
    return;
  }

  list.innerHTML = '';
  for (const [key, meta] of entries) {
    const count = meta.count || 0;
    const title = meta.title || 'Untitled';
    const when = formatRelative(meta.updatedAt);

    const card = document.createElement('button');
    card.className = 'lib-bucket-card';
    card.innerHTML = `
      <div class="lib-bucket-icon">📁</div>
      <div class="lib-bucket-info">
        <div class="lib-bucket-title">${escapeHtml(title)}</div>
        <div class="lib-bucket-meta">${count} ref${count === 1 ? '' : 's'} · ${when}</div>
      </div>
      <div class="lib-bucket-chev">›</div>`;
    card.addEventListener('click', () => openBucket(key, title));
    list.appendChild(card);
  }
}

// ---------- refs grid for one bucket ----------

async function openBucket(projectKey, title) {
  activeBucketKey = projectKey;
  selectedIds.clear();

  // Switch to refs-grid view
  $('refLibraryBuckets').style.display = 'none';
  $('refLibraryRefs').style.display = 'block';
  $('refLibraryTitle').textContent = title;
  $('refLibraryImport').style.display = '';
  $('refLibraryDelete').style.display = '';
  $('refLibrarySelectAll').style.display = '';
  $('refLibraryBack').style.display = '';
  updateImportButton();

  const grid = $('refLibraryRefs');
  grid.innerHTML = '<div class="lib-loading">Loading refs…</div>';

  activeBucketRefs = await readRefsBucket(projectKey);
  if (activeBucketRefs.length === 0) {
    grid.innerHTML = `<div class="lib-empty"><p>This set has no references.</p></div>`;
    return;
  }

  grid.innerHTML = '';
  activeBucketRefs.forEach((r, i) => {
    const refId = r.id || ('idx-' + i);
    const card = document.createElement('label');
    card.className = 'lib-ref-card';
    card.innerHTML = `
      <input type="checkbox" data-id="${escapeHtml(refId)}">
      <img src="${r.data}" alt="${escapeHtml(r.name || '')}" loading="lazy">
      <div class="lib-ref-name">${escapeHtml(r.name || 'reference')}</div>`;
    const cb = card.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(refId);
      else selectedIds.delete(refId);
      card.classList.toggle('selected', cb.checked);
      updateImportButton();
    });
    grid.appendChild(card);
  });
}

function backToBucketList() {
  renderBucketList();
}

function selectAll() {
  const cards = $('refLibraryRefs').querySelectorAll('.lib-ref-card');
  // If all are already selected, deselect all (toggle behaviour)
  const allSelected = selectedIds.size === activeBucketRefs.length;
  selectedIds.clear();
  cards.forEach((card, i) => {
    const cb = card.querySelector('input');
    if (!cb) return;
    cb.checked = !allSelected;
    card.classList.toggle('selected', !allSelected);
    if (!allSelected) {
      const id = activeBucketRefs[i].id || ('idx-' + i);
      selectedIds.add(id);
    }
  });
  updateImportButton();
}

function updateImportButton() {
  const btn = $('refLibraryImport');
  if (!btn) return;
  const n = selectedIds.size;
  btn.disabled = n === 0;
  btn.textContent = n === 0
    ? 'Select refs to import'
    : `Import ${n} ref${n === 1 ? '' : 's'} into current project`;
}

// ---------- actions ----------

function doImportSelected() {
  const toImport = activeBucketRefs.filter((r, i) => {
    const id = r.id || ('idx-' + i);
    return selectedIds.has(id);
  });
  if (toImport.length === 0) return;
  const added = importRefsFromLibrary(toImport);
  toast(`Imported ${added} reference${added === 1 ? '' : 's'}`, 'ok');
  closeModal();
}

async function doDeleteActiveBucket() {
  if (!activeBucketKey) return;
  const idx = await getRefIndex();
  const title = idx[activeBucketKey]?.title || 'this set';
  const ok = confirm(`Delete saved refs for "${title}"?\n\nThis only removes the refs from your local library. The project itself (on your Wix site) is not affected.`);
  if (!ok) return;
  await deleteRefBucket(activeBucketKey);
  toast('Ref set deleted from library', 'ok');
  await renderBucketList();
}

function closeModal() {
  $('refLibraryModal')?.classList.remove('open');
  activeBucketKey = null;
  activeBucketRefs = [];
  selectedIds.clear();
}

// ---------- small helpers ----------

function formatRelative(ts) {
  if (!ts) return 'unknown';
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  const years = Math.floor(months / 12);
  return `${years} yr${years === 1 ? '' : 's'} ago`;
}
