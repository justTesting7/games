import * as THREE from 'three';
import { tessellate, dentCar } from '../src/game/carDents.js';

const fail = (msg) => { console.error(msg); process.exit(1); };

// one big quad (2 x 1 m), indexed, as a car flank
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0], 3));
g.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
g.setIndex([0, 1, 2, 0, 2, 3]);

const near = { center: new THREE.Vector3(0.5, 0.5, 0), radius: 0.3 };
const t = tessellate(g, 0.2, near);
const p = t.attributes.position;
if (t.index) fail('tessellated geometry should be non-indexed (flat normals)');
if (!t.attributes.color || t.attributes.color.count !== p.count) fail('vertex colours must carry through');
let small = 0, far = 0;
for (let i = 0; i < p.count; i += 3) {
  const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i + k));
  const edge = Math.max(v[0].distanceTo(v[1]), v[1].distanceTo(v[2]), v[2].distanceTo(v[0]));
  const c = v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
  if (c.distanceTo(near.center) < 0.2 && edge > 0.2 + 1e-6) fail(`triangle near the dent still has a ${edge.toFixed(2)} m edge`);
  if (edge <= 0.2) small++;
  if (c.x > 1.6) far++;
}
if (small < 8) fail('expected the dent area to be cut into small triangles');
if (p.count / 3 > 400) fail(`cut far too much: ${p.count / 3} triangles`);
// area is preserved
let area = 0;
for (let i = 0; i < p.count; i += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
  area += b.sub(a).cross(c.sub(a)).length() / 2;
}
if (Math.abs(area - 2) > 1e-4) fail(`area changed: ${area}`);

// a dent pushes the flank in around the contact, and only there
const car = { mesh: new THREE.Group(), wheels: [] };
const flank = new THREE.Mesh(g.clone(), new THREE.MeshBasicMaterial({ name: 'carpaint' }));
car.mesh.add(flank);
if (!dentCar(car, new THREE.Vector3(1, 0.5, 0), new THREE.Vector3(0, 0, -1), 0.15, 0.5)) fail('dent did not touch the flank');
const q = flank.geometry.attributes.position;
let deepest = 0, edgeMoved = 0;
for (let i = 0; i < q.count; i++) {
  const z = q.getZ(i), x = q.getX(i), y = q.getY(i);
  deepest = Math.min(deepest, z);
  if (Math.hypot(x - 1, (y - 0.5) * 1.4) > 0.5 && Math.abs(z) > 1e-6) edgeMoved++;
}
if (deepest > -0.08 || deepest < -0.25) fail(`dent depth ${deepest.toFixed(3)} not ~0.15 m`);
if (edgeMoved) fail(`${edgeMoved} vertices outside the dent radius moved`);
const glass = new THREE.Mesh(g.clone(), new THREE.MeshBasicMaterial({ name: 'city-car-glass' }));
car.mesh.add(glass);
dentCar(car, new THREE.Vector3(1, 0.5, 0), new THREE.Vector3(0, 0, -1), 0.1, 0.5);
if (glass.geometry.index === null) fail('glass must not be dented');
console.log('ok car dents');
