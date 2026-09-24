import * as THREE from 'three';

const CONTEXT_TYPES = ['webgl2'];

// iOS and some Android WebViews reject the first getContext() when extras
// like powerPreference or stencil are set, then poison that canvas so Three's
// own retry also fails. Try the least demanding WebGL2 attrs first, and swap
// the canvas if the first element is burned.
const ATTR_SETS = [
  { alpha: true, depth: true, antialias: false, failIfMajorPerformanceCaveat: false },
  { antialias: false, failIfMajorPerformanceCaveat: false },
  { failIfMajorPerformanceCaveat: false },
  {},
  null,
  {
    alpha: true,
    depth: true,
    stencil: false,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false,
  },
];

function tryGetContext(el, attrs) {
  for (const type of CONTEXT_TYPES) {
    try {
      const gl = attrs == null ? el.getContext(type) : el.getContext(type, attrs);
      if (gl && typeof gl.isContextLost === 'function' && gl.isContextLost()) continue;
      if (gl) return gl;
    } catch {
      /* some WebViews throw instead of returning null */
    }
  }
  return null;
}

function ensureCanvasSize(el) {
  if (!el.width) el.width = 2;
  if (!el.height) el.height = 2;
}

function replaceCanvas(old) {
  const fresh = document.createElement('canvas');
  fresh.id = old.id;
  fresh.className = old.className;
  if (old.hasAttribute('style')) fresh.setAttribute('style', old.getAttribute('style'));
  old.replaceWith(fresh);
  ensureCanvasSize(fresh);
  return fresh;
}

function acquireContext(canvas) {
  let el = canvas;
  for (let i = 0; i < ATTR_SETS.length; i++) {
    ensureCanvasSize(el);
    const gl = tryGetContext(el, ATTR_SETS[i]);
    if (gl) return { canvas: el, gl };
    el = replaceCanvas(el);
  }
  return { canvas: el, gl: null };
}

export function createGameRenderer(canvas) {
  let { canvas: el, gl } = acquireContext(canvas);
  if (!gl) {
    throw new Error('This browser could not start WebGL 2. Close other 3D tabs and reload.');
  }

  const renderer = new THREE.WebGLRenderer({
    canvas: el,
    context: gl,
    antialias: false,
    alpha: false,
    stencil: false,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false,
  });
  renderer.info.autoReset = false;
  renderer.setClearColor(0x05080b, 1);
  el.addEventListener('webglcontextlost', (e) => e.preventDefault());
  return { renderer, canvas: el };
}
