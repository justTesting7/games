import * as THREE from 'three';

export const FLOOR_H = 3;
export const MODULE_W = 3;
/** Real 3D facade modules are only placed on the lowest floors; the rest is impostor. */
export const DETAIL_FLOORS = 5;
/** Impostor walls sit behind the module plane so detail modules cover them up close. */
const IMPOSTOR_INSET = 0.35;
/** Baked facade tiles stack the base and alternate module, i.e. two floors per tile. */
const TILE_FLOORS = 2;

// Face order: south (+Z), north (-Z), east (+X), west (-X).
export const FACES = [
  { n: [0, 0, 1], right: [1, 0, 0], rot: 0 },
  { n: [0, 0, -1], right: [-1, 0, 0], rot: Math.PI },
  { n: [1, 0, 0], right: [0, 0, -1], rot: Math.PI / 2 },
  { n: [-1, 0, 0], right: [0, 0, 1], rot: -Math.PI / 2 },
];

function tierPlan(floors, kind) {
  const t = [];
  if (floors <= 10) {
    t.push({ base: 0, floors, scale: 1 });
    return t;
  }
  const f1 = Math.max(DETAIL_FLOORS + 1, Math.min(12, Math.floor(floors * 0.24)));
  const f2 = Math.max(f1 + 2, Math.floor(floors * 0.55));
  t.push({ base: 0, floors: f1, scale: 1 });
  if (floors > f1) t.push({ base: f1, floors: Math.min(f2, floors) - f1, scale: 0.88 });
  if (floors > f2) t.push({ base: f2, floors: floors - f2, scale: 0.72 });
  if (kind === 4) t[t.length - 1].floors = Math.max(2, Math.floor(t[t.length - 1].floors * 0.55));
  return t;
}

export function towerTiers(spec) {
  const tiers = tierPlan(spec.floors, spec.kind);
  const cx = (spec.x0 + spec.x1) * 0.5, cz = (spec.z0 + spec.z1) * 0.5;
  for (const t of tiers) {
    const hw = (spec.x1 - spec.x0) * 0.5 * t.scale;
    const hd = (spec.z1 - spec.z0) * 0.5 * t.scale;
    t.box = { x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd };
  }
  return tiers;
}

function faceRuns(a0, a1) {
  const w = a1 - a0;
  const n = Math.max(1, Math.floor(w / MODULE_W));
  const pad = (w - n * MODULE_W) * 0.5;
  const runs = [];
  for (let i = 0; i < n; i++) runs.push(a0 + pad + MODULE_W * (i + 0.5));
  return { runs, pad };
}

/**
 * Places full-detail modules on the lowest floors, one instancer per face so
 * faces pointing away from the camera can be skipped entirely.
 */
export function buildTowerDetail(faceInst, kits, spec, rand) {
  const p = (spec.style === 'factory' ? kits.factory : kits.apt).parts;
  const baseFloor = p.floorWindow;
  const altFloor = p.floorWindowAlt;
  const dmg = spec.kind === 3 ? 0.12 : spec.kind === 4 ? 0.32 : 0;
  const box = towerTiers(spec)[0].box;
  const floors = Math.min(DETAIL_FLOORS, spec.floors);
  const xs = faceRuns(box.x0, box.x1).runs;
  const zs = faceRuns(box.z0, box.z1).runs;
  const faceSlots = [
    xs.map((x) => [x, box.z1]),
    xs.map((x) => [x, box.z0]),
    zs.map((z) => [box.x1, z]),
    zs.map((z) => [box.x0, z]),
  ];
  const pos = new THREE.Vector3();

  for (let f = 0; f < floors; f++) {
    const y = spec.y0 + f * FLOOR_H;
    const floorPart = f % 2 === 0 ? baseFloor : altFloor;
    faceSlots.forEach((slots, fi) => {
      const inst = faceInst[fi];
      const rot = FACES[fi].rot;
      slots.forEach(([x, z], i) => {
        if (f > 1 && rand() < dmg) return;
        const part = f === 0 && fi < 2 && i % 4 === 1 + fi ? p.storefront : floorPart;
        inst.add(part, pos.set(x, y, z), rot);
        if (p.cornice && f > 0 && f % 5 === 0) inst.add(p.cornice, pos.set(x, y, z), rot);
        if (p.dado && f === 0) inst.add(p.dado, pos.set(x, y, z), rot);
      });
    });
  }
}

/** Collects flat-shaded quads into per-material buckets and emits one geometry with groups. */
export class ImpostorBuilder {
  constructor(keys) {
    this.keys = keys;
    this.b = Object.fromEntries(keys.map((k) => [k, { pos: [], nrm: [], uv: [] }]));
  }

