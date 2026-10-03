import * as THREE from 'three';
import { CITY, cityCell } from '../world/cityLayout.js';
import { HALF_WORLD } from '../world/constants.js';
import { LAB } from '../world/lab.js';
import { CarBatch } from './carBatch.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeStaticParts } from './mergeParts.js';
import { dentCar } from './carDents.js';

export const CAR = {
  count: 8,
  fleetMax: 1024,
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
  // as quick as a car (it's a game)
  maxSpeed: 24,
  boostSpeed: 30,
  reverse: 2.5,
  accel: 12,
  brake: 18,
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

/** A bicycle: ridden seated, pedalling; as quick as a car too. */
export const BIKE = {
  ...SCOOTER,
  ride: 'bike',
  halfL: 0.86,
  halfW: 0.3,
  height: 1.05,
  enterR: 2.4,
  seatY: 0.0,
  seatZ: 0.02, // (the body's hips sit a little behind its root: this puts them on the saddle)
  wheelR: 0.33,
  steer: 2.5,
  // the seated pose: hips on the saddle, feet down to the pedals, hands on the bars
  // (barZ: from the seat to the bars)
  astride: { hip: 0.96, thigh: 0.85, knee: -0.75, barZ: 0.54, barY: 1.06 },
  metalBoxes: [
    { x0: -0.05, x1: 0.05, y0: 0.05, y1: 0.95, z0: -0.85, z1: 0.85 },
  ],
};

/** A moped (a city motor scooter): seated, feet on the floorboard, quicker off the line. */
export const MOPED = {
  ...SCOOTER,
  ride: 'moped',
  halfL: 1.0,
  halfW: 0.36,
  height: 1.15,
  enterR: 2.6,
  seatY: 0.0,
  seatZ: -0.12,
  wheelR: 0.24,
  accel: 14,
  steer: 2.3,
  astride: { hip: 0.86, thigh: 1.3, knee: -1.25, barZ: 0.62, barY: 1.01 },
  metalBoxes: [
    { x0: -0.3, x1: 0.3, y0: 0.08, y1: 0.75, z0: -1.0, z1: 1.0 },
    { x0: -0.25, x1: 0.25, y0: 0.75, y1: 1.1, z0: 0.55, z1: 0.8 },
  ],
};

const specOf = (car) => car?.spec || CAR;
const hpMax = (car) => (car?.spec ? 35 : 100);
// a city car's own footprint (from the bake), else its spec's
// (cached on the car: called for every car many times a frame, it was a new object each time)
const sizeOf = (car) => (car?.hl ? (car._size?.halfL === car.hl ? car._size : (car._size = { halfL: car.hl, halfW: car.hw })) : specOf(car));
export { sizeOf };

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
  const lat = (sizeOf(car).halfW + 0.85) * side;
  return {
    x: car.x + o.rightX * lat + o.fwdX * specOf(car).seatZ,
    z: car.z + o.rightZ * lat + o.fwdZ * specOf(car).seatZ,
  };
}

export function canEnter(px, pz, car) {
  if (!car || car.driver || car.wrecked) return false;
  return Math.hypot(px - car.x, pz - car.z) < specOf(car).enterR;
}

export function nearestEnter(px, pz, cars) {
  let best = null;
  let bestD = Infinity;
  for (const car of cars) {
    if (car.driver || car.wrecked) continue;
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
  return Math.abs(along) < sizeOf(car).halfL + pad && Math.abs(side) < sizeOf(car).halfW + pad;
}

export function resolveCarBox(pos, radius, car) {
  const S = sizeOf(car), reach = Math.max(S.halfL, S.halfW) * 1.42 + radius;
  const dx = pos.x - car.x, dz = pos.z - car.z;
  if (dx * dx + dz * dz > reach * reach) return false;
  const { along, side, fwdX, fwdZ, rightX, rightZ } = localOffset(pos.x, pos.z, car);
  const hl = sizeOf(car).halfL + radius;
  const hw = sizeOf(car).halfW + radius;
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
  const A = sizeOf(a), B = sizeOf(b);
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
 * The driven car with momentum and tyre grip. The throttle and brakes act along the nose
 * (as stepDrive); turning rotates the body with some inertia while the car keeps its
 * world velocity, so any part of it that now points sideways is slip, which the tyres
 * scrub off at a rate set by their grip. The handbrake locks the rear: little grip,
 * a faster turn and scrubbing speed, so the tail steps out into a drift.
 * state: { speed (along the nose), lat (sideways, +x of the car), yawRate, yaw }.
 */
export function stepGrip(state, { throttle, steer, handbrake = false, dt, sprint = false, spec = CAR, wet = 0 }) {
  // a wet road: the tyres bite less, so the car brakes longer and slides wider in a turn
  const S = wet > 0.01 ? { ...spec, brake: spec.brake * (1 - 0.35 * wet), accel: spec.accel * (1 - 0.15 * wet) } : spec;
  const scooter = S.kind === 'scooter';
  const lon = stepDrive({ speed: state.speed, yaw: state.yaw, throttle, steer: 0, dt, sprint, spec: S });
  let speed = lon.speed;
  if (handbrake) speed -= Math.sign(speed) * Math.min(Math.abs(speed), S.brake * 0.35 * dt);
  const grip = 1 / (1 + Math.abs(speed) * 0.055);
  let want = Math.abs(speed) < 0.25 ? 0 : steer * S.steer * grip * Math.sign(speed);
  if (handbrake && !scooter) want *= 1.35;
  let yawRate = state.yawRate || 0;
  yawRate += (want - yawRate) * (1 - Math.exp(-dt * (handbrake ? 3.5 : 10)));
  const yaw = wrap(state.yaw + yawRate * dt);
  // the world velocity carries over the turn: re-split it along the new heading
  const f0x = Math.sin(state.yaw), f0z = Math.cos(state.yaw);
  const vx = f0x * speed + f0z * (state.lat || 0), vz = f0z * speed - f0x * (state.lat || 0);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  speed = vx * fx + vz * fz;
  let lat = vx * fz - vz * fx;
  const hold = (handbrake ? 1.7 : scooter ? 14 : 7.5) * (1 - 0.45 * wet);
  const scrub = 1 - Math.exp(-dt * hold);
  speed -= Math.sign(speed) * Math.min(Math.abs(speed), Math.abs(lat) * scrub * 0.25); // sliding costs speed
  lat -= lat * scrub;
  return {
    speed, lat, yawRate, yaw,
    vx: fx * speed + fz * lat, vz: fz * speed - fx * lat,
    slip: Math.abs(lat),
  };
}

/**
 * Where a seated driver's hips go and where the steering wheel is, in world space
 * (a scooter rider stands instead).
 */
export function driverPose(car) {
  const S = specOf(car);
  if (S.kind === 'scooter' && S.astride) {
    // on a bike or a moped: seated astride, hands on the bars
    const o = localOffset(car.x, car.z, car), seat = seatOf(car), a = S.astride;
    return {
      hipY: car.y + a.hip, thigh: a.thigh, knee: a.knee,
      wheel: new THREE.Vector3(seat.x + o.fwdX * a.barZ, car.y + a.barY, seat.z + o.fwdZ * a.barZ),
    };
  }
  if (S.kind === 'scooter') return null; // a kick scooter rider stands
  const o = localOffset(car.x, car.z, car);
  const seat = seatOf(car);
  if (car.cockpit) {
    // the low modelled cabin: eye near cockpitEye, hands on its wheel rig
    const wx = S.seatX, wz = 0.14;
    return {
      hipY: car.y + 0.28,
      thigh: 1.5, knee: -0.4, // legs out long, sports-car style
      wheel: new THREE.Vector3(car.x + o.rightX * wx + o.fwdX * wz, car.y + 0.62, car.z + o.rightZ * wx + o.fwdZ * wz),
    };
  }
  return {
    hipY: car.y + 0.5,
    thigh: 1.45, knee: -1.3,
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
  { // broad phase: the ray against a sphere round the whole car
    const S = sizeOf(car);
    const r = Math.sqrt(S.halfL * S.halfL + S.halfW * S.halfW) + 1.2;
    const cx = car.x - origin.x, cy = car.y + 0.8 - origin.y, cz = car.z - origin.z;
    const t = THREE.MathUtils.clamp(cx * dir.x + cy * dir.y + cz * dir.z, 0, maxDist);
    const ex = cx - dir.x * t, ey = cy - dir.y * t, ez = cz - dir.z * t;
    if (ex * ex + ey * ey + ez * ez > r * r) return null;
  }
  const basis = localOffset(origin.x, origin.z, car);
  const o = { x: basis.side, y: origin.y - car.y, z: basis.along };
  const d = {
    x: dir.x * basis.rightX + dir.z * basis.rightZ,
    y: dir.y,
    z: dir.x * basis.fwdX + dir.z * basis.fwdZ,
  };
  let best = null;
  if (!opts.glassOnly) {
    for (const b of car.metalBoxes || (car.spec ? car.spec.metalBoxes : METAL_BOXES)) {
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
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x1c242c, metalness: 0, roughness: 0.04, ior: 1.52, envMapIntensity: 1.6,
      transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide,
    });
    // keep the scene depth the HDR target stores in alpha (engine/patch.js)
    glass.blending = THREE.CustomBlending;
    glass.blendSrcAlpha = THREE.ZeroFactor;
    glass.blendDstAlpha = THREE.OneFactor;
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
  const paint = ridePaint(color, 0.5, 0.4);
  const dark = rideMat('kick-dark', () => new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.3, roughness: 0.6 }));
  const grip = rideMat('kick-grip', () => new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0.1, roughness: 0.9 }));
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

