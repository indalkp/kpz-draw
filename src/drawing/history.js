// src/drawing/history.js
// Per-panel undo/redo history using canvas snapshots.

import { App } from '../core/state.js';
import { curPanel } from './panels.js';
import { renderDisplay } from './view.js';
import { updateLayerThumb } from '../ui/layers-panel.js';

const HISTORY_MAX = 30;

/** Push the current layer state onto the history stack for the active panel. */
export function pushHistory() {
  const idx = App.activePanelIdx;
  if (!App.history[idx]) App.history[idx] = [];
  if (!App.historyIdx[idx]) App.historyIdx[idx] = 0;

  // Trim any redo states
  App.history[idx] = App.history[idx].slice(0, App.historyIdx[idx]);

  const layer = curPanel().layers[curPanel().activeLayer];
  const snap = document.createElement('canvas');
  snap.width = layer.canvas.width;
  snap.height = layer.canvas.height;
  snap.getContext('2d').drawImage(layer.canvas, 0, 0);

  App.history[idx].push({ layerIdx: curPanel().activeLayer, snap });

  if (App.history[idx].length > HISTORY_MAX) {
    App.history[idx].shift();
  } else {
    App.historyIdx[idx]++;
  }
}

/** Undo last stroke on the active panel. */
export function undo() {
  const idx = App.activePanelIdx;
  if (!App.history[idx] || App.historyIdx[idx] <= 0) return;
  App.historyIdx[idx]--;
  const entry = App.history[idx][App.historyIdx[idx]];
  if (!entry) return;
  applySnapshot(entry);
}

/** Redo last undone stroke on the active panel. */
export function redo() {
  const idx = App.activePanelIdx;
  if (!App.history[idx] || App.historyIdx[idx] >= App.history[idx].length - 1) return;
  App.historyIdx[idx]++;
  const entry = App.history[idx][App.historyIdx[idx]];
  if (!entry) return;
  applySnapshot(entry);
}

function applySnapshot(entry) {
  const layer = curPanel().layers[entry.layerIdx];
  const ctx = layer.canvas.getContext('2d');
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.drawImage(entry.snap, 0, 0);
  renderDisplay();
  updateLayerThumb(entry.layerIdx);
}
