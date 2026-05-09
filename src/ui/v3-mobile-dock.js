// ============================================================================
//  src/ui/v3-mobile-dock.js
//
//  v4.0.0-rc.1 — 5-button mobile dock from wireframes-mobile-issues.jsx.
//
//  Renders only on viewports <1100px AND only when body[data-v3="1"]. The
//  v3-theme.css media query controls visibility; this module just builds and
//  wires the buttons.
//
//  Buttons: Draw / Script / Cast / Project / Menu. Each toggles a screen
//  state via body[data-mobile-screen=...]. Existing v3.8.0 mobile chrome
//  (#mobileTopbar, mtb-* buttons) stays where it was — this dock is a
//  sibling that adds the screen-switcher pattern from the wireframes.
//
//  Edge-peek tabs (▶ refs / layers ◀) are flagged as "Coming v1" — gesture
//  handlers + drawer animation are deferred.
// ============================================================================

import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';

const ITEMS = [
  { id: 'draw',    icon: '🎨', label: 'Draw' },
  { id: 'script',  icon: '📜', label: 'Script' },
  { id: 'refs',    icon: '👥', label: 'Cast' },
  { id: 'project', icon: '☁︎', label: 'Project' },
  { id: 'menu',    icon: '☰',  label: 'Menu' },
];

let _initialized = false;

export function initV3MobileDock() {
  if (_initialized) return;
  _initialized = true;

  // Only attach when v3 mode is on. v3-shell.js sets the attribute before
  // calling us, so this check is just a belt-and-braces guard.
  if (document.body.getAttribute('data-v3') !== '1') return;

  ensureDock();

  // Default screen is "draw" — same as the existing mobile experience
  setMobileScreen('draw');
}

function ensureDock() {
  if ($('v3MobileDock')) return;

  const dock = document.createElement('div');
  dock.id = 'v3MobileDock';
  dock.className = 'v3-mobile-dock';

  ITEMS.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'v3-mobile-dock-btn';
    b.dataset.screen = it.id;
    b.innerHTML = `
      <span class="v3-mobile-dock-icon">${it.icon}</span>
      <span class="v3-mobile-dock-label">${it.label}</span>
    `;
    b.addEventListener('click', () => handleDockClick(it.id));
    dock.appendChild(b);
  });

  document.body.appendChild(dock);
}

function handleDockClick(screenId) {
  switch (screenId) {
    case 'draw':
      setMobileScreen('draw');
      break;
    case 'script':
      // Reuse the v3 script-mode toggle from v3-shell.js
      import('./v3-shell.js').then(m => m.setMode('script')).catch(() => {});
      setMobileScreen('script');
      break;
    case 'refs':
      // Open the existing Refs / Cast panel via mtb-refs button if present
      $('mtbRefs')?.click();
      setMobileScreen('refs');
      break;
    case 'project':
      // Open the v3 Project Gallery
      import('./v3-modals.js').then(m => m.openProjectGallery()).catch(() => {});
      setMobileScreen('project');
      break;
    case 'menu':
      // Mirror the existing mtbGallery (the v3.8.0 mobile menu button) which
      // toggles the more-menu drawer. Falls back to profile menu if absent.
      const menuBtn = $('mtbGallery') || $('authBox');
      menuBtn?.click();
      setMobileScreen('menu');
      break;
  }
}

function setMobileScreen(screen) {
  document.body.setAttribute('data-mobile-screen', screen);
  // Sync active button class
  document.querySelectorAll('.v3-mobile-dock-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === screen);
  });
  App.v3MobileScreen = screen;
}
