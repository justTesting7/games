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
const { split, pieces } = chunkMeshes(root, { cell: 128 });
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
console.log('ok chunk meshes', pieces, 'pieces');
