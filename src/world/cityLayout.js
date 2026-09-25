import { mulberry32, makeNoise } from './noise.js';
import { GRID_N, GRID_SPACING, HALF_WORLD } from './constants.js';

export const CITY = {
  streetW: 16,
  blockW: 48,
  pitch: 64,
  sidewalkW: 3.5,
  halfBlocks: 4,
  baseY: 2.05,
  curb: 0.18,
  playRadius: 210,
  plazaLawn: 15.5,
  plazaRoad: 23.5,
};

const wrapDist = (v, period) => {
  const r = ((v % period) + period) % period;
  return Math.min(r, period - r);
};

export function cityCell(x, z) {
  const { pitch, halfBlocks, blockW, streetW, sidewalkW } = CITY;
  const bx = Math.floor(x / pitch + (halfBlocks + 0.5));
  const bz = Math.floor(z / pitch + (halfBlocks + 0.5));
  const lx = x - (bx - halfBlocks) * pitch - pitch * 0.5;
  const lz = z - (bz - halfBlocks) * pitch - pitch * 0.5;
  const ax = Math.abs(lx), az = Math.abs(lz);
  const halfInner = blockW * 0.5;
  const halfStreet = streetW * 0.5;
  const insideX = ax <= halfInner;
  const insideZ = az <= halfInner;
  const onStreet = !insideX || !insideZ;
  const fromCurbX = ax - halfInner;
  const fromCurbZ = az - halfInner;
  const onSidewalk = onStreet && (
    (insideZ && fromCurbX > 0 && fromCurbX < sidewalkW)
    || (insideX && fromCurbZ > 0 && fromCurbZ < sidewalkW)
    || (!insideX && !insideZ && fromCurbX < sidewalkW && fromCurbZ < sidewalkW)
  );
  const distNS = pitch * 0.5 - wrapDist(x, pitch);
  const distEW = pitch * 0.5 - wrapDist(z, pitch);
  const onNS = distNS < halfStreet;
  const onEW = distEW < halfStreet;
  const intersection = onNS && onEW;
  const onRoad = onStreet && !onSidewalk;
  return {
    bx, bz, lx, lz, ax, az, onStreet, onSidewalk, onRoad, onNS, onEW, intersection,
    halfInner, distNS, distEW, fromCurbX, fromCurbZ,
  };
}

const KIND = { plaza: 0, street: 1, intact: 2, damaged: 3, ruined: 4, lot: 5, crater: 6 };
/** Must match `FLOOR_H` in skyscraper.js (facade module height). */
const FLOOR_H = 3;

function towerFloors(kind, bx, bz, rand) {
  const { halfBlocks } = CITY;
  if (kind === KIND.plaza || kind === KIND.crater || kind === KIND.lot) return 0;
  const dist = Math.hypot(bx - halfBlocks, bz - halfBlocks);
  if (kind === KIND.ruined) return 11 + Math.floor(rand() * 13);
  if (kind === KIND.damaged) return 21 + Math.floor(rand() * 18);
  if (dist < 1.15) return 48 + Math.floor(rand() * 16);
  if (dist < 2.4) return 34 + Math.floor(rand() * 18);
  return 26 + Math.floor(rand() * 18);
}

function towerStyle(kind, rand) {
  if (kind === KIND.damaged && rand() < 0.38) return 'factory';
  if (rand() < 0.24) return 'factory';
  return 'apt';
}

function kindAt(bx, bz, rand) {
  const { halfBlocks } = CITY;
  if (bx === halfBlocks && bz === halfBlocks) return KIND.plaza;
  const edge = bx === 0 || bz === 0 || bx === halfBlocks * 2 || bz === halfBlocks * 2;
  if (edge) return rand() < 0.55 ? KIND.ruined : KIND.damaged;
  const h = rand();
  if (h < 0.06) return KIND.crater;
  if (h < 0.2) return KIND.ruined;
  if (h < 0.48) return KIND.damaged;
  if (h < 0.58) return KIND.lot;
  return KIND.intact;
}

// Cover used to be blank concrete slabs. Street furniture now provides cover.
function generateCover() {
  return [];
}

function manhattanKind(bx, bz) {
  const { halfBlocks } = CITY;
  if (bx === halfBlocks && bz === halfBlocks) return KIND.plaza;
  return KIND.intact;
}

function manhattanFloors(bx, bz, rand) {
  const { halfBlocks } = CITY;
  const dist = Math.hypot(bx - halfBlocks, bz - halfBlocks);
  if (dist < 0.2) return 0;
  if (dist < 1.2) return 52 + Math.floor(rand() * 22);
  if (dist < 2.3) return 38 + Math.floor(rand() * 18);
  return 26 + Math.floor(rand() * 16);
}

