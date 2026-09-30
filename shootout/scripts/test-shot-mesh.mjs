// Bullets on the city maps trace the real triangles: a round clears a low wall it
// is fired over, stops in the wall below its top edge, ignores leaves, and passes
// through a doorway cut out of the stadium glass.
import * as THREE from 'three';
import { buildShotMesh } from '../src/world/shotMesh.js';

const root = new THREE.Group();
const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 0.3), new THREE.MeshBasicMaterial());
wall.name = 'parapet';
wall.position.set(0, 0.5, 5);
const leaves = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.3), new THREE.MeshBasicMaterial());
leaves.name = 'leaves';
leaves.position.set(0, 2, 8);
const glass = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 0.2), new THREE.MeshBasicMaterial());
glass.name = 'facade_glass_0';
glass.position.set(0, 3, 12);
root.add(wall, leaves, glass);
const doors = [{ x: 5, z: 12, rx: 0, rz: 1, w: 2, depth: 2, h: 3.5 }];
const shots = buildShotMesh([root], { doors, doorMesh: 'facade_glass_0' });
const fwd = new THREE.Vector3(0, 0, 1);

const over = shots.raycast(new THREE.Vector3(0, 1.4, 0), fwd, 11);
if (over) throw new Error(`a round 40 cm above the low wall must clear it (hit at ${over.t.toFixed(2)})`);
const into = shots.raycast(new THREE.Vector3(0, 0.7, 0), fwd, 11);
if (!into || Math.abs(into.t - 4.85) > 0.02) throw new Error('a round below the top edge must stop in the wall face');
if (into.normal.z > -0.9) throw new Error('the hit normal must face the shooter');
if (into.surface !== 'concrete') throw new Error('parapet is concrete');
const glassHit = shots.raycast(new THREE.Vector3(0, 1.4, 0), fwd, 50);
if (!glassHit || glassHit.surface !== 'glass' || Math.abs(glassHit.t - 11.9) > 0.02) throw new Error('the glass wall stops a round outside the doorway');
const door = shots.raycast(new THREE.Vector3(5, 1.4, 0), fwd, 50);
if (door) throw new Error('a round through the doorway must pass the discarded glass');
const lintel = shots.raycast(new THREE.Vector3(5, 5, 0), fwd, 50);
if (!lintel) throw new Error('glass above the doorway still stops a round');
console.log('ok', shots.triangles, 'triangles');
