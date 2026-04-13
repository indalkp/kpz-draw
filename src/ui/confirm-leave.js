// src/ui/confirm-leave.js
//
// v3.6.2: dirty-check before navigation.
//
// Exposes a single async helper: confirmLeaveIfDirty({ context, saveable })
// that returns a Promise<boolean>. Callers should do:
//
//   if (!await confirmLeaveIfDirty(...)) return;   // user cancelled — abort
//   // ...otherwise proceed to navigate / overwrite / log out / etc.
//
// Behavior:
//   - If App.dirty is false → resolves true immediately (no modal).
//   - Otherwise shows a modal with three choices:
//       [Save & go]    → awaits saveToWix(); resolves true on success, false
//                        on failure (user stays put, sees the error toast).
//       [Discard & go] → resolves true; caller proceeds, work is lost.
//       [Cancel]       → resolves false; caller aborts.
//
// The 'saveable' option controls whether "Save & go" is offered. For flows
// where saving-to-cloud doesn't make sense (e.g. "New project" before the
// user has logged in), we can hide that button.

import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';
import { saveToWix } from '../storage/wix-bridge.js';
import { toast } from './toast.js';

// Module-local: the currently-pending confirm-leave promise (only one at a time).
let pending = null;

/**
 * Wire up the modal's button listeners.
 * Called once at app init from main.js.
 */
export function initConfirmLeave() {
  $('clCancel')?.addEventListener('click', () => resolvePending(false));
  $('clDiscard')?.addEventListener('click', () => resolvePending(true));
  $('clSave')?.addEventListener('click', onSaveAndGo);

  // Click on backdrop = cancel
  $('confirmLeaveModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'confirmLeaveModal') resolvePending(false);
  });
}

/**
 * @param {object} opts
 * @param {string} [opts.context] Short label for the message (e.g. 'dashboard').
 * @returns {Promise<boolean>} true = caller may proceed; false = caller should abort.
 */
export function confirmLeaveIfDirty(opts = {}) {
  if (!App.dirty) return Promise.resolve(true);

  const msgEl = $('confirmLeaveMsg');
  if (msgEl) {
    const where = opts.context ? ` before going to the ${opts.context}` : '';
    msgEl.textContent = `You have unsaved changes${where}. Save them to your site, discard them, or stay here?`;
  }

  // Hide Save button if user isn't logged in — they can't save to cloud
  const saveBtn = $('clSave');
  if (saveBtn) saveBtn.style.display = (App.inWix && App.isLoggedIn) ? '' : 'none';

  $('confirmLeaveModal')?.classList.add('open');

  return new Promise((resolve) => {
    // If another confirm was already pending, reject it silently
    if (pending) pending(false);
    pending = resolve;
  });
}

function resolvePending(value) {
  $('confirmLeaveModal')?.classList.remove('open');
  const p = pending;
  pending = null;
  if (p) p(value);
}

async function onSaveAndGo() {
  if (!App.inWix || !App.isLoggedIn) {
    toast('Log in first to save your work', 'error');
    return;
  }
  // Disable the button while the save is in-flight so user can't spam it
  const saveBtn = $('clSave');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const result = await saveToWix();
    if (result && result.success) {
      // Save worked — close modal, tell caller to proceed
      resolvePending(true);
    } else if (result && result.error === 'stale') {
      // Stale-write detection fired from the backend. The stale-write modal
      // will have already opened (wix-bridge handles it). We resolve the
      // confirm-leave as false — the caller should NOT navigate away,
      // because the user still needs to decide what to do with the stale.
      resolvePending(false);
    } else {
      // Any other save failure — stay on the confirm-leave modal so user
      // can try again, discard, or cancel. Re-enable the button.
      toast('Save failed. Choose Discard, Cancel, or try Save again.', 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save & go'; }
    }
  } catch (err) {
    toast('Save error: ' + (err?.message || 'unknown'), 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save & go'; }
  }
}
