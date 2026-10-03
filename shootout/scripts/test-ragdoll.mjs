// A ragdoll falls onto the ground, keeps its bone lengths, and comes to rest.
import * as THREE from 'three';
import { Ragdoll } from '../src/game/ragdoll.js';

const bones = {};
const root = new THREE.Group();
const put = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); (parent ? bones[parent] : root).add(b); bones[name] = b; };
put('Hips', null, 0, 1, 0); put('Spine2', 'Hips', 0, 0.35, 0); put('Neck', 'Spine2', 0, 0.2, 0); put('Head', 'Neck', 0, 0.1, 0);
put('LeftArm', 'Spine2', 0.2, 0.1, 0); put('LeftForeArm', 'LeftArm', 0, -0.28, 0); put('LeftHand', 'LeftForeArm', 0, -0.25, 0);
put('RightArm', 'Spine2', -0.2, 0.1, 0); put('RightForeArm', 'RightArm', 0, -0.28, 0); put('RightHand', 'RightForeArm', 0, -0.25, 0);
put('LeftUpLeg', 'Hips', 0.1, -0.05, 0); put('LeftLeg', 'LeftUpLeg', 0, -0.45, 0); put('LeftFoot', 'LeftLeg', 0, -0.42, 0);
put('RightUpLeg', 'Hips', -0.1, -0.05, 0); put('RightLeg', 'RightUpLeg', 0, -0.45, 0); put('RightFoot', 'RightLeg', 0, -0.42, 0);
root.updateMatrixWorld(true);
const ch = { bones, root };
const rd = new Ragdoll(ch, new THREE.Vector3(), new THREE.Vector3(0, 0.5, 3), { heightAt: () => 0 });
const len0 = rd.p[0].distanceTo(rd.p[1]);
for (let i = 0; i < 360; i++) rd.step(1 / 60);
const top = Math.max(...rd.p.map((p) => p.y));
if (top > 0.45) throw new Error(`after 6 s the body should lie on the ground (highest joint ${top.toFixed(2)} m)`);
if (Math.min(...rd.p.map((p) => p.y)) < 0.04) throw new Error('no joint sinks into the ground');
// the trunk lies on its thickness: the head and chest well off the ground
if (rd.p[2].y < 0.1 || rd.p[1].y < 0.12) throw new Error('the head and chest rest on their thickness');
// a kerb under the edge of the head holds it up
const kerb = new Ragdoll(ch, new THREE.Vector3(), new THREE.Vector3(0, 0.5, 3), { heightAt: (x, z) => (z > 1.2 ? 0.15 : 0) });
for (let i = 0; i < 360; i++) kerb.step(1 / 60);
for (const p of kerb.p) if (p.z > 1.2 - 0.04 && p.y < 0.15 + 0.04) throw new Error('a joint over the kerb rests on it');
if (Math.abs(rd.p[0].distanceTo(rd.p[1]) - len0) > 0.03) throw new Error('the spine keeps its length');
if (rd.p[0].z < 0.2) throw new Error('the blow knocks the body back along +z');
if (rd.sleep <= 0) throw new Error('the body comes to rest');
console.log('ok ragdoll');
