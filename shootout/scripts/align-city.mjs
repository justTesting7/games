// Measures where a neighbouring city set sits in a base map's frame. Both far.glb
// skylines contain the same towers (same generator, same grid), vertex for vertex,
// only shifted: the mean difference is the offset of the neighbour's origin.
//   node shootout/scripts/align-city.mjs <base-folder> <neighbour-folder>
// Reads the original exports in shootout/assets-src/. Put the result in src/world/cityParts.js.
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const [base, other] = process.argv.slice(2);
if (!base || !other) throw new Error('usage: align-city.mjs <base-folder> <neighbour-folder>');
const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'assets-src');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
async function meshes(folder) {
  const doc = await io.read(path.join(SRC, folder, 'far.glb'));
  const out = {};
  for (const n of doc.getRoot().listNodes()) {
    if (!n.getMesh()) continue;
    const t = n.getTranslation(), s = n.getScale(), v = [0, 0, 0], list = [];
    for (const p of n.getMesh().listPrimitives()) {
      const a = p.getAttribute('POSITION');
      for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); list.push([v[0] * s[0] + t[0], v[1] * s[1] + t[1], v[2] * s[2] + t[2]]); }
    }
    out[n.getName()] = list;
  }
  return out;
}
const A = await meshes(base), B = await meshes(other);
let found = false;
for (const name of Object.keys(A)) {
  if (!B[name] || A[name].length !== B[name].length || name === 'far_ground') continue;
  const d = A[name].map((a, i) => [0, 1, 2].map((k) => a[k] - B[name][i][k]));
  const mean = [0, 1, 2].map((k) => d.reduce((s, x) => s + x[k], 0) / d.length);
  const sd = Math.max(...[0, 1, 2].map((k) => Math.sqrt(d.reduce((s, x) => s + (x[k] - mean[k]) ** 2, 0) / d.length)));
  if (sd > 0.5) continue; // not the same vertices
  console.log(`${other} origin in ${base} frame: [${mean.map((v) => v.toFixed(2)).join(', ')}]  (from ${name}, spread ${sd.toFixed(3)} m)`);
  found = true;
}
if (!found) {
  // Fallback: tall towers stand in both skylines. Every pair of high vertices votes for
  // the shift between them (whole metres); the true shift collects a vote from every
  // shared tower corner. Then refine it on nearest neighbours.
  const high = (M) => Object.entries(M).filter(([n]) => n !== 'far_ground').flatMap(([, l]) => l).filter((q) => q[1] > 60);
  const a = high(A), b = high(B);
  const votes = new Map();
  for (const p of a) for (const q of b) {
    const k = `${Math.round(p[0] - q[0])},${Math.round(p[1] - q[1])},${Math.round(p[2] - q[2])}`;
    votes.set(k, (votes.get(k) || 0) + 1);
  }
  const ranked = [...votes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
  console.log('top votes', ranked.map(([k, n]) => `${k}:${n}`).join('  '), 'from', a.length, 'x', b.length, 'high vertices');
  let t = ranked[0][0].split(',').map(Number);
  for (let it = 0; it < 3; it++) {
    const d = [];
    for (const q of b) {
      let best = null, bd = 1.5;
      for (const p of a) { const e = Math.hypot(p[0] - q[0] - t[0], p[1] - q[1] - t[1], p[2] - q[2] - t[2]); if (e < bd) { bd = e; best = p; } }
      if (best) d.push([0, 1, 2].map((k) => best[k] - q[k]));
    }
    t = [0, 1, 2].map((k) => d.reduce((s, x) => s + x[k], 0) / d.length);
    if (it === 2) console.log(`${other} origin in ${base} frame: [${t.map((v) => v.toFixed(2)).join(', ')}]  (tower vote, ${d.length} matched vertices)`);
  }
}
