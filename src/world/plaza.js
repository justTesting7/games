import * as THREE from 'three';
import { CITY } from './cityLayout.js';
import { placeFurniture } from './streetFurniture.js';

const stone = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.72, metalness: 0.04 });
const stoneDark = new THREE.MeshStandardMaterial({ color: 0x5c574e, roughness: 0.78, metalness: 0.05 });
const bronze = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.45, metalness: 0.55 });
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x3a7ea8, roughness: 0.08, metalness: 0.15,
  transparent: true, opacity: 0.72,
  blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
});
const grassBlade = new THREE.MeshStandardMaterial({
  color: 0x4a7a28, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
});

function shade(o) {
  o.traverse((c) => { if (c.isMesh) c.castShadow = c.receiveShadow = true; });
  return o;
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function cyl(rt, rb, h, material, x, y, z, segs = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), material);
  m.position.set(x, y, z);
  return m;
}

function addBox(colliders, x, z, y, hx, hz, h, type = 'rock') {
  colliders.addBox({
    x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: y, y1: y + h, type,
  });
}

function statueHero() {
  const g = new THREE.Group();
  g.add(box(1.15, 0.35, 1.15, stoneDark, 0, 0.18, 0));
  g.add(box(0.85, 0.7, 0.85, stone, 0, 0.7, 0));
  g.add(box(0.38, 1.15, 0.26, bronze, 0, 1.65, 0));
  g.add(box(0.95, 0.22, 0.22, bronze, 0.05, 2.05, 0));
  g.add(box(0.2, 0.7, 0.18, bronze, -0.16, 1.15, 0.08));
  g.add(box(0.2, 0.55, 0.18, bronze, 0.16, 1.08, -0.04));
  g.add(cyl(0.16, 0.14, 0.28, bronze, 0, 2.36, 0, 10));
  return g;
}

function statueBust() {
  const g = new THREE.Group();
  g.add(box(1.05, 0.28, 1.05, stoneDark, 0, 0.14, 0));
  g.add(cyl(0.22, 0.28, 1.35, stone, 0, 0.95, 0, 12));
  g.add(box(0.42, 0.35, 0.28, bronze, 0, 1.78, 0));
  g.add(cyl(0.16, 0.14, 0.26, bronze, 0, 2.08, 0, 10));
  return g;
}

function statueLion() {
  const g = new THREE.Group();
  g.add(box(1.3, 0.32, 0.95, stoneDark, 0, 0.16, 0));
  g.add(box(0.95, 0.55, 0.48, bronze, 0, 0.72, 0));
  g.add(box(0.42, 0.38, 0.38, bronze, 0.42, 1.05, 0));
  g.add(box(0.18, 0.28, 0.14, bronze, 0.62, 1.12, 0.12));
  g.add(box(0.18, 0.28, 0.14, bronze, 0.62, 1.12, -0.12));
  g.add(box(0.16, 0.22, 0.5, bronze, -0.42, 0.95, 0));
  return g;
}

function statueObelisk() {
  const g = new THREE.Group();
  g.add(box(1.2, 0.3, 1.2, stoneDark, 0, 0.15, 0));
  g.add(box(0.55, 2.4, 0.55, stone, 0, 1.5, 0));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.45, 4), stone);
  cap.position.set(0, 2.9, 0);
  cap.rotation.y = Math.PI / 4;
  g.add(cap);
  return g;
}

const STATUES = [statueHero, statueBust, statueLion, statueObelisk];

function buildFountain(group, colliders, y) {
  const g = new THREE.Group();
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.55, 0.55, 28), stone);
  basin.position.y = 0.28;
  g.add(basin);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(2.95, 2.95, 0.2, 28), stoneDark);
  inner.position.y = 0.42;
  g.add(inner);
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(2.85, 2.85, 0.08, 28), waterMat);
  pool.position.y = 0.48;
  g.add(pool);
  g.add(cyl(0.38, 0.48, 1.15, stone, 0, 1.05, 0, 14));
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.95, 0.28, 20), stone);
  bowl.position.y = 1.7;
  g.add(bowl);
  const pool2 = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 20), waterMat);
  pool2.position.y = 1.82;
  g.add(pool2);
  g.add(cyl(0.16, 0.2, 0.7, stone, 0, 2.2, 0, 12));
  const jet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), waterMat);
  jet.position.y = 2.6;
  g.add(jet);
  g.position.set(0, y, 0);
  group.add(shade(g));
  addBox(colliders, 0, 0, y, 3.5, 3.5, 1.9, 'rock');
}

