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
  ['RightUpLeg', 'RightFoot', 0.55], ['Spine2', 'LeftForeArm', 0.5], ['Spine2', 'RightForeArm', 0.5],
  // a hip bends only so far: the knees and feet keep off the chest (the legs folded up into it)
  ['Spine2', 'LeftLeg', 0.8], ['Spine2', 'RightLeg', 0.8], ['Spine2', 'LeftFoot', 0.65], ['Spine2', 'RightFoot', 0.65]]
  .map(([a, b, k]) => [J[a], J[b], k]);
// the limb chains the skeleton is swung along: [bone, joint it points at]
const SWING = [['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm'],
  ['RightForeArm', 'RightHand'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot']];

const RADIUS = 0.07;
// the trunk: kept close to its shape at death (a spine bends and twists a little, it doesn't
// corkscrew: braces alone let the hips turn 90 degrees from the chest)
const TRUNK = ['Hips', 'Spine2', 'Head', 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg'].map((n) => J[n]);
const TRUNK_HOLD = 0.35;
// how thick the body is round each joint: a head or a chest lying on the ground holds the
// joint well off it (with one radius for all, a body face down sank into the street)
const THICK = JOINTS.map((n) => (n === 'Head' ? 0.11 : n === 'Spine2' ? 0.13 : n === 'Hips' ? 0.11
  : /UpLeg$/.test(n) ? 0.08 : /Arm$/.test(n) ? 0.06 : /Leg$/.test(n) ? 0.06 : 0.045));
// velocity kept per step: the trunk carries on, the extremities trail
const LIMP = JOINTS.map((n) => (/Hand$/.test(n) ? 0.94 : /ForeArm$|Foot$/.test(n) ? 0.965 : /Arm$|Leg$/.test(n) ? 0.985 : 0.995));
// ground grip: limbs drag on the ground more than the trunk slides
const GRIP = JOINTS.map((n) => (/Hand$|ForeArm$/.test(n) ? 0.85 : /Foot$/.test(n) ? 0.6 : /Leg$/.test(n) ? 0.45 : 0.6));
// a dead body's weight is in its hips: once it's going down they sag to the ground, so legs
// folded under slide out instead of propping it up kneeling, backside in the air
const SAG = JOINTS.map((n) => (n === 'Hips' ? 9 : /UpLeg$/.test(n) ? 6 : 0));
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
    // the legs give way: the hips drop and the knees buckle forward, so a body folds as it
    // goes down instead of toppling like a plank (forward: where the body faces)
    const fwd = _a.set(0, 0, 1).applyQuaternion(character.root.quaternion).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    // which way it topples: with the blow if there was one, else forward
    this.fall = push.clone().setY(0);
    if (this.fall.lengthSq() < 0.25) this.fall.copy(fwd);
    this.fall.normalize();
    const drop = (i, down, ahead) => { this.prev[i].y += down * dt; this.prev[i].addScaledVector(fwd, -ahead * dt); };
    drop(J.Hips, 1.6, 0); drop(J.Spine2, 1.2, 0);
    drop(J.LeftLeg, 0.4, 0.6 + Math.random() * 0.4); drop(J.RightLeg, 0.4, 0.5 + Math.random() * 0.4);
    drop(J.LeftUpLeg, 1.2, 0.2); drop(J.RightUpLeg, 1.2, 0.2);
    // rest frames of the pelvis and chest, to carry their orientation over from the particles
    this.hips0 = B.Hips.getWorldQuaternion(new THREE.Quaternion());
    this.chest0 = B.Spine2.getWorldQuaternion(new THREE.Quaternion());
    this.hipsF0 = this.hipsFrame(new THREE.Quaternion());
    this.chestF0 = this.chestFrame(new THREE.Quaternion());
    // the trunk's shape, in its own frame
    const f0 = this.trunkFrame(new THREE.Quaternion(), this._c0 = new THREE.Vector3());
    const inv = f0.clone().invert();
    this.trunkRest = TRUNK.map((i) => this.p[i].clone().sub(this._c0).applyQuaternion(inv));
    this.t = 0;
    this.sleep = 0;
  }

  /** The trunk's frame (up the spine, across the shoulders and hips) and its centre. */
  trunkFrame(out, centre) {
    const p = this.p;
    centre.set(0, 0, 0);
    for (const i of TRUNK) centre.add(p[i]);
    centre.multiplyScalar(1 / TRUNK.length);
    const up = (this._up || (this._up = new THREE.Vector3())).subVectors(p[J.Spine2], p[J.Hips]);
    const left = (this._left || (this._left = new THREE.Vector3())).subVectors(p[J.LeftArm], p[J.RightArm]).add(p[J.LeftUpLeg]).sub(p[J.RightUpLeg]);
    return frame(up, left, out);
  }

  holdTrunk() {
    const c = this._c || (this._c = new THREE.Vector3()), q = this.trunkFrame(this._tq || (this._tq = new THREE.Quaternion()), c);
    const t = _b;
    for (let k = 0; k < TRUNK.length; k++) {
      const p = this.p[TRUNK[k]];
      t.copy(this.trunkRest[k]).applyQuaternion(q).add(c);
      p.x += (t.x - p.x) * TRUNK_HOLD; p.y += (t.y - p.y) * TRUNK_HOLD; p.z += (t.z - p.z) * TRUNK_HOLD;
    }
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
    const floor = this.floor || (this.floor = new Float32Array(this.p.length));
    // a body never comes to rest kneeling or sitting up: while the chest stands well above
    // the hips the upper body is tipped over (it would balance on its knees otherwise)
    const P = this.p, upright = P[J.Spine2].y - P[J.Hips].y;
    if (upright > 0.12) {
      const a = (4 + 6 * Math.min(1, (upright - 0.12) / 0.3)) * h * h;
      for (const i of [J.Spine2, J.Head, J.LeftArm, J.RightArm]) { P[i].x += this.fall.x * a; P[i].z += this.fall.z * a; }
      motion += 1; // not asleep while it's still going over
    }
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i], q = this.prev[i];
      // limp limbs: hands and forearms (and feet) lose their swing fast, so a blow doesn't
      // fling the arms over the head; the trunk keeps its momentum
      const keep = LIMP[i];
      const vx = (p.x - q.x) * keep, vy = (p.y - q.y) * keep, vz = (p.z - q.z) * keep;
      q.copy(p);
      p.x += vx; p.y += vy - (GRAVITY + (this.t > 0.25 ? SAG[i] : 0)) * h * h; p.z += vz;
      motion += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
      // the ground under the whole width of the joint, not just its centre: a head over the
      // edge of a kerb rests on the kerb instead of sinking into it
      const r = THICK[i];
      floor[i] = Math.max(heightAt(p.x, p.z), heightAt(p.x + r, p.z), heightAt(p.x - r, p.z), heightAt(p.x, p.z + r), heightAt(p.x, p.z - r)) + r;
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
      this.holdTrunk();
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
        const g = floor[i];
        if (p.y < g) {
          p.y = g;
          // ground friction: drag the stored motion toward rest along the ground
          q.x += (p.x - q.x) * GRIP[i];
          q.z += (p.z - q.z) * GRIP[i];
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
