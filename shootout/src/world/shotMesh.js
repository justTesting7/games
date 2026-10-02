import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Bullets and sight lines on the city maps trace the real rendered triangles
// through a BVH, not the walking grid: that grid marks anything knee to head
// high as a 2.4 m block, so rounds used to stop in the air above a low wall
// and rivals saw straight past thin walls between two blocked cells.

// Leaves and ground decals let shots through; the walking height grid already covers the ground.
const SKIP = /^(leaves|fronds|foliage|lamp_glow|marking|road_marks.*|lm_grass|asphalt|pavement|ground|kerb)$/;
const SURFACES = ['concrete', 'metal', 'glass', 'wood'];
const surfaceOf = (name) => {
  if (/glass/.test(name)) return 2;
  if (/^(metal|carpaint|paint|railing|signs|solar|prio_.*|park_signs|load_signs|name_boxes|name_plates)$/.test(name)) return 1;
  if (/^(bark|crates|pais|hoarding|awning)$/.test(name)) return 3;
  return 0;
};

/**
 * roots: Object3Ds whose meshes block shots. doors: optional list of
 * { x, z, rx, rz, w, depth, h } doorways cut out of the mesh called doorMesh
 * (the stadium gates are discarded in the shader, the triangles are still there).
 */
export function buildShotMesh(roots, { doors = [], doorMesh = null } = {}) {
  const chunks = [];
  let total = 0;
  const v = new THREE.Vector3();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.visible || SKIP.test(o.name)) return;
      const g = o.geometry, pos = g.attributes.position;
      if (!pos) return;
      const idx = g.index;
      const n = idx ? idx.count : pos.count;
      if (n < 3) return;
      const out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
      }
      const surf = surfaceOf(o.name) | (doorMesh && o.name === doorMesh ? 8 : 0);
      // glass remembers where each triangle came from, so a shot pane can be cut out
      const glass = (surf & 7) === 2 && !(surf & 8) ? { attr: pos, index: idx ? Array.from(idx.array.slice(0, n)) : null, matrix: o.matrixWorld.clone() } : null;
      chunks.push({ out, surf, glass, start: total / 3 });
      total += n;
    });
  }
  const pos = new Float32Array(total * 3);
  const surf = new Uint8Array(total / 3);
  let at = 0;
  for (const c of chunks) {
    pos.set(c.out, at * 3);
    surf.fill(c.surf, at / 3, (at + c.out.length / 3) / 3);
    at += c.out.length / 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // Triangle ids survive the BVH's index reordering: each triangle keeps its own three vertices.
  const index = new Uint32Array(total);
  for (let i = 0; i < total; i++) index[i] = i;
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const bvh = new MeshBVH(geometry);
  const glassChunks = chunks.filter((c) => c.glass);

  const inDoor = (p) => doors.some((d) => {
    const dx = p.x - d.x, dz = p.z - d.z;
    const s = dx * d.rz - dz * d.rx, a = dx * d.rx + dz * d.rz;
    return Math.abs(s) < d.w && Math.abs(a) < d.depth && p.y < d.h;
  });
  const ray = new THREE.Ray();
  const hitOf = (h) => {
    const tri = (h.face.a / 3) | 0;
    return { t: h.distance, point: h.point, normal: h.face.normal, flags: surf[tri], tri };
  };
  const skip = (c) => (c.flags & 16) || (c.flags & 8 && inDoor(c.point)); // broken glass, gateways

  return {
    triangles: total / 3,
    geometry,
    bvh,
    /** Closest hit along the unit ray d within maxDist: { t, normal, surface } or null. */
    raycast(o, d, maxDist) {
      ray.origin.copy(o);
      ray.direction.copy(d);
      let h = bvh.raycastFirst(ray, THREE.DoubleSide, 0, maxDist);
      if (!h) return null;
      let hit = hitOf(h);
      if (skip(hit)) {
        const all = bvh.raycast(ray, THREE.DoubleSide, 0, maxDist).sort((a, b) => a.distance - b.distance);
        hit = null;
        for (const x of all) {
          const c = hitOf(x);
          if (!skip(c)) { hit = c; break; }
        }
        if (!hit) return null;
      }
      const normal = hit.normal.clone();
      if (normal.dot(d) > 0) normal.negate();
      return { t: hit.t, normal, surface: SURFACES[hit.flags & 7], tri: hit.tri };
    },
    /**
     * Shatters the window pane the shot triangle belongs to: the connected glass around it
     * (a discrete pane, not a whole curtain wall) is cut out of every render mesh sharing
     * its vertices, and rounds and sight lines pass through from now on. Returns the pane's
     * centre and size, or null when that glass isn't a breakable pane.
     */
    /** Glass triangles (unbroken) within `radius` of `center`: for a blast blowing windows in. */
    glassNear(center, radius) {
      const sphere = new THREE.Sphere(center, radius);
      const found = [];
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsSphere(sphere),
        intersectsTriangle: (tri, i) => {
          const id = (bvh.geometry.index.getX(i * 3) / 3) | 0;
          if ((surf[id] & 7) === 2 && !(surf[id] & 24) && tri.closestPointToPoint(center, v).distanceTo(center) < radius) found.push(id);
          return false;
        },
      });
      return found;
    },
    breakPane(tri, renderRoots) {
      const c = glassChunks.find((g) => tri >= g.start && tri < g.start + g.out.length / 9);
      if (!c || surf[tri] & 16) return null;
      const g = c.glass;
      const local = tri - c.start;
      const triVerts = (k) => (g.index ? [g.index[k * 3], g.index[k * 3 + 1], g.index[k * 3 + 2]] : [k * 3, k * 3 + 1, k * 3 + 2]);
      // triangles of this mesh that share vertex positions (pane quads may not share indices)
      if (!g.byPos) {
        g.byPos = new Map();
        const key = (i) => `${Math.round(g.attr.getX(i) * 200)},${Math.round(g.attr.getY(i) * 200)},${Math.round(g.attr.getZ(i) * 200)}`;
        g.key = key;
        const count = (g.index ? g.index.length : g.attr.count) / 3;
        for (let k = 0; k < count; k++) for (const i of triVerts(k)) {
          const kk = key(i);
          if (!g.byPos.has(kk)) g.byPos.set(kk, []);
          g.byPos.get(kk).push(k);
        }
      }
      const seen = new Set([local]), queue = [local];
      while (queue.length) {
        const k = queue.pop();
        for (const i of triVerts(k)) for (const m of g.byPos.get(g.key(i)) || []) {
          if (seen.has(m)) continue;
          seen.add(m); queue.push(m);
          if (seen.size > 16) return null; // a curtain wall, not a pane
        }
      }
      // size of the pane (world space)
      const box = new THREE.Box3();
      for (const k of seen) for (let j = 0; j < 9; j += 3) box.expandByPoint(v.fromArray(c.out, k * 9 + j));
      const size = box.getSize(new THREE.Vector3());
      if (size.x * size.y + size.z * size.y + size.x * size.z > 16) return null;
      // rounds and sight lines go through from now on
      for (const k of seen) surf[c.start + k] |= 16;
      // cut it out of whatever draws those vertices (the city chunks share the buffer): the
      // meshes and where each triangle sits in their index are found once per glass mesh,
      // then a pane is gone by collapsing its triangles in place (a few bytes uploaded)
      if (!g.draws) {
        g.draws = [];
        for (const root of renderRoots) root.traverse((o) => {
          if (!o.isMesh || o.geometry.attributes.position !== g.attr || !o.geometry.index) return;
          const src = o.geometry.index.array, at = new Map();
          for (let t = 0; t + 2 < src.length; t += 3) at.set(`${src[t]},${src[t + 1]},${src[t + 2]}`, t);
          g.draws.push({ index: o.geometry.index, at });
        });
      }
      for (const k of seen) {
        const key = triVerts(k).join(',');
        for (const d of g.draws) {
          const t = d.at.get(key);
          if (t === undefined) continue;
          const a = d.index.array;
          a[t + 1] = a[t + 2] = a[t];
          d.index.addUpdateRange(t, 3);
          d.index.needsUpdate = true;
        }
      }
      return { center: box.getCenter(new THREE.Vector3()), size };
    },
  };
}
