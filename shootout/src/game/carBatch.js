import * as THREE from 'three';

// City cars are about nine meshes each (paint, metal, trim, six glass panes), so a map
// with 200 cars cost ~1800 draw calls a pass and most of the frame. Here every part that
// shares a material goes into one BatchedMesh: one draw per material for all the cars,
// culled and sorted per car. Each car keeps its Group as the transform the driving code
// moves; the original meshes stay in it, hidden, and drive their batch instances.

export class CarBatch {
  constructor(parent) {
    this.parent = parent;
    this.batches = [];
    this.parts = []; // { car, mesh, batch, id }
  }

  /** cars: records whose .mesh Group holds the car's meshes (and .panes by name). */
  build(cars) {
    const byMat = new Map();
    for (const car of cars) {
      car.mesh.traverse((o) => {
        if (!o.isMesh) return;
        if (!byMat.has(o.material)) byMat.set(o.material, []);
        byMat.get(o.material).push({ car, mesh: o });
      });
    }
    for (const [material, list] of byMat) {
      let verts = 0, index = 0;
      for (const { mesh } of list) {
        const g = mesh.geometry;
        if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
        verts += g.attributes.position.count;
        index += g.index.count;
      }
      const batch = new THREE.BatchedMesh(list.length, verts, index, material);
      batch.name = `cars-${material.name || 'part'}`;
      batch.castShadow = list.some((p) => p.mesh.castShadow);
      batch.receiveShadow = true;
      batch.sortObjects = !!material.transparent;
      for (const { car, mesh } of list) {
        const id = batch.addInstance(batch.addGeometry(mesh.geometry));
        const part = { car, mesh, batch, id };
        this.parts.push(part);
        (car.batched || (car.batched = [])).push(part);
        mesh.visible = false; // drawn by the batch from here on
      }
      this.parent.add(batch);
      this.batches.push(batch);
    }
    // a broken pane hides its instance
    for (const car of cars) {
      if (!car.panes) continue;
      for (const [name, mesh] of Object.entries(car.panes)) {
        const part = car.batched.find((p) => p.mesh === mesh);
        if (!part) continue;
        car.panes[name] = {
          geometry: mesh.geometry,
          get visible() { return part.batch.getVisibleAt(part.id); },
          set visible(v) { part.batch.setVisibleAt(part.id, !!v); },
        };
      }
    }
    this.sync();
    return this;
  }

  /** Copies every car's current transform into its instances. */
  sync() {
    for (const p of this.parts) {
      p.mesh.updateWorldMatrix(true, false);
      p.batch.setMatrixAt(p.id, p.mesh.matrixWorld);
    }
  }

  dispose() {
    for (const b of this.batches) { b.removeFromParent(); b.dispose(); }
    this.batches = [];
    this.parts = [];
  }
}
