import * as THREE from 'three';
import { CITY, cityCell } from '../world/cityLayout.js';
import { HALF_WORLD } from '../world/constants.js';

export const CAR = {
  count: 8,
  fleetMax: 64,
  halfL: 2.25,
  halfW: 1.02,
  height: 1.18,
  enterR: 2.75,
  seatX: -0.36,
  seatY: 0.38,
  seatZ: 0.06,
  maxSpeed: 24,
  boostSpeed: 30,
  reverse: 8.5,
  accel: 13,
  brake: 22,
  coast: 5.5,
  steer: 2.05,
  killSpeed: 5.8,
  collideR: 1.12,
  eyeY: 0.48,
  eyeZ: 0.14,
};

export const PANES = ['wind', 'rear', 'leftF', 'rightF', 'leftR', 'rightR'];

export const PANE_BOXES = {
  wind: { x0: -0.62, x1: 0.62, y0: 0.70, y1: 1.06, z0: 0.40, z1: 0.56 },
  rear: { x0: -0.62, x1: 0.62, y0: 0.70, y1: 1.04, z0: -1.04, z1: -0.88 },
  leftF: { x0: -1.02, x1: -0.94, y0: 0.64, y1: 0.98, z0: -0.12, z1: 0.38 },
  rightF: { x0: 0.94, x1: 1.02, y0: 0.64, y1: 0.98, z0: -0.12, z1: 0.38 },
  leftR: { x0: -1.02, x1: -0.94, y0: 0.64, y1: 0.98, z0: -0.82, z1: -0.18 },
  rightR: { x0: 0.94, x1: 1.02, y0: 0.64, y1: 0.98, z0: -0.82, z1: -0.18 },
};

export const METAL_BOXES = [
  { x0: -1.00, x1: 1.00, y0: 0.14, y1: 0.58, z0: -2.22, z1: 2.22 },
  { x0: -0.90, x1: 0.90, y0: 0.52, y1: 0.70, z0: 0.52, z1: 2.14 },
  { x0: -0.94, x1: 0.94, y0: 0.50, y1: 0.74, z0: -2.20, z1: -0.82 },
  { x0: -0.58, x1: 0.58, y0: 1.02, y1: 1.14, z0: -0.50, z1: 0.32 },
  { x0: -0.90, x1: -0.70, y0: 0.62, y1: 1.08, z0: 0.32, z1: 0.50 },
  { x0: 0.70, x1: 0.90, y0: 0.62, y1: 1.08, z0: 0.32, z1: 0.50 },
  { x0: -0.90, x1: -0.70, y0: 0.62, y1: 1.08, z0: -0.28, z1: -0.12 },
  { x0: 0.70, x1: 0.90, y0: 0.62, y1: 1.08, z0: -0.28, z1: -0.12 },
];

export function paneBit(name) {
  const i = PANES.indexOf(name);
  return i < 0 ? 0 : 1 << i;
}

export function glassIntact(mask, name) {
  return !(mask & paneBit(name));
}

export function glassMaskAfterHit(mask, name) {
  return mask | paneBit(name);
}

const COLORS = [
  0x2a6bff, 0x111214, 0xf3f1ec, 0xffd000, 0xc41818, 0xff6a12, 0xc5cad0, 0x1a2a4a,
  0x0e8a6a, 0x7a1cff, 0xe8e8ea, 0x1c1c1e,
];

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Eight road spots around the plaza and the next ring of streets. */
export function cityCarSpots() {
  return [
    { x: 2.8, z: 32, yaw: Math.PI * 0.5 },
    { x: -2.8, z: -32, yaw: -Math.PI * 0.5 },
    { x: 32, z: 2.8, yaw: 0 },
    { x: -32, z: -2.8, yaw: Math.PI },
    { x: 2.8, z: 96, yaw: Math.PI * 0.5 },
    { x: -2.8, z: -96, yaw: -Math.PI * 0.5 },
    { x: 96, z: 2.8, yaw: 0 },
    { x: -96, z: -2.8, yaw: Math.PI },
  ];
}

