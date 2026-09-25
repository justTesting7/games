import { makeNoise } from './noise.js';
import { GRID_N, GRID_SPACING, HALF_WORLD } from './constants.js';

const SX = 22;
const SZ = 15.6;
const AVG = (SX + SZ) * 0.5;

export const BOWL = {
  sections: 24,
  lowerRows: 26,
  upperRows: 22,
  spawnRow: 18,
  rise: 0.32,
  tread: 0.74,
  spawnTread: 3.2,
  seatPitch: 0.485,
  aisleRad: 0.038,
  seatSetback: 0.32,
};

function rowPlan(startU, rows, startY, spawnRow = 0) {
  const out = [];
  let u = startU;
  for (let r = 1; r <= rows; r++) {
    const wide = spawnRow > 0 && r === spawnRow;
    const depth = wide ? BOWL.spawnTread : BOWL.tread;
    const du = depth / AVG;
    const y = startY + (r - 1) * BOWL.rise;
    out.push({
      row: r, u0: u, u1: u + du, y, wide,
      walkU: u + (wide ? du * 0.48 : du * 0.42),
      seatU: u + du - BOWL.seatSetback / AVG,
    });
    u += du;
  }
  return { rows: out, endU: u };
}

const lowerBowl = rowPlan(1.08, BOWL.lowerRows, 2.18, BOWL.spawnRow);
const concIn = lowerBowl.endU + 0.05;
const concOut = concIn + 0.78;
const concY = lowerBowl.rows[lowerBowl.rows.length - 1].y + 0.22;
const upperBowl = rowPlan(concOut + 0.06, BOWL.upperRows, concY + 0.38);
const hallIn = upperBowl.endU + 0.04;
const hallOut = hallIn + 0.82;
const facadeOut = hallOut + 0.34;
const plazaOut = hallOut + 2.05;

export const ARENA = {
  baseY: 2.05,
  courtHX: 14.325,
  courtHZ: 7.62,
  hoopInset: 1.575,
  sx: SX,
  sz: SZ,
  bowlIn: 1.08,
  concIn,
  concOut,
  hallOut,
  facadeOut,
  plazaOut,
  playU: plazaOut + 0.9,
  concY,
  playRadius: 195,
  tunnelHalf: 2.7,
};

export const LOWER_ROWS = lowerBowl.rows;
export const UPPER_ROWS = upperBowl.rows;

export function ovalU(x, z) {
  return Math.hypot(x / ARENA.sx, z / ARENA.sz);
}

export function ovalPoint(u, ang) {
  return { x: Math.cos(ang) * ARENA.sx * u, z: Math.sin(ang) * ARENA.sz * u };
}

export function hoopX() {
  return ARENA.courtHX - ARENA.hoopInset;
}

export function sectionAngle(sec, t = 0.5) {
  const n = BOWL.sections;
  const a0 = (sec / n) * Math.PI * 2 + BOWL.aisleRad;
  const a1 = ((sec + 1) / n) * Math.PI * 2 - BOWL.aisleRad;
  return a0 + (a1 - a0) * t;
}

export function arcLength(u, a0, a1) {
  const mid = (a0 + a1) * 0.5;
  return Math.abs(a1 - a0) * u * Math.hypot(ARENA.sx * Math.sin(mid), ARENA.sz * Math.cos(mid));
}

/** Eight vomitoria: cardinals stay at court level, diagonals ramp to the concourse. */
export function tunnelInfo(x, z) {
  const ang = Math.atan2(z / ARENA.sz, x / ARENA.sx);
  const step = Math.PI / 4;
  const slot = Math.round(ang / step);
  const center = slot * step;
  const dAng = Math.abs(Math.atan2(Math.sin(ang - center), Math.cos(ang - center)));
  const radius = Math.hypot(x, z);
  const halfAng = Math.max(0.095, ARENA.tunnelHalf / Math.max(radius, 10));
  const u = ovalU(x, z);
  const inBand = dAng < halfAng && u > 0.98 && u < ARENA.facadeOut + 0.18;
  const isRamp = inBand && (Math.abs(slot) & 1) === 1;
  return { slot, center, lat: dAng * Math.max(radius, 1), inBand, isRamp, u };
}

