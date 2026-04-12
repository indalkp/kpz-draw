// src/utils/dom-helpers.js
// Lightweight DOM query helpers used throughout the app.

/** Shorthand for document.getElementById */
export const $ = id => document.getElementById(id);

/** Shorthand for document.querySelectorAll, returns Array */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Escape HTML special characters in a string.
 * Use when inserting user-provided text into innerHTML.
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
