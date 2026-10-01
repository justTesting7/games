import * as THREE from 'three';

// Solid bits knocked off by impacts and blasts: small faceted chips (stretched into
// splinters for wood, flattened into shards for glass) that fly, tumble, bounce on the
// ground with friction, come to rest and shrink away. One InstancedMesh, pooled.

const MAX = 320;
const LIFE = 7;

export class Debris {
  constructor(scene, heightAt) {
    this.heightAt = heightAt;
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.items = [];
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /**
   * kind: 'chip' | 'splinter' | 'shard' | 'chunk'. vel is a Vector3 (m/s).
   * color: [r, g, b] 0..1 (linear).
   */
  spawn(pos, vel, { kind = 'chip', size = 0.03, color = [0.55, 0.53, 0.5] } = {}) {
    const i = this.next;
    this.next = (i + 1) % MAX;
    const scale = kind === 'splinter' ? [size * 0.5, size * 0.5, size * 3]
      : kind === 'shard' ? [size * 1.6, size * 0.15, size * 1.2]
        : [size, size * (0.6 + Math.random() * 0.5), size * (0.8 + Math.random() * 0.4)];
    this.items[i] = {
      p: pos.clone(), v: vel.clone(), r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      w: new THREE.Vector3().randomDirection().multiplyScalar(8 + Math.random() * 18), s: scale, age: 0, rest: false,
    };
    this.mesh.setColorAt(i, this._c.setRGB(color[0], color[1], color[2]));
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
  }

  update(dt) {
    if (!this.mesh.count) return;
    let moved = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const d = this.items[i];
      if (!d) continue;
      d.age += dt;
      if (d.age > LIFE) { this.items[i] = null; this.mesh.setMatrixAt(i, this._m.makeScale(0, 0, 0)); moved = true; continue; }
      if (!d.rest) {
        d.v.y -= 9.8 * dt;
        d.p.addScaledVector(d.v, dt);
        d.r.addScaledVector(d.w, dt);
        const g = this.heightAt(d.p.x, d.p.z) + d.s[1] * 0.5;
        if (d.p.y < g) {
          d.p.y = g;
          if (Math.abs(d.v.y) < 0.6 && Math.hypot(d.v.x, d.v.z) < 0.3) { d.rest = true; d.r.x = Math.round(d.r.x / Math.PI) * Math.PI; d.r.z = Math.round(d.r.z / Math.PI) * Math.PI; }
          d.v.y = -d.v.y * 0.32;
          d.v.x *= 0.55; d.v.z *= 0.55;
          d.w.multiplyScalar(0.5);
        }
      }
      const fade = d.age > LIFE - 1.2 ? (LIFE - d.age) / 1.2 : 1; // shrink away at the end
      this._q.setFromEuler(this._e.set(d.r.x, d.r.y, d.r.z));
      this._s.set(d.s[0] * fade, d.s[1] * fade, d.s[2] * fade);
      this._m.compose(d.p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      moved = true;
    }
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
