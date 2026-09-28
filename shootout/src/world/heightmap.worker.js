import { makeNoise, mulberry32 } from './noise.js';
import { buildCityHeightmap } from './cityLayout.js';
import { buildArenaHeightmap } from './arenaLayout.js';
import { buildStudioHeightmap } from './studioLayout.js';
import { GRID_N, GRID_SPACING, HALF_WORLD } from './constants.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function generateIsland(seed) {
  const N = GRID_N;
  const noise = makeNoise(seed);
  const { noise2, fbm2 } = noise;
  const heights = new Float32Array(N * N);

  for (let j = 0; j < N; j++) {
    const z = j * GRID_SPACING - HALF_WORLD;
    for (let i = 0; i < N; i++) {
      const x = i * GRID_SPACING - HALF_WORLD;
      const wx = x + fbm2(x * 0.0015 + 11.3, z * 0.0015, 3) * 150;
      const wz = z + fbm2(x * 0.0015, z * 0.0015 + 37.1, 3) * 150;
      const r = Math.hypot(wx * 1.05, wz * 1.2) / 640;
      const coast = 1 - smoothstep(0.55, 1.02, r + fbm2(wx * 0.004, wz * 0.004, 3) * 0.12);

      const hills = fbm2(wx * 0.0032, wz * 0.0032, 5) * 0.5 + 0.5;
      let ridge = 0, amp = 1, freq = 0.0021, norm = 0;
      for (let o = 0; o < 5; o++) {
        const n = 1 - Math.abs(noise2(wx * freq + o * 17.7, wz * freq - o * 9.1));
        ridge += n * n * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      ridge /= norm;
      // Mountains rise in the north-west of the island, leaving meadows and
      // beaches elsewhere.
      const mMask = smoothstep(0.35, 0.75, fbm2(wx * 0.0011 + 5.2, wz * 0.0011 - 3.7, 2) * 0.5 + 0.5 + (-x - z) / 2600)
        * (1 - smoothstep(0.35, 0.85, r));
      const detail = fbm2(x * 0.025, z * 0.025, 4) * 1.1 + fbm2(x * 0.09, z * 0.09, 2) * 0.25;
      let land = 2 + hills * 20 + Math.pow(ridge, 1.6) * mMask * 125 + detail;
      let h = land * coast + (1 - coast) * -24;
      if (h > 0 && h < 5) h = 5 * Math.pow(h / 5, 1.7);
      heights[j * N + i] = h;
    }
  }

  const normals = new Uint8Array(N * N * 4);
  const biome = new Uint8Array(N * N * 4);
  const nrm = new Float32Array(N * N * 3);
  const H = (i, j) => heights[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const nx = (H(i - 1, j) - H(i + 1, j)) / (2 * GRID_SPACING);
      const nz = (H(i, j - 1) - H(i, j + 1)) / (2 * GRID_SPACING);
      const l = Math.hypot(nx, 1, nz);
      const k = j * N + i;
      nrm[k * 3] = nx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = nz / l;
      normals[k * 4] = Math.round((nx / l * 0.5 + 0.5) * 255);
      normals[k * 4 + 1] = Math.round((1 / l * 0.5 + 0.5) * 255);
      normals[k * 4 + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      normals[k * 4 + 3] = 255;
    }
  }

  for (let j = 0; j < N; j++) {
    const z = j * GRID_SPACING - HALF_WORLD;
    for (let i = 0; i < N; i++) {
      const x = i * GRID_SPACING - HALF_WORLD;
      const k = j * N + i;
      const h = heights[k];
      const slope = 1 - nrm[k * 3 + 1];
      const n1 = fbm2(x * 0.02, z * 0.02, 3);
      const n2 = fbm2(x * 0.011 + 40, z * 0.011, 3);
      const sand = 1 - smoothstep(1.4, 3.0, h + n1 * 1.3);
      const rock = Math.max(smoothstep(0.2, 0.34, slope + n2 * 0.07), smoothstep(70, 92, h + n2 * 14));
      const fN = fbm2(x * 0.0042 - 13, z * 0.0042 + 7, 4) + 0.12;
      const forest = smoothstep(0.0, 0.16, fN) * (1 - smoothstep(48, 70, h + n2 * 8)) * smoothstep(2.5, 5, h);
      const land = (1 - sand) * (1 - rock);
      const s = sand * (1 - rock), g = land * (1 - forest), f = land * forest;
      const sum = s + g + rock + f || 1;
      biome[k * 4] = Math.round((s / sum) * 255);
      biome[k * 4 + 1] = Math.round((g / sum) * 255);
      biome[k * 4 + 2] = Math.round((rock / sum) * 255);
      biome[k * 4 + 3] = Math.round((f / sum) * 255);
    }
  }

  // Spawn in an open meadow close to the beach.
  const rand = mulberry32(seed ^ 0x5bd1e995);
  let best = null, bestScore = -Infinity;
  for (let s = 0; s < 40000; s++) {
    const i = 8 + Math.floor(rand() * (N - 16));
    const j = 8 + Math.floor(rand() * (N - 16));
    const k = j * N + i;
    const h = heights[k];
    if (h < 3 || h > 14) continue;
    const slope = 1 - nrm[k * 3 + 1];
    const grass = biome[k * 4 + 1] / 255;
    let nearSand = 0;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const ii = Math.round(i + Math.cos(ang) * 30), jj = Math.round(j + Math.sin(ang) * 30);
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      if (heights[jj * N + ii] < 1.5) nearSand++;
    }
    const score = -Math.abs(h - 6) * 0.3 - slope * 30 + grass * 3 + Math.min(nearSand, 3) * 0.8;
    if (score > bestScore) { bestScore = score; best = { x: i * GRID_SPACING - HALF_WORLD, z: j * GRID_SPACING - HALF_WORLD }; }
  }

  // Face the highest mountain from the spawn.
  let peak = { x: 0, z: 0, h: -Infinity };
  for (let j = 0; j < N; j += 4) for (let i = 0; i < N; i += 4) {
    const h = heights[j * N + i];
    if (h > peak.h) peak = { x: i * GRID_SPACING - HALF_WORLD, z: j * GRID_SPACING - HALF_WORLD, h };
  }

  return { heights, normals, biome, spawn: best || { x: 0, z: 0 }, peak };
}

self.onmessage = (e) => {
  const t0 = performance.now();
  const { seed, map = 'island' } = e.data;
  const out = map === 'city' ? buildCityHeightmap(seed)
    : map === 'manhattan' ? buildCityHeightmap(seed, { theme: 'manhattan' })
    : map === 'garden' ? buildArenaHeightmap(seed)
    : map === 'dizengoff' || map === 'square' ? buildStudioHeightmap(seed)
    : generateIsland(seed);
  out.ms = performance.now() - t0;
  out.map = map;
  self.postMessage(out, [out.heights.buffer, out.normals.buffer, out.biome.buffer]);
};
