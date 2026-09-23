import * as THREE from 'three';
import { TEX_NAMES } from './blocks.js';
import { mulberry32 } from './noise.js';

const S = 16;

function makeTex(seed) {
  const rgba = new Uint8ClampedArray(S * S * 4);
  const height = new Float32Array(S * S).fill(0.5);
  const smooth = new Float32Array(S * S).fill(0.15);
  const rand = mulberry32(seed * 7919 + 13);
  return { rgba, height, smooth, rand, normalStrength: 1.6 };
}

function put(t, x, y, c, h, sm) {
  x = ((x % S) + S) % S; y = ((y % S) + S) % S;
  const i = (y * S + x) * 4;
  t.rgba[i] = c[0]; t.rgba[i + 1] = c[1]; t.rgba[i + 2] = c[2]; t.rgba[i + 3] = c[3] ?? 255;
  if (h !== undefined) t.height[y * S + x] = h;
  if (sm !== undefined) t.smooth[y * S + x] = sm;
}

function get(t, x, y) {
  x = ((x % S) + S) % S; y = ((y % S) + S) % S;
  const i = (y * S + x) * 4;
  return [t.rgba[i], t.rgba[i + 1], t.rgba[i + 2], t.rgba[i + 3]];
}

const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f, c[3] ?? 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 255];

function speckle(t, base, variance, hv = 0.5) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = t.rand();
      const f = 1 - variance + r * variance * 2;
      put(t, x, y, shade(base, f), 0.5 + (r - 0.5) * hv);
    }
  }
}

function smoothNoise(t, scale) {
  const g = [];
  const n = Math.ceil(S / scale) + 1;
  for (let i = 0; i < n * n; i++) g.push(t.rand());
  return (x, y) => {
    const fx = x / scale, fy = y / scale;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const w = (a) => (a % (n - 1) + (n - 1)) % (n - 1);
    const v = (a, b) => g[w(a) + w(b) * n];
    const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * tx;
    const b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
}

const GRASS = [100, 146, 62];
const DIRT = [134, 96, 67];
const STONE = [125, 125, 125];
const SAND = [219, 207, 163];

function dirt(t) {
  speckle(t, DIRT, 0.14, 0.6);
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(t.rand() * S), y = Math.floor(t.rand() * S);
    const dark = t.rand() < 0.6;
    put(t, x, y, dark ? shade(DIRT, 0.68) : [150, 118, 88], dark ? 0.25 : 0.8);
  }
}

function stone(t) {
  const sn = smoothNoise(t, 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = sn(x, y) * 0.6 + t.rand() * 0.4;
      const f = 0.82 + v * 0.3;
      put(t, x, y, shade(STONE, f), v, 0.25);
    }
  }
  for (let i = 0; i < 5; i++) {
    let x = Math.floor(t.rand() * S), y = Math.floor(t.rand() * S);
    const len = 2 + Math.floor(t.rand() * 4);
    for (let k = 0; k < len; k++) {
      put(t, x, y, shade(STONE, 0.7), 0.1, 0.1);
      x += t.rand() < 0.5 ? 1 : 0; y += t.rand() < 0.5 ? 1 : -1;
    }
  }
}

