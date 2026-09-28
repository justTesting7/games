import * as THREE from 'three';
import { CITY, cityCell } from './cityLayout.js';
import { placeFurniture } from './streetFurniture.js';
import { placeStreetProp } from './streets.js';

const PLAZA_KEEP = CITY.plazaRoad + 3;
const SPAWN = { x: 0, z: 13.2, r: 7 };

function inPlay(x, z) {
  return Math.hypot(x, z) < CITY.playRadius - 10;
}

function clear(x, z) {
  if (!inPlay(x, z)) return false;
  if (Math.hypot(x, z) < PLAZA_KEEP) return false;
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < SPAWN.r) return false;
  return true;
}

function Occupancy(min = 2.4) {
  const pts = [];
  return {
    try(x, z, pad = min) {
      if (!clear(x, z)) return false;
      for (const p of pts) {
        if (Math.hypot(p.x - x, p.z - z) < pad) return false;
      }
      pts.push({ x, z });
      return true;
    },
  };
}

function alongCurbLanes(fn) {
  const { pitch, halfBlocks, streetW } = CITY;
  const curb = streetW * 0.5 - 2.15;
  const step = 11;
  const lim = halfBlocks * pitch + 8;
  for (let i = -halfBlocks; i < halfBlocks; i++) {
    const sx = (i + 0.5) * pitch;
    for (const side of [-1, 1]) {
      const x = sx + side * curb;
      for (let z = -lim; z <= lim; z += step) {
        if (!clear(x, z) || !cityCell(x, z).onRoad || cityCell(x, z).intersection) continue;
        fn(x, z, 0, 'ns');
      }
    }
    const sz = (i + 0.5) * pitch;
    for (const side of [-1, 1]) {
      const z = sz + side * curb;
      for (let x = -lim; x <= lim; x += step) {
        if (!clear(x, z) || !cityCell(x, z).onRoad || cityCell(x, z).intersection) continue;
        fn(x, z, Math.PI * 0.5, 'ew');
      }
    }
  }
}

function alongStreetCenters(fn) {
  const { pitch, halfBlocks } = CITY;
  const step = 18;
  const lim = halfBlocks * pitch;
  for (let i = -halfBlocks; i < halfBlocks; i++) {
    const sx = (i + 0.5) * pitch;
    for (let z = -lim; z <= lim; z += step) {
      if (!clear(sx, z) || !cityCell(sx, z).onRoad || cityCell(sx, z).intersection) continue;
      fn(sx, z, 0, 'ns');
    }
    const sz = (i + 0.5) * pitch;
    for (let x = -lim; x <= lim; x += step) {
      if (!clear(x, sz) || !cityCell(x, sz).onRoad || cityCell(x, sz).intersection) continue;
      fn(x, sz, Math.PI * 0.5, 'ew');
    }
  }
}

function aroundYard(b, inset, step, fn) {
  const half = CITY.blockW * 0.5 - inset;
  for (let t = -half + 1.2; t <= half - 1.2; t += step) {
    fn(b.cx + t, b.cz - half, 0);
    fn(b.cx + t, b.cz + half, Math.PI);
    fn(b.cx - half, b.cz + t, Math.PI * 0.5);
    fn(b.cx + half, b.cz + t, -Math.PI * 0.5);
  }
}

function place(models, group, colliders, terrain, id, x, z, yaw, scale, coverY, type) {
  return placeStreetProp(models, group, colliders, terrain, id, x, z, yaw, scale, coverY, type);
}

function crateStack(models, group, colliders, terrain, occ, x, z, rand) {
  const n = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const px = x + (rand() - 0.5) * 1.8;
    const pz = z + (rand() - 0.5) * 1.8;
    if (!occ.try(px, pz, 0.85)) continue;
    place(models, group, colliders, terrain, 'wooden_crate_01', px, pz, rand() * 6, 0.95 + rand() * 0.15, i ? 2.05 : 1.35);
  }
}

