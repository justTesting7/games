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
import { cityPartsOf, ownerOf, GROUND_MESH, setDrop } from '../src/world/cityParts.js';

const MAP = process.argv[2];
if (!MAP) throw new Error('usage: bake-dizengoff-nav.mjs <map-folder>');
const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'assets', 'maps', MAP);
const CELL = 0.5;
const GROUND = /^(asphalt|pavement|ground|lm_grass|kerb|marking|road_marks|road_marks_bus)$/;
// paint: bollards (about 600 a map), posts and car underbodies; the drivable cars are let through below
const SOLID = /^(facade_.*|side_.*|blank_.*|ground_.*|bark|railing|netting|hoarding|crates|pais|dt_facade|tt_grid|metal|paint|glass|balcony|parapet|solar|awning|signs|name_boxes|load_signs)$/;
const BODY_LO = 0.45, BODY_HI = 2.0, TALL = 6;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
// a single set, or every set of a stitched map at its offset (src/world/cityParts.js)
const partsDef = cityPartsOf(MAP);
const sources = [];
// a set over the asset size limit is built in chunks: set.glb, set-2.glb, ...
const chunksOf = (dir) => fs.readdirSync(dir).filter((f) => /^set(-\d+)?\.glb$/.test(f)).sort();
if (partsDef) {
  fs.mkdirSync(DIR, { recursive: true });
  for (const [own, part] of partsDef.sets.entries()) {
    const dir = path.join(DIR, '..', part.folder);
    for (const f of chunksOf(dir)) sources.push({ doc: await io.read(path.join(dir, f)), off: part.offset, own });
  }
} else for (const f of chunksOf(DIR)) sources.push({ doc: await io.read(path.join(DIR, f)), off: [0, 0, 0], own: 0 });

