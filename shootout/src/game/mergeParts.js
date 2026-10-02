import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A model built from many small meshes (a rifle's stock, scope rings and turrets, a
// pistol's frame, hammer and trigger) costs a draw call per piece in every pass. This
// merges the pieces that never move relative to `root` into one mesh per look (the same
// material, or a copy with the same textures and values); the ones named in `moving`
// (bolts, slides, magazines) stay as they are. Done in place; returns root.
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];

function lookOf(m) {
  return [m.type, m.color?.getHex(), m.roughness, m.metalness, m.emissive?.getHex(), m.envMapIntensity, m.side, m.transparent,
    ...MAPS.map((k) => m[k]?.source?.uuid || m[k]?.uuid || '-')].join('|');
}

export function mergeStaticParts(root, moving = []) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const isMoving = (o) => { for (let x = o; x && x !== root; x = x.parent) if (moving.includes(x.name)) return true; return false; };
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || isMoving(o)) return;
    const k = lookOf(o.material);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g = g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = `${first.name || 'part'}-merged`;
    mesh.castShadow = list.some((o) => o.castShadow);
    mesh.receiveShadow = list.some((o) => o.receiveShadow);
    root.add(mesh);
    for (const o of list) o.removeFromParent();
  }
  return root;
}