function barrelKnot(models, group, colliders, terrain, occ, x, z, rand) {
  const n = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const px = x + (rand() - 0.5) * 1.6;
    const pz = z + (rand() - 0.5) * 1.6;
    if (!occ.try(px, pz, 0.7)) continue;
    const id = rand() > 0.35 ? 'barrel_03' : 'old_tyre';
    place(models, group, colliders, terrain, id, px, pz, rand() * 6, 1, id === 'old_tyre' ? 0.85 : 1.25);
  }
}

function barrierRow(models, group, colliders, terrain, occ, x, z, yaw, n, rand) {
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3(x, 0, z).addScaledVector(right, (i - (n - 1) * 0.5) * 1.62);
    if (!occ.try(p.x, p.z, 1.3)) continue;
    place(models, group, colliders, terrain, 'concrete_road_barrier', p.x, p.z, yaw + (rand() - 0.5) * 0.14, 1, 1.5);
  }
}

export function scatterStreetClutter(models, group, colliders, terrain, rand) {
  const occ = Occupancy(2.6);

  alongCurbLanes((x, z, yaw) => {
    const roll = rand();
    if (roll < 0.58) {
      if (!occ.try(x, z, 4.2)) return;
      const wreck = rand() < 0.22;
      place(models, group, colliders, terrain, 'covered_car', x, z, yaw + (wreck ? (rand() - 0.5) * 0.7 : (rand() - 0.5) * 0.1), 0.95, 1.6);
      if (wreck && rand() < 0.55) {
        const ox = x + Math.cos(yaw) * 3.2 + (rand() - 0.5);
        const oz = z - Math.sin(yaw) * 3.2 + (rand() - 0.5);
        if (occ.try(ox, oz, 1.4)) {
          place(models, group, colliders, terrain, 'concrete_road_barrier', ox, oz, yaw + Math.PI * 0.5, 1, 1.5);
        }
      }
    } else if (roll < 0.72) {
      if (!occ.try(x, z, 2.2)) return;
      placeFurniture('dumpster', group, colliders, terrain, x, z, yaw);
    } else if (roll < 0.84) {
      crateStack(models, group, colliders, terrain, occ, x, z, rand);
    } else if (roll < 0.93) {
      barrelKnot(models, group, colliders, terrain, occ, x, z, rand);
    }
  });

  alongStreetCenters((x, z, yaw) => {
    if (rand() > 0.62) return;
    const kind = rand();
    if (kind < 0.4) {
      barrierRow(models, group, colliders, terrain, occ, x, z, yaw + Math.PI * 0.5, 3 + Math.floor(rand() * 3), rand);
      if (rand() < 0.45) {
        const px = x + (rand() - 0.5) * 3;
        const pz = z + (rand() - 0.5) * 3;
        if (occ.try(px, pz, 3.6)) {
          place(models, group, colliders, terrain, 'covered_car', px, pz, yaw + (rand() - 0.5) * 0.8, 0.95, 1.6);
        }
      }
    } else if (kind < 0.7) {
      if (!occ.try(x, z, 3.8)) return;
      place(models, group, colliders, terrain, 'covered_car', x, z, yaw + (rand() - 0.5) * 1.2, 0.95, 1.6);
      barrelKnot(models, group, colliders, terrain, occ, x + (rand() - 0.5) * 2.5, z + (rand() - 0.5) * 2.5, rand);
    } else {
      crateStack(models, group, colliders, terrain, occ, x, z, rand);
      if (rand() < 0.5) barrelKnot(models, group, colliders, terrain, occ, x + 2, z + 1.2, rand);
    }
  });
}

