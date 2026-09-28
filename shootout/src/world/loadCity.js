import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env?.BASE_URL || '/shootout/';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export async function loadCity(scene, renderer, folder = 'dizengoff-center') {
  loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(`${BASE}assets/basis/`).detectSupport(renderer));
  const [far, set] = await Promise.all([loader.loadAsync(`${BASE}assets/maps/${folder}/far.glb`), loader.loadAsync(`${BASE}assets/maps/${folder}/set.glb`)]);
  scene.add(far.scene, set.scene);
  const nightMats = [], shutters = [];
  const max = renderer.capabilities.getMaxAnisotropy();
  for (const root of [far.scene, set.scene]) root.traverse(o => {
    if (!o.isMesh) return;
    o.matrixAutoUpdate = false; o.updateMatrix();       // static
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