const tris = { ground: [], solid: [] };
const carParts = { carpaint: [], carglass: [] };
const scooterParts = { paint: [], metal: [] };
const wallCells = new Set();
const seatTris = [];
const pitchVerts = [];
let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
for (const { doc, off, own } of sources) for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh();
  if (!mesh) continue;
  const name = n.getName();
  const kind = GROUND.test(name) ? 'ground' : SOLID.test(name) ? 'solid' : null;
  const carPart = carParts[name];
  const isSeats = name === 'st_seats';
  const scooterPart = scooterParts[name];
  if (name === 'st_pitch') {
    const t = n.getTranslation(), s = n.getScale();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), uv = p.getAttribute('TEXCOORD_0'), q = [0, 0, 0], w2 = [0, 0];
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, q); uv.getElement(i, w2); pitchVerts.push({ x: q[0] * s[0] + t[0], y: q[1] * s[1] + t[1], z: q[2] * s[2] + t[2], u: w2[0], v: w2[1] }); }
    }
    continue;
  }
  if (!kind && !carPart && !isSeats && !scooterPart) continue;
  const t = n.getTranslation(), s = n.getScale();
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const idx = p.getIndices();
    const count = idx ? idx.getCount() : pos.getCount();
    const v = [0, 0, 0];
    const col = scooterPart ? p.getAttribute('COLOR_0') : null, cv = [0, 0, 0, 0]; // the paint of bikes and mopeds
    const get = (i) => { pos.getElement(idx ? idx.getScalar(i) : i, v); return [v[0] * s[0] + t[0] + off[0], v[1] * s[1] + t[1] + off[1], v[2] * s[2] + t[2] + off[2]]; };
    for (let i = 0; i + 2 < count; i += 3) {
      const tri = [get(i), get(i + 1), get(i + 2)];
      if (partsDef && !GROUND_MESH.test(name) && ownerOf(partsDef, (tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3) !== own) continue;
      if (partsDef && GROUND_MESH.test(name)) for (const q of tri) q[1] -= setDrop(partsDef.sets[own], own);
      if (scooterPart) {
        if (col) { col.getElement(idx ? idx.getScalar(i) : i, cv); tri.rgb = [cv[0], cv[1], cv[2]]; }
        scooterPart.push(tri);
      }
      if (isSeats) { seatTris.push(tri); continue; }
      if (carPart) { carPart.push(tri); continue; }
      if (!kind) continue;
      if (name === 'paint') tri.paint = true;
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
  // the pitch quad and, from its line art, the middle of each goal line (2.6 m and 3.3 m in from the ends)
  if (pitchVerts.length >= 4) {
    const corner = (u, v) => pitchVerts.reduce((a, b) => (Math.hypot(b.u - u, b.v - v) < Math.hypot(a.u - u, a.v - v) ? b : a));
    const A = corner(0, 0), B = corner(1, 0), D = corner(0, 1);
    const at = (u, v) => [A.x + u * (B.x - A.x) + v * (D.x - A.x), A.z + u * (B.z - A.z) + v * (D.z - A.z)].map((n) => +n.toFixed(2));
    stadium.pitch = { y: +A.y.toFixed(2), center: at(0.5, 0.5), goals: [at(0.5, 0.026), at(0.5, 0.968)] };
  }
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

// ground where no set has any (the parts' fill rects): heights interpolated from the nearest
// ground up and down each column (else along the row), so the gap is walkable
if (partsDef?.fill) {
  let filled = 0;
  const known = (i, j) => i >= 0 && j >= 0 && i < W && j < H && ground[j * W + i] > -1e8;
  for (const r of partsDef.fill) {
    const i0 = Math.max(0, Math.floor((r.x0 - X0) / CELL)), i1 = Math.min(W - 1, Math.ceil((r.x1 - X0) / CELL));
    const j0 = Math.max(0, Math.floor((r.z0 - Z0) / CELL)), j1 = Math.min(H - 1, Math.ceil((r.z1 - Z0) / CELL));
    const patch = new Map();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      if (known(i, j)) continue;
      let a = j - 1; while (a >= 0 && j - a < 400 && !known(i, a)) a--;
      let b = j + 1; while (b < H && b - j < 400 && !known(i, b)) b++;
      const hasA = known(i, a), hasB = known(i, b);
      let y = null;
      if (hasA && hasB) y = ground[a * W + i] + (ground[b * W + i] - ground[a * W + i]) * ((j - a) / (b - a));
      else if (hasA || hasB) y = ground[(hasA ? a : b) * W + i];
      if (y !== null) patch.set(j * W + i, y);
    }
    for (const [k, y] of patch) { ground[k] = y; filled++; }
  }
  console.log('filled ground cells', filled);
}
// holes left in the ground (cells enclosed by ground, with none of their own): where a gap
// no set covers still is
{
  const seen = new Uint8Array(W * H), stack = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if ((i === 0 || j === 0 || i === W - 1 || j === H - 1) && ground[j * W + i] < -1e8) { seen[j * W + i] = 1; stack.push(j * W + i); }
  const flood = (k0, keep) => {
    const q = [k0]; seen[k0] = 1; let n = 0, a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    while (q.length) {
      const k = q.pop(); const i = k % W, j = (k - i) / W; n++; a = Math.min(a, i); b = Math.max(b, i); c = Math.min(c, j); d = Math.max(d, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj, kk = jj * W + ii; if (ii < 0 || jj < 0 || ii >= W || jj >= H || seen[kk] || ground[kk] > -1e8) continue; seen[kk] = 1; q.push(kk); }
    }
    return { n, x: [X0 + a * CELL, X0 + (b + 1) * CELL], z: [Z0 + c * CELL, Z0 + (d + 1) * CELL] };
  };
  while (stack.length) { const k = stack.pop(); const i = k % W, j = (k - i) / W; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj, kk = jj * W + ii; if (ii < 0 || jj < 0 || ii >= W || jj >= H || seen[kk] || ground[kk] > -1e8) continue; seen[kk] = 1; stack.push(kk); } }
  const holes = [];
  for (let k = 0; k < W * H; k++) if (!seen[k] && ground[k] < -1e8) holes.push(flood(k));
  holes.sort((p, q) => q.n - p.n);
  console.log('ground holes (m2, x range, z range):', holes.filter((h) => h.n > 400).slice(0, 8).map((h) => `${Math.round(h.n * CELL * CELL)} x${h.x.map(Math.round)} z${h.z.map(Math.round)}`).join(' | ') || 'none');
}