export function scatterLotWreckage(models, group, colliders, terrain, layout, rand) {
  const occ = Occupancy(2.2);
  const placeProp = (id, x, z, yaw, scale, coverY, type) => (
    place(models, group, colliders, terrain, id, x, z, yaw, scale, coverY, type)
  );

  for (const b of layout.blocks) {
    if (b.kind === 0) continue;
    const dist = Math.hypot(b.cx, b.cz);
    if (dist < PLAZA_KEEP + 6 || dist > CITY.playRadius - 16) continue;

    const open = b.kind === 4 || b.kind === 5 || b.kind === 6 || b.floors === 0;
    const inset = b.kind === 4 ? 5.4 : b.kind === 3 ? 3.6 : 2.6;

    aroundYard(b, inset, open ? 7 : 8.5, (x, z, yaw) => {
      if (!clear(x, z) || cityCell(x, z).onRoad) return;
      if (rand() > (open ? 0.82 : 0.7)) return;
      const r = rand();
      if (r < 0.22) {
        if (occ.try(x, z, 2.4)) placeFurniture('dumpster', group, colliders, terrain, x, z, yaw);
      } else if (r < 0.38) {
        crateStack(models, group, colliders, terrain, occ, x, z, rand);
      } else if (r < 0.5) {
        barrelKnot(models, group, colliders, terrain, occ, x, z, rand);
      } else if (r < 0.62 && occ.try(x, z, 1.8)) {
        placeProp('utility_box_01', x, z, yaw, 1, 1.3, 'metal');
      } else if (r < 0.72 && occ.try(x, z, 1.8)) {
        placeProp('power_box_01', x, z, yaw, 1, 1.4, 'metal');
      } else if (r < 0.8 && occ.try(x, z, 1.6)) {
        placeFurniture('hub', group, colliders, terrain, x, z, yaw);
      } else if (r < 0.88 && occ.try(x, z, 1.5)) {
        placeProp('planter_box_01', x, z, yaw, 1, 0.7, 'wood');
      } else if (occ.try(x, z, 1.4)) {
        placeProp('metal_trash_can', x, z, rand() * 6, 1, 1.15, 'metal');
      }
    });

    if (!open) continue;

    const span = CITY.blockW * 0.32;
    const clusters = 7 + Math.floor(rand() * 6);
    for (let i = 0; i < clusters; i++) {
      const x = b.cx + (rand() - 0.5) * span * 2;
      const z = b.cz + (rand() - 0.5) * span * 2;
      if (!clear(x, z) || cityCell(x, z).onStreet) continue;
      const r = rand();
      if (r < 0.28) {
        if (occ.try(x, z, 4.2)) placeProp('covered_car', x, z, rand() * 6, 0.95, 1.6);
      } else if (r < 0.48) {
        crateStack(models, group, colliders, terrain, occ, x, z, rand);
      } else if (r < 0.64) {
        barrelKnot(models, group, colliders, terrain, occ, x, z, rand);
      } else if (r < 0.78) {
        if (occ.try(x, z, 2.4)) placeFurniture('dumpster', group, colliders, terrain, x, z, rand() * 6);
      } else if (r < 0.9) {
        barrierRow(models, group, colliders, terrain, occ, x, z, rand() * Math.PI, 2 + Math.floor(rand() * 3), rand);
      } else if (occ.try(x, z, 3.2)) {
        placeProp('modular_chainlink_fence', x, z, rand() * Math.PI, 1, 2.2);
      }
    }
  }
}

export function scatterPlazaRing(models, group, colliders, terrain, rand) {
  const occ = Occupancy(2.8);
  for (let ring = 0; ring < 3; ring++) {
    const rad = 18.4 + ring * 3.35;
    const n = 10 + ring * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.21 + rand() * 0.08;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < SPAWN.r) continue;
      if (!cityCell(x, z).onRoad && ring > 0) continue;
      const r = rand();
      const yaw = a + Math.PI * 0.5;
      if (r < 0.4) {
        if (occ.try(x, z, 3.8)) place(models, group, colliders, terrain, 'covered_car', x, z, yaw + (rand() - 0.5) * 0.25, 0.95, 1.6);
      } else if (r < 0.68) {
        barrierRow(models, group, colliders, terrain, occ, x, z, a, 2 + Math.floor(rand() * 2), rand);
      } else if (r < 0.84) {
        crateStack(models, group, colliders, terrain, occ, x, z, rand);
      } else {
        barrelKnot(models, group, colliders, terrain, occ, x, z, rand);
      }
    }
  }
}