const GEN = {
  grass_top(t) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = t.rand();
        const f = 0.8 + r * 0.35;
        put(t, x, y, [GRASS[0] * f, GRASS[1] * f, GRASS[2] * f * 0.95], r, 0.2);
      }
    }
    for (let i = 0; i < 14; i++) {
      put(t, Math.floor(t.rand() * S), Math.floor(t.rand() * S), shade(GRASS, 1.2), 0.95, 0.3);
    }
    t.normalStrength = 1.2;
  },
  grass_side(t) {
    dirt(t);
    for (let x = 0; x < S; x++) {
      const depth = 3 + Math.floor(t.rand() * 2.2) + (t.rand() < 0.25 ? 1 : 0);
      for (let y = 0; y < depth; y++) {
        const f = 0.82 + t.rand() * 0.3;
        put(t, x, y, shade(GRASS, f * (y === depth - 1 ? 0.8 : 1)), 0.7 + t.rand() * 0.2, 0.2);
      }
    }
  },
  dirt,
  stone,
  sand(t) {
    speckle(t, SAND, 0.06, 0.4);
    for (let i = 0; i < 20; i++) {
      put(t, Math.floor(t.rand() * S), Math.floor(t.rand() * S), t.rand() < 0.5 ? shade(SAND, 0.86) : [232, 224, 190], t.rand(), 0.35);
    }
    t.normalStrength = 0.8;
  },
  log_side(t) {
    const base = [104, 82, 50];
    for (let x = 0; x < S; x++) {
      const stripe = t.rand();
      for (let y = 0; y < S; y++) {
        const groove = (x % 4 === 0) || stripe < 0.2;
        const f = (groove ? 0.7 : 0.95) + t.rand() * 0.12;
        put(t, x, y, shade(base, f), groove ? 0.15 : 0.6 + t.rand() * 0.2, 0.1);
      }
    }
    t.normalStrength = 2.2;
  },
  log_top(t) {
    const bark = [104, 82, 50];
    const wood = [176, 143, 88];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x - 7.5, dy = y - 7.5;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (d > 6.6) { put(t, x, y, shade(bark, 0.9 + t.rand() * 0.15), 0.5, 0.1); continue; }
        const ring = Math.floor(Math.sqrt(dx * dx + dy * dy) + t.rand() * 0.3) % 2 === 0;
        put(t, x, y, shade(wood, ring ? 0.85 : 1.0), ring ? 0.35 : 0.55, 0.2);
      }
    }
  },
  leaves(t) { leaves(t, [58, 118, 36]); },
  birch_leaves(t) { leaves(t, [96, 138, 58]); },
  planks(t) {
    const base = [168, 134, 84];
    for (let y = 0; y < S; y++) {
      const board = Math.floor(y / 4);
      const seam = y % 4 === 3;
      const offset = board % 2 === 0 ? 3 : 11;
      for (let x = 0; x < S; x++) {
        const grain = Math.sin((x + board * 5) * 0.9 + y * 0.3) * 0.04;
        let f = 0.92 + t.rand() * 0.1 + grain;
        let h = 0.6;
        if (seam) { f = 0.62; h = 0.1; }
        if (x === offset && !seam) { f = 0.72; h = 0.2; }
        put(t, x, y, shade(base, f), h, seam ? 0.1 : 0.35);
      }
    }
  },
  cobblestone(t) {
    const pts = [];
    for (let i = 0; i < 11; i++) pts.push([t.rand() * S, t.rand() * S, 0.8 + t.rand() * 0.3]);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let d1 = 1e9, d2 = 1e9, best = 0;
        for (let i = 0; i < pts.length; i++) {
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const dx = x + 0.5 - (pts[i][0] + ox * S), dy = y + 0.5 - (pts[i][1] + oy * S);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
          }
        }
        const edge = d2 - d1 < 1.1;
        const f = edge ? 0.5 : pts[best][2] * (0.9 + t.rand() * 0.15) - d1 * 0.03;
        put(t, x, y, shade(STONE, f), edge ? 0.0 : 0.8 - d1 * 0.06, edge ? 0.05 : 0.3);
      }
    }
    t.normalStrength = 2.6;
  },
  glass(t) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const border = x === 0 || y === 0 || x === S - 1 || y === S - 1;
        if (border) put(t, x, y, [214, 234, 240, 255], 0.8, 0.95);
        else put(t, x, y, [200, 225, 235, 0], 0.5, 0.95);
      }
    }
    for (let i = 0; i < 4; i++) {
      put(t, 3 + i, 5 - i + 5, [240, 250, 255, 255], 0.8, 0.95);
      put(t, 9 + i, 6 - i + 5, [240, 250, 255, 255], 0.8, 0.95);
    }
  },
  bricks(t) {
    const brick = [150, 74, 58];
    const mortar = [168, 160, 150];
    for (let y = 0; y < S; y++) {
      const row = Math.floor(y / 4);
      for (let x = 0; x < S; x++) {
        const bx = (x + (row % 2) * 4) % 8;
        const isMortar = y % 4 === 3 || bx === 7;
        if (isMortar) put(t, x, y, shade(mortar, 0.9 + t.rand() * 0.15), 0.1, 0.05);
        else put(t, x, y, shade(brick, 0.85 + t.rand() * 0.22), 0.7 + t.rand() * 0.2, 0.3);
      }
    }
    t.normalStrength = 2.4;
  },
  snow(t) {
    speckle(t, [238, 246, 252], 0.035, 0.3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.smooth[y * S + x] = 0.5;
    t.normalStrength = 0.6;
  },
  snow_side(t) {
    dirt(t);
    for (let x = 0; x < S; x++) {
      const depth = 3 + Math.floor(t.rand() * 2.5);
      for (let y = 0; y < depth; y++) put(t, x, y, shade([238, 246, 252], 0.94 + t.rand() * 0.06), 0.8, 0.5);
    }
  },
  gravel(t) {
    speckle(t, [132, 126, 124], 0.12, 0.3);
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(t.rand() * S), y = Math.floor(t.rand() * S);
      const c = t.rand() < 0.5 ? [98, 92, 92] : [170, 160, 158];
      const h = 0.7 + t.rand() * 0.3;
      put(t, x, y, c, h, 0.3); put(t, x + 1, y, shade(c, 0.9), h, 0.3);
      put(t, x, y + 1, shade(c, 0.85), h - 0.2, 0.3); put(t, x + 1, y + 1, shade(c, 0.7), h - 0.3, 0.3);
    }
    t.normalStrength = 2.2;
  },
  coal_ore(t) { ore(t, [36, 36, 36], 0.25); },
  iron_ore(t) { ore(t, [216, 176, 146], 0.6); },
  gold_ore(t) { ore(t, [250, 210, 60], 0.85); },
  diamond_ore(t) { ore(t, [90, 236, 226], 0.95); },
  tallgrass(t) {
    for (let i = 0; i < S * S; i++) t.rgba[i * 4 + 3] = 0;
    for (let b = 0; b < 9; b++) {
      let x = 1 + Math.floor(t.rand() * 14);
      const hgt = 6 + Math.floor(t.rand() * 9);
      for (let k = 0; k < hgt; k++) {
        const y = S - 1 - k;
        const f = 0.7 + (k / hgt) * 0.5;
        put(t, x, y, shade(GRASS, f), 0.5, 0.3);
        if (t.rand() < 0.2) x += t.rand() < 0.5 ? 1 : -1;
        x = Math.max(0, Math.min(S - 1, x));
      }
    }
  },
  flower_red(t) { flower(t, [200, 30, 30], [240, 200, 60]); },
  flower_yellow(t) { flower(t, [250, 220, 40], [230, 140, 20]); },
  glowstone(t) {
    const base = [220, 170, 90];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = t.rand();
        const c = r < 0.2 ? [255, 240, 190] : r < 0.55 ? [242, 196, 110] : r < 0.85 ? base : [160, 110, 60];
        put(t, x, y, c, r, 0.4);
      }
    }
  },
  bedrock(t) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = t.rand();
        put(t, x, y, r < 0.33 ? [40, 40, 40] : r < 0.66 ? [85, 85, 85] : [130, 130, 130], r, 0.1);
      }
    }
    t.normalStrength = 3;
  },
  sandstone_side(t) {
    const base = [216, 200, 152];
    for (let y = 0; y < S; y++) {
      const band = y < 3 ? 1.02 : y > 11 ? 0.9 : (y % 3 === 0 ? 0.92 : 0.98);
      for (let x = 0; x < S; x++) put(t, x, y, shade(base, band + t.rand() * 0.05), band - 0.4, 0.2);
    }
  },
  sandstone_top(t) { speckle(t, [220, 206, 160], 0.05, 0.3); },
  birch_side(t) {
    const base = [216, 214, 206];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(t, x, y, shade(base, 0.92 + t.rand() * 0.08), 0.6, 0.25);
    for (let i = 0; i < 7; i++) {
      const y = Math.floor(t.rand() * S), x = Math.floor(t.rand() * S), w = 2 + Math.floor(t.rand() * 4);
      for (let k = 0; k < w; k++) put(t, x + k, y, [48, 44, 40], 0.2, 0.1);
    }
  },
  cactus_side(t) {
    const base = [72, 128, 48];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const rib = x % 4 === 1;
        put(t, x, y, shade(base, (rib ? 1.12 : 0.88) + t.rand() * 0.08), rib ? 0.8 : 0.35, 0.45);
      }
    }
    for (let i = 0; i < 10; i++) put(t, 1 + 4 * Math.floor(t.rand() * 4), Math.floor(t.rand() * S), [220, 220, 170], 1.0, 0.2);
  },
  cactus_top(t) {
    const base = [90, 146, 58];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        put(t, x, y, shade(base, d > 6 ? 0.75 : 0.95 + t.rand() * 0.1), d > 6 ? 0.3 : 0.6, 0.4);
      }
    }
  },
};

