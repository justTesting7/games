import * as THREE from 'three';

// Body panels torn off an exploding car: bonnet, doors and boot lid fly out tumbling,
// bounce on the street with friction, skid and settle flat, and stay there a minute.
// One InstancedMesh of unit boxes, each scaled to its panel; charred dark paint.

const MAX = 32;
const LIFE = 60;

export class Panels {
  constructor(scene, heightAt) {
    this.heightAt = heightAt;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.4 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.items = [];
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._w = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /** A car blows apart: its panels go up and out from the blast at its middle. */
  burst(car, sizeOf) {
    const S = sizeOf(car), fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), rx = fz, rz = -fx;
    const y = car.y;
    // [along, side, height, w, h, d, out-x(local), out-z(local)]
    const parts = [
      [S.halfL * 0.6, 0, 0.95, S.halfW * 1.7, 0.05, S.halfL * 0.55, 0, 1], // bonnet
      [-S.halfL * 0.75, 0, 0.95, S.halfW * 1.6, 0.05, S.halfL * 0.35, 0, -1], // boot lid
      [0.25, S.halfW, 0.65, 0.05, 0.75, 1.05, 1, 0], // doors
      [0.25, -S.halfW, 0.65, 0.05, 0.75, 1.05, -1, 0],
    ];
    if (Math.random() < 0.6) parts.push([-0.8, S.halfW, 0.65, 0.05, 0.7, 0.9, 1, 0]);
    for (const [a, sd, h, w, hh, d, ox, oz] of parts) {
      if (Math.random() < 0.15) continue; // one hangs on
      const i = this.next;
      this.next = (i + 1) % MAX;
      const p = new THREE.Vector3(car.x + fx * a + rx * sd, y + h, car.z + fz * a + rz * sd);
      const outX = fx * oz + rx * ox, outZ = fz * oz + rz * ox;
      const speed = 5 + Math.random() * 6;
      this.items[i] = {
        p, v: new THREE.Vector3(outX * speed + (Math.random() - 0.5) * 2, 6 + Math.random() * 6, outZ * speed + (Math.random() - 0.5) * 2),
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, car.yaw, 0)),
        w: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14),
        size: new THREE.Vector3(w, hh, d), age: 0, rest: false, tone: 0.06 + Math.random() * 0.06,
      };
      this.mesh.setColorAt(i, this._c.setRGB(this.items[i].tone, this.items[i].tone * 0.92, this.items[i].tone * 0.85));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = Math.max(this.mesh.count, Math.min(MAX, this.items.length));
  }

  update(dt) {
    if (!this.items.length) return;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it) continue;
      it.age += dt;
      if (it.age > LIFE) { it.size.multiplyScalar(0.97); if (it.size.x < 0.02) { this.items[i] = null; this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); continue; } }
      if (!it.rest) {
        it.v.y -= 9.8 * dt;
        it.v.multiplyScalar(1 - 0.25 * dt); // air drag on a flat sheet
        it.p.addScaledVector(it.v, dt);
        const wl = it.w.length();
        if (wl > 1e-3) it.q.premultiply(this._w.setFromAxisAngle(this._s.copy(it.w).divideScalar(wl), wl * dt));
        const g = this.heightAt(it.p.x, it.p.z) + Math.min(it.size.x, it.size.y, it.size.z) * 0.5 + 0.01;
        if (it.p.y < g) {
          it.p.y = g;
          // a thud and a skid: most of the drop is soaked up, the slide rubs away
          it.v.y = Math.abs(it.v.y) * 0.22;
          it.v.x *= 0.55; it.v.z *= 0.55;
          it.w.multiplyScalar(0.45);
          if (it.v.lengthSq() < 0.6) {
            it.rest = true;
            // settle flat: keep the heading, lose the tilt
            const e = new THREE.Euler().setFromQuaternion(it.q, 'YXZ');
            it.q.setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
            // the thinnest side down
            if (it.size.x < it.size.y) it.size.set(it.size.y, it.size.x, it.size.z);
            it.p.y = this.heightAt(it.p.x, it.p.z) + it.size.y * 0.5 + 0.01;
          }
        }
      }
      this._m.compose(it.p, it.q, it.size);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.items = [];
    this.mesh.count = 0;
  }
}