// Materials shared by every two-wheeler of a look (the car batch draws one batch per material:
// a material each would be a draw call each). Paint is rounded to a small palette.
const rideMats = new Map();
function rideMat(key, make) {
  if (!rideMats.has(key)) rideMats.set(key, make());
  return rideMats.get(key);
}
function ridePaint(color, metalness, roughness) {
  const c = new THREE.Color(color);
  const q = (v) => Math.round(v * 7) / 7;
  c.setRGB(q(c.r), q(c.g), q(c.b));
  return rideMat(`paint-${c.getHexString()}-${metalness}-${roughness}`, () => new THREE.MeshStandardMaterial({ color: c, metalness, roughness }));
}

// A bicycle: a diamond frame in its paint, black tyres and saddle, bars on a fork that turns.
function makeBikeMesh(color) {
  const g = new THREE.Group();
  g.name = 'bike';
  const paint = ridePaint(color, 0.4, 0.45);
  const dark = rideMat('bike-dark', () => new THREE.MeshStandardMaterial({ color: 0x111112, metalness: 0.1, roughness: 0.85 }));
  const steel = rideMat('ride-steel', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 }));
  const add = (mesh, parent = g) => { mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  const tube = (a, b, r, mat, parent = g) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const m = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 8), mat), parent);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    return m;
  };
  const R = 0.33, zr = -0.52, zf = 0.55;
  const wheels = [];
  for (const z of [zr, zf]) {
    const w = add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.025, 8, 28).rotateY(Math.PI / 2), dark));
    w.position.set(0, R, z);
    tube([0, -R * 0.95, 0], [0, R * 0.95, 0], 0.006, steel, w); // spokes, two crossed
    tube([0, 0, -R * 0.95], [0, 0, R * 0.95], 0.006, steel, w);
    wheels.push(w);
  }
  // frame: seat tube, top tube, down tube, stays
  const bb = [0, 0.3, -0.05], seatTop = [0, 0.86, -0.2], head = [0, 0.86, 0.42], headLo = [0, 0.7, 0.45];
  tube(bb, seatTop, 0.02, paint); tube(seatTop, head, 0.018, paint); tube(bb, headLo, 0.022, paint);
  tube(bb, [0, R, zr], 0.014, paint); tube(seatTop, [0, R, zr], 0.012, paint);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.26), dark)).position.set(0, 0.92, -0.24); // saddle
  tube([0, 0.86, -0.2], [0, 0.9, -0.22], 0.014, steel);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 14).rotateZ(Math.PI / 2), steel)).position.set(0.05, 0.3, -0.05); // chainring
  const fork = new THREE.Group();
  fork.position.set(0, 0, 0.47);
  g.add(fork);
  tube([0, 0.86, -0.03], [0, R, zf - 0.47], 0.016, paint, fork);
  tube([0, 0.86, -0.03], [0, 1.02, 0.05], 0.016, steel, fork);
  tube([-0.27, 1.04, 0.07], [0.27, 1.04, 0.07], 0.013, steel, fork);
  for (const sx of [-1, 1]) tube([sx * 0.2, 1.04, 0.07], [sx * 0.28, 1.04, 0.07], 0.02, dark, fork);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.26), paint), fork).position.set(0, 0.86, 0.22); // the city bike's basket
  return { group: g, wheels, handle: fork };
}

