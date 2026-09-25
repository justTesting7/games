import * as THREE from 'three';
import { Arena } from '../src/world/arena.js';
import { ARENA } from '../src/world/arenaLayout.js';

const terrain = { heightAt: () => ARENA.baseY };
const colliders = { list: [], addBox(b) { this.list.push(b); }, add(c) { this.list.push(c); } };
const pipeline = {
  fogMaterial: { uniforms: { uFogDensity: { value: 0 } } },
  renderer: {},
  scene: new THREE.Scene(),
};

const arena = new Arena(terrain, colliders, pipeline);
arena.models = {};
arena.build({ seed: 20240611 });

const names = [];
arena.group.traverse((o) => { if (o.name) names.push(o.name); });
const seatMesh = arena.group.getObjectByName('bowl-seats');
const seatCount = seatMesh?.count || 0;
if (seatCount < 19000) {
  console.error('expected ~20k seats, got', seatCount);
  process.exit(1);
}
if (colliders.list.length < 40) {
  console.error('expected cover / wall colliders, got', colliders.list.length);
  process.exit(1);
}
if (!names.includes('madison-square-garden') && arena.group.name !== 'madison-square-garden') {
  console.error('missing arena root');
  process.exit(1);
}

let meshes = 0;
arena.group.traverse((o) => { if (o.isMesh) meshes++; });
if (meshes < 80) {
  console.error('arena looks empty', meshes);
  process.exit(1);
}

console.log('ok: arena build', { meshes, seats: seatCount, colliders: colliders.list.length, children: arena.group.children.length });
