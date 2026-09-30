// Builds the deployable files for a city-set map from its original exports.
//   node shootout/scripts/build-city-map.mjs <map-folder>
// Reads   shootout/assets-src/<map>/set.glb (+ far.glb, optional)
// Writes  shootout/public/assets/maps/<map>/set.glb, far.glb
//
// Positions are left exactly as exported (already 16-bit quantised); an earlier
// optimiser pass re-quantised them and collapsed the lower half of every mesh.
// Textures are shrunk to <= 1024 px and encoded to KTX2 (ETC1S), and the buffers
// are meshopt-compressed without touching quantisation. Then run
// bake-dizengoff-nav.mjs <map-folder> for the collision grid.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const MAX_SIDE = 1024;
const map = process.argv[2];
if (!map) throw new Error('usage: build-city-map.mjs <map-folder>');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srcDir = path.join(root, 'assets-src', map);
const outDir = path.join(root, 'public', 'assets', 'maps', map);
fs.mkdirSync(outDir, { recursive: true });

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const imageDecoder = async (buffer) => {
  let img = sharp(buffer).ensureAlpha();
  const { width, height } = await img.metadata();
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(4, Math.round((width * scale) / 4) * 4), h = Math.max(4, Math.round((height * scale) / 4) * 4);
  if (w !== width || h !== height) img = img.resize(w, h, { fit: 'fill' });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

for (const name of ['set', 'far']) {
  const src = path.join(srcDir, `${name}.glb`);
  if (!fs.existsSync(src)) { if (name === 'set') throw new Error(`missing ${src}`); continue; }
  const doc = await io.read(src);
  await doc.transform(ktx2({ isUASTC: false, generateMipmap: true, enableDebug: false, imageDecoder }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const out = path.join(outDir, `${name}.glb`);
  await io.write(out, doc);
  console.log(name, (fs.statSync(src).size / 1048576).toFixed(1), 'MB ->', (fs.statSync(out).size / 1048576).toFixed(1), 'MB');
  if (name === 'set') await splitIfLarge(out);
}

// Cloudflare Workers refuse assets over 25 MiB. A set over the limit is split by whole
// meshes into set.glb, set-2.glb, ... (nothing is re-encoded: each chunk is the built
// file with the other chunks' nodes removed). List the files in src/world/cityParts.js.
async function splitIfLarge(file) {
  for (const f of fs.readdirSync(outDir)) if (/^set-\d+\.glb$/.test(f)) fs.unlinkSync(path.join(outDir, f));
  const LIMIT = 23 * 1048576;
  const size = fs.statSync(file).size;
  if (size <= LIMIT) return;
  const bytesOf = (node) => node.getMesh().listPrimitives().reduce((b, p) => b + p.listAttributes().reduce((a, x) => a + x.getArray().byteLength, 0)
    + (p.getIndices()?.getArray().byteLength || 0), 0);
  const doc = await io.read(file);
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh()).map((n) => ({ name: n.getName(), bytes: bytesOf(n) }))
    .sort((a, b) => b.bytes - a.bytes);
  const n = Math.ceil(size / (LIMIT * 0.8));
  const bins = Array.from({ length: n }, () => ({ bytes: 0, names: new Set() }));
  for (const node of nodes) { const bin = bins.reduce((a, b) => (b.bytes < a.bytes ? b : a)); bin.bytes += node.bytes; bin.names.add(node.name); }
  const { prune } = await import('@gltf-transform/functions');
  const whole = `${file}.whole`; // chunk 1 is written over set.glb: read every chunk from a copy
  fs.copyFileSync(file, whole);
  for (const [k, bin] of bins.entries()) {
    const part = await io.read(whole);
    for (const node of part.getRoot().listNodes()) if (node.getMesh() && !bin.names.has(node.getName())) node.dispose();
    await part.transform(prune());
    const out = path.join(outDir, k === 0 ? 'set.glb' : `set-${k + 1}.glb`);
    await io.write(out, part);
    const mb = fs.statSync(out).size / 1048576;
    console.log('  chunk', path.basename(out), mb.toFixed(1), 'MB,', bin.names.size, 'meshes');
    if (mb * 1048576 > 25 * 1048576) throw new Error(`${out} is still over 25 MiB`);
  }
  fs.unlinkSync(whole);
}
