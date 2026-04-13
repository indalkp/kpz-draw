// src/ui/topbar.js
// Top bar: File/Edit/View menus, save/open buttons, undo/redo, auth display.

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';
import { undo, redo } from '../drawing/history.js';
import { fitView, applyView } from '../drawing/view.js';
import { addPanel, deletePanel } from './panel-nav.js';
import { confirmLeaveIfDirty } from './confirm-leave.js';

export function initTopbar() {
  $('btnUndo')?.addEventListener('click', undo);
  $('btnRedo')?.addEventListener('click', redo);
  $('btnNew')?.addEventListener('click', async () => {
    // v3.6.2: creating a new project replaces the current one — dirty-check first
    if (!(await confirmLeaveIfDirty({ context: 'new project' }))) return;
    $('newModal')?.classList.add('open');
  });
  $('btnOpen')?.addEventListener('click', async () => {
    // v3.6.2: opening a file replaces the current project — dirty-check first
    if (!(await confirmLeaveIfDirty({ context: 'opening another file' }))) return;
    $('fileInput')?.click();
  });
  $('btnSave')?.addEventListener('click', () => $('saveModal')?.classList.add('open'));
  $('btnAddPanel')?.addEventListener('click', addPanel);
  $('btnDelPanel')?.addEventListener('click', deletePanel);
  $('btnFit')?.addEventListener('click', () => fitView());
  $('btnFullscreen')?.addEventListener('click', toggleFullscreen);
  $('exitFullscreen')?.addEventListener('click', toggleFullscreen);
  $('btnHelp')?.addEventListener('click', () => $('helpOverlay')?.classList.add('open'));
  $('helpClose')?.addEventListener('click', () => $('helpOverlay')?.classList.remove('open'));
  $('helpOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'helpOverlay') $('helpOverlay').classList.remove('open');
  });
  $('authBox')?.addEventListener('click', (e) => {
    if (!App.isLoggedIn) { requestLogin(); return; }
    $('profileMenu')?.classList.toggle('open');
    e.stopPropagation();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#authBox') && !e.target.closest('#profileMenu')) {
      $('profileMenu')?.classList.remove('open');
    }
  });
  $('pmDashboard')?.addEventListener('click', async () => {
    $('profileMenu')?.classList.remove('open');
    // v3.6.2: prompt before losing unsaved work on navigation
    if (!(await confirmLeaveIfDirty({ context: 'dashboard' }))) return;
    if (App.inWix) window.parent.postMessage({ type: 'nav-dashboard' }, '*');
  });
  $('pmMyWork')?.addEventListener('click', () => {
    // Tab switch — doesn't leave the page or discard work, no dirty-check needed
    document.querySelector('.tab-btn[data-tab="projects"]')?.click();
    $('profileMenu')?.classList.remove('open');
  });
  $('pmLogout')?.addEventListener('click', async () => {
    $('profileMenu')?.classList.remove('open');
    // v3.6.2: logging out without saving would lose work on next load
    if (!(await confirmLeaveIfDirty({ context: 'logout' }))) return;
    if (App.inWix) window.parent.postMessage({ type: 'request-logout' }, '*');
  });

  // Mobile panel toggles
  $('toggleLeft')?.addEventListener('click', () => {
    $('leftPanel')?.classList.toggle('open');
    $('rightPanel')?.classList.remove('open');
    $('panelBackdrop')?.classList.toggle('show', $('leftPanel')?.classList.contains('open'));
  });
  $('toggleRight')?.addEventListener('click', () => {
    $('rightPanel')?.classList.toggle('open');
    $('leftPanel')?.classList.remove('open');
    $('panelBackdrop')?.classList.toggle('show', $('rightPanel')?.classList.contains('open'));
  });
  $('panelBackdrop')?.addEventListener('click', () => {
    $('leftPanel')?.classList.remove('open');
    $('rightPanel')?.classList.remove('open');
    $('panelBackdrop')?.classList.remove('show');
  });

  // Panel resize handles
  setupResizeHandle('resizeLeft', 'left');
  setupResizeHandle('resizeRight', 'right');

  // Tabs
  $$('.tab-btn').forEach(b => {
    b.addEventListener('click', () => {
      $$('.tab-btn').forEach(x => x.classList.toggle('active', x === b));
      $$('.tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === b.dataset.tab));
      if (b.dataset.tab === 'projects') {
        import('./projects-panel.js').then(m => m.requestProjectsList?.());
      }
    });
  });
}

export function updateSaveStatus() {
  const s = $('saveStatus');
  if (!s) return;
  s.classList.remove('saving');
  if (App.saving) {
    s.textContent = '● Saving…';
    s.classList.add('saving');
    return;
  }
  if (App.dirty) {
    s.textContent = '● Unsaved';
    s.classList.add('dirty');
  } else {
    s.textContent = '● Saved';
    s.classList.remove('dirty');
  }
}

export function updateAuthUI() {
  const box = $('authBox');
  const name = $('authName');
  const avatar = $('authAvatar');
  if (!box) return;
  if (App.isLoggedIn && App.member) {
    box.classList.remove('logged-out');
    box.classList.add('logged-in');
    if (name) { name.textContent = App.member.nickname || 'Member'; name.classList.remove('prompt'); }
    if (avatar && App.member.avatar) avatar.style.backgroundImage = `url('${App.member.avatar}')`;
    const statusEl = $('projectsStatus');
    if (statusEl) statusEl.textContent = 'Click "My Work" tab to see your projects';
    const refreshBtn = $('btnRefreshProjects');
    if (refreshBtn) refreshBtn.style.display = 'block';
  } else {
    box.classList.add('logged-out');
    box.classList.remove('logged-in');
    if (name) { name.textContent = 'Log in to save'; name.classList.add('prompt'); }
    if (avatar) avatar.style.backgroundImage = '';
  }
}

function toggleFullscreen() {
  document.body.classList.toggle('fullscreen');
  if (App.project) requestAnimationFrame(applyView);
}

function requestLogin() {
  if (App.inWix) window.parent.postMessage({ type: 'request-login' }, '*');
  else { import('./toast.js').then(m => m.toast('Log in via the Wix site header', 'error')); }
}

function setupResizeHandle(handleId, panelSide) {
  const handle = $(handleId);
  if (!handle) return;
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('pointerdown', e => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    startX = e.clientX;
    startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(
      panelSide === 'left' ? '--leftW' : '--rightW'
    ));
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const newW = panelSide === 'left'
      ? Math.max(180, Math.min(500, startW + delta))
      : Math.max(220, Math.min(640, startW - delta));
    document.documentElement.style.setProperty(panelSide === 'left' ? '--leftW' : '--rightW', newW + 'px');
    if (App.project) requestAnimationFrame(applyView);
  });
  handle.addEventListener('pointerup', e => {
    dragging = false;
    handle.classList.remove('dragging');
    const newW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(
      panelSide === 'left' ? '--leftW' : '--rightW'
    ));
    localStorage.setItem(panelSide === 'left' ? 'kpz_leftW' : 'kpz_rightW', newW);
  });
  handle.addEventListener('dblclick', () => {
    document.documentElement.style.setProperty(
      panelSide === 'left' ? '--leftW' : '--rightW',
      panelSide === 'left' ? '260px' : '300px'
    );
    localStorage.removeItem(panelSide === 'left' ? 'kpz_leftW' : 'kpz_rightW');
    if (App.project) requestAnimationFrame(applyView);
  });
}
