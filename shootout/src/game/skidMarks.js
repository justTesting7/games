import * as THREE from 'three';

// Rubber laid on the road: each skidding wheel lays a strip from where it was last frame
// to where it is now. Strips come from one pooled InstancedMesh (the oldest is reused)
// and fade with age through their instance colour.

const MAX = 900;

export class SkidMarks {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.55,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    // keep the scene depth the HDR target stores in alpha (engine/patch.js)
    mat.blending = THREE.CustomBlending;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.next = 0;
    this.born = new Float32Array(MAX);
    this.t = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /** A strip from a to b (world points on the ground), `width` wide, `strength` 0..1. */
  lay(a, b, width = 0.22, strength = 1) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05 || len > 3) return;
    const i = this.next;
    this._p.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.02, (a.z + b.z) / 2);
    this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(dx, dz));
    this._s.set(width, 1, len + 0.04);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.setColorAt(i, this._c.setScalar(0.03 + (1 - strength) * 0.08)); // instance colour is the darkness
    this.born[i] = this.t;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.next = (i + 1) % MAX;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
  }

  /** Marks older than a minute fade toward asphalt grey. */
  update(dt) {
    this.t += dt;
    this.fadeT = (this.fadeT || 0) + dt;
    if (this.fadeT < 1 || !this.mesh.instanceColor) return;
    this.fadeT = 0;
    let changed = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const age = this.t - this.born[i];
      if (age < 60) continue;
      const c = Math.min(0.22, 0.03 + (age - 60) / 200);
      this.mesh.setColorAt(i, this._c.setScalar(c));
      changed = true;
    }
    if (changed) this.mesh.instanceColor.needsUpdate = true;
  }
}
