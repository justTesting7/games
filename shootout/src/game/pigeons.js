import * as THREE from 'three';

// Pigeons: small flocks that walk and peck about open ground by day. A gunshot, a blast or
// someone running through them sends the whole flock up at once in a clatter of wings; they
// wheel round overhead as a flock (cohesion, alignment, separation) and, once it has been
// quiet for a while, glide back down to land near where they were. One InstancedMesh; the
// wings beat in the vertex shader from a per-bird angle the simulation sets. They roost
// (are gone) at night.

const MAX = 120;
const SPAN = 0.2; // metres from the shoulder to a wing tip

function pigeonGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(1, 7, 5).scale(0.055, 0.05, 0.13);
  const head = new THREE.SphereGeometry(1, 6, 4).scale(0.03, 0.032, 0.035).translate(0, 0.055, 0.11);
  const tail = new THREE.PlaneGeometry(0.07, 0.09).rotateX(-Math.PI / 2 + 0.15).translate(0, 0.005, -0.16);
  parts.push(body, head, tail);
  // wings: a flat quad each side, from the shoulder out to the tip, swept back
  for (const s of [-1, 1]) {
    const w = new THREE.BufferGeometry();
    const x0 = 0.04 * s, x1 = (0.04 + SPAN) * s;
    w.setAttribute('position', new THREE.Float32BufferAttribute([
      x0, 0.02, 0.06, x1, 0.02, -0.02, x1, 0.02, -0.09,
      x0, 0.02, 0.06, x1, 0.02, -0.09, x0, 0.02, -0.07,
    ], 3));
    w.computeVertexNormals();
    parts.push(w);
  }
  const geos = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  });
  const count = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.array.length; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}

const wingChunk = /* glsl */ `
  // the wing beats about the shoulder (x = 0.04); aWing = (angle, spread 0..1)
  float ax = abs(transformed.x);
  if (ax > 0.042) {
    float s = sign(transformed.x);
    float wo = (ax - 0.04) * mix(0.25, 1.0, aWing.y); // folded along the body on the ground
    transformed.x = s * (0.04 + wo * cos(aWing.x));
    transformed.y += wo * sin(aWing.x);
  }
`;

export const pigeonWing = wingChunk;

