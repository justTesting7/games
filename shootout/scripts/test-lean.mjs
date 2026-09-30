// Weight shift: accelerating forward tips the chest forward, braking sits it back,
// and a fast left turn banks the hips to the left.
import * as THREE from 'three';
import { Character } from '../src/game/character.js';

function rig() {
  const ch = new Character();
  const hips = new THREE.Bone(), spine = new THREE.Bone(), spine1 = new THREE.Bone(), head = new THREE.Bone();
  hips.position.y = 1; spine.position.y = 0.1; spine1.position.y = 0.15; head.position.y = 0.4;
  hips.add(spine); spine.add(spine1); spine1.add(head);
  ch.root.add(hips);
  ch.bones = { Hips: hips, Spine: spine, Spine1: spine1, Head: head };
  return ch;
}
const reset = (ch) => { for (const b of Object.values(ch.bones)) b.quaternion.identity(); ch.root.updateMatrixWorld(true); };
const chestLean = (ch) => {
  const a = ch.bones.Spine.getWorldPosition(new THREE.Vector3()), b = ch.bones.Head.getWorldPosition(new THREE.Vector3());
  return b.sub(a).normalize();
};
const dt = 1 / 60;

// accelerate from rest along +z (the body faces +z at yaw 0)
let ch = rig(), v = 0;
for (let i = 0; i < 20; i++) {
  v = Math.min(6, v + 12 * dt);
  ch.root.position.z += v * dt;
  ch.updateMotion(dt); reset(ch); ch.applyLean(dt, { onGround: true });
}
const fwd = chestLean(ch);
if (!(fwd.z > 0.05)) throw new Error(`chest should lead forward when accelerating (z ${fwd.z.toFixed(3)})`);

// brake hard from a run
for (let i = 0; i < 25; i++) {
  v = Math.max(0, v - 14 * dt);
  ch.root.position.z += v * dt;
  ch.updateMotion(dt); reset(ch); ch.applyLean(dt, { onGround: true });
}
const back = chestLean(ch);
if (!(back.z < -0.02)) throw new Error(`chest should sit back when braking (z ${back.z.toFixed(3)})`);

// run a left turn: +yaw turns left, the avatar's +x is her left
ch = rig();
let yaw = 0;
for (let i = 0; i < 40; i++) {
  yaw += 1.6 * dt;
  ch.root.rotation.y = yaw;
  ch.root.position.x += Math.sin(yaw) * 5 * dt;
  ch.root.position.z += Math.cos(yaw) * 5 * dt;
  ch.updateMotion(dt); reset(ch); ch.applyLean(dt, { onGround: true });
}
const bank = chestLean(ch);
const leftAxis = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
if (!(bank.dot(leftAxis) > 0.03)) throw new Error(`body should bank into a left turn (${bank.dot(leftAxis).toFixed(3)})`);

// aiming keeps the gun steady: most of the lean goes away
ch.aimWeight = 1; reset(ch); ch.applyLean(dt, { onGround: true });
if (Math.abs(chestLean(ch).dot(leftAxis)) > Math.abs(bank.dot(leftAxis)) * 0.4) throw new Error('aiming should damp the lean');
console.log('ok lean', fwd.z.toFixed(3), back.z.toFixed(3), bank.dot(leftAxis).toFixed(3));
