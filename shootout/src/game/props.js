import * as THREE from 'three';
import { loadGLTF, modelUrl } from '../engine/assets.js';
import { mulberry32 } from '../world/noise.js';

function mergedModel(gltf) {
  const group = new THREE.Group();
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const c = box.getCenter(new THREE.Vector3());
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld).translate(-c.x, -c.y, -c.z), o.material);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  });
  return { group, half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5) };
}

// Box rigid body with impulse-based contacts against the terrain.
class Body {
  constructor(object, half, mass) {
    this.object = object;
    this.half = half.clone();
    this.mass = mass;
    this.invMass = 1 / mass;
    const { x, y, z } = half;
    const k = mass / 3;
    this.invInertia = new THREE.Vector3(1 / (k * (y * y + z * z)), 1 / (k * (x * x + z * z)), 1 / (k * (x * x + y * y)));
    this.vel = new THREE.Vector3();
    this.ang = new THREE.Vector3();
    this.sleep = 0;
    this.awake = true;
    this.radius = Math.hypot(half.x, half.z);
  }

  get pos() { return this.object.position; }
  get quat() { return this.object.quaternion; }

  // World-space inverse inertia applied to a vector.
  applyInvInertia(v, out) {
    const q = this.quat;
    out.copy(v).applyQuaternion(tmpQ.copy(q).invert());
    out.multiply(this.invInertia);
    return out.applyQuaternion(q);
  }

  applyImpulse(j, point) {
    this.vel.addScaledVector(j, this.invMass);
    const r = tmpA.subVectors(point, this.pos);
    const t = tmpB.crossVectors(r, j);
    this.ang.add(this.applyInvInertia(t, tmpC));
    this.awake = true;
    this.sleep = 0;
  }

  step(dt, terrain) {
    if (!this.awake) return;
    this.vel.y -= 9.81 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const w = this.ang;
    const wl = w.length();
    if (wl > 1e-6) {
      tmpQ.setFromAxisAngle(tmpA.copy(w).divideScalar(wl), wl * dt);
      this.quat.premultiply(tmpQ).normalize();
    }
    let maxPen = 0;
    const n = terrain.normalAt(this.pos.x, this.pos.z, tmpN);
    for (let i = 0; i < 8; i++) {
      const c = corner.set(i & 1 ? this.half.x : -this.half.x, i & 2 ? this.half.y : -this.half.y, i & 4 ? this.half.z : -this.half.z)
        .applyQuaternion(this.quat).add(this.pos);
      const h = terrain.heightAt(c.x, c.z);
      const pen = (h - c.y) * n.y;
      if (pen <= 0) continue;
      maxPen = Math.max(maxPen, pen);
      const r = tmpR.subVectors(c, this.pos);
      const v = tmpV.crossVectors(this.ang, r).add(this.vel);
      const vn = v.dot(n);
      if (vn < 0) {
        const rn = tmpA.crossVectors(r, n);
        const k = this.invMass + n.dot(tmpB.crossVectors(this.applyInvInertia(rn, tmpC), r));
        const jn = (-(1 + 0.25) * vn) / k / 2;
        const vt = tmpD.copy(v).addScaledVector(n, -vn);
        const vtl = vt.length();
        const imp = tmpE.copy(n).multiplyScalar(jn);
        if (vtl > 1e-4) {
          const jt = Math.min(vtl / k / 2, jn * 0.6);
          imp.addScaledVector(vt, -jt / vtl);
        }
        this.vel.addScaledVector(imp, this.invMass);
        this.ang.add(this.applyInvInertia(tmpB.crossVectors(r, imp), tmpC));
      }
    }
    if (maxPen > 0) {
      this.pos.addScaledVector(n, maxPen * 0.8);
      this.vel.multiplyScalar(Math.exp(-dt * 1.5));
      this.ang.multiplyScalar(Math.exp(-dt * 3));
    }
    if (this.pos.y < -1) {
      this.vel.multiplyScalar(Math.exp(-dt * 3));
      this.ang.multiplyScalar(Math.exp(-dt * 2));
      this.vel.y += 12 * dt * Math.min(1, -this.pos.y);
    }
    if (this.vel.lengthSq() < 0.02 && this.ang.lengthSq() < 0.05 && maxPen > 0) {
      this.sleep += dt;
      if (this.sleep > 0.6) { this.awake = false; this.vel.set(0, 0, 0); this.ang.set(0, 0, 0); }
    } else this.sleep = 0;
  }

