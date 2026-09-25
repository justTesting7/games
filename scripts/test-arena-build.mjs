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
if (!arena.group.getObjectByName('msg-scoreboard')) {
  console.error('missing center-hung scoreboard');
  process.exit(1);
}
if (!arena.group.getObjectByName('concourse-ribbon')) {
  console.error('missing concourse LED ribbon');
  process.exit(1);
}
if (!arena.group.getObjectByName('suite-ribbon')) {
  console.error('missing suite LED ribbon');
  process.exit(1);
}
if (!arena.group.getObjectByName('crown-ribbon')) {
  console.error('missing crown LED ribbon');
  process.exit(1);
}
const board = arena.group.getObjectByName('msg-scoreboard');
const bb = new THREE.Box3().setFromObject(board);
const size = new THREE.Vector3();
bb.getSize(size);
if (size.x < 12 || size.y < 8) {
  console.error('scoreboard too small to read as the Garden cube', size);
  process.exit(1);
}
if (!arena.group.getObjectByName('msg-court')) {
  console.error('missing painted Garden court');
  process.exit(1);
}
if (!arena.group.getObjectByName('msg-roof')) {
  console.error('missing solid Garden roof');
  process.exit(1);
}
if (!pipeline.indoor) {
  console.error('arena build should mark the pipeline indoor');
  process.exit(1);
}
const cols = seatMesh.instanceColor?.array;
if (cols) {
  let lum = 0;
  for (let i = 0; i < cols.length; i += 3) lum += 0.3 * cols[i] + 0.6 * cols[i + 1] + 0.1 * cols[i + 2];
  lum /= seatCount;
  if (lum > 0.18) {
    console.error('seats should be dark navy like the Garden, lum=', lum);
    process.exit(1);
  }
}

console.log('ok: arena build', { meshes, seats: seatCount, colliders: colliders.list.length, children: arena.group.children.length });
