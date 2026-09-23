import * as THREE from 'three';
import { loadGLTF, modelUrl } from '../engine/assets.js';
import { mulberry32 } from './noise.js';
import { CITY, cityCell } from './cityLayout.js';
import { FacadeInstancer, bakeFacadeTile, loadFacadeKit } from './facadeKit.js';
import {
  DETAIL_FLOORS, FACES, FLOOR_H, ImpostorBuilder, buildTowerDetail, buildTowerImpostor, colliderFor,
} from './skyscraper.js';

/** Horizontal distance (to the tower footprint) inside which real facade modules are shown. */
const DETAIL_DIST = 60;

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
    this.towers = [];
  }

  buildSkyline(layout, rand, darkMat) {
    const renderer = this.pipeline.renderer;
    const facadeMat = (kit) => {
      const tile = bakeFacadeTile(renderer, [kit.parts.floorWindow, kit.parts.floorWindowAlt]);
      return new THREE.MeshStandardMaterial({
        map: tile.map, normalMap: tile.normalMap, roughness: 0.82, metalness: 0.04,
      });
    };
    const mats = {
      apt: facadeMat(this.kits.apt),
      factory: facadeMat(this.kits.factory),
      trim: new THREE.MeshStandardMaterial({ color: 0x7d746a, roughness: 0.9, metalness: 0.03 }),
    };
    const ib = new ImpostorBuilder(['apt', 'factory', 'trim']);
    const skyline = new THREE.Group();
    skyline.name = 'skyline';

    for (const b of layout.buildingBoxes) {
      if (!b.floors) continue;
      buildTowerImpostor(ib, b, rand);
      this.colliders.addBox(colliderFor(b));

      const faceInst = FACES.map(() => new FacadeInstancer());
      buildTowerDetail(faceInst, this.kits, b, rand);
      const faces = faceInst.map((inst, fi) => {
        const g = new THREE.Group();
        g.visible = false;
        inst.attach(g, { castShadow: false });
        skyline.add(g);
        return { group: g, n: FACES[fi].n };
      });
      this.towers.push({ b, faces, near: false });

      if (b.kind === 4 || b.kind === 3) {
        const w = b.x1 - b.x0, d = b.z1 - b.z0;
        for (let k = 0; k < 14; k++) {
          const rub = new THREE.Mesh(new THREE.BoxGeometry(0.6 + rand(), 0.4 + rand() * 0.8, 0.5 + rand()), darkMat);
          rub.position.set(b.x0 + rand() * w, b.y0 + rub.geometry.parameters.height * 0.5, b.z0 + rand() * d);
          rub.rotation.y = rand() * 6;
          rub.castShadow = true;
          skyline.add(rub);
          if (k < 6) {
            this.colliders.addBox({
              x0: rub.position.x - 0.5, x1: rub.position.x + 0.5,
              z0: rub.position.z - 0.45, z1: rub.position.z + 0.45,
              y0: b.y0, y1: b.y0 + 1.2 + rand() * 0.8, type: 'cover',
            });
          }
        }
      }
    }

    const shell = new THREE.Mesh(ib.build(), [mats.apt, mats.factory, mats.trim]);
    shell.castShadow = shell.receiveShadow = true;
    shell.frustumCulled = false;
    skyline.add(shell);
    this.group.add(skyline);
  }

  /** Shows real facade modules only on nearby towers, and only on faces turned toward the camera. */
  updateLod(cam) {
    const detailTop = DETAIL_FLOORS * FLOOR_H + 8;
    for (const t of this.towers) {
      const { b } = t;
      const dx = Math.max(b.x0 - cam.x, 0, cam.x - b.x1);
      const dz = Math.max(b.z0 - cam.z, 0, cam.z - b.z1);
      const near = Math.hypot(dx, dz) < DETAIL_DIST && cam.y < b.y0 + detailTop + DETAIL_DIST;
      if (!near && !t.near) continue;
      t.near = near;
      const cx = (b.x0 + b.x1) * 0.5, cz = (b.z0 + b.z1) * 0.5;
      const hx = (b.x1 - b.x0) * 0.5, hz = (b.z1 - b.z0) * 0.5;
      for (const f of t.faces) {
        const [nx, , nz] = f.n;
        const px = cx + nx * hx, pz = cz + nz * hz;
        f.group.visible = near && (cam.x - px) * nx + (cam.z - pz) * nz > -0.5;
      }
    }
  }

  async load(progress) {
    const ids = [
      'covered_car', 'concrete_road_barrier', 'street_lamp_01', 'barrel_stove', 'metal_trash_can',
      'fire_hydrant', 'old_tyre', 'wooden_crate_01', 'barrel_03', 'modular_chainlink_fence',
    ];
    const [propModels, apt, factory] = await progress.task('Loading urban wreckage', 8, () => Promise.all([
      Promise.all(ids.map((id) => loadGLTF(modelUrl(id)))),
      loadFacadeKit('modular_urban_apartments_facade'),
      loadFacadeKit('modular_factory_facade'),
    ]));
    this.models = Object.fromEntries(ids.map((id, i) => [id, propModels[i]]));
    this.kits = { apt, factory };
  }

  build(layout) {
    const rand = mulberry32((layout.seed || 0) ^ 0xdead);
    const coverMat = new THREE.MeshStandardMaterial({ color: 0x4a423c, roughness: 0.96, metalness: 0.02 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.95, metalness: 0.02 });

    const addCoverMesh = (c) => {
      const w = c.x1 - c.x0, d = c.z1 - c.z0, h = c.y1 - c.y0;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), coverMat);
      mesh.position.set((c.x0 + c.x1) * 0.5, c.y0 + h * 0.5, (c.z0 + c.z1) * 0.5);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.colliders.addBox({ ...c, type: c.type || 'cover' });
    };

    for (const c of layout.coverBoxes || []) addCoverMesh(c);

    this.buildSkyline(layout, rand, darkMat);

    const place = (id, x, z, yaw = 0, scale = 1, coverY = 1.5) => {
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
      const top = y + Math.max(fp.size.y * scale, coverY);
      this.colliders.addBox({
        x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz,
        y0: y, y1: top, type: id.includes('car') ? 'metal' : 'cover',
      });
      return obj;
    };

    const barrierRow = (x, z, yaw, count) => {
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      for (let i = 0; i < count; i++) {
        const p = new THREE.Vector3(x, 0, z).addScaledVector(right, (i - (count - 1) * 0.5) * 1.65);
        place('concrete_road_barrier', p.x, p.z, yaw + (rand() - 0.5) * 0.15, 1, 1.55);
      }
    };

    for (let bz = 0; bz <= CITY.halfBlocks * 2; bz++) {
      for (let bx = 0; bx <= CITY.halfBlocks * 2; bx++) {
        const cx = (bx - CITY.halfBlocks) * CITY.pitch;
        const cz = (bz - CITY.halfBlocks) * CITY.pitch;
        if (bx === CITY.halfBlocks && bz === CITY.halfBlocks) continue;
        const yaw = rand() * Math.PI * 2;
        barrierRow(cx + (rand() - 0.5) * 6, cz + (rand() - 0.5) * 6, yaw, 3 + Math.floor(rand() * 4));
        if (rand() > 0.45) {
          const a = rand() * Math.PI * 2;
          place('covered_car', cx + Math.cos(a) * 8, cz + Math.sin(a) * 8, a + Math.PI * 0.5, 1, 1.65);
          if (rand() > 0.4) place('covered_car', cx + Math.cos(a) * 10 + 2, cz + Math.sin(a) * 10, a + 0.8, 0.95, 1.65);
        }
        if (rand() > 0.55) {
          const fx = cx + (rand() < 0.5 ? -1 : 1) * (CITY.blockW * 0.5 + CITY.streetW * 0.5);
          place('modular_chainlink_fence', fx, cz + (rand() - 0.5) * 20, rand() * Math.PI, 1, 2.2);
        }
      }
    }

    for (let n = 0; n < 140; n++) {
      const x = (rand() - 0.5) * CITY.playRadius * 1.55;
      const z = (rand() - 0.5) * CITY.playRadius * 1.55;
      const cell = cityCell(x, z);
      if (!cell.onStreet && rand() > 0.25) continue;
      const pick = rand();
      if (pick < 0.28) place('covered_car', x, z, rand() * Math.PI * 2, 0.9 + rand() * 0.2, 1.65);
      else if (pick < 0.52) place('concrete_road_barrier', x, z, rand() * Math.PI * 2, 1, 1.55);
      else if (pick < 0.62) place('wooden_crate_01', x, z, rand() * Math.PI * 2, 1, 1.35);
      else if (pick < 0.7) {
        place('wooden_crate_01', x, z, rand() * Math.PI * 2, 1, 1.35);
        place('wooden_crate_01', x + 0.9, z + 0.2, rand() * Math.PI * 2, 1, 2.2);
      } else if (pick < 0.78) place('barrel_03', x, z, rand() * Math.PI * 2, 1, 1.25);
      else if (pick < 0.84) place('metal_trash_can', x, z, rand() * Math.PI * 2, 1, 1.2);
      else if (pick < 0.9) place('old_tyre', x, z, rand() * Math.PI * 2, 1, 0.85);
      else if (pick < 0.94) place('fire_hydrant', x, z, rand() * Math.PI * 2, 1, 1.0);
      else place('street_lamp_01', x, z, rand() * Math.PI * 2, 1, 2.8);
    }

    for (let n = 0; n < 10; n++) {
      const x = (rand() - 0.5) * 100, z = (rand() - 0.5) * 100;
      const stove = place('barrel_stove', x, z, rand() * 6, 1, 1.1);
      if (stove) this.fires.push({ x: stove.position.x, z: stove.position.z, y: stove.position.y + 0.5, phase: rand() * 10 });
    }

    const fog = this.pipeline.fogMaterial.uniforms;
    if (fog.uFogDensity) fog.uFogDensity.value = 0.0028;
  }

  update(dt, fx, camera) {
    if (camera) this.updateLod(camera.position);
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
