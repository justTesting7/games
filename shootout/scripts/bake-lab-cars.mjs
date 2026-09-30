// Cuts a few parked cars out of a city set into public/assets/maps/lab/cars.glb, so the
// Lab has the same cars as the Tel Aviv maps. Each car is saved in its own frame (+z
// forward, origin on the ground under its middle), one node per car part, the way
// src/world/cityCars.js cuts them at runtime.
//   node shootout/scripts/bake-lab-cars.mjs [map-folder] [car index...]
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const [map = 'dizengoff-square', ...picks] = process.argv.slice(2);
const MAPS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'assets', 'maps');
const nav = JSON.parse(fs.readFileSync(path.join(MAPS, map, 'nav.json')));
const chosen = (picks.length ? picks.map(Number) : [0, 37, 74]).map((i) => nav.cars[i]).filter(Boolean);
const PARTS = ['carpaint', 'carglass', 'metal', 'paint'];
const PAD = 0.25;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const src = await io.read(path.join(MAPS, map, 'set.glb'));
const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene('lab-cars');
const mats = {};

chosen.forEach((car, n) => {
  const s = Math.sin(car.yaw), co = Math.cos(car.yaw);
  const root = out.createNode(`car-${n}`).setExtras({ hl: car.hl, hw: car.hw });
  scene.addChild(root);
  const parts = {};
  for (const node of src.getRoot().listNodes()) {
    const name = node.getName(), mesh = node.getMesh();
    if (!mesh || !PARTS.includes(name)) continue;
    const t = node.getTranslation(), sc = node.getScale();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), col = prim.getAttribute('COLOR_0');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const v = [0, 0, 0], w = [0, 0, 0], c = [0, 0, 0, 1];
      const world = (i) => { pos.getElement(i, v); return [v[0] * sc[0] + t[0], v[1] * sc[1] + t[1], v[2] * sc[2] + t[2]]; };
      for (let k = 0; k + 2 < count; k += 3) {
        const ids = [0, 1, 2].map((j) => (idx ? idx.getScalar(k + j) : k + j));
        const ps = ids.map(world);
        const cx = (ps[0][0] + ps[1][0] + ps[2][0]) / 3, cy = (ps[0][1] + ps[1][1] + ps[2][1]) / 3, cz = (ps[0][2] + ps[1][2] + ps[2][2]) / 3;
        if (cy < car.y - 0.35 || cy > car.y + 2.4) continue;
        const dx = cx - car.x, dz = cz - car.z;
        if (Math.abs(dx * s + dz * co) >= car.hl + PAD || Math.abs(dx * co - dz * s) >= car.hw + PAD) continue;
        const p = parts[name] || (parts[name] = { pos: [], nor: [], col: [], mat: prim.getMaterial(), colSize: col?.getElementSize() || 0 });
        ids.forEach((id, j) => {
          const q = ps[j], ex = q[0] - car.x, ez = q[2] - car.z;
          p.pos.push(ex * co - ez * s, q[1] - car.y, ex * s + ez * co);
          if (nor) { nor.getElement(id, w); p.nor.push(w[0] * co - w[2] * s, w[1], w[0] * s + w[2] * co); }
          if (col) { col.getElement(id, c); for (let e = 0; e < p.colSize; e++) p.col.push(c[e]); }
        });
      }
    }
  }
  for (const [name, p] of Object.entries(parts)) {
    let low = Infinity;
    for (let i = 1; i < p.pos.length; i += 3) low = Math.min(low, p.pos[i]);
    if (!mats[name]) {
      const m = p.mat;
      mats[name] = out.createMaterial(name).setBaseColorFactor(m.getBaseColorFactor()).setRoughnessFactor(m.getRoughnessFactor())
        .setMetallicFactor(m.getMetallicFactor()).setDoubleSided(m.getDoubleSided());
    }
    const prim = out.createPrimitive().setMaterial(mats[name])
      .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(new Float32Array(p.pos)).setBuffer(buffer));
    if (p.nor.length) prim.setAttribute('NORMAL', out.createAccessor().setType('VEC3').setArray(new Float32Array(p.nor)).setBuffer(buffer));
    if (p.col.length) prim.setAttribute('COLOR_0', out.createAccessor().setType(p.colSize === 4 ? 'VEC4' : 'VEC3').setArray(new Float32Array(p.col)).setBuffer(buffer));
    const node = out.createNode(name).setMesh(out.createMesh(name).addPrimitive(prim));
    root.addChild(node);
  }
  console.log(`car ${n}: ${Object.entries(parts).map(([k, p]) => `${k} ${p.pos.length / 9}`).join(', ')}`);
});
fs.mkdirSync(path.join(MAPS, 'lab'), { recursive: true });
await io.write(path.join(MAPS, 'lab', 'cars.glb'), out);
console.log('wrote lab/cars.glb', (fs.statSync(path.join(MAPS, 'lab', 'cars.glb')).size / 1024).toFixed(0), 'KB');
