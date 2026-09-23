import { createTerrain } from './terrain.js';
import { meshChunk, PX, PL, PAD_SIZE } from './mesher.js';
import { BLOCKS, CHUNK, HEIGHT } from './blocks.js';

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

const EMISSIVE = new Uint8Array(256);
const OPAQUE = new Uint8Array(256);
BLOCKS.forEach((b, i) => { EMISSIVE[i] = b.emissive ? 15 : 0; OPAQUE[i] = b.opaque ? 1 : 0; });
const RW = CHUNK * 3;

// Flood-fills block light from emissive blocks in the 3x3 chunk neighbourhood
// and returns it in the padded layout used by the mesher (or null if dark).
function computeBlockLight(cx, cz) {
  const chunks = [];
  const sources = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const d = getChunk(cx + dx, cz + dz);
      chunks.push(d);
      for (let i = 0; i < d.length; i++) {
        if (EMISSIVE[d[i]]) {
          const x = i % CHUNK, z = Math.floor(i / CHUNK) % CHUNK, y = Math.floor(i / (CHUNK * CHUNK));
          sources.push((x + (dx + 1) * CHUNK) + (z + (dz + 1) * CHUNK) * RW + y * RW * RW, EMISSIVE[d[i]]);
        }
      }
    }
  }
  if (!sources.length) return null;
  const RL = RW * RW;
  const light = new Uint8Array(RL * HEIGHT);
  const queue = new Int32Array(RL * HEIGHT);
  let head = 0, tail = 0;
  for (let s = 0; s < sources.length; s += 2) {
    light[sources[s]] = sources[s + 1];
    queue[tail++] = sources[s];
  }
  const blockAt = (x, y, z) => {
    const d = chunks[Math.floor(z / CHUNK) * 3 + Math.floor(x / CHUNK)];
    return d[(x % CHUNK) + (z % CHUNK) * CHUNK + y * CHUNK * CHUNK];
  };
  while (head < tail) {
    const i = queue[head++];
    const l = light[i] - 1;
    if (l <= 0) continue;
    const x = i % RW, z = Math.floor(i / RW) % RW, y = Math.floor(i / RL);
    const nb = [
      x > 0 ? i - 1 : -1, x < RW - 1 ? i + 1 : -1,
      z > 0 ? i - RW : -1, z < RW - 1 ? i + RW : -1,
      y > 0 ? i - RL : -1, y < HEIGHT - 1 ? i + RL : -1,
    ];
    for (let k = 0; k < 6; k++) {
      const j = nb[k];
      if (j < 0 || light[j] >= l) continue;
      const jx = j % RW, jz = Math.floor(j / RW) % RW, jy = Math.floor(j / RL);
      if (OPAQUE[blockAt(jx, jy, jz)]) continue;
      light[j] = l;
      queue[tail++] = j;
    }
  }
  const pad = new Uint8Array(PAD_SIZE);
  for (let y = 0; y < HEIGHT; y++) {
    for (let z = -1; z <= CHUNK; z++) {
      for (let x = -1; x <= CHUNK; x++) {
        pad[(x + 1) + (z + 1) * PX + (y + 1) * PL] = light[(x + CHUNK) + (z + CHUNK) * RW + y * RL];
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
    const mesh = meshChunk(pad, computeBlockLight(m.cx, m.cz));
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
