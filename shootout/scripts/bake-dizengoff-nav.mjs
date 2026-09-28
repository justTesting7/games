// Bakes walk height + blocking rectangles for Dizengoff Center from set.glb.
// Every mesh in the set is batched by material (each spans the whole district),
// so per-mesh boxes are useless. This samples the triangles instead and writes
// public/assets/maps/<map-folder>/nav.json.
//   node shootout/scripts/bake-dizengoff-nav.mjs <map-folder>
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { measureProfile, classifyStadium, inGateDoor } from '../src/world/stadium.js';

const MAP = process.argv[2];
if (!MAP) throw new Error('usage: bake-dizengoff-nav.mjs <map-folder>');
const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'assets', 'maps', MAP);
const CELL = 0.5;
const GROUND = /^(asphalt|pavement|ground|lm_grass|kerb|marking|road_marks|road_marks_bus)$/;
const SOLID = /^(facade_.*|side_.*|blank_.*|ground_.*|bark|railing|netting|hoarding|crates|pais|dt_facade|tt_grid|metal|glass|balcony|parapet|solar|awning|signs|name_boxes|load_signs)$/;
const BODY_LO = 0.45, BODY_HI = 2.0, TALL = 6;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(path.join(DIR, 'set.glb'));

const tris = { ground: [], solid: [] };
const carParts = { carpaint: [], carglass: [] };
const wallCells = new Set();
const seatTris = [];
let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh();
  if (!mesh) continue;
  const name = n.getName();
  const kind = GROUND.test(name) ? 'ground' : SOLID.test(name) ? 'solid' : null;
  const carPart = carParts[name];
  const isSeats = name === 'st_seats';
  if (!kind && !carPart && !isSeats) continue;
  const t = n.getTranslation(), s = n.getScale();
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const idx = p.getIndices();
    const count = idx ? idx.getCount() : pos.getCount();
    const v = [0, 0, 0];
    const get = (i) => { pos.getElement(idx ? idx.getScalar(i) : i, v); return [v[0] * s[0] + t[0], v[1] * s[1] + t[1], v[2] * s[2] + t[2]]; };
    for (let i = 0; i + 2 < count; i += 3) {
      const tri = [get(i), get(i + 1), get(i + 2)];
      if (isSeats) { seatTris.push(tri); continue; }
      if (carPart) { carPart.push(tri); continue; }
      tris[kind].push(tri);
      if (kind === 'ground') for (const q of tri) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minZ = Math.min(minZ, q[2]); maxZ = Math.max(maxZ, q[2]); }
    }
  }
}
const X0 = Math.floor(minX) - 2, Z0 = Math.floor(minZ) - 2;
const W = Math.ceil((maxX - X0) / CELL) + 4, H = Math.ceil((maxZ - Z0) / CELL) + 4;
console.log('grid', W, 'x', H, 'origin', X0, Z0, 'ground tris', tris.ground.length, 'solid tris', tris.solid.length);

function sample(tri, step, fn) {
  const [a, b, c] = tri;
  const lab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const lac = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const nu = Math.max(1, Math.ceil(lab / step)), nv = Math.max(1, Math.ceil(lac / step));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    let u = i / nu, w = j / nv;
    if (u + w > 1) { u = 1 - u; w = 1 - w; }
    fn(a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * w, a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * w, a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * w);
  }
}
const cellOf = (x, z) => {
  const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
  return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
};

