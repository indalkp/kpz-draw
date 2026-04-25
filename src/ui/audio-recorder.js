// src/ui/audio-recorder.js
//
// v3.9.20: thin wrapper around getUserMedia + MediaRecorder so the rest of
// the app can do startRecording() / stopRecording() without dealing with
// stream-track lifecycle, mime selection, or chunk concatenation.
//
// One recorder at a time — module-level state. Calling startRecording
// while another is active will be a no-op (panel-nav guards against this).

let _recorder = null;
let _stream   = null;
let _chunks   = [];
let _mimeType = '';

/**
 * Pick the best supported audio mime type. WebM/opus is the universal
 * MediaRecorder default; mp4/aac is Safari's native. Falling through to
 * empty string lets the browser pick its own default.
 */
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

/**
 * Request microphone access and start recording. Resolves once the recorder
 * has actually started. Throws if mic permission is denied or unsupported.
 */
export async function startRecording() {
  if (_recorder) return;     // already recording — ignore
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    throw new Error('Microphone API unavailable in this browser.');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder unavailable in this browser.');
  }

  _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  _mimeType = pickMimeType();
  _chunks = [];
  _recorder = _mimeType
    ? new MediaRecorder(_stream, { mimeType: _mimeType })
    : new MediaRecorder(_stream);
  _recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) _chunks.push(e.data);
  };
  _recorder.start();
}

/**
 * Stop recording and resolve with the recorded Blob. Releases the mic
 * stream as a side effect. Returns null if there was no active recorder.
 */
export async function stopRecording() {
  if (!_recorder) return null;
  return new Promise((resolve) => {
    _recorder.onstop = () => {
      const type = _mimeType || 'audio/webm';
      const blob = new Blob(_chunks, { type });
      cleanup();
      resolve(blob);
    };
    try {
      _recorder.stop();
    } catch (err) {
      console.warn('recorder.stop failed:', err);
      cleanup();
      resolve(null);
    }
  });
}

/**
 * Discard the in-progress recording without saving. Releases the mic.
 */
export function cancelRecording() {
  if (_recorder) {
    try { _recorder.stop(); } catch (_) { /* noop */ }
  }
  cleanup();
}

export function isRecording() {
  return !!(_recorder && _recorder.state === 'recording');
}

function cleanup() {
  _recorder = null;
  if (_stream) {
    try { _stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* noop */ }
    _stream = null;
  }
  _chunks = [];
  _mimeType = '';
}
