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
  // v3.10.0: strip mode toggle. Lazy-import the module so the strip-mode
  // CSS doesn't pull in the JS until the first time the user clicks the
  // toggle (one-shot import after first click; cached thereafter).
  $('btnStripMode')?.addEventListener('click', () => {
    import('./strip-mode.js').then(m => m.toggleStripMode());
  });
  // v3.9.8: onion-skin cycling toggle. Click cycles through three states:
  //   off → past → both → off
  // Each click re-renders the display so the ghosts appear/disappear
  // immediately. Same cycle is bound to the 'O' keyboard shortcut in
  // events.js so power-users don't have to reach for the topbar.
  $('btnOnion')?.addEventListener('click', cycleOnionMode);
  // v3.9.10: animatic playback wiring. The actual play/pause / FPS change
  // logic lives below at module scope (export togglePlayback) so events.js
  // can bind the 'P' keyboard shortcut to the same function.
  $('btnPlay')?.addEventListener('click', togglePlayback);
  $('playFps')?.addEventListener('change', e => {
    const n = parseInt(e.target.value, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 12) {
      App.playFps = n;
      // If currently playing, restart the interval at the new rate
      if (App.playing) {
        stopPlaybackInterval();
        startPlaybackInterval();
      }
    } else {
      e.target.value = App.playFps;     // revert invalid input
    }
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


// ===========================================================================
// v3.9.8: onion-skin cycle helper. Lives at module scope so the keyboard
// shortcut in events.js can import it and reuse the exact same cycle logic
// the topbar button uses — single source of truth for the off→past→both
// transitions and the corresponding aria/title syncs.
// ===========================================================================

const ONION_NEXT = { off: 'past', past: 'both', both: 'off' };
const ONION_TITLE = {
  off:  'Onion skin: off — click to show previous panel as ghost',
  past: 'Onion skin: past — click to also show next panel',
  both: 'Onion skin: past + next — click to turn off',
};

export function cycleOnionMode() {
  App.onionMode = ONION_NEXT[App.onionMode] || 'past';
  const btn = $('btnOnion');
  if (btn) {
    btn.classList.toggle('active', App.onionMode !== 'off');
    btn.classList.toggle('onion-both', App.onionMode === 'both');
    btn.setAttribute('aria-pressed', App.onionMode === 'off' ? 'false' : 'true');
    btn.title = ONION_TITLE[App.onionMode] || ONION_TITLE.off;
  }
  renderDisplay();
}


// ===========================================================================
// v3.9.10: animatic playback. Cycles activePanelIdx through the project's
// panels at App.playFps panels per second so storyboard sequences play
// like a rough animatic — exactly the use case the user described:
// "adjust the frame rate to create storyboard sequences that can play back
// dialogue and motion." Caption / script overlay during playback is a v4.0+
// extension; for now playback is purely visual panel cycling.
// ===========================================================================

// v3.9.10: setInterval-based playback at fixed FPS.
// v3.9.19: replaced with a recursive setTimeout scheduler so each panel
// can hold for its own duration — short panels at 1/fps, long-audio panels
// for their audio's full duration. _playTimeout holds the pending advance.
let _playTimeout = null;

/**
 * Toggle playback. Exported so events.js can wire 'P' to the same handler
 * the topbar button uses — single source of truth for state changes.
 */
export function togglePlayback() {
  if (!App.project || App.project.panels.length < 2) {
    // One panel = nothing to animate. Silently no-op (toast would be noisy
    // since pressing P repeatedly is a likely accident).
    return;
  }
  if (App.playing) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

export function startPlayback() {
  if (App.playing) return;
  App.playing = true;
  // v3.9.14: body class drives CSS that hides the caption strip during
  // playback (since captions now burn into the canvas) — and gives any
  // future "playback mode" affordances a hook to react to.
  document.body.classList.add('animatic-playing');
  syncPlayButton();
  // v3.9.17: kick off the FIRST panel's audio immediately. Subsequent
  // panels are handled by advancePlaybackPanel.
  playCurrentPanelAudio(App.activePanelIdx);
  startPlaybackInterval();
}

export function stopPlayback() {
  if (!App.playing) return;
  App.playing = false;
  document.body.classList.remove('animatic-playing');
  stopPlaybackInterval();
  // v3.9.17: stop any in-flight audio before we re-render so the visual
  // and the audio cut out together.
  stopPanelAudio();
  syncPlayButton();
  // v3.9.14: re-render once on stop so the burned-in caption disappears
  // immediately (renderDisplay only burns when App.playing is true; the
  // last frame painted during playback still has the caption otherwise).
  renderDisplay();
}

function startPlaybackInterval() {
  // v3.9.19: schedule the first advance after the CURRENT panel's duration.
  // Subsequent advances are scheduled inside advancePlaybackPanel itself.
  stopPlaybackInterval();
  scheduleNextAdvance();
}

function stopPlaybackInterval() {
  if (_playTimeout !== null) {
    clearTimeout(_playTimeout);
    _playTimeout = null;
  }
}

/**
 * v3.9.19: hold the current panel for its computed duration, then advance.
 * Computed duration = max(audioDuration, 1/fps). If the panel has audio,
 * it runs to completion; otherwise the FPS rate decides timing.
 */
function scheduleNextAdvance() {
  if (!App.playing) return;
  const panel = App.project?.panels?.[App.activePanelIdx];
  const ms = computePanelHoldMs(panel);
  _playTimeout = setTimeout(() => {
    advancePlaybackPanel();
    if (App.playing) scheduleNextAdvance();
  }, ms);
}

/**
 * v3.9.19: how long this panel should be held visible during playback,
 * in milliseconds. Audio length wins when present (so dialogue isn't cut),
 * 1/fps is the floor so panels never flash by faster than the user's
 * chosen FPS.
 *
 * v3.9.25: also factors in the panel's manual duration override
 * (panel.duration in seconds). If set and > 0, the panel holds for at
 * least that long — useful for dramatic pauses on silent panels.
 * Three sources, max() wins:
 *   - 1/fps                     (the floor)
 *   - panel.audioDuration       (so audio plays in full)
 *   - panel.duration            (manual override)
 */
export function computePanelHoldMs(panel) {
  const fps = Math.max(1, Math.min(12, App.playFps || 2));
  const fpsMs = Math.round(1000 / fps);
  const audioMs = panel && panel.audioDuration > 0 ? Math.round(panel.audioDuration * 1000) : 0;
  const manualMs = panel && panel.duration > 0 ? Math.round(panel.duration * 1000) : 0;
  return Math.max(fpsMs, audioMs, manualMs);
}

function advancePlaybackPanel() {
  if (!App.project || App.project.panels.length < 2) {
    stopPlayback();
    return;
  }
  // Loop at the end. ping-pong / once-through could be added as modes later.
  const next = (App.activePanelIdx + 1) % App.project.panels.length;
  // Lazy-load to avoid circular imports at module init: panel-nav imports
  // topbar (for updateSaveStatus), so we don't import panel-nav at the top.
  import('./panel-nav.js').then(m => {
    if (typeof m.switchPanelForPlayback === 'function') {
      m.switchPanelForPlayback(next);
    } else if (typeof m.renderPanelNav === 'function') {
      // Fallback: set state directly + re-render
      App.activePanelIdx = next;
      m.renderPanelNav();
      // Re-render the canvas so the new panel's content is visible
      renderDisplay();
    }
  });
  // v3.10.0: in strip mode, also follow the active panel down the strip
  // so the user sees the playback head moving without manually scrolling.
  if (App.viewMode === 'strip') {
    import('./strip-mode.js').then(m => m.scrollActivePanelIntoView?.());
  }
  // v3.9.17: trigger this panel's voice-over audio (if any). The previous
  // panel's audio is stopped first so they don't overlap.
  playCurrentPanelAudio(next);
}

// ---------------------------------------------------------------------------
// v3.9.17: per-panel audio narration playback. One <audio> element kept at
// module scope, swapped between panels. Stopped + cleared on playback end.
// Audio resolves from IDB via getPanelAudio; if the audio isn't found
// (e.g. .kpz loaded on a fresh device), playback silently no-ops.
// ---------------------------------------------------------------------------
let _audioEl = null;
let _audioObjectUrl = null;

async function playCurrentPanelAudio(panelIdx) {
  // Always stop whatever's currently playing first — prevents overlap
  // between consecutive panels.
  stopPanelAudio();
  if (!App.project) return;
  const panel = App.project.panels[panelIdx];
  if (!panel || !panel.audioId) return;

  try {
    // Lazy-import to avoid pulling the storage module on app init for users
    // who never attach audio.
    const { getPanelAudio } = await import('../storage/panel-audio.js');
    const blob = await getPanelAudio(panel.audioId);
    if (!blob) return;
    // Sanity: if user paused mid-load, abort.
    if (!App.playing || App.activePanelIdx !== panelIdx) return;

    if (_audioObjectUrl) {
      try { URL.revokeObjectURL(_audioObjectUrl); } catch (_) { /* noop */ }
    }
    _audioObjectUrl = URL.createObjectURL(blob);
    _audioEl = new Audio(_audioObjectUrl);
    _audioEl.play().catch(err => {
      // Autoplay restrictions can reject the play() promise. Silently log;
      // user pressed Play themselves so it should be allowed.
      console.warn('Panel audio playback rejected:', err);
    });
  } catch (err) {
    console.warn('playCurrentPanelAudio failed:', err);
  }
}

function stopPanelAudio() {
  if (_audioEl) {
    try { _audioEl.pause(); _audioEl.currentTime = 0; } catch (_) { /* noop */ }
    _audioEl.src = '';
    _audioEl = null;
  }
  if (_audioObjectUrl) {
    try { URL.revokeObjectURL(_audioObjectUrl); } catch (_) { /* noop */ }
    _audioObjectUrl = null;
  }
}

/**
 * Update the play button's icon + aria-pressed to reflect current state.
 * Triangle when paused (suggests "press to play"); two bars when playing.
 */
function syncPlayButton() {
  const btn = $('btnPlay');
  if (!btn) return;
  btn.classList.toggle('active', App.playing);
  btn.setAttribute('aria-pressed', App.playing ? 'true' : 'false');
  btn.title = App.playing ? 'Pause animatic (P)' : 'Play animatic (P)';
  // Swap the inner SVG path for a play triangle vs a pause two-bar.
  const PLAY_PATH = 'M8 5v14l11-7z';
  const PAUSE_PATH = 'M6 5h4v14H6zm8 0h4v14h-4z';
  const path = btn.querySelector('svg path');
  if (path) {
    path.setAttribute('d', App.playing ? PAUSE_PATH : PLAY_PATH);
  }
}