/** Lane-packed supercars on the Midtown grid. */
export function manhattanCarSpots(limit = 56) {
  const raw = [];
  const { pitch, halfBlocks, playRadius, plazaRoad } = CITY;
  const lane = 3.05;
  const step = 10;
  const lim = halfBlocks * pitch;
  const keep = (x, z, yaw) => {
    if (Math.hypot(x, z) > playRadius - 18) return;
    if (Math.hypot(x, z) < plazaRoad + 8) return;
    if (Math.hypot(x - 6.2, z - 40) < 10) return;
    const cell = cityCell(x, z);
    if (!cell.onRoad || cell.intersection) return;
    raw.push({ x, z, yaw });
  };
  for (let n = -halfBlocks; n < halfBlocks; n++) {
    const xc = pitch * 0.5 + n * pitch;
    for (const side of [-1, 1]) {
      const x = xc + side * lane;
      for (let z = -lim; z <= lim; z += step) keep(x, z, side > 0 ? 0 : Math.PI);
    }
    const zc = pitch * 0.5 + n * pitch;
    for (const side of [-1, 1]) {
      const z = zc + side * lane;
      for (let x = -lim; x <= lim; x += step) keep(x, z, side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    }
  }
  if (raw.length <= limit) return raw;
  const out = [];
  const stride = raw.length / limit;
  const used = new Set();
  for (let i = 0; i < limit; i++) {
    let idx = Math.min(raw.length - 1, Math.floor(i * stride));
    while (used.has(idx) && idx < raw.length - 1) idx++;
    used.add(idx);
    out.push(raw[idx]);
  }
  return out;
}

export function carSpotsForMap(id) {
  if (id === 'manhattan') return manhattanCarSpots();
  if (id === 'city') return cityCarSpots();
  return [];
}

export function spotOnRoad(spot) {
  return !!cityCell(spot.x, spot.z).onRoad;
}

export function localOffset(px, pz, car) {
  const dx = px - car.x;
  const dz = pz - car.z;
  const fwdX = Math.sin(car.yaw);
  const fwdZ = Math.cos(car.yaw);
  const rightX = fwdZ;
  const rightZ = -fwdX;
  return {
    along: dx * fwdX + dz * fwdZ,
    side: dx * rightX + dz * rightZ,
    fwdX,
    fwdZ,
    rightX,
    rightZ,
  };
}

export function seatOf(car) {
  const o = localOffset(car.x, car.z, car);
  return {
    x: car.x + o.rightX * CAR.seatX + o.fwdX * CAR.seatZ,
    y: car.y + CAR.seatY,
    z: car.z + o.rightZ * CAR.seatX + o.fwdZ * CAR.seatZ,
  };
}

export function exitOf(car, side = 1) {
  const o = localOffset(car.x, car.z, car);
  const lat = (CAR.halfW + 0.85) * side;
  return {
    x: car.x + o.rightX * lat + o.fwdX * CAR.seatZ,
    z: car.z + o.rightZ * lat + o.fwdZ * CAR.seatZ,
  };
}

export function canEnter(px, pz, car) {
  if (!car || car.driver) return false;
  return Math.hypot(px - car.x, pz - car.z) < CAR.enterR;
}

export function nearestEnter(px, pz, cars) {
  let best = null;
  let bestD = CAR.enterR;
  for (const car of cars) {
    if (car.driver) continue;
    const d = Math.hypot(px - car.x, pz - car.z);
    if (d < bestD) {
      best = car;
      bestD = d;
    }
  }
  return best;
}

export function carOverlap(px, pz, py, car, pad = 0) {
  if (Math.abs((py ?? car.y) - car.y) > 1.35) return false;
  const { along, side } = localOffset(px, pz, car);
  return Math.abs(along) < CAR.halfL + pad && Math.abs(side) < CAR.halfW + pad;
}

export function resolveCarBox(pos, radius, car) {
  const { along, side, fwdX, fwdZ, rightX, rightZ } = localOffset(pos.x, pos.z, car);
  const hl = CAR.halfL + radius;
  const hw = CAR.halfW + radius;
  if (Math.abs(along) >= hl || Math.abs(side) >= hw) return false;
  const ol = hl - Math.abs(along);
  const ow = hw - Math.abs(side);
  if (ol < ow) {
    const s = Math.sign(along) || 1;
    pos.x += fwdX * ol * s;
    pos.z += fwdZ * ol * s;
  } else {
    const s = Math.sign(side) || 1;
    pos.x += rightX * ow * s;
    pos.z += rightZ * ow * s;
  }
  return true;
}

export function stepDrive({ speed, yaw, throttle, steer, dt, sprint = false }) {
  const max = sprint && throttle > 0 ? CAR.boostSpeed : CAR.maxSpeed;
  let next = speed;
  if (throttle > 0) {
    next = next < 0 ? Math.min(0, next + CAR.brake * dt) : Math.min(max, next + CAR.accel * throttle * dt);
  } else if (throttle < 0) {
    next = next > 0 ? Math.max(0, next - CAR.brake * dt) : Math.max(-CAR.reverse, next + CAR.accel * throttle * dt);
  } else if (next > 0) {
    next = Math.max(0, next - CAR.coast * dt);
  } else if (next < 0) {
    next = Math.min(0, next + CAR.coast * dt);
  }
  if (Math.abs(next) < 0.08) next = 0;
  const grip = 1 / (1 + Math.abs(next) * 0.055);
  const turn = Math.abs(next) < 0.25 ? 0 : steer * CAR.steer * grip * Math.sign(next);
  const heading = wrap(yaw + turn * dt);
  return {
    speed: next,
    yaw: heading,
    vx: Math.sin(heading) * next,
    vz: Math.cos(heading) * next,
  };
}

export function cockpitEye(car) {
  const o = localOffset(car.x, car.z, car);
  return {
    x: car.x + o.rightX * CAR.seatX + o.fwdX * (CAR.seatZ + CAR.eyeZ),
    y: car.y + CAR.seatY + CAR.eyeY,
    z: car.z + o.rightZ * CAR.seatX + o.fwdZ * (CAR.seatZ + CAR.eyeZ),
  };
}

export function rayAABB(o, d, b, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  let axis = -1;
  let sign = 1;
  const mins = [b.x0, b.y0, b.z0];
  const maxs = [b.x1, b.y1, b.z1];
  const orig = [o.x, o.y, o.z];
  const dir = [d.x, d.y, d.z];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-8) {
      if (orig[k] < mins[k] || orig[k] > maxs[k]) return null;
      continue;
    }
    let t1 = (mins[k] - orig[k]) / dir[k];
    let t2 = (maxs[k] - orig[k]) / dir[k];
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = k; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const t = tmin > 1e-4 ? tmin : 0.02;
  if (t > maxDist) return null;
  const n = [0, 0, 0];
  if (axis >= 0) n[axis] = sign;
  else n[1] = 1;
  return { t, nx: n[0], ny: n[1], nz: n[2] };
}

