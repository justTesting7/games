import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { CITY } from './cityLayout.js';
import { placeFurniture } from './streetFurniture.js';
import {
  makeMarble, makeBronze, makeLimestone, makeGranite, makeCobble,
  makeFountainWater, makeFallingWater, makeCaustics, makeWetStone,
} from './plazaMaterials.js';

function shade(o) {
  o.traverse((c) => {
    if (!c.isMesh) return;
    if (c.material?.transparent || c.material?.isShaderMaterial) {
      c.castShadow = false;
      return;
    }
    c.castShadow = c.receiveShadow = true;
  });
  return o;
}

function mesh(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

function addBox(colliders, x, z, y, hx, hz, h, type = 'rock') {
  colliders.addBox({
    x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: y, y1: y + h, type,
  });
}

function lathe(pts, segs, mat, x, y, z) {
  const geo = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), segs);
  return mesh(geo, mat, x, y, z);
}

function disc(r, segs) {
  const g = new THREE.CircleGeometry(r, segs);
  g.rotateX(-Math.PI / 2);
  return g;
}

function pedestal(stone, w, h, d) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w * 1.22, 0.1, d * 1.22), stone, 0, 0.05, 0));
  g.add(mesh(new THREE.BoxGeometry(w * 1.08, 0.08, d * 1.08), stone, 0, 0.14, 0));
  g.add(mesh(new THREE.BoxGeometry(w, Math.max(0.16, h - 0.3), d), stone, 0, 0.14 + (h - 0.3) * 0.5, 0));
  g.add(mesh(new THREE.BoxGeometry(w * 1.1, 0.08, d * 1.1), stone, 0, h - 0.08, 0));
  g.add(mesh(new THREE.BoxGeometry(w * 0.92, 0.06, d * 0.92), stone, 0, h - 0.01, 0));
  return g;
}

function statueHero(stone, bronze) {
  const g = new THREE.Group();
  g.add(pedestal(stone, 1.15, 0.72, 1.15));
  g.add(lathe([
    [0.22, 0.72], [0.34, 0.78], [0.4, 1.15], [0.36, 1.55],
    [0.28, 1.85], [0.32, 2.05], [0.2, 2.18],
  ], 20, bronze, 0, 0, 0));
  g.add(mesh(new THREE.CapsuleGeometry(0.07, 0.55, 5, 8), bronze, -0.22, 1.55, 0.06, 0.25, 0, 0.35));
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.58, 5, 8), bronze);
  arm.position.set(0.28, 1.95, 0.12);
  arm.rotation.set(0.15, 0.2, -1.15);
  g.add(arm);
  g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), bronze, 0.55, 2.22, 0.18));
  g.add(mesh(new THREE.CapsuleGeometry(0.09, 0.16, 4, 8), bronze, 0, 2.28, 0.02));
  g.add(mesh(new THREE.SphereGeometry(0.15, 12, 10), bronze, 0, 2.5, 0.04));
  g.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), bronze, 0, 2.56, -0.02));
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.04, 0.08), bronze, 0.04, 2.48, 0.16));
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.28, 0.04), bronze, -0.32, 1.72, 0.12, 0.1, 0.4, 0.15));
  return g;
}

function statueBust(stone, bronze) {
  const g = new THREE.Group();
  g.add(pedestal(stone, 0.95, 0.42, 0.95));
  g.add(lathe([
    [0.2, 0.42], [0.24, 0.5], [0.2, 1.35], [0.26, 1.42], [0.22, 1.52],
  ], 16, stone, 0, 0, 0));
  g.add(mesh(new THREE.SphereGeometry(0.28, 12, 10), bronze, 0, 1.72, 0.02));
  g.add(mesh(new THREE.SphereGeometry(0.22, 12, 10), bronze, 0, 1.95, 0.04));
  g.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), bronze, 0, 2.18, 0.05));
  g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), bronze, 0, 2.24, 0.0));
  g.add(mesh(new THREE.CapsuleGeometry(0.06, 0.12, 4, 8), bronze, 0, 2.02, 0.06));
  return g;
}

function statueLion(stone, bronze) {
  const g = new THREE.Group();
  g.add(pedestal(stone, 1.45, 0.48, 0.85));
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 6, 10), bronze);
  body.rotation.x = Math.PI * 0.5;
  body.position.set(0, 0.82, 0.04);
  g.add(body);
  g.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), bronze, 0, 0.95, 0.52));
  g.add(mesh(new THREE.TorusGeometry(0.2, 0.1, 8, 14), bronze, 0, 0.96, 0.48, 0, 0, Math.PI * 0.55));
  g.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), bronze, 0.06, 0.92, 0.68));
  g.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), bronze, -0.06, 0.92, 0.68));
  g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), bronze, 0, 0.86, 0.74));
  for (const [x, z] of [[0.16, 0.28], [-0.16, 0.28], [0.16, -0.28], [-0.16, -0.28]]) {
    g.add(mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 6), bronze, x, 0.62, z, z > 0 ? 0.15 : -0.15, 0, x > 0 ? 0.1 : -0.1));
  }
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.42, 4, 6), bronze);
  tail.position.set(0, 0.88, -0.52);
  tail.rotation.set(-0.35, 0, 0.35);
  g.add(tail);
  return g;
}

