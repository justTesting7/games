import * as THREE from 'three';
import { CITY, cityCell } from './cityLayout.js';
import { activeBatcher } from './propBatcher.js';

const mat = (color, extras = {}) => new THREE.MeshStandardMaterial({
  color, roughness: 0.55, metalness: 0.15, ...extras,
});

function shadow(o) {
  o.traverse((c) => { if (c.isMesh) c.castShadow = c.receiveShadow = true; });
  return o;
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function cyl(r, h, material, x, y, z, segs = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segs), material);
  m.position.set(x, y, z);
  return m;
}

function addCollider(colliders, x, z, y, hx, hz, h, type = 'metal') {
  colliders.addBox({
    x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: y, y1: y + h, type,
  });
}

function placeGroup(group, obj, x, y, z, yaw) {
  obj.position.set(x, y, z);
  obj.rotation.y = yaw;
  group.add(shadow(obj));
}

export function makeDumpster() {
  const g = new THREE.Group();
  const body = mat(0x2f6b38, { metalness: 0.25, roughness: 0.45 });
  const dark = mat(0x1c2a1d, { metalness: 0.3, roughness: 0.4 });
  const rust = mat(0x4a3224, { roughness: 0.8 });
  g.add(box(1.85, 1.15, 1.05, body, 0, 0.62, 0));
  g.add(box(1.92, 0.08, 1.12, dark, 0, 1.22, 0));
  const lid = box(0.92, 0.06, 1.08, dark, -0.46, 1.28, 0);
  lid.rotation.x = -0.08;
  g.add(lid);
  g.add(box(0.92, 0.06, 1.08, dark, 0.46, 1.25, 0));
  g.add(box(0.08, 0.35, 0.08, rust, -0.95, 0.95, 0.42));
  g.add(box(0.08, 0.35, 0.08, rust, -0.95, 0.95, -0.42));
  for (const sx of [-0.7, 0.7]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 8, 12), rust);
    w.rotation.y = Math.PI / 2;
    w.position.set(sx, 0.14, 0.52);
    g.add(w);
    const w2 = w.clone();
    w2.position.z = -0.52;
    g.add(w2);
  }
  return g;
}

export function makeWaterCooler() {
  const g = new THREE.Group();
  const body = mat(0xe8e4dc, { roughness: 0.35 });
  const accent = mat(0x2a6f9a, { roughness: 0.4, metalness: 0.2 });
  const bottle = mat(0x4aa0d4, { roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.55 });
  const dark = mat(0x22262a);
  g.add(box(0.38, 0.92, 0.38, body, 0, 0.46, 0));
  g.add(box(0.4, 0.04, 0.4, accent, 0, 0.94, 0));
  g.add(cyl(0.16, 0.42, bottle, 0, 1.18, 0, 16));
  g.add(cyl(0.05, 0.08, dark, 0, 1.4, 0, 10));
  g.add(box(0.16, 0.04, 0.12, dark, 0, 0.62, 0.2));
  g.add(cyl(0.02, 0.08, accent, 0.08, 0.56, 0.22, 8));
  g.add(box(0.22, 0.03, 0.14, dark, 0, 0.42, 0.2));
  return g;
}

export function makeTrafficLight() {
  const g = new THREE.Group();
  const pole = mat(0x2b2e32, { metalness: 0.45, roughness: 0.4 });
  const hous = mat(0x1a1c1e, { metalness: 0.3, roughness: 0.45 });
  const red = mat(0xc62828, { roughness: 0.25, emissive: 0x3a0000 });
  const amber = mat(0xd4a017, { roughness: 0.25, emissive: 0x2a1a00 });
  const green = mat(0x2e7d32, { roughness: 0.25, emissive: 0x003300 });
  g.add(cyl(0.07, 3.4, pole, 0, 1.7, 0, 10));
  g.add(box(0.28, 0.82, 0.22, hous, 0, 3.15, 0.16));
  g.add(cyl(0.07, 0.04, red, 0, 3.4, 0.28, 12));
  g.add(cyl(0.07, 0.04, amber, 0, 3.15, 0.28, 12));
  g.add(cyl(0.07, 0.04, green, 0, 2.9, 0.28, 12));
  g.add(box(0.18, 0.42, 0.1, hous, 0.22, 2.05, 0.08));
  g.add(box(0.08, 0.08, 0.02, red, 0.28, 2.16, 0.14));
  g.add(box(0.08, 0.08, 0.02, green, 0.28, 1.96, 0.14));
  g.add(box(0.22, 0.04, 0.22, pole, 0, 0.02, 0));
  return g;
}