export function hitCar(origin, dir, car, maxDist, opts = {}) {
  if (!car || maxDist <= 0) return null;
  const basis = localOffset(origin.x, origin.z, car);
  const o = { x: basis.side, y: origin.y - car.y, z: basis.along };
  const d = {
    x: dir.x * basis.rightX + dir.z * basis.rightZ,
    y: dir.y,
    z: dir.x * basis.fwdX + dir.z * basis.fwdZ,
  };
  let best = null;
  if (!opts.glassOnly) {
    for (const b of METAL_BOXES) {
      const h = rayAABB(o, d, b, best ? best.t : maxDist);
      if (h && (!best || h.t < best.t)) best = { ...h, surface: 'metal' };
    }
  }
  if (!opts.metalOnly) {
    const mask = car.glass || 0;
    for (const name of PANES) {
      if (!glassIntact(mask, name)) continue;
      const h = rayAABB(o, d, PANE_BOXES[name], best ? best.t : maxDist);
      if (h && (!best || h.t < best.t)) best = { ...h, surface: 'glass', pane: name };
    }
  }
  if (!best) return null;
  const nx = best.nx * basis.rightX + best.nz * basis.fwdX;
  const nz = best.nx * basis.rightZ + best.nz * basis.fwdZ;
  return {
    t: best.t,
    normal: { x: nx, y: best.ny, z: nz },
    surface: best.surface,
    pane: best.pane,
    glass: best.surface === 'glass',
    car,
  };
}

export function runOverHits(car, fighters, now = 0) {
  if (!car || Math.abs(car.speed) < CAR.killSpeed) return [];
  const hits = [];
  for (const f of fighters) {
    if (!f?.alive || f === car.driver) continue;
    if (car.squash && car.squash[f.id] > now) continue;
    const p = f.pos;
    if (!p || !carOverlap(p.x, p.z, p.y, car, 0.12)) continue;
    hits.push(f);
  }
  return hits;
}

const GEOS = {};
function geo(name, make) {
  if (!GEOS[name]) GEOS[name] = make();
  return GEOS[name];
}

function part(name, make, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo(name, make), mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  return m;
}

function makeCluster() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx, tex };
}

function paintCluster(cluster, speed, on) {
  if (!cluster?.ctx) return;
  const { ctx, canvas, tex } = cluster;
  ctx.fillStyle = '#07080a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = on ? '#d8dde4' : '#3a4048';
  ctx.font = '700 64px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.max(0, Math.round(Math.abs(speed) * 2.237))), 128, 52);
  ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = on ? '#8a9098' : '#2e3338';
  ctx.fillText('MPH', 128, 100);
  tex.needsUpdate = true;
}

function paintMat(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.38,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
}

function kitMats(color) {
  return {
    paint: paintMat(color),
    dark: new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0.35, roughness: 0.55 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.55, roughness: 0.38 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd4dae0, metalness: 0.95, roughness: 0.12 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.06, roughness: 0.92 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.08, roughness: 0.78 }),
    cabin: new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.18, roughness: 0.7 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf2f0e8, metalness: 0.15, roughness: 0.55 }),
    light: new THREE.MeshStandardMaterial({
      color: 0xfff1c4, emissive: 0xffd27a, emissiveIntensity: 0.7, metalness: 0.35, roughness: 0.22,
    }),
    tail: new THREE.MeshStandardMaterial({
      color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 0.85, metalness: 0.4, roughness: 0.22,
    }),
    glow: new THREE.MeshStandardMaterial({
      color: 0x9ad4ff, emissive: 0x3aa0ff, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.18,
    }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xff6a12, metalness: 0.4, roughness: 0.28 }),
  };
}

