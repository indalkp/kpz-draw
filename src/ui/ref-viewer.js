// src/ui/ref-viewer.js
// Fullscreen reference image viewer with zoom/pan and color picker.

import { App } from '../core/state.js';
import { $ } from '../utils/dom-helpers.js';
import { toast } from './toast.js';

export function initRefViewer() {
  $('refClose')?.addEventListener('click', closeRefViewer);
  $('refPrev')?.addEventListener('click', () => { if (App.refViewerIdx > 0) showRef(App.refViewerIdx - 1); });
  $('refNext')?.addEventListener('click', () => { if (App.refViewerIdx < (App.project?.refs?.length ?? 0) - 1) showRef(App.refViewerIdx + 1); });
  $('refZoomIn')?.addEventListener('click', () => zoomRefViewer(1.25));
  $('refZoomOut')?.addEventListener('click', () => zoomRefViewer(0.8));
  $('refZoomFit')?.addEventListener('click', fitRefViewer);
  $('refZoom100')?.addEventListener('click', () => { App.refView.scale = 1; App.refView.x = 0; App.refView.y = 0; applyRefView(); });
  $('refPickColor')?.addEventListener('click', toggleRefColorPick);

  // Pointer pan in viewer stage
  const stage = $('refViewerStage');
  if (stage) setupStagePan(stage);

  // Color pick click handler
  stage?.addEventListener('click', e => {
    if (!App.refPickingMode || !App.refSampleCanvas) return;
    const img = $('refViewerImg');
    const rect = img?.getBoundingClientRect();
    if (!rect) return;
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return;
    const nx = Math.floor(localX / rect.width * App.refSampleCanvas.width);
    const ny = Math.floor(localY / rect.height * App.refSampleCanvas.height);
    try {
      const data = App.refSampleCanvas.getContext('2d').getImageData(nx, ny, 1, 1).data;
      const hex = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      App.brush.color = hex;
      const cp = $('colorPicker');
      if (cp) cp.value = hex;
      const el = $('refPickedColor');
      if (el) {
        el.style.display = 'inline-block';
        el.style.background = hex;
        el.style.color = (data[0] + data[1] + data[2] > 380) ? '#000' : '#fff';
        el.textContent = hex.toUpperCase();
      }
      toast('Color sampled: ' + hex.toUpperCase(), 'ok');
    } catch (err) {
      toast('Could not sample color: ' + err.message, 'error');
    }
  });
}

export function openRefViewer(idx) {
  App.refViewerIdx = idx;
  showRef(idx);
  $('refViewer')?.classList.add('open');
}

export function showRef(idx) {
  const refs = App.project?.refs;
  if (!refs || idx < 0 || idx >= refs.length) return;
  App.refViewerIdx = idx;
  const ref = refs[idx];
  const img = $('refViewerImg');
  if (img) {
    img.onload = () => {
      App.refView.naturalW = img.naturalWidth;
      App.refView.naturalH = img.naturalHeight;
      fitRefViewer();
    };
    img.src = ref.data;
  }
  const counter = $('refCounter');
  if (counter) counter.textContent = `${idx + 1} / ${refs.length}`;
  const prev = $('refPrev'), next = $('refNext');
  if (prev) prev.style.visibility = idx > 0 ? 'visible' : 'hidden';
  if (next) next.style.visibility = idx < refs.length - 1 ? 'visible' : 'hidden';
}

export function closeRefViewer() {
  $('refViewer')?.classList.remove('open');
  App.refPickingMode = false;
  App.refSampleCanvas = null;
  $('refViewer')?.classList.remove('picking');
  $('refPickColor')?.classList.remove('active');
  const el = $('refPickedColor');
  if (el) el.style.display = 'none';
}

function fitRefViewer() {
  const stage = $('refViewerStage');
  if (!stage || !App.refView.naturalW) return;
  const pad = 20;
  const sw = stage.clientWidth - pad * 2;
  const sh = stage.clientHeight - pad * 2;
  App.refView.scale = Math.min(sw / App.refView.naturalW, sh / App.refView.naturalH, 1);
  App.refView.x = 0; App.refView.y = 0;
  applyRefView();
}

