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
  const details = [];
  for (const o of list) {
    const g = o.geometry, idx = g.index, pos = g.attributes.position;
    if (!pos || g.morphAttributes?.position) continue;
    const n = idx ? idx.count : pos.count;
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
    if (buckets.size < 2) continue;
    before++;
    // one draw call for the whole material: the cells go into a BatchedMesh, culled one by
    // one but drawn together (glass stays as separate meshes: breaking a pane edits them)
    if (batch && !/glass/i.test(o.name) && !/glass/i.test(o.material?.name || '')) {
      const b = batchCells(o, [...buckets.values()]);
      if (b) {
        o.parent.add(b.mesh);
        after += b.ids.length;
        if (tier) b.ids.forEach((id, i) => details.push({ batch: b.mesh, id, box: b.boxes[i], tier }));
        o.parent.remove(o);
        continue;
      }
    }
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
  // meshes left whole: small detail ones are culled whole, the rest cast far shadows
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh || details.some((d) => d.mesh === o)) return;
    const tier = FINE.test(o.name) ? 'fine' : MID.test(o.name) ? 'mid' : null;
    if (!tier) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    details.push({ mesh: o, box: o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld), tier });
  });
  root.updateMatrixWorld(true);
  return { split: before, pieces: after, details };
}

// A compact copy of the triangles `tris` (indices into g) with only the vertices they use;
// attribute types and quantisation are kept as they are.
function compactCell(g, tris) {
  const remap = new Map(), order = [];
  const idx = new Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    let v = remap.get(tris[i]);
    if (v === undefined) { v = order.length; remap.set(tris[i], v); order.push(tris[i]); }
    idx[i] = v;
  }
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
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function batchCells(o, cells) {
  const geos = cells.map((tris) => compactCell(o.geometry, tris));
  const verts = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const index = geos.reduce((a, g) => a + g.index.count, 0);
  let mesh;
  try {
    mesh = new THREE.BatchedMesh(geos.length, verts, index, o.material);
  } catch {
    return null;
  }
  const ids = [], boxes = [];
  o.updateMatrixWorld(true);
  for (const g of geos) {
    const id = mesh.addInstance(mesh.addGeometry(g));
    ids.push(id);
    boxes.push(g.boundingBox.clone().applyMatrix4(o.matrixWorld));
    g.dispose();
  }
  mesh.name = o.name;
  mesh.castShadow = o.castShadow;
  mesh.receiveShadow = o.receiveShadow;
  mesh.renderOrder = o.renderOrder;
  mesh.userData = o.userData;
  mesh.perObjectFrustumCulled = true;
  mesh.sortObjects = !!o.material?.transparent;
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(o.matrix);
  mesh.position.copy(o.position); mesh.quaternion.copy(o.quaternion); mesh.scale.copy(o.scale);
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return { mesh, ids, boxes };
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
