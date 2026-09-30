// Simulates extractCityCars on a baked map and flags cars that would come out broken:
// too few body triangles, no lower body, a body shorter than the car box, or two
// boxes on top of each other.   node shootout/scripts/check-city-cars.mjs <map-folder>
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const map = process.argv[2];
const nav = JSON.parse(fs.readFileSync(`${new URL("../public/assets/maps/", import.meta.url).pathname}${map}/nav.json`));
const doc = await io.read(`${new URL("../public/assets/maps/", import.meta.url).pathname}${map}/set.glb`);
const tris = { carpaint: [], carglass: [], metal: [], paint: [] };
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (!m || !tris[n.getName()]) continue;
  const t = n.getTranslation(), s = n.getScale();
  for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION'), idx = p.getIndices(), v = [0, 0, 0];
    const cnt = idx ? idx.getCount() : pos.getCount();
    const g = (i) => { pos.getElement(idx ? idx.getScalar(i) : i, v); return [v[0] * s[0] + t[0], v[1] * s[1] + t[1], v[2] * s[2] + t[2]]; };
    for (let i = 0; i + 2 < cnt; i += 3) { const a = g(i), b = g(i + 1), c = g(i + 2); tris[n.getName()].push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]); }
  }
}
const PAD = 0.25;
const cars = nav.cars.map((c) => ({ ...c, s: Math.sin(c.yaw), co: Math.cos(c.yaw), got: { carpaint: [], carglass: [], metal: [], paint: [] } }));
for (const [name, list] of Object.entries(tris)) for (const [x, y, z] of list) {
  for (const c of cars) {
    if (y < c.y - 0.35 || y > c.y + 2.4) continue;
    const dx = x - c.x, dz = z - c.z, along = dx * c.s + dz * c.co, side = dx * c.co - dz * c.s;
    if (Math.abs(along) < c.hl + PAD && Math.abs(side) < c.hw + PAD) { c.got[name].push([along, y - c.y, side]); break; }
  }
}
let bad = 0;
for (const [i, c] of cars.entries()) {
  const p = c.got.carpaint;
  const lo = Math.min(...p.map((q) => q[1])), hi = Math.max(...p.map((q) => q[1]));
  const al = p.map((q) => q[0]), mn = Math.min(...al), mx = Math.max(...al);
  const issues = [];
  if (p.length < 60) issues.push(`few paint tris ${p.length}`);
  if (lo > 0.5) issues.push(`no lower body (paint from ${lo.toFixed(2)})`);
  if (mx - mn < 2 * c.hl - 0.8) issues.push(`paint spans ${(mx - mn).toFixed(1)} of ${(2 * c.hl).toFixed(1)}`);

  for (const [j, o] of cars.entries()) if (j > i && Math.hypot(o.x - c.x, o.z - c.z) < c.hl + o.hl - 0.3 && Math.abs(Math.cos(o.yaw - c.yaw)) > 0.9 && Math.abs((o.x - c.x) * c.co - (o.z - c.z) * c.s) < 1.2) issues.push(`overlaps car ${j} (${Math.hypot(o.x - c.x, o.z - c.z).toFixed(1)} m)`);
  if (issues.length) { bad++; console.log(i, c.x, c.z, 'hl', c.hl, 'hw', c.hw, '|', issues.join('; ')); }
}
console.log(map, 'cars', cars.length, 'flagged', bad);
