import * as THREE from 'three';

// City sets bake every parked car into a handful of shared meshes. Given the car
// boxes found by bake-dizengoff-nav.mjs, this cuts each car's triangles out of
// those meshes into its own Group (in the car's own frame, +z forward) so the
// driving code can move it. The triangles are removed from the shared meshes.
const CAR_MESHES = new Set(['carpaint', 'carglass', 'metal', 'paint']);
const PAD = 0.25;
const CELL = 8;

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
    for (const [src, p] of parts[n]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      if (p.nor.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      if (p.uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, src.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    out.push({ x: car.x, z: car.z, yaw: car.yaw, y: car.y, mesh: group });
  });
  return out;
}