// A moped: a Vespa-style city scooter. The rear cowl over the engine is a rounded side
// profile extruded across, the leg shield curves round the rider's shins, the headset
// carries a round lamp and the mirrors, and the front wheel sits in the steering fork
// under its mudguard; chrome exhaust down the right, a tail lamp and a plate behind.
// The geometry is made once and shared by every moped (the car batch keeps one copy).
const mopedGeo = new Map();
function mGeo(key, make) {
  if (!mopedGeo.has(key)) { const g = make(); g.userData.shared = true; mopedGeo.set(key, g); }
  return mopedGeo.get(key);
}
function sideProfile(points, width, bevel) {
  // points: [z, y] round the outline (smoothed), extruded across x and centred
  const sh = new THREE.Shape();
  const curve = new THREE.SplineCurve(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const pts = curve.getPoints(48);
  sh.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) sh.lineTo(p.x, p.y);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 12 });
  g.rotateY(-Math.PI / 2); // shape x -> world z, extruded along -x
  g.translate((width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}
function makeMopedMesh(color) {
  const g = new THREE.Group();
  g.name = 'moped';
  const c = new THREE.Color(color);
  const q = (v) => Math.round(v * 7) / 7;
  c.setRGB(q(c.r), q(c.g), q(c.b));
  const paint = rideMat(`moped-paint-${c.getHexString()}`, () => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.2, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }));
  const leather = rideMat('moped-seat', () => new THREE.MeshStandardMaterial({ color: 0x1a1613, roughness: 0.62, metalness: 0 }));
  const rubber = rideMat('moped-tyre', () => new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.9, metalness: 0 }));
  const chrome = rideMat('moped-chrome', () => new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.12, metalness: 1 }));
  const alloy = rideMat('moped-alloy', () => new THREE.MeshStandardMaterial({ color: 0x8a8f95, roughness: 0.35, metalness: 0.9 }));
  const black = rideMat('moped-black', () => new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.3 }));
  const lens = rideMat('moped-lens', () => new THREE.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 0.05, metalness: 0, emissive: 0xfff3d6, emissiveIntensity: 0.5 }));
  const red = rideMat('moped-tail', () => new THREE.MeshStandardMaterial({ color: 0x7a0c0c, roughness: 0.2, emissive: 0xff2010, emissiveIntensity: 0.5 }));
  const plate = rideMat('moped-plate', () => new THREE.MeshStandardMaterial({ color: 0xe8c21e, roughness: 0.5 }));
  const add = (geo, mat, parent = g) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const R = 0.2; // 12" wheels with their tyres

  // the rear cowl over the engine and the back wheel
  add(mGeo('cowl', () => sideProfile([[-0.98, 0.42], [-0.9, 0.66], [-0.6, 0.74], [-0.2, 0.7], [0.02, 0.6], [0.06, 0.4], [-0.12, 0.3], [-0.42, 0.34], [-0.62, 0.42], [-0.82, 0.36]], 0.5, 0.07)), paint);
  // floorboard and the tunnel to the leg shield
  add(mGeo('floor', () => new RoundedBoxGeometry(0.38, 0.06, 0.62, 3, 0.025)), black).position.set(0, 0.3, 0.28);
  add(mGeo('floorskirt', () => new RoundedBoxGeometry(0.42, 0.1, 0.66, 3, 0.04)), paint).position.set(0, 0.24, 0.27);
  // the leg shield: a front-view outline, curved by its bevel, leaning back
  const shield = add(mGeo('shield', () => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.24, 0); sh.lineTo(0.24, 0);
    sh.quadraticCurveTo(0.27, 0.32, 0.17, 0.56);
    sh.quadraticCurveTo(0, 0.66, -0.17, 0.56);
    sh.quadraticCurveTo(-0.27, 0.32, -0.24, 0);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 4, curveSegments: 16 });
    geo.computeVertexNormals();
    return geo;
  }), paint);
  shield.position.set(0, 0.3, 0.56);
  shield.rotation.x = -0.22;
  // seat: a long padded saddle with a chrome grab rail behind
  add(mGeo('seat', () => new RoundedBoxGeometry(0.32, 0.11, 0.72, 4, 0.05)), leather).position.set(0, 0.79, -0.4);
  add(mGeo('rail', () => new THREE.TorusGeometry(0.12, 0.012, 6, 16, Math.PI).rotateX(-Math.PI / 2)), chrome).position.set(0, 0.8, -0.78);
  // engine case and exhaust down the right
  add(mGeo('engine', () => new RoundedBoxGeometry(0.16, 0.2, 0.5, 3, 0.04)), alloy).position.set(-0.16, 0.25, -0.5);
  const tube = (a, b, r) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const geo = new THREE.CylinderGeometry(r, r, A.distanceTo(B), 12);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
    geo.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    return geo;
  };
  add(mGeo('pipe', () => tube([0.12, 0.2, -0.15], [0.2, 0.26, -0.55], 0.022)), chrome);
  add(mGeo('muffler', () => tube([0.21, 0.27, -0.5], [0.22, 0.33, -0.9], 0.055)), chrome);
  add(mGeo('mufflerEnd', () => new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12).rotateX(Math.PI / 2 + 0.15)), black).position.set(0.22, 0.335, -0.92);
  // tail lamp and plate
  add(mGeo('tail', () => new RoundedBoxGeometry(0.16, 0.06, 0.05, 2, 0.02)), red).position.set(0, 0.64, -1.0);
  add(mGeo('plate', () => new THREE.BoxGeometry(0.2, 0.12, 0.01)), plate).position.set(0, 0.5, -1.02);
  // kickstand
  add(mGeo('stand', () => tube([0.05, 0.22, -0.2], [0.18, 0.02, -0.32], 0.012)), black);

  const wheels = [];
  const wheel = (parent, z, front) => {
    const w = new THREE.Group();
    w.position.set(0, R, z);
    parent.add(w);
    add(mGeo('tyre', () => new THREE.TorusGeometry(R - 0.05, 0.05, 12, 32).rotateY(Math.PI / 2)), rubber, w);
    add(mGeo('rim', () => new THREE.CylinderGeometry(R - 0.07, R - 0.07, 0.07, 24).rotateZ(Math.PI / 2)), alloy, w);
    add(mGeo('hub', () => new THREE.CylinderGeometry(0.05, 0.05, 0.12, 14).rotateZ(Math.PI / 2)), chrome, w);
    if (front) add(mGeo('disc', () => new THREE.CylinderGeometry(0.1, 0.1, 0.008, 24).rotateZ(Math.PI / 2)), chrome, w).position.x = 0.05;
    wheels.push(w);
    return w;
  };
  wheel(g, -0.62, false);

  // the steering: fork, front wheel and its mudguard, the headset with lamp and mirrors
  const fork = new THREE.Group();
  fork.position.set(0, 0, 0.62);
  g.add(fork);
  wheel(fork, 0.08, true);
  add(mGeo('guard', () => new THREE.TorusGeometry(R + 0.03, 0.045, 8, 24, Math.PI * 0.9).rotateY(Math.PI / 2).rotateX(Math.PI * 0.05)), paint, fork).position.set(0, R, 0.08);
  add(mGeo('forkLeg', () => tube([0, 0.25, 0.06], [0, 0.95, -0.12], 0.03)), black, fork);
  add(mGeo('headset', () => new RoundedBoxGeometry(0.5, 0.12, 0.2, 4, 0.05)), paint, fork).position.set(0, 1.0, -0.12);
  add(mGeo('lamp', () => new THREE.CylinderGeometry(0.075, 0.08, 0.06, 20).rotateX(Math.PI / 2)), chrome, fork).position.set(0, 1.0, -0.01);
  add(mGeo('lens', () => new THREE.CircleGeometry(0.065, 20)), lens, fork).position.set(0, 1.0, 0.022);
  add(mGeo('bars', () => new THREE.CylinderGeometry(0.014, 0.014, 0.66, 8).rotateZ(Math.PI / 2)), chrome, fork).position.set(0, 1.01, -0.16);
  for (const sx of [-1, 1]) {
    add(mGeo('grip', () => new THREE.CylinderGeometry(0.02, 0.02, 0.11, 10).rotateZ(Math.PI / 2)), rubber, fork).position.set(sx * 0.3, 1.01, -0.16);
    add(mGeo('mirrorStalk', () => tube([0, 0, 0], [0.04, 0.2, 0.02], 0.007)), chrome, fork).position.set(sx * 0.2, 1.05, -0.16).x = sx * 0.2;
    const mirror = add(mGeo('mirror', () => new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16).rotateX(Math.PI / 2)), chrome, fork);
    mirror.position.set(sx * 0.24, 1.25, -0.14);
  }
  return { group: g, wheels, handle: fork };
}

