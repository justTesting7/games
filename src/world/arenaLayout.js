import { GRID_N, GRID_SPACING, HALF_WORLD } from './constants.js';

// Rows are offset curves of the court rectangle: straight along the
// sidelines and baselines, quarter circles in the corners. `u` is distance
// from the court edge in units of RU metres.
const CX = 14.325;
const CZ = 7.62;
const RU = 6.0;

export const BOWL = {
  sections: 26,
  lowerRows: 26,
  upperRows: 18,
  spawnRow: 18,
  rise: 0.38,
  upperRise: 0.44,
  tread: 0.8,
  upperTread: 0.82,
  spawnTread: 3.2,
  seatPitch: 0.48,
  aisle: 1.3,
  seatSetback: 0.34,
};

// East half-baseline, NE corner, north sideline, NW corner, west baseline,
// SW corner, south sideline, SE corner, east half-baseline. Widths are in
// sections so every section sits on exactly one segment.
const SEGMENTS = [
  { n: 1, kind: 'line', a: [CX, 0], b: [CX, CZ], nrm: [1, 0] },
  { n: 4, kind: 'arc', c: [CX, CZ], t0: 0, t1: Math.PI / 2 },
  { n: 3, kind: 'line', a: [CX, CZ], b: [-CX, CZ], nrm: [0, 1] },
  { n: 4, kind: 'arc', c: [-CX, CZ], t0: Math.PI / 2, t1: Math.PI },
  { n: 2, kind: 'line', a: [-CX, CZ], b: [-CX, -CZ], nrm: [-1, 0] },
  { n: 4, kind: 'arc', c: [-CX, -CZ], t0: Math.PI, t1: Math.PI * 1.5 },
  { n: 3, kind: 'line', a: [-CX, -CZ], b: [CX, -CZ], nrm: [0, -1] },
  { n: 4, kind: 'arc', c: [CX, -CZ], t0: Math.PI * 1.5, t1: Math.PI * 2 },
  { n: 1, kind: 'line', a: [CX, -CZ], b: [CX, 0], nrm: [1, 0] },
];
{
  let s = 0;
  for (const seg of SEGMENTS) { seg.s0 = s; s += seg.n; seg.s1 = s; }
}

function rowPlan(startR, rows, startY, tread, rise, spawnRow = 0) {
  const out = [];
  let r = startR;
  for (let i = 1; i <= rows; i++) {
    const wide = spawnRow > 0 && i === spawnRow;
    const depth = wide ? BOWL.spawnTread : tread;
    const y = startY + (i - 1) * rise;
    out.push({
      row: i, r0: r, r1: r + depth, y, wide,
      u0: r / RU, u1: (r + depth) / RU,
      walkR: r + depth * (wide ? 0.48 : 0.42),
      seatR: r + depth - BOWL.seatSetback,
      get walkU() { return this.walkR / RU; },
      get seatU() { return this.seatR / RU; },
    });
    r += depth;
  }
  return { rows: out, endR: r };
}

const baseY = 2.05;
const bowlR = 6.48;
const lowerBowl = rowPlan(bowlR, BOWL.lowerRows, baseY + 0.4, BOWL.tread, BOWL.rise, BOWL.spawnRow);
const lastLow = lowerBowl.rows[lowerBowl.rows.length - 1];
const concInR = lowerBowl.endR + 0.02;
const concOutR = concInR + 3.0;
const concY = lastLow.y + 0.22;
const upperBowl = rowPlan(concOutR, BOWL.upperRows, concY + BOWL.upperRise, BOWL.upperTread, BOWL.upperRise);
const lastUp = upperBowl.rows[upperBowl.rows.length - 1];
const hallInR = upperBowl.endR;
const hallOutR = hallInR + 6.5;
const facadeOutR = hallOutR + 1.2;
const plazaOutR = facadeOutR + 14;

