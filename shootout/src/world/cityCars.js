import * as THREE from 'three';

// City sets bake every parked car into a handful of shared meshes. Given the car
// boxes found by bake-dizengoff-nav.mjs, this cuts each car's triangles out of
// those meshes into its own Group (in the car's own frame, +z forward) so the
// driving code can move it. The triangles are removed from the shared meshes.
const CAR_MESHES = new Set(['carpaint', 'carglass', 'metal', 'paint']);
const PAD = 0.25;
const CELL = 8;

// Tinted, see-through car glass. The HDR target keeps scene depth in alpha (see
// engine/patch.js), so the blend leaves the destination alpha untouched.
let glassMat = null;
function cityGlass(src) {
  if (glassMat) return glassMat;
  glassMat = new THREE.MeshPhysicalMaterial({
    name: 'city-car-glass', color: 0x1c262c, roughness: 0.04, metalness: 0, ior: 1.52,
    envMapIntensity: 1.6, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
  });
  glassMat.blending = THREE.CustomBlending;
  glassMat.blendSrc = THREE.SrcAlphaFactor;
  glassMat.blendDst = THREE.OneMinusSrcAlphaFactor;
  glassMat.blendSrcAlpha = THREE.ZeroFactor;
  glassMat.blendDstAlpha = THREE.OneFactor;
  glassMat.userData = src?.userData || {};
  return glassMat;
}

/**
 * Which window a glass triangle belongs to, in the car's own frame (+z forward,
 * +x the car's left): sideways-facing glass is a side window, front or rear half by
 * the middle of the side glass; the rest is the windscreen or the rear window.
 */
export function paneOf(cx, cz, nx, nz, midZ, sideMidZ) {
  if (Math.abs(nx) > Math.abs(nz) * 1.2) return `${cx > 0 ? 'left' : 'right'}${cz > sideMidZ ? 'F' : 'R'}`;
  return cz > midZ ? 'wind' : 'rear';
}

function splitPanes(p) {
  const tris = [];
  for (let i = 0; i + 9 <= p.pos.length; i += 9) {
    const a = [p.pos[i], p.pos[i + 1], p.pos[i + 2]], b = [p.pos[i + 3], p.pos[i + 4], p.pos[i + 5]], c = [p.pos[i + 6], p.pos[i + 7], p.pos[i + 8]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1;
    tris.push({ i, c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], n: n.map((v) => v / l) });
  }
  if (!tris.length) return null;
  const zs = tris.map((t) => t.c[2]);
  const midZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const side = tris.filter((t) => Math.abs(t.n[0]) > Math.abs(t.n[2]) * 1.2).map((t) => t.c[2]);
  const sideMidZ = side.length ? (Math.min(...side) + Math.max(...side)) / 2 : midZ;
  const out = {};
  for (const t of tris) {
    const name = paneOf(t.c[0], t.c[2], t.n[0], t.n[2], midZ, sideMidZ);
    const o = out[name] || (out[name] = { pos: [], nor: [], uv: [] });
    o.pos.push(...p.pos.slice(t.i, t.i + 9));
    if (p.nor.length) o.nor.push(...p.nor.slice(t.i, t.i + 9));
    if (p.uv.length) o.uv.push(...p.uv.slice((t.i / 3) * 2, (t.i / 3) * 2 + 6));
  }
  return out;
}

const boxOf = (pos, pad = 0.03) => {
  const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  for (let i = 0; i < pos.length; i += 3) {
    b.x0 = Math.min(b.x0, pos[i]); b.x1 = Math.max(b.x1, pos[i]);
    b.y0 = Math.min(b.y0, pos[i + 1]); b.y1 = Math.max(b.y1, pos[i + 1]);
    b.z0 = Math.min(b.z0, pos[i + 2]); b.z1 = Math.max(b.z1, pos[i + 2]);
  }
  for (const [lo, hi] of [['x0', 'x1'], ['y0', 'y1'], ['z0', 'z1']]) { b[lo] -= pad; b[hi] += pad; }
  return b;
};