export class Pigeons {
  constructor(scene) {
    const geo = pigeonGeometry();
    this.wing = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aWing', this.wing);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aWing;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + wingChunk);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    // a little variety in the plumage
    const c = new THREE.Color();
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, c.setHSL(0.62 + Math.random() * 0.05, 0.06 + Math.random() * 0.08, 0.24 + Math.random() * 0.2));
    scene.add(this.mesh);
    this.birds = [];
    this.flocks = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._s = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._to = new THREE.Vector3();
    this._steer = new THREE.Vector3();
    this._avg = new THREE.Vector3();
    this.t = 0;
  }

  /** homes: [{x, z}] open places for flocks; heightAt(x, z). */
  populate(homes, heightAt, perFlock = 12) {
    this.heightAt = heightAt;
    this.birds = [];
    this.flocks = [];
    for (const h of homes) {
      if (this.birds.length + perFlock > MAX) break;
      const flock = { home: { x: h.x, z: h.z }, state: 'ground', calm: 0, t: Math.random() * 10, dir: Math.random() < 0.5 ? 1 : -1 };
      this.flocks.push(flock);
      for (let i = 0; i < perFlock; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 3.5;
        const x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r;
        this.birds.push({
          flock, pos: new THREE.Vector3(x, heightAt(x, z), z), vel: new THREE.Vector3(), yaw: Math.random() * 6.3,
          air: false, peck: Math.random() * 5, phase: Math.random() * 6.3, walk: 0, land: null, bank: 0,
        });
      }
    }
    this.mesh.count = this.birds.length;
  }

  /** Something frightening at pos: every flock within `radius` takes off. */
  scare(pos, radius) {
    for (const f of this.flocks) {
      if (Math.hypot(f.home.x - pos.x, f.home.z - pos.z) > radius && !this.birds.some((b) => b.flock === f && b.pos.distanceTo(pos) < radius)) continue;
      f.calm = 0;
      if (f.state === 'air') continue;
      f.state = 'air';
      f.t = 0;
      let near = Infinity;
      for (const b of this.birds) {
        if (b.flock !== f) continue;
        b.air = true;
        b.land = null;
        // up and away from the fright, each a little differently
        const away = new THREE.Vector3(b.pos.x - pos.x, 0, b.pos.z - pos.z).normalize();
        b.vel.set(away.x * 3 + (Math.random() - 0.5) * 2, 4.5 + Math.random() * 2.5, away.z * 3 + (Math.random() - 0.5) * 2);
        near = Math.min(near, this.listener ? b.pos.distanceTo(this.listener) : 99);
      }
      this.onTakeoff?.(near);
    }
  }

  update(dt, { night = 0, fighters = [] } = {}) {
    if (!this.birds.length) return;
    this.t += dt;
    // they roost at night
    this.mesh.visible = night < 0.6;
    if (!this.mesh.visible) return;
    // anyone running through a flock on the ground puts it up
    const last = this.last || (this.last = new WeakMap());
    for (const p of fighters) {
      const was = last.get(p);
      const speed = was && dt > 0 ? Math.hypot(p.pos.x - was.x, p.pos.z - was.z) / dt : 0;
      if (was) was.set(p.pos.x, 0, p.pos.z); else last.set(p, new THREE.Vector3(p.pos.x, 0, p.pos.z));
      if (!p.alive || speed < 3 || speed > 60) continue;
      for (const f of this.flocks) {
        if (f.state === 'ground' && Math.hypot(p.pos.x - f.home.x, p.pos.z - f.home.z) < 6) this.scare(p.pos, 8);
      }
    }
    for (const f of this.flocks) {
      f.t += dt;
      if (f.state === 'air') {
        f.calm += dt;
        if (f.calm > 9) f.state = 'landing';
      }
    }
    const H = this.heightAt;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i], f = b.flock;
      if (b.air) this.fly(b, f, dt, H);
      else this.walk(b, f, dt, H);
      this.place(i, b);
    }
    for (const f of this.flocks) if (f.state === 'landing' && !this.birds.some((b) => b.flock === f && b.air)) f.state = 'ground';
    this.mesh.instanceMatrix.needsUpdate = true;
    this.wing.needsUpdate = true;
  }

  fly(b, f, dt, H) {
    const g = H(f.home.x, f.home.z);
    let tx, ty, tz;
    if (f.state === 'air') {
      // wheel round over home as a flock
      const w = 0.45 * f.dir, R = 14;
      tx = f.home.x + Math.cos(f.t * w) * R; tz = f.home.z + Math.sin(f.t * w) * R; ty = g + 14 + Math.sin(f.t * 0.7) * 3;
    } else {
      // glide down to a spot near home
      if (!b.land) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 3.5;
        b.land = { x: f.home.x + Math.cos(a) * r, z: f.home.z + Math.sin(a) * r };
        b.land.y = H(b.land.x, b.land.z);
      }
      tx = b.land.x; ty = b.land.y; tz = b.land.z;
    }
    const to = this._to.set(tx - b.pos.x, ty - b.pos.y, tz - b.pos.z);
    const d = to.length();
    const landing = f.state === 'landing';
    const want = landing ? Math.min(7, 1 + d * 0.8) : 9;
    const steer = this._steer.copy(to).multiplyScalar(want / Math.max(d, 1e-3)).sub(b.vel).multiplyScalar(landing ? 2.2 : 1.1);
    // keep apart from close neighbours, keep with the flock's heading
    const avg = this._avg.set(0, 0, 0);
    let n = 0;
    for (const o of this.birds) {
      if (o === b || o.flock !== f || !o.air) continue;
      const dx = b.pos.x - o.pos.x, dy = b.pos.y - o.pos.y, dz = b.pos.z - o.pos.z, q = dx * dx + dy * dy + dz * dz;
      if (q < 0.5 && q > 1e-6) { const k = 2.5 / q; steer.x += dx * k; steer.y += dy * k; steer.z += dz * k; }
      if (q < 25) { avg.add(o.vel); n++; }
    }
    if (n && !landing) steer.addScaledVector(avg.divideScalar(n).sub(b.vel), 0.6);
    const before = Math.atan2(b.vel.x, b.vel.z);
    b.vel.addScaledVector(steer, dt);
    if (b.vel.length() > 12) b.vel.setLength(12);
    b.pos.addScaledVector(b.vel, dt);
    const ground = H(b.pos.x, b.pos.z);
    if (b.pos.y < ground + 0.02) b.pos.y = ground + 0.02;
    const after = Math.atan2(b.vel.x, b.vel.z);
    const turn = Math.atan2(Math.sin(after - before), Math.cos(after - before)) / Math.max(dt, 1e-3);
    b.bank += (THREE.MathUtils.clamp(-turn * 0.5, -0.9, 0.9) - b.bank) * Math.min(1, dt * 5);
    b.yaw = after;
    // beat hard climbing and taking off, glide when sinking
    const climb = b.vel.y;
    const rate = climb > 0.5 || f.t < 1.2 ? 15 : landing ? 7 : 9;
    b.phase += dt * rate;
    b.flapAmp = climb < -1.5 && !landing ? 0.12 : landing && d < 3 ? 0.9 : 0.75;
    if (landing && d < 0.35) {
      b.air = false;
      b.vel.set(0, 0, 0);
      b.pos.set(tx, ty, tz);
    }
  }

  walk(b, f, dt, H) {
    b.peck -= dt;
    if (b.peck < 0) {
      // now and then a few steps somewhere else, never far from the flock's place
      b.peck = 1.5 + Math.random() * 4;
      const hx = f.home.x - b.pos.x, hz = f.home.z - b.pos.z;
      b.yaw = Math.hypot(hx, hz) > 4 ? Math.atan2(hx, hz) : b.yaw + (Math.random() - 0.5) * 2.5;
      b.walk = 0.5 + Math.random() * 1.2;
    }
    if (b.walk > 0) {
      b.walk -= dt;
      b.pos.x += Math.sin(b.yaw) * 0.35 * dt;
      b.pos.z += Math.cos(b.yaw) * 0.35 * dt;
      b.pos.y = H(b.pos.x, b.pos.z);
    }
    b.bank = 0;
    b.flapAmp = 0;
  }

  place(i, b) {
    let pitch = 0, bob = 0;
    if (b.air) {
      pitch = -Math.atan2(b.vel.y, Math.hypot(b.vel.x, b.vel.z)) * 0.6;
    } else {
      // pecking: the body tips forward in quick dips; walking: the head bobs
      const k = b.walk > 0 ? 0 : Math.max(0, Math.sin(this.t * 6 + b.phase * 3)) ** 6;
      pitch = 0.5 * k;
      bob = b.walk > 0 ? Math.abs(Math.sin(this.t * 14 + b.phase)) * 0.008 : 0;
    }
    this._e.set(pitch, b.yaw, b.bank);
    this._q.setFromEuler(this._e);
    const p = this._s.set(b.pos.x, b.pos.y + 0.05 + bob, b.pos.z);
    this._m.compose(p, this._q, this._one);
    this.mesh.setMatrixAt(i, this._m);
    const flap = b.air ? Math.sin(b.phase) * (b.flapAmp ?? 0.75) * 1.1 + 0.1 : 0;
    this.wing.setXY(i, flap, b.air ? 1 : 0);
  }
}
