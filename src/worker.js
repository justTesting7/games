import { createTerrain } from './terrain.js';
import { meshChunk, PX, PL, PAD_SIZE } from './mesher.js';
import { CHUNK, HEIGHT } from './blocks.js';

let terrain = null;
const cache = new Map();
const edits = new Map();
const MAX_CACHE = 1600;

const key = (cx, cz) => `${cx},${cz}`;

function getChunk(cx, cz) {
  const k = key(cx, cz);
  let d = cache.get(k);
  if (d) return d;
  d = terrain.generate(cx, cz);
  const e = edits.get(k);
  if (e) for (const [i, id] of e) d[i] = id;
  if (cache.size >= MAX_CACHE) {
    const it = cache.keys();
    for (let n = 0; n < 200; n++) cache.delete(it.next().value);
  }
  cache.set(k, d);
  return d;
}

function buildPadded(cx, cz) {
  const pad = new Uint8Array(PAD_SIZE);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const d = getChunk(cx + dx, cz + dz);
      const xs = dx < 0 ? CHUNK - 1 : 0, xe = dx > 0 ? 1 : CHUNK;
      const zs = dz < 0 ? CHUNK - 1 : 0, ze = dz > 0 ? 1 : CHUNK;
      for (let y = 0; y < HEIGHT; y++) {
        for (let z = zs; z < ze; z++) {
          const pz = z + dz * CHUNK + 1;
          const src = z * CHUNK + y * CHUNK * CHUNK;
          const dst = pz * PX + (y + 1) * PL + dx * CHUNK + 1;
          for (let x = xs; x < xe; x++) pad[dst + x] = d[src + x];
        }
      }
    }
  }
  return pad;
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    terrain = createTerrain(m.seed);
  } else if (m.type === 'set') {
    const cx = Math.floor(m.x / CHUNK), cz = Math.floor(m.z / CHUNK);
    const lx = m.x - cx * CHUNK, lz = m.z - cz * CHUNK;
    const i = lx + lz * CHUNK + m.y * CHUNK * CHUNK;
    const k = key(cx, cz);
    let em = edits.get(k);
    if (!em) edits.set(k, (em = new Map()));
    em.set(i, m.id);
    const d = cache.get(k);
    if (d) d[i] = m.id;
  } else if (m.type === 'mesh') {
    const pad = buildPadded(m.cx, m.cz);
    const mesh = meshChunk(pad);
    const transfer = [];
    for (const part of [mesh.solid, mesh.water]) {
      if (!part) continue;
      for (const a of Object.values(part)) if (a) transfer.push(a.buffer);
    }
    let blocks = null;
    if (m.wantBlocks) {
      blocks = getChunk(m.cx, m.cz).slice();
      transfer.push(blocks.buffer);
    }
    self.postMessage({ type: 'mesh', cx: m.cx, cz: m.cz, job: m.job, mesh, blocks }, transfer);
  }
};
