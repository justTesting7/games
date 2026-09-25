import * as THREE from 'three';
import { loadGLTF, modelUrl } from '../engine/assets.js';
import { mulberry32 } from './noise.js';
import { ARENA, arenaZone, hoopX, tunnelInfo } from './arenaLayout.js';
import { PropBatcher, withBatcher } from './propBatcher.js';
import {
  makeBanner, makeConcrete, makeCourtPaint, makeEmissive, makeGlass,
  makeHardwood, makeJumbotron, makeMarquee, makeMetal, makeSeatFabric, makeTerrazzo,
} from './arenaMaterials.js';

const UP = new THREE.Vector3(0, 1, 0);
const SEAT_NAVY = new THREE.Color(0x1a2347);
const SEAT_ORANGE = new THREE.Color(0xc45a18);
const SEAT_BLUE = new THREE.Color(0x0c3a7a);
const SEAT_DARK = new THREE.Color(0x14161c);

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

function ovalPoint(u, ang) {
  return { x: Math.cos(ang) * ARENA.sx * u, z: Math.sin(ang) * ARENA.sz * u };
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
      conc: makeConcrete(0x8c8880),
      darkConc: makeConcrete(0x5a5854),
      terrazzo: makeTerrazzo(),
      seat: makeSeatFabric(),
      steel: makeMetal(0x6a7078, 0.4),
      chrome: makeMetal(0xb8bec6, 0.22),
      glass: makeGlass(),
      led: makeEmissive(0xffe6b0, 1.8),
      amber: makeEmissive(0xff9a32, 1.6),
      jumbo: makeJumbotron(),
      marquee: makeMarquee(),
      orange: makeBanner(0xc45a18),
      blue: makeBanner(0x0c3a7a),
      pad: new THREE.MeshStandardMaterial({ color: 0x2a2c32, roughness: 0.7, metalness: 0.08 }),
      rim: new THREE.MeshStandardMaterial({
        color: 0xe85a12, roughness: 0.28, metalness: 0.55, emissive: 0x5a1c04, emissiveIntensity: 0.25,
      }),
    };
    this._leds.push(mats.jumbo, mats.marquee);

    this.buildCourt(mats, y0);
    this.buildHoops(mats, y0);
    this.buildStands(mats, y0, rand);
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
    if (fog.uFogDensity) fog.uFogDensity.value = 0.0036;
  }

  buildCourt(mats, y0) {
    const { courtHX: hx, courtHZ: hz } = ARENA;
    const floor = mesh(new THREE.BoxGeometry(hx * 2 + 0.08, 0.06, hz * 2 + 0.08), mats.court, 0, y0 + 0.04, 0);
    floor.receiveShadow = true;
    floor.castShadow = false;
    floor.userData.noShadow = true;
    this.group.add(floor);

    const apron = mesh(new THREE.BoxGeometry(hx * 2 + 6.4, 0.04, hz * 2 + 6.2), mats.wood, 0, y0 + 0.015, 0);
    apron.receiveShadow = true;
    apron.castShadow = false;
    apron.userData.noShadow = true;
    this.group.add(apron);

    const paint = new THREE.MeshStandardMaterial({
      color: 0x1a1c22, roughness: 0.55, metalness: 0.04,
    });
    for (const s of [-1, 1]) {
      this.group.add(mesh(new THREE.BoxGeometry(1.15, 0.02, hz * 2 + 0.4), paint, s * (hx + 0.7), y0 + 0.045, 0));
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
    const geo = seatGeo();
    const dummy = new THREE.Object3D();
    const lower = [];
    const upper = [];
    const sections = 16;
    for (let sec = 0; sec < sections; sec++) {
      const a0 = (sec / sections) * Math.PI * 2 + 0.07;
      const a1 = ((sec + 1) / sections) * Math.PI * 2 - 0.07;
      const mid = (a0 + a1) * 0.5;
      const doorAt = ovalPoint(2.0, mid);
      if (tunnelInfo(doorAt.x, doorAt.z).inBand) continue;
      const rows = 17;
      for (let row = 0; row < rows; row++) {
        const u = ARENA.bowlIn + (row + 0.55) / rows * (ARENA.concIn - ARENA.bowlIn - 0.08);
        const y = y0 + 0.22 + row * 0.46;
        const nSeats = 9 + Math.floor(row * 0.4);
        const rowSeats = [];
        for (let s = 0; s < nSeats; s++) {
          const t = (s + 0.5) / nSeats;
          const ang = a0 + (a1 - a0) * t;
          const { x, z } = ovalPoint(u, ang);
          const yaw = Math.atan2(x, z) + Math.PI;
          rowSeats.push({ x, y, z, yaw, sec, row });
        }
        lower.push(...rowSeats);
        if (row % 3 === 0 && rowSeats.length) {
          const a = rowSeats[0], b = rowSeats[rowSeats.length - 1];
          addBox(this.colliders, (a.x + b.x) * 0.5, (a.z + b.z) * 0.5, y0, Math.max(0.6, Math.abs(b.x - a.x) * 0.5 + 0.3), Math.max(0.6, Math.abs(b.z - a.z) * 0.5 + 0.3), y - y0 + 0.7, 'cover');
        }
      }
      const uRows = 13;
      for (let row = 0; row < uRows; row++) {
        const u = ARENA.concOut + 0.08 + (row + 0.5) / uRows * (ARENA.hallOut - ARENA.concOut - 0.55);
        const y = ARENA.concY + 0.25 + row * 0.5;
        const nSeats = 11 + Math.floor(row * 0.35);
        for (let s = 0; s < nSeats; s++) {
          const t = (s + 0.5) / nSeats;
          const ang = a0 + (a1 - a0) * t;
          const { x, z } = ovalPoint(u, ang);
          upper.push({ x, y, z, yaw: Math.atan2(x, z) + Math.PI, sec, row });
        }
      }
    }

    const place = (list, name) => {
      if (!list.length) return;
      const inst = new THREE.InstancedMesh(geo, mats.seat, list.length);
      inst.name = name;
      inst.frustumCulled = false;
      inst.castShadow = false;
      inst.receiveShadow = true;
      inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      list.forEach((s, i) => {
        dummy.position.set(s.x, s.y, s.z);
        dummy.quaternion.setFromAxisAngle(UP, s.yaw);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        const end = Math.abs(s.x) > Math.abs(s.z) * 1.1;
        const col = end ? (s.sec % 2 ? SEAT_ORANGE : SEAT_BLUE) : (rand() < 0.08 ? SEAT_ORANGE : SEAT_NAVY);
        const c = rand() < 0.12 ? SEAT_DARK : col;
        inst.setColorAt(i, c);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
    };
    place(lower, 'lower-bowl');
    place(upper, 'upper-bowl');

    const rail = mats.chrome;
    for (let i = 0; i < 48; i++) {
      const ang = (i / 48) * Math.PI * 2;
      const { x, z } = ovalPoint(ARENA.bowlIn + 0.02, ang);
      if (tunnelInfo(x, z).inBand) continue;
      this.group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6), rail, x, y0 + 0.7, z));
    }
    const innerRail = new THREE.Mesh(
      new THREE.TorusGeometry((ARENA.sx + ARENA.sz) * 0.5 * ARENA.bowlIn, 0.025, 6, 64),
      rail,
    );
    innerRail.rotation.x = Math.PI / 2;
    innerRail.position.y = y0 + 1.12;
    innerRail.scale.set(ARENA.sx / ((ARENA.sx + ARENA.sz) * 0.5), 1, ARENA.sz / ((ARENA.sx + ARENA.sz) * 0.5));
    this.group.add(innerRail);
  }

  buildJumbotron(mats) {
    const g = new THREE.Group();
    g.position.set(0, 19.2, 0);
    const body = mesh(new THREE.BoxGeometry(6.4, 4.2, 6.4), mats.steel, 0, 0, 0);
    g.add(body);
    const face = new THREE.PlaneGeometry(6.05, 3.7);
    const faces = [
      [0, 0, 3.22, 0],
      [0, 0, -3.22, Math.PI],
      [3.22, 0, 0, Math.PI / 2],
      [-3.22, 0, 0, -Math.PI / 2],
    ];
    for (const [x, y, z, ry] of faces) {
      const p = mesh(face, mats.jumbo, x, y, z, 0, ry, 0);
      p.userData.noShadow = true;
      g.add(p);
    }
    g.add(mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.35, 24), mats.led, 0, -2.25, 0));
    g.add(mesh(new THREE.BoxGeometry(0.35, 5.2, 0.35), mats.steel, 0, 4.4, 0));
    this.group.add(g);
    addBox(this.colliders, 0, 0, 16.8, 3.3, 3.3, 5.2, 'metal');
  }

  buildRoof(mats) {
    const roofY = 26.4;
    const roof = new THREE.Mesh(
      new THREE.CircleGeometry((ARENA.sx + ARENA.sz) * 0.5 * ARENA.hallOut, 48),
      mats.darkConc,
    );
    roof.rotation.x = -Math.PI / 2;
    roof.position.y = roofY;
    roof.scale.set(ARENA.sx / ((ARENA.sx + ARENA.sz) * 0.5), 1, ARENA.sz / ((ARENA.sx + ARENA.sz) * 0.5));
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
        const lamp = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 10), mats.led, x, roofY - 0.55, z);
        lamp.userData.noShadow = true;
        this.group.add(lamp);
      }
    }

    const banners = [
      [0xc8102e, -8], [0x006bb6, -4.5], [0xf58426, -1], [0xffffff, 2.5], [0x0033a0, 6], [0xc8102e, 9.5],
    ];
    banners.forEach(([hex, x], i) => {
      const mat = makeBanner(hex);
      const b = mesh(new THREE.BoxGeometry(1.15, 2.4, 0.04), mat, x, 23.6, 10.5 - (i % 2) * 21);
      this.group.add(b);
    });
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
    const h = 24.8;
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
    const hemi = new THREE.HemisphereLight(0xffe2b8, 0x1a140c, 0.62);
    this.group.add(hemi);
    const court = new THREE.PointLight(0xfff1d2, 2.8, 70, 1.25);
    court.position.set(0, y0 + 14.5, 0);
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
