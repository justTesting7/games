import * as THREE from 'three';

// Crash dents: the bodywork around the point of a hard hit is pushed in, deepest at the
// contact and fading out over half a metre or so, with a little crumple noise. The car
// bodies are low-poly, so a part is first cut into small triangles (once, on its first
// dent) and from then on drawn on its own instead of in the car batch. Flat normals keep
// the faceted look and make a dent catch the light. Cosmetic: not synced.

const MAX_TOTAL = 0.6; // metres of dent depth a car can take in all
const EDGE = 0.2; // metres: the longest triangle edge after cutting
const MAX_TRIS = 24000;
const _inv = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();

function partsOf(car) {
  if (car.batched?.length) return car.batched;
  if (!car.ownParts) {
    car.ownParts = [];
    car.mesh.traverse((o) => { if (o.isMesh && o.geometry?.attributes.position) car.ownParts.push({ mesh: o }); });
  }
  return car.ownParts;
}

// flat normals again for the triangles that moved (the geometry is non-indexed)
function flatNormals(g, hit) {
  const p = g.attributes.position.array, nrm = g.attributes.normal;
  const n = nrm.array;
  for (let v = 0; v + 2 < hit.length; v += 3) {
    if (!(hit[v] | hit[v + 1] | hit[v + 2])) continue;
    const a = v * 3, b = a + 3, c = a + 6;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 9; k += 3) { n[a + k] = nx; n[a + k + 1] = ny; n[a + k + 2] = nz; }
  }
  nrm.needsUpdate = true;
}

function onWheel(car, o) {
  for (let p = o; p && p !== car.mesh; p = p.parent) if (car.wheels.includes(p)) return true;
  return false;
}

/**
 * A float, non-indexed copy of g whose triangles are split along their longest edge until
 * no edge is longer than maxLen (quantised attributes are decoded on the way). With
 * near = {center, radius} only triangles reaching that sphere are split.
 */
export function tessellate(g, maxLen, near = null) {
  const names = ['position', 'uv', 'color'].filter((n) => g.attributes[n]);
  const attrs = names.map((n) => g.attributes[n]);
  const sizes = attrs.map((a) => a.itemSize);
  const stride = sizes.reduce((a, b) => a + b, 0);
  // every vertex decoded once into one flat array: [pos, uv, color] per vertex
  const n = g.attributes.position.count;
  const src = new Float32Array(n * stride);
  let off = 0;
  for (const a of attrs) {
    const plain = a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < a.itemSize; c++) src[i * stride + off + c] = plain ? a.array[i * a.itemSize + c] : a.getComponent(i, c);
    }
    off += a.itemSize;
  }
  const idx = g.index;
  const count = idx ? idx.count : n;
  let out = new Float32Array(Math.max(count * 2, 3072) * stride), len = 0;
  const emit = (arr, o) => {
    if (len + stride > out.length) { const bigger = new Float32Array(out.length * 2); bigger.set(out); out = bigger; }
    for (let c = 0; c < stride; c++) out[len++] = arr[o + c];
  };
  const max2 = maxLen * maxLen;
  const cx = near?.center.x, cy = near?.center.y, cz = near?.center.z, R = near?.radius;
  const stack = [];
  let tris = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const a = (idx ? idx.getX(i) : i) * stride, b = (idx ? idx.getX(i + 1) : i + 1) * stride, c = (idx ? idx.getX(i + 2) : i + 2) * stride;
    if (near) {
      // the triangle's bounding sphere (centroid, farthest corner) against the dent's
      const mx = (src[a] + src[b] + src[c]) / 3, my = (src[a + 1] + src[b + 1] + src[c + 1]) / 3, mz = (src[a + 2] + src[b + 2] + src[c + 2]) / 3;
      const ra = (src[a] - mx) ** 2 + (src[a + 1] - my) ** 2 + (src[a + 2] - mz) ** 2;
      const rb = (src[b] - mx) ** 2 + (src[b + 1] - my) ** 2 + (src[b + 2] - mz) ** 2;
      const rc = (src[c] - mx) ** 2 + (src[c + 1] - my) ** 2 + (src[c + 2] - mz) ** 2;
      const reach = R + Math.sqrt(Math.max(ra, rb, rc));
      if ((mx - cx) ** 2 + (my - cy) ** 2 + (mz - cz) ** 2 > reach * reach) { emit(src, a); emit(src, b); emit(src, c); tris++; continue; }
    }
    // already small enough: straight through, no splitting
    const e0 = (src[a] - src[b]) ** 2 + (src[a + 1] - src[b + 1]) ** 2 + (src[a + 2] - src[b + 2]) ** 2;
    const e1 = (src[b] - src[c]) ** 2 + (src[b + 1] - src[c + 1]) ** 2 + (src[b + 2] - src[c + 2]) ** 2;
    const e2 = (src[c] - src[a]) ** 2 + (src[c + 1] - src[a + 1]) ** 2 + (src[c + 2] - src[a + 2]) ** 2;
    if (Math.max(e0, e1, e2) <= max2) { emit(src, a); emit(src, b); emit(src, c); tris++; continue; }
    stack.push([src.subarray(a, a + stride), src.subarray(b, b + stride), src.subarray(c, c + stride)]);
  }
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  // pieces split off a big triangle are only split further while they reach the dent
  const reaches = (t) => {
    const mx = (t[0][0] + t[1][0] + t[2][0]) / 3, my = (t[0][1] + t[1][1] + t[2][1]) / 3, mz = (t[0][2] + t[1][2] + t[2][2]) / 3;
    const q = Math.max((t[0][0] - mx) ** 2 + (t[0][1] - my) ** 2 + (t[0][2] - mz) ** 2,
      (t[1][0] - mx) ** 2 + (t[1][1] - my) ** 2 + (t[1][2] - mz) ** 2, (t[2][0] - mx) ** 2 + (t[2][1] - my) ** 2 + (t[2][2] - mz) ** 2);
    const reach = R + Math.sqrt(q);
    return (mx - cx) ** 2 + (my - cy) ** 2 + (mz - cz) ** 2 <= reach * reach;
  };
  while (stack.length) {
    const t = stack.pop();
    const e0 = d2(t[0], t[1]), e1 = d2(t[1], t[2]), e2 = d2(t[2], t[0]);
    const k = e0 >= e1 && e0 >= e2 ? 0 : e1 >= e2 ? 1 : 2;
    if (Math.max(e0, e1, e2) <= max2 || tris + stack.length > MAX_TRIS || (near && !reaches(t))) { emit(t[0], 0); emit(t[1], 0); emit(t[2], 0); tris++; continue; }
    const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3];
    const m = new Float32Array(stride);
    for (let j = 0; j < stride; j++) m[j] = (a[j] + b[j]) / 2;
    stack.push([a, m, c], [m, b, c]);
  }
  const verts = len / stride;
  const geo = new THREE.BufferGeometry();
  off = 0;
  names.forEach((name, ni) => {
    const size = sizes[ni], arr = new Float32Array(verts * size);
    for (let v = 0; v < verts; v++) for (let c = 0; c < size; c++) arr[v * size + c] = out[v * stride + off + c];
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
    off += size;
  });
  geo.computeVertexNormals(); // non-indexed: flat, faceted like the original
  return geo;
}