  // Ray against the oriented box; returns distance and world normal.
  raycast(o, d, maxDist) {
    const inv = tmpQ.copy(this.quat).invert();
    const lo = tmpA.subVectors(o, this.pos).applyQuaternion(inv);
    const ld = tmpB.copy(d).applyQuaternion(inv);
    let tmin = 0, tmax = maxDist, axis = -1, sign = 1;
    for (let k = 0; k < 3; k++) {
      const oc = lo.getComponent(k), dc = ld.getComponent(k), h = this.half.getComponent(k);
      if (Math.abs(dc) < 1e-8) { if (Math.abs(oc) > h) return null; continue; }
      let t1 = (-h - oc) / dc, t2 = (h - oc) / dc;
      let s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = k; sign = s; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (axis < 0) return null;
    const nrm = new THREE.Vector3().setComponent(axis, sign).applyQuaternion(this.quat);
    return { t: tmin, normal: nrm };
  }
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmpE = new THREE.Vector3();
const tmpN = new THREE.Vector3(), tmpR = new THREE.Vector3(), tmpV = new THREE.Vector3(), corner = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function targetFaceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#d9cfb8';
  g.fillRect(0, 0, 512, 512);
  const rings = ['#e9e1cc', '#1d1d1d', '#e9e1cc', '#1d1d1d', '#c2332a', '#e8b33a'];
  rings.forEach((col, i) => {
    g.beginPath();
    g.arc(256, 256, 250 - i * 42, 0, Math.PI * 2);
    g.fillStyle = col;
    g.fill();
  });
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(90,70,40,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 6, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Props {
  constructor(terrain, colliders) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.group = new THREE.Group();
    this.bodies = [];
    this.targets = [];
    this.hits = 0;
  }

  async load(progress) {
    const [barrel, crate] = await progress.task('Loading props', 2, () => Promise.all([
      loadGLTF(modelUrl('barrel_03')), loadGLTF(modelUrl('wooden_crate_01')),
    ]));
    this.barrel = mergedModel(barrel);
    this.crate = mergedModel(crate);
  }

  place(spawn, facing) {
    const t = this.terrain;
    const rand = mulberry32(777);
    const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const at = (f, r) => new THREE.Vector3(spawn.x, 0, spawn.z).addScaledVector(fwd, f).addScaledVector(right, r);

    const addBody = (model, p, mass, yaw, surface) => {
      const obj = model.group.clone();
      const h = t.heightAt(p.x, p.z);
      obj.position.set(p.x, h + model.half.y + 0.02, p.z);
      obj.rotation.y = yaw;
      this.group.add(obj);
      const b = new Body(obj, model.half, mass);
      b.surface = surface;
      this.bodies.push(b);
      return b;
    };

    // A little camp in front of the spawn, with a row of targets beyond it.
    for (let i = 0; i < 5; i++) addBody(this.barrel, at(7 + rand() * 3, -6 + i * 1.1 + rand() * 0.3), 18, rand() * 6, 'wood');
    for (let i = 0; i < 4; i++) {
      const b = addBody(this.crate, at(6 + rand() * 2, 4 + i * 1.2), 9, facing + rand() * 0.4, 'wood');
      if (i === 1) {
        const top = addBody(this.crate, at(6.2, 5.2), 9, facing + 0.3, 'wood');
        top.pos.y = b.pos.y + this.crate.half.y * 2 + 0.02;
      }
    }
    for (let i = 0; i < 20; i++) {
      const a = rand() * Math.PI * 2, d = 25 + rand() * 120;
      const p = new THREE.Vector3(spawn.x + Math.cos(a) * d, 0, spawn.z + Math.sin(a) * d);
      if (t.heightAt(p.x, p.z) < 0.5) continue;
      addBody(rand() < 0.5 ? this.barrel : this.crate, p, 12, rand() * 6, 'wood');
    }

    const face = targetFaceTexture();
    const faceMat = new THREE.MeshStandardMaterial({ map: face, roughness: 0.85 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.85 });
    [[14, -3], [18, 1.5], [23, -1], [29, 4], [36, -4], [45, 0]].forEach(([f, r]) => {
      const p = at(f, r);
      const h = t.heightAt(p.x, p.z);
      const root = new THREE.Group();
      root.position.set(p.x, h, p.z);
      root.rotation.y = facing + Math.PI;
      const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.3, 0.07), woodMat);
      post1.position.set(-0.32, 0.55, 0);
      const post2 = post1.clone();
      post2.position.x = 0.32;
      const hinge = new THREE.Group();
      hinge.position.y = 0.75;
      const board = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 40).rotateX(Math.PI / 2), [sideMat, faceMat, faceMat]);
      board.position.y = 0.36;
      hinge.add(board);
      root.add(post1, post2, hinge);
      root.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      this.group.add(root);
      root.updateMatrixWorld(true);
      this.targets.push({ root, hinge, board, down: 0, angle: 0, vel: 0 });
      this.colliders.add({ x: p.x, z: p.z, r: 0.12, y0: h, y1: h + 0.7, type: 'wood' });
    });
  }

  // Nearest hit among props and target boards.
  raycast(o, d, maxDist) {
    let best = null;
    for (const b of this.bodies) {
      const dx = b.pos.x - o.x, dz = b.pos.z - o.z;
      const along = dx * d.x + dz * d.z;
      if (along < -2 || along > maxDist + 2) continue;
      // and the ray must pass within the body's reach (in plan)
      const a2 = d.x * d.x + d.z * d.z, reach = b.half.length() + 0.1;
      if (a2 > 1e-8) {
        const tc = Math.max(0, along / a2), ex = dx - d.x * tc, ez = dz - d.z * tc;
        if (ex * ex + ez * ez > reach * reach) continue;
      }
      const r = b.raycast(o, d, best ? best.t : maxDist);
      if (r && (!best || r.t < best.t)) best = { ...r, body: b, surface: b.surface };
    }
    for (const tg of this.targets) {
      if (tg.down > 0) continue;
      const m = tg.board.matrixWorld;
      const c = new THREE.Vector3().setFromMatrixPosition(m);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
      const denom = d.dot(n);
      if (Math.abs(denom) < 1e-5) continue;
      const tt = c.clone().sub(o).dot(n) / denom;
      if (tt < 0 || (best && tt >= best.t) || tt > maxDist) continue;
      const p = o.clone().addScaledVector(d, tt);
      const rr = p.distanceTo(c);
      if (rr > 0.32) continue;
      best = { t: tt, normal: denom < 0 ? n : n.negate(), target: tg, surface: 'target', ring: rr };
    }
    return best;
  }

  hit(result, point, dir, force = 4.5) {
    if (result.body) {
      result.body.applyImpulse(dir.clone().multiplyScalar(force), point);
    } else if (result.target) {
      const tg = result.target;
      tg.down = 5;
      tg.vel = -9;
      this.hits++;
      return true;
    }
    return false;
  }

  // Throws nearby props away from an explosion and knocks targets down.
  blast(pos, radius, strength) {
    for (const b of this.bodies) {
      const d = b.pos.clone().sub(pos);
      const dist = d.length();
      if (dist > radius) continue;
      const k = 1 - dist / radius;
      d.y = Math.abs(d.y) + 0.6;
      d.normalize();
      const at = b.pos.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.15));
      b.applyImpulse(d.multiplyScalar(strength * k * 8), at);
    }
    for (const tg of this.targets) {
      if (tg.down > 0) continue;
      const c = new THREE.Vector3().setFromMatrixPosition(tg.board.matrixWorld);
      if (c.distanceTo(pos) < radius * 0.6) { tg.down = 5; tg.vel = -9; }
    }
  }

  // Keeps the player out of props and lets her shove them a little.
  collidePlayer(pos, radius, vel, standH = 1.7) {
    for (const b of this.bodies) {
      const dx = pos.x - b.pos.x, dz = pos.z - b.pos.z;
      const r = radius + b.radius * 0.85;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r || pos.y > b.pos.y + b.half.y + 0.3 || pos.y + standH < b.pos.y - b.half.y) continue;
      const d = Math.sqrt(d2) || 1e-4;
      pos.x = b.pos.x + (dx / d) * r;
      pos.z = b.pos.z + (dz / d) * r;
      const push = -(vel.x * dx + vel.z * dz) / d;
      if (push > 0.5) b.applyImpulse(new THREE.Vector3(-dx / d, 0.05, -dz / d).multiplyScalar(push * 0.8), b.pos.clone().setY(b.pos.y + 0.1));
    }
  }

  update(dt) {
    const steps = 3;
    for (let s = 0; s < steps; s++) for (const b of this.bodies) b.step(dt / steps, this.terrain);
    for (const tg of this.targets) {
      if (tg.down > 0) {
        tg.down -= dt;
        tg.vel += -30 * dt;
        tg.angle = Math.max(-Math.PI / 2, tg.angle + tg.vel * dt);
        if (tg.angle <= -Math.PI / 2) tg.vel = Math.abs(tg.vel) * 0.3 > 0.6 ? Math.abs(tg.vel) * 0.3 : 0;
        if (tg.down <= 0) tg.vel = 0;
      } else if (tg.angle < 0) {
        tg.angle = Math.min(0, tg.angle + dt * 3);
      }
      tg.hinge.rotation.x = tg.angle;
      tg.root.updateMatrixWorld(true);
    }
  }
}
