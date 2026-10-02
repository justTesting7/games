// node shootout/scripts/test-fleet.mjs
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildTemplates, fleetVariant, placeFleet } from '../src/world/fleetCars.js';
import { dentCar } from '../src/game/carDents.js';

const buf = readFileSync(new URL('../public/assets/cars/fleet.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const styles = buildTemplates(gltf.scene);
if (styles.length !== 6) throw new Error(`expected 6 styles, got ${styles.map((s) => s.name).join(', ')}`);

function tris(group) {
  let n = 0;
  group.traverse((o) => { if (o.isMesh) n += o.geometry.attributes.position.count / 3; });
  return n;
}

for (const style of styles) {
  const n = tris(style.group);
  if (n > 5000) throw new Error(`${style.name} draws ${n} tris`);
  if (!(style.hl > 1.6 && style.hl < 2.34 && style.hw < 0.89 && style.hw > 0.7)) {
    throw new Error(`${style.name} footprint ${style.hl.toFixed(2)} x ${style.hw.toFixed(2)}`);
  }
  let low = Infinity;
  style.group.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position.array;
    for (let i = 1; i < p.length; i += 3) low = Math.min(low, p[i]);
    if (!o.geometry.userData.shared) throw new Error(`${style.name} ${o.name} is not shared`);
  });
  if (Math.abs(low) > 0.02) throw new Error(`${style.name} floats at y ${low}`);
  if (!style.paneBoxes.wind || !style.paneBoxes.rear) throw new Error(`${style.name} missing windows`);
  console.log(`${style.name}: ${n} tris, ${style.hl.toFixed(2)} x ${style.hw.toFixed(2)}, panes ${Object.keys(style.paneBoxes).join(' ')}`);
}

const counts = Array(6).fill(0);
for (let i = 0; i < 200; i++) counts[fleetVariant(i, 6)]++;
if (counts.some((c) => c < 20)) throw new Error(`styles uneven: ${counts.join('/')}`);

const placed = placeFleet([{ x: 1, z: 2, y: 3, yaw: 0.4 }]);
const paint = placed[0].mesh.children.find((m) => m.name === 'paint');
const shared = paint.geometry;
const x0 = shared.attributes.position.getX(0);
const twin = styles[fleetVariant(0, 6)].group.clone(true);
dentCar({ mesh: placed[0].mesh }, new THREE.Vector3().fromBufferAttribute(shared.attributes.position, 30), new THREE.Vector3(1, 0, 0), 0.2, 0.8);
if (shared.attributes.position.getX(0) !== x0) throw new Error('dent rewrote the shared paint');
if (paint.geometry === shared) throw new Error('dent did not replace the hit mesh');
const twinPaint = twin.children.find((m) => m.name === 'paint');
if (twinPaint.geometry !== shared) throw new Error('the other copy lost the shared paint');
console.log(`fleet ok (${counts.join('/')})`);