export function makeElectricHub() {
  const g = new THREE.Group();
  const green = mat(0x3d5a3a, { metalness: 0.2, roughness: 0.55 });
  const dark = mat(0x1e221c, { metalness: 0.35, roughness: 0.4 });
  const warn = mat(0xd4b01a, { roughness: 0.4 });
  g.add(box(1.35, 1.25, 0.85, green, 0, 0.66, 0));
  g.add(box(1.4, 0.06, 0.9, dark, 0, 1.3, 0));
  for (let i = 0; i < 5; i++) g.add(box(0.08, 0.7, 0.04, dark, -0.5 + i * 0.25, 0.7, 0.42));
  g.add(box(0.28, 0.22, 0.02, warn, 0.38, 1.05, 0.44));
  g.add(box(0.16, 0.12, 0.08, dark, -0.5, 1.18, 0.2));
  g.add(cyl(0.04, 0.18, dark, -0.55, 1.42, 0.2, 8));
  return g;
}

export function makeMailbox() {
  const g = new THREE.Group();
  const blue = mat(0x2c4f8a, { metalness: 0.25, roughness: 0.4 });
  const dark = mat(0x1a1e24, { metalness: 0.4 });
  g.add(box(0.42, 0.85, 0.28, blue, 0, 0.72, 0));
  g.add(box(0.46, 0.08, 0.32, dark, 0, 1.18, 0));
  g.add(box(0.3, 0.04, 0.04, dark, 0, 1.02, 0.15));
  g.add(box(0.12, 0.08, 0.04, dark, 0.12, 0.55, 0.15));
  g.add(box(0.3, 0.04, 0.3, blue, 0, 0.28, 0));
  return g;
}

export function makeParkingMeter() {
  const g = new THREE.Group();
  const pole = mat(0x4a4e52, { metalness: 0.4, roughness: 0.4 });
  const head = mat(0x2a2d30, { metalness: 0.35 });
  const glass = mat(0x88aacc, { roughness: 0.15, metalness: 0.1 });
  g.add(cyl(0.04, 1.05, pole, 0, 0.55, 0, 8));
  g.add(box(0.18, 0.28, 0.12, head, 0, 1.18, 0));
  g.add(box(0.12, 0.1, 0.02, glass, 0, 1.22, 0.07));
  g.add(box(0.14, 0.02, 0.14, pole, 0, 0.02, 0));
  return g;
}

export function makeNewsBox() {
  const g = new THREE.Group();
  const red = mat(0x8b1e1e, { roughness: 0.45, metalness: 0.15 });
  const dark = mat(0x1c1c1c);
  const glass = mat(0x9ec4d4, { roughness: 0.12, transparent: true, opacity: 0.45 });
  g.add(box(0.55, 0.95, 0.4, red, 0, 0.5, 0));
  g.add(box(0.42, 0.38, 0.02, glass, 0, 0.72, 0.21));
  g.add(box(0.2, 0.04, 0.06, dark, 0, 0.42, 0.22));
  return g;
}

const FACTORIES = {
  dumpster: { make: makeDumpster, hx: 1.0, hz: 0.6, h: 1.35, type: 'metal' },
  cooler: { make: makeWaterCooler, hx: 0.24, hz: 0.24, h: 1.45, type: 'metal' },
  traffic: { make: makeTrafficLight, hx: 0.22, hz: 0.22, h: 3.4, type: 'metal' },
  hub: { make: makeElectricHub, hx: 0.75, hz: 0.5, h: 1.4, type: 'metal' },
  mailbox: { make: makeMailbox, hx: 0.26, hz: 0.2, h: 1.25, type: 'metal' },
  meter: { make: makeParkingMeter, hx: 0.12, hz: 0.12, h: 1.35, type: 'metal' },
  news: { make: makeNewsBox, hx: 0.32, hz: 0.24, h: 1.05, type: 'metal' },
};

function inPlay(x, z) {
  return Math.hypot(x, z) < CITY.playRadius - 10;
}