function statueObelisk(stone, granite, bronze) {
  const g = new THREE.Group();
  g.add(pedestal(stone, 1.15, 0.42, 1.15));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.34, 2.35, 4), granite, 0, 1.58, 0, 0, Math.PI * 0.25, 0));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.38, 4), bronze);
  cap.position.set(0, 2.92, 0);
  cap.rotation.y = Math.PI * 0.25;
  g.add(cap);
  return g;
}

function spout(bronze, a, r, y) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), bronze, 0, 0, 0));
  g.add(mesh(new THREE.SphereGeometry(0.055, 6, 5), bronze, 0.1, -0.02, 0));
  g.add(mesh(new THREE.TorusGeometry(0.08, 0.03, 6, 10), bronze, -0.02, 0.02, 0, 0, Math.PI * 0.5, 0));
  g.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
  g.rotation.y = a;
  return g;
}

function buildFountain(group, colliders, y, pipeline) {
  const stone = makeLimestone(0x9c9588);
  const marble = makeMarble(0xcfc8ba);
  const wet = makeWetStone(0x3e3b36);
  const bronze = makeBronze(0x5c3a1c, 0.7);
  const g = new THREE.Group();

  g.add(lathe([
    [3.95, 0.0], [4.02, 0.06], [3.88, 0.1], [3.7, 0.1],
  ], 48, stone, 0, 0, 0));
  g.add(lathe([
    [3.7, 0.1], [3.78, 0.16], [3.62, 0.18],
  ], 48, marble, 0, 0, 0));
  g.add(lathe([
    [3.55, 0.18], [3.62, 0.22], [3.52, 0.62], [3.78, 0.68],
    [3.7, 0.82], [3.28, 0.78], [3.12, 0.36], [0.52, 0.36],
  ], 56, stone, 0, 0, 0));
  g.add(mesh(disc(3.08, 48), wet, 0, 0.38, 0));

  const waterLo = new THREE.Mesh(disc(3.02, 64), makeFountainWater(pipeline, {
    radius: 3.02, deep: 0x0c3a52, shallow: 0x2f7ea3,
  }));
  waterLo.position.y = 0.7;
  waterLo.castShadow = false;
  g.add(waterLo);

  const cau = new THREE.Mesh(disc(2.9, 48), makeCaustics(pipeline));
  cau.position.y = 0.4;
  cau.castShadow = cau.receiveShadow = false;
  g.add(cau);

  g.add(lathe([
    [0.5, 0.36], [0.58, 0.42], [0.46, 0.95], [0.62, 1.08],
    [0.42, 1.18], [0.4, 1.42],
  ], 24, marble, 0, 0, 0));
  g.add(lathe([
    [0.22, 1.42], [1.18, 1.46], [1.28, 1.54], [1.16, 1.78],
    [0.92, 1.72], [0.82, 1.52], [0.2, 1.52],
  ], 32, stone, 0, 0, 0));
  g.add(mesh(disc(0.88, 28), wet, 0, 1.54, 0));

  const waterMid = new THREE.Mesh(disc(0.86, 40), makeFountainWater(pipeline, {
    radius: 0.86, deep: 0x14506c, shallow: 0x4aa0c4,
  }));
  waterMid.position.y = 1.7;
  waterMid.castShadow = false;
  g.add(waterMid);

  g.add(lathe([
    [0.18, 1.72], [0.22, 1.8], [0.16, 2.22], [0.2, 2.3],
  ], 16, marble, 0, 0, 0));
  g.add(lathe([
    [0.08, 2.3], [0.42, 2.34], [0.48, 2.4], [0.4, 2.56],
    [0.28, 2.52], [0.1, 2.38],
  ], 20, stone, 0, 0, 0));

  const waterHi = new THREE.Mesh(disc(0.34, 24), makeFountainWater(pipeline, {
    radius: 0.34, deep: 0x1a6280, shallow: 0x6ec4e0,
  }));
  waterHi.position.y = 2.5;
  waterHi.castShadow = false;
  g.add(waterHi);

  g.add(lathe([
    [0.06, 2.5], [0.1, 2.62], [0.04, 2.82], [0.0, 2.92],
  ], 12, marble, 0, 0, 0));

  const fall = makeFallingWater(pipeline);
  const sheet = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.22, 1.05, 28, 1, true), fall);
  sheet.position.y = 1.12;
  sheet.castShadow = sheet.receiveShadow = false;
  g.add(sheet);
  const plume = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.09, 0.55, 10, 1, true), fall);
  plume.position.y = 2.78;
  plume.castShadow = plume.receiveShadow = false;
  g.add(plume);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    g.add(spout(bronze, a, 3.55, 0.72));
    const drip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, 0.42, 8, 1, true), fall);
    drip.position.set(Math.cos(a) * 3.42, 0.5, Math.sin(a) * 3.42);
    drip.castShadow = drip.receiveShadow = false;
    g.add(drip);
  }

  g.position.set(0, y, 0);
  group.add(shade(g));
  addBox(colliders, 0, 0, y, 3.7, 3.7, 2.5, 'rock');

  const jets = [
    { x: 0, y: y + 2.88, z: 0, vx: 0, vy: 3.4, spread: 0.12 },
    { x: 0, y: y + 2.55, z: 0, vx: 0, vy: 1.6, spread: 0.2 },
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    jets.push({
      x: Math.cos(a) * 3.48, y: y + 0.74, z: Math.sin(a) * 3.48,
      vx: -Math.cos(a) * 0.55, vy: 1.15, spread: 0.08,
    });
    jets.push({
      x: Math.cos(a) * 1.05, y: y + 1.72, z: Math.sin(a) * 1.05,
      vx: Math.cos(a) * 0.15, vy: 0.35, spread: 0.1,
    });
  }
  return { jets, splashY: y + 0.72 };
}