function leaves(t, base) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = t.rand();
      if (r < 0.22) { put(t, x, y, [0, 0, 0, 0], 0.0, 0.3); continue; }
      const f = 0.7 + t.rand() * 0.45;
      put(t, x, y, shade(base, f), f - 0.3, 0.45);
    }
  }
  t.normalStrength = 1.8;
}

function ore(t, color, shininess) {
  stone(t);
  const clusters = 4 + Math.floor(t.rand() * 2);
  for (let c = 0; c < clusters; c++) {
    const cx = 2 + Math.floor(t.rand() * 12), cy = 2 + Math.floor(t.rand() * 12);
    for (let i = 0; i < 5; i++) {
      const x = cx + Math.floor(t.rand() * 3) - 1, y = cy + Math.floor(t.rand() * 3) - 1;
      const f = 0.8 + t.rand() * 0.35;
      put(t, x, y, shade(color, f), 0.85, shininess);
    }
  }
}

function flower(t, petal, center) {
  for (let i = 0; i < S * S; i++) t.rgba[i * 4 + 3] = 0;
  for (let y = 7; y < S; y++) put(t, 7, y, shade(GRASS, 0.8 + t.rand() * 0.2), 0.5, 0.3);
  put(t, 8, 11, shade(GRASS, 0.9), 0.5, 0.3); put(t, 9, 10, shade(GRASS, 0.9), 0.5, 0.3);
  put(t, 6, 12, shade(GRASS, 0.9), 0.5, 0.3); put(t, 5, 11, shade(GRASS, 0.9), 0.5, 0.3);
  const pts = [[6, 4], [7, 4], [8, 4], [5, 5], [6, 5], [8, 5], [9, 5], [5, 6], [9, 6], [6, 7], [7, 7], [8, 7], [7, 3], [9, 4], [5, 4], [6, 6], [8, 6]];
  for (const [x, y] of pts) put(t, x, y, shade(petal, 0.85 + t.rand() * 0.25), 0.7, 0.4);
  put(t, 7, 5, center, 0.9, 0.5); put(t, 7, 6, shade(center, 0.9), 0.9, 0.5);
}

