// Bullets hit bone capsules: an arm held out to the side is hit where it is, a shot
// just past the arm misses, the torso still counts as body and limbs are marked.
import * as THREE from 'three';
import { Combat, rayCapsule } from '../src/game/combat.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
if (Math.abs(rayCapsule(V(0, 1, -5), V(0, 0, 1), V(-1, 1, 0), V(1, 1, 0), 0.1) - 4.9) > 1e-6) throw new Error('ray across a capsule hits its side');
if (Math.abs(rayCapsule(V(1.5, 1, 0), V(-1, 0, 0), V(-1, 1, 0), V(1, 1, 0), 0.1) - 0.4) > 1e-6) throw new Error('ray along the axis hits the rounded end');
if (rayCapsule(V(0, 1.2, -5), V(0, 0, 1), V(-1, 1, 0), V(1, 1, 0), 0.1) !== null) throw new Error('a ray 0.2 m off the axis misses');

// a T-posed fighter at the origin facing +z: arms along x at shoulder height
const bones = {};
const put = (name, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.updateMatrixWorld(true); bones[name] = o; };
put('Hips', 0, 1.0, 0); put('Spine2', 0, 1.35, 0); put('Neck', 0, 1.55, 0); put('Head', 0, 1.65, 0);
put('LeftArm', 0.2, 1.45, 0); put('LeftForeArm', 0.5, 1.45, 0); put('LeftHand', 0.75, 1.45, 0);
put('RightArm', -0.2, 1.45, 0); put('RightForeArm', -0.5, 1.45, 0); put('RightHand', -0.75, 1.45, 0);
put('LeftUpLeg', 0.1, 0.95, 0); put('LeftLeg', 0.1, 0.5, 0); put('LeftFoot', 0.1, 0.08, 0);
put('RightUpLeg', -0.1, 0.95, 0); put('RightLeg', -0.1, 0.5, 0); put('RightFoot', -0.1, 0.08, 0);
const combat = new Combat();
const f = combat.add({ id: 'x', name: 'x', character: { bones }, pos: V(0, 0, 0) });
f.head.set(0, 1.71, 0);
const shot = (x, y) => combat.raycast(V(x, y, -10), V(0, 0, 1), 50, null);
const fore = shot(0.62, 1.45);
if (!fore?.fighter || !fore.limb || fore.part !== 'LeftForeArm') throw new Error('a shot at the outstretched forearm hits it as a limb');
if (shot(0.62, 1.58)) throw new Error('a shot just above the arm misses (the old body cylinder never reached out there anyway)');
const chest = shot(0.05, 1.3);
if (!chest?.fighter || chest.limb || chest.head) throw new Error('a chest shot is a body hit');
if (!shot(0, 1.71)?.head) throw new Error('head sphere still counts');
const shin = shot(0.1, 0.3);
if (!shin?.limb || shin.part !== 'LeftLeg') throw new Error('shin shot hits the shin');
console.log('ok hitboxes');
