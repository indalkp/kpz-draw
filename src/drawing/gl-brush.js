// src/drawing/gl-brush.js
//
// v3.17.0 Phase 4 — WebGL2 brush rasterizer.
//
// Stamps render via instanced textured quads on the GPU instead of
// per-stamp createRadialGradient + arc + fill (Canvas 2D) or even the
// drawImage-from-cached-tip path (v3.15.0). This is the standard
// long-term browser drawing-app architecture (Magma, Procreate web,
// Sketchbook web all use WebGL2 for stamping).
//
// Same visual output as Canvas 2D path. The win is per-stamp cost and
// future headroom: instanced rendering issues a single GPU draw call
// for a whole stroke segment regardless of stamp count, and the shader
// pipeline is the foundation for textured / scatter / dual brushes
// (Phases 10–11) when those land.
//
// Falls back gracefully if WebGL2 is unavailable: createGLBrush()
// returns null and canvas.js keeps using its Canvas 2D strokeBuffer.

const VERTEX_SHADER = `#version 300 es
in vec2 aQuadCorner;       // unit quad: (-0.5..0.5)
in vec2 aInstancePos;      // stamp center, project-pixel coords
in float aInstanceSize;    // stamp diameter, project-pixel
in float aInstanceAlpha;   // stamp alpha, 0..1

uniform vec2 uResolution;  // project canvas size in pixels

out vec2 vTexCoord;
out float vAlpha;

void main() {
  vec2 worldPos = aInstancePos + aQuadCorner * aInstanceSize;
  vec2 ndc = (worldPos / uResolution) * 2.0 - 1.0;
  ndc.y = -ndc.y; // flip Y to match canvas convention
  gl_Position = vec4(ndc, 0.0, 1.0);
  vTexCoord = aQuadCorner + 0.5; // 0..1
  vAlpha = aInstanceAlpha;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec2 vTexCoord;
in float vAlpha;
uniform sampler2D uTip;
uniform vec3 uColor;
out vec4 fragColor;

void main() {
  // Tip texture stores the alpha mask in the red channel (luminance).
  float tipAlpha = texture(uTip, vTexCoord).r;
  fragColor = vec4(uColor, tipAlpha * vAlpha);
}`;

const MAX_INSTANCES = 4096; // batch flush threshold

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[KPZ gl-brush] shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[KPZ gl-brush] program link failed:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/**
 * Build a brush-tip alpha texture from a Canvas 2D radial gradient.
 * Same visual profile as the Canvas 2D path for byte-for-byte parity.
 */
function buildTipTexture(gl, hardness) {
  const D = 256;
  const c = document.createElement('canvas');
  c.width = D; c.height = D;
  const ctx = c.getContext('2d');
  const cx = D / 2, cy = D / 2;
  const inner = (D / 2) * hardness;
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, D / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, D / 2, 0, Math.PI * 2);
  ctx.fill();

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * Try to create a GL-backed brush rasterizer at the given dimensions.
 * Returns the rasterizer object on success, or null if WebGL2 isn't
 * available / shader compilation fails. Caller should use the Canvas
 * 2D path on null.
 */
export function createGLBrush(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: true, // we read this canvas via drawImage
  });
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const program = linkProgram(gl, vs, fs);
  if (!program) return null;

  // Quad corners — drawn as a triangle strip, 4 verts.
  const quadVerts = new Float32Array([
    -0.5, -0.5,
     0.5, -0.5,
    -0.5,  0.5,
     0.5,  0.5,
  ]);
  const quadVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

  // Instance buffer — uploaded each flush with stamp data.
  const instanceVbo = gl.createBuffer();
  const instanceData = new Float32Array(MAX_INSTANCES * 4); // x, y, size, alpha

  const aQuadCorner    = gl.getAttribLocation(program, 'aQuadCorner');
  const aInstancePos   = gl.getAttribLocation(program, 'aInstancePos');
  const aInstanceSize  = gl.getAttribLocation(program, 'aInstanceSize');
  const aInstanceAlpha = gl.getAttribLocation(program, 'aInstanceAlpha');
  const uResolution    = gl.getUniformLocation(program, 'uResolution');
  const uTip           = gl.getUniformLocation(program, 'uTip');
  const uColor         = gl.getUniformLocation(program, 'uColor');

  // VAO captures attribute setup so we don't re-bind every draw.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.enableVertexAttribArray(aQuadCorner);
  gl.vertexAttribPointer(aQuadCorner, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aInstancePos);
  gl.vertexAttribPointer(aInstancePos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribDivisor(aInstancePos, 1);
  gl.enableVertexAttribArray(aInstanceSize);
  gl.vertexAttribPointer(aInstanceSize, 1, gl.FLOAT, false, 16, 8);
  gl.vertexAttribDivisor(aInstanceSize, 1);
  gl.enableVertexAttribArray(aInstanceAlpha);
  gl.vertexAttribPointer(aInstanceAlpha, 1, gl.FLOAT, false, 16, 12);
  gl.vertexAttribDivisor(aInstanceAlpha, 1);
  gl.bindVertexArray(null);

  let tipTexture = null;
  let cachedTipHardness = -1;
  let cachedColorRgb = [0, 0, 0];
  let pendingCount = 0;

  function ensureTip(hardness) {
    if (cachedTipHardness === hardness && tipTexture) return;
    if (tipTexture) gl.deleteTexture(tipTexture);
    tipTexture = buildTipTexture(gl, hardness);
    cachedTipHardness = hardness;
  }

  function setColor(rgb) {
    cachedColorRgb = rgb; // {r,g,b} in 0..1
  }

  function resize(w, h) {
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  function clear() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    pendingCount = 0;
  }

  function stamp(x, y, size, alpha) {
    if (pendingCount >= MAX_INSTANCES) flushBatch();
    const off = pendingCount * 4;
    instanceData[off]     = x;
    instanceData[off + 1] = y;
    instanceData[off + 2] = size;
    instanceData[off + 3] = alpha;
    pendingCount++;
  }

  function flushBatch() {
    if (pendingCount === 0) return;
    if (!tipTexture) ensureTip(0.8);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    // Upload only the used slice of instance data.
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, pendingCount * 4));

    // Source-over blending. premultipliedAlpha:false on context creation
    // means pure (color, alpha) output composes correctly.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,       gl.ONE_MINUS_SRC_ALPHA,
    );

    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform3f(uColor, cachedColorRgb[0], cachedColorRgb[1], cachedColorRgb[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tipTexture);
    gl.uniform1i(uTip, 0);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pendingCount);
    gl.bindVertexArray(null);
    pendingCount = 0;
  }

  return {
    canvas,
    supported: true,
    resize,
    clear,
    stamp,
    flush: flushBatch,
    ensureTip,
    setColor,
  };
}
