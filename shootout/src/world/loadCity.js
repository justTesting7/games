import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

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

export async function loadCity(scene, renderer, folder = 'dizengoff-center') {
  loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(`${BASE}assets/basis/`).detectSupport(renderer));
  const [far, set] = await Promise.all([loader.loadAsync(`${BASE}assets/maps/${folder}/far.glb`), loader.loadAsync(`${BASE}assets/maps/${folder}/set.glb`)]);
  scene.add(far.scene, set.scene);
  const nightMats = [], shutters = [];
  const max = renderer.capabilities.getMaxAnisotropy();
  const upgraded = new Map();
  for (const root of [far.scene, set.scene]) root.traverse(o => {
    if (!o.isMesh) return;
    o.matrixAutoUpdate = false; o.updateMatrix();       // static
    if (UPGRADE[o.material.name]) {
      if (!upgraded.has(o.material)) upgraded.set(o.material, UPGRADE[o.material.name](o.material));
      o.material = upgraded.get(o.material);
    }
    const m = o.material, u = m.userData;                // glTF extras
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