// A two-wheeler of a kind and colour: built once, its fixed parts merged into a mesh per
// material (the wheels spin and the fork steers, so they stay apart), then cloned for each
// one parked (the clones share the geometry). Each part is an instance in the car batch:
// a moped of 32 loose parts was 32 instances, hundreds of them across the city.
const rideTemplates = new Map();
function rideMesh(kind, color) {
  const c = new THREE.Color(color);
  const q = (v) => Math.round(v * 7) / 7;
  const key = `${kind}-${q(c.r)}-${q(c.g)}-${q(c.b)}`;
  if (!rideTemplates.has(key)) {
    const t = kind === 'bike' ? makeBikeMesh(color) : kind === 'moped' ? makeMopedMesh(color) : makeScooterMesh(color);
    t.handle.name = 'ride-fork';
    t.wheels.forEach((w, i) => { w.name = `ride-wheel-${i}`; if (!w.isMesh) mergeStaticParts(w, []); }); // (a kick scooter's wheel is a mesh itself: left as it is)
    mergeStaticParts(t.handle, t.wheels.filter((w) => w.parent === t.handle).map((w) => w.name));
    mergeStaticParts(t.group, ['ride-fork', ...t.wheels.filter((w) => w.parent === t.group).map((w) => w.name)]);
    t.group.traverse((o) => { if (o.isMesh) { o.geometry.userData.shared = true; o.castShadow = o.receiveShadow = true; } });
    rideTemplates.set(key, { group: t.group, wheels: t.wheels.length });
  }
  const tpl = rideTemplates.get(key);
  const group = tpl.group.clone(true);
  const wheels = Array.from({ length: tpl.wheels }, (_, i) => group.getObjectByName(`ride-wheel-${i}`));
  return { group, wheels, handle: group.getObjectByName('ride-fork') };
}