export function extractCityCars(root, cars) {
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  cars.forEach((c, n) => {
    const r = Math.hypot(c.hl, c.hw) + PAD;
    for (let i = Math.floor((c.x - r) / CELL); i <= Math.floor((c.x + r) / CELL); i++) {
      for (let j = Math.floor((c.z - r) / CELL); j <= Math.floor((c.z + r) / CELL); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(n);
      }
    }
  });
  const trig = cars.map((c) => ({ s: Math.sin(c.yaw), c: Math.cos(c.yaw) }));
  const parts = cars.map(() => new Map());

  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !CAR_MESHES.has(o.name)) return;
    const g = o.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const index = g.index;
    const count = index ? index.count : pos.count;
    const id = (i) => (index ? index.getX(i) : i);
    const keep = [];
    const normalMat = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const nv = new THREE.Vector3();
    for (let t = 0; t + 2 < count; t += 3) {
      const a = id(t), b = id(t + 1), c = id(t + 2);
      va.fromBufferAttribute(pos, a).applyMatrix4(o.matrixWorld);
      vb.fromBufferAttribute(pos, b).applyMatrix4(o.matrixWorld);
      vc.fromBufferAttribute(pos, c).applyMatrix4(o.matrixWorld);
      const cx = (va.x + vb.x + vc.x) / 3, cy = (va.y + vb.y + vc.y) / 3, cz = (va.z + vb.z + vc.z) / 3;
      const cand = grid.get(key(Math.floor(cx / CELL), Math.floor(cz / CELL)));
      let hit = -1;
      if (cand) {
        for (const n of cand) {
          const car = cars[n];
          if (cy < car.y - 0.35 || cy > car.y + 2.4) continue;
          const dx = cx - car.x, dz = cz - car.z;
          const along = dx * trig[n].s + dz * trig[n].c, side = dx * trig[n].c - dz * trig[n].s;
          if (Math.abs(along) < car.hl + PAD && Math.abs(side) < car.hw + PAD) { hit = n; break; }
        }
      }
      if (hit < 0) { keep.push(a, b, c); continue; }
      const car = cars[hit], { s, c: co } = trig[hit];
      let p = parts[hit].get(o);
      if (!p) { p = { pos: [], nor: [], uv: [] }; parts[hit].set(o, p); }
      [[a, va], [b, vb], [c, vc]].forEach(([vi, v]) => {
        const dx = v.x - car.x, dz = v.z - car.z;
        p.pos.push(dx * co - dz * s, v.y - car.y, dx * s + dz * co);
        if (nor) {
          nv.fromBufferAttribute(nor, vi).applyMatrix3(normalMat).normalize();
          p.nor.push(nv.x * co - nv.z * s, nv.y, nv.x * s + nv.z * co);
        }
        if (uv) p.uv.push(uv.getX(vi), uv.getY(vi));
      });
    }
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1));
  });

  const out = [];
  cars.forEach((car, n) => {
    if (!parts[n].size) return;
    // rest the tyres on the ground: the car origin sits at ground height
    let low = Infinity;
    for (const p of parts[n].values()) for (let i = 1; i < p.pos.length; i += 3) low = Math.min(low, p.pos[i]);
    if (low > -1 && low < 1) for (const p of parts[n].values()) for (let i = 1; i < p.pos.length; i += 3) p.pos[i] -= low;
    const group = new THREE.Group();
    group.name = 'city-car';
    const build = (p, material, name) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      if (p.nor.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      if (p.uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    // Glass: one see-through mesh per window, so a shot breaks the window it hits.
    let panes = null, paneBoxes = null;
    for (const [src, p] of parts[n]) {
      const split = src.name === 'carglass' ? splitPanes(p) : null;
      if (!split) { build(p, src.material, src.name); continue; }
      panes = {}; paneBoxes = {};
      for (const [name, q] of Object.entries(split)) {
        panes[name] = build(q, cityGlass(src.material), `pane-${name}`);
        panes[name].castShadow = false;
        paneBoxes[name] = boxOf(q.pos);
      }
    }
    out.push({ x: car.x, z: car.z, yaw: car.yaw, y: car.y, mesh: group, panes, paneBoxes });
  });
  return out;
}

/**
 * Removes the triangles whose centre lies inside any of the boxes ([minx, miny, minz, maxx, maxy, maxz])
 * from the shared paint/metal meshes: the original parked scooters, which get rideable replacements.
 */
export function removeInBoxes(root, boxes, pad = 0.04) {
  root.updateMatrixWorld(true);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  let removed = 0;
  root.traverse((o) => {
    if (!o.isMesh || !CAR_MESHES.has(o.name)) return;
    const g = o.geometry, pos = g.attributes.position, index = g.index;
    const count = index ? index.count : pos.count;
    const id = (i) => (index ? index.getX(i) : i);
    const keep = [];
    for (let t = 0; t + 2 < count; t += 3) {
      const a = id(t), b = id(t + 1), c = id(t + 2);
      va.fromBufferAttribute(pos, a).applyMatrix4(o.matrixWorld);
      vb.fromBufferAttribute(pos, b).applyMatrix4(o.matrixWorld);
      vc.fromBufferAttribute(pos, c).applyMatrix4(o.matrixWorld);
      const x = (va.x + vb.x + vc.x) / 3, y = (va.y + vb.y + vc.y) / 3, z = (va.z + vb.z + vc.z) / 3;
      let hit = false;
      for (const bx of boxes) {
        if (x > bx[0] - pad && x < bx[3] + pad && y > bx[1] - pad && y < bx[4] + pad && z > bx[2] - pad && z < bx[5] + pad) { hit = true; break; }
      }
      if (hit) removed++; else keep.push(a, b, c);
    }
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1));
  });
  return removed;
}
