import * as THREE from 'three';
import { loadGLTF, modelUrl } from '../engine/assets.js';
import { mulberry32 } from './noise.js';
import {
  ARENA, BOWL, LOWER_ROWS, UPPER_ROWS, bowlFrame, enumerateSeats, hoopX, rowLength, standSpawn,
} from './arenaLayout.js';
import { PropBatcher, withBatcher } from './propBatcher.js';
import {
  COURT_BORDER, makeBanner, makeConcrete, makeCourtPaint, makeEmissive, makeGardenSign, makeGlass,
  makeHardwood, makeJumbotron, makeMetal, makeRibbon, makeSeatFabric,
} from './arenaMaterials.js';

const UP = new THREE.Vector3(0, 1, 0);
const S = BOWL.sections;
const AISLE_W = BOWL.aisle * 0.5;
const SEAT_NAVY = new THREE.Color(0x2a3450);
const SEAT_WEAR = new THREE.Color(0x323d5a);
const HALL_DOORS = new Set([3, 9, 16, 22]);
const DOOR_W = 2.8;
const DOOR_H = 2.9;

const C_TREAD = new THREE.Color(0x5c5e62);
const C_RISER = new THREE.Color(0x303236);
const C_AISLE = new THREE.Color(0xa4a5a4);
const C_AISLE_RISER = new THREE.Color(0x7c7d7e);
const C_FASCIA = new THREE.Color(0x2a2e36);
const C_SPANDREL = new THREE.Color(0x16181d);
const C_MULLION = new THREE.Color(0x0c0d10);
const C_WALL = new THREE.Color(0x1b1c20);
const C_HALL = new THREE.Color(0x6e6a64);

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

/** Distance `d` metres along section `sec` at offset `r`, as a perimeter parameter. */
function paramAt(sec, r, d) {
  const t0 = sec / S, t1 = (sec + 1) / S;
  const L = rowLength(r, t0, t1);
  return t0 + (Math.min(L, Math.max(0, d)) / L) * (t1 - t0);
}

function isArc(sec) {
  return rowLength(10, sec / S, (sec + 1) / S) !== rowLength(20, sec / S, (sec + 1) / S);
}

const FULL = (L) => [0, L];
const INNER = (L) => [AISLE_W, L - AISLE_W];
const AISLE_A = () => [0, AISLE_W];
const AISLE_B = (L) => [L - AISLE_W, L];

/**
 * Pieces of a section, fine enough to follow the corner arcs. `span(L)` gives
 * the [start, end] distance along the row, so aisles keep a constant width.
 */
