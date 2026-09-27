import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const src = readFileSync(new URL('../src/game/character.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../src/game/player.js', import.meta.url), 'utf8');
const start = src.indexOf('Take a knee');
if (start < 0) throw new Error('missing applyCrouch');
const fn = src.slice(start, src.indexOf('applySwim', start));

if (fn.includes('drape one arm over a foot') || fn.includes('Kneel on both knees')) {
  throw new Error('old both-knees sit is still in applyCrouch');
}
if (!fn.includes('Take a knee') && !fn.includes('planted left foot')) {
  throw new Error('crouch should be a one-knee kneel');
}
if (!fn.includes("solveArm(B, 'Left'") || !fn.includes("solveArm(B, 'Right'")) {
  throw new Error('both hands should rest on the raised knee');
}
if (!fn.includes('this.aimWeight > 0.2')) {
  throw new Error('aiming should still raise the guns');
}

// Keep the live overlay angles in lockstep with the geometric kneel below.
for (const needle of [
  'B.Hips.position.y -= 0.45 * k',
  'turn(B.LeftUpLeg, right, 1.50 * k)',
  'turn(B.LeftLeg, right, -1.38 * k)',
  'turn(B.RightUpLeg, right, 0.20 * k)',
  'turn(B.RightLeg, right, -1.75 * k)',
]) {
  if (!fn.includes(needle)) throw new Error(`applyCrouch missing ${needle}`);
}

if (!player.includes('this.crouchT * 0.50')) {
  throw new Error('capsule height should match the upright kneel');
}
if (!player.includes('crouch * 0.38') || !player.includes('this.crouchT * 0.38')) {
  throw new Error('camera / eye height should match the upright kneel');
}

function rotateBoneWorld(bone, q) {
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  wq.premultiply(q);
  bone.quaternion.copy(pq.invert().multiply(wq));
  bone.updateMatrixWorld(true);
}

function bone(name, parent, x, y, z) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

function poseAt(k) {
  const root = new THREE.Group();
  const Hips = bone('Hips', root, 0, 0.95, 0);
  const Spine = bone('Spine', Hips, 0, 0.12, 0);
  const Spine1 = bone('Spine1', Spine, 0, 0.14, 0);
  const Spine2 = bone('Spine2', Spine1, 0, 0.14, 0);
  const Neck = bone('Neck', Spine2, 0, 0.12, 0);
  const Head = bone('Head', Neck, 0, 0.14, 0);
  const LeftUpLeg = bone('LeftUpLeg', Hips, 0.1, 0, 0);
  const LeftLeg = bone('LeftLeg', LeftUpLeg, 0, -0.45, 0);
  const LeftFoot = bone('LeftFoot', LeftLeg, 0, -0.43, 0);
  const RightUpLeg = bone('RightUpLeg', Hips, -0.1, 0, 0);
  const RightLeg = bone('RightLeg', RightUpLeg, 0, -0.45, 0);
  const RightFoot = bone('RightFoot', RightLeg, 0, -0.43, 0);
  root.updateMatrixWorld(true);

  const fwd = new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3(-1, 0, 0);
  const turn = (node, axis, ang) => {
    if (Math.abs(ang) < 1e-4) return;
    rotateBoneWorld(node, new THREE.Quaternion().setFromAxisAngle(axis, ang));
  };

  Hips.position.y -= 0.45 * k;
  Hips.updateMatrixWorld(true);
  turn(Hips, right, 0.02 * k);
  turn(LeftUpLeg, right, 1.50 * k);
  turn(LeftUpLeg, fwd, -0.08 * k);
  turn(LeftLeg, right, -1.38 * k);
  turn(LeftFoot, right, 0.16 * k);
  turn(RightUpLeg, right, 0.20 * k);
  turn(RightUpLeg, fwd, 0.18 * k);
  turn(RightLeg, right, -1.75 * k);
  turn(RightFoot, right, 0.90 * k);
  turn(Spine, right, -0.08 * k);
  turn(Spine1, right, 0.03 * k);

  const at = (node) => node.getWorldPosition(new THREE.Vector3());
  return {
    hips: at(Hips),
    head: at(Head),
    leftKnee: at(LeftLeg),
    leftFoot: at(LeftFoot),
    rightKnee: at(RightLeg),
    rightFoot: at(RightFoot),
  };
}

const p = poseAt(1);
if (p.head.y < 1.05) throw new Error(`chest collapsed, head y=${p.head.y}`);
if (p.hips.y < 0.4) throw new Error(`sitting on the heels, hips y=${p.hips.y}`);
if (p.leftKnee.y < p.rightKnee.y + 0.25) {
  throw new Error(`need one raised knee, left=${p.leftKnee.y} right=${p.rightKnee.y}`);
}
if (p.leftFoot.y < -0.02 || p.leftFoot.y > 0.14) {
  throw new Error(`planted foot should meet the floor, y=${p.leftFoot.y}`);
}
if (p.rightKnee.y < -0.02 || p.rightKnee.y > 0.16) {
  throw new Error(`down knee should meet the floor, y=${p.rightKnee.y}`);
}
if (p.leftFoot.z < 0.25) throw new Error(`planted foot should be in front, z=${p.leftFoot.z}`);
if (p.rightFoot.z > 0) throw new Error(`down-knee foot should trail behind, z=${p.rightFoot.z}`);

const rest = poseAt(0);
if (Math.abs(rest.head.y - 1.61) > 0.08) throw new Error(`standing overlay should be a no-op, head y=${rest.head.y}`);

console.log('crouch pose ok');