export class Cars {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'cars';
    // it never moves: its own matrix isn't recomposed every frame (which would also make
    // every car under it recompute its world matrix, parked or not; see freeze)
    this.group.matrixAutoUpdate = false;
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
        hl: s.hl, hw: s.hw, // measured footprint (city cars)
        metalBoxes: s.metalBoxes || null,
        wheelRig: null,
        cluster: null,
        home: { x: s.x, z: s.z, yaw: s.yaw },
      };
      this.placeMesh(car);
      this.refreshSeat(car);
      this.group.add(car.mesh);
      this.list.push(car);
    });
    // city cars draw as one batch per material (see carBatch.js)
    if (this.list.length) this.batch = new CarBatch(this.group).build(this.list);
    return this.list;
  }

  /**
   * Rideable two-wheelers at {x, y, z, yaw}: kick scooters, or with kind 'bike' / 'moped'
   * (and their paint, color [r, g, b]) bicycles and mopeds. They take ids after the cars.
   */
  addScooters(spots) {
    const { terrain } = this.world;
    spots.forEach((s, n) => {
      const y = terrain.heightAt(s.x, s.z);
      const paint = s.color ? new THREE.Color(s.color[0] / 255, s.color[1] / 255, s.color[2] / 255) : SCOOTER_COLORS[n % SCOOTER_COLORS.length];
      const built = rideMesh(s.kind || 'kick', paint);
      const car = {
        id: this.list.length,
        kind: 'scooter', // two wheels: ridden in the open (see spec.ride for which)
        ride: s.kind || 'kick',
        spec: s.kind === 'bike' ? BIKE : s.kind === 'moped' ? MOPED : SCOOTER,
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
    // Replace the car batch. The first one was built before the scooters existed;
    // leaving it in the scene draws every car twice, and the spare stays put when you drive off.
    this.batch?.dispose();
    this.batch = this.list.length ? new CarBatch(this.group).build(this.list) : null;
    return this.list;
  }

  clear() {
    this.batch?.dispose();
    this.batch = null;
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
      car.windHits = 0;
      this.world.fx?.holes?.clearCar(car);
      car.holes = [];
      this.repair(car);
      this.placeMesh(car);
      this.refreshSeat(car);
    }
  }

  // As good as new for a new round: full health, no fire or smoke, the paint back from
  // charred, the dents knocked out (each part's undented body, drawn by the batch again).
  repair(car) {
    car.hp = hpMax(car);
    car.wrecked = false;
    car.burnT = 0;
    car.coolT = 0;
    car.fxT = 0;
    car.lastHitBy = null;
    car.slide = null;
    car.dentTotal = 0;
    car.ai = null;
    if (car.body) { car.body.p = car.body.pv = car.body.r = car.body.rv = 0; car.body.rest = false; }
    for (const p of car.batched || []) {
      if (p.paint) { p.batch.setColorAt(p.id, p.paint); p.paint = null; }
      if (p.baseMat) { p.mesh.material.dispose(); p.mesh.material = p.baseMat; p.baseMat = null; }
      if (p.base) {
        if (p.mesh.geometry !== p.base && !p.mesh.geometry.userData.shared) p.mesh.geometry.dispose();
        p.mesh.geometry = p.base;
        p.base = null;
      }
      if (p.own) {
        p.own = false;
        p.mesh.visible = false;
        p.batch.setVisibleAt(p.id, p.want !== false && p.near !== false);
      }
    }
    for (const p of car.ownParts || []) {
      if (p.base) { if (p.mesh.geometry !== p.base) p.mesh.geometry.dispose(); p.mesh.geometry = p.base; p.base = null; }
    }
    if (!car.batched) car.mesh.traverse((o) => {
      if (o.userData.baseMat) { o.material.dispose(); o.material = o.userData.baseMat; o.userData.baseMat = null; }
    });
  }

  byId(id) {
    return this.list.find((c) => c.id === id) || null;
  }

  refreshSeat(car) {
    const s = seatOf(car);
    car.seat.set(s.x, s.y, s.z);
  }

  // A parked car that has settled doesn't change: its parts stop recomposing their matrices
  // every frame until something moves it again (placeMesh thaws it).
  freeze(car, on) {
    if (!!car.frozen === on || !car.mesh) return;
    if (on) car.mesh.updateMatrixWorld(true);
    car.frozen = on;
    car.mesh.traverse((o) => { o.matrixAutoUpdate = !on; });
  }

  placeMesh(car) {
    if (car.frozen) this.freeze(car, false);
    car.dirty = true; // the batch copies this car's transform on the next sync
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
    const L = sizeOf(car).halfL * 0.8, W = sizeOf(car).halfW * 0.8;
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
    car.dirty = true;
    // settled: a parked car stops being simulated until it is driven, shoved or synced
    b.rest = !car.driver && Math.abs(car.speed) < 0.05 && Math.abs(b.pv) + Math.abs(b.rv) < 0.003
      && Math.abs(b.p - pitchGoal) + Math.abs(b.r - rollGoal) < 0.003;
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
    player.enterFrom = player.pos.clone(); // the body slides from here into the seat
    player.enterT = 0;
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
    if (car) { car.lat = 0; car.yawRate = 0; car.slip = 0; car.handbrake = false; car.wheelsAt = null; }
    if (!car) return;
    if (car.driver === player.fighter) car.driver = null;
    player.vehicle = null;
    player._carYaw = undefined;
    if (player.character?.root) player.character.root.visible = true;
    const at = this.exitSpot(car);
    const y = this.world.terrain.heightAt(at.x, at.z);
    player.exitFrom = player.pos.clone(); // the seat: the body slides out to the door
    player.exitT = 0;
    player.pos.set(at.x, y, at.z);
    player.vel.set(0, 0, 0);
    player.yaw = car.yaw;
    this.refreshSeat(car);
  }

  // Where the driver gets out: the driver's door, else the other, behind, in front, a
  // step further out each round. A spot is taken when a walker stands there free (no wall,
  // tree or other car pushes it), on ground near the car's, and nothing solid lies between
  // it and the seat (a car parked against a wall would put you in or through it).
  exitSpot(car) {
    const w = this.world, cols = w.veg?.colliders, y0 = w.terrain.heightAt(car.x, car.z);
    const s = sizeOf(car), o = localOffset(car.x, car.z, car);
    const p = new THREE.Vector3(), from = new THREE.Vector3(car.x, y0 + 1.1, car.z), dir = new THREE.Vector3();
    const free = (x, z) => {
      const y = w.terrain.heightAt(x, z);
      if (!Number.isFinite(y) || Math.abs(y - y0) > 0.9) return null;
      // a post or a tree may nudge the spot aside; still pushed after that, it's inside something
      p.set(x, y, z);
      cols?.resolveXZ(p, 0.32, y, y + 1.7);
      this.collideWalker(p, 0.32, null);
      if (Math.hypot(p.x - x, p.z - z) > 0.6) return null;
      x = p.x; z = p.z;
      cols?.resolveXZ(p, 0.32, y, y + 1.7);
      this.collideWalker(p, 0.32, null);
      if (Math.hypot(p.x - x, p.z - z) > 0.03) return null;
      dir.set(x - car.x, 0, z - car.z);
      const dist = dir.length();
      dir.divideScalar(dist || 1);
      // the city's own triangles and solid colliders (not cars or people)
      if (w.shots?.raycast(from, dir, dist + 0.3) || cols?.raycast(from, dir, dist + 0.3)) return null;
      return { x, z };
    };
    for (const out of [0.85, 1.4, 2.2]) {
      const lat = s.halfW + out, lon = s.halfL + out;
      const seat = specOf(car).seatZ;
      for (const [r, f] of [[lat, seat], [-lat, seat], [0, -lon], [0, lon]]) {
        const x = car.x + o.rightX * r + o.fwdX * f, z = car.z + o.rightZ * r + o.fwdZ * f;
        const at = free(x, z);
        if (at) return at;
      }
    }
    return exitOf(car, 1);
  }

  applySnap(id, snap, driver) {
    const car = this.byId(id);
    if (!car) return;
    if (car.body) car.body.rest = false;
    if (Number.isFinite(snap.hp) && !car.wrecked) {
      car.hp = Math.min(car.hp ?? hpMax(car), snap.hp);
      if (car.hp <= 0 && !(car.burnT > 0)) car.burnT = 1 + Math.random();
    }
    if (snap.a === 'hp') return;
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
    const t = hit?.t || 0.6;
    const at = new THREE.Vector3(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t);
    const n = hit?.normal
      ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
      : dir.clone().negate();
    // the windscreen is laminated: rounds star it with cracks and go through; it only
    // gives way after a few (side and rear windows are toughened and burst at once)
    if (pane === 'wind' && !opts.force && opts.shot && car.windShot === opts.shot) return false; // its other face
    if (pane === 'wind' && !opts.force && opts.shot) car.windShot = opts.shot;
    if (pane === 'wind' && !opts.force && (car.windHits = (car.windHits || 0) + 1) < 4) {
      this.world.fx?.holes?.addToCar(car, at, n.dot(dir) > 0 ? n.clone().negate() : n, 'glass', 0.32, 0.045); // facing the shooter, on the outer face
      this.world.fx?.impact?.(at, n, 'glass', dir);
      this.world.audio?.impact?.('glass', at.distanceTo(this.world.player?.camera?.position || at));
      return false;
    }
    if (pane === 'wind') this.world.fx?.holes?.clearCar(car, 'glass');
    this.applyGlass(car, glassMaskAfterHit(car.glass || 0, pane));
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
    opts = { ...opts, shot: {} }; // one round: a windscreen it crosses cracks once
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
      if (car === ignore || Math.abs(car.x - pos.x) > 4 || Math.abs(car.z - pos.z) > 4) continue;
      resolveCarBox(pos, radius, car);
    }
  }

  updatePrompt(player) {
    if (!player || this.list.length === 0 || !player.fighter?.alive) {
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
      local.handbrake = !!input.fire; // Space: the fire button does nothing at the wheel
      const stepped = stepGrip(local, {
        throttle: THREE.MathUtils.clamp(f, -1, 1),
        steer: local.steer,
        handbrake: local.handbrake,
        dt,
        sprint: !!input.sprint,
        spec: specOf(local),
        wet: this.world.weather?.amount || 0,
      });
      local.speed = stepped.speed;
      local.lat = stepped.lat;
      local.yawRate = stepped.yawRate;
      local.slip = stepped.slip;
      local.yaw = stepped.yaw;
      this.tyres(local, dt, f);
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
      const living = car.driver?.alive;
      if (car.ai && living && !car.driver.isPlayer && !car.remote) {
        // a rival at the wheel: same grip physics as the player's car
        const stepped = stepGrip(car, { throttle: car.ai.throttle, steer: car.ai.steer, handbrake: car.ai.handbrake, dt, spec: specOf(car), wet: this.world.weather?.amount || 0 });
        Object.assign(car, { speed: stepped.speed, lat: stepped.lat, yawRate: stepped.yawRate, slip: stepped.slip, yaw: stepped.yaw });
        car.steer = car.ai.steer;
        car.x += stepped.vx * dt;
        car.z += stepped.vz * dt;
        car.vel.set(stepped.vx, 0, stepped.vz);
        this.groundCar(car);
        this.bumpWorld(car);
        this.bumpCars(car);
        this.refreshSeat(car);
        this.placeMesh(car);
      } else if (car.driver?.isPlayer && living) {
        // stepped above, while the local driver is alive
      } else if (!car.remote && !living && Math.abs(car.speed) > 0.05) {
        // Dead driver, or nobody at the wheel: keep the momentum and roll to a stop.
        // A body left in the seat rides along (the driver is not cleared on death).
        const stepped = stepGrip(car, {
          throttle: 0, steer: 0, handbrake: false, dt, spec: specOf(car), wet: this.world.weather?.amount || 0,
        });
        Object.assign(car, { speed: stepped.speed, lat: stepped.lat, yawRate: stepped.yawRate, slip: stepped.slip, yaw: stepped.yaw });
        car.steer = 0;
        car.x += stepped.vx * dt;
        car.z += stepped.vz * dt;
        car.vel.set(stepped.vx, 0, stepped.vz);
        this.groundCar(car);
        this.bumpWorld(car);
        this.bumpCars(car);
        this.refreshSeat(car);
        this.placeMesh(car);
      } else if (!car.driver?.isPlayer) {
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
        } else if (!car.driver && car.slide && (Math.abs(car.slide.x) + Math.abs(car.slide.z) > 0.03 || Math.abs(car.slide.spin) > 0.02)) {
          this.slideFree(car, dt);
        } else if (!car.driver && car.body?.rest && !(car.hp < hpMax(car) * 0.6)) {
          this.freeze(car, true);
          continue; // parked and settled on its springs: nothing to do until something moves it
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
      this.spray(car, dt);
      if (car.hp < hpMax(car) * 0.6 || car.wrecked) this.updateDamage(car, dt);
      car.lights.emissiveIntensity = car.driver ? 1.15 : 0.45;
      car.tails.emissiveIntensity = car.speed < -0.4 || (car.driver?.isPlayer && input?.back) ? 1.2 : 0.4;
    }

    if (player && this.batch) this.batch.cull(player.pos.x, player.pos.z);
    this.batch?.sync();
    if (player) this.updatePrompt(player);
    this.engineSounds(local, input);
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

  // The body against walls, railings, posts and parked obstacles: a row of circles from
  // bumper to bumper (one circle round the middle let the nose and tail through). Only the
  // speed going into the obstacle is lost, so a glancing scrape keeps you moving.
  bumpWorld(car) {
    const cols = this.world.veg?.colliders;
    if (!cols) return;
    const S = specOf(car);
    const size = sizeOf(car);
    const r = car.spec ? S.collideR : size.halfW * 0.95;
    const reach = Math.max(0, size.halfL - r);
    const offs = reach > 0.05 ? [-reach, 0, reach] : [0];
    let pushX = 0, pushZ = 0, contactOff = 0;
    for (let pass = 0; pass < 2; pass++) {
      const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
      let moved = false;
      for (const off of offs) {
        const c = { x: car.x + fx * off, y: car.y, z: car.z + fz * off };
        const x0 = c.x, z0 = c.z;
        cols.resolveXZ(c, r, car.y + 0.15, car.y + 1.25);
        const dx = c.x - x0, dz = c.z - z0;
        if (dx * dx + dz * dz < 1e-8) continue;
        if (pass === 0) contactOff = off;
        car.x += dx; car.z += dz;
        pushX += dx; pushZ += dz;
        moved = true;
      }
      if (!moved) break;
    }
    const len = Math.hypot(pushX, pushZ);
    if (len < 1e-4) return;
    const nx = pushX / len, nz = pushZ / len;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const into = -(fx * nx + fz * nz) * Math.sign(car.speed || 1); // 1 = head-on
    if (into > 0) {
      const hard = Math.abs(car.speed) * into;
      car.speed *= Math.max(0.15, 1 - into * 0.9);
      if (hard > 4 && car.driver?.isPlayer) {
        this.world.audio?.impact?.('metal', 0);
        this.world.player?.kick?.(0, Math.min(3, hard * 0.2));
      }
      if (hard > 7) this.damage(car, (hard - 7) * 3, car.driver);
      // the body gives where it struck: on the circle that hit, opposite the push
      if (hard > 4) {
        const at = new THREE.Vector3(car.x + fx * contactOff - nx * r, car.y + 0.6, car.z + fz * contactOff - nz * r);
        dentCar(car, at, new THREE.Vector3(nx, 0, nz), Math.min(0.2, (hard - 4) * 0.025), 0.55 + hard * 0.02);
      }
    }
    car.vel.set(fx * car.speed, 0, fz * car.speed);
  }

  // Vehicles are solid to each other: push out of any overlap and lose the speed
  // going into it (a glancing hit scrapes along, a head-on one stops dead).
  bumpCars(car) {
    for (const other of this.list) {
      if (other === car) continue;
      if (Math.abs(other.x - car.x) > 7 || Math.abs(other.z - car.z) > 7) continue; // nowhere near: no box test
      const hit = carPush(car, other);
      if (!hit) continue;
      car.x += hit.nx * hit.depth;
      car.z += hit.nz * hit.depth;
      const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
      const vx = fx * car.speed, vz = fz * car.speed;
      const into = vx * hit.nx + vz * hit.nz;
      if (into < 0) {
        // an empty car or scooter takes a share of the momentum and slides off, spinning
        // by how far off its middle it was struck; the rammer keeps the rest
        const free = !other.driver;
        const share = free ? (other.spec ? 0.8 : 0.45) : 0;
        if (free) {
          const J = -into * share * 1.2;
          const s = other.slide || (other.slide = { x: 0, z: 0, spin: 0 });
          s.x -= hit.nx * J;
          s.z -= hit.nz * J;
          // lever arm: from the struck car's middle to the contact, across the push
          const cx = car.x - hit.nx * sizeOf(car).halfW - other.x, cz = car.z - hit.nz * sizeOf(car).halfW - other.z;
          s.spin += THREE.MathUtils.clamp((cx * -hit.nz - cz * -hit.nx) * J * 0.25, -2.5, 2.5);
          other.shoved = car.driver?.isPlayer ? 1.5 : 0; // seconds to keep telling the room
        }
        const rx = vx - hit.nx * into * (1.25 - share), rz = vz - hit.nz * into * (1.25 - share);
        car.speed = (rx * fx + rz * fz) * (0.8 + share * 0.25);
        car.vel.set(fx * car.speed, 0, fz * car.speed);
        if (-into > 2.5 && car.driver?.isPlayer) {
          this.world.audio?.impact?.('metal', 0);
          this.world.player?.kick?.(0, Math.min(3, -into * 0.25));
        }
        if (-into > 3.5) { // both bodies give at the contact
          const S = sizeOf(car), along = Math.abs(fx * hit.nx + fz * hit.nz);
          const ext = along * S.halfL + (1 - along) * S.halfW; // centre to the struck face
          const at = new THREE.Vector3(car.x - hit.nx * ext, car.y + 0.6, car.z - hit.nz * ext);
          const depth = Math.min(0.2, (-into - 3.5) * 0.022), rad = 0.55 - into * 0.02;
          dentCar(car, at, new THREE.Vector3(hit.nx, 0, hit.nz), depth, rad);
          dentCar(other, at, new THREE.Vector3(-hit.nx, 0, -hit.nz), depth, rad);
        }
        if (-into > 6) { // a hard crash hurts both
          const dmg = (-into - 6) * 3;
          this.damage(car, dmg, car.driver);
          this.damage(other, dmg, car.driver);
        }
      }
    }
  }

  // Skidding tyres: rubber on the road and smoke, from the rear wheels when the car slides,
  // and from all four under hard braking at speed.
  tyres(car, dt, throttle) {
    const marks = this.world.fx?.skids;
    const size = sizeOf(car);
    const sliding = (car.slip || 0) > 1.6 || (car.handbrake && Math.abs(car.speed) > 3);
    const braking = throttle < -0.5 && car.speed > 7;
    const o = localOffset(car.x, car.z, car);
    const wheels = car.wheelsAt || (car.wheelsAt = [null, null, null, null]);
    [[-1, 1], [-1, -1], [1, 1], [1, -1]].forEach(([fb, side], i) => {
      const on = car.spec ? (sliding || braking) && i === 0 : sliding ? fb < 0 : braking;
      if (!on || !marks) { wheels[i] = null; return; }
      const along = fb * size.halfL * 0.68, across = side * size.halfW * 0.82;
      const x = car.x + o.fwdX * along + o.rightX * across, z = car.z + o.fwdZ * along + o.rightZ * across;
      const p = new THREE.Vector3(x, this.world.terrain.heightAt(x, z), z);
      if (wheels[i]) marks.lay(wheels[i], p, car.spec ? 0.08 : 0.21, Math.min(1, (car.slip || 3) / 4));
      wheels[i] = p;
      if (Math.random() < dt * 14 && this.world.fx?.alpha) {
        this.world.fx.alpha.spawn({
          pos: p.clone().setY(p.y + 0.15), vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8),
          size: 0.4, grow: 2.2, life: 1.4, color: [0.75, 0.75, 0.75], alpha: 0.28, drag: 1.2, gravity: -0.1,
        });
      }
    });
    // the brakes and tyres of the car you drive, as one continuous voice
    if (car.driver?.isPlayer) {
      const v = Math.abs(car.speed);
      const brake = car.speed > 0.5 ? Math.max(0, -throttle) : car.speed < -0.5 ? Math.max(0, throttle) : 0;
      const skid = sliding ? Math.min(1, Math.max(0, ((car.slip || 0) - 1.2) / 4) + (car.handbrake ? 0.45 : 0)) : 0;
      this.world.audio?.brakes?.({ on: true, speed: v, brake: Math.min(1, brake), skid, small: !!car.spec });
    }
  }

  // On a wet road the tyres throw up water: a fine mist rolling off behind the rear wheels and
  // droplets arcing out of the tread, more the faster the car goes.
  spray(car, dt) {
    const wet = this.world.weather?.amount || 0, fx = this.world.fx;
    const v = Math.abs(car.speed);
    if (wet < 0.3 || v < 3 || !fx?.alpha || car.spec) return;
    const size = sizeOf(car), o = localOffset(car.x, car.z, car), back = -Math.sign(car.speed);
    const k = wet * Math.min(1, v / 20);
    for (const side of [-1, 1]) {
      if (Math.random() > dt * 40 * k) continue;
      const along = back * size.halfL * 0.68, across = side * size.halfW * 0.82;
      const x = car.x + o.fwdX * along + o.rightX * across, z = car.z + o.fwdZ * along + o.rightZ * across;
      const y = this.world.terrain.heightAt(x, z) + 0.12;
      const bx = o.fwdX * back, bz = o.fwdZ * back;
      fx.alpha.spawn({
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(car.vel.x * 0.55 + bx * 2 + (Math.random() - 0.5), 0.5 + Math.random() * 0.6, car.vel.z * 0.55 + bz * 2 + (Math.random() - 0.5)),
        size: 0.3, grow: 2.6, life: 0.7 + Math.random() * 0.4, color: [0.72, 0.75, 0.78], alpha: 0.16 * k + 0.04, drag: 2.5,
      });
      fx.alpha.spawn({
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(car.vel.x * 0.4 + bx * 3 + o.rightX * side * 1.2, 1.5 + Math.random() * 1.5, car.vel.z * 0.4 + bz * 3 + o.rightZ * side * 1.2),
        size: 0.014, life: 0.45, color: [0.8, 0.84, 0.88], alpha: 0.7, gravity: 9.8,
      });
    }
  }

  // Engines: the car you drive, and the nearest other car moving under power.
  engineSounds(local, input) {
    const audio = this.world.audio;
    if (!audio?.engine) return;
    if (local && !local.wrecked && local.ride !== 'bike') { // (a bicycle makes no engine noise)
      const S = specOf(local);
      const f = (input?.forward ? 1 : 0) - (input?.back ? 1 : 0) + (input?.moveY || 0);
      audio.engine(0, { on: true, speed: local.speed, max: S.maxSpeed, throttle: f * Math.sign(local.speed || 1), scooter: !!local.spec, moped: local.ride === 'moped', dist: 0 });
    } else audio.engine(0, { on: false });
    if (!local || local.wrecked) audio.brakes?.({ on: false });
    const cam = this.world.player?.camera;
    let near = null, nd = 60;
    for (const car of this.list) {
      if (car === local || !car.driver || car.wrecked || Math.abs(car.speed) < 0.5 || !cam || car.ride === 'bike') continue;
      const d = Math.hypot(car.x - cam.position.x, car.z - cam.position.z);
      if (d < nd) { nd = d; near = car; }
    }
    if (near) {
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const to = new THREE.Vector3(near.x - cam.position.x, 0, near.z - cam.position.z).normalize();
      audio.engine(1, { on: true, speed: near.speed, max: specOf(near).maxSpeed, throttle: near.ai?.throttle ?? 0.6, scooter: !!near.spec, moped: near.ride === 'moped', dist: nd, pan: to.dot(right) * 0.8 });
    } else audio.engine(1, { on: false });
  }

  // ---- damage: smoke, fire, explosion, wreck ---------------------------------------

  /** Wears a car down; at zero it catches fire and blows a few seconds later. */
  damage(car, amount, attacker = null, { silent = false } = {}) {
    if (!car || car.wrecked || !(amount > 0)) return;
    if (car.hp === undefined) car.hp = hpMax(car);
    car.hp = Math.max(0, car.hp - amount);
    if (attacker) car.lastHitBy = attacker;
    if (car.body) car.body.rest = false;
    if (car.hp <= 0 && !(car.burnT > 0)) car.burnT = car.spec ? 1.2 : 3.5 + Math.random() * 1.5;
    if (!silent && attacker?.isPlayer) this.world.session?.reportCar?.('hp', { i: car.id, hp: Math.round(car.hp) });
  }

  // Smoke from the engine bay as a car weakens, then flames, then the blast.
  updateDamage(car, dt) {
    const fx = this.world.fx;
    const max = hpMax(car), frac = (car.hp ?? max) / max;
    const fwd = localOffset(car.x, car.z, car);
    const front = car.spec ? 0 : sizeOf(car).halfL * 0.72;
    const at = new THREE.Vector3(car.x + fwd.fwdX * front, car.y + (car.spec ? 0.4 : 0.85), car.z + fwd.fwdZ * front);
    car.fxT = (car.fxT || 0) - dt;
    if (fx?.alpha && car.fxT <= 0) {
      const burning = car.burnT > 0 || car.wrecked;
      car.fxT = car.wrecked ? 0.18 : burning ? 0.035 : frac < 0.3 ? 0.06 : 0.12;
      const dark = frac < 0.3 || burning;
      fx.alpha.spawn({
        pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4).add(car.vel.clone().multiplyScalar(0.3)),
        size: dark ? 0.5 : 0.35, grow: dark ? 2.6 : 1.8, life: dark ? 2.6 : 1.6,
        color: dark ? [0.06, 0.06, 0.06] : [0.7, 0.7, 0.7], alpha: dark ? 0.55 : 0.32, drag: 0.6, gravity: -0.25,
      });
      if (burning && fx.add && !car.wrecked) {
        for (let i = 0; i < 2; i++) {
          fx.add.spawn({
            pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, Math.random() * 0.2, (Math.random() - 0.5) * 0.7)),
            vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.6 + Math.random() * 1.5, (Math.random() - 0.5) * 0.5),
            size: 0.28 + Math.random() * 0.3, grow: 0.6, life: 0.35 + Math.random() * 0.3, color: [70, 26, 5], drag: 1.5, gravity: -1,
          });
        }
      }
    }
    // heat haze over the fire, and over a burnt-out shell while it cools
    const haze = this.world.haze;
    if (haze) {
      if (car.burnT > 0) { haze.add(at, car.spec ? 0.9 : 1.7, 3.2, 1); this.world.fx?.fire?.(at, car.spec ? 0.6 : 1); }
      else if (car.wrecked) {
        car.coolT = (car.coolT || 0) + dt;
        if (car.coolT < 40) haze.add(new THREE.Vector3(car.x, car.y + 0.9, car.z), 2.2, 3.5, 0.9 * (1 - car.coolT / 40));
      }
    }
    if (car.burnT > 0) {
      car.burnT -= dt;
      if (car.burnT <= 0) this.wreck(car);
    }
  }

  wreck(car) {
    if (car.wrecked) return;
    car.wrecked = true;
    car.hp = 0;
    car.burnT = 0;
    car.speed = 0;
    car.vel.set(0, 0, 0);
    const pos = new THREE.Vector3(car.x, car.y + 0.7, car.z);
    const { world } = this;
    if (car.driver?.isPlayer) this.ejectLocal(car.driver);
    world.fx?.explosion(pos, 'ground');
    if (!car.spec) world.fx?.panels?.burst(car, sizeOf); // bonnet, doors and boot blown off
    const cam = world.player?.camera?.position;
    world.audio?.explosion?.(cam ? cam.distanceTo(pos) : 10, 0, false);
    if (car.body) { car.body.rest = false; car.body.pv -= car.spec ? 0 : 2.5; car.body.rv += (Math.random() - 0.5) * 2; }
    this.applyGlass(car, 63);
    world.fx?.holes?.clearCar(car, 'glass');
    // charred: every part of it in the batch turns near black
    const char = new THREE.Color(0.1, 0.09, 0.085);
    for (const p of car.batched || []) {
      // (the paint before is kept for a new round, see reset)
      if (!p.paint) p.paint = p.batch.colorsTexture ? p.batch.getColorAt(p.id, new THREE.Color()) : new THREE.Color(1, 1, 1);
      p.batch.setColorAt(p.id, char);
      if (p.own) { p.baseMat = p.baseMat || p.mesh.material; p.mesh.material = p.mesh.material.clone(); p.mesh.material.color.multiply(char); } // dented: drawn on its own
    }
    if (!car.batched) car.mesh.traverse((o) => { if (o.isMesh && o.material?.color) { o.userData.baseMat = o.userData.baseMat || o.material; o.material = o.material.clone(); o.material.color.multiplyScalar(0.12); } });
    world.combat?.explode(world, pos, car.spec ? 4 : 7.5, car.spec ? 60 : 110, car.lastHitBy || null, { weapon: 'car' });
  }

  // An explosion: empty cars and scooters nearby are thrown away from it and spun, and
  // the windows facing the blast shatter. Every client runs grenades itself, so only the
  // thrower's client (report) tells the room about the slides.
  blast(pos, radius, { report = false } = {}) {
    for (const car of this.list) {
      const dx = car.x - pos.x, dz = car.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > radius || Math.abs(car.y - pos.y) > 4) continue;
      const k = Math.pow(1 - d / radius, 1.3);
      if (d > 0.5) this.damage(car, 95 * k, null, { silent: true }); // chain reactions too
      if (!car.driver) {
        const push = (car.spec ? 11 : 4.5) * k;
        const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
        const s = car.slide || (car.slide = { x: 0, z: 0, spin: 0 });
        s.x += nx * push; s.z += nz * push;
        s.spin += (Math.random() - 0.5) * 2.4 * k;
        if (car.body) { car.body.rest = false; car.body.pv -= 0.8 * k; } // the body bucks
        car.shoved = report ? 1.5 : 0;
      }
      if (k > 0.25 && car.panes) {
        for (const name of PANES) {
          if (!car.panes[name] || !glassIntact(car.glass || 0, name)) continue;
          const from = new THREE.Vector3(pos.x, pos.y + 0.5, pos.z);
          const dir = new THREE.Vector3(car.x - pos.x, 0.1, car.z - pos.z).normalize();
          this.breakGlass(car, name, from, dir, { t: Math.max(0.5, d - 1) }, { silent: !report, force: true });
        }
      }
    }
  }

  // A shoved car slides and turns until its tyres scrub the motion off.
  slideFree(car, dt) {
    const s = car.slide;
    car.x += s.x * dt;
    car.z += s.z * dt;
    car.yaw += s.spin * dt;
    const scrub = Math.exp(-dt * (car.spec ? 2.5 : 3.8));
    s.x *= scrub; s.z *= scrub; s.spin *= Math.exp(-dt * 3.2);
    this.groundCar(car);
    const x0 = car.x, z0 = car.z;
    this.bumpWorld(car);
    if (Math.abs(car.x - x0) + Math.abs(car.z - z0) > 1e-4) { s.x *= 0.3; s.z *= 0.3; s.spin *= 0.5; }
    this.bumpCars(car);
    this.refreshSeat(car);
    this.placeMesh(car);
    if (car.shoved > 0) {
      car.shoved -= dt;
      this.shoveSync = (this.shoveSync || 0) + dt;
      if (this.shoveSync > 0.1 || car.shoved <= 0) {
        this.shoveSync = 0;
        this.world.session?.reportCar?.('shove', { ...this.pack(car), spd: 0 });
      }
    }
  }

  squash(combat) {
    const now = combat.time;
    // bodies in the road get shoved along by a moving car
    for (const f of combat.fighters) {
      const rd = !f.alive && f.character?.ragdoll;
      if (!rd) continue;
      const at = f.character.bones.Hips.getWorldPosition(new THREE.Vector3());
      for (const car of this.list) {
        // one lying on a car that moves off wakes up, so it slides off instead of floating
        if (Math.abs(car.speed) > 0.3 && at.y - car.y > 0.7 && carOverlap(at.x, at.z, car.y, car, 0.2)) rd.sleep = 0;
        if (Math.abs(car.speed) < 2 || !carOverlap(at.x, at.z, at.y, car, 0.3)) continue;
        rd.kick(at, car.vel.clone().multiplyScalar(0.9).setY(Math.abs(car.speed) * 0.15));
      }
    }
    const session = this.world.session;
    for (const car of this.list) {
      if (Math.abs(car.speed) < 0.5) continue; // standing still runs nobody over
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
      const back = -sizeOf(car).halfL * 0.7;
      const o = localOffset(car.x, car.z, car);
      fx.alpha.spawn({
        pos: new THREE.Vector3(car.x + o.fwdX * back, car.y + 0.12, car.z + o.fwdZ * back),
        vel: new THREE.Vector3(-o.fwdX * 1.2, 0.4, -o.fwdZ * 1.2),
        size: 0.35, grow: 1.1, life: 0.55, color: [0.28, 0.26, 0.22], alpha: 0.28, drag: 1.4, gravity: -0.1,
      });
    }
  }
}
