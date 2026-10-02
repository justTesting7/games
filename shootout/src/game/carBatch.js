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
      const seen = new Set();
      for (const { mesh } of list) {
        const g = mesh.geometry;
        if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
        if (seen.has(g)) continue; // one copy of a fleet style, many parked instances
        seen.add(g);
        verts += g.attributes.position.count;
        index += g.index.count;
      }
      const batch = new THREE.BatchedMesh(list.length, verts, index, material);
      batch.name = `cars-${material.name || 'part'}`;
      batch.castShadow = list.some((p) => p.mesh.castShadow);
      batch.receiveShadow = true;
      batch.sortObjects = !!material.transparent;
      // culled per car (three's per-instance test), never as a whole: the batch's bounds are
      // where its cars were parked, and one driven off would take the batch with it
      batch.frustumCulled = false;
      const geoId = new Map();
      for (const { car, mesh } of list) {
        let gid = geoId.get(mesh.geometry);
        if (gid === undefined) {
          gid = batch.addGeometry(mesh.geometry);
          geoId.set(mesh.geometry, gid);
        }
        const id = batch.addInstance(gid);
        const part = { car, mesh, batch, id, gid };
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
        part.want = true;
        car.panes[name] = {
          geometry: mesh.geometry,
          get visible() { return part.want; },
          set visible(v) {
            part.want = !!v;
            part.batch.setVisibleAt(part.id, part.want && part.near !== false);
          },
        };
      }
    }
    this.sync(true);
    return this;
  }

  /** Drops cars past `dist` metres. The view reaches kilometres, and each style is a few thousand triangles. */
  cull(x, z, dist = 120) {
    const d2 = dist * dist;
    for (const p of this.parts) {
      if (p.own) continue;
      const dx = p.car.x - x, dz = p.car.z - z;
      const near = dx * dx + dz * dz < d2;
      if (p.near === near) continue;
      p.near = near;
      p.batch.setVisibleAt(p.id, near && p.want !== false);
    }
  }

  /** Copies the transforms of the cars that moved (car.dirty) into their instances. */
  sync(all = false) {
    for (const p of this.parts) {
      if (!all && !p.car.dirty) continue;
      p.mesh.updateWorldMatrix(true, false);
      p.batch.setMatrixAt(p.id, p.mesh.matrixWorld);
    }
    for (const p of this.parts) p.car.dirty = false;
  }

  dispose() {
    for (const b of this.batches) { b.removeFromParent(); b.dispose(); }
    this.batches = [];
    this.parts = [];
  }
}