export function generateCityLayout(seed, opts = {}) {
  const theme = opts.theme || 'ruins';
  const rand = mulberry32(seed ^ (theme === 'manhattan' ? 0xa11a77 : 0xc17a70));
  const { halfBlocks, pitch, blockW, baseY } = CITY;
  const blocks = [];
  const buildingBoxes = [];
  for (let bz = 0; bz <= halfBlocks * 2; bz++) {
    for (let bx = 0; bx <= halfBlocks * 2; bx++) {
      const cx = (bx - halfBlocks) * pitch;
      const cz = (bz - halfBlocks) * pitch;
      const kind = theme === 'manhattan' ? manhattanKind(bx, bz) : kindAt(bx, bz, rand);
      const rot = Math.floor(rand() * 4);
      const floors = theme === 'manhattan' ? manhattanFloors(bx, bz, rand) : towerFloors(kind, bx, bz, rand);
      blocks.push({ bx, bz, cx, cz, kind, rot, floors });
      if (floors > 0) {
        const inset = kind === KIND.ruined ? 5 : kind === KIND.damaged ? 3 : 2;
        const w = blockW - inset * 2;
        const crown = kind === KIND.ruined ? 2 : 5;
        const h = floors * FLOOR_H + crown;
        buildingBoxes.push({
          x0: cx - w * 0.5, x1: cx + w * 0.5,
          z0: cz - w * 0.5, z1: cz + w * 0.5,
          y0: baseY, y1: baseY + h,
          kind, rot, floors, style: towerStyle(kind, rand),
        });
      }
    }
  }
  const coverBoxes = generateCover(blocks, rand);
  const spawn = theme === 'manhattan' ? { x: 6.2, z: 40 } : { x: 0, z: 13.2 };
  const peak = { x: 0, z: -10, h: baseY + 3 };
  return { blocks, buildingBoxes, coverBoxes, spawn, peak, seed, theme };
}

export function cityHeightAt(x, z, layout, noise) {
  const { baseY, playRadius, curb, plazaLawn, plazaRoad } = CITY;
  const r = Math.hypot(x, z);
  if (r > playRadius + 40) {
    const t = Math.min(1, (r - playRadius) / 35);
    return baseY + t * t * 28;
  }
  if (r < plazaLawn) {
    const n = noise.fbm2(x * 0.35, z * 0.35, 2) * 0.04;
    return baseY + curb + 0.06 + n;
  }
  if (r < plazaRoad) return baseY - 0.13;
  const cell = cityCell(x, z);
  let h = baseY;
  if (cell.onRoad) h -= 0.12;
  else if (cell.onSidewalk) h += curb;

  const blk = layout.blocks.find((b) => b.bx === cell.bx && b.bz === cell.bz);
  if (layout.theme === 'manhattan') {
    if (cell.onRoad) return baseY - 0.1;
    if (cell.onSidewalk) return baseY + curb;
    if (r < CITY.plazaLawn) return baseY + curb + 0.04;
    return baseY;
  }
  if (blk?.kind === KIND.crater && !cell.onRoad) {
    const dx = x - blk.cx, dz = z - blk.cz;
    const d = Math.hypot(dx, dz);
    h -= Math.max(0, 1 - d / 16) * 2.8;
  }
  if ((blk?.kind === KIND.lot || blk?.kind === KIND.ruined) && !cell.onStreet) {
    const n = noise.fbm2(x * 0.08, z * 0.08, 3);
    h += (n * 0.5 + 0.5) * 0.9;
  }
  const rubble = noise.fbm2(x * 0.15 + 3, z * 0.15, 2) * 0.35;
  h += cell.onRoad ? rubble * 0.06 : cell.onSidewalk ? rubble * 0.12 : rubble;
  return h;
}

export function cityBiomeAt(x, z, layout) {
  const r = Math.hypot(x, z);
  if (r < CITY.plazaLawn) return { sand: 0, grass: 1, rock: 0, forest: 0 };
  if (r < CITY.plazaRoad) return { sand: 1, grass: 0, rock: 0, forest: 0 };
  const cell = cityCell(x, z);
  const blk = layout.blocks.find((b) => b.bx === cell.bx && b.bz === cell.bz);
  let sand = 0, grass = 0, rock = 0, forest = 0;
  if (cell.onRoad) sand = 1;
  else if (cell.onSidewalk) grass = 1;
  else if (blk?.kind === KIND.lot || blk?.kind === KIND.plaza) forest = 0.65 + (blk.kind === KIND.plaza ? 0.2 : 0);
  else if (blk?.kind === KIND.crater || blk?.kind === KIND.ruined) rock = 0.85;
  else if (blk?.kind === KIND.damaged) { rock = 0.35; grass = 0.25; sand = 0.2; }
  else grass = 0.15, sand = 0.1, rock = 0.05;
  if (!cell.onStreet && blk?.kind === KIND.intact) { grass = 0.08; sand = 0.05; rock = 0.02; forest = 0.05; }
  const sum = sand + grass + rock + forest || 1;
  return { sand: sand / sum, grass: grass / sum, rock: rock / sum, forest: forest / sum };
}

export function buildCityHeightmap(seed, opts = {}) {
  const N = GRID_N;
  const layout = generateCityLayout(seed, opts);
  const noise = makeNoise(seed + 901);
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = j * GRID_SPACING - HALF_WORLD;
    for (let i = 0; i < N; i++) {
      const x = i * GRID_SPACING - HALF_WORLD;
      heights[j * N + i] = cityHeightAt(x, z, layout, noise);
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
      const b = cityBiomeAt(x, z, layout);
      biome[k * 4] = Math.round(b.sand * 255);
      biome[k * 4 + 1] = Math.round(b.grass * 255);
      biome[k * 4 + 2] = Math.round(b.rock * 255);
      biome[k * 4 + 3] = Math.round(b.forest * 255);
    }
  }
  return { heights, normals, biome, spawn: layout.spawn, peak: layout.peak, layout };
}