function sectionPieces(sec, span = FULL) {
  const k = isArc(sec) ? 8 : 1;
  const at = (r, f) => {
    const L = rowLength(r, sec / S, (sec + 1) / S);
    const [d0, d1] = span(L);
    return paramAt(sec, r, d0 + (d1 - d0) * f);
  };
  const out = [];
  for (let i = 0; i < k; i++) {
    out.push({ at: (r) => at(r, i / k), bt: (r) => at(r, (i + 1) / k) });
  }
  return out;
}

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.idx = [];
  }

  vert(x, y, z, nx, ny, nz, c) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  /** Quad from four vertices given counter-clockwise when seen from the front. */
  quad(v, c) {
    const [a, b, cc, d] = v.map((p) => this.vert(p[0], p[1], p[2], p[3], p[4], p[5], c));
    this.idx.push(a, b, cc, a, cc, d);
  }

  /** Horizontal band between offsets r0..r1 at height y. */
  flat(sec, r0, r1, y, c, span = FULL) {
    for (const p of sectionPieces(sec, span)) {
      const a0 = bowlFrame(r0, p.at(r0)), b0 = bowlFrame(r0, p.bt(r0));
      const a1 = bowlFrame(r1, p.at(r1)), b1 = bowlFrame(r1, p.bt(r1));
      this.quad([
        [a0.x, y, a0.z, 0, 1, 0], [b0.x, y, b0.z, 0, 1, 0],
        [b1.x, y, b1.z, 0, 1, 0], [a1.x, y, a1.z, 0, 1, 0],
      ], c);
    }
  }

  /** Vertical band at offset r from y0 to y1, facing the court. */
  wall(sec, r, y0, y1, c, span = FULL, outward = false) {
    const s = outward ? 1 : -1;
    for (const p of sectionPieces(sec, span)) {
      const a = bowlFrame(r, p.at(r)), b = bowlFrame(r, p.bt(r));
      const va = [a.x, 0, a.z, a.nx * s, 0, a.nz * s];
      const vb = [b.x, 0, b.z, b.nx * s, 0, b.nz * s];
      const at = (v, y) => [v[0], y, v[2], v[3], v[4], v[5]];
      if (outward) this.quad([at(vb, y0), at(va, y0), at(va, y1), at(vb, y1)], c);
      else this.quad([at(va, y0), at(vb, y0), at(vb, y1), at(va, y1)], c);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function seatGeo() {
  const cushion = new THREE.BoxGeometry(0.44, 0.07, 0.3);
  const back = new THREE.BoxGeometry(0.46, 0.56, 0.06);
  const armL = new THREE.BoxGeometry(0.04, 0.5, 0.34);
  const armR = armL.clone();
  cushion.rotateX(-1.2);
  cushion.translate(0, 0.36, -0.06);
  back.translate(0, 0.52, -0.2);
  armL.translate(-0.235, 0.25, -0.08);
  armR.translate(0.235, 0.25, -0.08);
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

/** Filled rounded rectangle at offset r from the court, lying flat. */
function roundedRectShape(r, hx = ARENA.courtHX, hz = ARENA.courtHZ) {
  const s = new THREE.Shape();
  s.moveTo(hx + r, -hz);
  s.lineTo(hx + r, hz);
  s.absarc(hx, hz, r, 0, Math.PI / 2, false);
  s.lineTo(-hx, hz + r);
  s.absarc(-hx, hz, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx - r, -hz);
  s.absarc(-hx, -hz, r, Math.PI, Math.PI * 1.5, false);
  s.lineTo(hx, -hz - r);
  s.absarc(hx, -hz, r, Math.PI * 1.5, Math.PI * 2, false);
  return s;
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
    this.models = {};
  }

  async load(progress) {
    const ids = ['metal_trash_can', 'painted_wooden_bench', 'barrel_03'];
    const models = await progress.task('Loading Garden dressing', 3, () => (
      Promise.all(ids.map((id) => loadGLTF(modelUrl(id))))
    ));
    this.models = Object.fromEntries(ids.map((id, i) => [id, models[i]]));
  }

  build(layout) {
    const rand = mulberry32((layout?.seed || 0) ^ 0x5a9e);
    const y0 = ARENA.baseY;
    const mats = {
      court: makeCourtPaint(makeHardwood()),
      steps: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02, envMapIntensity: 0.1 }),
      trim: new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.52, metalness: 0.12, envMapIntensity: 0.18,
      }),
      conc: makeConcrete(0x5a5854),
      seat: makeSeatFabric(),
      steel: makeMetal(0x2a2c30, 0.5),
      chrome: makeMetal(0xb8bec6, 0.25),
      glass: makeGlass(),
      suiteGlass: new THREE.MeshStandardMaterial({
        color: 0x1a2836, roughness: 0.06, metalness: 0.35, transparent: true, opacity: 0.55,
        envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide,
      }),
      suiteGlow: new THREE.MeshStandardMaterial({
        color: 0x0c1016, roughness: 0.7, metalness: 0.05, emissive: 0x3a4a62, emissiveIntensity: 0.32,
      }),
      gold: new THREE.MeshStandardMaterial({
        color: 0xc9a227, roughness: 0.32, metalness: 0.55, emissive: 0x5a3e0c, emissiveIntensity: 0.28,
      }),
      fixture: makeEmissive(0xfff6e8, 3.2),
      amber: makeEmissive(0xff9a32, 0.9),
      jumbo: makeJumbotron(),
      ribbon: makeRibbon(),
      sign: makeGardenSign(),
      housing: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.5, metalness: 0.3 }),
      pad: new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.8, metalness: 0.05 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x0d0e11, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide }),
      rim: new THREE.MeshStandardMaterial({
        color: 0xe85a12, roughness: 0.28, metalness: 0.55, emissive: 0x5a1c04, emissiveIntensity: 0.25,
      }),
    };
    this._leds.push(mats.jumbo, mats.ribbon);
    if (this.pipeline) this.pipeline.indoor = true;

    this.buildCourt(mats, y0);
    this.buildCourtside(mats, y0);
    this.buildHoops(mats, y0);
    this.buildStands(mats, y0, rand);
    this.buildRails(mats);
    this.buildParapet(mats);
    this.buildBackWall(mats);
    this.buildHall(mats, rand);
    this.buildRoof(mats);
    this.buildJumbotron(mats);
    this.lightArena(y0);
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = !o.material?.isShaderMaterial;
      o.castShadow = !!o.userData.shadow;
    });
    const fog = this.pipeline?.fogMaterial?.uniforms;
    if (fog?.uFogDensity) fog.uFogDensity.value = 0.0009;
  }

  spawnFor(slot = 0) {
    return standSpawn(slot);
  }

  buildCourt(mats, y0) {
    const { courtHX: hx, courtHZ: hz } = ARENA;
    const [bx, bz] = COURT_BORDER;
    const floor = mesh(new THREE.BoxGeometry((hx + bx) * 2, 0.06, (hz + bz) * 2), mats.court, 0, y0 + 0.03, 0);
    floor.name = 'msg-court';
    this.group.add(floor);
  }

  buildCourtside(mats, y0) {
    const hz = ARENA.courtHZ + COURT_BORDER[1];
    const table = mesh(new THREE.BoxGeometry(12.5, 0.08, 0.72), mats.pad, 0, y0 + 0.78, -(hz + 1.2));
    table.userData.shadow = true;
    this.group.add(table);
    const front = mesh(new THREE.BoxGeometry(12.5, 0.72, 0.08), mats.jumbo, 0, y0 + 0.4, -(hz + 0.82));
    this.group.add(front);
    addBox(this.colliders, 0, -(hz + 1.2), y0, 6.25, 0.4, 1.0, 'cover');
    for (const side of [-1, 1]) {
      const bench = mesh(new THREE.BoxGeometry(8.4, 0.46, 0.55), mats.pad, side * 8.6, y0 + 0.23, hz + 1.0);
      bench.userData.shadow = true;
      this.group.add(bench);
      addBox(this.colliders, side * 8.6, hz + 1.0, y0, 4.2, 0.3, 0.5, 'cover');
    }
  }

  buildHoops(mats, y0) {
    const hx = hoopX();
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const stanchionX = s * (ARENA.courtHX + 2.4);
      g.add(mesh(new THREE.BoxGeometry(1.4, 1.1, 2.0), mats.pad, stanchionX, y0 + 0.55, 0));
      g.add(mesh(new THREE.BoxGeometry(0.36, 2.5, 0.36), mats.pad, stanchionX - s * 0.3, y0 + 2.2, 0, 0, 0, s * 0.35));
      const arm = mesh(new THREE.BoxGeometry(2.5, 0.2, 0.26), mats.steel, s * (hx + 1.1), y0 + 3.28, 0);
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
      g.traverse((o) => { if (o.isMesh && !o.material.transparent) o.userData.shadow = true; });
      this.group.add(g);
      addBox(this.colliders, stanchionX, 0, y0, 0.75, 1.0, 2.4, 'cover');
      addBox(this.colliders, s * hx + s * 0.2, 0, y0 + 2.4, 0.2, 1.0, 1.5, 'metal');
    }
  }

  buildStands(mats, y0, rand) {
    const seats = enumerateSeats();
    const dummy = new THREE.Object3D();
    const inst = new THREE.InstancedMesh(seatGeo(), mats.seat, seats.length);
    inst.name = 'bowl-seats';
    inst.frustumCulled = false;
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(seats.length * 3), 3);
    const col = new THREE.Color();
    seats.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.quaternion.setFromAxisAngle(UP, s.yaw);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      col.copy(rand() < 0.08 ? SEAT_WEAR : SEAT_NAVY).multiplyScalar(0.94 + rand() * 0.1);
      inst.setColorAt(i, col);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.instanceColor.needsUpdate = true;
    this.group.add(inst);

    const steps = new GeoBuilder();
    const tint = (c, k) => c.clone().multiplyScalar(k);
    const bank = (rows, yFront) => {
      let yPrev = yFront;
      for (const row of rows) {
        const k = 0.92 + rand() * 0.12;
        for (let sec = 0; sec < S; sec++) {
          steps.flat(sec, row.r0, row.r1, row.y, tint(C_TREAD, k), INNER);
          steps.wall(sec, row.r0, yPrev, row.y, C_RISER, INNER);
          for (const span of [AISLE_A, AISLE_B]) {
            steps.flat(sec, row.r0, row.r1, row.y, C_AISLE, span);
            steps.wall(sec, row.r0, yPrev, row.y, C_AISLE_RISER, span);
          }
        }
        yPrev = row.y;
      }
      return yPrev;
    };
    const lastLow = bank(LOWER_ROWS, ARENA.baseY);
    const concIn = ARENA.concIn * ARENA.RU, concOut = ARENA.concOut * ARENA.RU;
    for (let sec = 0; sec < S; sec++) {
      steps.flat(sec, LOWER_ROWS[LOWER_ROWS.length - 1].r1, concOut, ARENA.concY, C_SPANDREL);
      steps.wall(sec, concIn, lastLow, ARENA.concY, C_RISER);
    }
    bank(UPPER_ROWS, ARENA.concY);
    const bowl = new THREE.Mesh(steps.build(), mats.steps);
    bowl.name = 'bowl-steps';
    this.group.add(bowl);

    const spawnRow = LOWER_ROWS[BOWL.spawnRow - 1];
    const railGeo = new THREE.BoxGeometry(1, 0.05, 0.05);
    const rails = [];
    const railSpan = (L) => [AISLE_W + 0.2, L - AISLE_W - 0.2];
    for (let sec = 0; sec < S; sec++) {
      for (const p of sectionPieces(sec, railSpan)) {
        const r = spawnRow.r0 + 0.12;
        const a = bowlFrame(r, p.at(r)), b = bowlFrame(r, p.bt(r));
        rails.push({ a, b, y: spawnRow.y + 0.95 });
      }
    }
    const railMesh = new THREE.InstancedMesh(railGeo, mats.chrome, rails.length);
    railMesh.name = 'cross-aisle-rail';
    rails.forEach((rl, i) => {
      const dx = rl.b.x - rl.a.x, dz = rl.b.z - rl.a.z;
      dummy.position.set((rl.a.x + rl.b.x) * 0.5, rl.y, (rl.a.z + rl.b.z) * 0.5);
      dummy.quaternion.setFromAxisAngle(UP, -Math.atan2(dz, dx));
      dummy.scale.set(Math.hypot(dx, dz), 1, 1);
      dummy.updateMatrix();
      railMesh.setMatrixAt(i, dummy.matrix);
    });
    railMesh.instanceMatrix.needsUpdate = true;
    this.group.add(railMesh);
    dummy.scale.set(1, 1, 1);
  }

  /** Handrails down the middle of every aisle, like the Garden's stair rails. */
  buildRails(mats) {
    const dummy = new THREE.Object3D();
    const pieces = [];
    const posts = [];
    const runBank = (rows) => {
      for (let sec = 0; sec < S; sec++) {
        const t = sec / S;
        for (let i = 0; i < rows.length - 1; i++) {
          const a = rows[i], b = rows[i + 1];
          if (a.wide || b.wide) continue;
          const pa = bowlFrame(a.r0 + 0.3, t), pb = bowlFrame(b.r0 + 0.3, t);
          pieces.push({ pa, pb, ya: a.y + 0.9, yb: b.y + 0.9 });
          if (i % 3 === 0) posts.push({ p: pa, y: a.y });
        }
      }
    };
    runBank(LOWER_ROWS);
    runBank(UPPER_ROWS);
    const railMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 5), mats.chrome, pieces.length);
    railMesh.name = 'aisle-rails';
    const dir = new THREE.Vector3();
    pieces.forEach((pc, i) => {
      dir.set(pc.pb.x - pc.pa.x, pc.yb - pc.ya, pc.pb.z - pc.pa.z);
      const len = dir.length();
      dummy.position.set((pc.pa.x + pc.pb.x) * 0.5, (pc.ya + pc.yb) * 0.5, (pc.pa.z + pc.pb.z) * 0.5);
      dummy.quaternion.setFromUnitVectors(UP, dir.normalize());
      dummy.scale.set(1, len, 1);
      dummy.updateMatrix();
      railMesh.setMatrixAt(i, dummy.matrix);
    });
    railMesh.instanceMatrix.needsUpdate = true;
    this.group.add(railMesh);
    const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5), mats.chrome, posts.length);
    dummy.quaternion.identity();
    dummy.scale.set(1, 1, 1);
    posts.forEach((p, i) => {
      dummy.position.set(p.p.x, p.y + 0.45, p.p.z);
      dummy.updateMatrix();
      postMesh.setMatrixAt(i, dummy.matrix);
    });
    postMesh.instanceMatrix.needsUpdate = true;
    this.group.add(postMesh);
  }

  /** Tall court-facing LED fascia so the concourse does not read as a painted bar. */
  buildParapet(mats) {
    const g = new GeoBuilder();
    const ribbon = new GeoBuilder();
    const r = ARENA.concIn * ARENA.RU + 0.02;
    const y0 = ARENA.concY;
    const lastLowY = LOWER_ROWS[LOWER_ROWS.length - 1].y;
    const faceTop = y0 + 2.55;
    const ribY0 = lastLowY + 0.18;
    const ribY1 = faceTop - 0.22;
    const dummy = new THREE.Object3D();
    const posts = [];
    for (let sec = 0; sec < S; sec++) {
      g.wall(sec, r, lastLowY, ribY0, C_SPANDREL, INNER);
      g.wall(sec, r, ribY1, faceTop, C_SPANDREL, INNER);
      g.wall(sec, r + 0.28, y0, faceTop, C_WALL, INNER, true);
      g.flat(sec, r, r + 0.28, faceTop, C_MULLION, INNER);
      ribbon.wall(sec, r - 0.04, ribY0, ribY1, C_FASCIA, INNER);
      const L = rowLength(r, sec / S, (sec + 1) / S);
      for (const d of [AISLE_W + 0.08, L - AISLE_W - 0.08]) {
        posts.push(bowlFrame(r - 0.03, paramAt(sec, r, d)));
      }
      for (let d = AISLE_W + 0.3; d < L - AISLE_W - 0.2; d += 0.55) {
        const f = bowlFrame(r + 0.12, paramAt(sec, r + 0.12, d));
        addBox(this.colliders, f.x, f.z, y0 - 0.3, 0.22, 0.22, faceTop - y0 + 0.3, 'cover');
      }
    }
    const m = new THREE.Mesh(g.build(), mats.trim);
    m.name = 'concourse-fascia';
    this.group.add(m);
    const rib = new THREE.Mesh(ribbon.build(), mats.ribbon);
    rib.name = 'concourse-ribbon';
    this.group.add(rib);
    const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, faceTop - lastLowY, 0.28), mats.steel, posts.length);
    cap.name = 'fascia-pilasters';
    posts.forEach((p, i) => {
      dummy.position.set(p.x, (lastLowY + faceTop) * 0.5, p.z);
      dummy.quaternion.setFromAxisAngle(UP, Math.atan2(-p.nx, -p.nz));
      dummy.updateMatrix();
      cap.setMatrixAt(i, dummy.matrix);
    });
    cap.instanceMatrix.needsUpdate = true;
    this.group.add(cap);
  }

  /** Suite bays and a press band — glass boxes, not beige stripes. */
  buildBackWall(mats) {
    const g = new GeoBuilder();
    const bands = new GeoBuilder();
    const ribbon = new GeoBuilder();
    const r = ARENA.hallIn * ARENA.RU;
    const top = ARENA.topY;
    const roofY = ARENA.roofY;
    const lintel = top + 0.85;
    const glass0 = top + 1.05;
    const glass1 = top + 5.15;
    const press0 = top + 5.85;
    const press1 = top + 7.45;
    const doorL = (L) => [0, (L - DOOR_W) * 0.5];
    const doorR = (L) => [(L + DOOR_W) * 0.5, L];
    const panes = [];
    const mullions = [];
    for (let sec = 0; sec < S; sec++) {
      const L = rowLength(r, sec / S, (sec + 1) / S);
      const wallSpan = HALL_DOORS.has(sec) ? [doorL, doorR] : [FULL];
      for (const span of wallSpan) {
        g.wall(sec, r, top, lintel, C_SPANDREL, span);
        bands.wall(sec, r - 0.04, lintel, glass0, C_FASCIA, span);
        bands.wall(sec, r - 0.06, glass0, glass1, C_MULLION, span);
        bands.wall(sec, r - 0.04, glass1, press0, C_FASCIA, span);
        bands.wall(sec, r - 0.05, press0, press1, C_SPANDREL, span);
        bands.wall(sec, r - 0.04, press1, press1 + 0.55, C_FASCIA, span);
      }
      if (HALL_DOORS.has(sec)) {
        bands.wall(sec, r - 0.04, top + DOOR_H, glass0, C_FASCIA);
      }
      ribbon.wall(sec, r - 0.08, lintel + 0.04, glass0 - 0.04, C_FASCIA, HALL_DOORS.has(sec) ? FULL : INNER);
      bands.flat(sec, r - 2.4, r, press1 + 0.55, C_WALL);
      g.wall(sec, r, press1 + 0.55, roofY + 0.2, C_WALL);

      const usable = L - AISLE_W * 2;
      const paneW = 2.15;
      const gap = 0.2;
      const n = Math.max(1, Math.floor((usable + gap) / (paneW + gap)));
      const used = n * paneW + (n - 1) * gap;
      const start = AISLE_W + Math.max(0, (usable - used) * 0.5);
      for (let i = 0; i < n; i++) {
        const d = start + i * (paneW + gap) + paneW * 0.5;
        if (HALL_DOORS.has(sec) && Math.abs(d - L * 0.5) < DOOR_W * 0.55) continue;
        const f = bowlFrame(r - 0.03, paramAt(sec, r - 0.03, d));
        panes.push({ f, w: paneW * 0.92 });
        if (i > 0) {
          const md = start + i * (paneW + gap) - gap * 0.5;
          mullions.push(bowlFrame(r - 0.05, paramAt(sec, r - 0.05, md)));
        }
      }
      for (let d = 0.4; d < L; d += 0.8) {
        if (HALL_DOORS.has(sec) && Math.abs(d - L * 0.5) < DOOR_W * 0.5) continue;
        const f = bowlFrame(r + 0.45, paramAt(sec, r + 0.45, d));
        addBox(this.colliders, f.x, f.z, top - 0.2, 0.45, 0.45, 8, 'concrete');
      }
    }
    const wall = new THREE.Mesh(g.build(), mats.steps);
    wall.name = 'msg-suite-wall';
    this.group.add(wall);
    const bandMesh = new THREE.Mesh(bands.build(), mats.trim);
    bandMesh.name = 'msg-suite-bands';
    this.group.add(bandMesh);
    const rib = new THREE.Mesh(ribbon.build(), mats.ribbon);
    rib.name = 'suite-ribbon';
    this.group.add(rib);

    const dummy = new THREE.Object3D();
    const gh = glass1 - glass0 - 0.12;
    const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.suiteGlow, panes.length);
    const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.suiteGlass, panes.length);
    glow.name = 'suite-glow';
    glass.name = 'suite-windows';
    panes.forEach((p, i) => {
      dummy.position.set(p.f.x, (glass0 + glass1) * 0.5, p.f.z);
      dummy.quaternion.setFromAxisAngle(UP, Math.atan2(-p.f.nx, -p.f.nz));
      dummy.scale.set(p.w, gh, 0.08);
      dummy.updateMatrix();
      glow.setMatrixAt(i, dummy.matrix);
      dummy.position.addScaledVector(new THREE.Vector3(p.f.nx, 0, p.f.nz), -0.06);
      dummy.scale.set(p.w, gh, 0.04);
      dummy.updateMatrix();
      glass.setMatrixAt(i, dummy.matrix);
    });
    glow.instanceMatrix.needsUpdate = true;
    glass.instanceMatrix.needsUpdate = true;
    this.group.add(glow, glass);

    const pressH = press1 - press0 - 0.1;
    const pressGlass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.suiteGlass, panes.length);
    pressGlass.name = 'press-windows';
    panes.forEach((p, i) => {
      dummy.position.set(p.f.x, (press0 + press1) * 0.5, p.f.z);
      dummy.quaternion.setFromAxisAngle(UP, Math.atan2(-p.f.nx, -p.f.nz));
      dummy.scale.set(p.w * 0.95, pressH, 0.05);
      dummy.updateMatrix();
      pressGlass.setMatrixAt(i, dummy.matrix);
    });
    pressGlass.instanceMatrix.needsUpdate = true;
    this.group.add(pressGlass);

    if (mullions.length) {
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, gh + 0.2, 0.18), mats.steel, mullions.length);
      posts.name = 'suite-mullions';
      dummy.scale.set(1, 1, 1);
      mullions.forEach((f, i) => {
        dummy.position.set(f.x, (glass0 + glass1) * 0.5, f.z);
        dummy.quaternion.setFromAxisAngle(UP, Math.atan2(-f.nx, -f.nz));
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
      });
      posts.instanceMatrix.needsUpdate = true;
      this.group.add(posts);
    }
  }

  /** Outer ring hall behind the suites: concourse floor, concessions, the building shell. */
  buildHall(mats, rand) {
    const g = new GeoBuilder();
    const rIn = ARENA.hallIn * ARENA.RU;
    const rOut = ARENA.hallOut * ARENA.RU;
    const y = ARENA.hallY;
    for (let sec = 0; sec < S; sec++) {
      g.flat(sec, rIn, rOut + 0.4, y, C_HALL);
      g.wall(sec, rIn + 0.02, y, y + 4.6, C_HALL, FULL, true);
      g.wall(sec, rOut, y, ARENA.roofY + 0.2, C_HALL);
      g.flat(sec, rIn, rOut, y + 4.6, C_WALL);
      const L = rowLength(rOut, sec / S, (sec + 1) / S);
      for (let d = 0.4; d < L; d += 0.8) {
        const f = bowlFrame(rOut + 0.45, paramAt(sec, rOut + 0.45, d));
        addBox(this.colliders, f.x, f.z, y - 0.2, 0.45, 0.45, 8, 'concrete');
      }
    }
    const hall = new THREE.Mesh(g.build(), mats.steps);
    hall.name = 'msg-hall';
    this.group.add(hall);

    const mid = (rIn + rOut) * 0.5;
    for (let sec = 0; sec < S; sec++) {
      if (sec % 2) {
        const f = bowlFrame(rOut - 0.8, (sec + 0.5) / S);
        const yaw = Math.atan2(-f.nx, -f.nz);
        const stall = new THREE.Group();
        stall.add(mesh(new THREE.BoxGeometry(4.4, 1.1, 1.2), mats.pad, 0, 0.55, 0));
        stall.add(mesh(new THREE.BoxGeometry(4.2, 0.06, 0.6), mats.chrome, 0, 1.13, 0.1));
        stall.add(mesh(new THREE.BoxGeometry(3.6, 0.8, 0.06), mats.amber, 0, 2.6, -0.5));
        stall.position.set(f.x, y, f.z);
        stall.rotation.y = yaw;
        this.group.add(stall);
        addBox(this.colliders, f.x, f.z, y, 1.6, 1.6, 1.2, 'cover');
      } else {
        const f = bowlFrame(mid, (sec + 0.5) / S);
        this.group.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 4.6, 10), mats.conc, f.x, y + 2.3, f.z));
        addBox(this.colliders, f.x, f.z, y, 0.45, 0.45, 4.6, 'concrete');
      }
      const lamp = bowlFrame(mid, (sec + 0.25) / S);
      const l = mesh(new THREE.BoxGeometry(1.6, 0.05, 0.3), mats.fixture, lamp.x, y + 4.55, lamp.z);
      this.group.add(l);
    }

    this.batcher = new PropBatcher(this.models);
    withBatcher(this.batcher, () => {
      for (let i = 0; i < 14; i++) {
        const f = bowlFrame(mid + (rand() - 0.5) * 2, rand());
        const id = rand() < 0.6 ? 'metal_trash_can' : 'barrel_03';
        this.batcher.place(id, f.x, f.z, rand() * 6, 1, 1.1, 'cover', this.terrain, this.colliders);
      }
    });
    this.batcher.bake(this.group);
    this.batcher.update({ x: 0, y: 4, z: 0 });
  }

  buildRoof(mats) {
    const roofY = ARENA.roofY;
    const rOut = ARENA.facadeOut * ARENA.RU;
    const roof = new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(rOut), 12), mats.roof);
    roof.name = 'msg-roof';
    roof.rotation.x = Math.PI / 2;
    roof.position.y = roofY;
    this.group.add(roof);

    const hx = ARENA.courtHX + rOut, hz = ARENA.courtHZ + rOut;
    const beam = new THREE.BoxGeometry(1, 1, 1);
    const beams = [];
    for (let x = -hx + 4; x < hx; x += 6) beams.push([x, roofY - 0.9, 0, 0.35, 1.6, hz * 2]);
    for (let z = -hz + 6; z < hz; z += 9) beams.push([0, roofY - 1.8, z, hx * 2, 0.3, 0.3]);
    const bm = new THREE.InstancedMesh(beam, mats.steel, beams.length);
    bm.name = 'roof-truss';
    const d = new THREE.Object3D();
    beams.forEach(([x, y, z, sx, sy, sz], i) => {
      d.position.set(x, y, z);
      d.scale.set(sx, sy, sz);
      d.updateMatrix();
      bm.setMatrixAt(i, d.matrix);
    });
    bm.instanceMatrix.needsUpdate = true;
    this.group.add(bm);

    const cat = new GeoBuilder();
    const lights = [];
    for (const r of [10, 20, 30, 40]) {
      for (let sec = 0; sec < S; sec++) {
        cat.flat(sec, r - 0.55, r + 0.55, roofY - 3.15, C_WALL);
        cat.wall(sec, r - 0.55, roofY - 3.55, roofY - 3.15, C_WALL);
        const L = rowLength(r, sec / S, (sec + 1) / S);
        for (let dd = 0.45; dd < L; dd += 0.95) lights.push(bowlFrame(r, paramAt(sec, r, dd)));
      }
    }
    const catMesh = new THREE.Mesh(cat.build(), mats.steps);
    catMesh.name = 'roof-catwalks';
    this.group.add(catMesh);
    const lm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.18, 0.38), mats.fixture, lights.length);
    lm.name = 'roof-lights';
    d.scale.set(1, 1, 1);
    lights.forEach((p, i) => {
      d.position.set(p.x, roofY - 3.7, p.z);
      d.updateMatrix();
      lm.setMatrixAt(i, d.matrix);
    });
    lm.instanceMatrix.needsUpdate = true;
    this.group.add(lm);

    const bannerColors = [0x006bb6, 0xf58426, 0x1a1c20, 0x006bb6, 0xf58426, 0xffffff];
    for (let i = 0; i < 18; i++) {
      const f = bowlFrame(26.5, (i + 0.5) / 18);
      const hex = bannerColors[i % bannerColors.length];
      const b = mesh(new THREE.BoxGeometry(0.05, 3.4, 1.55), makeBanner(hex), f.x, roofY - 5.8, f.z);
      b.rotation.y = Math.atan2(-f.nx, -f.nz);
      this.group.add(b);
    }
    const flag = new THREE.Group();
    const fp = bowlFrame(30, 0.5 / S);
    flag.position.set(fp.x, roofY - 5.2, fp.z);
    flag.rotation.y = Math.PI / 2;
    flag.add(mesh(new THREE.BoxGeometry(3.4, 2.0, 0.03), makeBanner(0xb22234), 0, 0, 0));
    for (let i = 0; i < 6; i++) {
      flag.add(mesh(new THREE.BoxGeometry(3.4, 0.14, 0.035), makeBanner(0xf2f2f2), 0, -0.85 + i * 0.31, 0.005));
    }
    flag.add(mesh(new THREE.BoxGeometry(1.4, 1.08, 0.04), makeBanner(0x1a237e), -1.0, 0.46, 0.01));
    this.group.add(flag);
  }

  /** Centre-hung Garden cube: video faces and a gold MADISON SQUARE GARDEN ring. */
  buildJumbotron(mats) {
    const g = new THREE.Group();
    g.name = 'msg-scoreboard';
    const cy = ARENA.baseY + 12.6;
    g.position.set(0, cy, 0);
    const W = 16.2, H = 9.0;
    g.add(mesh(new THREE.BoxGeometry(W, H, W), mats.housing, 0, 0, 0));
    const face = new THREE.PlaneGeometry(W - 0.35, H - 0.45);
    for (let i = 0; i < 4; i++) {
      const ry = (i * Math.PI) / 2;
      const off = W * 0.5 + 0.02;
      const p = mesh(face, mats.jumbo, Math.sin(ry) * off, -0.05, Math.cos(ry) * off, 0, ry, 0);
      g.add(p);
    }
    const crownShape = new THREE.Shape();
    const cw = W * 0.5 + 0.72, cr = 1.7;
    crownShape.moveTo(cw, -cw + cr);
    crownShape.lineTo(cw, cw - cr);
    crownShape.absarc(cw - cr, cw - cr, cr, 0, Math.PI / 2, false);
    crownShape.lineTo(-cw + cr, cw);
    crownShape.absarc(-cw + cr, cw - cr, cr, Math.PI / 2, Math.PI, false);
    crownShape.lineTo(-cw, -cw + cr);
    crownShape.absarc(-cw + cr, -cw + cr, cr, Math.PI, Math.PI * 1.5, false);
    crownShape.lineTo(cw - cr, -cw);
    crownShape.absarc(cw - cr, -cw + cr, cr, Math.PI * 1.5, Math.PI * 2, false);
    const crownH = 1.35;
    const crown = new THREE.Mesh(
      new THREE.ExtrudeGeometry(crownShape, { depth: crownH, bevelEnabled: false, curveSegments: 12 }),
      mats.gold,
    );
    crown.rotation.x = -Math.PI / 2;
    crown.position.y = H * 0.5;
    g.add(crown);
    const signW = (cw - cr) * 2 + 0.4;
    for (let i = 0; i < 4; i++) {
      const ry = (i * Math.PI) / 2;
      const off = cw + 0.02;
      const s = mesh(new THREE.PlaneGeometry(signW, crownH * 0.78), mats.sign, Math.sin(ry) * off, H * 0.5 + crownH * 0.5, Math.cos(ry) * off, 0, ry, 0);
      s.name = 'msg-sign';
      g.add(s);
    }
    g.add(mesh(new THREE.BoxGeometry(W + 0.4, 0.28, W + 0.4), mats.housing, 0, -H * 0.5 - 0.14, 0));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.add(mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.32, 8), mats.fixture, Math.cos(a) * 4.6, -H * 0.5 - 0.44, Math.sin(a) * 4.6));
    }
    const cableLen = Math.max(2, ARENA.roofY - (cy + H * 0.5 + crownH));
    const cab = W * 0.38;
    for (const [x, z] of [[-cab, -cab], [cab, -cab], [-cab, cab], [cab, cab]]) {
      g.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, cableLen, 6), mats.steel, x, H * 0.5 + crownH + cableLen * 0.5, z));
    }
    this.group.add(g);
    addBox(this.colliders, 0, 0, cy - H * 0.5 - 0.5, W * 0.5 + 0.5, W * 0.5 + 0.5, H + crownH + 0.5, 'metal');
  }

  lightArena(y0) {
    const hemi = new THREE.HemisphereLight(0xe6ebf2, 0x3a3630, 1.1);
    this.group.add(hemi);
    const fills = [
      [0, 1, -0.9], [0, 1, 0.9], [-0.9, 1, 0], [0.9, 1, 0],
    ];
    for (const [x, y, z] of fills) {
      const l = new THREE.DirectionalLight(0xfff4e6, 0.55);
      l.position.set(x * 30, y0 + y * 30, z * 30);
      l.target.position.set(-x * 30, y0, -z * 30);
      l.castShadow = false;
      this.group.add(l, l.target);
    }
    const court = new THREE.PointLight(0xfff2de, 34, 58, 1.15);
    court.position.set(0, y0 + 11.5, 0);
    court.castShadow = false;
    this.group.add(court);
    const board = new THREE.PointLight(0xffe0a8, 22, 36, 1.4);
    board.position.set(0, y0 + 12.6, 0);
    board.castShadow = false;
    this.group.add(board);
  }

  update(dt, _fx, camera) {
    this._t += dt;
    for (const m of this._leds) {
      if (m.uniforms?.uTime) m.uniforms.uTime.value = this._t;
    }
    if (camera) this.batcher?.update(camera.position);
  }
}
