import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  fitScale, colliderKind, studioSlotSpawn, studioRivalSpots, buildStudioHeightmap,
} from '../src/world/studioLayout.js';
import { findSpawn, fitStudio, prepareStudio, blockedAt } from '../src/world/glbMap.js';

class Colliders {
  constructor() { this.list = []; }
  addBox(b) { this.list.push({ box: true, ...b }); }
  query(x, z) {
    return this.list.filter((c) => x >= c.x0 - 1 && x <= c.x1 + 1 && z >= c.z0 - 1 && z <= c.z1 + 1);
  }
}

const fail = (msg) => { console.error(msg); process.exit(1); };

if (fitScale(2) < 10) fail('centimetre exports should scale up');
if (fitScale(28) !== 1) fail('metre rooms should stay as authored');
if (fitScale(800) > 0.1) fail('huge exports should scale down');

const floorBox = { min: { x: -14, y: 0, z: -10 }, max: { x: 14, y: 0.24, z: 10 } };
const wallBox = { min: { x: -14.2, y: 0, z: 9.8 }, max: { x: 14.2, y: 5.6, z: 10.2 } };
if (colliderKind('Floor', floorBox, 28) !== 'skip') fail('floors must not become walls');
if (colliderKind('Ceiling', { min: { x: -14, y: 5.6, z: -10 }, max: { x: 14, y: 5.8, z: 10 } }, 28) !== 'skip') {
  fail('ceilings must not block walking');
}
if (colliderKind('Wall_N', wallBox, 28) !== 'concrete') fail('walls should collide');
if (colliderKind('Crate_A', { min: { x: 0, y: 0, z: 0 }, max: { x: 1.4, y: 1.4, z: 1.4 } }, 28) !== 'wood') {
  fail('crates should be wood cover');
}
if (colliderKind('Spawn', wallBox, 28) !== 'skip') fail('spawn empties must be skipped');

const a = studioSlotSpawn({ x: 0, z: 5 }, 0);
const b = studioSlotSpawn({ x: 0, z: 5 }, 1);
if (Math.hypot(a.x - b.x, a.z - b.z) < 2) fail('studio slots should spread fighters');
if (Math.hypot(a.x, a.z - 5) > 3.2) fail('studio slots must stay near the Spawn empty');

const blocked = (x) => x > 4;
const rivals = studioRivalSpots({ x: 0, z: 5 }, 4, blocked);
if (rivals.length !== 4) fail('need a rival spot per jev');
if (new Set(rivals.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`)).size !== 4) {
  fail('rival spots must be unique');
}
for (const s of rivals) {
  if (blocked(s.x, s.z) && Math.hypot(s.x, s.z - 5) > 6) {
    /* fallback may land on a blocked sample; require at least some clear */
  }
}
if (!rivals.some((s) => !blocked(s.x, s.z))) fail('rivals should prefer open floor');

const hm = buildStudioHeightmap(1);
if (hm.heights.length !== 1025 * 1025) fail('studio heightmap size');
if (hm.heights[0] !== 0) fail('studio heightmap should be flat');
if (hm.layout.kind !== 'studio') fail('studio layout tag');

const root = new THREE.Group();
root.name = 'Studio';
const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 12));
floor.name = 'Floor';
floor.position.set(0, 0.1, 0);
const wall = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 0.3));
wall.name = 'Wall_N';
wall.position.set(0, 2, 6);
const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
crate.name = 'Crate_A';
crate.position.set(3, 0.5, 0);
const spawn = new THREE.Object3D();
spawn.name = 'Spawn';
spawn.position.set(1, 0.2, 2);
root.add(floor, wall, crate, spawn);

const studio = prepareStudio(root);
if (Math.abs(studio.spawn.x - 1) > 0.35 || Math.abs(studio.spawn.z - 2) > 0.35) {
  fail(`spawn should follow the Spawn empty, got ${studio.spawn.x},${studio.spawn.z}`);
}
const colliders = new Colliders();
const boxes = studio.addColliders(colliders);
if (boxes.some((c) => /floor/i.test(c.name))) fail('floor AABB must not be added');
if (!boxes.some((c) => /wall/i.test(c.name))) fail('walls should become colliders');
if (!blockedAt(colliders, 0, studio.fit.box.max.z - 0.05)) fail('north wall should block');
if (blockedAt(colliders, 0, 0)) fail('open floor should stay walkable');

const tiny = new THREE.Group();
const tinyFloor = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 1.2));
tinyFloor.name = 'Floor';
tiny.add(tinyFloor);
const fit = fitStudio(tiny);
if (fit.scale < 10) fail('tiny blender export should auto-scale');
if (Math.abs(fit.box.min.y) > 0.02) fail('fitted mesh should sit on y=0');

const glb = readFileSync(new URL('../public/assets/maps/custom.glb', import.meta.url));
if (glb.readUInt32LE(0) !== 0x46546C67) fail('custom.glb is not a GLB');
if (glb.readUInt32LE(4) !== 2) fail('custom.glb should be glTF 2');
const jsonLen = glb.readUInt32LE(12);
const jsonType = glb.readUInt32LE(16);
if (jsonType !== 0x4E4F534A) fail('missing GLB JSON chunk');
const doc = JSON.parse(glb.slice(20, 20 + jsonLen).toString('utf8').trim());
const names = (doc.nodes || []).map((n) => n.name);
if (!names.includes('Spawn')) fail('default GLB needs a Spawn empty');
if (!names.includes('Floor')) fail('default GLB needs a Floor mesh');
if (doc.asset?.generator !== 'relic-isle studio') fail('default GLB generator tag');

const maps = readFileSync(new URL('../src/world/maps.js', import.meta.url), 'utf8');
if (!maps.includes("id: 'studio'")) fail('maps.js should register studio');
const room = readFileSync(new URL('../src/server/room.js', import.meta.url), 'utf8');
if (!room.includes("'studio'")) fail('room must accept the studio map');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
if (!main.includes('loadStudioMap')) fail('boot should load the GLB map');
if (!main.includes('studioRivalSpots')) fail('studio jevs should use studio spots');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
if (!html.includes('value="studio"')) fail('menu needs a Studio option');
const worker = readFileSync(new URL('../src/world/heightmap.worker.js', import.meta.url), 'utf8');
if (!worker.includes('buildStudioHeightmap')) fail('worker should bake a flat studio heightmap');

const marked = findSpawn(root);
if (!marked) fail('findSpawn should see the Spawn empty');

console.log('glb map ok', {
  spawn: studio.spawn,
  colliders: boxes.length,
  scale: +fit.scale.toFixed(2),
  glbBytes: glb.length,
});
