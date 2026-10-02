import * as THREE from 'three';

// The city exports batch everything by material: each mesh spans the whole district,
// so frustum culling can never skip one, and the camera and the small shadow frustum
// both draw the entire city every frame. This splits every big mesh into square cells
// of the ground plan. The pieces share the original vertex buffers (uploaded once) and
// only get their own index list and bounds, so culling can drop what is out of view.

const tmp = new THREE.Vector3();

// Small things are drawn only near the camera: clutter (bollards, posts, signs, railings,
// lamp heads) out to a short range, trees and balconies further. Their pieces are cut
// finer (128 m) so the distance test is reasonably tight without too many draw calls.
// Everything else (the buildings, the ground) is always drawn and alone casts into the
// far shadow cascade (the pipeline hides the details while it draws that map).
export const FINE = /^(paint|metal|steel|railing|netting|signs|.*_signs|name_.*|house_numbers|lamp_glow|sig_.*|crates|store_sign|toto|ampm_in|jet|pool_water)$/;
export const MID = /^(leaves.*|foliage|fronds|bark|balcony|parapet|solar|awning|hoarding)$/;

export function chunkMeshes(root, { cell = 256, minTris = 3000, detailCell = 128, batch = false } = {}) {
  root.updateMatrixWorld(true);
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.parent) return;
    if (o.userData?.hours) return; // shop shutters toggle the whole mesh by time of day
    list.push(o);
  });
  let before = 0, after = 0;
  const details = [], cells = [];
  const groups = new Map(); // batch: what goes into each BatchedMesh (see batchGroups)
  for (const o of list) {
    const g = o.geometry, idx = g.index, pos = g.attributes.position;
    if (!pos || g.morphAttributes?.position) continue;
    const n = idx ? idx.count : pos.count;
    const key = batch && batchKey(o);
    if (key && n / 3 < minTris) {
      // small: one instance, whole
      const all = idx ? Array.from(idx.array.subarray(0, n)) : [...Array(n).keys()];
      addToGroup(groups, key, o, [all]);
      continue;
    }
    if (n / 3 < minTris) continue;
    const tier = FINE.test(o.name) ? 'fine' : MID.test(o.name) ? 'mid' : null;
    const size = tier ? detailCell : cell;
    const buckets = new Map();
    const at = (i) => (idx ? idx.getX(i) : i);
    for (let t = 0; t + 2 < n; t += 3) {
      let x = 0, z = 0;
      for (let k = 0; k < 3; k++) {
        tmp.fromBufferAttribute(pos, at(t + k)).applyMatrix4(o.matrixWorld);
        x += tmp.x; z += tmp.z;
      }
      const key = `${Math.floor(x / 3 / size)},${Math.floor(z / 3 / size)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(at(t), at(t + 1), at(t + 2));
    }
    // one draw call for the whole material: the cells go into a BatchedMesh, culled one by
    // one but drawn together (glass stays as separate meshes: breaking a pane edits them)
    if (key) {
      before++;
      addToGroup(groups, key, o, [...buckets.values()]);
      continue;
    }
    if (buckets.size < 2) continue;
    before++;
    for (const tris of buckets.values()) {
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(g.attributes)) geo.setAttribute(name, attr);
      geo.setIndex(new THREE.BufferAttribute(pos.count > 65535 ? new Uint32Array(tris) : new Uint16Array(tris), 1));
      // bounds of this piece only (the shared buffer covers the whole district)
      const box = new THREE.Box3();
      for (const i of tris) box.expandByPoint(tmp.fromBufferAttribute(pos, i));
      geo.boundingBox = box;
      const sphere = new THREE.Sphere();
      box.getCenter(sphere.center);
      let r2 = 0;
      for (const i of tris) r2 = Math.max(r2, sphere.center.distanceToSquared(tmp.fromBufferAttribute(pos, i)));
      sphere.radius = Math.sqrt(r2);
      geo.boundingSphere = sphere;
      const m = new THREE.Mesh(geo, o.material);
      m.name = o.name;
      m.castShadow = o.castShadow;
      m.receiveShadow = o.receiveShadow;
      m.renderOrder = o.renderOrder;
      m.userData = o.userData;
      m.matrixAutoUpdate = false;
      m.matrix.copy(o.matrix);
      m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
      o.parent.add(m);
      if (tier) {
        m.updateMatrixWorld(true);
        details.push({ mesh: m, box: box.clone().applyMatrix4(m.matrixWorld), tier });
      }
      after++;
    }
    o.parent.remove(o);
  }
  if (batch) after += batchGroups(root, groups, cells);
  // meshes left whole: small detail ones are culled whole, the rest cast far shadows
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh || details.some((d) => d.mesh === o)) return;
    const tier = FINE.test(o.name) ? 'fine' : MID.test(o.name) ? 'mid' : null;
    if (!tier) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    details.push({ mesh: o, box: o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld), tier });
  });
  root.updateMatrixWorld(true);
  return { split: before, pieces: after, details, cells };
}

// A compact copy of the triangles `tris` (indices into g) with only the vertices they use;
// attribute types and quantisation are kept as they are.
// (remap: a scratch Int32Array the size of g's vertex count, all -1; it's left that way)
function compactCell(g, tris, remap) {
  const order = [];
  const idx = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    let v = remap[tris[i]];
    if (v < 0) { v = order.length; remap[tris[i]] = v; order.push(tris[i]); }
    idx[i] = v;
  }
  for (let k = 0; k < order.length; k++) remap[order[k]] = -1;
  const geo = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize;
    const inter = attr.isInterleavedBufferAttribute;
    const src = inter ? attr.data.array : attr.array, stride = inter ? attr.data.stride : size, off = inter ? attr.offset : 0;
    const out = new src.constructor(order.length * size);
    for (let k = 0; k < order.length; k++) {
      const base = order[k] * stride + off;
      for (let c = 0; c < size; c++) out[k * size + c] = src[base + c];
    }
    geo.setAttribute(name, new THREE.BufferAttribute(out, size, attr.normalized));
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// What may share a BatchedMesh: the same material (or an identical copy: the city's tiles
// each load their own) and the same vertex layout. Glass, see-through, shop shutters and
// multi-material meshes are left alone (null).
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap'];
// a texture's look in a few pixels (so two tiles' copies of one image match, and two
// different images under one material name don't)
const prints = new WeakMap();
let printCtx;
function hashBytes(a, x = 2166136261) {
  for (let i = 0; i < a.length; i++) { x ^= a[i]; x = Math.imul(x, 16777619); }
  return x >>> 0;
}
function fingerprint(t) {
  // compressed (KTX2): the small mip levels' bytes
  if (t.isCompressedTexture) {
    if (prints.has(t)) return prints.get(t);
    const mm = t.mipmaps || [];
    let x = 2166136261 ^ (t.format | 0);
    for (let k = Math.min(4, mm.length - 1); k >= 0 && k < mm.length; k++) if (mm[k]?.data) x = hashBytes(mm[k].data, x);
    const p = `c${x.toString(36)}`;
    prints.set(t, p);
    return p;
  }
  const img = t.image;
  if (!img || typeof OffscreenCanvas === 'undefined') return '';
  if (prints.has(img)) return prints.get(img);
  let p = '';
  try {
    printCtx ||= new OffscreenCanvas(6, 6).getContext('2d', { willReadFrequently: true });
    printCtx.clearRect(0, 0, 6, 6);
    printCtx.drawImage(img, 0, 0, 6, 6);
    p = Array.from(printCtx.getImageData(0, 0, 6, 6).data, (v) => v >> 3).join('.');
  } catch { p = String(Math.random()); }
  prints.set(img, p);
  return p;
}
function materialKey(m) {
  if (!m.name) return m.uuid;
  const tex = (t) => (t ? `${fingerprint(t)}${t.image?.width}x${t.image?.height}@${t.repeat.x},${t.repeat.y},${t.offset.x},${t.offset.y},${t.wrapS},${t.wrapT}` : '-');
  return [m.type, m.name, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.roughness, m.metalness, m.vertexColors,
    m.side, m.alphaTest, m.opacity, m.normalScale?.x, m.envMapIntensity, ...MAPS.map((k) => tex(m[k]))].join('|');
}
function batchKey(o) {
  const g = o.geometry, m = o.material;
  if (!o.visible || o.userData?.hours || Array.isArray(m) || !m || m.transparent || m.isShaderMaterial) return null;
  if (/glass/i.test(o.name) || /glass/i.test(m.name || '') || (g.groups?.length || 0) > 1 || g.morphAttributes?.position) return null;
  const sig = Object.entries(g.attributes).map(([n, a]) => `${n}:${a.itemSize}:${a.normalized}:${(a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name}`).sort().join(',');
  return `${materialKey(m)}#${sig}#${o.castShadow}${o.receiveShadow}${o.renderOrder}`;
}
function addToGroup(groups, key, o, triLists) {
  let gr = groups.get(key);
  if (!gr) groups.set(key, (gr = []));
  gr.push({ o, triLists });
}

// Every group becomes one BatchedMesh under root: an instance a cell (or a small mesh
// whole), each with its own matrix, culled by CityCuller. The copies of a material that
// aren't kept give their textures back.
function batchGroups(root, groups, cells) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4();
  const kept = new Set(), dropped = new Set();
  let pieces = 0;
  for (const list of groups.values()) {
    const parts = [];
    for (const { o, triLists } of list) {
      const remap = new Int32Array(o.geometry.attributes.position.count).fill(-1);
      for (const tris of triLists) parts.push({ o, geo: compactCell(o.geometry, tris, remap) });
    }
    const verts = parts.reduce((a, p) => a + p.geo.attributes.position.count, 0);
    const index = parts.reduce((a, p) => a + p.geo.index.count, 0);
    const first = list[0].o;
    let mesh;
    const start = cells.length;
    try {
      mesh = new THREE.BatchedMesh(parts.length, verts, index, first.material);
      for (const { o, geo } of parts) {
        const id = mesh.addInstance(mesh.addGeometry(geo));
        mesh.setMatrixAt(id, m.multiplyMatrices(inv, o.matrixWorld));
        const tier = FINE.test(o.name) ? 'fine' : MID.test(o.name) ? 'mid' : null;
        cells.push({ batch: mesh, id, sphere: geo.boundingSphere.clone().applyMatrix4(o.matrixWorld), tier });
        geo.dispose();
      }
    } catch (e) {
      console.warn('city: could not batch', first.name, e.message);
      cells.length = start;
      continue;
    }
    mesh.name = first.name;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.userData = first.userData;
    // culled by CityCuller (cheap, and only touched when a cell's visibility changes),
    // so three does no per-cell work per frame and draws the batch in one multi-draw
    mesh.perObjectFrustumCulled = false;
    mesh.sortObjects = false;
    mesh.matrixAutoUpdate = false;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
    kept.add(first.material);
    for (const { o } of list) {
      if (o.material !== first.material) dropped.add(o.material);
      o.parent?.remove(o);
    }
    pieces += parts.length;
  }
  // textures only the dropped copies used
  const live = new Set();
  root.traverse((o) => { if (o.material && !Array.isArray(o.material)) kept.add(o.material); });
  for (const mat of kept) for (const k of MAPS) if (mat[k]) live.add(mat[k]);
  for (const mat of dropped) {
    if (kept.has(mat)) continue;
    for (const k of MAPS) if (mat[k] && !live.has(mat[k])) mat[k].dispose();
    mat.dispose();
  }
  return pieces;
}

// Which batched city cells to draw: in view (a sphere against the frustum of a view-projection
// matrix: the camera, or a shadow map's light) and, for the small details, within range.
// Only cells whose visibility changes are touched, so a still frame costs one quick pass.
const TIER = { fine: 1, mid: 2 };
export class CityCuller {
  constructor(cells) {
    const n = cells.length;
    this.n = n;
    this.cx = new Float32Array(n); this.cy = new Float32Array(n); this.cz = new Float32Array(n); this.r = new Float32Array(n);
    this.tier = new Uint8Array(n);
    this.vis = new Uint8Array(n).fill(1);
    this.batch = cells.map((c) => c.batch);
    this.id = new Int32Array(n);
    cells.forEach((c, i) => {
      this.cx[i] = c.sphere.center.x; this.cy[i] = c.sphere.center.y; this.cz[i] = c.sphere.center.z; this.r[i] = c.sphere.radius;
      this.tier[i] = TIER[c.tier] || 0;
      this.id[i] = c.id;
    });
    this.planes = new Float32Array(24);
    this._m = new THREE.Matrix4();
  }

  /** viewProj: Matrix4; at: Vector3 (for the detail ranges); fine/mid: metres (0 = hide that tier). */
  update(viewProj, at, fine, mid) {
    const P = this.planes;
    if (!viewProj) P.fill(0); // all planes 0: every sphere passes
    else this._planes(viewProj.elements, P);
    const f2 = fine * fine, m2 = mid * mid, ax = at.x, az = at.z;
    const { cx, cy, cz, r, tier, vis } = this;
    for (let i = 0; i < this.n; i++) {
      let on = 1;
      const t = tier[i];
      if (t) {
        const dx = cx[i] - ax, dz = cz[i] - az, rr = Math.max(0, Math.sqrt(dx * dx + dz * dz) - r[i]);
        if (rr * rr > (t === 1 ? f2 : m2)) on = 0;
      }
      if (on) {
        const x = cx[i], y = cy[i], z = cz[i], rad = -r[i];
        for (let k = 0; k < 24; k += 4) if (P[k] * x + P[k + 1] * y + P[k + 2] * z + P[k + 3] < rad) { on = 0; break; }
      }
      if (vis[i] !== on) { vis[i] = on; this.batch[i].setVisibleAt(this.id[i], !!on); }
    }
  }

  _planes(e, P) {
    const rows = [[3, 0, 1], [3, 0, -1], [3, 1, 1], [3, 1, -1], [3, 2, 1], [3, 2, -1]];
    for (let k = 0; k < 6; k++) {
      const [w, a, sgn] = rows[k];
      const x = e[w] + sgn * e[a], y = e[w + 4] + sgn * e[a + 4], z = e[w + 8] + sgn * e[a + 8], d = e[w + 12] + sgn * e[a + 12];
      const l = Math.hypot(x, y, z) || 1;
      P[k * 4] = x / l; P[k * 4 + 1] = y / l; P[k * 4 + 2] = z / l; P[k * 4 + 3] = d / l;
    }
  }

  /** Culls for a camera (main view) or a shadow light's camera. */
  updateFor(camera, at, fine, mid) {
    if (!camera) return this.update(null, at, fine, mid); // no frustum: range only
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.update(this._m, at, fine, mid);
  }
}

/** Shows the detail pieces within range of the camera: fine ones to `fine` m, the rest to `mid` m. */
export function cullDetails(details, at, { fine = 150, mid = 320 } = {}) {
  const f2 = fine * fine, m2 = mid * mid;
  let shown = 0;
  for (const d of details) {
    const b = d.box;
    const dx = Math.max(b.min.x - at.x, 0, at.x - b.max.x), dz = Math.max(b.min.z - at.z, 0, at.z - b.max.z);
    const q = dx * dx + dz * dz;
    const on = q < (d.tier === 'fine' ? f2 : m2);
    if (d.batch) { if (d.batch.getVisibleAt(d.id) !== on) d.batch.setVisibleAt(d.id, on); }
    else if (d.mesh.visible !== on) d.mesh.visible = on;
    if (on) shown++;
  }
  return shown;
}

/** Hides (or restores) every detail piece: the far shadow cascade is drawn without them. */
export function hideDetails(details, hide) {
  for (const d of details) {
    if (d.batch) {
      if (hide) { d.was = d.batch.getVisibleAt(d.id); d.batch.setVisibleAt(d.id, false); } else d.batch.setVisibleAt(d.id, d.was ?? true);
    } else if (hide) { d.was = d.mesh.visible; d.mesh.visible = false; } else d.mesh.visible = d.was ?? d.mesh.visible;
  }
}
