// src/ui/toast.js
// Lightweight toast notification system.

import { $ } from '../utils/dom-helpers.js';

let toastTimer = null;

/**
 * Show a toast notification.
 * @param {string} msg - Message to display
 * @param {'ok'|'error'|undefined} type - Optional styling type
 */
export function toast(msg, type) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = '';
  t.classList.add('show');
  if (type) t.classList.add(type);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