// pass 1: walkable ground height (upward-facing triangles only)
const ground = new Float32Array(W * H).fill(-1e9);
for (const tri of tris.ground) {
  const [a, b, c] = tri;
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  const nl = Math.hypot(...[
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    ny,
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ]);
  if (nl < 1e-9 || Math.abs(ny) / nl < 0.7) continue;
  sample(tri, CELL * 0.5, (x, y, z) => { const k = cellOf(x, z); if (k >= 0 && y > ground[k]) ground[k] = y; });
}
// stadium: the seat ramp ships with nothing under it. Give it a floor, an outer wall with
// gates, a hall and tunnels (see src/world/stadium.js) so it can be walked into.
let stadium = null, stadiumCell = () => null, stadiumDoor = () => false;
if (seatTris.length) {
  const inTri = (x, z, a, b, c) => {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) return null;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    return l1 < 0 || l2 < 0 || l3 < 0 ? null : l1 * a[1] + l2 * b[1] + l3 * c[1];
  };
  const seatY = (x, z) => {
    let y = null;
    for (const t of seatTris) { const h = inTri(x, z, t[0], t[1], t[2]); if (h !== null && (y === null || h < y)) y = h; }
    return y;
  };
  // pitch centre from the pitch quad, else the seat bounds
  let sx = 0, sz = 0, sn = 0;
  for (const t of seatTris) for (const q of t) { sx += q[0]; sz += q[2]; sn++; }
  const c = [+(sx / sn).toFixed(1), +(sz / sn).toFixed(1)];
  const profile = measureProfile(seatY, c, 180);
  // walking height: plaza level just outside the stands
  const outside = [];
  for (let i = 0; i < 90; i++) {
    const th = (i / 90) * Math.PI * 2, r = profile.top[Math.floor(i * 2)] + 3.5;
    const k = cellOf(c[0] + Math.sin(th) * r, c[1] + Math.cos(th) * r);
    if (k >= 0 && ground[k] > -1e8) outside.push(ground[k]);
  }
  outside.sort((a, b) => a - b);
  const floorY = +(outside.length ? outside[outside.length >> 1] : 0.6).toFixed(2);
  stadium = { ...profile, floorY };
  stadiumCell = (x, z) => classifyStadium(profile, x, z);
  stadiumDoor = (x, z) => inGateDoor(profile, x, z);
  let stamped = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    const cls = stadiumCell(X0 + (i + 0.5) * CELL, Z0 + (j + 0.5) * CELL);
    if (!cls) continue;
    ground[k] = floorY;
    if (cls === 'wall') wallCells.add(k);
    stamped++;
  }
  console.log('stadium centre', c, 'floor', floorY, 'toe r', Math.min(...profile.toe).toFixed(0) + '-' + Math.max(...profile.toe).toFixed(0), 'cells', stamped);
}

// cars: cluster the paint triangles into vehicles, one drivable car each
const cars = [];
{
  const key = (q) => `${Math.round(q[0] * 50)},${Math.round(q[1] * 50)},${Math.round(q[2] * 50)}`;
  const par = new Map();
  const find = (a) => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
  for (const t of carParts.carpaint) for (const q of t) { const k = key(q); if (!par.has(k)) par.set(k, k); }
  for (const t of carParts.carpaint) {
    const a = find(key(t[0]));
    for (let i = 1; i < 3; i++) { const b = find(key(t[i])); if (a !== b) par.set(b, a); }
  }
  const comps = new Map();
  carParts.carpaint.forEach((t, i) => { const r = find(key(t[0])); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(i); });
  let parts = [];
  for (const ix of comps.values()) {
    if (ix.length < 20) continue; // lights, mirrors, badges
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const i of ix) for (const q of carParts.carpaint[i]) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
    parts.push({ ix, mn, mx, group: parts.length });
  }
  // a car is a lower body plus a cabin: join parts that overlap in plan and sit at similar heights
  const grp = parts.map((_, i) => i);
  const gf = (a) => { while (grp[a] !== a) { grp[a] = grp[grp[a]]; a = grp[a]; } return a; };
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i], b = parts[j], pad = 0.3;
    if (a.mn[0] > b.mx[0] + pad || b.mn[0] > a.mx[0] + pad || a.mn[2] > b.mx[2] + pad || b.mn[2] > a.mx[2] + pad) continue;
    if (Math.abs((a.mn[1] + a.mx[1]) / 2 - (b.mn[1] + b.mx[1]) / 2) > 1.2) continue;
    grp[gf(j)] = gf(i);
  }
  const clusters = new Map();
  parts.forEach((p, i) => { const r = gf(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(p); });
  for (const cl of clusters.values()) {
    // principal axis of the vertices in plan
    let n = 0, mx_ = 0, mz_ = 0, minY = 1e9;
    const verts = [];
    for (const p of cl) for (const i of p.ix) for (const q of carParts.carpaint[i]) { verts.push(q); mx_ += q[0]; mz_ += q[2]; n++; minY = Math.min(minY, q[1]); }
    mx_ /= n; mz_ /= n;
    let sxx = 0, szz = 0, sxz = 0;
    for (const q of verts) { const dx = q[0] - mx_, dz = q[2] - mz_; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz); // major axis direction (x = cos, z = sin)
    let ax = Math.cos(ang), az = Math.sin(ang);
    let lo = 1e9, hi = -1e9, lw = 1e9, hw_ = -1e9;
    for (const q of verts) {
      const a = (q[0] - mx_) * ax + (q[2] - mz_) * az, w = (q[0] - mx_) * az - (q[2] - mz_) * ax;
      lo = Math.min(lo, a); hi = Math.max(hi, a); lw = Math.min(lw, w); hw_ = Math.max(hw_, w);
    }
    const len = hi - lo, wid = hw_ - lw;
    if (len < 3 || len > 6.8 || wid < 1.4 || wid > 3.1) continue;
    // centre on the body's extent, not the vertex mean
    const ca = (hi + lo) / 2, cw = (hw_ + lw) / 2;
    const cx = mx_ + ax * ca + az * cw, cz = mz_ + az * ca - ax * cw;
    const k = cellOf(cx, cz);
    if (k < 0 || ground[k] < -1e8) continue;
    const off = minY - ground[k];
    if (off < -0.4 || off > 1.7) continue; // parked on a deck or a roof, not on the street
    // the windows sit behind the middle of the car: the nose points away from them
    let gs = 0, gn = 0;
    for (const t of carParts.carglass) {
      const gx = (t[0][0] + t[1][0] + t[2][0]) / 3, gz = (t[0][2] + t[1][2] + t[2][2]) / 3, gy = (t[0][1] + t[1][1] + t[2][1]) / 3;
      const dx = gx - cx, dz = gz - cz, a = dx * ax + dz * az, w = dx * az - dz * ax;
      if (Math.abs(a) < len / 2 + 0.2 && Math.abs(w) < wid / 2 + 0.2 && gy > minY - 0.3 && gy < minY + 2.2) { gs += a; gn++; }
    }
    if (gn && gs > 0) { ax = -ax; az = -az; }
    cars.push({
      x: +cx.toFixed(2), z: +cz.toFixed(2), y: +ground[k].toFixed(2), yaw: +Math.atan2(ax, az).toFixed(3),
      hl: +(len / 2).toFixed(2), hw: +(wid / 2).toFixed(2),
    });
  }
}
console.log('drivable cars', cars.length);
const inCar = (x, z) => cars.some((c) => {
  const dx = x - c.x, dz = z - c.z, s = Math.sin(c.yaw), co = Math.cos(c.yaw);
  return Math.abs(dx * s + dz * co) < c.hl + 0.3 && Math.abs(dx * co - dz * s) < c.hw + 0.3;
});

