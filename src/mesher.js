import { BLOCKS, CHUNK, HEIGHT } from './blocks.js';

// Padded volume: x,z in [-1, CHUNK], y in [-1, HEIGHT]. Index = (x+1) + (z+1)*PX + (y+1)*PL
export const PX = CHUNK + 2;
export const PL = PX * PX;
export const PAD_SIZE = PL * (HEIGHT + 2);

const OPAQUE = new Uint8Array(256);
const OCCL = new Uint8Array(256);
const SKYBLOCK = new Uint8Array(256);
for (let i = 0; i < BLOCKS.length; i++) {
  const b = BLOCKS[i];
  OPAQUE[i] = b.opaque ? 1 : 0;
  OCCL[i] = b.occludes ? 1 : 0;
  SKYBLOCK[i] = b.opaque ? 1 : 0;
}

const off = (v) => v[0] + v[1] * PL + v[2] * PX;

// normal, origin, right, up
const FACES = [
  { n: [1, 0, 0], o: [1, 0, 1], r: [0, 0, -1], u: [0, 1, 0] },
  { n: [-1, 0, 0], o: [0, 0, 0], r: [0, 0, 1], u: [0, 1, 0] },
  { n: [0, 1, 0], o: [0, 1, 1], r: [1, 0, 0], u: [0, 0, -1] },
  { n: [0, -1, 0], o: [0, 0, 0], r: [1, 0, 0], u: [0, 0, 1] },
  { n: [0, 0, 1], o: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
  { n: [0, 0, -1], o: [1, 0, 0], r: [-1, 0, 0], u: [0, 1, 0] },
].map((f) => ({ ...f, nOff: off(f.n), rOff: off(f.r), uOff: off(f.u) }));

class Buf {
  constructor(Type, size) { this.a = new Type(size); this.n = 0; this.Type = Type; }
  ensure(k) {
    if (this.n + k > this.a.length) {
      const b = new this.Type(Math.max(this.a.length * 2, this.n + k));
      b.set(this.a);
      this.a = b;
    }
  }
  out() { return this.a.slice(0, this.n); }
}

class MeshBuilder {
  constructor(withUV) {
    this.pos = new Buf(Float32Array, 4096 * 3);
    this.data = new Buf(Uint8Array, 4096 * 4);
    this.uvl = withUV ? new Buf(Uint8Array, 4096 * 4) : null;
    this.idx = new Buf(Uint32Array, 4096 * 6);
    this.vc = 0;
  }
  vert(x, y, z, nIdx, ao, sky, flags, u, v, layer) {
    const p = this.pos; p.ensure(3);
    p.a[p.n++] = x; p.a[p.n++] = y; p.a[p.n++] = z;
    const d = this.data; d.ensure(4);
    d.a[d.n++] = nIdx; d.a[d.n++] = ao; d.a[d.n++] = sky; d.a[d.n++] = flags;
    if (this.uvl) {
      const t = this.uvl; t.ensure(4);
      t.a[t.n++] = u; t.a[t.n++] = v; t.a[t.n++] = layer; t.a[t.n++] = 0;
    }
    return this.vc++;
  }
  quad(flip) {
    const i = this.idx; i.ensure(6);
    const b = this.vc - 4;
    if (flip) {
      i.a[i.n++] = b + 1; i.a[i.n++] = b + 2; i.a[i.n++] = b + 3;
      i.a[i.n++] = b + 1; i.a[i.n++] = b + 3; i.a[i.n++] = b;
    } else {
      i.a[i.n++] = b; i.a[i.n++] = b + 1; i.a[i.n++] = b + 2;
      i.a[i.n++] = b; i.a[i.n++] = b + 2; i.a[i.n++] = b + 3;
    }
  }
  result() {
    if (this.vc === 0) return null;
    return {
      pos: this.pos.out(),
      data: this.data.out(),
      uvl: this.uvl ? this.uvl.out() : null,
      idx: this.idx.out(),
    };
  }
}

const CU = [0, 1, 1, 0];
const CV = [0, 0, 1, 1];

export function meshChunk(pad) {
  // Column heights for a cheap sky-light estimate.
  const hOp = new Int16Array(PL);
  const hWat = new Int16Array(PL);
  for (let z = 0; z < PX; z++) {
    for (let x = 0; x < PX; x++) {
      const c = x + z * PX;
      let ho = -1, hw = -1;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const id = pad[c + (y + 1) * PL];
        if (hw < 0 && id !== 0 && (SKYBLOCK[id] || BLOCKS[id].liquid)) hw = y;
        if (SKYBLOCK[id]) { ho = y; break; }
      }
      hOp[c] = ho;
      hWat[c] = Math.max(hw, ho);
    }
  }
  const skyAt = (x, y, z) => {
    const c = (x + 1) + (z + 1) * PX;
    const ho = hOp[c];
    if (y > ho) {
      const wd = hWat[c] - y + 1;
      return wd > 0 ? Math.max(5, Math.round(15 - wd * 0.8)) : 15;
    }
    return Math.max(0, Math.round(15 - (ho - y) * 2.2));
  };

  const solid = new MeshBuilder(true);
  const water = new MeshBuilder(false);
  const ao = [0, 0, 0, 0];

  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const i = (x + 1) + (z + 1) * PX + (y + 1) * PL;
        const id = pad[i];
        if (id === 0) continue;
        const b = BLOCKS[id];

        if (b.cross) {
          const sky = skyAt(x, y, z);
          const layer = b.side;
          const quads = [
            [[0.15, 0.15], [0.85, 0.85]],
            [[0.85, 0.85], [0.15, 0.15]],
            [[0.15, 0.85], [0.85, 0.15]],
            [[0.85, 0.15], [0.15, 0.85]],
          ];
          for (const [a, c] of quads) {
            solid.vert(x + a[0], y, z + a[1], 6, 3, sky, 0, 0, 0, layer);
            solid.vert(x + c[0], y, z + c[1], 6, 3, sky, 0, 1, 0, layer);
            solid.vert(x + c[0], y + 1, z + c[1], 6, 3, sky, 2, 1, 1, layer);
            solid.vert(x + a[0], y + 1, z + a[1], 6, 3, sky, 2, 0, 1, layer);
            solid.quad(false);
          }
          continue;
        }

        if (b.liquid) {
          const lowerTop = pad[i + PL] !== id;
          for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const nid = pad[i + F.nOff];
            if (nid === id || OPAQUE[nid]) continue;
            if (f === 3 && y === 0) continue;
            const sky = skyAt(x + F.n[0], y + F.n[1], z + F.n[2]);
            for (let k = 0; k < 4; k++) {
              const px = x + F.o[0] + F.r[0] * CU[k] + F.u[0] * CV[k];
              let py = y + F.o[1] + F.r[1] * CU[k] + F.u[1] * CV[k];
              const pz = z + F.o[2] + F.r[2] * CU[k] + F.u[2] * CV[k];
              if (lowerTop && py === y + 1) py = y + 0.875;
              water.vert(px, py, pz, f, 3, sky, 0);
            }
            water.quad(false);
          }
          continue;
        }

        const flagsBase = (b.wave === 1 ? 1 : 0) | (b.emissive ? 4 : 0);
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const ni = i + F.nOff;
          const nid = pad[ni];
          if (OPAQUE[nid]) continue;
          if (nid === id && b.cullSelf) continue;
          if (f === 3 && y === 0) continue;
          const layer = f === 2 ? b.top : f === 3 ? b.bottom : b.side;
          const sky = skyAt(x + F.n[0], y + F.n[1], z + F.n[2]);
          for (let k = 0; k < 4; k++) {
            const sr = CU[k] ? F.rOff : -F.rOff;
            const su = CV[k] ? F.uOff : -F.uOff;
            const s1 = OCCL[pad[ni + sr]];
            const s2 = OCCL[pad[ni + su]];
            const c = OCCL[pad[ni + sr + su]];
            ao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
          }
          for (let k = 0; k < 4; k++) {
            solid.vert(
              x + F.o[0] + F.r[0] * CU[k] + F.u[0] * CV[k],
              y + F.o[1] + F.r[1] * CU[k] + F.u[1] * CV[k],
              z + F.o[2] + F.r[2] * CU[k] + F.u[2] * CV[k],
              f, ao[k], sky, flagsBase, CU[k], CV[k], layer,
            );
          }
          solid.quad(ao[0] + ao[2] < ao[1] + ao[3]);
        }
      }
    }
  }
  return { solid: solid.result(), water: water.result() };
}
