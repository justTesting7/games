import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import { cityPartsOf, ownerOf, underSets, GROUND_MESH, groundDrop } from './cityParts.js';

const BASE = import.meta.env?.BASE_URL || '/shootout/';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// Paint and glass read as plastic without a clear coat and sky reflections: the
// exported PBR values are swapped for physical ones (the sky PMREM is scene.environment).
const physical = (src, props) => {
  const m = new THREE.MeshPhysicalMaterial({
    name: src.name, color: src.color, map: src.map, vertexColors: src.vertexColors, ...props,
  });
  m.userData = src.userData;
  return m;
};
const UPGRADE = {
  carpaint: (m) => physical(m, { roughness: 0.3, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 }),
  carglass: (m) => physical(m, { color: new THREE.Color(0x06080a), roughness: 0.03, metalness: 0, ior: 1.52, envMapIntensity: 1.6 }),
  glass: (m) => physical(m, { roughness: 0.04, metalness: 0.05, ior: 1.52, envMapIntensity: 1.4 }),
  metal: (m) => physical(m, { roughness: 0.38, metalness: 0.85, envMapIntensity: 1.1 }),
};

/**
 * Drops the triangles whose centre (world x, z) fails keep(x, z): the overlap between two
 * neighbouring sets keeps each building once. Meshes whose name matches `skip` stay whole.
 */
function keepTriangles(root, keep, skip = null) {
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || (skip && skip.test(o.name))) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count;
    const out = [];
    let dropped = 0;
    for (let t = 0; t + 2 < n; t += 3) {
      let x = 0, z = 0;
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld);
        x += v.x; z += v.z;
      }
      if (keep(x / 3, z / 3)) out.push(idx ? idx.getX(t) : t, idx ? idx.getX(t + 1) : t + 1, idx ? idx.getX(t + 2) : t + 2);
      else dropped++;
    }
    if (dropped) g.setIndex(new THREE.BufferAttribute(new Uint32Array(out), 1));
  });
}

/** Swaps the exported car paint, glass and metal for the physical versions (see UPGRADE). */
// Wind in the trees: leaves and palm fronds sway on a slow gust and flutter on a quick one,
// by where they stand (so neighbouring trees move apart), harder in a storm. The game sets
// CITY_WIND.time and .strength every frame.
export const CITY_WIND = { time: { value: 0 }, strength: { value: 1 } };
const FOLIAGE = /^(leaves|foliage|fronds)$/;
const windDone = new WeakSet();
export function addWind(m) {
  if (windDone.has(m)) return;
  windDone.add(m);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uWindT = CITY_WIND.time;
    sh.uniforms.uWindK = CITY_WIND.strength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindT;\nuniform float uWindK;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
    float gust = sin(uWindT * 0.9 + wp.x * 0.11 + wp.z * 0.07) * 0.5 + 0.5;
    vec2 sway = vec2(sin(uWindT * 1.6 + wp.x * 0.35 + wp.z * 0.21), cos(uWindT * 1.3 + wp.z * 0.33 + wp.x * 0.17)) * (0.025 + 0.05 * gust);
    vec3 flutter = vec3(sin(uWindT * 7.3 + wp.y * 3.1 + wp.x * 2.3), sin(uWindT * 8.1 + wp.z * 2.9), cos(uWindT * 6.7 + wp.x * 3.3)) * 0.012;
    transformed += (vec3(sway.x, 0.0, sway.y) + flutter) * uWindK;
  }`);
  };
  m.customProgramCacheKey = () => `${m.uuid}-wind`;
  m.needsUpdate = true;
}

export function upgradeCityMaterials(root) {
  const done = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !UPGRADE[o.material.name]) return;
    if (!done.has(o.material)) done.set(o.material, UPGRADE[o.material.name](o.material));
    o.material = done.get(o.material);
  });
}

export async function loadCity(scene, renderer, folder = 'dizengoff-center') {
  loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(`${BASE}assets/basis/`).detectSupport(renderer));
  // a stitched map loads every set at its offset and the skyline of one of them
  const def = cityPartsOf(folder);
  const sets = def ? def.sets : [{ folder, offset: [0, 0, 0] }];
  // a set over the 25 MiB asset limit is built as chunks (set.glb, set-2.glb, ...)
  const chunks = (p) => Promise.all((p.files || ['set.glb']).map((f) => loader.loadAsync(`${BASE}assets/maps/${p.folder}/${f}`)))
    .then((list) => { const scene = new THREE.Group(); list.forEach((g) => scene.add(g.scene)); return { scene }; });
  const [far, ...loaded] = await Promise.all([
    loader.loadAsync(`${BASE}assets/maps/${def ? def.far : folder}/far.glb`),
    ...sets.map(chunks),
  ]);
  const set = { scene: new THREE.Group() };
  set.scene.name = `set-${folder}`;
  loaded.forEach((g, i) => {
    g.scene.position.fromArray(sets[i].offset);
    if (def) g.scene.traverse((o) => { if (o.isMesh && GROUND_MESH.test(o.name)) o.position.y -= groundDrop(i); });
    set.scene.add(g.scene);
  });
  if (def) {
    set.scene.updateMatrixWorld(true);
    loaded.forEach((g, i) => keepTriangles(g.scene, (x, z) => ownerOf(def, x, z) === i, GROUND_MESH));
    far.scene.updateMatrixWorld(true);
    keepTriangles(far.scene, (x, z) => !underSets(def, x, z), /^far_ground$/);
  }
  scene.add(far.scene, set.scene);
  const nightMats = [], shutters = [];
  const max = renderer.capabilities.getMaxAnisotropy();
  const upgraded = new Map();
  for (const root of [far.scene, set.scene]) root.traverse(o => {
    if (o.isMesh && !o.geometry.index?.count && o.geometry.index) { o.visible = false; return; } // clipped away entirely
    if (!o.isMesh) return;
    o.matrixAutoUpdate = false; o.updateMatrix();       // static
    if (UPGRADE[o.material.name]) {
      if (!upgraded.has(o.material)) upgraded.set(o.material, UPGRADE[o.material.name](o.material));
      o.material = upgraded.get(o.material);
    }
    const m = o.material, u = m.userData;                // glTF extras
    if (FOLIAGE.test(m.name || '')) addWind(m);
    for (const k of ['map','normalMap','emissiveMap']) if (m[k]) m[k].anisotropy = Math.min(8, max);
    if (u.night_emissive) nightMats.push(m);
    if (u.hours) shutters.push({mesh: o, hours: u.hours, show: u.show}); // hours = [startMin, endMin] wraps midnight
  });
  // call each frame or when time changes; minutes = 0..1439, night = 0..1
  const update = (minutes, night) => {
    for (const m of nightMats) m.emissiveIntensity = night;
    for (const s of shutters) {
      const [a, b] = s.hours, closed = a > b ? (minutes >= a || minutes < b) : (minutes >= a && minutes < b);
      s.mesh.visible = (s.show === 'closed') === closed;
    }
  };
  return {far: far.scene, set: set.scene, update};
}
// Needs scene.environment = <PMREM env map>; camera.far >= ~12000 for far.glb (spans 8000 units).
