import { mulberry32, makeNoise } from './noise.js';
import { GRID_N, GRID_SPACING, HALF_WORLD } from './constants.js';

export const CITY = {
  streetW: 11,
  blockW: 48,
  pitch: 59,
  halfBlocks: 4,
  baseY: 2.05,
  curb: 0.14,
  playRadius: 210,
};

export function cityCell(x, z) {
  const { pitch, halfBlocks } = CITY;
  const bx = Math.floor(x / pitch + (halfBlocks + 0.5));
  const bz = Math.floor(z / pitch + (halfBlocks + 0.5));
  const lx = x - (bx - halfBlocks) * pitch - pitch * 0.5;
  const lz = z - (bz - halfBlocks) * pitch - pitch * 0.5;
  const ax = Math.abs(lx), az = Math.abs(lz);
  const halfInner = CITY.blockW * 0.5;
  const halfStreet = CITY.streetW * 0.5;
  const onStreet = ax > halfInner || az > halfInner;
  const onSidewalk = onStreet && (ax < halfInner + CITY.curb + 0.6 && az < halfInner + CITY.curb + 0.6);
  return { bx, bz, lx, lz, onStreet, onSidewalk, halfInner };
}

const KIND = { plaza: 0, street: 1, intact: 2, damaged: 3, ruined: 4, lot: 5, crater: 6 };
/** Must match `FLOOR_H` in skyscraper.js (facade module height). */
const FLOOR_H = 4;

