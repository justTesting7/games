import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { mulberry32, makeNoise } from './noise.js';
import { HALF_WORLD, WORLD_SEED } from './constants.js';
import { loadGLTF, modelUrl } from '../engine/assets.js';

const windUniforms = { uTime: { value: 0 } };

const windVertex = (strength) => /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
vec2 wOrigin = instanceMatrix[3].xz;
#else
vec2 wOrigin = vec2(0.0);
#endif
float wH = max(position.y, 0.0);
float wPhase = uTime * 1.1 + dot(wOrigin, vec2(0.07, 0.05));
float wGust = sin(uTime * 0.37 + wOrigin.x * 0.01) * 0.5 + 0.5;
vec2 wOff = vec2(sin(wPhase), sin(wPhase * 0.83 + 1.3)) * (0.4 + wGust);
float flutter = sin(uTime * 6.0 + position.x * 3.0 + position.z * 2.7 + wOrigin.x) * 0.15;
transformed.xz += (wOff + flutter) * wH * wH * ${strength.toFixed(5)};
`;

function addWind(material, strength, key) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', windVertex(strength));
  };
  material.customProgramCacheKey = () => key;
}

// Leaves use normals that point away from the crown centre instead of the
// card normals, which makes a canopy shade like a soft volume.
function leafShading(material, strength, key) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', windVertex(strength));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = 1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <aomap_fragment>', `
        reflectedLight.directDiffuse += reflectedLight.directDiffuse * 0.25;
        reflectedLight.indirectDiffuse *= 0.8;
        reflectedLight.indirectSpecular *= 0.5;`);
  };
  material.customProgramCacheKey = () => key;
}

const SPECIES = [
  { preset: 'Pine Large', height: 24, kind: 'pine' },
  { preset: 'Pine Medium', height: 17, kind: 'pine' },
  { preset: 'Oak Medium', height: 13, kind: 'broad' },
  { preset: 'Oak Large', height: 17, kind: 'broad' },
  { preset: 'Aspen Medium', height: 16, kind: 'broad' },
  { preset: 'Ash Medium', height: 15, kind: 'broad' },
];

function buildTree(preset, seed, low) {
  const tree = new Tree();
  tree.loadPreset(preset);
  const o = tree.options;
  o.seed = seed;
  if (low) {
    for (const k in o.branch.sections) o.branch.sections[k] = Math.max(3, Math.round(o.branch.sections[k] * 0.45));
    for (const k in o.branch.segments) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * 0.5));
    const c = o.leaves.count;
    o.leaves.count = Math.max(1, Math.round(c * 0.3));
    o.leaves.size *= 1.55;
    o.leaves.billboard = 'single';
    if (o.branch.children[0] > 40) o.branch.children[0] = Math.round(o.branch.children[0] * 0.5);
  }
  tree.generate();
  return tree;
}

function makeTreeMaterials(tree, kind) {
  const bm = tree.branchesMesh.material;
  const bark = new THREE.MeshStandardMaterial({
    color: bm.color, map: bm.map, normalMap: bm.normalMap, roughnessMap: bm.roughnessMap, aoMap: bm.aoMap,
    roughness: 1, metalness: 0,
  });
  addWind(bark, 0.00012, 'bark-wind');
  const lm = tree.leavesMesh.material;
  const tint = kind === 'pine' ? new THREE.Color(0.75, 0.8, 0.72) : new THREE.Color(0.85, 0.9, 0.75);
  const leaves = new THREE.MeshStandardMaterial({
    map: lm.map, color: tint, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, metalness: 0,
  });
  leafShading(leaves, 0.00022, 'leaves-wind');
  return { bark, leaves };
}

function prepareTreeGeometry(tree, scale) {
  const branches = tree.branchesMesh.geometry.clone();
  const leaves = tree.leavesMesh.geometry.clone();
  branches.scale(scale, scale, scale);
  leaves.scale(scale, scale, scale);
  leaves.computeBoundingBox();
  const c = new THREE.Vector3();
  leaves.boundingBox.getCenter(c);
  const pos = leaves.attributes.position;
  const nrm = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const size = new THREE.Vector3();
  leaves.boundingBox.getSize(size);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(c);
    v.y *= size.x / Math.max(size.y, 1e-3);
    v.normalize();
    nrm.set([v.x, v.y * 0.8 + 0.25, v.z], i * 3);
  }
  leaves.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return { branches, leaves };
}

// A set of instances drawn with distance-based level of detail. Only the
// instances near the camera are written to the GPU, and the lists are
// rebuilt whenever the camera has moved far enough.
class InstancedSet {
  constructor(lods) {
    this.lods = lods;
    this.matrices = [];
    this.positions = [];
    this.meshes = [];
  }
  add(matrix) {
    this.matrices.push(...matrix.elements);
    const e = matrix.elements;
    this.positions.push(e[12], e[13], e[14]);
  }
  finalize() {
    const n = this.positions.length / 3;
    this.matArr = new Float32Array(this.matrices);
    this.posArr = new Float32Array(this.positions);
    this.matrices = this.positions = null;
    this.meshes = this.lods.map((lod) => lod.parts.map(({ geometry, material }) => {
      const m = new THREE.InstancedMesh(geometry, material, Math.max(1, n));
      m.frustumCulled = false;
      m.castShadow = !!lod.castShadow;
      m.receiveShadow = true;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return m;
    }));
  }
  attach(group) { this.meshes.forEach((parts) => parts.forEach((m) => group.add(m))); }
  get count() { return this.posArr ? this.posArr.length / 3 : this.positions.length / 3; }
  update(cam, scale) {
    if (!this.posArr.length) return;
    const n = this.posArr.length / 3;
    const counts = this.lods.map(() => 0);
    const lim = this.lods.map((l) => (l.maxDist * scale) ** 2);
    for (let i = 0; i < n; i++) {
      const dx = this.posArr[i * 3] - cam.x, dz = this.posArr[i * 3 + 2] - cam.z;
      const d2 = dx * dx + dz * dz;
      for (let l = 0; l < lim.length; l++) {
        if (d2 < lim[l]) {
          const c = counts[l]++;
          for (const m of this.meshes[l]) m.instanceMatrix.array.set(this.matArr.subarray(i * 16, i * 16 + 16), c * 16);
          break;
        }
      }
    }
    this.meshes.forEach((parts, l) => parts.forEach((m) => {
      m.count = counts[l];
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, counts[l] * 16);
      m.instanceMatrix.needsUpdate = true;
    }));
  }
}

// Uniform grid of vertical cylinders used for player and bullet collisions.
export class Colliders {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
    this.list = [];
  }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  add(c) {
    this.list.push(c);
    const i0 = Math.floor((c.x - c.r) / this.cell), i1 = Math.floor((c.x + c.r) / this.cell);
    const j0 = Math.floor((c.z - c.r) / this.cell), j1 = Math.floor((c.z + c.r) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(c);
    }
  }

  addBox({ x0, x1, z0, z1, y0, y1, type = 'concrete' }) {
    const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
    const hx = (x1 - x0) * 0.5, hz = (z1 - z0) * 0.5;
    this.add({
      box: true, x0, x1, z0, z1, y0, y1, x: cx, z: cz,
      r: Math.hypot(hx, hz), type,
    });
  }

  // Keeps a capsule-like character out of trees, rocks and building shells.
  resolveXZ(pos, radius, y0, y1) {
    for (const c of this.list) {
      if (y0 > c.y1 || y1 < c.y0) continue;
      if (c.box) {
        const inside = pos.x > c.x0 && pos.x < c.x1 && pos.z > c.z0 && pos.z < c.z1;
        if (inside) {
          const dl = pos.x - c.x0, dr = c.x1 - pos.x, dd = pos.z - c.z0, du = c.z1 - pos.z;
          const m = Math.min(dl, dr, dd, du);
          if (m === dl) pos.x = c.x0 - radius;
          else if (m === dr) pos.x = c.x1 + radius;
          else if (m === dd) pos.z = c.z0 - radius;
          else pos.z = c.z1 + radius;
          continue;
        }
        const px = Math.max(c.x0, Math.min(pos.x, c.x1));
        const pz = Math.max(c.z0, Math.min(pos.z, c.z1));
        const dx = pos.x - px, dz = pos.z - pz;
        const d2 = dx * dx + dz * dz;
        const r = radius + 0.02;
        if (d2 < r * r && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = px + (dx / d) * r;
          pos.z = pz + (dz / d) * r;
        }
        continue;
      }
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const r = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1e-4;
      pos.x = c.x + (dx / d) * r;
      pos.z = c.z + (dz / d) * r;
      if (pos.y > c.y1 - 0.5) pos.y = Math.max(pos.y, c.y1);
    }
  }
  query(x, z, r, out = []) {
    out.length = 0;
    const i0 = Math.floor((x - r) / this.cell), i1 = Math.floor((x + r) / this.cell);
    const j0 = Math.floor((z - r) / this.cell), j1 = Math.floor((z + r) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.map.get(this.key(i, j));
      if (l) for (const c of l) if (!out.includes(c)) out.push(c);
    }
    return out;
  }
  // Ray against capped vertical cylinders; returns { t, collider, normal }.
  raycast(o, d, maxDist) {
    let best = null;
    const step = this.cell;
    const tmp = [];
    for (let t = 0; t < maxDist + step; t += step * 0.5) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      this.query(x, z, step * 0.75, tmp);
      for (const c of tmp) {
        if (c.box) {
          const inv = 1 / (d.x || 1e-8);
          let t0 = (c.x0 - o.x) * inv, t1 = (c.x1 - o.x) * inv;
          if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
          let ty0 = (c.y0 - o.y) / (d.y || 1e-8), ty1 = (c.y1 - o.y) / (d.y || 1e-8);
          if (ty0 > ty1) { const s = ty0; ty0 = ty1; ty1 = s; }
          let tz0 = (c.z0 - o.z) / (d.z || 1e-8), tz1 = (c.z1 - o.z) / (d.z || 1e-8);
          if (tz0 > tz1) { const s = tz0; tz0 = tz1; tz1 = s; }
          const tNear = Math.max(t0, ty0, tz0);
          const tFar = Math.min(t1, ty1, tz1);
          if (tNear > tFar || tFar < 0 || tNear > maxDist) continue;
          const th = tNear < 0 ? tFar : tNear;
          if (th < 0 || th > maxDist || (best && th >= best.t)) continue;
          const px = o.x + d.x * th, py = o.y + d.y * th, pz = o.z + d.z * th;
          const nx = px < c.x0 + 0.01 ? -1 : px > c.x1 - 0.01 ? 1 : 0;
          const ny = py < c.y0 + 0.01 ? -1 : py > c.y1 - 0.01 ? 1 : 0;
          const nz = pz < c.z0 + 0.01 ? -1 : pz > c.z1 - 0.01 ? 1 : 0;
          const n = new THREE.Vector3(nx, ny, nz);
          if (n.lengthSq() < 1e-4) n.set(0, 1, 0);
          else n.normalize();
          best = { t: th, collider: c, normal: n, surface: c.type };
          continue;
        }
        const ox = o.x - c.x, oz = o.z - c.z;
        const a = d.x * d.x + d.z * d.z;
        if (a < 1e-8) continue;
        const b = ox * d.x + oz * d.z;
        const cc = ox * ox + oz * oz - c.r * c.r;
        const disc = b * b - a * cc;
        if (disc < 0) continue;
        const th = (-b - Math.sqrt(disc)) / a;
        if (th < 0 || th > maxDist || (best && th >= best.t)) continue;
        const y = o.y + d.y * th;
        if (y < c.y0 || y > c.y1) continue;
        const hx = o.x + d.x * th - c.x, hz = o.z + d.z * th - c.z;
        const l = Math.hypot(hx, hz) || 1;
        best = { t: th, collider: c, normal: new THREE.Vector3(hx / l, 0, hz / l), surface: c.type };
      }
      if (best && best.t < t) break;
    }
    return best;
  }
}

function extractParts(gltf) {
  const parts = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const mat = o.material;
    if (mat.alphaTest > 0 || mat.transparent) {
      mat.transparent = false;
      mat.alphaTest = Math.max(mat.alphaTest, 0.5);
      mat.side = THREE.DoubleSide;
    }
    parts.push({ name: o.name, geometry: g, material: mat });
  });
  return parts;
}

// Splits a model whose meshes are laid out side by side into separate
// variants, each re-centred on its own footprint.
function splitVariants(parts) {
  return parts.map((p) => {
    const g = p.geometry;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    g.translate(-cx, -bb.min.y, -cz);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return { parts: [{ geometry: g, material: p.material }], size: g.boundingBox.getSize(new THREE.Vector3()) };
  });
}

function wholeModel(parts) {
  const box = new THREE.Box3();
  parts.forEach((p) => { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); });
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  parts.forEach((p) => { p.geometry.translate(-cx, -box.min.y, -cz); p.geometry.computeBoundingSphere(); });
  return { parts: parts.map((p) => ({ geometry: p.geometry, material: p.material })), size: box.getSize(new THREE.Vector3()) };
}

export class Vegetation {
  constructor() {
    this.group = new THREE.Group();
    this.sets = [];
    this.colliders = new Colliders();
    this.lastUpdate = new THREE.Vector3(1e9, 0, 0);
    this.scale = 1;
    this.stats = {};
  }

  async load(progress) {
    this.trees = await progress.task('Growing trees', 3, async () => {
      const out = [];
      for (let s = 0; s < SPECIES.length; s++) {
        const sp = SPECIES[s];
        const hi = buildTree(sp.preset, 1000 + s * 77, false);
        const lo = buildTree(sp.preset, 1000 + s * 77, true);
        hi.branchesMesh.geometry.computeBoundingBox();
        hi.leavesMesh.geometry.computeBoundingBox();
        const h = Math.max(hi.branchesMesh.geometry.boundingBox.max.y, hi.leavesMesh.geometry.boundingBox.max.y);
        const scale = sp.height / h;
        const mats = makeTreeMaterials(hi, sp.kind);
        const gh = prepareTreeGeometry(hi, scale), gl = prepareTreeGeometry(lo, scale);
        out.push({
          ...sp,
          trunkRadius: hi.options.branch.radius[0] * scale,
          tris: (gh.branches.index.count + gh.leaves.index.count) / 3,
          trisLow: (gl.branches.index.count + gl.leaves.index.count) / 3,
          lods: [
            { maxDist: 90, castShadow: true, parts: [{ geometry: gh.branches, material: mats.bark }, { geometry: gh.leaves, material: mats.leaves }] },
            { maxDist: 420, castShadow: false, parts: [{ geometry: gl.branches, material: mats.bark }, { geometry: gl.leaves, material: mats.leaves }] },
          ],
        });
        await new Promise((r) => setTimeout(r, 0));
      }
      return out;
    });
    this.stats.treeTris = this.trees.map((t) => `${t.preset}:${t.tris}/${t.trisLow}`).join(' ');

    const ids = ['rock_moss_set_01', 'rock_moss_set_02', 'boulder_01', 'namaqualand_boulder_02', 'fern_02', 'shrub_02', 'dead_tree_trunk', 'tree_stump_01'];
    const models = await progress.task('Loading rocks and plants', 4, () => Promise.all(ids.map((id) => loadGLTF(modelUrl(id)))));
    const m = Object.fromEntries(ids.map((id, i) => [id, extractParts(models[i])]));
    this.models = {
      rocks: [...splitVariants(m.rock_moss_set_01), ...splitVariants(m.rock_moss_set_02)],
      boulders: [wholeModel(m.boulder_01), wholeModel(m.namaqualand_boulder_02)],
      ferns: splitVariants(m.fern_02),
      shrubs: splitVariants(m.shrub_02),
      logs: [wholeModel(m.dead_tree_trunk), wholeModel(m.tree_stump_01)],
    };
    for (const list of Object.values(this.models)) for (const v of list) for (const p of v.parts) {
      if (p.material.alphaTest > 0) addWind(p.material, 0.02, 'plant-wind');
    }
  }

  scatter(terrain, spawn) {
    const noise = makeNoise(WORLD_SEED + 5);
    const rand = mulberry32(WORLD_SEED + 99);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), mtx = new THREE.Matrix4();
    const nrm = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    const treeSets = this.trees.map((t) => new InstancedSet(t.lods, this.group));
    const mkSets = (list, near, far, shadow = true) => list.map((v) => new InstancedSet([
      { maxDist: near, castShadow: shadow, parts: v.parts },
      ...(far ? [{ maxDist: far, castShadow: false, parts: v.parts }] : []),
    ], this.group));
    const rockSets = mkSets(this.models.rocks, 70, 220);
    const boulderSets = mkSets(this.models.boulders, 80, 380);
    const fernSets = mkSets(this.models.ferns, 55, 0, false);
    const shrubSets = mkSets(this.models.shrubs, 50, 110);
    const logSets = mkSets(this.models.logs, 60, 150);

    const place = (cell, fn) => {
      for (let z = -HALF_WORLD + cell / 2; z < HALF_WORLD; z += cell) {
        for (let x = -HALF_WORLD + cell / 2; x < HALF_WORLD; x += cell) {
          const px = x + (rand() - 0.5) * cell * 0.9, pz = z + (rand() - 0.5) * cell * 0.9;
          const h = terrain.heightAt(px, pz);
          if (h < 0.4) { rand(); continue; }
          if (Math.hypot(px - spawn.x, pz - spawn.z) < 9) { rand(); continue; }
          fn(px, h, pz, terrain.biomeAt(px, pz), rand());
        }
      }
    };

    place(6.5, (x, y, z, b, r) => {
      const clump = noise.fbm2(x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
      const prob = b.forest * (0.55 + clump * 0.45) + b.grass * 0.012 * clump;
      if (r > prob) return;
      terrain.normalAt(x, z, nrm);
      if (nrm.y < 0.82) return;
      const pineBias = THREE.MathUtils.smoothstep(y, 12, 40) * 0.6 + (noise.noise2(x * 0.006, z * 0.006) * 0.5 + 0.5) * 0.5;
      const pick = rand() < pineBias ? (rand() < 0.5 ? 0 : 1) : 2 + Math.floor(rand() * 4);
      const t = this.trees[pick];
      const sc = 0.75 + rand() * 0.5;
      e.set((rand() - 0.5) * 0.06, rand() * Math.PI * 2, (rand() - 0.5) * 0.06);
      mtx.compose(p.set(x, y - 0.3, z), q.setFromEuler(e), s.setScalar(sc));
      treeSets[pick].add(mtx);
      const r0 = Math.max(0.2, t.trunkRadius * sc * 0.85);
      this.colliders.add({ x, z, r: r0, y0: y - 1, y1: y + t.height * sc, type: 'wood' });
    });

    const placeRock = (sets, list, x, y, z, sc, kind) => {
      const vi = Math.floor(rand() * list.length);
      const v = list[vi];
      terrain.normalAt(x, z, nrm);
      q.setFromUnitVectors(up, nrm.clone().lerp(up, 0.5).normalize());
      const qy = new THREE.Quaternion().setFromAxisAngle(up, rand() * Math.PI * 2);
      q.multiply(qy);
      mtx.compose(p.set(x, y - v.size.y * sc * 0.18, z), q, s.setScalar(sc));
      sets[vi].add(mtx);
      const r0 = Math.max(v.size.x, v.size.z) * sc * 0.42;
      if (r0 > 0.25) this.colliders.add({ x, z, r: r0, y0: y - 1, y1: y + v.size.y * sc * 0.8, type: kind });
    };

    place(8, (x, y, z, b, r) => {
      const prob = b.rock * 0.35 + b.grass * 0.025 + b.forest * 0.06 + b.sand * 0.03;
      if (r > prob) return;
      placeRock(rockSets, this.models.rocks, x, y, z, 0.35 + rand() * rand() * 1.8, 'rock');
    });
    place(42, (x, y, z, b, r) => {
      if (r > (b.grass + b.rock + b.forest * 0.5) * 0.28) return;
      placeRock(boulderSets, this.models.boulders, x, y, z, 0.8 + rand() * 1.1, 'rock');
    });
    place(2.8, (x, y, z, b, r) => {
      if (r > b.forest * 0.5 + b.grass * 0.01) return;
      const vi = Math.floor(rand() * this.models.ferns.length);
      e.set(0, rand() * Math.PI * 2, 0);
      mtx.compose(p.set(x, y - 0.05, z), q.setFromEuler(e), s.setScalar(0.7 + rand() * 0.7));
      fernSets[vi].add(mtx);
    });
    place(6, (x, y, z, b, r) => {
      if (r > b.forest * 0.18 + b.grass * 0.035) return;
      const vi = Math.floor(rand() * this.models.shrubs.length);
      e.set(0, rand() * Math.PI * 2, 0);
      mtx.compose(p.set(x, y - 0.1, z), q.setFromEuler(e), s.setScalar(0.5 + rand() * 0.6));
      shrubSets[vi].add(mtx);
    });
    place(26, (x, y, z, b, r) => {
      if (r > b.forest * 0.35) return;
      const vi = Math.floor(rand() * this.models.logs.length);
      const v = this.models.logs[vi];
      terrain.normalAt(x, z, nrm);
      q.setFromUnitVectors(up, nrm);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rand() * Math.PI * 2));
      const sc = 0.8 + rand() * 0.4;
      mtx.compose(p.set(x, y - 0.05, z), q, s.setScalar(sc));
      logSets[vi].add(mtx);
      this.colliders.add({ x, z, r: Math.min(v.size.x, v.size.z) * sc * 0.45, y0: y - 1, y1: y + v.size.y * sc, type: 'wood' });
    });

    this.sets = [...treeSets, ...rockSets, ...boulderSets, ...fernSets, ...shrubSets, ...logSets];
    this.stats.trees = treeSets.reduce((a, s) => a + s.count, 0);
    this.stats.rocks = rockSets.reduce((a, s) => a + s.count, 0);
    this.stats.ferns = fernSets.reduce((a, s) => a + s.count, 0);
    this.sets.forEach((set) => { set.finalize(); set.attach(this.group); });
  }

  update(time, camPos, force = false) {
    windUniforms.uTime.value = time;
    const dx = camPos.x - this.lastUpdate.x, dz = camPos.z - this.lastUpdate.z;
    if (!force && dx * dx + dz * dz < 36) return;
    this.lastUpdate.copy(camPos);
    for (const s of this.sets) s.update(camPos, this.scale);
  }
}