/**
 * at: world point of contact on the body; dir: world direction the body is pushed (into
 * the car); depth: metres at the centre; radius: metres.
 */
export function dentCar(car, at, dir, depth, radius = 0.7) {
  if (!car?.mesh || car.wrecked || depth < 0.01) return false;
  car.dentTotal = car.dentTotal || 0;
  depth = Math.min(depth, MAX_TOTAL - car.dentTotal);
  if (depth < 0.01) return false;
  car.mesh.updateMatrixWorld(true);
  let touched = false;
  for (const part of partsOf(car)) {
    const mesh = part.mesh;
    if (/glass/i.test(mesh.material?.name || '')) continue; // panes break, they don't bend
    if (car.wheels?.length && onWheel(car, mesh)) continue;
    const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
    _inv.copy(mesh.matrixWorld).invert();
    _p.copy(at).applyMatrix4(_inv);
    const r = radius / scale;
    // only parts the dent reaches
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const bs = mesh.geometry.boundingSphere;
    if (bs.center.distanceTo(_p) > bs.radius + r) continue;
    // cut the body up finely enough around this dent (only there: it's quick)
    const before = mesh.geometry;
    mesh.geometry = tessellate(before, EDGE / scale, { center: _p, radius: r * 1.1 });
    before.dispose();
    if (!part.own) {
      part.own = true;
      mesh.visible = true;
      if (part.batch) part.batch.setVisibleAt(part.id, false);
    }
    const g = mesh.geometry, pos = g.attributes.position;
    _d.copy(dir).transformDirection(_inv);
    const r2 = r * r, k = depth / scale;
    let moved = 0;
    const hit = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      const dx = _v.x - _p.x, dy = (_v.y - _p.y) * 1.4, dz = _v.z - _p.z; // flatter vertically
      const q = dx * dx + dy * dy + dz * dz;
      if (q >= r2) continue;
      const f = (1 - Math.sqrt(q) / r) ** 2;
      // crumple: neighbouring points give way by different amounts
      const jit = 0.8 + 0.4 * Math.sin(_v.x * 17.1 + _v.y * 23.7 + _v.z * 13.3) * Math.sin(_v.x * 9.7 - _v.z * 15.3);
      pos.setXYZ(i, _v.x + _d.x * k * f * jit, _v.y + _d.y * k * f * jit, _v.z + _d.z * k * f * jit);
      hit[i] = 1;
      moved++;
    }
    if (!moved) continue;
    pos.needsUpdate = true;
    flatNormals(g, hit);
    touched = true;
  }
  if (touched) car.dentTotal += depth;
  return touched;
}
