import * as THREE from 'three';
import { BLOCKS, CHUNK, HEIGHT, B } from './blocks.js';

const key = (cx, cz) => `${cx},${cz}`;

export class World {
  constructor(pipeline, seed, radius) {
    this.pipeline = pipeline;
    this.seed = seed;
    this.radius = radius;
    this.chunks = new Map();
    this.jobId = 0;
    const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onMessage(e.data, i);
      w.postMessage({ type: 'init', seed });
      this.workers.push({ w, busy: 0 });
    }
    this.queue = [];
    this.lastCenter = null;
  }

  workerFor(cx, cz) {
    const h = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0;
    return h % this.workers.length;
  }

  requestMesh(chunk, wantBlocks) {
    const wi = this.workerFor(chunk.cx, chunk.cz);
    const job = ++this.jobId;
    chunk.pendingJob = job;
    this.workers[wi].busy++;
    this.workers[wi].w.postMessage({ type: 'mesh', cx: chunk.cx, cz: chunk.cz, job, wantBlocks });
  }

  onMessage(m, wi) {
    this.workers[wi].busy--;
    const chunk = this.chunks.get(key(m.cx, m.cz));
    if (!chunk) return;
    if (m.blocks && !chunk.blocks) chunk.blocks = m.blocks;
    if (m.job !== chunk.pendingJob) return;
    chunk.pendingJob = 0;
    this.applyMesh(chunk, m.mesh);
    chunk.state = 'ready';
  }

  applyMesh(chunk, mesh) {
    const P = this.pipeline;
    const build = (part, withUV) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
      g.setAttribute('aData', new THREE.BufferAttribute(part.data, 4));
      if (withUV) g.setAttribute('aUVL', new THREE.BufferAttribute(part.uvl, 4));
      g.setIndex(new THREE.BufferAttribute(part.idx, 1));
      g.computeBoundingSphere();
      return g;
    };
    const place = (m) => {
      m.position.set(chunk.cx * CHUNK, 0, chunk.cz * CHUNK);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.updateMatrixWorld(true);
    };
    if (chunk.solid) { P.opaqueScene.remove(chunk.solid); chunk.solid.geometry.dispose(); chunk.solid = null; }
    if (chunk.water) { P.waterScene.remove(chunk.water); chunk.water.geometry.dispose(); chunk.water = null; }
    if (mesh.solid) {
      chunk.solid = new THREE.Mesh(build(mesh.solid, true), P.blockMaterial);
      place(chunk.solid);
      P.opaqueScene.add(chunk.solid);
    }
    if (mesh.water) {
      chunk.water = new THREE.Mesh(build(mesh.water, false), P.waterMaterial);
      place(chunk.water);
      P.waterScene.add(chunk.water);
    }
  }

  unload(chunk) {
    const P = this.pipeline;
    if (chunk.solid) { P.opaqueScene.remove(chunk.solid); chunk.solid.geometry.dispose(); }
    if (chunk.water) { P.waterScene.remove(chunk.water); chunk.water.geometry.dispose(); }
    this.chunks.delete(key(chunk.cx, chunk.cz));
  }

  update(px, pz) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = this.radius;
    const centerKey = `${pcx},${pcz},${R}`;
    if (centerKey !== this.lastCenter) {
      this.lastCenter = centerKey;
      const wanted = [];
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > (R + 0.5) * (R + 0.5)) continue;
          const k = key(pcx + dx, pcz + dz);
          if (!this.chunks.has(k)) wanted.push([d2, pcx + dx, pcz + dz]);
        }
      }
      wanted.sort((a, b) => a[0] - b[0]);
      this.queue = wanted;
      for (const c of [...this.chunks.values()]) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > (R + 2) * (R + 2)) this.unload(c);
      }
    }
    const maxBusy = 2;
    while (this.queue.length) {
      const [, cx, cz] = this.queue[0];
      const k = key(cx, cz);
      if (this.chunks.has(k)) { this.queue.shift(); continue; }
      const wi = this.workerFor(cx, cz);
      if (this.workers[wi].busy >= maxBusy) {
        // Try to find any queued chunk whose worker is free.
        const idx = this.queue.findIndex(([, x, z]) => this.workers[this.workerFor(x, z)].busy < maxBusy && !this.chunks.has(key(x, z)));
        if (idx < 0) break;
        const [item] = this.queue.splice(idx, 1);
        this.startChunk(item[1], item[2]);
        continue;
      }
      this.queue.shift();
      this.startChunk(cx, cz);
    }
  }

  startChunk(cx, cz) {
    const chunk = { cx, cz, blocks: null, solid: null, water: null, state: 'loading', pendingJob: 0 };
    this.chunks.set(key(cx, cz), chunk);
    this.requestMesh(chunk, true);
  }

  get loadingCount() {
    let n = this.queue.length;
    for (const c of this.chunks.values()) if (c.state !== 'ready') n++;
    return n;
  }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c || !c.blocks) return -1;
    return c.blocks[(x - cx * CHUNK) + (z - cz * CHUNK) * CHUNK + y * CHUNK * CHUNK];
  }

  isSolid(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id < 0) return true;
    return BLOCKS[id].solid;
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c || !c.blocks) return false;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    c.blocks[lx + lz * CHUNK + y * CHUNK * CHUNK] = id;
    for (const w of this.workers) w.w.postMessage({ type: 'set', x, y, z, id });
    const dxs = [0], dzs = [0];
    if (lx === 0) dxs.push(-1);
    if (lx === CHUNK - 1) dxs.push(1);
    if (lz === 0) dzs.push(-1);
    if (lz === CHUNK - 1) dzs.push(1);
    for (const dx of dxs) {
      for (const dz of dzs) {
        const n = this.chunks.get(key(cx + dx, cz + dz));
        if (n && n.blocks) this.requestMesh(n, false);
      }
    }
    return true;
  }

  dispose() {
    for (const w of this.workers) w.w.terminate();
    for (const c of [...this.chunks.values()]) this.unload(c);
  }
}

export function raycast(world, origin, dir, maxDist) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = sx !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tdy = sy !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tdz = sz !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tmx = sx > 0 ? (x + 1 - origin.x) * tdx : sx < 0 ? (origin.x - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - origin.y) * tdy : sy < 0 ? (origin.y - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - origin.z) * tdz : sz < 0 ? (origin.z - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id > 0 && !BLOCKS[id].liquid) return { x, y, z, nx, ny, nz, id };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}
