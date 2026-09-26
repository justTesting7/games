import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { OFFSTAGE } from '../src/world/studioLayout.js';

const src = fileURLToPath(new URL('../public/assets/maps/custom.glb', import.meta.url));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
let dropped = 0;
for (const node of doc.getRoot().listNodes()) {
  const name = node.getName() || '';
  const t = node.getTranslation();
  const far = Math.hypot(t[0] || 0, t[2] || 0) > 180;
  if (OFFSTAGE.test(name) || far) {
    node.dispose();
    dropped += 1;
  }
}
await doc.transform(prune({ keepLeaves: true }), dedup());
await io.write(src, doc);
const { statSync } = await import('node:fs');
console.log('pruned', dropped, 'offstage nodes →', statSync(src).size, 'bytes');