// cars: cluster the paint triangles into vehicles, one drivable car each
const cars = [];
// what of the car paint isn't one of them (a car on a deck or a roof, a van or a bus out of
// the size range, a stray fragment): boxes [x0, y0, z0, x1, y1, z1] cut out of the map too
const junk = [];
const junkBox = (tris, pad = 0.15) => {
  const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const t of tris) for (const q of t) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], q[k]); b[k + 3] = Math.max(b[k + 3], q[k]); }
  junk.push([b[0] - pad, b[1] - 0.5, b[2] - pad, b[3] + pad, b[4] + 0.3, b[5] + pad].map((v) => +v.toFixed(2)));
};
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
    if (ix.length < 20) continue; // lights, mirrors, badges (cut out below with any other loose paint)
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
  // principal axis in plan of a set of vertices, and its extent along and across it
  const measure = (verts) => {
    let mx_ = 0, mz_ = 0, minY = 1e9;
    for (const q of verts) { mx_ += q[0]; mz_ += q[2]; minY = Math.min(minY, q[1]); }
    mx_ /= verts.length; mz_ /= verts.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const q of verts) { const dx = q[0] - mx_, dz = q[2] - mz_; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz); // major axis direction (x = cos, z = sin)
    const ax = Math.cos(ang), az = Math.sin(ang);
    let lo = 1e9, hi = -1e9, lw = 1e9, hw_ = -1e9;
    for (const q of verts) {
      const a = (q[0] - mx_) * ax + (q[2] - mz_) * az, w = (q[0] - mx_) * az - (q[2] - mz_) * ax;
      lo = Math.min(lo, a); hi = Math.max(hi, a); lw = Math.min(lw, w); hw_ = Math.max(hw_, w);
    }
    return { mx_, mz_, minY, ax, az, lo, hi, lw, hw_ };
  };
  // Cars parked bumper to bumper cluster into one long row. Every car has its own glass
  // cabin (windscreen and rear window under one roof): find the cabins along the row and
  // cut at the lowest point of the body between two neighbouring ones. A piece still too
  // long for a car (a van, a truck) stays parked and solid rather than cut in half.
  const glassTris = carParts.carglass;
  const splitRow = (tris) => {
    const verts = tris.flat();
    const m = measure(verts);
    const len = m.hi - m.lo, wid = m.hw_ - m.lw;
    if (len <= 6.8 || wid < 1.4 || wid > 3.1) return [verts];
    const BIN = 0.1, nb = Math.ceil(len / BIN) + 1;
    const along = (q) => (q[0] - m.mx_) * m.ax + (q[2] - m.mz_) * m.az - m.lo;
    const across = (q) => (q[0] - m.mx_) * m.az - (q[2] - m.mz_) * m.ax;
    // body cover: over every stretch of the row, the highest surface that spans it
    const cover = new Float32Array(nb), glass = new Uint8Array(nb);
    const span = (t, fn) => {
      const a = t.map(along);
      const b0 = Math.max(0, Math.floor(Math.min(...a) / BIN)), b1 = Math.min(nb - 1, Math.floor(Math.max(...a) / BIN));
      for (let b = b0; b <= b1; b++) fn(b);
    };
    for (const t of tris) { const y = Math.min(t[0][1], t[1][1], t[2][1]) - m.minY; span(t, (b) => { if (y > cover[b]) cover[b] = y; }); }
    for (const t of glassTris) {
      const c = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3];
      const a = along(c), w = across(c);
      if (a < -0.3 || a > len + 0.3 || w < m.lw - 0.2 || w > m.hw_ + 0.2 || c[1] < m.minY || c[1] > m.minY + 2.6) continue;
      span(t, (b) => { glass[b] = 1; });
    }
    const runs = [];
    for (let b = 0; b < nb; b++) {
      if (!glass[b]) continue;
      const last = runs[runs.length - 1];
      if (last && b - last[1] <= 3) last[1] = b; else runs.push([b, b]);
    }
    // windscreen and rear window of one car: the roof covers the gap between them
    const cabins = [];
    for (const r of runs) {
      const last = cabins[cabins.length - 1];
      if (last) {
        let gapLow = Infinity, peak = 0;
        for (let b = last[1] + 1; b < r[0]; b++) gapLow = Math.min(gapLow, cover[b]);
        for (let b = last[0]; b <= r[1]; b++) peak = Math.max(peak, cover[b]);
        if (gapLow === Infinity || gapLow >= 0.8 * peak) { last[1] = r[1]; continue; }
      }
      cabins.push([...r]);
    }
    const cuts = [];
    for (let i = 0; i + 1 < cabins.length; i++) {
      const from = cabins[i][1] + 1, to = cabins[i + 1][0] - 1;
      if (to < from) continue;
      let low = Infinity;
      for (let b = from; b <= to; b++) low = Math.min(low, cover[b]);
      // the middle of the lowest stretch (where the bumpers meet)
      let run0 = -1, best = null;
      for (let b = from; b <= to + 1; b++) {
        const isLow = b <= to && cover[b] <= low + 0.05;
        if (isLow && run0 < 0) run0 = b;
        if (!isLow && run0 >= 0) { if (!best || b - run0 > best[1] - best[0]) best = [run0, b]; run0 = -1; }
      }
      cuts.push(((best[0] + best[1]) / 2) * BIN);
    }
    if (process.env.DBG) console.log('ROW', len.toFixed(1), 'cabins', cabins.map((c) => `${(c[0] * BIN).toFixed(1)}-${(c[1] * BIN).toFixed(1)}`).join(' '), 'cuts', cuts.map((c) => c.toFixed(1)).join(' '));
    if (!cuts.length) return [verts];
    const out = Array.from({ length: cuts.length + 1 }, () => []);
    verts.forEach((q) => { const a = along(q); let k = 0; while (k < cuts.length && a > cuts[k]) k++; out[k].push(q); });
    return out.filter((v) => v.length > 30);
  };
  for (const cl of clusters.values()) {
    const all = [];
    for (const p of cl) for (const i of p.ix) all.push(carParts.carpaint[i]);
    for (const verts of splitRow(all)) {
    let { mx_, mz_, minY, ax, az, lo, hi, lw, hw_ } = measure(verts);
    const len = hi - lo, wid = hw_ - lw;
    if (len < 3 || len > 6.8 || wid < 1.4 || wid > 3.1) { junkBox(verts); continue; }
    // centre on the body's extent, not the vertex mean
    const ca = (hi + lo) / 2, cw = (hw_ + lw) / 2;
    const cx = mx_ + ax * ca + az * cw, cz = mz_ + az * ca - ax * cw;
    const k = cellOf(cx, cz);
    if (k < 0 || ground[k] < -1e8) { junkBox(verts); continue; }
    const off = minY - ground[k];
    if (off < -0.4 || off > 1.7) { junkBox(verts); continue; } // parked on a deck or a roof, not on the street
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
}
// Every parked car found. A couple of hundred of them are drivable (chosen at the end, see
// pickDrivable); the rest are cut out of the map at load, so none is left as a shell that
// can't be driven, and none blocks walking (pass 2 lets every car through).
console.log('parked cars', cars.length);
// The solid pass samples every facade triangle. A car only covers its own few metres,
// so each sample checks the cars in that cell instead of all of them.
const carGrid = new Map();
const CAR_CELL = 8;
for (const c of cars) {
  c._s = Math.sin(c.yaw); c._co = Math.cos(c.yaw);
  const r = Math.hypot(c.hl, c.hw) + 0.3;
  for (let i = Math.floor((c.x - r) / CAR_CELL); i <= Math.floor((c.x + r) / CAR_CELL); i++) {
    for (let j = Math.floor((c.z - r) / CAR_CELL); j <= Math.floor((c.z + r) / CAR_CELL); j++) {
      const k = `${i},${j}`;
      const list = carGrid.get(k);
      if (list) list.push(c); else carGrid.set(k, [c]);
    }
  }
}
const inCar = (x, z) => {
  const list = carGrid.get(`${Math.floor(x / CAR_CELL)},${Math.floor(z / CAR_CELL)}`);
  if (!list) return false;
  for (const c of list) {
    const dx = x - c.x, dz = z - c.z;
    if (Math.abs(dx * c._s + dz * c._co) < c.hl + 0.3 && Math.abs(dx * c._co - dz * c._s) < c.hw + 0.3) return true;
  }
  return false;
};

// scooters: each parked scooter has one handlebar mast piece (~1.2 m tall) beside a deck piece.
// Find the masts, aim each scooter from its deck to its mast, and note the original parts to
// remove so a rideable scooter can take their place.
const scooters = [];
{
  const key = (q) => `${Math.round(q[0] * 50)},${Math.round(q[1] * 50)},${Math.round(q[2] * 50)}`;
  const comps = [];
  for (const list of Object.values(scooterParts)) {
    const par = new Map();
    const find = (a) => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
    for (const t of list) for (const q of t) { const k = key(q); if (!par.has(k)) par.set(k, k); }
    for (const t of list) { const a = find(key(t[0])); for (let i = 1; i < 3; i++) { const b = find(key(t[i])); if (a !== b) par.set(b, a); } }
    const groups = new Map();
    list.forEach((t, i) => { const r = find(key(t[0])); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
    for (const ix of groups.values()) {
      if (ix.length < 50 || ix.length > 400) continue;
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const i of ix) for (const q of list[i]) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
      const sy = mx[1] - mn[1], plan = Math.max(mx[0] - mn[0], mx[2] - mn[2]);
      if (sy < 1.1 || sy > 1.3 || plan > 1.8) continue;
      const k0 = cellOf((mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2);
      if (k0 < 0 || ground[k0] < -1e8 || mn[1] - ground[k0] > 0.8) continue;
      // principal axis of the piece in plan
      let cx = 0, cz = 0, cn = 0;
      for (const i of ix) for (const q of list[i]) { cx += q[0]; cz += q[2]; cn++; }
      cx /= cn; cz /= cn;
      let sxx = 0, szz = 0, sxz = 0;
      for (const i of ix) for (const q of list[i]) { const dx = q[0] - cx, dz = q[2] - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
      const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      comps.push({ n: ix.length, mn, mx, plan, narrow: Math.min(mx[0] - mn[0], mx[2] - mn[2]), c: [(mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2], y: ground[k0], axis: [Math.cos(ang), Math.sin(ang)] });
    }
  }
  const masts = comps.filter((c) => c.n <= 70 && c.plan >= 0.4 && c.plan < 0.6);
  const decks = comps.filter((c) => c.n > 70 && c.plan >= 0.55);
  // one scooter per deck piece (a blob of about two decks counts as two); the nose points at
  // the nearest handlebar mast
  const remove = new Set();
  for (const d of decks) {
    let mast = null, best = 1.5;
    for (const m of masts) { const dd = Math.hypot(m.c[0] - d.c[0], m.c[1] - d.c[1]); if (dd < best) { best = dd; mast = m; } }
    let [ax, az] = d.axis;
    if (d.narrow > 0.9) { // two scooters side by side: lay the axis along the longer side
      if (d.mx[0] - d.mn[0] < d.mx[2] - d.mn[2]) { ax = 0; az = 1; } else { ax = 1; az = 0; }
    }
    if (mast && (mast.c[0] - d.c[0]) * ax + (mast.c[1] - d.c[1]) * az < 0) { ax = -ax; az = -az; }
    const copies = d.n > 200 && d.narrow > 0.9 ? 2 : 1;
    for (let k = 0; k < copies; k++) {
      const off = copies === 2 ? (k === 0 ? -0.3 : 0.3) : 0;
      scooters.push({ x: +(d.c[0] - az * off).toFixed(2), z: +(d.c[1] + ax * off).toFixed(2), y: +d.y.toFixed(2), yaw: +Math.atan2(ax, az).toFixed(3) });
    }
    remove.add(d);
  }
  for (const m of masts) remove.add(m); // every handlebar mast is part of a scooter being replaced
  var scooterRemove = [...remove].map((c) => [c.mn, c.mx].flat().map((v) => +v.toFixed(2)));
  console.log('rideable scooters', scooters.length, 'parts to replace', scooterRemove.length);
}

function inScooterBox(t) {
  const x = (t[0][0] + t[1][0] + t[2][0]) / 3, y = (t[0][1] + t[1][1] + t[2][1]) / 3, z = (t[0][2] + t[1][2] + t[2][2]) / 3;
  return scooterRemove.some((b) => x > b[0] - 0.05 && x < b[3] + 0.05 && y > b[1] - 0.05 && y < b[4] + 0.05 && z > b[2] - 0.05 && z < b[5] + 0.05);
}

// Bicycles and mopeds parked in the street: the paint and metal pieces that touch, put
// together, measured. A moped is about 2 m long and 1.1 m high, a bicycle 1.7 m and 0.95 m,
// both standing on the ground and mostly black (the tyres). Each becomes a rideable one
// ({x, z, y, yaw, kind, color}); the originals are cut out (rideRemove, like the scooters).
const rides = [];
var rideRemove = [];
{
  const all = [...scooterParts.paint, ...scooterParts.metal].filter((t) => !inScooterBox(t));
  const key = (q) => `${Math.round(q[0] * 100)},${Math.round(q[1] * 100)},${Math.round(q[2] * 100)}`;
  const par = new Map();
  const find = (a) => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
  for (const t of all) for (const q of t) { const k = key(q); if (!par.has(k)) par.set(k, k); }
  for (const t of all) { const a = find(key(t[0])); for (let i = 1; i < 3; i++) { const b = find(key(t[i])); if (a !== b) par.set(b, a); } }
  // the pieces that touch (within pad) put together: a list of triangle lists, one an object
  const groupObjects = (list, pad) => {
    const byRoot = new Map();
    for (const t of list) { const r = find(key(t[0])); (byRoot.get(r) || byRoot.set(r, []).get(r)).push(t); }
    const pieces = [...byRoot.values()].map((ts) => {
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const t of ts) for (const q of t) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
      return { ts, mn, mx };
    }).filter((pc) => pc.mx[1] - pc.mn[1] < 1.6 && Math.max(pc.mx[0] - pc.mn[0], pc.mx[2] - pc.mn[2]) < 2.4);
    // pieces whose boxes touch (within pad) make one object
    const G = new Map();
    pieces.forEach((pc, i) => {
      for (let x = Math.floor(pc.mn[0] - pad); x <= Math.floor(pc.mx[0] + pad); x++) for (let z = Math.floor(pc.mn[2] - pad); z <= Math.floor(pc.mx[2] + pad); z++) {
        const k = `${x},${z}`; (G.get(k) || G.set(k, []).get(k)).push(i);
      }
    });
    const up = pieces.map((_, i) => i);
    const f = (a) => { while (up[a] !== a) { up[a] = up[up[a]]; a = up[a]; } return a; };
    for (const list of G.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = pieces[list[a]], B = pieces[list[b]];
      if (A.mn[0] > B.mx[0] + pad || B.mn[0] > A.mx[0] + pad || A.mn[1] > B.mx[1] + pad || B.mn[1] > A.mx[1] + pad || A.mn[2] > B.mx[2] + pad || B.mn[2] > A.mx[2] + pad) continue;
      up[f(list[b])] = f(list[a]);
    }
    const objs = new Map();
    pieces.forEach((pc, i) => { const r = f(i); (objs.get(r) || objs.set(r, []).get(r)).push(pc); });
    return [...objs.values()].map((ps) => ps.flatMap((pc) => pc.ts));
  };

  // what an object is, by its size: a bicycle is under 1 m high, a moped and a kick scooter
  // taller (a kick scooter short and narrow); triangles a vehicle, to split rows parked
  // tight enough to touch
  const TYPICAL = { kick: 124, bike: 316, moped: 300 };
  const classify = (L, W, H) => (H > 0.82 && H < 1.0 && L > 1.5 && L < 1.98 && W < 0.8 ? 'bike'
    : H >= 1.0 && H < 1.32 && L > 1.75 && L < 2.2 && W < 0.95 ? 'moped'
      : H > 1.04 && H < 1.32 && L > 0.95 && L < 1.38 && W < 0.45 ? 'kick' : null);
  const measure = (ts) => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const t of ts) for (const q of t) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
    let cx = 0, cz = 0, cn = 0;
    for (const t of ts) for (const q of t) { cx += q[0]; cz += q[2]; cn++; }
    cx /= cn; cz /= cn;
    let sxx = 0, szz = 0, sxz = 0;
    for (const t of ts) for (const q of t) { const dx = q[0] - cx, dz = q[2] - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const ax = Math.cos(ang), az = Math.sin(ang);
    let lo = 1e9, hi = -1e9, wlo = 1e9, whi = -1e9;
    for (const t of ts) for (const q of t) { const a = (q[0] - cx) * ax + (q[2] - cz) * az, w = (q[0] - cx) * az - (q[2] - cz) * ax; lo = Math.min(lo, a); hi = Math.max(hi, a); wlo = Math.min(wlo, w); whi = Math.max(whi, w); }
    return { mn, mx, cx, cz, ax, az, lo, hi, wlo, whi, L: hi - lo, W: whi - wlo, H: mx[1] - mn[1] };
  };
  // k groups of triangles by their plan position (a few rounds of k-means)
  const split = (ts, k) => {
    const cs = ts.map((t) => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3]);
    const m = measure(ts);
    let cent = Array.from({ length: k }, (_, i) => { const w = m.wlo + ((i + 0.5) / k) * (m.whi - m.wlo), a = (m.lo + m.hi) / 2; return [m.cx + m.ax * a + m.az * w, m.cz + m.az * a - m.ax * w]; });
    let lab = new Array(ts.length).fill(0);
    for (let it = 0; it < 12; it++) {
      lab = cs.map((c) => { let b = 0, bd = 1e9; cent.forEach((e, j) => { const d = (c[0] - e[0]) ** 2 + (c[1] - e[1]) ** 2; if (d < bd) { bd = d; b = j; } }); return b; });
      cent = cent.map((e, j) => { let x = 0, z = 0, n = 0; cs.forEach((c, i) => { if (lab[i] === j) { x += c[0]; z += c[1]; n++; } }); return n ? [x / n, z / n] : e; });
    }
    return cent.map((_, j) => ts.filter((_, i) => lab[i] === j)).filter((g) => g.length);
  };
  const consider = (ts, depth = 0, only = null) => {
    const m = measure(ts);
    const H = m.H;
    let kind = classify(m.L, m.W, H);
    if (only && kind !== only) return;
    if (!kind) {
      // a row of them touching: split by how many it would hold, each part on its own
      if (depth === 0 && H > 0.82 && H < 1.32) {
        const per = H < 1.0 ? TYPICAL.bike : TYPICAL.kick;
        const k = Math.round(ts.length / per);
        if (k >= 2 && k <= 12) for (const g of split(ts, k)) consider(g, 1, only);
      }
      if (process.env.RIDE_DBG && depth === 0 && H > 0.8 && H < 1.4 && m.L > 0.8 && m.L < 3) console.log('REJECT', JSON.stringify({ at: [m.cx, m.cz].map((v) => +v.toFixed(1)), L: +m.L.toFixed(2), W: +m.W.toFixed(2), H: +H.toFixed(2), n: ts.length }));
      return;
    }
    // the colours: mostly black (tyres, seat, frame joints), the rest is its paint
    let black = 0, paintN = 0, coloured = 0; const paintC = [0, 0, 0];
    for (const t of ts) {
      const c = t.rgb; if (!c) continue;
      coloured++;
      if (c[0] + c[1] + c[2] < 0.12) black++; else { paintN++; paintC[0] += c[0]; paintC[1] += c[1]; paintC[2] += c[2]; }
    }
    if (coloured && black < coloured * 0.3) return;
    const k0 = cellOf(m.cx, m.cz);
    if (k0 < 0 || ground[k0] < -1e8 || Math.abs(m.mn[1] - ground[k0]) > 0.2) return; // standing on the street
    // the nose: the end with the highest part (handlebars, a moped's front shield)
    let { ax, az } = m;
    let topF = -1e9, topB = -1e9;
    const mid = (m.lo + m.hi) / 2;
    for (const t of ts) for (const q of t) { const a = (q[0] - m.cx) * ax + (q[2] - m.cz) * az; if (a > mid) topF = Math.max(topF, q[1]); else topB = Math.max(topB, q[1]); }
    if (topB > topF + 0.02) { ax = -ax; az = -az; }
    const wc = (m.wlo + m.whi) / 2, ac = mid * (ax === m.ax ? 1 : -1);
    const color = paintN ? paintC.map((v) => Math.round((v / paintN) * 255)) : [40, 40, 44];
    rides.push({
      x: +(m.cx + m.ax * mid + m.az * wc).toFixed(2), z: +(m.cz + m.az * mid - m.ax * wc).toFixed(2), y: +ground[k0].toFixed(2),
      yaw: +Math.atan2(ax, az).toFixed(3), kind, color,
    });
    void ac;
    rideRemove.push([m.mn[0] - 0.05, m.mn[1] - 0.05, m.mn[2] - 0.05, m.mx[0] + 0.05, m.mx[1] + 0.05, m.mx[2] + 0.05].map((v) => +v.toFixed(2)));
  };
  // two passes: mopeds come in more pieces, joined only when grouped loosely; bikes and
  // kick scooters park close enough that loose grouping runs them together
  const used = new Set();
  const take = (ts, only) => { const n = rides.length; consider(ts, 0, only); if (rides.length > n) for (const t of ts) used.add(t); };
  for (const ts of groupObjects(all, 0.08)) take(ts, 'moped');
  for (const ts of groupObjects(all.filter((t) => !used.has(t)), 0.03)) take(ts, null);
  console.log('rideable bikes', rides.filter((r) => r.kind === 'bike').length, 'mopeds', rides.filter((r) => r.kind === 'moped').length, 'kick scooters', rides.filter((r) => r.kind === 'kick').length);
}

const rideGrid = new Map();
for (const b of [...scooterRemove, ...rideRemove]) {
  for (let i = Math.floor((b[0] - 0.1) / 8); i <= Math.floor((b[3] + 0.1) / 8); i++) {
    for (let j = Math.floor((b[2] - 0.1) / 8); j <= Math.floor((b[5] + 0.1) / 8); j++) {
      const k = `${i},${j}`;
      (rideGrid.get(k) || rideGrid.set(k, []).get(k)).push(b);
    }
  }
}
const inScooter = (x, y, z) => (rideGrid.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`) || []).some((b) => x > b[0] - 0.1 && x < b[3] + 0.1 && y > b[1] - 0.1 && y < b[4] + 0.1 && z > b[2] - 0.1 && z < b[5] + 0.1);

// Whatever car paint isn't inside a car found (fragments too small to measure, rows that
// split into short bits, vans, cars on decks): grouped by neighbouring 2 m cells, each
// group boxed and cut out of the map with the rest, so no car is left that can't be driven.
{
  const loose = carParts.carpaint.filter((t) => !inCar((t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3));
  const C = 2, cellKey = (x, z) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
  const byCell = new Map();
  for (const t of loose) {
    const k = cellKey((t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3);
    (byCell.get(k) || byCell.set(k, []).get(k)).push(t);
  }
  const seen = new Set();
  for (const k0 of byCell.keys()) {
    if (seen.has(k0)) continue;
    const group = [], stack = [k0];
    seen.add(k0);
    while (stack.length) {
      const k = stack.pop();
      for (const t of byCell.get(k)) group.push(t);
      const [i, j] = k.split(',').map(Number);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const n = `${i + di},${j + dj}`;
        if (byCell.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    junkBox(group, 0.35);
  }
  console.log('loose car paint', loose.length, 'triangles in', junk.length, 'boxes');
}
const junkGrid = new Map();
for (const b of junk) for (let i = Math.floor(b[0] / 8); i <= Math.floor(b[3] / 8); i++) for (let j = Math.floor(b[2] / 8); j <= Math.floor(b[5] / 8); j++) {
  const k = `${i},${j}`; (junkGrid.get(k) || junkGrid.set(k, []).get(k)).push(b);
}
const inJunk = (x, y, z) => (junkGrid.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`) || []).some((b) => x > b[0] && x < b[3] && y > b[1] && y < b[4] && z > b[2] && z < b[5]);
// pass 2: things standing on it (car bodies too: inCar() lets the drivable ones through)
for (const t of carParts.carpaint) tris.solid.push(t); // (a spread overflows the stack on a big map)
const low = new Uint8Array(W * H), tall = new Uint8Array(W * H);
for (const tri of tris.solid) {
  const paint = tri.paint;
  sample(tri, CELL * 0.5, (x, y, z) => {
    if (paint && stadiumCell(x, z)) return; // the stadium's walls and gates are laid out by stadium.js
    const k = cellOf(x, z);
    if (k < 0 || ground[k] < -1e8) return;
    const d = y - ground[k];
    if (d < 2.4 && inCar(x, z)) return; // part of a car (every car is drivable or cut out)
    if (inJunk(x, y, z)) return; // car paint cut out of the map
    if (inScooter(x, y, z)) return; // replaced by a rideable scooter
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
if (process.env.DBG) {
  const top = sizes.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0]).slice(0, 4);
  console.log('top regions m2', top.map(([n, i]) => `${i}:${(n * CELL * CELL).toFixed(0)}`).join(' '));
  for (const [, id] of top.slice(1, 2)) {
    let sx = 0, sz = 0, c = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 0; k < W * H; k++) if (comp[k] === id) { const x = X0 + (k % W) * CELL, z = Z0 + ((k / W) | 0) * CELL; sx += x; sz += z; c++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    console.log(`region ${id} centre ${(sx / c).toFixed(0)},${(sz / c).toFixed(0)} spans x ${x0.toFixed(0)}..${x1.toFixed(0)} z ${z0.toFixed(0)}..${z1.toFixed(0)}`);
  }
}
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
// rival spawn candidates: a 12 m lattice over the main open region, with room to stand
const spots = [];
for (let j = 0; j < H; j += 24) for (let i = 0; i < W; i += 24) {
  const k = j * W + i;
  if (comp[k] === main && dist[k] * CELL >= 3) spots.push([+(X0 + (i + 0.5) * CELL).toFixed(1), +(Z0 + (j + 0.5) * CELL).toFixed(1)]);
}
console.log('rival spawn candidates', spots.length);
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
// The drivable ones: the three nearest every place a round starts (the stitched map's
// plazas, else the spawn), then an even spread of the rest, up to MAX_CARS.
const MAX_CARS = 200;
const starts = partsDef?.plazas || [{ x: sx, z: sz }];
const chosen = new Set();
for (const st of starts) {
  const near = cars.map((c) => [c, Math.hypot(c.x - st.x, c.z - st.z)]).sort((a, b) => a[1] - b[1]).slice(0, 3);
  for (const [c] of near) chosen.add(c);
  console.log(`start ${st.x.toFixed(0)},${st.z.toFixed(0)}: nearest cars at ${near.map((n) => n[1].toFixed(0)).join(', ')} m`);
}
const rest = cars.filter((c) => !chosen.has(c));
const room = Math.max(0, MAX_CARS - chosen.size);
if (rest.length <= room) for (const c of rest) chosen.add(c);
else for (let i = 0, step = rest.length / room; i < room; i++) chosen.add(rest[Math.floor(i * step)]);
const carRec = (c) => ({ x: c.x, z: c.z, y: c.y, yaw: c.yaw, hl: c.hl, hw: c.hw });
const drivable = cars.filter((c) => chosen.has(c)).map(carRec);
const shells = cars.filter((c) => !chosen.has(c)).map(carRec);
console.log('drivable cars', drivable.length, 'removed shells', shells.length);

const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
const out = {
  cell: CELL, x0: X0, z0: Z0, w: W, h: H,
  hcell: HC, hw, hh, heights: b64(hs),
  boxes,
  spawn: { x: +sx.toFixed(2), z: +sz.toFixed(2), y: +(ground[best]).toFixed(2), yaw: +yaw.toFixed(3) },
  cars: drivable,
  shells,
  carJunk: junk,
  scooters,
  scooterRemove,
  rides,
  rideRemove,
  spots,
  stadium,
  bounds: { minX, maxX, minZ, maxZ },
};
fs.writeFileSync(path.join(DIR, 'nav.json'), JSON.stringify(out));
console.log('wrote nav.json', (fs.statSync(path.join(DIR, 'nav.json')).size / 1024).toFixed(0), 'KB');