// pass 2: things standing on it
const low = new Uint8Array(W * H), tall = new Uint8Array(W * H);
for (const tri of tris.solid) {
  sample(tri, CELL * 0.5, (x, y, z) => {
    const k = cellOf(x, z);
    if (k < 0 || ground[k] < -1e8) return;
    const d = y - ground[k];
    if (d < 2.4 && inCar(x, z)) return; // part of a drivable car
    if (d < 4.5 && stadiumDoor(x, z)) return; // a gate cut through the stadium's glass wall
    if (d > BODY_LO && d < BODY_HI) low[k] = 1;
    if (d > TALL) tall[k] = 1;
  });
}
const void_ = new Uint8Array(W * H);
let open = 0, blocked = 0;
for (const k of wallCells) { low[k] = 1; tall[k] = 1; }
for (let k = 0; k < W * H; k++) {
  if (ground[k] < -1e8) void_[k] = 1;
  if (void_[k] || low[k]) blocked++; else open++;
}
console.log('open cells', open, 'blocked', blocked);

// fill void ground heights from the nearest known neighbour (a few sweeps)
for (let pass = 0; pass < 6; pass++) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const k = j * W + i;
  if (ground[k] > -1e8) continue;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
    const g = ground[jj * W + ii];
    if (g > -1e8 && (pass < 5 || true)) { ground[k] = g; break; }
  }
}
for (let k = 0; k < W * H; k++) if (ground[k] < -1e8) ground[k] = 0;

// blocking rectangles: merge runs along x, then stack identical runs along z
const cls = (k) => (void_[k] ? 1 : low[k] ? (tall[k] ? 1 : 2) : 0); // 1 = tall wall / void, 2 = low obstacle
const rects = [];
let open_ = null;
const runs = [];
for (let j = 0; j < H; j++) {
  let i = 0;
  while (i < W) {
    const c = cls(j * W + i);
    if (!c) { i++; continue; }
    let e = i;
    while (e + 1 < W && cls(j * W + e + 1) === c) e++;
    runs.push({ i0: i, i1: e, j0: j, j1: j, c });
    i = e + 1;
  }
}
const byRow = new Map();
for (const r of runs) { if (!byRow.has(r.j0)) byRow.set(r.j0, []); byRow.get(r.j0).push(r); }
const active = new Map();
for (let j = 0; j <= H; j++) {
  const row = byRow.get(j) || [];
  const seen = new Set();
  for (const r of row) {
    const key = `${r.i0},${r.i1},${r.c}`;
    const a = active.get(key);
    if (a && a.j1 === j - 1) { a.j1 = j; seen.add(key); }
    else { if (a) rects.push(a); active.set(key, r); seen.add(key); }
  }
  for (const [key, a] of active) if (!seen.has(key)) { rects.push(a); active.delete(key); }
}
for (const a of active.values()) rects.push(a);
const boxes = rects.map((r) => [
  +(X0 + r.i0 * CELL).toFixed(2), +(Z0 + r.j0 * CELL).toFixed(2),
  +(X0 + (r.i1 + 1) * CELL).toFixed(2), +(Z0 + (r.j1 + 1) * CELL).toFixed(2), r.c === 1 ? 1 : 0,
]);
console.log('rects', boxes.length);