  quad(key, p0, p1, p2, p3, n, uv) {
    const b = this.b[key];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = [p0, p1, p2, p3][i];
      b.pos.push(p[0], p[1], p[2]);
      b.nrm.push(n[0], n[1], n[2]);
      b.uv.push(uv[i * 2], uv[i * 2 + 1]);
    }
  }

  box(key, x0, x1, y0, y1, z0, z1, top = true) {
    const s = 0.5;
    const u = (a, b) => [0, 0, (b - a) * s, 0, (b - a) * s, (y1 - y0) * s, 0, (y1 - y0) * s];
    this.quad(key, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], u(x0, x1));
    this.quad(key, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], u(x0, x1));
    this.quad(key, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], u(z0, z1));
    this.quad(key, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], u(z0, z1));
    if (top) {
      const t = [0, 0, (x1 - x0) * s, 0, (x1 - x0) * s, (z1 - z0) * s, 0, (z1 - z0) * s];
      this.quad(key, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], t);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    const all = this.keys.map((k) => this.b[k]);
    let start = 0;
    all.forEach((b, mi) => {
      g.addGroup(start, b.pos.length / 3, mi);
      start += b.pos.length / 3;
    });
    const cat = (field) => all.reduce((acc, b) => acc.concat(b[field]), []);
    g.setAttribute('position', new THREE.Float32BufferAttribute(cat('pos'), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(cat('nrm'), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(cat('uv'), 2));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Whole-tower stand-in: textured tier walls (baked facade tiles), ledges,
 * crowns, roofs and landmark spires. A few hundred triangles per tower.
 */
export function buildTowerImpostor(ib, spec, rand) {
  const key = spec.style === 'factory' ? 'factory' : 'apt';
  const tiers = towerTiers(spec);
  const ruined = spec.kind === 4;
  let topY = spec.y0;
  let topBox = tiers[0].box;

  for (const t of tiers) {
    const B = t.box;
    const yb = spec.y0 + t.base * FLOOR_H;
    const yt = yb + t.floors * FLOOR_H;
    const i = IMPOSTOR_INSET;
    const x0 = B.x0 + i, x1 = B.x1 - i, z0 = B.z0 + i, z1 = B.z1 - i;
    const padX = faceRuns(B.x0, B.x1).pad, padZ = faceRuns(B.z0, B.z1).pad;
    const v0 = t.base / TILE_FLOORS, v1 = (t.base + t.floors) / TILE_FLOORS;
    const uS = (x) => (x - (B.x0 + padX)) / MODULE_W;
    const uN = (x) => (B.x1 - padX - x) / MODULE_W;
    const uE = (z) => (B.z1 - padZ - z) / MODULE_W;
    const uW = (z) => (z - (B.z0 + padZ)) / MODULE_W;
    ib.quad(key, [x0, yb, z1], [x1, yb, z1], [x1, yt, z1], [x0, yt, z1], [0, 0, 1], [uS(x0), v0, uS(x1), v0, uS(x1), v1, uS(x0), v1]);
    ib.quad(key, [x1, yb, z0], [x0, yb, z0], [x0, yt, z0], [x1, yt, z0], [0, 0, -1], [uN(x1), v0, uN(x0), v0, uN(x0), v1, uN(x1), v1]);
    ib.quad(key, [x1, yb, z1], [x1, yb, z0], [x1, yt, z0], [x1, yt, z1], [1, 0, 0], [uE(z1), v0, uE(z0), v0, uE(z0), v1, uE(z1), v1]);
    ib.quad(key, [x0, yb, z0], [x0, yb, z1], [x0, yt, z1], [x0, yt, z0], [-1, 0, 0], [uW(z0), v0, uW(z1), v0, uW(z1), v1, uW(z0), v1]);

    for (let f = Math.ceil((t.base + 1) / 5) * 5; f < t.base + t.floors; f += 5) {
      const y = spec.y0 + f * FLOOR_H;
      ib.box('trim', B.x0 - 0.15, B.x1 + 0.15, y - 0.12, y + 0.22, B.z0 - 0.15, B.z1 + 0.15);
    }
    ib.box('trim', x0, x1, yt - 0.01, yt, z0, z1);
    if (!ruined) {
      const o = 0.45;
      ib.box('trim', B.x0 - o, B.x1 + o, yt - 0.3, yt + 0.9, B.z0 - o, B.z1 + o);
      ib.box('trim', B.x0 - 0.1, B.x1 + 0.1, yt + 0.9, yt + 1.4, B.z0 - 0.1, B.z1 + 0.1);
    }
    topY = yt;
    topBox = B;
  }

  if (ruined) return;
  const cx = (topBox.x0 + topBox.x1) * 0.5, cz = (topBox.z0 + topBox.z1) * 0.5;
  const hw = (topBox.x1 - topBox.x0) * 0.5;
  if (spec.floors >= 44) {
    const y = topY + 1.4;
    ib.box('trim', cx - hw * 0.45, cx + hw * 0.45, y, y + 7, cz - hw * 0.45, cz + hw * 0.45);
    ib.box('trim', cx - hw * 0.25, cx + hw * 0.25, y + 7, y + 13, cz - hw * 0.25, cz + hw * 0.25);
    ib.box('trim', cx - 0.5, cx + 0.5, y + 13, y + 34, cz - 0.5, cz + 0.5);
  } else {
    const y = topY + 1.4;
    for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) {
      const w = 2 + rand() * 4, d = 2 + rand() * 4, h = 2 + rand() * 3.5;
      const ox = (rand() - 0.5) * (hw * 2 - w - 2), oz = (rand() - 0.5) * (hw * 2 - d - 2);
      ib.box('trim', cx + ox - w * 0.5, cx + ox + w * 0.5, y, y + h, cz + oz - d * 0.5, cz + oz + d * 0.5);
    }
  }
}

export function colliderFor(spec) {
  const h = spec.floors * FLOOR_H + (spec.kind === 4 ? 2 : 5);
  return {
    x0: spec.x0, x1: spec.x1, z0: spec.z0, z1: spec.z1,
    y0: spec.y0, y1: spec.y0 + h,
    type: 'concrete',
  };
}
