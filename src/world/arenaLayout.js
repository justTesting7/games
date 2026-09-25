import { makeNoise } from './noise.js';
import { GRID_N, GRID_SPACING, HALF_WORLD } from './constants.js';

/** Madison Square Garden: NBA court in an oval bowl, concourse, outer halls. */
export const ARENA = {
  baseY: 2.05,
  courtHX: 14.325,
  courtHZ: 7.62,
  hoopInset: 1.575,
  sx: 18.4,
  sz: 12.2,
  bowlIn: 1.06,
  concIn: 2.28,
  concOut: 3.18,
  hallOut: 4.42,
  facadeOut: 4.74,
  plazaOut: 6.45,
  playU: 7.35,
  concY: 8.35,
  playRadius: 158,
  tunnelHalf: 2.55,
};

export function ovalU(x, z) {
  return Math.hypot(x / ARENA.sx, z / ARENA.sz);
}

export function hoopX() {
  return ARENA.courtHX - ARENA.hoopInset;
}

/** Eight vomitoria in oval-parameter space: cardinals stay level, diagonals ramp up. */
export function tunnelInfo(x, z) {
  const ang = Math.atan2(z / ARENA.sz, x / ARENA.sx);
  const step = Math.PI / 4;
  const slot = Math.round(ang / step);
  const center = slot * step;
  const dAng = Math.abs(Math.atan2(Math.sin(ang - center), Math.cos(ang - center)));
  const radius = Math.hypot(x, z);
  const halfAng = Math.max(0.12, ARENA.tunnelHalf / Math.max(radius, 8));
  const u = ovalU(x, z);
  const inBand = dAng < halfAng && u > 0.98 && u < ARENA.facadeOut + 0.2;
  const isRamp = inBand && (Math.abs(slot) & 1) === 1;
  return { slot, center, lat: dAng * Math.max(radius, 1), inBand, isRamp, u };
}

export function arenaZone(x, z) {
  const u = ovalU(x, z);
  const tun = tunnelInfo(x, z);
  if (Math.abs(x) <= ARENA.courtHX && Math.abs(z) <= ARENA.courtHZ) return 'court';
  if (u < ARENA.bowlIn) return 'apron';
  if (tun.inBand && tun.isRamp) {
    if (u < ARENA.concIn) return 'ramp';
    if (u < ARENA.concOut) return 'concourse';
    return 'hall';
  }
  if (tun.inBand) return 'tunnel';
  if (u < ARENA.concIn) return 'bowl';
  if (u < ARENA.concOut) return 'concourse';
  if (u < ARENA.hallOut) return 'hall';
  if (u < ARENA.facadeOut) return 'facade';
  if (u < ARENA.plazaOut) return 'plaza';
  return 'outside';
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function generateArenaLayout(seed) {
  const hx = hoopX();
  return {
    seed,
    spawn: { x: 0, z: 0 },
    peak: { x: hx, z: 0, h: ARENA.baseY + 3.05 },
  };
}

export function arenaHeightAt(x, z, _layout, noise) {
  const { baseY, bowlIn, concIn, concOut, playRadius, concY } = ARENA;
  const r = Math.hypot(x, z);
  if (r > playRadius + 18) {
    const t = Math.min(1, (r - playRadius) / 32);
    return baseY + t * t * 26;
  }
  const u = ovalU(x, z);
  const tun = tunnelInfo(x, z);
  let h = baseY;

  if (tun.inBand && tun.isRamp) {
    if (u > 1.52 && u < concIn) {
      const t = smoothstep(1.52, concIn, u);
      h = baseY + t * (concY - baseY);
    } else if (u >= concIn && u < concOut) {
      h = concY;
    }
  } else if (tun.inBand) {
    h = baseY;
  } else if (u >= bowlIn && u < concIn) {
    const t = smoothstep(bowlIn, concIn, u);
    h = baseY + t * (concY - baseY) * 1.65;
  } else if (u >= concIn && u < concOut) {
    h = concY;
  }

  const n = noise.fbm2(x * 0.11 + 2.1, z * 0.11, 2) * 0.035;
  if (u < bowlIn) h += n * 0.15;
  else if (tun.inBand) h += n * 0.25;
  else if (u >= concIn && u < concOut && !tun.inBand) h += n * 0.2;
  else if (u >= ARENA.facadeOut) h += n * 0.45;
  return h;
}

export function arenaBiomeAt(x, z) {
  const zone = arenaZone(x, z);
  if (zone === 'court' || zone === 'apron') return { sand: 0.05, grass: 0.08, rock: 0.05, forest: 0.82 };
  if (zone === 'concourse' || zone === 'ramp') return { sand: 0.08, grass: 0.78, rock: 0.1, forest: 0.04 };
  if (zone === 'hall' || zone === 'tunnel') return { sand: 0.12, grass: 0.7, rock: 0.14, forest: 0.04 };
  if (zone === 'bowl' || zone === 'facade') return { sand: 0.08, grass: 0.12, rock: 0.72, forest: 0.08 };
  if (zone === 'plaza') return { sand: 0.82, grass: 0.08, rock: 0.08, forest: 0.02 };
  return { sand: 0.55, grass: 0.1, rock: 0.3, forest: 0.05 };
}

export function buildArenaHeightmap(seed) {
  const N = GRID_N;
  const layout = generateArenaLayout(seed);
  const noise = makeNoise(seed + 417);
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = j * GRID_SPACING - HALF_WORLD;
    for (let i = 0; i < N; i++) {
      const x = i * GRID_SPACING - HALF_WORLD;
      heights[j * N + i] = arenaHeightAt(x, z, layout, noise);
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
      const b = arenaBiomeAt(x, z);
      biome[k * 4] = Math.round(b.sand * 255);
      biome[k * 4 + 1] = Math.round(b.grass * 255);
      biome[k * 4 + 2] = Math.round(b.rock * 255);
      biome[k * 4 + 3] = Math.round(b.forest * 255);
    }
  }
  return { heights, normals, biome, spawn: layout.spawn, peak: layout.peak, layout };
}
