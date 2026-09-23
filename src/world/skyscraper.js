import * as THREE from 'three';

export const FLOOR_H = 4;
const MODULE_W = 3;

function tierPlan(floors, kind) {
  const t = [];
  if (floors <= 8) {
    t.push({ base: 0, floors, scale: 1 });
    return t;
  }
  const f1 = Math.min(8, Math.floor(floors * 0.22));
  const f2 = Math.min(16, Math.floor(floors * 0.45));
  t.push({ base: 0, floors: f1, scale: 1 });
  if (floors > f1) t.push({ base: f1, floors: Math.min(f2, floors) - f1, scale: 0.9 });
  if (floors > f2) t.push({ base: f2, floors: floors - f2, scale: 0.76 });
  if (kind === 4) t[t.length - 1].floors = Math.max(2, Math.floor(t[t.length - 1].floors * 0.55));
  return t;
}

function insetBox(b, scale) {
  const cx = (b.x0 + b.x1) * 0.5;
  const cz = (b.z0 + b.z1) * 0.5;
  const hw = (b.x1 - b.x0) * 0.5 * scale;
  const hd = (b.z1 - b.z0) * 0.5 * scale;
  return { x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd };
}

function faceRuns(x0, x1) {
  const w = x1 - x0;
  const n = Math.max(1, Math.floor(w / MODULE_W));
  const used = n * MODULE_W;
  const pad = (w - used) * 0.5;
  const runs = [];
  for (let i = 0; i < n; i++) runs.push(x0 + pad + MODULE_W * (i + 0.5));
  return runs;
}

export function buildSkyscraper(inst, kits, spec, rand) {
  const kit = spec.style === 'factory' ? kits.factory : kits.apt;
  const p = kit.parts;
  const baseFloor = spec.style === 'factory' ? (p.floorTall || p.floorWindow) : p.floorWindow;
  const altFloor = p.floorWindowAlt || baseFloor;
  const { x0, x1, z0, z1, y0, floors, kind } = spec;
  const dmg = kind === 3 ? 0.12 : kind === 4 ? 0.32 : 0;
  const tiers = tierPlan(floors, kind);

  for (const tier of tiers) {
    const box = insetBox({ x0, x1, z0, z1 }, tier.scale);
    for (let f = 0; f < tier.floors; f++) {
      const fi = tier.base + f;
      const y = y0 + fi * FLOOR_H;
      if (rand() < dmg && fi > 2) continue;
      const xs = faceRuns(box.x0, box.x1);
      const zs = faceRuns(box.z0, box.z1);
      const floorPart = (fi + tier.base) % 2 === 0 ? baseFloor : altFloor;
      const pick = (part, x, z, rot) => {
        if (rand() < dmg * 0.85) return;
        inst.add(part, new THREE.Vector3(x, y, z), rot);
      };
      // South (+Z)
      xs.forEach((x, i) => {
        const part = fi === 0 && i % 4 === 1 ? (p.storefront || floorPart) : floorPart;
        pick(part, x, box.z1, 0);
      });
      // North (-Z)
      xs.forEach((x, i) => {
        const part = fi === 0 && i % 4 === 2 ? (p.storefront || floorPart) : floorPart;
        pick(part, x, box.z0, Math.PI);
      });
      // East (+X)
      zs.forEach((z) => {
        pick(floorPart, box.x1, z, Math.PI / 2);
      });
      // West (-X)
      zs.forEach((z) => {
        pick(floorPart, box.x0, z, -Math.PI / 2);
      });
      if (p.cornice && fi > 0 && fi % 5 === 0) {
        xs.forEach((x) => pick(p.cornice, x, box.z1, 0));
        xs.forEach((x) => pick(p.cornice, x, box.z0, Math.PI));
      }
    }
    const topY = y0 + (tier.base + tier.floors) * FLOOR_H;
    if (p.crown && kind !== 4) {
      faceRuns(box.x0, box.x1).forEach((x) => inst.add(p.crown, new THREE.Vector3(x, topY, box.z1), 0));
      faceRuns(box.x0, box.x1).forEach((x) => inst.add(p.crown, new THREE.Vector3(x, topY, box.z0), Math.PI));
      faceRuns(box.z0, box.z1).forEach((z) => inst.add(p.crown, new THREE.Vector3(box.x1, topY, z), Math.PI / 2));
      faceRuns(box.z0, box.z1).forEach((z) => inst.add(p.crown, new THREE.Vector3(box.x0, topY, z), -Math.PI / 2));
    }
    if (p.dado && tier.base === 0) {
      faceRuns(box.x0, box.x1).forEach((x) => inst.add(p.dado, new THREE.Vector3(x, y0, box.z1), 0));
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
