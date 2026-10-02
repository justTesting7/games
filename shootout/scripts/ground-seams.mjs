// Compares the street surfaces of two stitched city sets where they overlap: both exports
// hold the same streets there, so with the right offsets their heights agree.
//   node shootout/scripts/ground-seams.mjs <map> <setA> <setB>
// Prints the height difference (B - A) over a grid of the overlap, and its median.
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CITY_PARTS, GROUND_MESH } from '../src/world/cityParts.js';

const [map, a, b] = process.argv.slice(2);
const def = CITY_PARTS[map];
const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'assets-src');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const mul = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];

async function ground(folder) {
  const set = def.sets.find((s) => s.folder === folder);
  const doc = await io.read(path.join(SRC, folder, 'set.glb'));
  const tris = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh || !GROUND_MESH.test(n.getName() || mesh.getName())) continue;
    const M = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), idx = p.getIndices(), v = [0, 0, 0];
      const P = [];
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const w = mul(M, v); P.push([w[0] + set.offset[0], w[1] + set.offset[1], w[2] + set.offset[2]]); }
      const n3 = idx ? idx.getCount() : pos.getCount();
      for (let t = 0; t < n3; t += 3) tris.push([0, 1, 2].map((k) => P[idx ? idx.getScalar(t + k) : t + k]));
    }
  }
  return { set, tris };
}
// highest street surface under (x, z)
function heightAt(tris, x, z) {
  let best = null;
  for (const [p, q, r] of tris) {
    const d = (q[2] - r[2]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[2] - r[2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((q[2] - r[2]) * (x - r[0]) + (r[0] - q[0]) * (z - r[2])) / d;
    const l2 = ((r[2] - p[2]) * (x - r[0]) + (p[0] - r[0]) * (z - r[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const y = l1 * p[1] + l2 * q[1] + l3 * r[1];
    if (best === null || y > best) best = y;
  }
  return best;
}
const A = await ground(a), B = await ground(b);
const box = (s) => [s.offset[0] - s.half, s.offset[0] + s.half, s.offset[2] - s.half, s.offset[2] + s.half];
const [ax0, ax1, az0, az1] = box(A.set), [bx0, bx1, bz0, bz1] = box(B.set);
const x0 = Math.max(ax0, bx0), x1 = Math.min(ax1, bx1), z0 = Math.max(az0, bz0), z1 = Math.min(az1, bz1);
console.log(`overlap x ${x0.toFixed(0)}..${x1.toFixed(0)}, z ${z0.toFixed(0)}..${z1.toFixed(0)}`);
const diffs = [];
const step = Math.max(4, Math.min(x1 - x0, z1 - z0) / 12);
for (let x = x0 + step / 2; x < x1; x += step) {
  const row = [];
  for (let z = z0 + step / 2; z < z1; z += step) {
    const ha = heightAt(A.tris, x, z), hb = heightAt(B.tris, x, z);
    if (ha === null || hb === null) { row.push('   .  '); continue; }
    diffs.push(hb - ha);
    row.push((hb - ha).toFixed(2).padStart(6));
  }
  console.log(`x ${x.toFixed(0).padStart(5)} ${row.join(' ')}`);
}
diffs.sort((p, q) => p - q);
console.log(`samples ${diffs.length}, median B-A ${diffs.length ? diffs[diffs.length >> 1].toFixed(2) : '-'} m`);
