import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/assets/maps/custom.glb', import.meta.url));

function pad4(n) { return (n + 3) & ~3; }

function boxMesh(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces = [
    { n: [0, 1, 0], v: [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz]] },
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz], [hx, -hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, -hz]] },
    { n: [1, 0, 0], v: [[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz]] },
  ];
  const pos = [];
  const nrm = [];
  const idx = [];
  for (const f of faces) {
    const base = pos.length / 3;
    for (const p of f.v) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(f.n[0], f.n[1], f.n[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
}

function concat(chunks) {
  const total = chunks.reduce((a, c) => a + c.byteLength, 0);
  const buf = Buffer.alloc(total);
  let o = 0;
  for (const c of chunks) {
    buf.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), o);
    o += c.byteLength;
  }
  return buf;
}

function encodeGLB(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = pad4(jsonBuf.length);
  const binPad = pad4(bin.length);
  const total = 12 + 8 + jsonPad + 8 + binPad;
  const outBuf = Buffer.alloc(total, 0x20);
  outBuf.writeUInt32LE(0x46546C67, 0);
  outBuf.writeUInt32LE(2, 4);
  outBuf.writeUInt32LE(total, 8);
  outBuf.writeUInt32LE(jsonPad, 12);
  outBuf.writeUInt32LE(0x4E4F534A, 16);
  jsonBuf.copy(outBuf, 20);
  const binOff = 20 + jsonPad;
  outBuf.writeUInt32LE(binPad, binOff);
  outBuf.writeUInt32LE(0x004E4942, binOff + 4);
  bin.copy(outBuf, binOff + 8);
  return outBuf;
}

const materials = [
  { name: 'Floor', pbrMetallicRoughness: { baseColorFactor: [0.18, 0.18, 0.16, 1], metallicFactor: 0, roughnessFactor: 0.92 } },
  { name: 'Wall', pbrMetallicRoughness: { baseColorFactor: [0.11, 0.13, 0.15, 1], metallicFactor: 0, roughnessFactor: 0.88 } },
  { name: 'Accent', pbrMetallicRoughness: { baseColorFactor: [0.08, 0.22, 0.24, 1], metallicFactor: 0.05, roughnessFactor: 0.7 } },
  { name: 'Ceiling', pbrMetallicRoughness: { baseColorFactor: [0.08, 0.08, 0.09, 1], metallicFactor: 0, roughnessFactor: 0.95 } },
  { name: 'Wood', pbrMetallicRoughness: { baseColorFactor: [0.42, 0.28, 0.14, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
  { name: 'Metal', pbrMetallicRoughness: { baseColorFactor: [0.35, 0.36, 0.38, 1], metallicFactor: 0.72, roughnessFactor: 0.38 } },
  { name: 'Cover', pbrMetallicRoughness: { baseColorFactor: [0.22, 0.2, 0.18, 1], metallicFactor: 0.1, roughnessFactor: 0.78 } },
];

const parts = [
  { name: 'Floor', w: 28, h: 0.24, d: 20, x: 0, y: 0.12, z: 0, mat: 0 },
  { name: 'Wall_N', w: 28.7, h: 5.6, d: 0.35, x: 0, y: 2.8, z: 10, mat: 1 },
  { name: 'Wall_S', w: 28.7, h: 5.6, d: 0.35, x: 0, y: 2.8, z: -10, mat: 1 },
  { name: 'Wall_E', w: 0.35, h: 5.6, d: 20, x: 14, y: 2.8, z: 0, mat: 2 },
  { name: 'Wall_W', w: 0.35, h: 5.6, d: 20, x: -14, y: 2.8, z: 0, mat: 1 },
  { name: 'Ceiling', w: 28, h: 0.2, d: 20, x: 0, y: 5.7, z: 0, mat: 3 },
  { name: 'Crate_A', w: 1.4, h: 1.4, d: 1.4, x: 5.2, y: 0.7, z: -3.2, mat: 4 },
  { name: 'Crate_B', w: 1.8, h: 1.1, d: 1.2, x: -4.4, y: 0.55, z: 2.4, mat: 4 },
  { name: 'Crate_C', w: 1.2, h: 1.8, d: 1.2, x: 3.6, y: 0.9, z: 4.1, mat: 4 },
  { name: 'Pillar_A', w: 0.7, h: 5.4, d: 0.7, x: -8.5, y: 2.7, z: -6, mat: 5 },
  { name: 'Pillar_B', w: 0.7, h: 5.4, d: 0.7, x: 8.5, y: 2.7, z: 6, mat: 5 },
  { name: 'Cover', w: 3.4, h: 1.15, d: 0.4, x: 0, y: 0.58, z: -1.2, mat: 6 },
  { name: 'Platform', w: 4.2, h: 0.7, d: 3.2, x: -7.2, y: 0.35, z: -5.2, mat: 6 },
];

const binChunks = [];
const bufferViews = [];
const accessors = [];
const meshes = [];
let offset = 0;

for (const part of parts) {
  const geo = boxMesh(part.w, part.h, part.d);
  const pos = Buffer.from(geo.pos.buffer);
  const nrm = Buffer.from(geo.nrm.buffer);
  const idx = Buffer.from(geo.idx.buffer);
  const pushView = (buf, target) => {
    const view = { buffer: 0, byteOffset: offset, byteLength: buf.length, target };
    bufferViews.push(view);
    binChunks.push(buf);
    offset += buf.length;
    return bufferViews.length - 1;
  };
  const posView = pushView(pos, 34962);
  const nrmView = pushView(nrm, 34962);
  const idxView = pushView(idx, 34963);
  const posAcc = accessors.length;
  accessors.push({
    bufferView: posView, componentType: 5126, count: geo.pos.length / 3, type: 'VEC3',
    min: [-part.w / 2, -part.h / 2, -part.d / 2],
    max: [part.w / 2, part.h / 2, part.d / 2],
  });
  const nrmAcc = accessors.length;
  accessors.push({
    bufferView: nrmView, componentType: 5126, count: geo.nrm.length / 3, type: 'VEC3',
  });
  const idxAcc = accessors.length;
  accessors.push({
    bufferView: idxView, componentType: 5123, count: geo.idx.length, type: 'SCALAR',
  });
  meshes.push({
    name: part.name,
    primitives: [{ attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: idxAcc, material: part.mat }],
  });
}

const nodes = [
  { name: 'Studio', children: [] },
  { name: 'Spawn', translation: [0, 0.24, 5], rotation: [0, 1, 0, 0] },
];
nodes[0].children.push(1);
parts.forEach((part, i) => {
  nodes.push({
    name: part.name,
    mesh: i,
    translation: [part.x, part.y, part.z],
  });
  nodes[0].children.push(nodes.length - 1);
});

const json = {
  asset: { version: '2.0', generator: 'relic-isle studio' },
  extras: { relic: 'studio', replace: 'public/assets/maps/custom.glb' },
  scene: 0,
  scenes: [{ name: 'Studio', nodes: [0], extras: { relic: 'studio' } }],
  nodes,
  meshes,
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: offset }],
};

const glb = encodeGLB(json, concat(binChunks));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);
console.log('wrote', out, glb.length, 'bytes');
