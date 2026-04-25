// src/ui/audio-recorder.js
//
// v3.9.20: thin wrapper around getUserMedia + MediaRecorder (local backend).
// v3.9.22: detectMicAvailability surfaces iframe-policy denial up front.
// v3.9.23: Velo bridge backend. When the iframe can't access the mic
//          directly (Wix HtmlComponent denies the Permissions Policy),
//          it can ask the parent Wix page — via postMessage — to record
//          on its behalf. The Velo page-code (paste in Wix Editor) runs
//          MediaRecorder in the parent context where the user's site-
//          level mic permission applies, then posts the recorded audio
//          back as a base64 data URL the iframe converts to a Blob.
//
// Backend selection happens once, lazily, on first detectMicAvailability()
// or first startRecording() call. Order:
//   1. local  — mic accessible directly in this context
//   2. bridge — Velo bridge responds to a ping
//   3. (none) — neither works, record button is disabled

let _backend = null;       // 'local' | 'bridge' | null

// -----------------------------------------------------------------------------
// Local backend (v3.9.20) — same MediaRecorder pipeline as before.
// -----------------------------------------------------------------------------
let _recorder = null;
let _stream   = null;
let _chunks   = [];
let _mimeType = '';

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

async function localStart() {
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
  _recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) _chunks.push(e.data); };
  _recorder.start();
}

function localStop() {
  return new Promise((resolve) => {
    if (!_recorder) return resolve(null);
    _recorder.onstop = () => {
      const type = _mimeType || 'audio/webm';
      const blob = new Blob(_chunks, { type });
      localCleanup();
      resolve(blob);
    };
    try { _recorder.stop(); }
    catch (err) { console.warn('recorder.stop failed:', err); localCleanup(); resolve(null); }
  });
}

function localCancel() {
  if (_recorder) { try { _recorder.stop(); } catch (_) {} }
  localCleanup();
}

function localIsRecording() {
  return !!(_recorder && _recorder.state === 'recording');
}