function applyRefView() {
  const img = $('refViewerImg');
  const stage = $('refViewerStage');
  if (!img || !stage) return;
  const w = App.refView.naturalW * App.refView.scale;
  const h = App.refView.naturalH * App.refView.scale;
  img.style.width = w + 'px';
  img.style.height = h + 'px';
  img.style.left = ((stage.clientWidth - w) / 2 + App.refView.x) + 'px';
  img.style.top = ((stage.clientHeight - h) / 2 + App.refView.y) + 'px';
  const zv = $('refZoomVal');
  if (zv) zv.textContent = Math.round(App.refView.scale * 100) + '%';
}

function zoomRefViewer(factor, cx, cy) {
  const stage = $('refViewerStage');
  if (!stage) return;
  if (cx == null) cx = stage.clientWidth / 2;
  if (cy == null) cy = stage.clientHeight / 2;
  const oldScale = App.refView.scale;
  const newScale = Math.max(0.1, Math.min(8, oldScale * factor));
  const img = $('refViewerImg');
  const imgLeft = parseFloat(img?.style.left) || 0;
  const imgTop = parseFloat(img?.style.top) || 0;
  const relX = (cx - imgLeft) / oldScale;
  const relY = (cy - imgTop) / oldScale;
  App.refView.scale = newScale;
  const w = App.refView.naturalW * newScale;
  const h = App.refView.naturalH * newScale;
  App.refView.x = (cx - relX * newScale) - (stage.clientWidth - w) / 2;
  App.refView.y = (cy - relY * newScale) - (stage.clientHeight - h) / 2;
  applyRefView();
}

function toggleRefColorPick() {
  App.refPickingMode = !App.refPickingMode;
  $('refViewer')?.classList.toggle('picking', App.refPickingMode);
  $('refPickColor')?.classList.toggle('active', App.refPickingMode);
  if (App.refPickingMode) {
    const img = $('refViewerImg');
    if (img) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      App.refSampleCanvas = c;
      toast('Click anywhere on the image to sample a color', 'ok');
    }
  } else {
    App.refSampleCanvas = null;
  }
}

function setupStagePan(stage) {
  let panning = false, start = null;
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    panning = true;
    stage.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, vx: App.refView.x, vy: App.refView.y };
    stage.style.cursor = 'grabbing';
  });
  stage.addEventListener('pointermove', e => {
    if (!panning) return;
    App.refView.x = start.vx + (e.clientX - start.x);
    App.refView.y = start.vy + (e.clientY - start.y);
    applyRefView();
  });
  stage.addEventListener('pointerup', () => { panning = false; stage.style.cursor = 'grab'; });
  stage.addEventListener('pointercancel', () => { panning = false; stage.style.cursor = 'grab'; });
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomRefViewer(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // Touch pinch
  let touchState = null;
  stage.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      touchState = {
        d: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2,
        vx: App.refView.x, vy: App.refView.y, scale: App.refView.scale
      };
      e.preventDefault();
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      touchState = { single: true, x: t.clientX, y: t.clientY, vx: App.refView.x, vy: App.refView.y };
    }
  }, { passive: false });
  stage.addEventListener('touchmove', e => {
    if (!touchState) return;
    if (e.touches.length === 2 && !touchState.single) {
      const [a, b] = e.touches;
      const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const ratio = d / touchState.d;
      App.refView.scale = Math.max(0.1, Math.min(8, touchState.scale * ratio));
      App.refView.x = touchState.vx + ((a.clientX + b.clientX) / 2 - touchState.cx);
      App.refView.y = touchState.vy + ((a.clientY + b.clientY) / 2 - touchState.cy);
      applyRefView(); e.preventDefault();
    } else if (e.touches.length === 1 && touchState.single) {
      const t = e.touches[0];
      App.refView.x = touchState.vx + (t.clientX - touchState.x);
      App.refView.y = touchState.vy + (t.clientY - touchState.y);
      applyRefView();
    }
  }, { passive: false });
  stage.addEventListener('touchend', () => { touchState = null; });
}
