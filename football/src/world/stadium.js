import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PITCH, SURROUND } from './dims.js';

const HL = PITCH.halfLength, HW = PITCH.halfWidth;

// Stand cross-section, in (u outward from the front wall, y up). Two tiers
// with a hospitality band between them and a cantilever roof.
const TIERS = [
  { u0: 0.6, y0: 1.25, rows: 22, depth: 0.8, rise: 0.36 },
  { u0: 16.2, y0: 13.4, rows: 22, depth: 0.82, rise: 0.52 },
];
const ROOF = { front: -3.5, back: 36, yFront: 33.5, yBack: 31.5, thick: 1.6 };
const SEAT_PITCH = 0.52;
const AISLE_EVERY = 26;

function tierTop(t) {
  return { u: t.u0 + t.rows * t.depth, y: t.y0 + t.rows * t.rise };
}

// Rows of seats in stand space: tread front edge u, tread height y.
export function standRows() {
  const rows = [];
  TIERS.forEach((t, ti) => {
    for (let i = 0; i < t.rows; i++) rows.push({ tier: ti, u: t.u0 + i * t.depth + 0.34, y: t.y0 + (i + 1) * t.rise, depth: t.depth });
  });
  return rows;
}

// Stepped concrete terrace swept along the stand length.
function terraceGeometry(length) {
  const pos = [], nrm = [], uv = [], idx = [];
  const quad = (a, b, c, d, n, uvs) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) pos.push(...v);
    for (let i = 0; i < 4; i++) nrm.push(...n);
    uv.push(...uvs);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const L = length / 2;
  const strip = (u0, y0, u1, y1, n) => {
    const tl = Math.hypot(u1 - u0, y1 - y0);
    quad([-L, y0, u0], [L, y0, u0], [L, y1, u1], [-L, y1, u1], n,
      [0, 0, length / 3, 0, length / 3, tl / 3, 0, tl / 3]);
  };
  // Front wall of the lower tier.
  strip(0, 0, 0, TIERS[0].y0, [0, 0, -1]);
  strip(0, TIERS[0].y0, TIERS[0].u0, TIERS[0].y0, [0, 1, 0]);
  TIERS.forEach((t, ti) => {
    for (let i = 0; i < t.rows; i++) {
      const u = t.u0 + i * t.depth, y = t.y0 + i * t.rise;
      strip(u, y, u, y + t.rise, [0, 0, -1]);
      strip(u, y + t.rise, u + t.depth, y + t.rise, [0, 1, 0]);
    }
    const top = tierTop(t);
    if (ti === 0) {
      // Concourse behind the lower tier and the hospitality band's back wall.
      strip(top.u, top.y, TIERS[1].u0 + 3, top.y, [0, 1, 0]);
    } else {
      strip(top.u, top.y, top.u, ROOF.yBack, [0, 0, -1]);
    }
  });
  // Underside of the upper tier, visible from the lower seats.
  const t1 = TIERS[1];
  const top1 = tierTop(t1);
  strip(t1.u0, t1.y0 - 1.2, top1.u, top1.y - 1.4, [0, -1, 0]);
  strip(t1.u0, t1.y0 - 1.2, t1.u0, t1.y0, [0, 0, -1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// A seated spectator, facing -Z (towards the pitch). `part` is 0 shirt,
// 1 skin, 2 trousers, 3 hair, 4 arms (shirt sleeves, animated when cheering).
function spectatorGeometry() {
  const parts = [];
  const add = (geo, part, x, y, z) => {
    geo.translate(x, y, z);
    const n = geo.attributes.position.count;
    geo.setAttribute('part', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
    parts.push(geo.index ? geo.toNonIndexed() : geo);
  };
  add(new THREE.BoxGeometry(0.4, 0.52, 0.24), 0, 0, 0.72, 0.05);
  add(new THREE.SphereGeometry(0.105, 7, 5), 1, 0, 1.12, 0.02);
  add(new THREE.SphereGeometry(0.108, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.45), 3, 0, 1.135, 0.035);
  add(new THREE.BoxGeometry(0.36, 0.15, 0.46), 2, 0, 0.44, -0.14);
  add(new THREE.BoxGeometry(0.32, 0.44, 0.14), 2, 0, 0.2, -0.36);
  const armL = new THREE.BoxGeometry(0.1, 0.48, 0.11); armL.translate(0, -0.24, 0);
  add(armL, 4, -0.25, 0.96, 0.02);
  const armR = new THREE.BoxGeometry(0.1, 0.48, 0.11); armR.translate(0, -0.24, 0);
  add(armR, 4, 0.25, 0.96, 0.02);
  const g = mergeGeometries(parts.map((p) => {
    const q = p.clone();
    for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'part'].includes(k)) q.deleteAttribute(k);
    return q;
  }));
  return g;
}

const crowdPars = /* glsl */ `
attribute vec3 aShirt;
attribute vec3 aSkin;
attribute vec3 aPants;
attribute vec4 aMisc;
attribute float part;
uniform float uTime;
uniform float uExcite;
uniform vec3 uCheerSide;
varying vec3 vCrowdCol;
`;

// Idle fans shuffle and clap; on a goal the home end jumps with arms up.
const crowdBegin = /* glsl */ `
vec3 transformed = vec3(position);
float ph = aMisc.x * 6.2831;
float team = aMisc.y;
float mood = team > 1.5 ? 0.0 : clamp(uExcite * (team > 0.5 ? uCheerSide.x : uCheerSide.y) + uCheerSide.z * aMisc.z, 0.0, 1.0);
float stand = smoothstep(0.1, 0.5, mood + step(0.965, aMisc.z) * 0.6);
float jump = mood * max(0.0, sin(uTime * 7.5 + ph)) * 0.16;
float sway = sin(uTime * (0.6 + aMisc.w * 0.8) + ph) * 0.02;
if (part > 1.5 && part < 2.5 && position.y < 0.3) {
  transformed.z += stand * 0.26;
}
if (part < 1.5 || part > 2.5) {
  transformed.y += stand * 0.32 + jump;
  transformed.z += stand * 0.1;
  transformed.x += sway;
}
if (part > 3.5) {
  float side = sign(position.x);
  vec3 pivot = vec3(0.25 * side, 0.96, 0.02);
  float clap = (1.0 - mood) * step(0.7, fract(aMisc.w * 7.0)) * (0.35 + 0.1 * sin(uTime * 12.0 + ph));
  float up = mood * (2.6 + 0.3 * sin(uTime * 5.0 + ph)) + clap;
  vec3 r = position - pivot;
  float c = cos(up), s = sin(up);
  vec3 rr = vec3(r.x, r.y * c - r.z * s, r.y * s + r.z * c);
  rr.x -= side * clap * 0.25 * r.y;
  transformed = pivot + rr + vec3(sway, stand * 0.32 + jump, stand * 0.1);
}
vCrowdCol = part < 0.5 || part > 3.5 ? aShirt : part < 1.5 ? aSkin : part < 2.5 ? aPants : aSkin * vec3(0.18, 0.13, 0.1);
`;

function ledTexture(panels, w = 2048, h = 64) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const pw = w / panels.length;
  panels.forEach((p, i) => {
    const x = i * pw;
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, p.bg2 || p.bg);
    grd.addColorStop(1, p.bg);
    g.fillStyle = grd;
    g.fillRect(x, 0, pw, h);
    g.fillStyle = p.fg;
    g.font = `${p.weight || 800} ${Math.round(h * (p.size || 0.62))}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const reps = p.reps || 1;
    for (let k = 0; k < reps; k++) {
      g.fillText(p.text, x + pw * (k + 0.5) / reps, h * 0.54);
    }
    if (p.logo) {
      g.fillStyle = p.fg;
      g.beginPath();
      g.arc(x + h * 0.55, h / 2, h * 0.26, 0, Math.PI * 2);
      g.fill();
    }
  });
  // LED pixel grid.
  g.globalAlpha = 0.18;
  g.fillStyle = '#000';
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const BOARD_PANELS = [
  { text: 'JEV', bg: '#0b2a8a', bg2: '#1846d8', fg: '#ffffff', reps: 3 },
  { text: 'TYPESAFE AI', bg: '#f4f4f4', fg: '#0d1b3d', reps: 2 },
  { text: 'SYSTEM ONE', bg: '#08111f', fg: '#39d3ff', reps: 2 },
  { text: 'JEV', bg: '#0b2a8a', bg2: '#1846d8', fg: '#ffffff', reps: 3 },
  { text: 'DECIDE FASTER', bg: '#e8202a', fg: '#ffffff', reps: 2 },
  { text: 'TYPESAFE AI', bg: '#f4f4f4', fg: '#0d1b3d', reps: 2 },
];
const FASCIA_PANELS = [
  { text: 'JEV · TYPESAFE AI', bg: '#0a1e63', bg2: '#12318f', fg: '#ffffff', reps: 3, size: 0.5 },
  { text: 'SYSTEM ONE', bg: '#0a1e63', bg2: '#12318f', fg: '#9fd8ff', reps: 3, size: 0.5 },
];

// Pure layout: every seat in the ground, for tests and for the crowd.
export function seatLayout({ occupancy = 0.92, seed = 7 } = {}) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const stands = [
    { name: 'south', x: 0, z: HW + SURROUND.standSide, yaw: 0, length: (HL + SURROUND.standEnd) * 2 - 6, homeShare: 0.6 },
    { name: 'north', x: 0, z: -(HW + SURROUND.standSide), yaw: Math.PI, length: (HL + SURROUND.standEnd) * 2 - 6, homeShare: 0.6 },
    { name: 'east', x: HL + SURROUND.standEnd, z: 0, yaw: Math.PI / 2, length: (HW + SURROUND.standSide) * 2 - 6, homeShare: 0.95 },
    { name: 'west', x: -(HL + SURROUND.standEnd), z: 0, yaw: -Math.PI / 2, length: (HW + SURROUND.standSide) * 2 - 6, homeShare: 0.2 },
  ];
  const rows = standRows();
  const seats = [];
  for (const st of stands) {
    const n = Math.floor(st.length / SEAT_PITCH);
    for (const r of rows) {
      for (let i = 0; i < n; i++) {
        if (i % AISLE_EVERY === AISLE_EVERY - 1) continue;
        const along = -st.length / 2 + (i + 0.5) * SEAT_PITCH;
        const occupied = rnd() < occupancy;
        seats.push({ stand: st, along, u: r.u, y: r.y, tier: r.tier, occupied, r1: rnd(), r2: rnd(), r3: rnd(), r4: rnd() });
      }
    }
  }
  return { stands, seats };
}

function standMatrix(st) {
  // Stand space: x along, y up, z outward (away from the pitch).
  const m = new THREE.Matrix4().makeRotationY(st.yaw);
  m.setPosition(st.x, 0, st.z);
  return m;
}

export class Stadium {
  constructor(textures, { crowdScale = 1, home, away }) {
    this.group = new THREE.Group();
    this.uniforms = { uTime: { value: 0 }, uExcite: { value: 0 }, uCheerSide: { value: new THREE.Vector3(1, 0, 0) } };
    this.textures = textures;
    const concrete = new THREE.MeshStandardMaterial({
      map: textures.concreteDiff, normalMap: textures.concreteNor, roughnessMap: textures.concreteArm,
      color: 0xb9b6ae, roughness: 1, metalness: 0, side: THREE.DoubleSide,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      map: textures.roofDiff, normalMap: textures.roofNor, roughnessMap: textures.roofArm, metalnessMap: textures.roofArm,
      color: 0x6d7278, roughness: 1, metalness: 0.6, side: THREE.DoubleSide,
    });
    const steel = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.35, metalness: 0.85 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.06, metalness: 0.9, envMapIntensity: 1.4 });
    this.boardTex = ledTexture(BOARD_PANELS);
    this.fasciaTex = ledTexture(FASCIA_PANELS, 2048, 64);
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x050505, roughness: 0.32, metalness: 0.1,
      emissive: 0xffffff, emissiveMap: this.boardTex, emissiveIntensity: 2.2,
    });
    const fasciaMat = new THREE.MeshStandardMaterial({
      color: 0x050505, roughness: 0.35, metalness: 0.1,
      emissive: 0xffffff, emissiveMap: this.fasciaTex, emissiveIntensity: 1.8,
    });

    const { stands, seats } = seatLayout({ occupancy: 0.9 });
    this.stands = stands;
    for (const st of stands) {
      const M = standMatrix(st);
      const g = new THREE.Group();
      g.applyMatrix4(M);
      const terr = new THREE.Mesh(terraceGeometry(st.length + 2), concrete);
      terr.castShadow = true;
      terr.receiveShadow = true;
      g.add(terr);

      // Hospitality glazing between the tiers, and the LED ribbon above it.
      const top0 = tierTop(TIERS[0]);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(st.length, TIERS[1].y0 - 1.2 - top0.y), glass);
      band.position.set(0, (top0.y + TIERS[1].y0 - 1.2) / 2, TIERS[1].u0 + 3);
      band.rotation.y = Math.PI;
      g.add(band);
      const fascia = new THREE.Mesh(new THREE.PlaneGeometry(st.length, 1.1), fasciaMat);
      fascia.position.set(0, TIERS[1].y0 - 0.62, TIERS[1].u0 - 0.02);
      fascia.rotation.y = Math.PI;
      fascia.material = fasciaMat.clone();
      fascia.material.emissiveMap = this.fasciaTex.clone();
      fascia.material.emissiveMap.repeat.set(st.length / 60, 1);
      fascia.material.emissiveMap.needsUpdate = true;
      g.add(fascia);
      st.fascia = fascia;

      // Cantilever roof: sheet, dark underside, front fascia and trusses.
      const rl = st.length + 4;
      const roofShape = new THREE.Shape();
      roofShape.moveTo(ROOF.front, ROOF.yFront);
      roofShape.lineTo(ROOF.back, ROOF.yBack);
      roofShape.lineTo(ROOF.back, ROOF.yBack - 0.4);
      roofShape.lineTo(ROOF.front, ROOF.yFront - ROOF.thick);
      roofShape.closePath();
      const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: rl, bevelEnabled: false });
      roofGeo.translate(0, 0, -rl / 2);
      roofGeo.rotateY(-Math.PI / 2);
      const uvs = roofGeo.attributes.uv;
      for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) / 4, uvs.getY(i) / 4);
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.castShadow = true;
      roof.receiveShadow = true;
      g.add(roof);
      // Floodlight gantry along the roof edge.
      const lampGeo = new THREE.BoxGeometry(0.9, 0.5, 0.6);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.5, emissive: 0xfff4e0, emissiveIntensity: 0.0 });
      this.lampMats = this.lampMats || [];
      this.lampMats.push(lampMat);
      const nLamps = Math.floor(st.length / 4.2);
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, nLamps);
      const lm = new THREE.Matrix4();
      for (let i = 0; i < nLamps; i++) {
        lm.makeRotationX(-0.5).setPosition(-st.length / 2 + (i + 0.5) * (st.length / nLamps), ROOF.yFront - ROOF.thick - 0.35, ROOF.front + 0.8);
        lamps.setMatrixAt(i, lm);
      }
      g.add(lamps);
      // Truss chords under the roof, visible against the sky.
      const trussN = Math.floor(st.length / 12);
      const trussGeo = new THREE.BoxGeometry(0.35, 0.35, ROOF.back - ROOF.front);
      const truss = new THREE.InstancedMesh(trussGeo, steel, trussN + 1);
      const slope = Math.atan2(ROOF.yFront - ROOF.yBack, ROOF.back - ROOF.front);
      for (let i = 0; i <= trussN; i++) {
        lm.makeRotationX(slope).setPosition(-st.length / 2 + i * (st.length / trussN), (ROOF.yFront + ROOF.yBack) / 2 - ROOF.thick - 0.2, (ROOF.front + ROOF.back) / 2);
        truss.setMatrixAt(i, lm);
      }
      truss.castShadow = true;
      g.add(truss);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(st.length + 4, 0.5, 0.5), steel);
      edge.position.set(0, ROOF.yFront - ROOF.thick - 0.1, ROOF.front + 0.2);
      g.add(edge);
      // Back wall.
      const back = new THREE.Mesh(new THREE.PlaneGeometry(st.length + 4, ROOF.yBack), concrete);
      back.position.set(0, ROOF.yBack / 2, ROOF.back);
      back.rotation.y = Math.PI;
      back.receiveShadow = true;
      g.add(back);
      this.group.add(g);
    }

    this.buildCorners(concrete, glass, steel);
    this.buildSeatsAndCrowd(seats, crowdScale, home, away);
    this.buildBoards(boardMat);
    this.buildPeople(home, away);
    this.buildFlags();
    this.buildBench(steel);
  }

  // Corner blocks close the bowl; one carries the giant screen.
  buildCorners(concrete, glass, steel) {
    const cx = HL + SURROUND.standEnd, cz = HW + SURROUND.standSide;
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 1024; screenCanvas.height = 384;
    this.screenCanvas = screenCanvas;
    this.screenTex = new THREE.CanvasTexture(screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.3, emissive: 0xffffff, emissiveMap: this.screenTex, emissiveIntensity: 1.6 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), concrete);
      block.position.set(sx * (cx + 12), 15, sz * (cz + 12));
      block.receiveShadow = true;
      block.castShadow = true;
      this.group.add(block);
      const toPitch = new THREE.Vector3(-sx, 0, -sz).normalize();
      // Diagonal façade facing the centre spot, glazed at concourse level.
      const face = new THREE.Mesh(new THREE.PlaneGeometry(22, 31), concrete);
      face.position.set(sx * (cx + 1.2), 15.5, sz * (cz + 1.2));
      face.lookAt(0, 15.5, 0);
      face.receiveShadow = true;
      this.group.add(face);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(19, 5), glass);
      win.position.copy(face.position).setY(10.5).addScaledVector(toPitch, 0.05);
      win.quaternion.copy(face.quaternion);
      this.group.add(win);
      if (sx > 0 && sz < 0) {
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), screenMat);
        scr.position.copy(face.position).setY(22);
        scr.position.addScaledVector(toPitch, 0.6);
        scr.lookAt(0, 20, 0);
        this.group.add(scr);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(16.8, 6.8, 0.4), steel);
        frame.position.copy(scr.position).addScaledVector(toPitch, -0.25);
        frame.quaternion.copy(scr.quaternion);
        this.group.add(frame);
      }
    }
  }

  drawScreen(info) {
    const c = this.screenCanvas;
    const g = c.getContext('2d');
    g.fillStyle = '#050a18';
    g.fillRect(0, 0, c.width, c.height);
    const grd = g.createLinearGradient(0, 0, 0, c.height);
    grd.addColorStop(0, 'rgba(40,80,200,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 150px "Arial Black", Arial, sans-serif';
    g.fillStyle = info.homeColor;
    g.fillText(info.home, 230, 150);
    g.fillStyle = info.awayColor;
    g.fillText(info.away, 794, 150);
    g.fillStyle = '#fff';
    g.fillText(`${info.hs}-${info.as}`, 512, 150);
    g.font = '800 72px Arial, sans-serif';
    g.fillStyle = '#cfe3ff';
    g.fillText(info.clock, 512, 300);
    g.globalAlpha = 0.2;
    g.fillStyle = '#000';
    for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 1);
    g.globalAlpha = 1;
    this.screenTex.needsUpdate = true;
  }

  buildSeatsAndCrowd(seats, crowdScale, home, away) {
    const seatGeo = mergeGeometries([
      new THREE.BoxGeometry(0.44, 0.06, 0.4).translate(0, 0.42, -0.02),
      new THREE.BoxGeometry(0.44, 0.42, 0.06).translate(0, 0.66, 0.2),
    ].map((g) => { g.deleteAttribute('uv'); return g; }));
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x1b3c9e, roughness: 0.45, metalness: 0 });
    const seatMesh = new THREE.InstancedMesh(seatGeo, seatMat, seats.length);
    const specGeo = spectatorGeometry();
    const people = seats.filter((s) => s.occupied && s.r4 < crowdScale);
    const n = people.length;
    const crowd = new THREE.InstancedMesh(specGeo, null, n);
    const aShirt = new Float32Array(n * 3), aSkin = new Float32Array(n * 3), aPants = new Float32Array(n * 3), aMisc = new Float32Array(n * 4);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const standM = new Map(this.stands.map((st) => [st, standMatrix(st)]));
    const c = new THREE.Color();
    const lin = (hex) => c.set(hex).convertSRGBToLinear();
    const SKIN = ['#f1c7a5', '#e0ac8a', '#c68c6b', '#a86d4e', '#7a4a33', '#5a3524', '#eab996'];
    const NEUTRAL = ['#111318', '#1d2029', '#2c2f38', '#e8e8e4', '#40444c', '#262a36', '#5a5f68'];
    seats.forEach((s, i) => {
      p.set(s.along, s.y, s.u);
      m.compose(p, q.identity(), sc).premultiply(standM.get(s.stand));
      seatMesh.setMatrixAt(i, m);
    });
    people.forEach((s, i) => {
      const jit = (s.r1 - 0.5) * 0.08;
      p.set(s.along + jit, s.y, s.u + 0.05);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (s.r2 - 0.5) * 0.35);
      const k = 0.92 + s.r3 * 0.16;
      sc.set(k, k, k);
      m.compose(p, q, sc).premultiply(standM.get(s.stand));
      crowd.setMatrixAt(i, m);
      // Away fans sit in one corner of the west end.
      const awayBlock = s.stand.name === 'west' && s.along > 8 ? 0.9 : s.stand.name === 'north' && s.along < -40 ? 0.35 : 0.04;
      const isAway = s.r2 < awayBlock;
      const kit = isAway ? away : home;
      const roll = s.r3;
      let shirt;
      if (roll < 0.52) shirt = lin(kit.shirt);
      else if (roll < 0.62) shirt = lin(kit.alt || '#ffffff');
      else if (roll < 0.94) shirt = lin(NEUTRAL[Math.floor(s.r4 * NEUTRAL.length * 7) % NEUTRAL.length]);
      else shirt = c.setHSL(s.r1, 0.5, 0.45).convertSRGBToLinear();
      shirt.multiplyScalar(0.8 + s.r1 * 0.3);
      aShirt.set([shirt.r, shirt.g, shirt.b], i * 3);
      const skin = lin(SKIN[Math.floor(s.r1 * 97) % SKIN.length]);
      aSkin.set([skin.r, skin.g, skin.b], i * 3);
      const pants = lin(NEUTRAL[Math.floor(s.r2 * 31) % 3]);
      aPants.set([pants.r, pants.g, pants.b], i * 3);
      aMisc.set([s.r4 * 13.37 % 1, isAway ? 0 : 1, s.r3, s.r1], i * 4);
    });
    seatMesh.receiveShadow = true;
    seatMesh.frustumCulled = false;
    this.group.add(seatMesh);

    specGeo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(aShirt, 3));
    specGeo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(aSkin, 3));
    specGeo.setAttribute('aPants', new THREE.InstancedBufferAttribute(aPants, 3));
    specGeo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(aMisc, 4));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = crowdPars + shader.vertexShader.replace('#include <begin_vertex>', crowdBegin);
      shader.fragmentShader = 'varying vec3 vCrowdCol;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>', 'diffuseColor.rgb = vCrowdCol;');
    };
    mat.customProgramCacheKey = () => 'crowd-v1';
    crowd.material = mat;
    crowd.receiveShadow = true;
    crowd.frustumCulled = false;
    this.crowd = crowd;
    this.crowdCount = n;
    this.group.add(crowd);
  }

  buildBoards(mat) {
    const h = 0.95;
    const geo = new THREE.BoxGeometry(1, h, 0.25);
    const addRun = (x0, x1, z, yaw, rep) => {
      const len = Math.abs(x1 - x0);
      const g = geo.clone();
      g.scale(len, 1, 1);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep);
      const mm = mat.clone();
      mm.emissiveMap = this.boardTex;
      const mesh = new THREE.Mesh(g, mm);
      mesh.position.set((x0 + x1) / 2, h / 2, z);
      mesh.rotation.y = yaw;
      mesh.rotation.x = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    const zS = HW + SURROUND.boardSide, xE = HL + SURROUND.boardEnd;
    this.boards = [
      addRun(-xE + 1, xE - 1, -zS, 0, 5),
      addRun(-xE + 1, -3, zS, Math.PI, 2.5),
      addRun(3, xE - 1, zS, Math.PI, 2.5),
    ];
    for (const s of [-1, 1]) {
      const b1 = addRun(-HW, -6, 0, 0, 1.2);
      b1.position.set(s * xE, h / 2, (-HW - 6) / 2);
      b1.rotation.y = s * Math.PI / 2;
      const b2 = addRun(6, HW, 0, 0, 1.2);
      b2.position.set(s * xE, h / 2, (HW + 6) / 2);
      b2.rotation.y = s * Math.PI / 2;
      this.boards.push(b1, b2);
    }
    // Floor between boards and stands: dark synthetic track.
    const track = new THREE.MeshStandardMaterial({ color: 0x1f3a24, roughness: 0.95 });
    const ringOuter = new THREE.Shape();
    const ox = HL + SURROUND.standEnd, oz = HW + SURROUND.standSide;
    ringOuter.moveTo(-ox, -oz); ringOuter.lineTo(ox, -oz); ringOuter.lineTo(ox, oz); ringOuter.lineTo(-ox, oz); ringOuter.closePath();
    const hole = new THREE.Path();
    const ix = xE + 0.3, iz = zS + 0.3;
    hole.moveTo(-ix, -iz); hole.lineTo(-ix, iz); hole.lineTo(ix, iz); hole.lineTo(ix, -iz); hole.closePath();
    ringOuter.holes.push(hole);
    const ring = new THREE.Mesh(new THREE.ShapeGeometry(ringOuter), track);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    ring.receiveShadow = true;
    this.group.add(ring);
  }

  // Stewards in hi-vis facing the crowd, photographers behind the goal lines.
  buildPeople(home, away) {
    const geo = spectatorGeometry();
    const items = [];
    const zS = HW + SURROUND.boardSide + 1.6;
    for (let i = -5; i <= 5; i++) {
      items.push({ x: i * 10 + 2, z: -zS, yaw: 0, shirt: '#e8ff2a', stand: true });
      if (Math.abs(i) > 1) items.push({ x: i * 10 - 3, z: zS, yaw: Math.PI, shirt: '#e8ff2a', stand: true });
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const z = (i < 4 ? -1 : 1) * (8 + (i % 4) * 2.2);
        items.push({ x: s * (HL + SURROUND.boardEnd - 1.4), z, yaw: -s * Math.PI / 2, shirt: i % 3 ? '#1a1d24' : '#f06a1a', stand: false });
      }
      items.push({ x: s * (HL + SURROUND.boardEnd + 1.8), z: 18, yaw: s * Math.PI / 2, shirt: '#e8ff2a', stand: true });
      items.push({ x: s * (HL + SURROUND.boardEnd + 1.8), z: -18, yaw: s * Math.PI / 2, shirt: '#e8ff2a', stand: true });
    }
    const n = items.length;
    const mesh = new THREE.InstancedMesh(geo, null, n);
    const aShirt = new Float32Array(n * 3), aSkin = new Float32Array(n * 3), aPants = new Float32Array(n * 3), aMisc = new Float32Array(n * 4);
    const c = new THREE.Color();
    const m = new THREE.Matrix4();
    items.forEach((it, i) => {
      m.makeRotationY(it.yaw).setPosition(it.x, it.stand ? 0.12 : -0.28, it.z);
      mesh.setMatrixAt(i, m);
      c.set(it.shirt).convertSRGBToLinear();
      aShirt.set([c.r, c.g, c.b], i * 3);
      c.set(['#e0ac8a', '#a86d4e', '#f1c7a5', '#5a3524'][i % 4]).convertSRGBToLinear();
      aSkin.set([c.r, c.g, c.b], i * 3);
      c.set('#15171c').convertSRGBToLinear();
      aPants.set([c.r, c.g, c.b], i * 3);
      aMisc.set([Math.random(), 2, it.stand ? 0.99 : 0.0, 0.1], i * 4);
    });
    geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(aShirt, 3));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(aSkin, 3));
    geo.setAttribute('aPants', new THREE.InstancedBufferAttribute(aPants, 3));
    geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(aMisc, 4));
    mesh.material = this.crowd.material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  buildFlags() {
    const pole = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xff3b1f, roughness: 0.7, side: THREE.DoubleSide });
    cloth.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float k = (position.x + 0.2) / 0.4;
        transformed.z += sin(uTime * 6.0 + k * 4.0) * 0.06 * k;
        transformed.y -= k * k * 0.05;`);
    };
    this.flags = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 8), pole);
      p.position.y = 0.75;
      p.castShadow = true;
      g.add(p);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3, 8, 2), cloth);
      f.position.set(0.2, 1.33, 0);
      f.castShadow = true;
      g.add(f);
      g.position.set(sx * HL, 0, sz * HW);
      g.rotation.y = Math.atan2(sz, -sx) * 0.3 + 0.6;
      this.group.add(g);
    }
  }

  // Dugouts on the camera side of the halfway line.
  buildBench(steel) {
    const perspex = new THREE.MeshStandardMaterial({ color: 0x9fb6c8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
    const seat = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 9, 20, 1, true, 0, Math.PI), perspex);
      shell.rotation.z = Math.PI / 2;
      shell.rotation.y = Math.PI / 2;
      shell.position.y = 0.2;
      g.add(shell);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.5, 0.6), seat);
      bench.position.set(0, 0.3, 0.6);
      g.add(bench);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.08), steel);
      rail.position.set(0, 1.55, -0.1);
      g.add(rail);
      g.position.set(s * 9, 0, HW + 3.4);
      this.group.add(g);
    }
  }

  // `cheer` is { excite 0..1, homeBias, awayBias, stir }.
  update(dt, time, cheer) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uExcite.value += ((cheer?.excite || 0) - u.uExcite.value) * Math.min(1, dt * 3);
    if (cheer) u.uCheerSide.value.set(cheer.homeBias ?? 1, cheer.awayBias ?? 0, cheer.stir ?? 0);
    this.boardTex.offset.x = (time * 0.012) % 1;
    for (const b of this.boards) b.material.emissiveMap.offset.x = this.boardTex.offset.x;
  }

  setFloodlights(on) {
    for (const m of this.lampMats) m.emissiveIntensity = on ? 40 : 0.4;
  }
}
