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
import { bindFurniture, dressCityFurniture } from './streetFurniture.js';
import { buildPlaza, updateFountain } from './plaza.js';
import { scatterLotWreckage, scatterPlazaRing, scatterStreetClutter } from './urbanClutter.js';
import { PropBatcher, withBatcher } from './propBatcher.js';

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
    this.batcher = null;
    this._rubble = [];
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
        const rubble = [];
        for (let k = 0; k < 14; k++) {
          const sx = 0.6 + rand(), sy = 0.4 + rand() * 0.8, sz = 0.5 + rand();
          const px = b.x0 + rand() * w, pz = b.z0 + rand() * d;
          rubble.push({ px, pz, sy, sx, sz, yaw: rand() * 6 });
          if (k < 6) {
            this.colliders.addBox({
              x0: px - 0.5, x1: px + 0.5, z0: pz - 0.45, z1: pz + 0.45,
              y0: b.y0, y1: b.y0 + 1.2 + rand() * 0.8, type: 'cover',
            });
          }
        }
        this._rubble.push({ y0: b.y0, rubble });
      }
    }

    const shell = new THREE.Mesh(ib.build(), [mats.apt, mats.factory, mats.trim]);
    shell.castShadow = shell.receiveShadow = true;
    shell.frustumCulled = false;
    skyline.add(shell);

    const chunks = this._rubble.flatMap((r) => r.rubble.map((c) => ({ ...c, y0: r.y0 })));
    if (chunks.length) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), darkMat, chunks.length);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      chunks.forEach((c, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw);
        p.set(c.px, c.y0 + c.sy * 0.5, c.pz);
        s.set(c.sx, c.sy, c.sz);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      });
      mesh.instanceMatrix.needsUpdate = true;
      skyline.add(mesh);
    }
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

    this.batcher = new PropBatcher(this.models);
    bindFurniture(this.batcher);
    const place = (id, x, z, yaw = 0, scale = 1, coverY = 1.5, type) => (
      placeStreetProp(this.models, this.group, this.colliders, this.terrain, id, x, z, yaw, scale, coverY, type)
    );

    const manhattan = layout.theme === 'manhattan';
    withBatcher(this.batcher, () => {
      this.fountain = buildPlaza(this.group, this.colliders, this.terrain, this.models, rand, place, this.pipeline);
      this.treeWind = buildStreetTrees(this.group, this.colliders, this.terrain, rand);
      dressSidewalks(this.models, this.group, this.colliders, this.terrain, rand);
      dressCityFurniture(this.models, this.group, this.colliders, this.terrain, rand, place);
      if (manhattan) {
        this.buildLanes();
      } else {
        buildSewers(this.group, this.colliders, this.terrain, rand);
        placeRoadblocks(this.models, this.group, this.colliders, this.terrain, rand);
        scatterStreetClutter(this.models, this.group, this.colliders, this.terrain, rand);
        scatterLotWreckage(this.models, this.group, this.colliders, this.terrain, layout, rand);
        scatterPlazaRing(this.models, this.group, this.colliders, this.terrain, rand);
        for (let n = 0; n < 22; n++) {
          const x = (rand() - 0.5) * 90, z = (rand() - 0.5) * 90;
          const cell = cityCell(x, z);
          if (cell.onRoad || Math.hypot(x, z) < CITY.plazaRoad) continue;
          const stove = place('barrel_stove', x, z, rand() * 6, 1, 1.1);
          if (stove) this.fires.push({ x: stove.position.x, z: stove.position.z, y: stove.position.y + 0.5, phase: rand() * 10 });
        }
      }
    });
    this.batcher.bake(this.group);
    this.batcher.update({ x: 0, y: 2, z: 13 });

    const fog = this.pipeline.fogMaterial.uniforms;
    if (fog.uFogDensity) fog.uFogDensity.value = manhattan ? 0.0018 : 0.0028;
  }

  /** Painted lane dashes so the avenues read as clear driving roads. */
  buildLanes() {
    const { pitch, halfBlocks, playRadius, baseY } = CITY;
    const addMarks = (spots, color, geo) => {
      if (!spots.length) return;
      const paint = new THREE.MeshStandardMaterial({
        color, roughness: 0.5, metalness: 0.02, emissive: color, emissiveIntensity: 0.12,
      });
      const mesh = new THREE.InstancedMesh(geo, paint, spots.length);
      mesh.receiveShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sp.yaw);
        p.set(sp.x, baseY - 0.08, sp.z);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    };
    const white = [];
    const yellow = [];
    const lim = halfBlocks * pitch;
    for (let n = -halfBlocks; n < halfBlocks; n++) {
      const c = pitch * 0.5 + n * pitch;
      for (let t = -lim; t <= lim; t += 5.4) {
        if (Math.hypot(c, t) > playRadius - 10) continue;
        const cell = cityCell(c, t);
        if (!cell.onRoad || cell.intersection) continue;
        white.push({ x: c - 2.35, z: t, yaw: 0 });
        white.push({ x: c + 2.35, z: t, yaw: 0 });
        yellow.push({ x: c - 0.12, z: t, yaw: 0 });
        yellow.push({ x: c + 0.12, z: t, yaw: 0 });
      }
      for (let t = -lim; t <= lim; t += 5.4) {
        if (Math.hypot(t, c) > playRadius - 10) continue;
        const cell = cityCell(t, c);
        if (!cell.onRoad || cell.intersection) continue;
        white.push({ x: t, z: c - 2.35, yaw: Math.PI * 0.5 });
        white.push({ x: t, z: c + 2.35, yaw: Math.PI * 0.5 });
        yellow.push({ x: t, z: c - 0.12, yaw: Math.PI * 0.5 });
        yellow.push({ x: t, z: c + 0.12, yaw: Math.PI * 0.5 });
      }
    }
    addMarks(white, 0xe8e2c4, new THREE.BoxGeometry(0.12, 0.02, 2.2));
    addMarks(yellow, 0xf0c400, new THREE.BoxGeometry(0.10, 0.02, 2.4));
  }

  update(dt, fx, camera) {
    if (camera) {
      this.updateLod(camera.position);
      this.batcher?.update(camera.position);
    }
    if (this.treeWind) this.treeWind((this._treeT = (this._treeT || 0) + dt));
    if (this.fountain) updateFountain(fx, this.fountain, this._treeT || 0);
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
