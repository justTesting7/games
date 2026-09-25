import * as THREE from 'three';
import { loadGLTF, modelUrl } from '../engine/assets.js';
import { mulberry32 } from './noise.js';
import {
  ARENA, BOWL, LOWER_ROWS, UPPER_ROWS, arenaZone, arcLength, enumerateSeats,
  hoopX, ovalPoint, sectionAngle, standSpawn, tunnelInfo,
} from './arenaLayout.js';
import { PropBatcher, withBatcher } from './propBatcher.js';
import {
  makeBanner, makeConcrete, makeCourtPaint, makeEmissive, makeGardenSign, makeGlass,
  makeHardwood, makeJumbotron, makeMarquee, makeMetal, makeSeatFabric, makeTerrazzo,
} from './arenaMaterials.js';

const UP = new THREE.Vector3(0, 1, 0);
const SEAT_NAVY = new THREE.Color(0x12151c);
const SEAT_WEAR = new THREE.Color(0x1a1e26);

function shade(o) {
  o.traverse((c) => {
    if (!c.isMesh) return;
    if (c.material?.transparent || c.material?.isShaderMaterial) {
      c.castShadow = false;
      return;
    }
    c.castShadow = c.receiveShadow = true;
  });
  return o;
}

function mesh(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

function addBox(colliders, x, z, y, hx, hz, h, type = 'concrete') {
  colliders.addBox({
    x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: y, y1: y + h, type,
  });
}

function seatGeo() {
  const cushion = new THREE.BoxGeometry(0.46, 0.09, 0.42);
  const back = new THREE.BoxGeometry(0.46, 0.5, 0.07);
  const armL = new THREE.BoxGeometry(0.05, 0.16, 0.4);
  const armR = armL.clone();
  cushion.translate(0, 0.045, 0);
  back.translate(0, 0.3, -0.175);
  armL.translate(-0.215, 0.12, 0);
  armR.translate(0.215, 0.12, 0);
  const pos = [];
  const nrm = [];
  const idx = [];
  let base = 0;
  for (const g of [cushion, back, armL, armR]) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const ix = g.index;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export class Arena {
  constructor(terrain, colliders, pipeline) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.pipeline = pipeline;
    this.group = new THREE.Group();
    this.group.name = 'madison-square-garden';
    this.batcher = null;
    this._leds = [];
    this._t = 0;
    this.spawns = [];
  }

  async load(progress) {
    const ids = [
      'painted_wooden_bench', 'metal_trash_can', 'wooden_crate_01', 'barrel_03',
      'utility_box_01', 'utility_box_02', 'street_lamp_01', 'concrete_road_barrier',
      'planter_box_01', 'barrel_stove',
    ];
    const models = await progress.task('Loading Garden dressing', 6, () => (
      Promise.all(ids.map((id) => loadGLTF(modelUrl(id))))
    ));
    this.models = Object.fromEntries(ids.map((id, i) => [id, models[i]]));
  }

  build(layout) {
    const rand = mulberry32((layout?.seed || 0) ^ 0x5a9e);
    const y0 = ARENA.baseY;
    const mats = {
      wood: makeHardwood(),
      court: makeCourtPaint(makeHardwood()),
      conc: makeConcrete(0x6a6762),
      darkConc: makeConcrete(0x2a2c32),
      terrazzo: makeTerrazzo(),
      seat: makeSeatFabric(),
      steel: makeMetal(0x6a7078, 0.4),
      chrome: makeMetal(0xb8bec6, 0.22),
      glass: makeGlass(),
      led: makeEmissive(0xc8b48a, 0.42),
      amber: makeEmissive(0xff9a32, 0.7),
      jumbo: makeJumbotron(),
      sign: makeGardenSign(),
      marquee: makeMarquee(),
      orange: makeBanner(0xc45a18),
      blue: makeBanner(0x0c3a7a),
      housing: new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.62, metalness: 0.18 }),
      pad: new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.78, metalness: 0.06 }),
      rim: new THREE.MeshStandardMaterial({
        color: 0xe85a12, roughness: 0.28, metalness: 0.55, emissive: 0x5a1c04, emissiveIntensity: 0.25,
      }),
    };
    this._leds.push(mats.jumbo, mats.marquee);
    if (this.pipeline) this.pipeline.indoor = true;

    this.buildCourt(mats, y0);
    this.buildCourtside(mats, y0);
    this.buildHoops(mats, y0);
    this.buildStands(mats, y0, rand);
    this.buildFascia(mats);
    this.buildJumbotron(mats);
    this.buildRoof(mats);
    this.buildConcourse(mats, y0, rand);
    this.buildFacade(mats, y0);
    this.buildPlaza(mats, y0);
    this.dressProps(rand);
    this.lightArena(y0);
    this.group.traverse((o) => {
      if (o.isMesh && !o.material?.transparent && !o.material?.isShaderMaterial) {
        o.receiveShadow = true;
        if (!o.userData.noShadow) o.castShadow = true;
      }
    });
    const fog = this.pipeline.fogMaterial.uniforms;
    if (fog.uFogDensity) fog.uFogDensity.value = 0.0016;
  }

  spawnFor(slot = 0) {
    return standSpawn(slot);
  }

  buildCourt(mats, y0) {
    const { courtHX: hx, courtHZ: hz } = ARENA;
    const floor = mesh(new THREE.BoxGeometry(hx * 2 + 0.08, 0.06, hz * 2 + 0.08), mats.court, 0, y0 + 0.04, 0);
    floor.name = 'msg-court';
    floor.receiveShadow = true;
    floor.castShadow = false;
    floor.userData.noShadow = true;
    this.group.add(floor);

    const apron = mesh(new THREE.BoxGeometry(hx * 2 + 8.8, 0.04, hz * 2 + 7.4), mats.pad, 0, y0 + 0.015, 0);
    apron.receiveShadow = true;
    apron.castShadow = false;
    apron.userData.noShadow = true;
    this.group.add(apron);

    const paint = new THREE.MeshStandardMaterial({
      color: 0x14161c, roughness: 0.55, metalness: 0.04,
    });
    for (const s of [-1, 1]) {
      this.group.add(mesh(new THREE.BoxGeometry(1.35, 0.02, hz * 2 + 0.5), paint, s * (hx + 0.85), y0 + 0.045, 0));
    }
  }

  buildCourtside(mats, y0) {
    const hz = ARENA.courtHZ;
    const table = mesh(new THREE.BoxGeometry(14.5, 0.08, 0.72), mats.darkConc, 0, y0 + 0.78, -(hz + 2.15));
    this.group.add(table);
    this.group.add(mesh(new THREE.BoxGeometry(14.5, 0.72, 0.08), mats.jumbo, 0, y0 + 1.12, -(hz + 1.78)));
    addBox(this.colliders, 0, -(hz + 2.15), y0, 7.3, 0.4, 1.15, 'cover');
    for (const side of [-1, 1]) {
      const z = side * (hz + 2.05);
      this.group.add(mesh(new THREE.BoxGeometry(9.2, 0.42, 0.55), mats.pad, side * 4.2, y0 + 0.48, z));
      addBox(this.colliders, side * 4.2, z, y0, 4.6, 0.32, 0.7, 'cover');
    }
  }

  buildHoops(mats, y0) {
    const hx = hoopX();
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const stanchionX = s * (ARENA.courtHX + 2.15);
      g.add(mesh(new THREE.BoxGeometry(1.35, 2.15, 1.55), mats.pad, stanchionX, y0 + 1.08, 0));
      g.add(mesh(new THREE.BoxGeometry(0.28, 0.22, 2.6), mats.steel, s * (hx + 0.55), y0 + 3.12, 0));
      const arm = mesh(new THREE.BoxGeometry(2.05, 0.16, 0.22), mats.steel, s * (hx + 0.15), y0 + 3.18, 0);
      g.add(arm);
      const glass = mesh(new THREE.BoxGeometry(0.04, 1.07, 1.83), mats.glass, s * hx + s * 0.22, y0 + 3.52, 0);
      g.add(glass);
      g.add(mesh(new THREE.BoxGeometry(0.05, 1.12, 1.88), mats.steel, s * hx + s * 0.26, y0 + 3.52, 0));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.018, 10, 24), mats.rim);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(s * hx, y0 + 3.05, 0);
      g.add(rim);
      const net = new THREE.Mesh(
        new THREE.CylinderGeometry(0.21, 0.14, 0.4, 10, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0xf2f2f0, roughness: 0.7, metalness: 0, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
        }),
      );
      net.position.set(s * hx, y0 + 2.82, 0);
      g.add(net);
      this.group.add(shade(g));
      addBox(this.colliders, stanchionX, 0, y0, 0.7, 0.8, 2.2, 'cover');
      addBox(this.colliders, s * hx + s * 0.2, 0, y0 + 2.4, 0.2, 1.0, 1.5, 'metal');
    }
  }

  buildStands(mats, y0, rand) {
    const seats = enumerateSeats();
    const dummy = new THREE.Object3D();
    const geo = seatGeo();
    const inst = new THREE.InstancedMesh(geo, mats.seat, seats.length);
    inst.name = 'bowl-seats';
    inst.frustumCulled = false;
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(seats.length * 3), 3);
    seats.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.quaternion.setFromAxisAngle(UP, s.yaw);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      const col = rand() < 0.07 ? SEAT_WEAR : SEAT_NAVY;
      inst.setColorAt(i, col);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.instanceColor.needsUpdate = true;
    this.group.add(inst);

    const treads = [];
    const banks = [
      { rows: LOWER_ROWS, y0 },
      { rows: UPPER_ROWS, y0: ARENA.concY },
    ];
    for (const bank of banks) {
      for (const row of bank.rows) {
        for (let sec = 0; sec < BOWL.sections; sec++) {
          const a0 = (sec / BOWL.sections) * Math.PI * 2;
          const a1 = ((sec + 1) / BOWL.sections) * Math.PI * 2;
          const ang = (a0 + a1) * 0.5;
          const mid = ovalPoint((row.u0 + row.u1) * 0.5, ang);
          const depth = (row.u1 - row.u0) * (ARENA.sx + ARENA.sz) * 0.5;
          const width = arcLength((row.u0 + row.u1) * 0.5, a0, a1);
          treads.push({
            x: mid.x, z: mid.z, y: row.y - 0.04, yaw: ang,
            sx: Math.max(1.2, width), sy: 0.09, sz: Math.max(0.45, depth * 0.92),
          });
          if (row.wide) {
            const back = ovalPoint(row.seatU, ang);
            addBox(this.colliders, back.x, back.z, row.y, Math.max(0.7, width * 0.22), Math.max(0.7, depth * 0.22), 0.85, 'cover');
          } else if (row.row % 4 === 1) {
            addBox(this.colliders, mid.x, mid.z, row.y, Math.max(0.55, width * 0.28), Math.max(0.55, depth * 0.28), 0.7, 'cover');
          }
        }
      }
    }
    const slab = new THREE.BoxGeometry(1, 1, 1);
    const treadMesh = new THREE.InstancedMesh(slab, mats.pad, treads.length);
    treadMesh.name = 'bowl-treads';
    treadMesh.frustumCulled = false;
    treadMesh.castShadow = false;
    treadMesh.receiveShadow = true;
    treads.forEach((t, i) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.quaternion.setFromAxisAngle(UP, -t.yaw);
      dummy.scale.set(t.sx, t.sy, t.sz);
      dummy.updateMatrix();
      treadMesh.setMatrixAt(i, dummy.matrix);
    });
    treadMesh.instanceMatrix.needsUpdate = true;
    this.group.add(treadMesh);

    const spawnRow = LOWER_ROWS[BOWL.spawnRow - 1];
    for (let sec = 0; sec < BOWL.sections; sec++) {
      const ang = sectionAngle(sec, 0.5);
      const rail = ovalPoint(spawnRow.u0 + 0.012, ang);
      this.group.add(mesh(new THREE.BoxGeometry(2.4, 0.06, 0.06), mats.chrome, rail.x, spawnRow.y + 0.92, rail.z, 0, -ang, 0));
      this.group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), mats.chrome, rail.x, spawnRow.y + 0.46, rail.z));
    }

    const lastUp = UPPER_ROWS[UPPER_ROWS.length - 1];
    for (let i = 0; i < 48; i++) {
      const ang = (i / 48) * Math.PI * 2;
      const p = ovalPoint(lastUp.u1, ang);
      this.group.add(mesh(new THREE.BoxGeometry(4.6, 1.55, 0.22), mats.pad, p.x, lastUp.y + 0.78, p.z, 0, -ang, 0));
      addBox(this.colliders, p.x, p.z, lastUp.y, 2.1, 1.1, 1.6, 'cover');
    }

    for (let slot = 0; slot < 8; slot++) {
      const ang = slot * Math.PI / 4;
      const p = ovalPoint(ARENA.bowlIn + 0.02, ang);
      const portal = mesh(new THREE.TorusGeometry(1.55, 0.08, 8, 18, Math.PI), mats.steel, p.x, y0 + 1.7, p.z, 0, -ang, 0);
      portal.userData.noShadow = true;
      this.group.add(portal);
    }
  }

  buildFascia(mats) {
    for (const u of [ARENA.bowlIn + 0.01, ARENA.concIn - 0.02, ARENA.concOut + 0.03]) {
      for (let i = 0; i < 48; i++) {
        const ang = (i / 48) * Math.PI * 2;
        const p = ovalPoint(u, ang);
        const y = u < ARENA.concIn ? LOWER_ROWS[0].y + 0.55 : ARENA.concY + 0.7;
        const board = mesh(new THREE.BoxGeometry(3.1, 0.55, 0.08), mats.jumbo, p.x, y, p.z, 0, -ang, 0);
        board.userData.noShadow = true;
        this.group.add(board);
      }
    }
  }

  buildJumbotron(mats) {
    const g = new THREE.Group();
    g.name = 'msg-scoreboard';
    g.position.set(0, ARENA.baseY + 14.4, 0);
    const body = mesh(new THREE.BoxGeometry(8.8, 5.1, 8.8), mats.housing, 0, 0, 0);
    g.add(body);
    const face = new THREE.PlaneGeometry(8.25, 4.55);
    const faces = [
      [0, 0, 4.42, 0],
      [0, 0, -4.42, Math.PI],
      [4.42, 0, 0, Math.PI / 2],
      [-4.42, 0, 0, -Math.PI / 2],
    ];
    for (const [x, y, z, ry] of faces) {
      const p = mesh(face, mats.jumbo, x, y, z, 0, ry, 0);
      p.userData.noShadow = true;
      g.add(p);
      const strip = mesh(new THREE.PlaneGeometry(8.3, 0.38), mats.sign, x * 1.006, -2.42, z * 1.006, 0, ry, 0);
      strip.userData.noShadow = true;
      g.add(strip);
    }
    g.add(mesh(new THREE.BoxGeometry(9.1, 0.16, 9.1), mats.housing, 0, 2.64, 0));
    g.add(mesh(new THREE.BoxGeometry(9.1, 0.16, 9.1), mats.housing, 0, -2.64, 0));
    for (const [x, z] of [[-3.9, -3.9], [3.9, -3.9], [-3.9, 3.9], [3.9, 3.9]]) {
      g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 13.4, 6), mats.steel, x, 8.6, z));
    }
    this.group.add(g);
    addBox(this.colliders, 0, 0, ARENA.baseY + 12.1, 4.8, 4.8, 4.6, 'metal');
  }

  buildRoof(mats) {
    const roofY = 29.2;
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x121418, roughness: 0.94, metalness: 0.03, envMapIntensity: 0.06,
    });
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2.6, 48, 1, false), roofMat);
    roof.name = 'msg-roof';
    roof.position.y = roofY;
    roof.scale.set(ARENA.sx * ARENA.hallOut * 1.08, 1, ARENA.sz * ARENA.hallOut * 1.08);
    roof.receiveShadow = true;
    this.group.add(roof);

    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2;
      const { x, z } = ovalPoint(ARENA.hallOut * 0.92, ang);
      this.group.add(mesh(new THREE.BoxGeometry(0.22, 2.4, 0.22), mats.steel, x * 0.15, roofY - 1.1, z * 0.15));
      const beam = mesh(new THREE.BoxGeometry(Math.hypot(x, z) * 0.92, 0.16, 0.2), mats.steel, x * 0.46, roofY - 0.2, z * 0.46, 0, -ang, 0);
      this.group.add(beam);
    }

    for (let ring = 0; ring < 3; ring++) {
      const u = 0.55 + ring * 0.7;
      const n = 16 + ring * 8;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const { x, z } = ovalPoint(u, ang);
        const lamp = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 8), mats.led, x, roofY - 0.55, z);
        lamp.userData.noShadow = true;
        this.group.add(lamp);
      }
    }

    const banners = [0x006bb6, 0xf58426, 0xffffff, 0x006bb6, 0xf58426, 0x0a0c12, 0xffffff, 0x006bb6];
    banners.forEach((hex, i) => {
      const ang = (i / banners.length) * Math.PI * 2 + 0.18;
      const p = ovalPoint(1.72, ang);
      const mat = makeBanner(hex);
      this.group.add(mesh(new THREE.BoxGeometry(0.95, 1.7, 0.04), mat, p.x, 26.1, p.z, 0, -ang, 0));
    });
    const flag = new THREE.Group();
    flag.position.set(0, roofY - 1.6, ARENA.sz * 1.35);
    flag.add(mesh(new THREE.BoxGeometry(1.35, 0.82, 0.03), makeBanner(0xb22234), 0, 0, 0));
    flag.add(mesh(new THREE.BoxGeometry(0.52, 0.42, 0.035), makeBanner(0x1a237e), -0.4, 0.18, 0.01));
    this.group.add(flag);
  }

  buildConcourse(mats, y0, rand) {
    const hallY = y0;
    const concY = ARENA.concY;

    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2 + 0.04;
      const inner = ovalPoint((ARENA.concIn + ARENA.concOut) * 0.5, ang);
      if (tunnelInfo(inner.x, inner.z).inBand) continue;
      const col = mesh(new THREE.CylinderGeometry(0.42, 0.48, 4.6, 10), mats.conc, inner.x, concY + 2.3, inner.z);
      this.group.add(col);
      addBox(this.colliders, inner.x, inner.z, concY, 0.5, 0.5, 4.6, 'concrete');
    }

    for (let i = 0; i < 22; i++) {
      const ang = (i / 22) * Math.PI * 2;
      const p = ovalPoint((ARENA.hallOut + ARENA.concOut) * 0.52, ang);
      if (tunnelInfo(p.x, p.z).inBand) continue;
      const col = mesh(new THREE.CylinderGeometry(0.48, 0.55, 7.2, 10), mats.conc, p.x, hallY + 3.6, p.z);
      this.group.add(col);
      addBox(this.colliders, p.x, p.z, hallY, 0.55, 0.55, 7.2, 'concrete');
    }

    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + 0.2;
      const p = ovalPoint(ARENA.hallOut - 0.55, ang);
      if (tunnelInfo(p.x, p.z).lat < 4.2 && tunnelInfo(p.x, p.z).inBand) continue;
      const yaw = ang + Math.PI;
      const stall = new THREE.Group();
      stall.add(mesh(new THREE.BoxGeometry(4.6, 1.12, 1.35), mats.darkConc, 0, 0.56, 0));
      stall.add(mesh(new THREE.BoxGeometry(4.4, 0.08, 0.7), mats.steel, 0, 1.16, 0.15));
      stall.add(mesh(new THREE.BoxGeometry(3.6, 0.85, 0.06), mats.amber, 0, 2.05, -0.55));
      stall.position.set(p.x, hallY, p.z);
      stall.rotation.y = yaw;
      this.group.add(stall);
      addBox(this.colliders, p.x, p.z, hallY, 2.1, 0.7, 1.2, 'cover');
    }

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.35;
      const p = ovalPoint((ARENA.concIn + ARENA.concOut) * 0.5, ang);
      if (tunnelInfo(p.x, p.z).inBand) continue;
      const room = mesh(new THREE.BoxGeometry(5.2, 3.1, 3.4), mats.darkConc, p.x, concY + 1.55, p.z, 0, -ang, 0);
      this.group.add(room);
      addBox(this.colliders, p.x, p.z, concY, 2.4, 1.6, 3.1, 'concrete');
    }

    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2;
      const p = ovalPoint((ARENA.concIn + ARENA.concOut) * 0.5, ang);
      if (tunnelInfo(p.x, p.z).inBand) continue;
      const strip = mesh(new THREE.BoxGeometry(1.6, 0.05, 0.12), mats.led, p.x, concY + 3.55, p.z, 0, -ang, 0);
      strip.userData.noShadow = true;
      this.group.add(strip);
    }

    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + 0.12 + rand() * 0.05;
      const p = ovalPoint(ARENA.hallOut - 0.22, ang);
      const board = mesh(new THREE.BoxGeometry(2.4, 1.6, 0.08), i % 2 ? mats.orange : mats.blue, p.x, hallY + 3.4, p.z, 0, -ang, 0);
      this.group.add(board);
    }
  }

  buildFacade(mats, y0) {
    const u0 = ARENA.hallOut;
    const u1 = ARENA.facadeOut;
    const h = 27.8;
    const wall = new THREE.CylinderGeometry(1, 1, h, 48, 1, true);
    const shell = new THREE.Mesh(wall, mats.darkConc);
    shell.position.y = y0 + h * 0.5;
    shell.scale.set(ARENA.sx * u1, 1, ARENA.sz * u1);
    this.group.add(shell);

    const inner = new THREE.Mesh(wall.clone(), mats.conc);
    inner.position.y = y0 + h * 0.5;
    inner.scale.set(ARENA.sx * u0, 1, ARENA.sz * u0);
    this.group.add(inner);

    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2;
      const p = ovalPoint((u0 + u1) * 0.5, ang);
      if (tunnelInfo(p.x, p.z).inBand) continue;
      const win = mesh(new THREE.BoxGeometry(2.6, 3.4, 0.12), mats.glass, p.x, y0 + 14.2, p.z, 0, -ang, 0);
      this.group.add(win);
      const win2 = mesh(new THREE.BoxGeometry(2.6, 2.2, 0.12), mats.glass, p.x, y0 + 8.6, p.z, 0, -ang, 0);
      this.group.add(win2);
    }

    for (let slot = 0; slot < 8; slot += 2) {
      const ang = slot * Math.PI / 4;
      const p = ovalPoint((u0 + u1) * 0.5, ang);
      const door = mesh(new THREE.BoxGeometry(5.2, 3.6, 0.2), mats.glass, p.x, y0 + 1.85, p.z, 0, -ang, 0);
      this.group.add(door);
      const frame = mesh(new THREE.BoxGeometry(5.5, 0.18, 0.35), mats.chrome, p.x, y0 + 3.7, p.z, 0, -ang, 0);
      this.group.add(frame);
    }

    const signR = (ARENA.sx + ARENA.sz) * 0.5 * u1 + 0.2;
    const marquees = [
      [0, signR * ARENA.sz / ((ARENA.sx + ARENA.sz) * 0.5)],
      [0, -signR * ARENA.sz / ((ARENA.sx + ARENA.sz) * 0.5)],
      [ARENA.sx * u1 + 0.35, 0],
      [-ARENA.sx * u1 - 0.35, 0],
    ];
    marquees.forEach(([x, z], i) => {
      const yaw = i < 2 ? 0 : Math.PI / 2;
      const board = mesh(new THREE.BoxGeometry(18, 1.8, 0.22), mats.marquee, x, y0 + 16.4, z, 0, yaw, 0);
      board.userData.noShadow = true;
      this.group.add(board);
    });

    const badge = mesh(new THREE.CircleGeometry(3.4, 28), mats.orange, 0, y0 + 20.2, ARENA.sz * u1 + 0.15);
    badge.userData.noShadow = true;
    this.group.add(badge);
    const badgeIn = mesh(new THREE.CircleGeometry(2.55, 28), mats.blue, 0, y0 + 20.2, ARENA.sz * u1 + 0.18);
    this.group.add(badgeIn);

    for (let i = 0; i < 64; i++) {
      const ang = (i / 64) * Math.PI * 2;
      const p = ovalPoint(u1, ang);
      const next = ovalPoint(u1, ang + Math.PI / 64);
      const mx = (p.x + next.x) * 0.5, mz = (p.z + next.z) * 0.5;
      if (tunnelInfo(mx, mz).inBand) continue;
      addBox(this.colliders, mx, mz, y0, Math.max(0.8, Math.abs(next.x - p.x) * 0.5 + 0.45), Math.max(0.8, Math.abs(next.z - p.z) * 0.5 + 0.45), h, 'concrete');
    }
  }

  buildPlaza(mats, y0) {
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + 0.1;
      const p = ovalPoint(ARENA.plazaOut - 0.8, ang);
      this.group.add(mesh(new THREE.BoxGeometry(1.6, 0.55, 1.6), mats.conc, p.x, y0 + 0.28, p.z));
      addBox(this.colliders, p.x, p.z, y0, 0.8, 0.8, 0.6, 'cover');
    }
    const kiosk = mesh(new THREE.BoxGeometry(6.4, 3.2, 4.2), mats.darkConc, 0, y0 + 1.6, ARENA.sz * ARENA.plazaOut * 0.72);
    this.group.add(kiosk);
    addBox(this.colliders, 0, ARENA.sz * ARENA.plazaOut * 0.72, y0, 3.2, 2.1, 3.2, 'concrete');
    const ticket = mesh(new THREE.BoxGeometry(5.5, 1.1, 0.2), mats.marquee, 0, y0 + 3.4, ARENA.sz * ARENA.plazaOut * 0.72 + 2.2);
    ticket.userData.noShadow = true;
    this.group.add(ticket);
  }

  dressProps(rand) {
    this.batcher = new PropBatcher(this.models);
    withBatcher(this.batcher, () => {
      const place = (id, x, z, yaw, scale, coverY, type) => {
        const zone = arenaZone(x, z);
        if (zone === 'court' || zone === 'bowl' || zone === 'facade') return null;
        return this.batcher.place(id, x, z, yaw, scale, coverY, type, this.terrain, this.colliders);
      };
      for (let i = 0; i < 18; i++) {
        const ang = (i / 18) * Math.PI * 2 + rand() * 0.1;
        const u = ARENA.concIn + 0.25 + rand() * (ARENA.concOut - ARENA.concIn - 0.45);
        const p = ovalPoint(u, ang);
        if (tunnelInfo(p.x, p.z).inBand) continue;
        place('painted_wooden_bench', p.x, p.z, ang + Math.PI * 0.5, 1, 0.7, 'cover');
      }
      for (let i = 0; i < 16; i++) {
        const ang = rand() * Math.PI * 2;
        const u = ARENA.concOut + 0.3 + rand() * (ARENA.hallOut - ARENA.concOut - 0.6);
        const p = ovalPoint(u, ang);
        if (arenaZone(p.x, p.z) !== 'hall') continue;
        place(rand() < 0.5 ? 'metal_trash_can' : 'barrel_03', p.x, p.z, rand() * 6, 1, 1.1, 'cover');
      }
      for (let i = 0; i < 10; i++) {
        const ang = rand() * Math.PI * 2;
        const u = ARENA.facadeOut + 0.6 + rand() * 1.2;
        const p = ovalPoint(u, ang);
        place('street_lamp_01', p.x, p.z, ang, 1, 0.4, 'metal');
        if (rand() < 0.55) place('planter_box_01', p.x + Math.cos(ang + 1) * 2.2, p.z + Math.sin(ang + 1) * 2.2, ang, 1, 0.7, 'cover');
      }
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + 0.4;
        const p = ovalPoint(ARENA.plazaOut - 0.35, ang);
        place('concrete_road_barrier', p.x, p.z, ang + Math.PI * 0.5, 1, 0.9, 'cover');
      }
      for (let i = 0; i < 7; i++) {
        const ang = rand() * Math.PI * 2;
        const u = ARENA.concIn + 0.4 + rand() * 0.5;
        const p = ovalPoint(u, ang);
        if (arenaZone(p.x, p.z) !== 'concourse') continue;
        place(rand() < 0.5 ? 'wooden_crate_01' : 'utility_box_01', p.x, p.z, rand() * 6, 1, 1.0, 'cover');
      }
    });
    this.batcher.bake(this.group);
    this.batcher.update({ x: 0, y: 4, z: 0 });
  }

  lightArena(y0) {
    const hemi = new THREE.HemisphereLight(0xe8edf4, 0x14161c, 0.7);
    this.group.add(hemi);
    const wash = new THREE.DirectionalLight(0xfff3dc, 4.2);
    wash.position.set(0, y0 + 26, 0.4);
    wash.target.position.set(0, y0, 0);
    wash.castShadow = false;
    this.group.add(wash, wash.target);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const p = ovalPoint(1.35, ang);
      const aim = ovalPoint(0.35, ang);
      const spot = new THREE.SpotLight(0xfff4e2, 120, 78, 0.58, 0.32, 1.25);
      spot.position.set(p.x * 0.42, y0 + 24.5, p.z * 0.42);
      spot.target.position.set(aim.x, y0, aim.z);
      spot.castShadow = false;
      this.group.add(spot, spot.target);
    }
    const court = new THREE.PointLight(0xfff0d8, 14, 62, 1.15);
    court.position.set(0, y0 + 16.2, 0);
    court.castShadow = false;
    this.group.add(court);
  }

  update(dt, _fx, camera) {
    this._t += dt;
    for (const m of this._leds) {
      if (m.uniforms?.uTime) m.uniforms.uTime.value = this._t;
    }
    if (camera) this.batcher?.update(camera.position);
  }
}