// heights at 1 m as Int16 centimetres
const HC = 1, hw = Math.ceil(W * CELL / HC), hh = Math.ceil(H * CELL / HC);
const hs = new Int16Array(hw * hh);
for (let j = 0; j < hh; j++) for (let i = 0; i < hw; i++) {
  const k = Math.min(H - 1, Math.floor(j * HC / CELL)) * W + Math.min(W - 1, Math.floor(i * HC / CELL));
  hs[j * hw + i] = Math.round(ground[k] * 100);
}

// spawn: the open cell furthest from any wall inside the biggest open region
const dist = new Float32Array(W * H).fill(1e6);
const isOpen = (k) => !void_[k] && !low[k];
for (let k = 0; k < W * H; k++) if (!isOpen(k)) dist[k] = 0;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const k = j * W + i;
  if (i > 0) dist[k] = Math.min(dist[k], dist[k - 1] + 1);
  if (j > 0) dist[k] = Math.min(dist[k], dist[k - W] + 1);
}
for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
  const k = j * W + i;
  if (i < W - 1) dist[k] = Math.min(dist[k], dist[k + 1] + 1);
  if (j < H - 1) dist[k] = Math.min(dist[k], dist[k + W] + 1);
}
const comp = new Int32Array(W * H).fill(-1);
const sizes = [];
for (let s = 0; s < W * H; s++) {
  if (comp[s] >= 0 || !isOpen(s)) continue;
  const id = sizes.length; let n = 0; const st = [s]; comp[s] = id;
  while (st.length) {
    const k = st.pop(); n++;
    const i = k % W, j = (k / W) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const q = jj * W + ii;
      if (comp[q] < 0 && isOpen(q)) { comp[q] = id; st.push(q); }
    }
  }
  sizes.push(n);
}
const main = sizes.indexOf(Math.max(...sizes));
console.log('open regions', sizes.length, 'largest', sizes[main], 'cells =', (sizes[main] * CELL * CELL).toFixed(0), 'm2');
// spawn near the middle of the open region, in a spot with room to move
let cxs = 0, czs = 0, cn = 0;
for (let k = 0; k < W * H; k++) if (comp[k] === main) { cxs += k % W; czs += (k / W) | 0; cn++; }
const cx = cxs / cn, cz = czs / cn;
let best = -1, bestScore = 1e18;
for (let k = 0; k < W * H; k++) {
  if (comp[k] !== main || dist[k] * CELL < 10) continue;
  if (stadiumCell(X0 + ((k % W) + 0.5) * CELL, Z0 + (((k / W) | 0) + 0.5) * CELL)) continue;
  const score = Math.hypot((k % W) - cx, ((k / W) | 0) - cz);
  if (score < bestScore) { bestScore = score; best = k; }
}
if (best < 0) throw new Error('no open spot with 10 m clearance');
const sx = X0 + ((best % W) + 0.5) * CELL, sz = Z0 + (((best / W) | 0) + 0.5) * CELL;
console.log('spawn', sx.toFixed(1), sz.toFixed(1), 'clearance', (dist[best] * CELL).toFixed(1), 'm');
// face the direction with the longest clear line of sight
let yaw = 0, far = 0;
for (let a = 0; a < 32; a++) {
  const ang = a / 32 * Math.PI * 2;
  let d = 0;
  for (; d < 200; d += CELL) { const k = cellOf(sx + Math.sin(ang) * d, sz + Math.cos(ang) * d); if (k < 0 || !isOpen(k)) break; }
  if (d > far) { far = d; yaw = ang; }
}
const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
const out = {
  cell: CELL, x0: X0, z0: Z0, w: W, h: H,
  hcell: HC, hw, hh, heights: b64(hs),
  boxes,
  spawn: { x: +sx.toFixed(2), z: +sz.toFixed(2), y: +(ground[best]).toFixed(2), yaw: +yaw.toFixed(3) },
  cars,
  stadium,
  bounds: { minX, maxX, minZ, maxZ },
};
fs.writeFileSync(path.join(DIR, 'nav.json'), JSON.stringify(out));
console.log('wrote nav.json', (fs.statSync(path.join(DIR, 'nav.json')).size / 1024).toFixed(0), 'KB');
