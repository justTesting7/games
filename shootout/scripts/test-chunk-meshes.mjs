// City meshes are split into culling cells: every triangle ends up in exactly one piece,
// pieces share the original vertex buffer, and each piece's bounds hug its own triangles.
import * as THREE from 'three';
import { chunkMeshes } from '../src/world/chunkMeshes.js';

const root = new THREE.Group();
const plane = new THREE.PlaneGeometry(1000, 1000, 100, 100).rotateX(-Math.PI / 2); // 20k triangles over 1 km
const mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial());
mesh.name = 'asphalt';
mesh.castShadow = true;
root.add(mesh);
const small = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
small.name = 'crates';
root.add(small);
const total = plane.index.count / 3;
const { split, pieces } = chunkMeshes(root, { cell: 128, batch: false });
if (split !== 1) throw new Error('only the big mesh is split');
if (pieces < 49 || pieces > 81) throw new Error(`1 km at 128 m cells gives 8x8 or so pieces, got ${pieces}`);
let tris = 0;
for (const c of root.children.filter((c) => c.name === 'asphalt')) {
  tris += c.geometry.index.count / 3;
  if (c.geometry.attributes.position !== plane.attributes.position) throw new Error('pieces share the vertex buffer');
  if (c.geometry.boundingSphere.radius > 128) throw new Error('bounds must hug the piece, not the whole district');
  if (!c.castShadow) throw new Error('pieces keep shadow flags');
}
if (tris !== total) throw new Error(`every triangle kept once: ${tris} of ${total}`);
if (!root.children.includes(small)) throw new Error('small meshes stay as they are');
// batched (batch: true): one BatchedMesh holds every cell, one draw for the material
{
  const root2 = new THREE.Group();
  const plane2 = new THREE.PlaneGeometry(1000, 1000, 100, 100).rotateX(-Math.PI / 2);
  const m2 = new THREE.Mesh(plane2, new THREE.MeshBasicMaterial());
  m2.name = 'asphalt';
  m2.castShadow = true;
  root2.add(m2);
  const { pieces: n2 } = chunkMeshes(root2, { cell: 128, batch: true });
  const b = root2.children.find((c) => c.isBatchedMesh);
  if (!b || root2.children.length !== 1) throw new Error('the big mesh becomes one BatchedMesh');
  if (b.instanceCount !== n2 || n2 < 49) throw new Error(`one instance a cell: ${b.instanceCount} vs ${n2}`);
  let t2 = 0;
  for (let i = 0; i < b.instanceCount; i++) {
    const gid = b.getGeometryIdAt(i);
    const r = b.getGeometryRangeAt(gid);
    t2 += r.count / 3;
    const bs = b.getBoundingSphereAt(gid, new THREE.Sphere());
    if (bs.radius > 128) throw new Error('each cell keeps its own bounds');
  }
  if (t2 !== plane2.index.count / 3) throw new Error(`every triangle kept once in the batch: ${t2}`);
  if (!b.castShadow || !b.perObjectFrustumCulled) throw new Error('the batch casts shadows and culls per cell');
}
console.log('ok chunk meshes', pieces, 'pieces');
