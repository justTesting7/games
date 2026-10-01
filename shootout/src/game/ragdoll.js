import * as THREE from 'three';

// A Verlet ragdoll for deaths. Fifteen particles sit on the joints of the posed skeleton
// at the moment of death, tied by distance constraints (the bone lengths, plus braces
// that keep the torso and pelvis rigid). Gravity, the ground and walls act on the
// particles; every frame the skeleton is posed back from them: the pelvis and chest take
// their orientation from the torso's particle frame, and each limb bone swings to point
// at its child joint.

const JOINTS = ['Hips', 'Spine2', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm',
  'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const J = Object.fromEntries(JOINTS.map((n, i) => [n, i]));
const LINKS = [
  // spine and head
  ['Hips', 'Spine2'], ['Spine2', 'Head'],
  // shoulders and pelvis, braced into rigid boxes
  ['Spine2', 'LeftArm'], ['Spine2', 'RightArm'], ['LeftArm', 'RightArm'],
  ['Hips', 'LeftUpLeg'], ['Hips', 'RightUpLeg'], ['LeftUpLeg', 'RightUpLeg'],
  ['LeftArm', 'Hips'], ['RightArm', 'Hips'], ['LeftUpLeg', 'Spine2'], ['RightUpLeg', 'Spine2'],
  ['LeftArm', 'RightUpLeg'], ['RightArm', 'LeftUpLeg'], ['Head', 'LeftArm'], ['Head', 'RightArm'],
  // limbs
  ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
  ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'],
].map(([a, b]) => [J[a], J[b]]);
// joints may bend but not fold flat: hand to shoulder and foot to hip keep a minimum reach
const REACH = [['LeftArm', 'LeftHand', 0.45], ['RightArm', 'RightHand', 0.45], ['LeftUpLeg', 'LeftFoot', 0.55],
  ['RightUpLeg', 'RightFoot', 0.55], ['Spine2', 'LeftForeArm', 0.5], ['Spine2', 'RightForeArm', 0.5]]
  .map(([a, b, k]) => [J[a], J[b], k]);
// the limb chains the skeleton is swung along: [bone, joint it points at]
const SWING = [['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm'],
  ['RightForeArm', 'RightHand'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot']];

const RADIUS = 0.07;
const GRAVITY = 9.8;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

/** Orthonormal frame from an "up" direction and a "left" direction, as a quaternion. */
function frame(up, left, out) {
  const y = _a.copy(up).normalize();
  const x = _b.copy(left).addScaledVector(y, -left.dot(y)).normalize();
  const z = _c.crossVectors(x, y);
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

export class Ragdoll {
  /**
   * character: a posed Character. vel: its velocity at death. push: the killing blow
   * (a direction scaled to a speed in m/s). physics: { heightAt(x, z), resolve(p, r, near), near?(p) }.
   */
  constructor(character, vel, push, physics) {
    this.ch = character;
    this.physics = physics;
    const B = character.bones;
    this.p = JOINTS.map((n) => B[n].getWorldPosition(new THREE.Vector3()));
    this.prev = this.p.map((p) => p.clone());
    this.rest = LINKS.map(([a, b]) => this.p[a].distanceTo(this.p[b]));
    this.reach = REACH.map(([a, b, k]) => this.p[a].distanceTo(this.p[b]) * k);
    // start moving: the body's own motion, and the blow (strongest on the upper body)
    const dt = 1 / 60;
    this.p.forEach((p, i) => {
      const upper = i <= J.RightHand ? 1 : 0.45;
      this.prev[i].addScaledVector(vel, -dt).addScaledVector(push, -dt * upper);
    });
    // rest frames of the pelvis and chest, to carry their orientation over from the particles
    this.hips0 = B.Hips.getWorldQuaternion(new THREE.Quaternion());
    this.chest0 = B.Spine2.getWorldQuaternion(new THREE.Quaternion());
    this.hipsF0 = this.hipsFrame(new THREE.Quaternion());
    this.chestF0 = this.chestFrame(new THREE.Quaternion());
    this.t = 0;
    this.sleep = 0;
  }

  /** A shove at a world point: the joints near it (within ~0.6 m) take most of it. */
  kick(at, impulse) {
    this.sleep = 0;
    const dt = 1 / 60;
    for (let i = 0; i < this.p.length; i++) {
      const d = this.p[i].distanceTo(at);
      const k = Math.max(0.15, 1 - d / 0.6);
      this.prev[i].addScaledVector(impulse, -dt * k);
    }
  }

  hipsFrame(out) {
    const p = this.p;
    return frame(_c.subVectors(p[J.Spine2], p[J.Hips]).clone(), p[J.LeftUpLeg].clone().sub(p[J.RightUpLeg]), out);
  }

  chestFrame(out) {
    const p = this.p;
    return frame(_c.subVectors(p[J.Head], p[J.Spine2]).clone(), p[J.LeftArm].clone().sub(p[J.RightArm]), out);
  }

  step(dt) {
    if (this.sleep > 1.5) return false;
    const h = Math.min(dt, 1 / 30);
    this.t += h;
    const { heightAt, resolve } = this.physics;
    const near = this.physics.near?.(this.p[0]); // what's close enough to touch, once a step
    let motion = 0;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i], q = this.prev[i];
      const vx = (p.x - q.x) * 0.995, vy = (p.y - q.y) * 0.995, vz = (p.z - q.z) * 0.995;
      q.copy(p);
      p.x += vx; p.y += vy - GRAVITY * h * h; p.z += vz;
      motion += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
    }
    for (let it = 0; it < 8; it++) {
      for (let k = 0; k < LINKS.length; k++) {
        const [a, b] = LINKS[k];
        this.solve(a, b, this.rest[k], 0);
      }
      for (let k = 0; k < REACH.length; k++) {
        const [a, b] = REACH[k];
        this.solve(a, b, this.reach[k], 1);
      }
      for (let i = 0; i < this.p.length; i++) {
        const p = this.p[i], q = this.prev[i];
        if (resolve) {
          // pushed out of a wall or a car: move the last position along too, or the push
          // itself would turn into speed and fling the body
          const bx = p.x, by = p.y, bz = p.z;
          resolve(p, RADIUS, near);
          q.x += (p.x - bx) * 0.85; q.y += (p.y - by) * 0.85; q.z += (p.z - bz) * 0.85;
          // lifted onto something (a car's roof or bonnet): it grips like the ground does
          if (p.y - by > 1e-4) { q.x += (p.x - q.x) * 0.5; q.z += (p.z - q.z) * 0.5; }
        }
        const g = heightAt(p.x, p.z) + RADIUS;
        if (p.y < g) {
          p.y = g;
          // ground friction: drag the stored motion toward rest along the ground
          q.x += (p.x - q.x) * 0.6;
          q.z += (p.z - q.z) * 0.6;
          if (q.y < p.y - 0.02) q.y = p.y - (p.y - q.y) * 0.3; // soak the landing
        }
      }
    }
    this.sleep = motion < 0.004 * this.p.length ? this.sleep + h : 0;
    return true;
  }

  // mode 0: hold the distance; mode 1: only push apart below it
  solve(a, b, len, mode) {
    const pa = this.p[a], pb = this.p[b];
    const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    if (mode === 1 && d >= len) return;
    const k = ((d - len) / d) * 0.5;
    pa.x += dx * k; pa.y += dy * k; pa.z += dz * k;
    pb.x -= dx * k; pb.y -= dy * k; pb.z -= dz * k;
  }

  /** Poses the skeleton from the particles. rotateBoneWorld / rotateBoneToward are Character's helpers. */
  apply(rotateBoneWorld, rotateBoneToward, tmp) {
    const B = this.ch.bones, root = this.ch.root;
    root.updateMatrixWorld(true);
    // pelvis: its rest orientation carried by the change in the pelvis frame
    const hf = this.hipsFrame(_q);
    const want = _q2.copy(hf).multiply(this.hipsF0.clone().invert()).multiply(this.hips0);
    rotateBoneWorld(B.Hips, want.multiply(B.Hips.getWorldQuaternion(new THREE.Quaternion()).invert()), tmp);
    // chest the same way
    const cf = this.chestFrame(new THREE.Quaternion());
    const wantC = cf.multiply(this.chestF0.clone().invert()).multiply(this.chest0);
    rotateBoneWorld(B.Spine2, wantC.multiply(B.Spine2.getWorldQuaternion(new THREE.Quaternion()).invert()), tmp);
    // put the pelvis on its particle
    const at = B.Hips.getWorldPosition(new THREE.Vector3());
    root.position.add(at.sub(this.p[J.Hips]).negate());
    root.updateMatrixWorld(true);
    for (const [bone, joint] of SWING) {
      const b = B[bone];
      const from = b.getWorldPosition(new THREE.Vector3());
      const dir = this.p[J[joint]].clone().sub(from);
      if (dir.lengthSq() < 1e-8) continue;
      rotateBoneToward(b, B[joint], dir.normalize(), 1, tmp);
    }
    // head looks along the neck
    const neck = this.p[J.Head].clone().sub(this.p[J.Spine2]).normalize();
    if (B.Neck && B.Head) rotateBoneToward(B.Neck, B.Head, neck, 0.7, tmp);
  }
}