export function bindFurniture(batcher) {
  for (const [kind, def] of Object.entries(FACTORIES)) {
    batcher.registerObject(kind, def.make());
  }
}

export function placeFurniture(kind, group, colliders, terrain, x, z, yaw) {
  const def = FACTORIES[kind];
  if (!def) return;
  if (activeBatcher) {
    activeBatcher.place(kind, x, z, yaw, 1, def.h, def.type, terrain, colliders);
    return;
  }
  const y = terrain.heightAt(x, z);
  placeGroup(group, def.make(), x, y, z, yaw);
  addCollider(colliders, x, z, y, def.hx, def.hz, def.h, def.type);
}

export function dressCityFurniture(models, group, colliders, terrain, rand, placeProp) {
  const { pitch, halfBlocks, blockW, sidewalkW } = CITY;
  const half = blockW * 0.5;
  const walk = half + sidewalkW * 0.42;
  const step = 6;
  const lim = halfBlocks * pitch + half;

  const sidewalk = (x, z, yaw, dir) => {
    if (!inPlay(x, z) || cityCell(x, z).intersection) return;
    if (rand() > 0.78) return;
    const r = rand();
    if (r < 0.18) placeFurniture('dumpster', group, colliders, terrain, x, z, yaw);
    else if (r < 0.24) placeFurniture('cooler', group, colliders, terrain, x, z, yaw);
    else if (r < 0.36) placeFurniture('hub', group, colliders, terrain, x, z, yaw + Math.PI * 0.5);
    else if (r < 0.42) placeFurniture('mailbox', group, colliders, terrain, x, z, yaw);
    else if (r < 0.5) placeFurniture('meter', group, colliders, terrain, x, z, yaw);
    else if (r < 0.56) placeFurniture('news', group, colliders, terrain, x, z, yaw);
    else if (r < 0.62 && models.utility_box_01) placeProp('utility_box_01', x, z, yaw, 1, 1.3, 'metal');
    else if (r < 0.7 && models.utility_box_02) placeProp('utility_box_02', x, z, yaw, 1, 1.3, 'metal');
    else if (r < 0.78 && models.power_box_01) placeProp('power_box_01', x, z, yaw, 1, 1.4, 'metal');
    else if (r < 0.86 && models.painted_wooden_bench) placeProp('painted_wooden_bench', x, z, yaw, 1, 0.9, 'wood');
    else if (r < 0.93 && models.planter_box_01) placeProp('planter_box_01', x, z, yaw, 1, 0.7, 'wood');
    else if (models.korean_public_payphone_01) placeProp('korean_public_payphone_01', x, z, yaw, 1, 2.2, 'metal');
  };

  for (let i = -halfBlocks; i <= halfBlocks; i++) {
    const c = i * pitch;
    for (const side of [-1, 1]) {
      const x = c + side * walk;
      for (let z = -lim; z <= lim; z += step) sidewalk(x, z, Math.PI * 0.5, 'ns');
      const z = c + side * walk;
      for (let x2 = -lim; x2 <= lim; x2 += step) sidewalk(x2, z, 0, 'ew');
    }
  }

  // Traffic lights on intersection corners, facing the crossing.
  for (let bz = -halfBlocks; bz < halfBlocks; bz++) {
    for (let bx = -halfBlocks; bx < halfBlocks; bx++) {
      const ix = (bx + 0.5) * pitch;
      const iz = (bz + 0.5) * pitch;
      if (!inPlay(ix, iz)) continue;
      const off = CITY.streetW * 0.5 - 0.7;
      const corners = [
        [ix - off, iz - off, 0],
        [ix + off, iz - off, -Math.PI * 0.5],
        [ix + off, iz + off, Math.PI],
        [ix - off, iz + off, Math.PI * 0.5],
      ];
      for (const [x, z, yaw] of corners) {
        if (rand() > 0.22) placeFurniture('traffic', group, colliders, terrain, x, z, yaw);
      }
      if (rand() > 0.55) {
        const hx = ix + (rand() < 0.5 ? -off : off) * 0.4;
        const hz = iz + (rand() < 0.5 ? -off : off) * 0.4;
        if (cityCell(hx, hz).onSidewalk || cityCell(hx, hz).onRoad) {
          placeFurniture('hub', group, colliders, terrain, hx, hz, rand() * 6);
        }
      }
    }
  }
}