function computeNormals(t, out, offset) {
  const h = (x, y) => t.height[((y + S) % S) * S + ((x + S) % S)];
  const k = t.normalStrength;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
      let nx = -dx * k * 0.25, ny = dy * k * 0.25, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      // Rows are flipped so that image-top ends up at v = 1.
      const i = offset + ((S - 1 - y) * S + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = t.smooth[y * S + x] * 255;
    }
  }
}

export function createTextures(renderer) {
  const N = TEX_NAMES.length;
  const albedo = new Uint8Array(S * S * 4 * N);
  const normal = new Uint8Array(S * S * 4 * N);
  const canvases = {};
  TEX_NAMES.forEach((name, layer) => {
    const t = makeTex(layer + 1);
    GEN[name](t);
    const off = layer * S * S * 4;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const src = (y * S + x) * 4;
        const dst = off + ((S - 1 - y) * S + x) * 4;
        for (let c = 0; c < 4; c++) albedo[dst + c] = t.rgba[src + c];
      }
    }
    computeNormals(t, normal, off);
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.rgba), S, S), 0, 0);
    canvases[name] = cv;
  });

  // Bleed opaque colour into transparent texels so mipmaps don't darken cutout edges.
  for (let l = 0; l < N; l++) {
    const off = l * S * S * 4;
    for (let i = 0; i < S * S; i++) {
      const p = off + i * 4;
      if (albedo[p + 3] !== 0) continue;
      const x = i % S, y = Math.floor(i / S);
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = off + (((y + dy + S) % S) * S + ((x + dx + S) % S)) * 4;
        if (albedo[q + 3] > 0) { r += albedo[q]; g += albedo[q + 1]; b += albedo[q + 2]; n++; }
      }
      if (n) { albedo[p] = r / n; albedo[p + 1] = g / n; albedo[p + 2] = b / n; }
    }
  }

  const mk = (data) => {
    const tex = new THREE.DataArrayTexture(data, S, S, N);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  };
  return { albedo: mk(albedo), normal: mk(normal), canvases };
}