export const ARENA = {
  baseY,
  courtHX: CX,
  courtHZ: CZ,
  hoopInset: 1.575,
  RU,
  bowlR,
  bowlIn: bowlR / RU,
  concIn: concInR / RU,
  concOut: concOutR / RU,
  hallIn: hallInR / RU,
  hallOut: hallOutR / RU,
  facadeOut: facadeOutR / RU,
  plazaOut: plazaOutR / RU,
  playU: (plazaOutR + 6) / RU,
  concY,
  topY: lastUp.y,
  hallY: lastUp.y,
  roofY: lastUp.y + 10.5,
  playRadius: 195,
};

export const LOWER_ROWS = lowerBowl.rows;
export const UPPER_ROWS = upperBowl.rows;

const TAU = Math.PI * 2;

/** Offset-curve frame at distance r (m) from the court and parameter t in [0,1). */
export function bowlFrame(r, t) {
  let s = (((t % 1) + 1) % 1) * BOWL.sections;
  let seg = SEGMENTS[SEGMENTS.length - 1];
  for (const g of SEGMENTS) { if (s < g.s1) { seg = g; break; } }
  const f = Math.min(1, Math.max(0, (s - seg.s0) / seg.n));
  if (seg.kind === 'line') {
    const bx = seg.a[0] + (seg.b[0] - seg.a[0]) * f;
    const bz = seg.a[1] + (seg.b[1] - seg.a[1]) * f;
    const [nx, nz] = seg.nrm;
    return { x: bx + nx * r, z: bz + nz * r, nx, nz, tx: -nz, tz: nx };
  }
  const th = seg.t0 + (seg.t1 - seg.t0) * f;
  const nx = Math.cos(th), nz = Math.sin(th);
  return { x: seg.c[0] + nx * r, z: seg.c[1] + nz * r, nx, nz, tx: -nz, tz: nx };
}

/** Inverse of bowlFrame: distance from the court edge and perimeter parameter. */
export function bowlParam(x, z) {
  const qx = Math.abs(x) - CX, qz = Math.abs(z) - CZ;
  const S = BOWL.sections;
  if (qx > 0 && qz > 0) {
    const cx = Math.sign(x) * CX, cz = Math.sign(z) * CZ;
    let th = Math.atan2(z - cz, x - cx);
    if (th < 0) th += TAU;
    const seg = SEGMENTS.find((g) => g.kind === 'arc' && th >= g.t0 - 1e-9 && th <= g.t1 + 1e-9) || SEGMENTS[1];
    const f = (th - seg.t0) / (seg.t1 - seg.t0);
    return { r: Math.hypot(qx, qz), t: (seg.s0 + f * seg.n) / S };
  }
  if (qx > qz) {
    const r = qx;
    if (x > 0) return { r, t: z >= 0 ? (z / CZ) / S : (25 + (z + CZ) / CZ) / S };
    return { r, t: (12 + 2 * (CZ - z) / (2 * CZ)) / S };
  }
  const r = qz;
  if (z > 0) return { r, t: (5 + 3 * (CX - x) / (2 * CX)) / S };
  return { r, t: (18 + 3 * (x + CX) / (2 * CX)) / S };
}

export function ovalU(x, z) {
  return bowlParam(x, z).r / RU;
}

export function ovalPoint(u, ang) {
  const f = bowlFrame(u * RU, ang / TAU);
  return { x: f.x, z: f.z };
}

export function hoopX() {
  return ARENA.courtHX - ARENA.hoopInset;
}

export function sectionAngle(sec, t = 0.5) {
  return ((sec + t) / BOWL.sections) * TAU;
}

/** Length along the row at distance r (m) between two parameters inside one section. */
export function rowLength(r, t0, t1) {
  const s0 = t0 * BOWL.sections;
  const seg = SEGMENTS.find((g) => s0 >= g.s0 - 1e-9 && s0 < g.s1 - 1e-9) || SEGMENTS[0];
  const df = ((t1 - t0) * BOWL.sections) / seg.n;
  if (seg.kind === 'line') return Math.abs(df) * Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
  return Math.abs(df) * (seg.t1 - seg.t0) * r;
}

export function arcLength(u, a0, a1) {
  return rowLength(u * RU, a0 / TAU, a1 / TAU);
}