export function rowAtU(u, bank = LOWER_ROWS) {
  for (const row of bank) {
    if (u >= row.u0 && u < row.u1) return row;
  }
  return null;
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
  if (u < hallIn) return 'upper';
  if (u < ARENA.hallOut) return 'hall';
  if (u < ARENA.facadeOut) return 'facade';
  if (u < ARENA.plazaOut) return 'plaza';
  return 'outside';
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Consecutive slots land 7 sections apart so neighbours start on opposite sides. */
export function standSpawn(slot = 0) {
  const sec = ((slot * 7) % BOWL.sections + BOWL.sections) % BOWL.sections;
  const row = LOWER_ROWS[BOWL.spawnRow - 1];
  const ang = sectionAngle(sec, 0.5);
  const { x, z } = ovalPoint(row.walkU, ang);
  return {
    x, z, y: row.y, yaw: Math.atan2(-x, -z),
    section: sec, row: BOWL.spawnRow,
  };
}

export function enumerateSeats() {
  const seats = [];
  const placeBank = (bank, tier) => {
    for (const row of bank) {
      for (let sec = 0; sec < BOWL.sections; sec++) {
        const a0 = (sec / BOWL.sections) * Math.PI * 2 + BOWL.aisleRad;
        const a1 = ((sec + 1) / BOWL.sections) * Math.PI * 2 - BOWL.aisleRad;
        const mid = ovalPoint(row.seatU, (a0 + a1) * 0.5);
        if (tunnelInfo(mid.x, mid.z).inBand) continue;
        const arc = arcLength(row.seatU, a0, a1);
        const n = Math.max(5, Math.floor(arc / BOWL.seatPitch));
        for (let s = 0; s < n; s++) {
          const ang = a0 + (a1 - a0) * ((s + 0.5) / n);
          const { x, z } = ovalPoint(row.seatU, ang);
          seats.push({
            x, z, y: row.y + 0.02, yaw: Math.atan2(x, z) + Math.PI,
            sec, row: row.row, tier, wide: row.wide,
          });
        }
      }
    }
  };
  placeBank(LOWER_ROWS, 'lower');
  placeBank(UPPER_ROWS, 'upper');
  return seats;
}

export function generateArenaLayout(seed) {
  const s0 = standSpawn(0);
  return {
    seed,
    spawn: { x: s0.x, z: s0.z },
    peak: { x: 0, z: 0, h: s0.y },
  };
}

function steppedHeight(u) {
  const low = rowAtU(u, LOWER_ROWS);
  if (low) return low.y;
  if (u >= ARENA.concIn && u < ARENA.concOut) return ARENA.concY;
  const up = rowAtU(u, UPPER_ROWS);
  if (up) return up.y;
  return ARENA.baseY;
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
    if (u > bowlIn + 0.2 && u < concIn) {
      h = baseY + smoothstep(bowlIn + 0.2, concIn, u) * (concY - baseY);
    } else if (u >= concIn && u < concOut) {
      h = concY;
    } else {
      h = baseY;
    }
  } else if (tun.inBand) {
    h = baseY;
  } else if (u >= bowlIn) {
    h = steppedHeight(u);
  }

  const n = noise.fbm2(x * 0.11 + 2.1, z * 0.11, 2) * 0.02;
  if (u < bowlIn) h += n * 0.2;
  else if (tun.inBand) h += n * 0.2;
  else if (u >= ARENA.facadeOut) h += n * 0.55;
  return h;
}

export function arenaBiomeAt(x, z) {
  const zone = arenaZone(x, z);
  if (zone === 'court' || zone === 'apron') return { sand: 0.05, grass: 0.08, rock: 0.05, forest: 0.82 };
  if (zone === 'concourse' || zone === 'ramp') return { sand: 0.08, grass: 0.78, rock: 0.1, forest: 0.04 };
  if (zone === 'hall' || zone === 'tunnel') return { sand: 0.12, grass: 0.7, rock: 0.14, forest: 0.04 };
  if (zone === 'bowl' || zone === 'upper' || zone === 'facade') return { sand: 0.08, grass: 0.12, rock: 0.72, forest: 0.08 };
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
  const H = (i, j) => heights[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const nx = (H(i - 1, j) - H(i + 1, j)) / (2 * GRID_SPACING);
      const nz = (H(i, j - 1) - H(i, j + 1)) / (2 * GRID_SPACING);
      const l = Math.hypot(nx, 1, nz);
      const k = j * N + i;
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
