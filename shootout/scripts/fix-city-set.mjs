// Rebuilds public/assets/maps/city/set.glb from the original export.
//
// The first optimised set.glb re-quantised positions wrongly: every vertex
// coordinate below the middle of its mesh's range collapsed onto the middle, so
// lower floors and tree trunks were flattened away. This keeps the original
// geometry untouched (positions stay as authored) and only:
//   - swaps in the small KTX2 textures from the previous optimised file,
//   - meshopt-compresses the buffers without touching quantisation.
//   node shootout/scripts/fix-city-set.mjs <original.glb> <ktx2-source.glb> <out.glb>
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [origPath, texPath, outPath] = process.argv.slice(2);
if (!origPath || !texPath || !outPath) throw new Error('usage: fix-city-set.mjs <original.glb> <ktx2-source.glb> <out.glb>');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const orig = await io.read(origPath);
const src = await io.read(texPath);

const srcMats = new Map(src.getRoot().listMaterials().map((m) => [m.getName(), m]));
const made = new Map();
const copyTex = (t) => {
  if (!made.has(t)) made.set(t, orig.createTexture(t.getName()).setImage(t.getImage()).setMimeType(t.getMimeType()));
  return made.get(t);
};
const slots = [
  ['BaseColor', 'getBaseColorTexture', 'setBaseColorTexture'],
  ['Emissive', 'getEmissiveTexture', 'setEmissiveTexture'],
  ['Normal', 'getNormalTexture', 'setNormalTexture'],
  ['Occlusion', 'getOcclusionTexture', 'setOcclusionTexture'],
  ['MetallicRoughness', 'getMetallicRoughnessTexture', 'setMetallicRoughnessTexture'],
];
let swapped = 0, kept = 0;
for (const m of orig.getRoot().listMaterials()) {
  const s = srcMats.get(m.getName());
  for (const [, get, set] of slots) {
    const had = m[get]();
    if (!had) continue;
    const t = s?.[get]();
    if (!t) { kept++; continue; }
    m[set](copyTex(t));
    swapped++;
  }
}
for (const t of orig.getRoot().listTextures()) if (t.listParents().every((p) => p.propertyType === 'Root')) t.dispose();
console.log('textures swapped', swapped, 'kept as authored', kept);

orig.createExtension(KHRTextureBasisu).setRequired(true);
orig.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(outPath, orig);
console.log('wrote', outPath, (fs.statSync(outPath).size / 1048576).toFixed(1), 'MB');