export function rowAtU(u, bank = LOWER_ROWS) {
  const r = u * RU;
  for (const row of bank) {
    if (r >= row.r0 && r < row.r1) return row;
  }
  return null;
}

function rowAtR(r, bank) {
  let lo = 0, hi = bank.length - 1;
  if (r < bank[0].r0 || r >= bank[hi].r1) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bank[mid].r0 <= r) lo = mid; else hi = mid - 1;
  }
  return bank[lo];
}

export function arenaZone(x, z) {
  if (Math.abs(x) <= CX && Math.abs(z) <= CZ) return 'court';
  const r = bowlParam(x, z).r;
  if (r < bowlR) return 'apron';
  if (r < concInR) return 'bowl';
  if (r < concOutR) return 'concourse';
  if (r < hallInR) return 'upper';
  if (r < hallOutR) return 'hall';
  if (r < facadeOutR) return 'facade';
  if (r < plazaOutR) return 'plaza';
  return 'outside';
}

/** Each slot gets its own section, seven apart so neighbours start across the bowl. */
export function standSpawn(slot = 0) {
  const S = BOWL.sections;
  const sec = ((slot * 7) % S + S) % S;
  const row = LOWER_ROWS[BOWL.spawnRow - 1];
  const f = bowlFrame(row.walkR, (sec + 0.5) / S);
  return {
    x: f.x, z: f.z, y: row.y, yaw: Math.atan2(-f.nx, -f.nz),
    section: sec, row: BOWL.spawnRow,
  };
}

export function enumerateSeats() {
  const seats = [];
  const S = BOWL.sections;
  const placeBank = (bank, tier) => {
    for (const row of bank) {
      for (let sec = 0; sec < S; sec++) {
        const t0 = sec / S, t1 = (sec + 1) / S;
        const L = rowLength(row.seatR, t0, t1);
        const usable = L - BOWL.aisle;
        const n = Math.max(0, Math.floor(usable / BOWL.seatPitch));
        for (let s = 0; s < n; s++) {
          const d = BOWL.aisle * 0.5 + (s + 0.5) * (usable / n);
          const f = bowlFrame(row.seatR, t0 + (d / L) * (t1 - t0));
          seats.push({
            x: f.x, z: f.z, y: row.y + 0.02, yaw: Math.atan2(-f.nx, -f.nz),
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

function heightAtR(r) {
  if (r < bowlR) return baseY;
  const low = rowAtR(r, LOWER_ROWS);
  if (low) return low.y;
  if (r < concOutR) return concY;
  const up = rowAtR(r, UPPER_ROWS);
  if (up) return up.y;
  if (r < facadeOutR) return lastUp.y;
  return baseY;
}

/** Exact stepped floor height; the heightmap grid is too coarse for 0.8 m treads. */
export function arenaHeightAt(x, z) {
  const r = Math.hypot(x, z);
  if (r > ARENA.playRadius + 18) {
    const t = Math.min(1, (r - ARENA.playRadius) / 32);
    return baseY + t * t * 26;
  }
  return heightAtR(bowlParam(x, z).r);
}

export function arenaBiomeAt(x, z) {
  const zone = arenaZone(x, z);
  if (zone === 'court' || zone === 'apron') return { sand: 0.05, grass: 0.08, rock: 0.05, forest: 0.82 };
  if (zone === 'concourse' || zone === 'hall') return { sand: 0.08, grass: 0.78, rock: 0.1, forest: 0.04 };
  if (zone === 'bowl' || zone === 'upper' || zone === 'facade') return { sand: 0.08, grass: 0.12, rock: 0.72, forest: 0.08 };
  if (zone === 'plaza') return { sand: 0.82, grass: 0.08, rock: 0.08, forest: 0.02 };
  return { sand: 0.55, grass: 0.1, rock: 0.3, forest: 0.05 };
}

export function buildArenaHeightmap(seed) {
  const N = GRID_N;
  const layout = generateArenaLayout(seed);
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = j * GRID_SPACING - HALF_WORLD;
    for (let i = 0; i < N; i++) {
      const x = i * GRID_SPACING - HALF_WORLD;
      heights[j * N + i] = arenaHeightAt(x, z);
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