function buildCurb(group, y) {
  const r = CITY.plazaLawn;
  const curb = lathe([
    [r - 0.06, 0], [r + 0.26, 0], [r + 0.26, 0.15],
    [r + 0.04, 0.22], [r - 0.1, 0.16], [r - 0.06, 0.02],
  ], 80, makeLimestone(0x8c8578), 0, y, 0);
  group.add(shade(curb));
}

function buildWalk(group, y) {
  const ring = new THREE.RingGeometry(4.15, 6.55, 72, 1);
  ring.rotateX(-Math.PI / 2);
  const walk = new THREE.Mesh(ring, makeCobble());
  walk.position.set(0, y + 0.025, 0);
  walk.receiveShadow = true;
  group.add(walk);
}

function buildGrassTufts(group, y, rand, pipeline) {
  const blade = new THREE.PlaneGeometry(0.11, 0.36);
  blade.translate(0, 0.18, 0);
  const grass = new THREE.MeshStandardMaterial({
    color: 0x4d7c2a, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
  });
  grass.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = pipeline?.u?.uTime || { value: 0 };
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
vec2 wO = instanceMatrix[3].xz;
#else
vec2 wO = vec2(0.0);
#endif
transformed.xz += vec2(sin(uTime * 1.4 + wO.x), sin(uTime * 1.1 + wO.y)) * max(position.y, 0.0) * 0.12;
`);
  };
  grass.customProgramCacheKey = () => 'plaza-grass';
  const n = 520;
  const meshI = new THREE.InstancedMesh(blade, grass, n);
  meshI.castShadow = false;
  meshI.receiveShadow = true;
  meshI.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  let k = 0;
  while (k < n) {
    const a = rand() * Math.PI * 2;
    const rad = 6.7 + rand() * (CITY.plazaLawn - 7.4);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.hypot(x, z) < 6.6) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    s.set(0.65 + rand() * 0.8, 0.65 + rand() * 1.05, 1);
    p.set(x, y, z);
    m.compose(p, q, s);
    meshI.setMatrixAt(k, m);
    c.setHSL(0.22 + rand() * 0.08, 0.45 + rand() * 0.25, 0.28 + rand() * 0.12);
    meshI.setColorAt(k, c);
    k++;
  }
  meshI.count = k;
  if (meshI.instanceColor) meshI.instanceColor.needsUpdate = true;
  group.add(meshI);
}

function addParkTrees(group, colliders, terrain, rand, winds) {
  const kinds = [
    { preset: 'Oak Medium', scale: 0.34 },
    { preset: 'Ash Medium', scale: 0.3 },
  ];
  const variants = kinds.map((k, i) => {
    const tree = new Tree();
    tree.loadPreset(k.preset);
    tree.options.seed = 2200 + i * 31;
    for (const key in tree.options.branch.sections) {
      tree.options.branch.sections[key] = Math.max(3, Math.round(tree.options.branch.sections[key] * 0.5));
    }
    tree.options.leaves.count = Math.max(1, Math.round(tree.options.leaves.count * 0.4));
    tree.options.leaves.size *= 1.35;
    tree.generate();
    const barkU = { uTime: { value: 0 } };
    const leafU = { uTime: { value: 0 } };
    winds.push(barkU, leafU);
    const addWind = (material, strength, uni, key) => {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uni.uTime;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */ `
#include <begin_vertex>
float wH = max(position.y, 0.0);
float wP = uTime * 1.05;
transformed.xz += vec2(sin(wP), sin(wP * 0.8 + 1.2)) * wH * wH * ${strength.toFixed(5)};
`);
      };
      material.customProgramCacheKey = () => key;
    };
    const bark = new THREE.MeshStandardMaterial({
      color: tree.branchesMesh.material.color,
      map: tree.branchesMesh.material.map,
      normalMap: tree.branchesMesh.material.normalMap,
      roughness: 1, metalness: 0,
    });
    addWind(bark, 0.00012, barkU, 'plaza-bark');
    const leaves = new THREE.MeshStandardMaterial({
      map: tree.leavesMesh.material.map,
      color: new THREE.Color(0.5, 0.58, 0.38),
      alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, metalness: 0,
    });
    addWind(leaves, 0.00022, leafU, 'plaza-leaf');
    const bg = tree.branchesMesh.geometry.clone();
    const lg = tree.leavesMesh.geometry.clone();
    bg.scale(k.scale, k.scale, k.scale);
    lg.scale(k.scale, k.scale, k.scale);
    return { bark, leaves, bg, lg };
  });

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.7;
    const x = Math.cos(a) * 11.6, z = Math.sin(a) * 11.6;
    const ty = terrain.heightAt(x, z);
    const v = variants[i % variants.length];
    const sc = 0.88 + rand() * 0.2;
    const yaw = rand() * Math.PI * 2;
    const t = new THREE.Group();
    t.add(new THREE.Mesh(v.bg, v.bark), new THREE.Mesh(v.lg, v.leaves));
    t.position.set(x, ty, z);
    t.rotation.y = yaw;
    t.scale.setScalar(sc);
    group.add(shade(t));
    addBox(colliders, x, z, ty, 0.3, 0.3, 2.6, 'wood');
  }
}

export function buildPlaza(group, colliders, terrain, models, rand, placeProp, pipeline) {
  const lawnY = terrain.heightAt(8, 0);
  const fountain = buildFountain(group, colliders, terrain.heightAt(0, 0), pipeline);
  buildCurb(group, lawnY);
  buildWalk(group, lawnY);
  buildGrassTufts(group, lawnY, rand, pipeline);

  const winds = [];
  addParkTrees(group, colliders, terrain, rand, winds);

  const marble = makeMarble(0xd4cec2);
  const granite = makeGranite(0x58534d);
  const bronzeA = makeBronze(0x6a4320, 0.5);
  const bronzeB = makeBronze(0x5a3a18, 0.72);
  const bronzeC = makeBronze(0x7a4e28, 0.4);
  const makers = [
    () => statueHero(marble, bronzeA),
    () => statueBust(marble, bronzeC),
    () => statueLion(marble, bronzeB),
    () => statueObelisk(marble, granite, bronzeA),
  ];

  const ring = 8.4;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * ring, z = Math.sin(a) * ring;
    const g = makers[i % makers.length]();
    const sy = terrain.heightAt(x, z);
    g.position.set(x, sy, z);
    g.rotation.y = a + Math.PI;
    group.add(shade(g));
    addBox(colliders, x, z, sy, 0.95, 0.95, 2.85, 'rock');
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

  return {
    ...fountain,
    update(t) {
      for (const w of winds) w.uTime.value = t;
    },
  };
}

export function updateFountain(fx, plaza, t) {
  if (!plaza) return;
  plaza.update?.(t);
  if (!fx || !plaza.jets) return;
  for (const jet of plaza.jets) {
    if (Math.random() > 0.5) continue;
    fx.alpha.spawn({
      pos: new THREE.Vector3(
        jet.x + (Math.random() - 0.5) * jet.spread,
        jet.y,
        jet.z + (Math.random() - 0.5) * jet.spread,
      ),
      vel: new THREE.Vector3(
        jet.vx + (Math.random() - 0.5) * 0.28,
        jet.vy + Math.random() * 0.55,
        (jet.vz || 0) + (Math.random() - 0.5) * 0.28,
      ),
      size: 0.03 + Math.random() * 0.035, life: 0.55 + Math.random() * 0.4,
      color: [0.78, 0.9, 0.98], alpha: 0.62, gravity: 9.6, drag: 0.35,
    });
  }
  if (Math.random() < 0.4) {
    const a = t * 2.2 + Math.random() * 6;
    const r = 0.4 + Math.random() * 2.4;
    fx.alpha.spawn({
      pos: new THREE.Vector3(Math.cos(a) * r, plaza.splashY, Math.sin(a) * r),
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.35 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2),
      size: 0.05 + Math.random() * 0.04, life: 0.35 + Math.random() * 0.25,
      color: [0.85, 0.93, 1], alpha: 0.4, gravity: 6, drag: 1.2,
    });
  }
}