function buildCurb(group, y) {
  const r = CITY.plazaLawn - 0.15;
  const geo = new THREE.TorusGeometry(r, 0.16, 8, 64);
  geo.rotateX(Math.PI / 2);
  const curb = new THREE.Mesh(geo, stoneDark);
  curb.position.set(0, y + 0.1, 0);
  curb.castShadow = curb.receiveShadow = true;
  group.add(curb);
}

function buildGrassTufts(group, y, rand) {
  const blade = new THREE.PlaneGeometry(0.12, 0.38);
  blade.translate(0, 0.19, 0);
  const n = 420;
  const mesh = new THREE.InstancedMesh(blade, grassBlade, n);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let k = 0;
  while (k < n) {
    const a = rand() * Math.PI * 2;
    const rad = 4.2 + rand() * (CITY.plazaLawn - 5.2);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.hypot(x, z) < 3.8) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    s.set(0.7 + rand() * 0.7, 0.7 + rand() * 0.9, 1);
    p.set(x, y, z);
    m.compose(p, q, s);
    mesh.setMatrixAt(k++, m);
  }
  mesh.count = k;
  group.add(mesh);
}

export function buildPlaza(group, colliders, terrain, models, rand, placeProp) {
  const lawnY = terrain.heightAt(8, 0);
  buildFountain(group, colliders, terrain.heightAt(0, 0));
  buildCurb(group, lawnY);
  buildGrassTufts(group, lawnY, rand);

  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3724, roughness: 0.9 });
  const canopy = new THREE.MeshStandardMaterial({ color: 0x3d6b24, roughness: 0.85 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.7;
    const x = Math.cos(a) * 11.6, z = Math.sin(a) * 11.6;
    const ty = terrain.heightAt(x, z);
    const tree = new THREE.Group();
    tree.add(cyl(0.12, 0.16, 1.6, bark, 0, 0.8, 0, 8));
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), canopy);
    leaf.position.set(0, 2.15, 0);
    leaf.scale.set(1, 0.75, 1);
    tree.add(leaf);
    tree.position.set(x, ty, z);
    group.add(shade(tree));
    addBox(colliders, x, z, ty, 0.28, 0.28, 2.4, 'wood');
  }

  const ring = 8.4;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * ring, z = Math.sin(a) * ring;
    const g = STATUES[i % STATUES.length]();
    const sy = terrain.heightAt(x, z);
    g.position.set(x, sy, z);
    g.rotation.y = a + Math.PI;
    group.add(shade(g));
    addBox(colliders, x, z, sy, 0.7, 0.7, 2.6, 'rock');
  }

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    const x = Math.cos(a) * 12.4, z = Math.sin(a) * 12.4;
    if (models.painted_wooden_bench) {
      placeProp('painted_wooden_bench', x, z, a + Math.PI * 0.5, 1, 0.85, 'wood');
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * 13.6, z = Math.sin(a) * 13.6;
    if (models.planter_box_01 && i % 2 === 0) {
      placeProp('planter_box_01', x, z, a, 1, 0.7, 'wood');
    } else if (models.street_lamp_01) {
      placeProp('street_lamp_01', x, z, a, 1, 2.8, 'metal');
    }
  }

  // Outer ring: parked cars and extra street cover on the approaches.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.15;
    const x = Math.cos(a) * 19.5, z = Math.sin(a) * 19.5;
    if (i % 2 === 0 && models.covered_car) {
      placeProp('covered_car', x, z, a + Math.PI * 0.5, 0.95, 1.6);
    } else if (models.concrete_road_barrier && i % 3 === 1) {
      placeProp('concrete_road_barrier', x, z, a, 1, 1.5);
    }
  }

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 11.2, z = Math.sin(a) * 11.2;
    placeFurniture('hub', group, colliders, terrain, x * 0.15 + Math.cos(a) * 21.8, z * 0.15 + Math.sin(a) * 21.8, a);
  }

  return { fountain: { x: 0, y: terrain.heightAt(0, 0) + 2.55, z: 0 } };
}

export function updateFountain(fx, fountain, t) {
  if (!fx || !fountain) return;
  if (Math.random() > 0.55) return;
  const a = t * 3 + Math.random() * 6;
  fx.alpha.spawn({
    pos: new THREE.Vector3(fountain.x + Math.cos(a) * 0.08, fountain.y, fountain.z + Math.sin(a) * 0.08),
    vel: new THREE.Vector3((Math.random() - 0.5) * 0.35, 2.4 + Math.random() * 0.8, (Math.random() - 0.5) * 0.35),
    size: 0.04 + Math.random() * 0.03, life: 0.7 + Math.random() * 0.3,
    color: [0.75, 0.88, 0.95], alpha: 0.55, gravity: 9.5, drag: 0.4,
  });
}
