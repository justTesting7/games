import * as THREE from 'three';
import { loadGLTF, modelUrl } from '../engine/assets.js';

function extractMesh(root, name) {
  const o = root.getObjectByName(name);
  if (!o?.isMesh) return null;
  root.updateMatrixWorld(true);
  o.updateMatrixWorld(true);
  const g = o.geometry.clone();
  g.applyMatrix4(o.matrixWorld);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const cx = (bb.min.x + bb.max.x) * 0.5;
  const cz = (bb.min.z + bb.max.z) * 0.5;
  g.translate(-cx, -bb.min.y, -cz);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const mat = o.material;
  if (mat?.map) {
    mat.map = mat.map.clone();
    mat.map.needsUpdate = true;
  }
  return {
    geometry: g,
    material: mat,
    width: size.x,
    depth: size.z,
    height: size.y,
  };
}

export async function loadFacadeKit(id) {
  const gltf = await loadGLTF(modelUrl(id));
  const root = gltf.scene;
  const pick = (...names) => {
    for (const n of names) {
      const p = extractMesh(root, n);
      if (p) return p;
    }
    return null;
  };
  const parts = {
    floorWindow: pick('wall_window_centered_large_01', 'window_tall_large_02', 'window_centered_large_01'),
    floorWindowAlt: pick('wall_window_centered_large_02', 'wall_window_angled_large_01', 'wall_window_centered_large_01'),
    floorTall: pick('window_tall_large_02', 'wall_window_centered_large_01'),
    wall: pick('wall_standard_standard_01'),
    corner: pick('wall_standard_corner_large_01'),
    dado: pick('dado_standard_standard_01', 'base_standard_standard_01'),
    cornice: pick('cornice_standard_standard_01', 'cornice02_standard_standard_01'),
    crown: pick('crown_standard_standard_01'),
    storefront: pick('door_window_small_03', 'door_centered_large_01'),
  };
  return { id, parts };
}

export class FacadeInstancer {
  constructor(max = 12000) {
    this.max = max;
    this.buckets = new Map();
  }

  key(part) {
    return `${part.geometry.uuid}:${part.material.uuid}`;
  }

  add(part, pos, rotY = 0, scale = 1) {
    if (!part) return;
    const k = this.key(part);
    if (!this.buckets.has(k)) {
      this.buckets.set(k, { part, matrices: [] });
    }
    const b = this.buckets.get(k);
    if (b.matrices.length >= this.max) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const s = new THREE.Vector3(scale, scale, scale);
    b.matrices.push(new THREE.Matrix4().compose(pos, q, s));
  }

  attach(group) {
    for (const { part, matrices } of this.buckets.values()) {
      if (!matrices.length) continue;
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }
}
