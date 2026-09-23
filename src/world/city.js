import * as THREE from 'three';
import { loadGLTF, modelUrl } from '../engine/assets.js';
import { mulberry32 } from './noise.js';
import { CITY, cityCell } from './cityLayout.js';

function cloneModel(gltf) {
  const root = gltf.scene.clone(true);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      if (o.material?.map) o.material = o.material.clone();
    }
  });
  return root;
}

function footprint(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  return { box, size, minY: box.min.y };
}

export class City {
  constructor(terrain, colliders, pipeline) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.pipeline = pipeline;
    this.group = new THREE.Group();
    this.fires = [];
    this.smokeT = 0;
  }

  async load(progress) {
    const ids = ['covered_car', 'concrete_road_barrier', 'street_lamp_01', 'barrel_stove', 'metal_trash_can', 'fire_hydrant', 'old_tyre'];
    const models = await progress.task('Loading urban wreckage', 3, () => Promise.all(ids.map((id) => loadGLTF(modelUrl(id)))));
    this.models = Object.fromEntries(ids.map((id, i) => [id, models[i]]));
  }

  build(layout) {
    const rand = mulberry32((layout.seed || 0) ^ 0xdead);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6a5c52, roughness: 0.92, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.95, metalness: 0.02 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x1a1815, roughness: 0.4, metalness: 0.15, emissive: 0x050403, emissiveIntensity: 0.4 });

    for (const b of layout.buildingBoxes) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0, h = b.y1 - b.y0;
      const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      shell.position.set((b.x0 + b.x1) * 0.5, b.y0 + h * 0.5, (b.z0 + b.z1) * 0.5);
      shell.castShadow = shell.receiveShadow = true;
      this.group.add(shell);
      this.colliders.addBox({ ...b, type: 'concrete' });

      const cols = Math.max(2, Math.floor(w / 5));
      const rows = Math.max(2, Math.floor(h / 3.2));
      for (let i = 0; i < cols; i++) {
        for (let j = 1; j < rows; j++) {
          if (rand() > 0.55) continue;
          const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.1), rand() > 0.35 ? winMat : darkMat);
          const px = b.x0 + 1.2 + i * ((w - 2.4) / Math.max(1, cols - 1));
          const py = b.y0 + 1.5 + j * 3.0;
          pane.position.set(px, py, b.z1 + 0.06);
          pane.rotation.y = 0;
          this.group.add(pane);
        }
      }
      if (b.kind === 4 || b.kind === 3) {
        for (let k = 0; k < 8; k++) {
          const rub = new THREE.Mesh(new THREE.BoxGeometry(0.6 + rand(), 0.4 + rand() * 0.8, 0.5 + rand()), darkMat);
          rub.position.set(
            b.x0 + rand() * w,
            b.y0 + rub.geometry.parameters.height * 0.5,
            b.z0 + rand() * d,
          );
          rub.rotation.y = rand() * 6;
          rub.castShadow = true;
          this.group.add(rub);
        }
      }
    }

    const place = (id, x, z, yaw = 0, scale = 1) => {
      const gltf = this.models[id];
      if (!gltf) return null;
      const obj = cloneModel(gltf);
      const y = this.terrain.heightAt(x, z);
      obj.rotation.y = yaw;
      obj.scale.setScalar(scale);
      obj.position.set(x, y, z);
      this.group.add(obj);
      const fp = footprint(obj);
      obj.position.y = y - fp.minY;
      const cx = obj.position.x, cz = obj.position.z;
      const hx = fp.size.x * scale * 0.45, hz = fp.size.z * scale * 0.45;
      this.colliders.addBox({
        x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz,
        y0: y, y1: y + fp.size.y * scale, type: 'metal',
      });
      return obj;
    };

    for (let n = 0; n < 55; n++) {
      const x = (rand() - 0.5) * CITY.playRadius * 1.6;
      const z = (rand() - 0.5) * CITY.playRadius * 1.6;
      const cell = cityCell(x, z);
      if (!cell.onStreet) continue;
      const pick = rand();
      if (pick < 0.22) place('covered_car', x, z, rand() * Math.PI * 2, 0.9 + rand() * 0.2);
      else if (pick < 0.42) place('concrete_road_barrier', x, z, rand() * Math.PI * 2, 1);
      else if (pick < 0.55) place('street_lamp_01', x, z, rand() * Math.PI * 2, 1);
      else if (pick < 0.65) place('metal_trash_can', x, z, rand() * Math.PI * 2, 1);
      else if (pick < 0.72) place('old_tyre', x, z, rand() * Math.PI * 2, 1);
      else if (pick < 0.78) place('fire_hydrant', x, z, rand() * Math.PI * 2, 1);
    }

    for (let n = 0; n < 14; n++) {
      const x = (rand() - 0.5) * 120, z = (rand() - 0.5) * 120;
      const stove = place('barrel_stove', x, z, rand() * 6, 1);
      if (stove) this.fires.push({ x: stove.position.x, z: stove.position.z, y: stove.position.y + 0.5, phase: rand() * 10 });
    }

    const fog = this.pipeline.fogMaterial.uniforms;
    if (fog.uFogDensity) fog.uFogDensity.value = 0.0028;
  }

  update(dt, fx) {
    this.smokeT += dt;
    if (!fx || this.smokeT < 0.12) return;
    this.smokeT = 0;
    for (const f of this.fires) {
      f.phase += dt;
      fx.alpha.spawn({
        pos: new THREE.Vector3(f.x + Math.sin(f.phase) * 0.15, f.y + 0.2 + Math.sin(f.phase * 2) * 0.05, f.z),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4),
        size: 0.35 + Math.random() * 0.25, grow: 0.9, life: 2.5 + Math.random() * 1.5,
        color: [0.18, 0.16, 0.14], alpha: 0.45, drag: 1.2, gravity: -0.15,
      });
      if (Math.random() < 0.35) {
        fx.add.spawn({
          pos: new THREE.Vector3(f.x, f.y, f.z),
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 0.2),
          size: 0.08, life: 0.25 + Math.random() * 0.2, color: [90, 35, 8], fade: 1,
        });
      }
    }
  }
}
