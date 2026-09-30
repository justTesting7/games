import * as THREE from 'three';
import { buildShotMesh } from './shotMesh.js';

// A tiny debug range: open it with /shootout/?lab and it drops straight into play.
// Everything here is a test fixture for physics, shots and animation:
//   low wall 1 m (shoot over it), tall wall with a doorway, a 0.4 m step, a ramp,
//   crates, a glass pane, two parked cars, and rival spots behind the tall wall.
// Player starts at the origin facing +z.

export const LAB = {
  size: 80,
  spawn: { x: 0, z: 0, yaw: 0 },
  rivals: [{ x: -3, z: 22, yaw: Math.PI }, { x: 4, z: 24, yaw: Math.PI }, { x: 10, z: 20, yaw: Math.PI }, { x: -10, z: 21, yaw: Math.PI }],
  cars: [{ x: 7, z: -5, yaw: Math.PI / 2 }, { x: -7, z: -5, yaw: 0 }],
  step: { x0: -9, x1: -5, z0: 2, z1: 6, h: 0.4 },
  ramp: { x0: 5, x1: 9, z0: 2, z1: 10, h: 1.6 }, // rises along +z
};

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8d9096';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#6c6f75';
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(LAB.size / 4, LAB.size / 4); // one line per metre
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function labHeightAt(x, z) {
  const s = LAB.step, r = LAB.ramp;
  if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return s.h;
  if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return ((z - r.z0) / (r.z1 - r.z0)) * r.h;
  return 0;
}

export function buildLab() {
  const group = new THREE.Group();
  group.name = 'lab';
  const walls = []; // walking boxes
  const mat = (color, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const concrete = mat(0xb9b4aa), brick = mat(0x9a5a46, 0.9), wood = mat(0x8a6238, 0.8);
  const add = (mesh, name) => {
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const box = (name, material, x0, x1, y0, y1, z0, z1, walk = true) => {
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material), name);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (walk) walls.push({ x0, x1, z0, z1, y0, y1, type: name === 'crates' ? 'wood' : 'concrete' });
    return m;
  };

  const ground = add(new THREE.Mesh(new THREE.PlaneGeometry(LAB.size, LAB.size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.95 })), 'ground');
  ground.castShadow = false;

  // shoot over this: waist high
  box('parapet', concrete, -3, 3, 0, 1.0, 8, 8.3);
  // tall wall with a 2 m doorway in the middle; the lintel leaves 2.2 m of headroom
  box('facade_brick', brick, -12, -1, 0, 3.2, 16, 16.4);
  box('facade_brick', brick, 1, 12, 0, 3.2, 16, 16.4);
  box('facade_brick', brick, -1, 1, 2.2, 3.2, 16, 16.4);
  // a pillar to hide behind, and a side wall to lean on
  box('facade_brick', brick, 3.5, 4.3, 0, 3.2, 11, 11.8);
  box('facade_brick', brick, -14, -13.6, 0, 3.2, 4, 14);
  // crates of mixed height
  box('crates', wood, -3.5, -2.5, 0, 1.0, 12, 13);
  box('crates', wood, -2.4, -1.4, 0, 1.6, 12, 13);
  box('crates', wood, -3.3, -2.7, 1.0, 1.6, 12.2, 12.8);

  // 0.4 m step (walkable, raises the ground)
  const s = LAB.step;
  box('step', concrete, s.x0, s.x1, 0, s.h, s.z0, s.z1, false);
  // ramp up to 1.6 m along +z (walkable), then a drop off its far end
  const r = LAB.ramp;
  const len = Math.hypot(r.z1 - r.z0, r.h);
  const ramp = add(new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0, 0.1, len), concrete), 'ramp');
  ramp.position.set((r.x0 + r.x1) / 2, r.h / 2 - 0.05, (r.z0 + r.z1) / 2);
  ramp.rotation.x = -Math.atan2(r.h, r.z1 - r.z0);

  // a glass pane on posts
  const glass = add(new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 0.04),
    new THREE.MeshPhysicalMaterial({ color: 0x9fb8c4, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.35 })), 'glass');
  glass.position.set(-9, 1.2 + 0.2, 10);
  walls.push({ x0: -10.5, x1: -7.5, z0: 9.98, z1: 10.02, y0: 0, y1: 2.6, type: 'glass' });
  group.updateMatrixWorld(true);

  const spots = LAB.rivals;
  return {
    group,
    root: group,
    spawn: { ...LAB.spawn, y: 0 },
    outdoor: true,
    stadium: null,
    heightAt: labHeightAt,
    rivalSpots: (_origin, count) => Array.from({ length: count }, (_, i) => spots[i % spots.length]),
    slotSpawn: (slot) => (slot === 0 ? LAB.spawn : spots[(slot - 1) % spots.length]),
    addColliders: (colliders) => {
      for (const w of walls) colliders.addBox({ ...w, noRay: true });
      return walls.length;
    },
    buildShots: () => buildShotMesh([group]),
    update: () => {},
  };
}
