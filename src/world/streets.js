import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { CITY, cityCell } from './cityLayout.js';

const TREE_KINDS = [
  { preset: 'Oak Medium', scale: 0.42 },
  { preset: 'Ash Medium', scale: 0.38 },
  { preset: 'Aspen Medium', scale: 0.4 },
];

function cloneModel(gltf) {
  const root = gltf.scene.clone(true);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      if (o.material?.map) o.material = o.material.clone();
    }
  });
  return root;
}

function footprint(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  return { size: box.getSize(new THREE.Vector3()), minY: box.min.y };
}

function addWind(material, strength, key) {
  const windUniforms = { uTime: { value: 0 } };
  material.userData.wind = windUniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
vec2 wOrigin = instanceMatrix[3].xz;
#else
vec2 wOrigin = vec2(0.0);
#endif
float wH = max(position.y, 0.0);
float wPhase = uTime * 1.1 + dot(wOrigin, vec2(0.07, 0.05));
transformed.xz += vec2(sin(wPhase), sin(wPhase * 0.83 + 1.3)) * wH * wH * ${strength.toFixed(5)};
`);
  };
  material.customProgramCacheKey = () => key;
}

function makeTree(preset, seed, scale) {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  for (const k in tree.options.branch.sections) {
    tree.options.branch.sections[k] = Math.max(3, Math.round(tree.options.branch.sections[k] * 0.5));
  }
  tree.options.leaves.count = Math.max(1, Math.round(tree.options.leaves.count * 0.35));
  tree.options.leaves.size *= 1.4;
  tree.generate();
  const barkSrc = tree.branchesMesh.material;
  const leafSrc = tree.leavesMesh.material;
  const bark = new THREE.MeshStandardMaterial({
    color: barkSrc.color, map: barkSrc.map, normalMap: barkSrc.normalMap,
    roughnessMap: barkSrc.roughnessMap, roughness: 1, metalness: 0,
  });
  addWind(bark, 0.0001, 'city-bark');
  const leaves = new THREE.MeshStandardMaterial({
    map: leafSrc.map, color: new THREE.Color(0.55, 0.58, 0.42),
    alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, metalness: 0,
  });
  addWind(leaves, 0.0002, 'city-leaf');
  const bg = tree.branchesMesh.geometry.clone();
  const lg = tree.leavesMesh.geometry.clone();
  bg.scale(scale, scale, scale);
  lg.scale(scale, scale, scale);
  return { bark, leaves, branches: bg, leavesGeo: lg };
}

function alongStreetEdges(fn) {
  const { pitch, halfBlocks, blockW, sidewalkW } = CITY;
  const half = blockW * 0.5;
  const walk = half + sidewalkW * 0.45;
  const step = 8;
  const lim = halfBlocks * pitch + half;
  for (let i = -halfBlocks; i <= halfBlocks; i++) {
    const c = i * pitch;
    for (const side of [-1, 1]) {
      const x = c + side * walk;
      for (let z = -lim; z <= lim; z += step) {
        if (!inPlay(x, z) || cityCell(x, z).intersection) continue;
        fn(x, z, Math.PI * 0.5, 'ns');
      }
      const z = c + side * walk;
      for (let x2 = -lim; x2 <= lim; x2 += step) {
        if (!inPlay(x2, z) || cityCell(x2, z).intersection) continue;
        fn(x2, z, 0, 'ew');
      }
    }
  }
}

function inPlay(x, z) {
  return Math.hypot(x, z) < CITY.playRadius - 8;
}

export function buildStreetTrees(group, colliders, terrain, rand) {
  const spots = [];
  let step = 0;
  alongStreetEdges((x, z) => {
    step++;
    if (step % 3 !== 0) return;
    spots.push({ x: x + (rand() - 0.5) * 0.5, z: z + (rand() - 0.5) * 0.5, yaw: rand() * Math.PI * 2, sc: 0.9 + rand() * 0.22, vi: Math.floor(rand() * TREE_KINDS.length) });
  });
  const variants = TREE_KINDS.map((k, i) => makeTree(k.preset, 1400 + i * 17, k.scale));
  const counts = [0, 0, 0];
  spots.forEach((s) => counts[s.vi]++);
  const sets = variants.map((v, i) => {
    const n = Math.max(1, counts[i]);
    const bark = new THREE.InstancedMesh(v.branches, v.bark, n);
    const leaf = new THREE.InstancedMesh(v.leavesGeo, v.leaves, n);
    bark.castShadow = leaf.castShadow = true;
    bark.receiveShadow = leaf.receiveShadow = true;
    bark.frustumCulled = leaf.frustumCulled = false;
    bark.count = leaf.count = 0;
    group.add(bark, leaf);
    return { bark, leaf, n: 0, wind: [v.bark.userData.wind, v.leaves.userData.wind] };
  });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (const spot of spots) {
    const y = terrain.heightAt(spot.x, spot.z);
    const set = sets[spot.vi];
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spot.yaw);
    s.set(spot.sc, spot.sc, spot.sc);
    p.set(spot.x, y, spot.z);
    m.compose(p, q, s);
    set.bark.setMatrixAt(set.n, m);
    set.leaf.setMatrixAt(set.n, m);
    set.n++;
    colliders.add({ x: p.x, z: p.z, r: 0.32, y0: y, y1: y + 3.4, type: 'wood' });
  }
  for (const set of sets) {
    set.bark.count = set.leaf.count = set.n;
    set.bark.instanceMatrix.needsUpdate = true;
    set.leaf.instanceMatrix.needsUpdate = true;
  }
  return (t) => {
    for (const set of sets) for (const w of set.wind) if (w) w.uTime.value = t;
  };
}

export function buildSewers(group, colliders, terrain, rand) {
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.55, metalness: 0.65 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.8, metalness: 0.25 });
  const hole = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 1, metalness: 0 });
  const coverGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.06, 20);
  const rimGeo = new THREE.TorusGeometry(0.5, 0.035, 8, 20);
  rimGeo.rotateX(Math.PI / 2);
  const grateGeo = new THREE.BoxGeometry(1.15, 0.07, 0.55);
  const barGeo = new THREE.BoxGeometry(1.05, 0.04, 0.04);
  const pitGeo = new THREE.BoxGeometry(1.05, 0.85, 0.45);

  const { pitch, halfBlocks, streetW } = CITY;
  const halfStreet = streetW * 0.5;
  const add = (mesh, x, y, z, yaw = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };

  for (let i = -halfBlocks; i <= halfBlocks; i++) {
    for (let k = -halfBlocks; k <= halfBlocks; k++) {
      const sx = (i + 0.5) * pitch;
      const sz = (k + 0.5) * pitch;
      const alongZ = k * pitch;
      const alongX = i * pitch;
      for (const [x, z] of [[sx, alongZ + 8], [sx, alongZ - 10], [alongX + 7, sz], [alongX - 9, sz]]) {
        if (!inPlay(x, z) || cityCell(x, z).intersection) continue;
        if (rand() > 0.72) continue;
        const y = terrain.heightAt(x, z) + 0.02;
        const cover = new THREE.Mesh(coverGeo, rand() > 0.3 ? iron : rust);
        add(cover, x, y, z);
        const rim = new THREE.Mesh(rimGeo, iron);
        add(rim, x, y + 0.02, z);
      }
    }
  }

  alongStreetEdges((x, z, yaw, dir) => {
    if (!inPlay(x, z) || cityCell(x, z).intersection) return;
    if (rand() > 0.055) return;
    const inward = dir === 'ns' ? Math.sign(x) * -1 : Math.sign(z) * -1;
    const gx = dir === 'ns' ? x + inward * (CITY.sidewalkW * 0.35 + 0.4) : x + (rand() - 0.5) * 4;
    const gz = dir === 'ew' ? z + inward * (CITY.sidewalkW * 0.35 + 0.4) : z + (rand() - 0.5) * 4;
    const cell = cityCell(gx, gz);
    if (!cell.onRoad) return;
    const y = terrain.heightAt(gx, gz);
    const open = rand() > 0.45;
    const grateYaw = dir === 'ns' ? 0 : Math.PI * 0.5;
    if (open) {
      const pit = new THREE.Mesh(pitGeo, hole);
      add(pit, gx, y - 0.38, gz, grateYaw);
      for (let b = 0; b < 5; b++) {
        const bar = new THREE.Mesh(barGeo, iron);
        bar.position.set(gx, y + 0.03, gz + (b - 2) * 0.09);
        bar.rotation.y = grateYaw;
        bar.castShadow = true;
        group.add(bar);
      }
      colliders.addBox({
        x0: gx - 0.55, x1: gx + 0.55, z0: gz - 0.28, z1: gz + 0.28,
        y0: y - 0.2, y1: y + 0.08, type: 'metal',
      });
    } else {
      const grate = new THREE.Mesh(grateGeo, rust);
      add(grate, gx, y + 0.02, gz, grateYaw);
    }
  });
}

export function placeStreetProp(models, group, colliders, terrain, id, x, z, yaw, scale, coverY, type) {
  const gltf = models[id];
  if (!gltf) return null;
  const obj = cloneModel(gltf);
  const y = terrain.heightAt(x, z);
  obj.rotation.y = yaw;
  obj.scale.setScalar(scale);
  obj.position.set(x, y, z);
  group.add(obj);
  const fp = footprint(obj);
  obj.position.y = y - fp.minY;
  const cx = obj.position.x, cz = obj.position.z;
  const hx = Math.max(0.25, fp.size.x * 0.42);
  const hz = Math.max(0.25, fp.size.z * 0.42);
  colliders.addBox({
    x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz,
    y0: y, y1: y + Math.max(fp.size.y * scale, coverY),
    type: type || (id.includes('car') ? 'metal' : 'cover'),
  });
  return obj;
}

export function dressSidewalks(models, group, colliders, terrain, rand) {
  let i = 0;
  alongStreetEdges((x, z, yaw, dir) => {
    if (!inPlay(x, z)) return;
    const cell = cityCell(x, z);
    if (cell.intersection) return;
    i++;
    const jitter = () => (rand() - 0.5) * 0.5;
    if (i % 4 === 0) {
      placeStreetProp(models, group, colliders, terrain, 'street_lamp_01', x + jitter(), z + jitter(), yaw, 1, 2.8, 'metal');
    }
    if (i % 6 === 1 && rand() > 0.4) {
      placeStreetProp(models, group, colliders, terrain, 'metal_trash_can', x + jitter() * 2, z + jitter() * 2, rand() * 6, 1, 1.15, 'metal');
    }
    if (i % 11 === 2 && rand() > 0.5) {
      placeStreetProp(models, group, colliders, terrain, 'fire_hydrant', x + jitter(), z + jitter(), rand() * 6, 1, 0.95, 'metal');
    }
    if (i % 8 === 3 && rand() > 0.45) {
      const inward = dir === 'ns' ? -Math.sign(x) : -Math.sign(z);
      const px = dir === 'ns' ? x + inward * 2.2 : x + (rand() - 0.5) * 1.2;
      const pz = dir === 'ew' ? z + inward * 2.2 : z + (rand() - 0.5) * 1.2;
      if (cityCell(px, pz).onRoad) {
        placeStreetProp(models, group, colliders, terrain, 'covered_car', px, pz, yaw + Math.PI * 0.5 + (rand() - 0.5) * 0.12, 0.95, 1.6);
      }
    }
  });
}

export function placeRoadblocks(models, group, colliders, terrain, rand) {
  const { pitch, halfBlocks } = CITY;
  const place = (x, z, yaw, n) => {
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(x, 0, z).addScaledVector(right, (i - (n - 1) * 0.5) * 1.65);
      if (!inPlay(p.x, p.z)) continue;
      placeStreetProp(models, group, colliders, terrain, 'concrete_road_barrier', p.x, p.z, yaw + (rand() - 0.5) * 0.1, 1, 1.5);
    }
  };
  for (let bz = -halfBlocks; bz <= halfBlocks; bz++) {
    for (let bx = -halfBlocks; bx <= halfBlocks; bx++) {
      if (rand() > 0.22) continue;
      const x = (bx + 0.5) * pitch;
      const z = (bz + 0.5) * pitch;
      if (!inPlay(x, z)) continue;
      place(x, z, rand() > 0.5 ? 0 : Math.PI * 0.5, 2 + Math.floor(rand() * 3));
    }
  }
}
