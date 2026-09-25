import * as THREE from 'three';
import { cityCell } from '../world/cityLayout.js';
import { HALF_WORLD } from '../world/constants.js';

export const CAR = {
  count: 8,
  halfL: 2.15,
  halfW: 0.92,
  height: 1.42,
  enterR: 2.75,
  seatX: -0.38,
  seatY: 0.58,
  seatZ: 0.12,
  maxSpeed: 24,
  boostSpeed: 30,
  reverse: 8.5,
  accel: 13,
  brake: 22,
  coast: 5.5,
  steer: 2.05,
  killSpeed: 5.8,
  collideR: 1.08,
  eyeY: 0.64,
  eyeZ: 0.18,
};

export const PANES = ['wind', 'rear', 'leftF', 'rightF', 'leftR', 'rightR'];

export const PANE_BOXES = {
  wind: { x0: -0.70, x1: 0.70, y0: 0.90, y1: 1.36, z0: 0.56, z1: 0.70 },
  rear: { x0: -0.70, x1: 0.70, y0: 0.90, y1: 1.36, z0: -1.20, z1: -1.06 },
  leftF: { x0: -0.92, x1: -0.86, y0: 0.88, y1: 1.32, z0: -0.30, z1: 0.50 },
  rightF: { x0: 0.86, x1: 0.92, y0: 0.88, y1: 1.32, z0: -0.30, z1: 0.50 },
  leftR: { x0: -0.92, x1: -0.86, y0: 0.88, y1: 1.32, z0: -1.04, z1: -0.36 },
  rightR: { x0: 0.86, x1: 0.92, y0: 0.88, y1: 1.32, z0: -1.04, z1: -0.36 },
};

