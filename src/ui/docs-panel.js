// src/ui/docs-panel.js
// v3.5.2: multiple named script links per project, saved to IndexedDB.
import { App } from '../core/state.js';
import { $, escapeHtml } from '../utils/dom-helpers.js';
import { idbSet, idbGet } from '../utils/idb.js';
import { toast } from './toast.js';

let scripts = [];
let activeScriptId = null;

export async function initDocsPanel() {
  scripts = (await idbGet('kpz_scripts')) || [];
  renderScriptList();

  $('btnDocAdd')?.addEventListener('click', addScript);
  $('btnDocZoomIn')?.addEventListener('click', () => bumpZoom(0.1));
  $('btnDocZoomOut')?.addEventListener('click', () => bumpZoom(-0.1));
  $('btnDocZoomReset')?.addEventListener('click', () => setDocZoom(1));
  $('btnDocExpand')?.addEventListener('click', () => $('rightPanel')?.classList.toggle('docs-expanded'));

  const savedZoom = localStorage.getItem('kpz_doc_zoom');
  if (savedZoom) setDocZoom(parseFloat(savedZoom));

  const lastActive = localStorage.getItem('kpz_script_active');
  if (lastActive && scripts.find(s => s.id === lastActive)) selectScript(lastActive);
  else if (scripts[0]) selectScript(scripts[0].id);
}

function bumpZoom(delta) {
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--doc-zoom')) || 1;
  setDocZoom(cur + delta);
}

async function addScript() {
  const url = prompt('Paste Google Doc share link (Anyone with link can view):');
  if (!url) return;
  const label = prompt('Label for this script (e.g. "Episode 1", "Scene draft"):', 'Script ' + (scripts.length + 1));
  if (!label) return;
  const id = 'S' + Math.random().toString(36).slice(2, 9);
  scripts.push({ id, label: label.trim(), url: url.trim() });
  await idbSet('kpz_scripts', scripts);
  renderScriptList();
  selectScript(id);
  toast('Script added', 'ok');
}

async function deleteScript(id) {
  if (!confirm('Remove this script link?')) return;
  scripts = scripts.filter(s => s.id !== id);
  await idbSet('kpz_scripts', scripts);
  if (activeScriptId === id) {
    activeScriptId = null;
    loadDoc('');
  }
  renderScriptList();
}

function selectScript(id) {
  const s = scripts.find(x => x.id === id);
  if (!s) return;
  activeScriptId = id;
  localStorage.setItem('kpz_script_active', id);
  loadDoc(s.url);
  renderScriptList();
}

function renderScriptList() {
  const list = $('scriptList');
  if (!list) return;
  if (scripts.length === 0) {
    list.innerHTML = '<div class="hint" style="padding:8px 0">No scripts yet. Click <b>+ Add Script</b>.</div>';
    return;
  }
  list.innerHTML = scripts.map(s => `
    <div class="script-item ${s.id === activeScriptId ? 'active' : ''}" data-id="${s.id}">
      <span class="script-label" title="${escapeHtml(s.url)}">${escapeHtml(s.label)}</span>
      <button class="script-del" data-id="${s.id}" title="Remove">✕</button>
    </div>`).join('');
  list.querySelectorAll('.script-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.script-del')) return;
      selectScript(el.dataset.id);
    });
  });
  list.querySelectorAll('.script-del').forEach(b => {
    b.addEventListener('click', e => { e.stopPropagation(); deleteScript(b.dataset.id); });
  });
}

function loadDoc(url) {
  const frame = $('docFrame');
  if (!frame) return;
  if (!url) { frame.src = 'about:blank'; return; }
  let embed = url;
  if (url.includes('docs.google.com/document')) {
    embed = url.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
    if (!embed.endsWith('/preview')) embed = embed.replace(/\/$/, '') + '/preview';
  }
  frame.src = embed;
}

export function setDocZoom(v) {
  v = Math.max(0.5, Math.min(2.5, v));
  document.documentElement.style.setProperty('--doc-zoom', v);
  const valEl = $('docZoomVal');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  localStorage.setItem('kpz_doc_zoom', v);
}