function towerFloors(kind, bx, bz, rand) {
  const { halfBlocks } = CITY;
  if (kind === KIND.plaza || kind === KIND.crater || kind === KIND.lot) return 0;
  const dist = Math.hypot(bx - halfBlocks, bz - halfBlocks);
  if (kind === KIND.ruined) return 8 + Math.floor(rand() * 10);
  if (kind === KIND.damaged) return 16 + Math.floor(rand() * 14);
  if (dist < 1.15) return 36 + Math.floor(rand() * 12);
  if (dist < 2.4) return 26 + Math.floor(rand() * 14);
  return 20 + Math.floor(rand() * 14);
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

function addCoverWall(covers, x0, x1, z0, z1, y1, type = 'cover') {
  covers.push({ x0, x1, z0, z1, y0: CITY.baseY, y1: CITY.baseY + y1, type });
}

// Low walls, berms and street dividers — shared by the heightmap pass and city meshes.
function generateCover(blocks, rand) {
  const { pitch, blockW, halfBlocks, streetW } = CITY;
  const covers = [];
  const half = blockW * 0.5;
  const street = streetW * 0.5 + half + 0.5;

  for (const b of blocks) {
    const { cx, cz, kind, bx, bz } = b;
    const plaza = bx === halfBlocks && bz === halfBlocks;
    const sides = [
      { dx: 1, dz: 0, px: cx + street, pz: cz, along: 'z', len: blockW - 6 },
      { dx: -1, dz: 0, px: cx - street, pz: cz, along: 'z', len: blockW - 6 },
      { dx: 0, dz: 1, px: cx, pz: cz + street, along: 'x', len: blockW - 6 },
      { dx: 0, dz: -1, px: cx, pz: cz - street, along: 'x', len: blockW - 6 },
    ];
    for (const s of sides) {
      const p = plaza ? 0.35 : kind === KIND.lot || kind === KIND.ruined ? 0.82 : 0.62;
      if (rand() > p) continue;
      const seg = 3 + Math.floor(rand() * 3);
      for (let i = 0; i < seg; i++) {
        const t = (i + 0.5) / seg - 0.5;
        const wLen = 2.2 + rand() * 2.8;
        const h = 1.55 + rand() * 1.35;
        const thick = 0.45 + rand() * 0.25;
        if (s.along === 'z') {
          const zc = s.pz + t * s.len;
          addCoverWall(covers, s.px - thick * 0.5, s.px + thick * 0.5, zc - wLen * 0.5, zc + wLen * 0.5, h);
        } else {
          const xc = s.px + t * s.len;
          addCoverWall(covers, xc - wLen * 0.5, xc + wLen * 0.5, s.pz - thick * 0.5, s.pz + thick * 0.5, h);
        }
      }
    }

    if (kind === KIND.lot || kind === KIND.ruined || kind === KIND.crater) {
      for (let k = 0; k < 3 + Math.floor(rand() * 4); k++) {
        const w = 3 + rand() * 5, d = 0.5 + rand() * 0.35, h = 1.8 + rand() * 2.2;
        const ox = (rand() - 0.5) * (blockW - w - 8);
        const oz = (rand() - 0.5) * (blockW - w - 8);
        addCoverWall(covers, cx + ox - w * 0.5, cx + ox + w * 0.5, cz + oz - d * 0.5, cz + oz + d * 0.5, h);
      }
    }
    if (kind === KIND.damaged && rand() > 0.35) {
      const w = 6 + rand() * 8, d = 0.55, h = 2.4 + rand() * 2;
      const ox = (rand() < 0.5 ? -1 : 1) * (half - w * 0.5 - 1);
      addCoverWall(covers, cx + ox - w * 0.5, cx + ox + w * 0.5, cz - d, cz + d, h);
    }
  }

  // Intersection strongpoints and mid-block street dividers.
  for (let bz = 0; bz <= halfBlocks * 2; bz++) {
    for (let bx = 0; bx <= halfBlocks * 2; bx++) {
      const cx = (bx - halfBlocks) * pitch;
      const cz = (bz - halfBlocks) * pitch;
      if (rand() > 0.55) continue;
      const arm = 2.5 + rand() * 2;
      const h = 1.65 + rand() * 0.9;
      const t = 0.5;
      addCoverWall(covers, cx - arm, cx + arm, cz - t, cz + t, h);
      addCoverWall(covers, cx - t, cx + t, cz - arm, cz + arm, h);
    }
  }
  for (let i = -halfBlocks; i <= halfBlocks; i++) {
    if (rand() > 0.5) continue;
    const x = i * pitch;
    for (let k = -3; k <= 3; k++) {
      if (Math.abs(k) === 0 && rand() > 0.4) continue;
      const z = k * pitch + (rand() - 0.5) * 8;
      const w = 2.8 + rand() * 2;
      addCoverWall(covers, x - 0.35, x + 0.35, z - w * 0.5, z + w * 0.5, 1.5 + rand());
    }
  }

  return covers;
}

export function generateCityLayout(seed) {
  const rand = mulberry32(seed ^ 0xc17a70);
  const { halfBlocks, pitch, blockW, baseY } = CITY;
  const blocks = [];
  const buildingBoxes = [];
  for (let bz = 0; bz <= halfBlocks * 2; bz++) {
    for (let bx = 0; bx <= halfBlocks * 2; bx++) {
      const cx = (bx - halfBlocks) * pitch;
      const cz = (bz - halfBlocks) * pitch;
      const kind = kindAt(bx, bz, rand);
      const rot = Math.floor(rand() * 4);
      const floors = towerFloors(kind, bx, bz, rand);
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
  const spawn = { x: 0, z: 0 };
  const peak = { x: pitch * 1.2, z: -pitch * 0.8, h: baseY };
  return { blocks, buildingBoxes, coverBoxes, spawn, peak, seed };
}

export function cityHeightAt(x, z, layout, noise) {
  const { baseY, playRadius, curb } = CITY;
  const r = Math.hypot(x, z);
  if (r > playRadius + 40) {
    const t = Math.min(1, (r - playRadius) / 35);
    return baseY + t * t * 28;
  }
  const cell = cityCell(x, z);
  let h = baseY;
  if (cell.onStreet && !cell.onSidewalk) h -= 0.06;
  else if (cell.onSidewalk) h += curb;

  const blk = layout.blocks.find((b) => b.bx === cell.bx && b.bz === cell.bz);
  if (blk?.kind === KIND.crater) {
    const dx = x - blk.cx, dz = z - blk.cz;
    const d = Math.hypot(dx, dz);
    h -= Math.max(0, 1 - d / 16) * 2.8;
  }
  if (blk?.kind === KIND.lot || blk?.kind === KIND.ruined) {
    const n = noise.fbm2(x * 0.08, z * 0.08, 3);
    h += (n * 0.5 + 0.5) * 0.9;
  }
  const rubble = noise.fbm2(x * 0.15 + 3, z * 0.15, 2) * 0.35;
  h += rubble;
  return h;
}

export function cityBiomeAt(x, z, layout) {
  const cell = cityCell(x, z);
  const blk = layout.blocks.find((b) => b.bx === cell.bx && b.bz === cell.bz);
  let sand = 0, grass = 0, rock = 0, forest = 0;
  if (cell.onStreet && !cell.onSidewalk) sand = 1;
  else if (cell.onSidewalk) grass = 1;
  else if (blk?.kind === KIND.lot || blk?.kind === KIND.plaza) forest = 0.65 + (blk.kind === KIND.plaza ? 0.2 : 0);
  else if (blk?.kind === KIND.crater || blk?.kind === KIND.ruined) rock = 0.85;
  else if (blk?.kind === KIND.damaged) { rock = 0.35; grass = 0.25; sand = 0.2; }
  else grass = 0.15, sand = 0.1, rock = 0.05;
  if (!cell.onStreet && blk?.kind === KIND.intact) { grass = 0.08; sand = 0.05; rock = 0.02; forest = 0.05; }
  const sum = sand + grass + rock + forest || 1;
  return { sand: sand / sum, grass: grass / sum, rock: rock / sum, forest: forest / sum };
}

export function buildCityHeightmap(seed) {
  const N = GRID_N;
  const layout = generateCityLayout(seed);
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
