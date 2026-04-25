// src/ui/topbar.js
// Top bar: File/Edit/View menus, save/open buttons, undo/redo, auth display.

import { App } from '../core/state.js';
import { $, $$ } from '../utils/dom-helpers.js';
import { undo, redo } from '../drawing/history.js';
import { fitView, applyView, renderDisplay } from '../drawing/view.js';
import { addPanel, deletePanel } from './panel-nav.js';
import { confirmLeaveIfDirty } from './confirm-leave.js';
// v3.8.2: keep the mobile more-menu auth rows in sync with desktop #authBox
import { updateMobileAuthMenu } from './mobile-chrome.js';

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
  // v3.9.7: onion-skin toggle. Flips App.onionSkin and re-renders the
  // display canvas immediately so the ghost appears/disappears without
  // waiting for the next stroke or pan.
  $('btnOnion')?.addEventListener('click', () => {
    App.onionSkin = !App.onionSkin;
    const btn = $('btnOnion');
    if (btn) {
      btn.classList.toggle('active', App.onionSkin);
      btn.setAttribute('aria-pressed', App.onionSkin ? 'true' : 'false');
    }
    renderDisplay();
  });
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

/**
 * v3.9.2: drives the desktop statusbar save chip (#saveStatus) AND the
 * mobile topbar mini chip (#mtbSaveStatus). State machine:
 *
 *   App.saving === true
 *     -> orange "Saving…" with a pulsing cloud icon
 *
 *   App.dirty === true
 *     -> orange "Unsaved" with a hollow-cloud icon
 *
 *   App.dirty === false && App.currentProjectId
 *     -> green "Saved" (cloud-bound, last save round-tripped to Wix)
 *
 *   App.dirty === false && !App.currentProjectId
 *     -> grey "Local only" — no cloud project yet, .kpz autosave is the
 *        only safety net. Hint to log in / save.
 *
 * Both chips share the same state classes (.ss-saved/.ss-saving/.ss-dirty/
 * .ss-offline) so a single CSS rule set styles both.
 */
const SS_STATES = ['ss-saved', 'ss-saving', 'ss-dirty', 'ss-offline'];
function _applySaveChip(el, stateClass, icon, label, title) {
  if (!el) return;
  el.classList.remove(...SS_STATES);
  el.classList.add(stateClass);
  el.title = title;
  // Inner spans are guaranteed by buildAppDom — safe to query on every call.
  const iconEl  = el.querySelector('.ss-icon');
  const labelEl = el.querySelector('.ss-label');
  if (iconEl)  iconEl.textContent = icon;
  if (labelEl) labelEl.textContent = label;
}

export function updateSaveStatus() {
  let stateClass, icon, label, title;
  if (App.saving) {
    stateClass = 'ss-saving';
    icon = '☁';
    label = 'Saving…';
    title = 'Saving to your account';
  } else if (App.dirty) {
    stateClass = 'ss-dirty';
    icon = '☁';
    label = 'Unsaved';
    title = 'You have unsaved changes';
  } else if (App.currentProjectId) {
    stateClass = 'ss-saved';
    icon = '☁︎';
    label = 'Saved';
    title = 'Saved to your account';
  } else {
    stateClass = 'ss-offline';
    icon = '⚠';
    label = 'Local only';
    title = 'This project is not in the cloud yet — Save to keep it';
  }
  _applySaveChip($('saveStatus'),    stateClass, icon, label, title);
  // Mobile chip — same state, no label (icon-only), tooltip carries the message
  _applySaveChip($('mtbSaveStatus'), stateClass, icon, '',    title);
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
  // v3.8.2: mirror auth state into the mobile more-menu auth rows
  updateMobileAuthMenu();
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