function makeCarMesh(color, variant = 0) {
  const g = new THREE.Group();
  g.name = 'car';
  const m = kitMats(color);
  const add = (...nodes) => { for (const n of nodes) g.add(n); };

  add(part('tub', () => new THREE.BoxGeometry(2.00, 0.36, 4.48), m.paint, 0, 0.36, 0));
  add(part('skirt', () => new THREE.BoxGeometry(2.04, 0.10, 4.28), m.dark, 0, 0.16, 0));
  add(part('hood', () => new THREE.BoxGeometry(1.86, 0.10, 1.70), m.paint, 0, 0.58, 1.30));
  add(part('nose', () => new THREE.BoxGeometry(1.78, 0.14, 0.40), m.paint, 0, 0.44, 2.12));
  add(part('splitter', () => new THREE.BoxGeometry(1.88, 0.04, 0.22), m.carbon, 0, 0.20, 2.20));
  add(part('deck', () => new THREE.BoxGeometry(1.48, 0.10, 1.22), m.paint, 0, 0.56, -1.38));
  add(part('haunchL', () => new THREE.BoxGeometry(0.58, 0.16, 1.20), m.paint, -0.70, 0.66, -1.32));
  add(part('haunchR', () => new THREE.BoxGeometry(0.58, 0.16, 1.20), m.paint, 0.70, 0.66, -1.32));
  add(part('cabin', () => new THREE.BoxGeometry(1.24, 0.26, 1.36), m.paint, 0, 0.76, -0.10));
  add(part('roof', () => new THREE.BoxGeometry(1.06, 0.07, 1.00), m.paint, 0, 1.04, -0.16));
  add(part('pillarFL', () => new THREE.BoxGeometry(0.10, 0.30, 0.20), m.paint, -0.60, 0.86, 0.42));
  add(part('pillarFR', () => new THREE.BoxGeometry(0.10, 0.30, 0.20), m.paint, 0.60, 0.86, 0.42));
  add(part('pillarRL', () => new THREE.BoxGeometry(0.10, 0.30, 0.18), m.paint, -0.60, 0.86, -0.70));
  add(part('pillarRR', () => new THREE.BoxGeometry(0.10, 0.30, 0.18), m.paint, 0.60, 0.86, -0.70));
  add(part('sideL', () => new THREE.BoxGeometry(0.08, 0.28, 1.22), m.paint, -0.96, 0.78, -0.16));
  add(part('sideR', () => new THREE.BoxGeometry(0.08, 0.28, 1.22), m.paint, 0.96, 0.78, -0.16));
  add(part('intakeL', () => new THREE.BoxGeometry(0.16, 0.12, 0.40), m.dark, -0.94, 0.46, 0.58));
  add(part('intakeR', () => new THREE.BoxGeometry(0.16, 0.12, 0.40), m.dark, 0.94, 0.46, 0.58));
  add(part('frontBump', () => new THREE.BoxGeometry(1.90, 0.14, 0.22), m.carbon, 0, 0.26, 2.20));
  add(part('rearBump', () => new THREE.BoxGeometry(1.90, 0.14, 0.24), m.carbon, 0, 0.24, -2.20));
  add(part('diffuser', () => new THREE.BoxGeometry(1.62, 0.08, 0.34), m.dark, 0, 0.14, -2.22));
  add(part('led', () => new THREE.BoxGeometry(1.58, 0.04, 0.05), m.tail, 0, 0.56, -2.24));
  add(part('plate', () => new THREE.BoxGeometry(0.34, 0.12, 0.02), m.plate, 0, 0.40, -2.26));
  add(part('headL', () => new THREE.BoxGeometry(0.30, 0.08, 0.06), m.light, -0.72, 0.48, 2.22));
  add(part('headR', () => new THREE.BoxGeometry(0.30, 0.08, 0.06), m.light, 0.72, 0.48, 2.22));
  add(part('mirrorL', () => new THREE.BoxGeometry(0.16, 0.05, 0.08), m.dark, -0.98, 0.78, 0.38));
  add(part('mirrorR', () => new THREE.BoxGeometry(0.16, 0.05, 0.08), m.dark, 0.98, 0.78, 0.38));

  const cans = [
    [-0.20, 0.22, -2.28], [-0.08, 0.22, -2.28], [0.08, 0.22, -2.28], [0.20, 0.22, -2.28],
  ];
  for (let i = 0; i < cans.length; i++) {
    const [x, y, z] = cans[i];
    add(part(`can${i}`, () => new THREE.CylinderGeometry(0.032, 0.032, 0.10, 8), m.chrome, x, y, z, Math.PI * 0.5, 0, 0));
    add(part(`glow${i}`, () => new THREE.CylinderGeometry(0.022, 0.034, 0.14, 8), m.glow, x, y, z - 0.04, Math.PI * 0.5, 0, 0));
  }

  if (variant === 1) {
    add(part('wing', () => new THREE.BoxGeometry(1.58, 0.035, 0.22), m.carbon, 0, 1.10, -2.02));
    add(part('wingL', () => new THREE.BoxGeometry(0.04, 0.18, 0.04), m.carbon, -0.52, 1.00, -2.00));
    add(part('wingR', () => new THREE.BoxGeometry(0.04, 0.18, 0.04), m.carbon, 0.52, 1.00, -2.00));
    add(part('stripe', () => new THREE.BoxGeometry(0.10, 0.02, 4.20), m.stripe, 0, 0.56, 0));
  } else if (variant === 2) {
    add(part('buttL', () => new THREE.BoxGeometry(0.10, 0.22, 0.70), m.paint, -0.52, 0.92, -0.88));
    add(part('buttR', () => new THREE.BoxGeometry(0.10, 0.22, 0.70), m.paint, 0.52, 0.92, -0.88));
    add(part('gtLip', () => new THREE.BoxGeometry(1.40, 0.05, 0.18), m.paint, 0, 0.72, -2.02));
  } else {
    add(part('cLine', () => new THREE.BoxGeometry(0.72, 0.06, 0.90), m.dark, 0, 0.62, -1.55));
    add(part('lip', () => new THREE.BoxGeometry(1.66, 0.04, 0.18), m.paint, 0, 0.70, -2.00));
  }

  add(part('dash', () => new THREE.BoxGeometry(1.32, 0.14, 0.32), m.cabin, 0, 0.60, 0.26));
  add(part('binnacle', () => new THREE.BoxGeometry(0.36, 0.06, 0.18), m.dark, CAR.seatX, 0.70, 0.22));
  const cluster = makeCluster();
  paintCluster(cluster, 0, false);
  const dial = new THREE.Mesh(
    geo('dial', () => new THREE.PlaneGeometry(0.24, 0.11)),
    new THREE.MeshBasicMaterial({ map: cluster.tex }),
  );
  dial.position.set(CAR.seatX, 0.72, 0.18);
  dial.rotation.x = -0.22;
  g.add(dial);

  const wheelRig = new THREE.Group();
  wheelRig.position.set(CAR.seatX, 0.66, 0.16);
  wheelRig.rotation.x = -0.42;
  const rim = new THREE.Mesh(geo('wheelRim', () => new THREE.TorusGeometry(0.13, 0.016, 8, 20)), m.leather);
  const hub = part('wheelHub', () => new THREE.CylinderGeometry(0.03, 0.03, 0.028, 10), m.chrome, 0, 0, 0, Math.PI * 0.5, 0, 0);
  const spoke = part('spoke', () => new THREE.BoxGeometry(0.24, 0.014, 0.018), m.leather, 0, 0, 0);
  const spoke2 = spoke.clone();
  spoke2.rotation.z = 2.1;
  const spoke3 = spoke.clone();
  spoke3.rotation.z = -2.1;
  wheelRig.add(rim, hub, spoke, spoke2, spoke3);
  g.add(wheelRig);

  for (const sx of [CAR.seatX, 0.36]) {
    add(part(`seatB${sx}`, () => new THREE.BoxGeometry(0.38, 0.08, 0.40), m.leather, sx, 0.40, 0.02));
    add(part(`seatR${sx}`, () => new THREE.BoxGeometry(0.38, 0.30, 0.08), m.leather, sx, 0.58, -0.16));
  }

  const panes = {};
  const addPane = (name, geoName, make, x, y, z) => {
    const glass = new THREE.MeshStandardMaterial({
      color: 0x6a8498, metalness: 0.88, roughness: 0.06, transparent: true, opacity: 0.26, depthWrite: false,
    });
    const node = part(geoName, make, glass, x, y, z);
    node.name = `glass-${name}`;
    node.userData.pane = name;
    g.add(node);
    panes[name] = node;
  };
  addPane('wind', 'glassW', () => new THREE.BoxGeometry(1.22, 0.34, 0.04), 0, 0.88, 0.48);
  addPane('rear', 'glassR', () => new THREE.BoxGeometry(1.22, 0.32, 0.04), 0, 0.87, -0.96);
  addPane('leftF', 'glassLF', () => new THREE.BoxGeometry(0.04, 0.32, 0.48), -0.98, 0.81, 0.13);
  addPane('rightF', 'glassRF', () => new THREE.BoxGeometry(0.04, 0.32, 0.48), 0.98, 0.81, 0.13);
  addPane('leftR', 'glassLR', () => new THREE.BoxGeometry(0.04, 0.32, 0.62), -0.98, 0.81, -0.50);
  addPane('rightR', 'glassRR', () => new THREE.BoxGeometry(0.04, 0.32, 0.62), 0.98, 0.81, -0.50);

  const wheels = [];
  for (const [sx, sz] of [[-0.88, 1.32], [0.88, 1.32], [-0.88, -1.36], [0.88, -1.36]]) {
    const w = part('wheel', () => {
      const geom = new THREE.CylinderGeometry(0.28, 0.28, 0.24, 14);
      geom.rotateZ(Math.PI * 0.5);
      return geom;
    }, m.rubber, sx, 0.28, sz);
    const cap = part('cap', () => new THREE.CylinderGeometry(0.11, 0.11, 0.26, 10), m.chrome, sx, 0.28, sz, 0, 0, Math.PI * 0.5);
    g.add(w, cap);
    wheels.push(w);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return { group: g, wheels, lights: m.light, tails: m.tail, panes, wheelRig, cluster };
}

export class Cars {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'cars';
    scene.add(this.group);
    this.prompt = null;
    this.poseAcc = 0;
    this.lastPoseKey = '';
  }

  spawnCity() {
    return this.spawnMap('city');
  }

  spawnMap(id) {
    this.clear();
    const spots = carSpotsForMap(id);
    const { terrain } = this.world;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const y = terrain.heightAt(s.x, s.z);
      const built = makeCarMesh(COLORS[i % COLORS.length], i % 3);
      const car = {
        id: i,
        x: s.x,
        y,
        z: s.z,
        yaw: s.yaw,
        speed: 0,
        vel: new THREE.Vector3(),
        seat: new THREE.Vector3(),
        driver: null,
        lastDriver: null,
        remote: false,
        squash: {},
        glass: 0,
        steer: 0,
        mesh: built.group,
        wheels: built.wheels,
        lights: built.lights,
        tails: built.tails,
        panes: built.panes,
        wheelRig: built.wheelRig,
        cluster: built.cluster,
        home: { x: s.x, z: s.z, yaw: s.yaw },
      };
      this.placeMesh(car);
      this.refreshSeat(car);
      this.group.add(car.mesh);
      this.list.push(car);
    }
    return this.list;
  }

  clear() {
    for (const car of this.list) {
      car.driver = null;
      car.mesh.removeFromParent();
    }
    this.list.length = 0;
    this.prompt = null;
  }

  reset() {
    for (const car of this.list) {
      if (car.driver?.isPlayer) this.ejectLocal(car.driver);
      car.driver = null;
      car.remote = false;
      car.speed = 0;
      car.vel.set(0, 0, 0);
      car.x = car.home.x;
      car.z = car.home.z;
      car.yaw = car.home.yaw;
      car.y = this.world.terrain.heightAt(car.x, car.z);
      car.squash = {};
      car.steer = 0;
      this.applyGlass(car, 0);
      this.placeMesh(car);
      this.refreshSeat(car);
    }
  }

  byId(id) {
    return this.list.find((c) => c.id === id) || null;
  }

  refreshSeat(car) {
    const s = seatOf(car);
    car.seat.set(s.x, s.y, s.z);
  }

  placeMesh(car) {
    car.mesh.position.set(car.x, car.y, car.z);
    car.mesh.rotation.order = 'YXZ';
    car.mesh.rotation.y = car.yaw;
  }

  localCar() {
    return this.list.find((c) => c.driver?.isPlayer) || null;
  }

  canToggle(player) {
    if (!player || this.list.length === 0) return false;
    if (player.vehicle) return true;
    return !!nearestEnter(player.pos.x, player.pos.z, this.list);
  }

  toggle(player) {
    if (player.vehicle) {
      this.leave(player);
      return 'leave';
    }
    return this.enter(player) ? 'enter' : null;
  }

  enter(player, id) {
    if (!player?.fighter?.alive || player.vehicle) return false;
    const car = Number.isFinite(id) ? this.byId(id) : nearestEnter(player.pos.x, player.pos.z, this.list);
    if (!car || car.driver) return false;
    car.driver = player.fighter;
    car.lastDriver = player.fighter;
    car.remote = false;
    player.vehicle = car;
    player.swimming = false;
    this.refreshSeat(car);
    player.pos.copy(car.seat);
    player.yaw = car.yaw;
    player.camYaw = car.yaw;
    player.camPitch = -0.04;
    player.camDist = 0;
    player.smoothDist = 0;
    this.world.session?.reportCar?.('in', this.pack(car));
    return true;
  }

  leave(player) {
    const car = player?.vehicle;
    if (!car) return false;
    this.ejectLocal(player, car);
    this.world.session?.reportCar?.('out', this.pack(car));
    return true;
  }

  ejectLocal(player, car = player.vehicle) {
    if (!car) return;
    if (car.driver === player.fighter) car.driver = null;
    player.vehicle = null;
    player._carYaw = undefined;
    if (player.character?.root) player.character.root.visible = true;
    const side = 1;
    const at = exitOf(car, side);
    const y = this.world.terrain.heightAt(at.x, at.z);
    player.pos.set(at.x, y, at.z);
    player.vel.set(0, 0, 0);
    player.yaw = car.yaw;
    this.refreshSeat(car);
  }

  applySnap(id, snap, driver) {
    const car = this.byId(id);
    if (!car) return;
    if (Array.isArray(snap.p) && snap.p.length === 3) {
      car.x = snap.p[0];
      car.y = snap.p[1];
      car.z = snap.p[2];
    }
    if (Number.isFinite(snap.yaw)) car.yaw = snap.yaw;
    if (Number.isFinite(snap.spd)) car.speed = snap.spd;
    if (Number.isFinite(snap.g)) this.applyGlass(car, snap.g);
    if (snap.a === 'glass' && Number.isFinite(snap.g)) this.applyGlass(car, snap.g);
    if (snap.a === 'in' && driver) {
      if (car.driver?.isPlayer) return;
      car.driver = driver;
      car.remote = true;
    }
    if (snap.a === 'out') {
      if (car.driver === driver || car.remote) car.driver = null;
      car.remote = false;
      car.speed = 0;
      car.vel.set(0, 0, 0);
    }
    this.refreshSeat(car);
    this.placeMesh(car);
  }

  applyFleet(fleet) {
    if (!Array.isArray(fleet)) return;
    for (const snap of fleet) {
      if (!snap || !Number.isFinite(snap.i)) continue;
      this.applySnap(snap.i, snap, null);
    }
  }

  pack(car) {
    return {
      i: car.id,
      p: [+car.x.toFixed(2), +car.y.toFixed(2), +car.z.toFixed(2)],
      yaw: +car.yaw.toFixed(3),
      spd: +car.speed.toFixed(2),
      g: car.glass || 0,
    };
  }

  applyGlass(car, mask) {
    car.glass = mask || 0;
    if (!car.panes) return;
    for (const name of PANES) {
      const pane = car.panes[name];
      if (pane) pane.visible = glassIntact(car.glass, name);
    }
  }

  breakGlass(car, pane, from, dir, hit, opts = {}) {
    if (!car || !pane || !glassIntact(car.glass || 0, pane)) return false;
    this.applyGlass(car, glassMaskAfterHit(car.glass || 0, pane));
    const t = hit?.t || 0.6;
    const at = new THREE.Vector3(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t);
    const n = hit?.normal
      ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
      : dir.clone().negate();
    this.world.fx?.impact?.(at, n, 'glass', dir);
    this.world.audio?.impact?.('glass', at.distanceTo(this.world.player?.camera?.position || at));
    if (this.world.fx?.alpha) {
      for (let i = 0; i < 10; i++) {
        this.world.fx.alpha.spawn({
          pos: at.clone(),
          vel: new THREE.Vector3().copy(dir).multiplyScalar(1.2 + Math.random())
            .add(new THREE.Vector3().randomDirection().multiplyScalar(2.2)),
          size: 0.04 + Math.random() * 0.05, grow: 0.2, life: 0.45 + Math.random() * 0.35,
          color: [0.72, 0.82, 0.9], alpha: 0.7, drag: 1.1, gravity: 9,
        });
      }
    }
    if (!opts.silent) this.world.session?.reportCar?.('glass', { i: car.id, g: car.glass, pane });
    return true;
  }

  breakAlong(o, d, maxDist, ignore, opts = {}) {
    const origin = { x: o.x, y: o.y, z: o.z };
    let traveled = 0;
    const broken = [];
    for (let i = 0; i < 3; i++) {
      let best = null;
      for (const car of this.list) {
        if (car.driver === ignore) continue;
        const hit = hitCar(origin, d, car, maxDist - traveled, { glassOnly: true });
        if (hit && (!best || hit.t < best.t)) best = hit;
      }
      if (!best) break;
      this.breakGlass(best.car, best.pane, o, d, { ...best, t: best.t + traveled }, opts);
      broken.push(best);
      traveled += best.t + 0.03;
      origin.x = o.x + d.x * traveled;
      origin.y = o.y + d.y * traveled;
      origin.z = o.z + d.z * traveled;
    }
    return broken;
  }

  raycast(o, d, maxDist, ignore) {
    let best = null;
    for (const car of this.list) {
      if (car.driver === ignore) continue;
      const hit = hitCar(o, d, car, best ? best.t : maxDist, { metalOnly: true });
      if (!hit) continue;
      const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      if (!normal.lengthSq()) normal.set(0, 1, 0);
      else normal.normalize();
      best = { t: hit.t, normal, surface: 'metal', car };
    }
    return best;
  }

  collideWalker(pos, radius, ignore) {
    for (const car of this.list) {
      if (car === ignore) continue;
      resolveCarBox(pos, radius, car);
    }
  }

  updatePrompt(player) {
    if (!player || this.list.length === 0) {
      this.prompt = null;
      return null;
    }
    if (player.vehicle) {
      this.prompt = { mode: 'drive', speed: player.vehicle.speed };
      return this.prompt;
    }
    const near = nearestEnter(player.pos.x, player.pos.z, this.list);
    this.prompt = near ? { mode: 'enter', car: near } : null;
    return this.prompt;
  }

  update(dt, input, player, opts = {}) {
    const active = !!opts.active;
    const local = this.localCar();
    if (active && player?.fighter?.alive && local) {
      const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0) + (input.moveY || 0);
      const s = (input.right ? 1 : 0) - (input.left ? 1 : 0) + (input.moveX || 0);
      local.steer = THREE.MathUtils.clamp(s, -1, 1);
      const stepped = stepDrive({
        speed: local.speed,
        yaw: local.yaw,
        throttle: THREE.MathUtils.clamp(f, -1, 1),
        steer: local.steer,
        dt,
        sprint: !!input.sprint,
      });
      local.speed = stepped.speed;
      local.yaw = stepped.yaw;
      local.x += stepped.vx * dt;
      local.z += stepped.vz * dt;
      local.vel.set(stepped.vx, 0, stepped.vz);
      this.groundCar(local);
      this.bumpWorld(local);
      this.refreshSeat(local);
      this.placeMesh(local);
      this.syncPose(dt, local);
    }

    for (const car of this.list) {
      if (!car.driver?.isPlayer) {
        if (!car.driver && Math.abs(car.speed) > 0.05) {
          const stepped = stepDrive({
            speed: car.speed, yaw: car.yaw, throttle: 0, steer: 0, dt,
          });
          car.speed = stepped.speed;
          car.x += stepped.vx * dt;
          car.z += stepped.vz * dt;
          car.vel.set(stepped.vx, 0, stepped.vz);
          this.groundCar(car);
          this.bumpWorld(car);
          this.refreshSeat(car);
          this.placeMesh(car);
        } else {
          this.refreshSeat(car);
          this.placeMesh(car);
        }
      }
      const spin = car.speed * dt / 0.32;
      for (const w of car.wheels) w.rotation.x += spin;
      if (car.wheels[0]) car.wheels[0].rotation.y = (car.steer || 0) * 0.38;
      if (car.wheels[1]) car.wheels[1].rotation.y = (car.steer || 0) * 0.38;
      if (car.wheelRig) car.wheelRig.rotation.z = -(car.steer || 0) * 0.65;
      if (car.cluster) paintCluster(car.cluster, car.speed, !!car.driver);
      car.mesh.rotation.z = THREE.MathUtils.clamp(-car.speed * 0.002, -0.06, 0.06);
      car.lights.emissiveIntensity = car.driver ? 1.15 : 0.45;
      car.tails.emissiveIntensity = car.speed < -0.4 || (car.driver?.isPlayer && input?.back) ? 1.2 : 0.4;
    }

    if (player) this.updatePrompt(player);
    if (opts.squash) this.squash(opts.squash);
    this.dust(dt);
  }

  groundCar(car) {
    const { terrain } = this.world;
    if (!terrain.inBounds(car.x, car.z)) {
      const lim = HALF_WORLD - 2;
      car.x = THREE.MathUtils.clamp(car.x, -lim, lim);
      car.z = THREE.MathUtils.clamp(car.z, -lim, lim);
      car.speed *= 0.2;
      car.vel.multiplyScalar(0.2);
    }
    car.y = terrain.heightAt(car.x, car.z);
    const n = terrain.normalAt(car.x, car.z);
    if (n.y < 0.55) car.speed *= 0.4;
  }

  bumpWorld(car) {
    const next = { x: car.x, y: car.y, z: car.z };
    this.world.veg?.colliders?.resolveXZ(next, CAR.collideR, car.y, car.y + 1.25);
    if (Math.hypot(next.x - car.x, next.z - car.z) > 1e-4) {
      car.x = next.x;
      car.z = next.z;
      car.speed *= 0.28;
      car.vel.multiplyScalar(0.28);
    }
  }

  squash(combat) {
    const now = combat.time;
    const session = this.world.session;
    for (const car of this.list) {
      const hits = runOverHits(car, combat.fighters, now);
      if (!hits.length) continue;
      const atk = car.driver || car.lastDriver;
      const dir = new THREE.Vector3(Math.sin(car.yaw), 0.05, Math.cos(car.yaw)).multiplyScalar(Math.sign(car.speed) || 1);
      for (const vic of hits) {
        car.squash[vic.id] = now + 0.85;
        const at = vic.pos?.clone?.() || new THREE.Vector3(car.x, car.y + 0.8, car.z);
        if (session?.multi && atk?.isPlayer && (vic.net || vic.isPlayer)) {
          session.reportRunover(vic, dir);
        }
        combat.damage(vic, atk, 200, dir, { weapon: 'car', at });
        this.world.fx?.bloodHit?.(at, dir, dir.clone().negate(), 1.4);
        this.world.audio?.impact?.('flesh', 4);
      }
    }
  }

  syncPose(dt, car) {
    this.poseAcc += dt;
    if (this.poseAcc < 1 / 10) return;
    this.poseAcc = 0;
    const pack = this.pack(car);
    const key = `${pack.p}|${pack.yaw}|${pack.spd}`;
    if (key === this.lastPoseKey) return;
    this.lastPoseKey = key;
    this.world.session?.reportCar?.('pose', pack);
  }

  dust(dt) {
    const fx = this.world.fx;
    if (!fx?.alpha) return;
    this._dust = (this._dust || 0) + dt;
    if (this._dust < 0.08) return;
    this._dust = 0;
    for (const car of this.list) {
      if (Math.abs(car.speed) < 7) continue;
      const back = -CAR.halfL * 0.7;
      const o = localOffset(car.x, car.z, car);
      fx.alpha.spawn({
        pos: new THREE.Vector3(car.x + o.fwdX * back, car.y + 0.12, car.z + o.fwdZ * back),
        vel: new THREE.Vector3(-o.fwdX * 1.2, 0.4, -o.fwdZ * 1.2),
        size: 0.35, grow: 1.1, life: 0.55, color: [0.28, 0.26, 0.22], alpha: 0.28, drag: 1.4, gravity: -0.1,
      });
    }
  }
}
