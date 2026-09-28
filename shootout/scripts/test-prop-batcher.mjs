import * as THREE from 'three';
import { PropBatcher, withBatcher, activeBatcher } from '../src/world/propBatcher.js';

const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshBasicMaterial());
const batcher = new PropBatcher();
batcher.registerObject('box', mesh);
const terrain = { heightAt: () => 2 };
const boxes = [];
const colliders = { addBox: (b) => boxes.push(b) };

withBatcher(batcher, () => {
  if (activeBatcher !== batcher) throw new Error('active batcher not set');
  batcher.place('box', 0, 0, 0, 1, 1.2, 'cover', terrain, colliders);
  batcher.place('box', 8, 4, 0.3, 1, 1.2, 'cover', terrain, colliders);
});
if (activeBatcher) throw new Error('batcher leaked');
if (boxes.length !== 2) throw new Error(`colliders ${boxes.length}`);

const group = new THREE.Group();
batcher.bake(group);
if (group.children.length !== 2) throw new Error(`meshes ${group.children.length}`);
batcher.update({ x: 0, y: 0, z: 0 });
const drawn = group.children.reduce((s, m) => s + m.count, 0);
if (drawn !== 2) throw new Error(`drawn ${drawn}`);
if (!group.children[0].castShadow) throw new Error('near should cast shadows');
if (group.children[1].castShadow) throw new Error('far should not cast shadows');

console.log('prop batcher ok', { meshes: group.children.length, drawn });
