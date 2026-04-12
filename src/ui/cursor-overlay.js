// src/ui/cursor-overlay.js
// Brush-size circle overlay that follows the pointer on the canvas.

import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';

/** Update the cursor overlay position based on the current pointer event. */
export function updateCursor(e) {
  const overlay = $('cursorOverlay');
  if (!overlay) return;
  if (App.tool !== 'brush' && App.tool !== 'eraser') {
    overlay.style.display = 'none';
    return;
  }
  const sz = App.brush.size * App.view.scale;
  if (sz < 4) { overlay.style.display = 'none'; return; }
  const rect = $('canvasArea')?.getBoundingClientRect();
  if (!rect) return;
  overlay.style.display = 'block';
  overlay.style.width = sz + 'px';
  overlay.style.height = sz + 'px';
  overlay.style.left = (e.clientX - rect.left - sz / 2) + 'px';
  overlay.style.top = (e.clientY - rect.top - sz / 2) + 'px';
}

/** Hide the cursor overlay (e.g., when pointer leaves canvas). */
export function hideCursor() {
  const overlay = $('cursorOverlay');
  if (overlay) overlay.style.display = 'none';
}
