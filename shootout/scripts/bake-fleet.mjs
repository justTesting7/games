// Simplifies the six blender-cars styles into public/assets/cars/fleet.glb.
// File compression does not change the frame cost: Tel Aviv draws ~200 cars, and each
// source body is ~166k triangles. This drops interiors and tightens the shell and the
// wheels until a parked car is a few thousand triangles.
//   node shootout/scripts/bake-fleet.mjs [source.glb]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, prune, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const BODY_TRIS = 2200; // ~166k in the source; past this the shell error climbs fast
const WHEEL_DROP = /LugNut|Caliper|BrakeDisc/;
const src = process.argv[2] || path.join(process.env.HOME, 'git/blender-cars/Untitled.glb');
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'assets', 'cars', 'fleet.glb');
const DROP = /Ground|Dash|Seat|Headrest|Steering|RearBack|RearSeat|RearShelf|WellLiner|PlateText|ProjBowl|ProjLens|Wiper/;

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
for (const node of [...doc.getRoot().listNodes()]) {
  if (DROP.test(node.getName() || '')) node.dispose();
}
await doc.transform(prune(), weld());

const trisOf = (prim) => {
  const idx = prim.getIndices();
  return (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
};

function shrink(mesh, budget, errors) {
  const prims = mesh.listPrimitives();
  const total = prims.reduce((sum, prim) => sum + trisOf(prim), 0);
  if (total <= budget) return Math.round(total);
  for (const prim of prims) {
    const share = Math.max(20, Math.round(budget * trisOf(prim) / total));
    let left = trisOf(prim);
    for (const error of errors) {
      if (left <= share * 1.15) break;
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Math.min(1, share / left), error });
      left = trisOf(prim);
    }
  }
  return Math.round(prims.reduce((sum, prim) => sum + trisOf(prim), 0));
}

// The rim is a pile of disconnected spokes. Regular simplify will not cross them,
// so the wheel uses the sloppy pass, which is allowed to merge those islands.
function shrinkSloppy(mesh, perPrim) {
  for (const prim of [...mesh.listPrimitives()]) {
    const mat = prim.getMaterial()?.getName() || '';
    if (WHEEL_DROP.test(mat)) {
      prim.dispose();
      continue;
    }
    const budget = perPrim[mat] ?? 80;
    const idx = prim.getIndices();
    if (!idx || trisOf(prim) <= budget) continue;
    let pos = prim.getAttribute('POSITION').getArray();
    if (!(pos instanceof Float32Array)) pos = new Float32Array(pos);
    let indices = idx.getArray();
    if (!(indices instanceof Uint32Array)) indices = new Uint32Array(indices);
    const [dst] = MeshoptSimplifier.simplifySloppy(indices, pos, 3, null, budget * 3, 0.5);
    const acc = doc.createAccessor().setType('SCALAR').setArray(dst).setBuffer(idx.getBuffer());
    prim.setIndices(acc);
    if (idx.listParents().length === 0) idx.dispose();
    compactPrimitive(prim);
  }
  return Math.round(mesh.listPrimitives().reduce((sum, prim) => sum + trisOf(prim), 0));
}

const bodies = new Set();
const wheels = new Set();
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const name = node.getName() || '';
  if (/^CarBody/.test(name)) bodies.add(mesh);
  if (/^Wheel/.test(name)) wheels.add(mesh);
}
for (const mesh of bodies) console.log(`body ${mesh.getName()}: ${shrink(mesh, BODY_TRIS, [0.02, 0.05, 0.1, 0.15])} tris`);
for (const mesh of wheels) console.log(`wheel ${mesh.getName()}: ${shrinkSloppy(mesh, { Tyre: 220, Alloy: 160 })} tris`);

let worst = 0;
for (const root of doc.getRoot().listScenes()[0].listChildren()) {
  let drawn = 0;
  root.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) drawn += trisOf(prim);
  });
  drawn = Math.round(drawn);
  worst = Math.max(worst, drawn);
  console.log(`${root.getName()}: ${drawn} tris drawn`);
  if (drawn > 5000) throw new Error(`${root.getName()} is still too heavy (${drawn} tris)`);
}
await doc.transform(prune());
fs.mkdirSync(path.dirname(out), { recursive: true });
await io.write(out, doc);
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB), heaviest car ${worst} tris`);
