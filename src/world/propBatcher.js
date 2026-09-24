import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const NEAR = 40;
const FAR = 100;

export let activeBatcher = null;

export function withBatcher(batcher, fn) {
  const prev = activeBatcher;
  activeBatcher = batcher;
  try { return fn(); } finally { activeBatcher = prev; }
}

function fromRoot(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const minY = box.min.y;
  const size = box.getSize(new THREE.Vector3());
  const lift = new THREE.Matrix4().makeTranslation(0, -minY, 0);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    geo.applyMatrix4(lift);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    parts.push({ geometry: geo, material: mat });
  });
  return { parts, size, minY };
}

export class PropBatcher {
  constructor(models = {}) {
    this.models = models;
    this.templates = new Map();
    this.queued = [];
    this.buckets = [];
    this._cam = new THREE.Vector3(1e9, 0, 1e9);
  }

  registerObject(id, root) {
    if (!root || this.templates.has(id)) return;
    this.templates.set(id, fromRoot(root));
  }

  template(id) {
    if (this.templates.has(id)) return this.templates.get(id);
    const gltf = this.models[id];
    if (!gltf?.scene) return null;
    const t = fromRoot(gltf.scene);
    this.templates.set(id, t);
    return t;
  }

  place(id, x, z, yaw, scale, coverY, type, terrain, colliders) {
    const t = this.template(id);
    if (!t) return null;
    const y = terrain.heightAt(x, z);
    this.queued.push({ id, x, y, z, yaw, scale });
    const hx = Math.max(0.22, t.size.x * scale * 0.5);
    const hz = Math.max(0.22, t.size.z * scale * 0.5);
    colliders.addBox({
      x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz,
      y0: y, y1: y + Math.max(t.size.y * scale, coverY),
      type: type || (id.includes('car') ? 'metal' : 'cover'),
    });
    return { position: { x, y: y + 0.5, z } };
  }

  bake(group) {
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const world = new THREE.Matrix4();
    const buckets = new Map();

    for (const item of this.queued) {
      const t = this.template(item.id);
      if (!t) continue;
      q.setFromAxisAngle(UP, item.yaw);
      s.set(item.scale, item.scale, item.scale);
      p.set(item.x, item.y, item.z);
      world.compose(p, q, s);
      for (const part of t.parts) {
        const key = `${part.geometry.uuid}:${part.material.uuid}`;
        let b = buckets.get(key);
        if (!b) {
          b = { geometry: part.geometry, material: part.material, mats: [], xs: [], zs: [] };
          buckets.set(key, b);
        }
        b.mats.push(world.clone());
        b.xs.push(item.x);
        b.zs.push(item.z);
      }
    }

    this.buckets = [];
    for (const b of buckets.values()) {
      const n = b.mats.length;
      if (!n) continue;
      const packed = new Float32Array(n * 16);
      for (let i = 0; i < n; i++) packed.set(b.mats[i].elements, i * 16);
      const near = new THREE.InstancedMesh(b.geometry, b.material, n);
      const far = new THREE.InstancedMesh(b.geometry, b.material, n);
      near.castShadow = true;
      near.receiveShadow = far.receiveShadow = true;
      far.castShadow = false;
      near.frustumCulled = far.frustumCulled = false;
      near.count = far.count = 0;
      near.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(near, far);
      this.buckets.push({
        xs: new Float32Array(b.xs),
        zs: new Float32Array(b.zs),
        packed,
        n,
        near,
        far,
      });
    }
    this.queued = [];
    this._cam.set(1e9, 0, 1e9);
  }

  update(cam) {
    if (!this.buckets.length) return;
    const dx = cam.x - this._cam.x, dz = cam.z - this._cam.z;
    if (dx * dx + dz * dz < 49) return;
    this._cam.copy(cam);
    const near2 = NEAR * NEAR, far2 = FAR * FAR;
    for (const b of this.buckets) {
      let nc = 0, fc = 0;
      const na = b.near.instanceMatrix.array;
      const fa = b.far.instanceMatrix.array;
      for (let i = 0; i < b.n; i++) {
        const ddx = b.xs[i] - cam.x, ddz = b.zs[i] - cam.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > far2) continue;
        const src = b.packed.subarray(i * 16, i * 16 + 16);
        if (d2 < near2) na.set(src, (nc++) * 16);
        else fa.set(src, (fc++) * 16);
      }
      b.near.count = nc;
      b.far.count = fc;
      b.near.instanceMatrix.clearUpdateRanges();
      b.far.instanceMatrix.clearUpdateRanges();
      b.near.instanceMatrix.addUpdateRange(0, nc * 16);
      b.far.instanceMatrix.addUpdateRange(0, fc * 16);
      b.near.instanceMatrix.needsUpdate = true;
      b.far.instanceMatrix.needsUpdate = true;
    }
  }
}
