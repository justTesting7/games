import * as THREE from 'three';
import { loadGLTF, modelUrl } from '../engine/assets.js';
import { mulberry32 } from './noise.js';
import { CITY, cityCell } from './cityLayout.js';
import { FacadeInstancer, bakeFacadeTile, loadFacadeKit } from './facadeKit.js';
import {
  DETAIL_FLOORS, FACES, FLOOR_H, ImpostorBuilder, buildTowerDetail, buildTowerImpostor, colliderFor,
} from './skyscraper.js';
import {
  buildSewers, buildStreetTrees, dressSidewalks, placeRoadblocks, placeStreetProp,
} from './streets.js';
import { dressCityFurniture } from './streetFurniture.js';
import { buildPlaza, updateFountain } from './plaza.js';

/** Horizontal distance (to the tower footprint) inside which real facade modules are shown. */
const DETAIL_DIST = 60;

export class City {
  constructor(terrain, colliders, pipeline) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.pipeline = pipeline;
    this.group = new THREE.Group();
    this.fires = [];
    this.smokeT = 0;
    this.towers = [];
    this.treeWind = null;
    this.fountain = null;
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
      'utility_box_01', 'utility_box_02', 'power_box_01', 'painted_wooden_bench',
      'planter_box_01', 'korean_public_payphone_01',
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
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.95, metalness: 0.02 });

    this.buildSkyline(layout, rand, darkMat);

    const place = (id, x, z, yaw = 0, scale = 1, coverY = 1.5, type) => (
      placeStreetProp(this.models, this.group, this.colliders, this.terrain, id, x, z, yaw, scale, coverY, type)
    );

    this.fountain = buildPlaza(this.group, this.colliders, this.terrain, this.models, rand, place);
    this.treeWind = buildStreetTrees(this.group, this.colliders, this.terrain, rand);
    buildSewers(this.group, this.colliders, this.terrain, rand);
    dressSidewalks(this.models, this.group, this.colliders, this.terrain, rand);
    dressCityFurniture(this.models, this.group, this.colliders, this.terrain, rand, place);
    placeRoadblocks(this.models, this.group, this.colliders, this.terrain, rand);

    for (const b of layout.blocks) {
      if (b.kind !== 4 && b.kind !== 5 && b.kind !== 6) continue;
      if (Math.hypot(b.cx, b.cz) < 30 || Math.hypot(b.cx, b.cz) > CITY.playRadius - 20) continue;
      if (rand() > 0.55) {
        place('modular_chainlink_fence', b.cx + (rand() - 0.5) * 10, b.cz + (rand() - 0.5) * 10, rand() * Math.PI, 1, 2.2);
      }
      if (rand() > 0.4) place('covered_car', b.cx + (rand() - 0.5) * 12, b.cz + (rand() - 0.5) * 12, rand() * 6, 0.95, 1.6);
      if (rand() > 0.35) {
        const x = b.cx + (rand() - 0.5) * 14, z = b.cz + (rand() - 0.5) * 14;
        place('wooden_crate_01', x, z, rand() * 6, 1, 1.35);
        if (rand() > 0.4) place('wooden_crate_01', x + 0.9, z + 0.15, rand() * 6, 1, 2.1);
      }
      if (rand() > 0.5) place('barrel_03', b.cx + (rand() - 0.5) * 12, b.cz + (rand() - 0.5) * 12, rand() * 6, 1, 1.25);
      if (rand() > 0.6) place('old_tyre', b.cx + (rand() - 0.5) * 12, b.cz + (rand() - 0.5) * 12, rand() * 6, 1, 0.85);
    }

    for (let n = 0; n < 8; n++) {
      const x = (rand() - 0.5) * 90, z = (rand() - 0.5) * 90;
      const cell = cityCell(x, z);
      if (cell.onRoad || Math.hypot(x, z) < CITY.plazaRoad) continue;
      const stove = place('barrel_stove', x, z, rand() * 6, 1, 1.1);
      if (stove) this.fires.push({ x: stove.position.x, z: stove.position.z, y: stove.position.y + 0.5, phase: rand() * 10 });
    }

    const fog = this.pipeline.fogMaterial.uniforms;
    if (fog.uFogDensity) fog.uFogDensity.value = 0.0028;
  }

  update(dt, fx, camera) {
    if (camera) this.updateLod(camera.position);
    if (this.treeWind) this.treeWind((this._treeT = (this._treeT || 0) + dt));
    if (this.fountain) updateFountain(fx, this.fountain.fountain, this._treeT || 0);
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
