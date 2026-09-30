import * as THREE from 'three';

// The city exports batch everything by material: each mesh spans the whole district,
// so frustum culling can never skip one, and the camera and the small shadow frustum
// both draw the entire city every frame. This splits every big mesh into square cells
// of the ground plan. The pieces share the original vertex buffers (uploaded once) and
// only get their own index list and bounds, so culling can drop what is out of view.

const tmp = new THREE.Vector3();

export function chunkMeshes(root, { cell = 128, minTris = 3000 } = {}) {
  root.updateMatrixWorld(true);
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.parent) return;
    if (o.userData?.hours) return; // shop shutters toggle the whole mesh by time of day
    list.push(o);
  });
  let before = 0, after = 0;
  for (const o of list) {
    const g = o.geometry, idx = g.index, pos = g.attributes.position;
    if (!pos || g.morphAttributes?.position) continue;
    const n = idx ? idx.count : pos.count;
    if (n / 3 < minTris) continue;
    const buckets = new Map();
    const at = (i) => (idx ? idx.getX(i) : i);
    for (let t = 0; t + 2 < n; t += 3) {
      let x = 0, z = 0;
      for (let k = 0; k < 3; k++) {
        tmp.fromBufferAttribute(pos, at(t + k)).applyMatrix4(o.matrixWorld);
        x += tmp.x; z += tmp.z;
      }
      const key = `${Math.floor(x / 3 / cell)},${Math.floor(z / 3 / cell)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(at(t), at(t + 1), at(t + 2));
    }
    if (buckets.size < 2) continue;
    before++;
    for (const tris of buckets.values()) {
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(g.attributes)) geo.setAttribute(name, attr);
      geo.setIndex(new THREE.BufferAttribute(pos.count > 65535 ? new Uint32Array(tris) : new Uint16Array(tris), 1));
      // bounds of this piece only (the shared buffer covers the whole district)
      const box = new THREE.Box3();
      for (const i of tris) box.expandByPoint(tmp.fromBufferAttribute(pos, i));
      geo.boundingBox = box;
      const sphere = new THREE.Sphere();
      box.getCenter(sphere.center);
      let r2 = 0;
      for (const i of tris) r2 = Math.max(r2, sphere.center.distanceToSquared(tmp.fromBufferAttribute(pos, i)));
      sphere.radius = Math.sqrt(r2);
      geo.boundingSphere = sphere;
      const m = new THREE.Mesh(geo, o.material);
      m.name = o.name;
      m.castShadow = o.castShadow;
      m.receiveShadow = o.receiveShadow;
      m.renderOrder = o.renderOrder;
      m.userData = o.userData;
      m.matrixAutoUpdate = false;
      m.matrix.copy(o.matrix);
      m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
      o.parent.add(m);
      after++;
    }
    o.parent.remove(o);
  }
  root.updateMatrixWorld(true);
  return { split: before, pieces: after };
}
