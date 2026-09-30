import * as THREE from 'three';
import { CITY, cityCell } from '../world/cityLayout.js';
import { HALF_WORLD } from '../world/constants.js';
import { LAB } from '../world/lab.js';

export const CAR = {
  count: 8,
  fleetMax: 256,
  halfL: 2.25,
  halfW: 1.02,
  height: 1.18,
  enterR: 2.75,
  seatX: 0.36, // local +x is the car's left: left-hand drive, as in Israel
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

/** A kick scooter: stand on the deck, third-person camera, slower and tighter than a car. */
export const SCOOTER = {
  kind: 'scooter',
  halfL: 0.62,
  halfW: 0.3,
  height: 1.25,
  enterR: 2.3,
  seatX: 0,
  seatY: 0.16,
  seatZ: -0.08,
  maxSpeed: 11,
  boostSpeed: 15,
  reverse: 2.5,
  accel: 9,
  brake: 16,
  coast: 4.5,
  steer: 2.7,
  killSpeed: 6,
  collideR: 0.42,
  eyeY: 1.5,
  eyeZ: 0,
  wheelR: 0.1,
  metalBoxes: [
    { x0: -0.14, x1: 0.14, y0: 0.06, y1: 0.24, z0: -0.62, z1: 0.62 },
    { x0: -0.05, x1: 0.05, y0: 0.24, y1: 1.2, z0: 0.46, z1: 0.6 },
  ],
};

const specOf = (car) => car?.spec || CAR;

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
  0x2a6bff, 0x141518, 0xffd000, 0xc41818, 0xf4f1ea, 0xff6a12, 0xb8bec6, 0x153a8a,
  0x0e8a6a, 0x5a16d8, 0xe8e8ea, 0x1c1c1e,
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

/** A light street fleet on the Midtown grid. */
export function manhattanCarSpots(limit = 16) {
  const raw = [];
  const { pitch, halfBlocks, playRadius, plazaLawn } = CITY;
  const lane = 2.85;
  const step = 22;
  const lim = halfBlocks * pitch;
  const keep = (x, z, yaw) => {
    if (Math.hypot(x, z) > playRadius - 14) return;
    if (Math.hypot(x, z) < plazaLawn + 2) return;
    if (Math.hypot(x - 6.2, z - 40) < 5.5) return;
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
  raw.sort((a, b) => Math.hypot(a.x - 6.2, a.z - 40) - Math.hypot(b.x - 6.2, b.z - 40));
  if (raw.length <= limit) return raw;
  const out = [raw[0]];
  const stride = raw.length / limit;
  const used = new Set([0]);
  for (let i = 1; i < limit; i++) {
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
  if (id === 'lab') return LAB.cars;
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
    x: car.x + o.rightX * specOf(car).seatX + o.fwdX * specOf(car).seatZ,
    y: car.y + specOf(car).seatY,
    z: car.z + o.rightZ * specOf(car).seatX + o.fwdZ * specOf(car).seatZ,
  };
}

export function exitOf(car, side = 1) {
  const o = localOffset(car.x, car.z, car);
  const lat = (specOf(car).halfW + 0.85) * side;
  return {
    x: car.x + o.rightX * lat + o.fwdX * specOf(car).seatZ,
    z: car.z + o.rightZ * lat + o.fwdZ * specOf(car).seatZ,
  };
}

export function canEnter(px, pz, car) {
  if (!car || car.driver) return false;
  return Math.hypot(px - car.x, pz - car.z) < specOf(car).enterR;
}

export function nearestEnter(px, pz, cars) {
  let best = null;
  let bestD = Infinity;
  for (const car of cars) {
    if (car.driver) continue;
    const d = Math.hypot(px - car.x, pz - car.z);
    if (d < specOf(car).enterR && d < bestD) {
      best = car;
      bestD = d;
    }
  }
  return best;
}

export function carOverlap(px, pz, py, car, pad = 0) {
  if (Math.abs((py ?? car.y) - car.y) > 1.35) return false;
  const { along, side } = localOffset(px, pz, car);
  return Math.abs(along) < specOf(car).halfL + pad && Math.abs(side) < specOf(car).halfW + pad;
}

export function resolveCarBox(pos, radius, car) {
  const { along, side, fwdX, fwdZ, rightX, rightZ } = localOffset(pos.x, pos.z, car);
  const hl = specOf(car).halfL + radius;
  const hw = specOf(car).halfW + radius;
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

/**
 * Separating-axis test between two vehicles' footprints (oriented rectangles).
 * Returns the smallest push { nx, nz, depth } that moves `a` out of `b`, or null.
 */
export function carPush(a, b) {
  const A = specOf(a), B = specOf(b);
  if (Math.abs((a.y ?? 0) - (b.y ?? 0)) > 1.5) return null;
  const dx = a.x - b.x, dz = a.z - b.z;
  const reach = Math.hypot(A.halfL, A.halfW) + Math.hypot(B.halfL, B.halfW);
  if (dx * dx + dz * dz > reach * reach) return null;
  const axesOf = (c) => {
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    return [[s, co], [co, -s]]; // forward, right
  };
  const ea = axesOf(a), eb = axesOf(b);
  const half = (e, S, ax) => Math.abs(e[0][0] * ax[0] + e[0][1] * ax[1]) * S.halfL
    + Math.abs(e[1][0] * ax[0] + e[1][1] * ax[1]) * S.halfW;
  let best = null;
  for (const ax of [...ea, ...eb]) {
    const d = dx * ax[0] + dz * ax[1];
    const overlap = half(ea, A, ax) + half(eb, B, ax) - Math.abs(d);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const sgn = d < 0 ? -1 : 1;
      best = { nx: ax[0] * sgn, nz: ax[1] * sgn, depth: overlap };
    }
  }
  return best;
}

/** A = left, D = right. Sign is opposite walk-strafe because +yaw turns the nose left on screen. */
export function driveSteer(input = {}) {
  return (input.left ? 1 : 0) - (input.right ? 1 : 0) - (input.moveX || 0);
}

export function stepDrive({ speed, yaw, throttle, steer, dt, sprint = false, spec = CAR }) {
  const S = spec;
  const max = sprint && throttle > 0 ? S.boostSpeed : S.maxSpeed;
  let next = speed;
  if (throttle > 0) {
    next = next < 0 ? Math.min(0, next + S.brake * dt) : Math.min(max, next + S.accel * throttle * dt);
  } else if (throttle < 0) {
    next = next > 0 ? Math.max(0, next - S.brake * dt) : Math.max(-S.reverse, next + S.accel * throttle * dt);
  } else if (next > 0) {
    next = Math.max(0, next - S.coast * dt);
  } else if (next < 0) {
    next = Math.min(0, next + S.coast * dt);
  }
  if (Math.abs(next) < 0.08) next = 0;
  const grip = 1 / (1 + Math.abs(next) * 0.055);
  const turn = Math.abs(next) < 0.25 ? 0 : steer * S.steer * grip * Math.sign(next);
  const heading = wrap(yaw + turn * dt);
  return {
    speed: next,
    yaw: heading,
    vx: Math.sin(heading) * next,
    vz: Math.cos(heading) * next,
  };
}

/**
 * Where a seated driver's hips go and where the steering wheel is, in world space
 * (a scooter rider stands instead).
 */
export function driverPose(car) {
  const S = specOf(car);
  if (S.kind === 'scooter') return null;
  const o = localOffset(car.x, car.z, car);
  const seat = seatOf(car);
  return {
    hipY: car.y + 0.5,
    wheel: new THREE.Vector3(seat.x + o.fwdX * 0.46, car.y + 0.86, seat.z + o.fwdZ * 0.46),
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

/** Closest hit of a ray on a flat list of triangles (x, y, z per vertex), both sides. */
export function rayTriangles(o, d, pos, maxDist) {
  let best = null;
  for (let i = 0; i + 9 <= pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const e1x = pos[i + 3] - ax, e1y = pos[i + 4] - ay, e1z = pos[i + 5] - az;
    const e2x = pos[i + 6] - ax, e2y = pos[i + 7] - ay, e2z = pos[i + 8] - az;
    const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) continue;
    const inv = 1 / det;
    const tx = o.x - ax, ty = o.y - ay, tz = o.z - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t <= 0 || t >= (best ? best.t : maxDist)) continue;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    const s = nx * d.x + ny * d.y + nz * d.z > 0 ? -1 / l : 1 / l;
    nx *= s; ny *= s; nz *= s;
    best = { t, nx, ny, nz };
  }
  return best;
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
    for (const b of car.spec ? car.spec.metalBoxes : METAL_BOXES) {
      const h = rayAABB(o, d, b, best ? best.t : maxDist);
      if (h && (!best || h.t < best.t)) best = { ...h, surface: 'metal' };
    }
  }
  if (!opts.metalOnly && !car.spec) {
    const mask = car.glass || 0;
    const boxes = car.paneBoxes || PANE_BOXES; // city cars carry boxes measured from their own glass
    for (const name of PANES) {
      if (!glassIntact(mask, name) || !boxes[name]) continue;
      let h = rayAABB(o, d, boxes[name], best ? best.t : maxDist);
      // city panes are a handful of real triangles: test those, the boxes overlap
      if (h && car.paneBoxes && car.panes?.[name]) h = rayTriangles(o, d, car.panes[name].geometry.attributes.position.array, best ? best.t : maxDist);
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
  if (!car || Math.abs(car.speed) < specOf(car).killSpeed) return [];
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

function planShape(half) {
  const s = new THREE.Shape();
  s.moveTo(half[0][0], half[0][1]);
  for (let i = 1; i < half.length; i++) s.lineTo(half[i][0], half[i][1]);
  for (let i = half.length - 1; i >= 0; i--) s.lineTo(-half[i][0], half[i][1]);
  s.closePath();
  return s;
}

function extrudePlan(name, half, depth, bevel = 0.05) {
  return geo(name, () => {
    const g = new THREE.ExtrudeGeometry(planShape(half), {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 1,
    });
    g.rotateX(-Math.PI * 0.5);
    g.rotateY(Math.PI);
    g.computeVertexNormals();
    return g;
  });
}

const BODY_HALF = [
  [0.16, 2.22], [0.48, 2.16], [0.78, 1.98], [0.90, 1.72],
  [0.80, 1.42], [0.72, 1.22], [0.88, 0.95], [0.98, 0.45],
  [1.02, -0.15], [1.04, -0.85], [1.00, -1.28], [0.78, -1.48],
  [0.72, -1.62], [0.86, -1.88], [0.78, -2.12], [0.36, -2.22], [0.14, -2.24],
];
const CABIN_HALF = [
  [0.18, 0.52], [0.48, 0.42], [0.56, 0.08], [0.54, -0.42], [0.40, -0.88], [0.16, -1.00],
];
const GLASS_HALF = [
  [0.14, 0.46], [0.40, 0.36], [0.46, 0.04], [0.44, -0.40], [0.32, -0.82], [0.12, -0.92],
];

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

// Metallic base under a glossy clear coat, like real car paint.
function paintMat(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.55,
    roughness: 0.38,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.2,
  });
}

function kitMats(color) {
  return {
    paint: paintMat(color),
    dark: new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0.4, roughness: 0.55 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.55, roughness: 0.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd4dae0, metalness: 0.95, roughness: 0.16 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x121212, metalness: 0.06, roughness: 0.92 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.08, roughness: 0.78 }),
    cabin: new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.18, roughness: 0.7 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf2f0e8, metalness: 0.15, roughness: 0.55 }),
    canopy: new THREE.MeshStandardMaterial({
      color: 0x15181c, metalness: 0.9, roughness: 0.08, transparent: true, opacity: 0.72,
    }),
    light: new THREE.MeshStandardMaterial({
      color: 0xfff1c4, emissive: 0xffd27a, emissiveIntensity: 0.7, metalness: 0.35, roughness: 0.22,
    }),
    tail: new THREE.MeshStandardMaterial({
      color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.22,
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

  const body = new THREE.Mesh(extrudePlan('body', BODY_HALF, 0.28, 0.06), m.paint);
  body.position.y = 0.20;
  const cabin = new THREE.Mesh(extrudePlan('cabin', CABIN_HALF, 0.22, 0.04), m.paint);
  cabin.position.y = 0.52;
  const canopy = new THREE.Mesh(extrudePlan('canopy', GLASS_HALF, 0.10, 0.03), m.canopy);
  canopy.position.y = 0.76;
  add(body, cabin, canopy);

  add(part('skirt', () => new THREE.BoxGeometry(1.92, 0.08, 4.10), m.dark, 0, 0.16, -0.04));
  add(part('splitter', () => new THREE.BoxGeometry(1.55, 0.04, 0.22), m.carbon, 0, 0.18, 2.16));
  add(part('diffuser', () => new THREE.BoxGeometry(1.35, 0.08, 0.32), m.dark, 0, 0.14, -2.18));
  add(part('led', () => new THREE.BoxGeometry(1.28, 0.045, 0.05), m.tail, 0, 0.50, -2.22));
  add(part('plate', () => new THREE.BoxGeometry(0.32, 0.11, 0.02), m.plate, 0, 0.36, -2.24));
  add(part('headL', () => new THREE.BoxGeometry(0.28, 0.07, 0.06), m.light, -0.58, 0.40, 2.16));
  add(part('headR', () => new THREE.BoxGeometry(0.28, 0.07, 0.06), m.light, 0.58, 0.40, 2.16));
  add(part('mirrorL', () => new THREE.BoxGeometry(0.16, 0.05, 0.08), m.dark, -0.72, 0.72, 0.38));
  add(part('mirrorR', () => new THREE.BoxGeometry(0.16, 0.05, 0.08), m.dark, 0.72, 0.72, 0.38));
  add(part('archFL', () => new THREE.BoxGeometry(0.18, 0.16, 0.46), m.dark, -0.92, 0.28, 1.28));
  add(part('archFR', () => new THREE.BoxGeometry(0.18, 0.16, 0.46), m.dark, 0.92, 0.28, 1.28));
  add(part('archRL', () => new THREE.BoxGeometry(0.18, 0.16, 0.46), m.dark, -0.94, 0.28, -1.38));
  add(part('archRR', () => new THREE.BoxGeometry(0.18, 0.16, 0.46), m.dark, 0.94, 0.28, -1.38));

  const cans = [[-0.16, 0.20, -2.26], [-0.06, 0.20, -2.26], [0.06, 0.20, -2.26], [0.16, 0.20, -2.26]];
  for (let i = 0; i < cans.length; i++) {
    const [x, y, z] = cans[i];
    add(part(`can${i}`, () => new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8), m.chrome, x, y, z, Math.PI * 0.5, 0, 0));
    add(part(`glow${i}`, () => new THREE.CylinderGeometry(0.02, 0.03, 0.12, 8), m.glow, x, y, z - 0.04, Math.PI * 0.5, 0, 0));
  }

  if (variant === 1) {
    add(part('wing', () => new THREE.BoxGeometry(1.42, 0.03, 0.20), m.carbon, 0, 1.02, -1.88));
    add(part('wingL', () => new THREE.BoxGeometry(0.04, 0.16, 0.04), m.carbon, -0.46, 0.92, -1.86));
    add(part('wingR', () => new THREE.BoxGeometry(0.04, 0.16, 0.04), m.carbon, 0.46, 0.92, -1.86));
    add(part('stripe', () => new THREE.BoxGeometry(0.08, 0.02, 3.6), m.stripe, 0, 0.56, 0.05));
  } else if (variant === 2) {
    add(part('buttL', () => new THREE.BoxGeometry(0.08, 0.18, 0.62), m.paint, -0.42, 0.86, -0.72));
    add(part('buttR', () => new THREE.BoxGeometry(0.08, 0.18, 0.62), m.paint, 0.42, 0.86, -0.72));
  } else {
    add(part('lip', () => new THREE.BoxGeometry(1.15, 0.035, 0.16), m.paint, 0, 0.62, -2.08));
  }

  add(part('dash', () => new THREE.BoxGeometry(1.12, 0.12, 0.28), m.cabin, 0, 0.58, 0.24));
  add(part('binnacle', () => new THREE.BoxGeometry(0.34, 0.05, 0.16), m.dark, CAR.seatX, 0.66, 0.20));
  const cluster = makeCluster();
  paintCluster(cluster, 0, false);
  const dial = new THREE.Mesh(
    geo('dial', () => new THREE.PlaneGeometry(0.24, 0.11)),
    new THREE.MeshBasicMaterial({ map: cluster.tex }),
  );
  dial.position.set(CAR.seatX, 0.68, 0.16);
  dial.rotation.x = -0.22;
  g.add(dial);

  const wheelRig = new THREE.Group();
  wheelRig.position.set(CAR.seatX, 0.62, 0.14);
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

  for (const sx of [CAR.seatX, 0.34]) {
    add(part(`seatB${sx}`, () => new THREE.BoxGeometry(0.36, 0.07, 0.38), m.leather, sx, 0.40, 0.00));
    add(part(`seatR${sx}`, () => new THREE.BoxGeometry(0.36, 0.26, 0.07), m.leather, sx, 0.54, -0.16));
  }

  const panes = {};
  const addPane = (name, geoName, make, x, y, z, rx = 0) => {
    const glass = new THREE.MeshStandardMaterial({
      color: 0x1c242c, metalness: 0.88, roughness: 0.06, transparent: true, opacity: 0.42, depthWrite: false,
    });
    const node = part(geoName, make, glass, x, y, z, rx);
    node.name = `glass-${name}`;
    node.userData.pane = name;
    g.add(node);
    panes[name] = node;
  };
  addPane('wind', 'glassW', () => new THREE.BoxGeometry(1.00, 0.30, 0.04), 0, 0.88, 0.48, 0.35);
  addPane('rear', 'glassR', () => new THREE.BoxGeometry(0.92, 0.26, 0.04), 0, 0.84, -0.96, -0.22);
  addPane('leftF', 'glassLF', () => new THREE.BoxGeometry(0.04, 0.26, 0.42), -0.58, 0.78, 0.12);
  addPane('rightF', 'glassRF', () => new THREE.BoxGeometry(0.04, 0.26, 0.42), 0.58, 0.78, 0.12);
  addPane('leftR', 'glassLR', () => new THREE.BoxGeometry(0.04, 0.26, 0.50), -0.54, 0.78, -0.48);
  addPane('rightR', 'glassRR', () => new THREE.BoxGeometry(0.04, 0.26, 0.50), 0.54, 0.78, -0.48);

  const wheels = [];
  for (const [sx, sz] of [[-0.96, 1.28], [0.96, 1.28], [-0.98, -1.40], [0.98, -1.40]]) {
    const w = part('wheel', () => {
      const geom = new THREE.CylinderGeometry(0.30, 0.30, 0.26, 16);
      geom.rotateZ(Math.PI * 0.5);
      return geom;
    }, m.rubber, sx, 0.30, sz);
    const cap = part('cap', () => new THREE.CylinderGeometry(0.13, 0.13, 0.28, 12), m.chrome, sx, 0.30, sz, 0, 0, Math.PI * 0.5);
    g.add(w, cap);
    wheels.push(w);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return { group: g, wheels, lights: m.light, tails: m.tail, panes, wheelRig, cluster };
}

const SCOOTER_COLORS = [0x2a9d5c, 0x2b6fd6, 0xd6a02b, 0xd6452b, 0x8a4fd6, 0x1fb5b5, 0xe8e8ea];

function makeScooterMesh(color) {
  const g = new THREE.Group();
  g.name = 'scooter';
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.3, roughness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0.1, roughness: 0.9 });
  const add = (mesh, parent = g) => { mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.78), dark)).position.set(0, 0.12, -0.02);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.012, 0.6), grip)).position.set(0, 0.15, -0.06);
  const wheels = [];
  for (const z of [-0.42, 0.44]) {
    const w = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20).rotateZ(Math.PI / 2), grip));
    w.position.set(0, 0.1, z);
    const hub = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.056, 12).rotateZ(Math.PI / 2), paint), w);
    hub.position.set(0, 0, 0);
    wheels.push(w);
  }
  const fork = new THREE.Group();
  fork.position.set(0, 0.12, 0.44);
  g.add(fork);
  const stem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.05, 10), paint), fork);
  stem.position.set(0, 0.52, -0.06);
  stem.rotation.x = -0.12;
  const bar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.56, 10).rotateZ(Math.PI / 2), paint), fork);
  bar.position.set(0, 1.04, -0.13);
  for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10).rotateZ(Math.PI / 2), grip), fork).position.set(sx * 0.27, 1.04, -0.13);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.22), paint)).position.set(0, 0.2, 0.5);
  return { group: g, wheels, handle: fork };
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
        cockpit: true, // modelled interior: V can switch to the driver's view
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

  /** Drivable cars whose bodies are supplied as meshes (city-set maps): spots are {x, y, z, yaw, mesh}. */
  spawnCustom(spots) {
    this.clear();
    const { terrain } = this.world;
    spots.forEach((s, i) => {
      const y = terrain.heightAt(s.x, s.z);
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
        mesh: s.mesh,
        wheels: [],
        lights: { emissiveIntensity: 0 },
        tails: { emissiveIntensity: 0 },
        panes: s.panes || null,
        paneBoxes: s.paneBoxes || null,
        wheelRig: null,
        cluster: null,
        home: { x: s.x, z: s.z, yaw: s.yaw },
      };
      this.placeMesh(car);
      this.refreshSeat(car);
      this.group.add(car.mesh);
      this.list.push(car);
    });
    return this.list;
  }

  /** Rideable kick scooters at {x, y, z, yaw}; they take ids after the cars. */
  addScooters(spots) {
    const { terrain } = this.world;
    spots.forEach((s, n) => {
      const y = terrain.heightAt(s.x, s.z);
      const built = makeScooterMesh(SCOOTER_COLORS[n % SCOOTER_COLORS.length]);
      const car = {
        id: this.list.length,
        kind: 'scooter',
        spec: SCOOTER,
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
        handle: built.handle,
        lights: { emissiveIntensity: 0 },
        tails: { emissiveIntensity: 0 },
        panes: null,
        wheelRig: null,
        cluster: null,
        home: { x: s.x, z: s.z, yaw: s.yaw },
      };
      this.placeMesh(car);
      this.refreshSeat(car);
      this.group.add(car.mesh);
      this.list.push(car);
    });
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

  // The body has weight: it squats under throttle, dives under braking, rolls out of a
  // turn and sits on the slope of the road, each on a damped spring.
  bodyMotion(car, dt) {
    if (!(dt > 0)) return;
    const S = specOf(car), t = this.world.terrain;
    const b = car.body || (car.body = { speed: car.speed, yaw: car.yaw, p: 0, pv: 0, r: 0, rv: 0 });
    const accel = (car.speed - b.speed) / dt;
    const yawRate = Math.atan2(Math.sin(car.yaw - b.yaw), Math.cos(car.yaw - b.yaw)) / dt;
    b.speed = car.speed;
    b.yaw = car.yaw;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const L = S.halfL * 0.8, W = S.halfW * 0.8;
    const hF = t.heightAt(car.x + fx * L, car.z + fz * L), hB = t.heightAt(car.x - fx * L, car.z - fz * L);
    const hL = t.heightAt(car.x + fz * W, car.z - fx * W), hR = t.heightAt(car.x - fz * W, car.z + fx * W); // local +x is left
    const clamp = THREE.MathUtils.clamp;
    // rotation.x > 0 dips the nose; rotation.z > 0 tips the roof to the right (local +x is the left side)
    const slopeP = clamp(Math.atan2(hB - hF, 2 * L), -0.25, 0.25);
    const slopeR = clamp(Math.atan2(hL - hR, 2 * W), -0.2, 0.2); // higher left side tips the roof right
    const scooter = !!car.spec;
    const pitchGoal = slopeP + (scooter ? 0 : clamp(-accel * 0.0045, -0.045, 0.06));
    // cars roll out of a turn; a scooter rider leans into it
    // (+yaw turns left: a car's roof swings out to the right, a scooter leans left into it)
    const lean = yawRate * car.speed;
    const rollGoal = slopeR + (scooter ? clamp(-lean * 0.02, -0.3, 0.3) : clamp(lean * 0.006, -0.08, 0.08));
    const w = scooter ? 7 : 6.5, z = 0.55, step = Math.min(dt, 0.05);
    b.pv += (w * w * (pitchGoal - b.p) - 2 * z * w * b.pv) * step;
    b.p += b.pv * step;
    b.rv += (w * w * (rollGoal - b.r) - 2 * z * w * b.rv) * step;
    b.r += b.rv * step;
    car.mesh.rotation.x = b.p;
    car.mesh.rotation.z = b.r;
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
      this.prompt = { mode: 'drive', speed: player.vehicle.speed, kind: player.vehicle.kind };
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
      local.steer = THREE.MathUtils.clamp(driveSteer(input), -1, 1);
      const stepped = stepDrive({
        speed: local.speed,
        yaw: local.yaw,
        throttle: THREE.MathUtils.clamp(f, -1, 1),
        steer: local.steer,
        dt,
        sprint: !!input.sprint,
        spec: specOf(local),
      });
      local.speed = stepped.speed;
      local.yaw = stepped.yaw;
      local.x += stepped.vx * dt;
      local.z += stepped.vz * dt;
      local.vel.set(stepped.vx, 0, stepped.vz);
      this.groundCar(local);
      this.bumpWorld(local);
      this.bumpCars(local);
      this.refreshSeat(local);
      this.placeMesh(local);
      this.syncPose(dt, local);
    }

    for (const car of this.list) {
      if (!car.driver?.isPlayer) {
        if (!car.driver && Math.abs(car.speed) > 0.05) {
          const stepped = stepDrive({
            speed: car.speed, yaw: car.yaw, throttle: 0, steer: 0, dt, spec: specOf(car),
          });
          car.speed = stepped.speed;
          car.x += stepped.vx * dt;
          car.z += stepped.vz * dt;
          car.vel.set(stepped.vx, 0, stepped.vz);
          this.groundCar(car);
          this.bumpWorld(car);
          this.bumpCars(car);
          this.refreshSeat(car);
          this.placeMesh(car);
        } else {
          this.refreshSeat(car);
          this.placeMesh(car);
        }
      }
      const spin = car.speed * dt / (specOf(car).wheelR || 0.32);
      for (const w of car.wheels) w.rotation.x += spin;
      if (!car.spec) {
        if (car.wheels[0]) car.wheels[0].rotation.y = (car.steer || 0) * 0.38;
        if (car.wheels[1]) car.wheels[1].rotation.y = (car.steer || 0) * 0.38;
      }
      if (car.handle) car.handle.rotation.y = (car.steer || 0) * 0.5;
      if (car.wheelRig) car.wheelRig.rotation.z = -(car.steer || 0) * 0.65;
      if (car.cluster) paintCluster(car.cluster, car.speed, !!car.driver);
      this.bodyMotion(car, dt);
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
    this.world.veg?.colliders?.resolveXZ(next, specOf(car).collideR, car.y, car.y + 1.25);
    if (Math.hypot(next.x - car.x, next.z - car.z) > 1e-4) {
      car.x = next.x;
      car.z = next.z;
      car.speed *= 0.28;
      car.vel.multiplyScalar(0.28);
    }
  }

  // Vehicles are solid to each other: push out of any overlap and lose the speed
  // going into it (a glancing hit scrapes along, a head-on one stops dead).
  bumpCars(car) {
    for (const other of this.list) {
      if (other === car) continue;
      const hit = carPush(car, other);
      if (!hit) continue;
      car.x += hit.nx * hit.depth;
      car.z += hit.nz * hit.depth;
      const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
      const vx = fx * car.speed, vz = fz * car.speed;
      const into = vx * hit.nx + vz * hit.nz;
      if (into < 0) {
        const rx = vx - hit.nx * into * 1.25, rz = vz - hit.nz * into * 1.25;
        car.speed = (rx * fx + rz * fz) * 0.8;
        car.vel.set(fx * car.speed, 0, fz * car.speed);
        if (-into > 2.5 && car.driver?.isPlayer) {
          this.world.audio?.impact?.('metal', 0);
          this.world.player?.kick?.(0, Math.min(3, -into * 0.25));
        }
      }
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
      if (Math.abs(car.speed) < (car.spec ? 5 : 7)) continue;
      const back = -specOf(car).halfL * 0.7;
      const o = localOffset(car.x, car.z, car);
      fx.alpha.spawn({
        pos: new THREE.Vector3(car.x + o.fwdX * back, car.y + 0.12, car.z + o.fwdZ * back),
        vel: new THREE.Vector3(-o.fwdX * 1.2, 0.4, -o.fwdZ * 1.2),
        size: 0.35, grow: 1.1, life: 0.55, color: [0.28, 0.26, 0.22], alpha: 0.28, drag: 1.4, gravity: -0.1,
      });
    }
  }
}