function localCleanup() {
  _recorder = null;
  if (_stream) {
    try { _stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    _stream = null;
  }
  _chunks = [];
  _mimeType = '';
}

// -----------------------------------------------------------------------------
// v3.9.23: Velo bridge backend. The iframe sends a typed message to the
// parent (window.parent.postMessage); the parent's Velo page-code receives
// it via the HtmlComponent's onMessage handler, runs MediaRecorder there,
// and posts the result back. Iframe listens for the response.
// -----------------------------------------------------------------------------
let _bridgeRecording = false;     // tracks "we asked the parent to start"

/**
 * Send a message to the parent window. Best-effort; if we're not actually
 * embedded, postMessage is a no-op for our purposes.
 */
function bridgeSend(type, extra) {
  try {
    window.parent.postMessage(Object.assign({ type }, extra || {}), '*');
  } catch (err) {
    console.warn('bridgeSend failed:', err);
  }
}

/**
 * Wait for a typed message back from the parent. Resolves with the message
 * payload, or rejects on timeout. Used for both ping/pong (detection) and
 * for collecting the recorded audio result.
 */
function bridgeAwait(types, timeoutMs) {
  if (typeof types === 'string') types = [types];
  return new Promise((resolve, reject) => {
    let done = false;
    const onMsg = (e) => {
      const d = e.data;
      if (!d || !d.type) return;
      if (types.indexOf(d.type) === -1) return;
      done = true;
      window.removeEventListener('message', onMsg);
      resolve(d);
    };
    window.addEventListener('message', onMsg);
    setTimeout(() => {
      if (done) return;
      window.removeEventListener('message', onMsg);
      reject(new Error('bridge-timeout'));
    }, timeoutMs);
  });
}

/**
 * v3.9.23: detect whether the parent page has the audio bridge wired up.
 * Sends an audio-bridge-ping; the parent should reply with audio-bridge-pong
 * within ~1 second if its Velo page code includes the v3.9.23 handlers.
 */
async function detectBridgeAvailability() {
  if (window.self === window.top) return false;     // not in an iframe → no bridge
  try {
    const wait = bridgeAwait('audio-bridge-pong', 1200);
    bridgeSend('audio-bridge-ping');
    await wait;
    return true;
  } catch (_) {
    return false;
  }
}

async function bridgeStart() {
  if (_bridgeRecording) return;
  const wait = bridgeAwait(['audio-bridge-started', 'audio-bridge-error'], 8000);
  bridgeSend('audio-bridge-start');
  const reply = await wait;
  if (reply.type === 'audio-bridge-error') {
    throw new Error(reply.error || 'bridge-error');
  }
  _bridgeRecording = true;
}

async function bridgeStop() {
  if (!_bridgeRecording) return null;
  // Allow up to 30s for the parent to finalise the recording — long
  // enough for slow disk encoding on big clips, short enough to surface
  // a hung bridge instead of leaving the user staring at a frozen button.
  const wait = bridgeAwait(['audio-bridge-result', 'audio-bridge-error'], 30000);
  bridgeSend('audio-bridge-stop');
  const reply = await wait;
  _bridgeRecording = false;
  if (reply.type === 'audio-bridge-error') {
    throw new Error(reply.error || 'bridge-error');
  }
  // Convert the data URL back to a Blob via fetch()
  if (!reply.dataUrl) return null;
  try {
    const r = await fetch(reply.dataUrl);
    return await r.blob();
  } catch (err) {
    throw new Error('bridge-decode-failed: ' + err.message);
  }
}

function bridgeCancel() {
  if (!_bridgeRecording) return;
  bridgeSend('audio-bridge-cancel');
  _bridgeRecording = false;
}

function bridgeIsRecording() {
  return _bridgeRecording;
}

// -----------------------------------------------------------------------------
// Public API — chooses the active backend and dispatches.
// -----------------------------------------------------------------------------

export async function startRecording() {
  if (!_backend) {
    // First call without prior detection — pick now.
    const det = await detectMicAvailability();
    if (!det.available) {
      throw new Error(det.reason || 'unavailable');
    }
  }
  if (_backend === 'local')  return localStart();
  if (_backend === 'bridge') return bridgeStart();
  throw new Error('No recording backend available.');
}

export async function stopRecording() {
  if (_backend === 'local')  return localStop();
  if (_backend === 'bridge') return bridgeStop();
  return null;
}

export function cancelRecording() {
  if (_backend === 'local')  return localCancel();
  if (_backend === 'bridge') return bridgeCancel();
}

export function isRecording() {
  if (_backend === 'local')  return localIsRecording();
  if (_backend === 'bridge') return bridgeIsRecording();
  return false;
}

/**
 * v3.9.22 / v3.9.23: pick the best available recording backend. Tries
 * local mic first; if that's blocked (e.g., iframe Permissions Policy on
 * Wix) but the parent page exposes the v3.9.23 audio bridge, falls back
 * to the bridge backend. Returns { available, reason, mode } where mode
 * is 'local' | 'bridge' | undefined.
 */
export async function detectMicAvailability() {
  // Cached after first call so we don't re-ping the parent each click.
  if (_backend === 'local')  return { available: true, mode: 'local'  };
  if (_backend === 'bridge') return { available: true, mode: 'bridge' };

  // 1. Local availability — same checks as v3.9.22.
  if (typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      typeof MediaRecorder !== 'undefined') {

    let localOk = true;
    let blockedReason = null;

    if (window.self !== window.top) {
      // featurePolicy: synchronous explicit check (older browsers)
      try {
        const fp = document.featurePolicy;
        if (fp && typeof fp.allowsFeature === 'function' &&
            !fp.allowsFeature('microphone')) {
          localOk = false;
          blockedReason = 'iframe-policy';
        }
      } catch (_) {}

      if (localOk) {
        // permissions API: 'denied' here often means iframe policy
        try {
          const q = await navigator.permissions.query({ name: 'microphone' });
          if (q.state === 'denied') {
            localOk = false;
            blockedReason = 'iframe-policy';
          }
        } catch (_) { /* unsupported, proceed optimistically */ }
      }
    }

    if (localOk) {
      _backend = 'local';
      return { available: true, mode: 'local' };
    }

    // 2. Local blocked — try the bridge.
    const bridgeOk = await detectBridgeAvailability();
    if (bridgeOk) {
      _backend = 'bridge';
      return { available: true, mode: 'bridge' };
    }

    return { available: false, reason: blockedReason || 'iframe-policy' };
  }

  // No MediaRecorder at all. Bridge is unavailable too (it needs MR running
  // somewhere, and the iframe wouldn't have any way to use the result Blob
  // without it. The parent's MR may exist, but iframe still needs Audio
  // playback which is universally supported, so try bridge.)
  if (window.self !== window.top) {
    const bridgeOk = await detectBridgeAvailability();
    if (bridgeOk) {
      _backend = 'bridge';
      return { available: true, mode: 'bridge' };
    }
  }
  return { available: false, reason: 'unsupported' };
}