export const METAL_BOXES = [
  { x0: -0.90, x1: 0.90, y0: 0.20, y1: 0.78, z0: -2.12, z1: 2.12 },
  { x0: -0.86, x1: 0.86, y0: 0.74, y1: 0.90, z0: 0.72, z1: 2.10 },
  { x0: -0.86, x1: 0.86, y0: 0.74, y1: 0.90, z0: -2.08, z1: -1.18 },
  { x0: -0.70, x1: 0.70, y0: 1.36, y1: 1.48, z0: -1.05, z1: 0.52 },
  { x0: -0.88, x1: -0.70, y0: 0.80, y1: 1.42, z0: 0.48, z1: 0.70 },
  { x0: 0.70, x1: 0.88, y0: 0.80, y1: 1.42, z0: 0.48, z1: 0.70 },
  { x0: -0.88, x1: -0.70, y0: 0.80, y1: 1.42, z0: -0.40, z1: -0.22 },
  { x0: 0.70, x1: 0.88, y0: 0.80, y1: 1.42, z0: -0.40, z1: -0.22 },
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

const COLORS = [0xc23b2c, 0x1c2a3a, 0xd8d2c4, 0x2f4a32, 0x8a6a28, 0x1a1c1e, 0x3a5e78, 0x5a4036];

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

function shade(mat) {
  mat.roughness = mat.roughness ?? 0.42;
  mat.metalness = mat.metalness ?? 0.45;
  return mat;
}

function boxMesh(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
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
  ctx.fillText(String(Math.max(0, Math.round(Math.abs(speed) * 3.6))), 128, 52);
  ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = on ? '#8a9098' : '#2e3338';
  ctx.fillText('km/h', 128, 100);
  tex.needsUpdate = true;
}

function makeCarMesh(color) {
  const g = new THREE.Group();
  g.name = 'car';
  const paint = shade(new THREE.MeshStandardMaterial({ color, metalness: 0.58, roughness: 0.34 }));
  const dark = shade(new THREE.MeshStandardMaterial({ color: 0x121416, metalness: 0.28, roughness: 0.7 }));
  const cabin = shade(new THREE.MeshStandardMaterial({ color: 0x1a1c1f, metalness: 0.2, roughness: 0.62 }));
  const chrome = shade(new THREE.MeshStandardMaterial({ color: 0xc5ccd2, metalness: 0.92, roughness: 0.18 }));
  const rubber = shade(new THREE.MeshStandardMaterial({ color: 0x161616, metalness: 0.08, roughness: 0.92 }));
  const leather = shade(new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.08, roughness: 0.78 }));
  const light = new THREE.MeshStandardMaterial({
    color: 0xfff1c4, emissive: 0xffd27a, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.28,
  });
  const tail = new THREE.MeshStandardMaterial({
    color: 0xc41818, emissive: 0x6a0808, emissiveIntensity: 0.45, metalness: 0.35, roughness: 0.35,
  });

  g.add(boxMesh(1.80, 0.50, 4.20, paint, 0, 0.52, 0));
  g.add(boxMesh(1.84, 0.16, 4.05, dark, 0, 0.28, 0));
  g.add(boxMesh(1.72, 0.10, 1.36, paint, 0, 0.84, 1.38));
  g.add(boxMesh(1.72, 0.10, 0.88, paint, 0, 0.82, -1.62));
  g.add(boxMesh(1.82, 0.22, 0.22, chrome, 0, 0.34, 2.12));
  g.add(boxMesh(1.82, 0.22, 0.20, chrome, 0, 0.34, -2.12));
  g.add(boxMesh(1.40, 0.08, 1.55, paint, 0, 1.42, -0.26));
  g.add(boxMesh(0.16, 0.62, 0.20, paint, -0.79, 1.10, 0.58));
  g.add(boxMesh(0.16, 0.62, 0.20, paint, 0.79, 1.10, 0.58));
  g.add(boxMesh(0.16, 0.62, 0.18, paint, -0.79, 1.10, -0.32));
  g.add(boxMesh(0.16, 0.62, 0.18, paint, 0.79, 1.10, -0.32));
  g.add(boxMesh(0.10, 0.58, 1.72, paint, -0.86, 1.08, -0.28));
  g.add(boxMesh(0.10, 0.58, 1.72, paint, 0.86, 1.08, -0.28));

  const dash = boxMesh(1.58, 0.22, 0.42, cabin, 0, 0.78, 0.46);
  g.add(dash);
  g.add(boxMesh(1.50, 0.06, 0.36, dark, 0, 0.90, 0.48));
  const cluster = makeCluster();
  paintCluster(cluster, 0, false);
  const dial = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.14),
    new THREE.MeshBasicMaterial({ map: cluster.tex }),
  );
  dial.position.set(CAR.seatX, 0.92, 0.38);
  dial.rotation.x = -0.18;
  g.add(dial);

  const wheelRig = new THREE.Group();
  wheelRig.position.set(CAR.seatX, 0.82, 0.34);
  wheelRig.rotation.x = -0.48;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 22), leather);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), chrome);
  hub.rotation.x = Math.PI * 0.5;
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.016, 0.02), leather);
  const spoke2 = spoke.clone();
  spoke2.rotation.z = 2.1;
  const spoke3 = spoke.clone();
  spoke3.rotation.z = -2.1;
  wheelRig.add(rim, hub, spoke, spoke2, spoke3);
  g.add(wheelRig);

  const seatMat = leather;
  for (const sx of [CAR.seatX, 0.38]) {
    g.add(boxMesh(0.42, 0.10, 0.46, seatMat, sx, 0.58, 0.04));
    g.add(boxMesh(0.42, 0.42, 0.10, seatMat, sx, 0.80, -0.18));
  }

  g.add(boxMesh(0.22, 0.08, 0.12, dark, -0.86, 1.18, 0.72));
  g.add(boxMesh(0.22, 0.08, 0.12, dark, 0.86, 1.18, 0.72));
  g.add(boxMesh(0.18, 0.06, 0.08, dark, 0, 1.32, 0.50));

  const panes = {};
  const addPane = (name, w, h, d, x, y, z) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6a8498, metalness: 0.85, roughness: 0.08, transparent: true, opacity: 0.28, depthWrite: false,
    });
    const m = boxMesh(w, h, d, mat, x, y, z);
    m.name = `glass-${name}`;
    m.userData.pane = name;
    g.add(m);
    panes[name] = m;
  };
  addPane('wind', 1.40, 0.46, 0.03, 0, 1.13, 0.63);
  addPane('rear', 1.40, 0.46, 0.03, 0, 1.13, -1.13);
  addPane('leftF', 0.03, 0.44, 0.78, -0.89, 1.10, 0.10);
  addPane('rightF', 0.03, 0.44, 0.78, 0.89, 1.10, 0.10);
  addPane('leftR', 0.03, 0.44, 0.66, -0.89, 1.10, -0.70);
  addPane('rightR', 0.03, 0.44, 0.66, 0.89, 1.10, -0.70);

  for (const sx of [-0.68, 0.68]) {
    g.add(boxMesh(0.32, 0.14, 0.08, light, sx, 0.52, 2.12));
    g.add(boxMesh(0.34, 0.12, 0.06, tail, sx, 0.54, -2.13));
  }

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
  wheelGeo.rotateZ(Math.PI * 0.5);
  for (const [sx, sz] of [[-0.78, 1.28], [0.78, 1.28], [-0.78, -1.32], [0.78, -1.32]]) {
    const w = new THREE.Mesh(wheelGeo, rubber);
    w.position.set(sx, 0.32, sz);
    g.add(w);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 8), chrome);
    cap.rotation.z = Math.PI * 0.5;
    cap.position.copy(w.position);
    g.add(cap);
    wheels.push(w);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return { group: g, wheels, lights: light, tails: tail, panes, wheelRig, cluster };
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
    this.clear();
    const spots = cityCarSpots();
    const { terrain } = this.world;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const y = terrain.heightAt(s.x, s.z);
      const built = makeCarMesh(COLORS[i % COLORS.length]);
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
