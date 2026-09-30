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
      chunks.push({ out, surf });
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

  const inDoor = (p) => doors.some((d) => {
    const dx = p.x - d.x, dz = p.z - d.z;
    const s = dx * d.rz - dz * d.rx, a = dx * d.rx + dz * d.rz;
    return Math.abs(s) < d.w && Math.abs(a) < d.depth && p.y < d.h;
  });
  const ray = new THREE.Ray();
  const hitOf = (h) => {
    const tri = (h.face.a / 3) | 0;
    return { t: h.distance, point: h.point, normal: h.face.normal, flags: surf[tri] };
  };

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
      if (hit.flags & 8 && inDoor(hit.point)) {
        const all = bvh.raycast(ray, THREE.DoubleSide, 0, maxDist).sort((a, b) => a.distance - b.distance);
        hit = null;
        for (const x of all) {
          const c = hitOf(x);
          if (!(c.flags & 8 && inDoor(c.point))) { hit = c; break; }
        }
        if (!hit) return null;
      }
      const normal = hit.normal.clone();
      if (normal.dot(d) > 0) normal.negate();
      return { t: hit.t, normal, surface: SURFACES[hit.flags & 7] };
    },
  };
}
