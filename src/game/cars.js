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
};

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

function makeCarMesh(color) {
  const g = new THREE.Group();
  g.name = 'car';
  const paint = shade(new THREE.MeshStandardMaterial({ color, metalness: 0.58, roughness: 0.34 }));
  const dark = shade(new THREE.MeshStandardMaterial({ color: 0x141618, metalness: 0.35, roughness: 0.62 }));
  const glass = new THREE.MeshStandardMaterial({
    color: 0x6a8498, metalness: 0.85, roughness: 0.1, transparent: true, opacity: 0.42,
  });
  const chrome = shade(new THREE.MeshStandardMaterial({ color: 0xc5ccd2, metalness: 0.92, roughness: 0.18 }));
  const rubber = shade(new THREE.MeshStandardMaterial({ color: 0x161616, metalness: 0.08, roughness: 0.92 }));
  const light = new THREE.MeshStandardMaterial({
    color: 0xfff1c4, emissive: 0xffd27a, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.28,
  });
  const tail = new THREE.MeshStandardMaterial({
    color: 0xc41818, emissive: 0x6a0808, emissiveIntensity: 0.45, metalness: 0.35, roughness: 0.35,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.5, 4.2), paint);
  body.position.y = 0.56;
  g.add(body);
  const rocker = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.16, 4.05), dark);
  rocker.position.y = 0.3;
  g.add(rocker);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.58, 1.82), paint);
  cabin.position.set(0, 1.06, -0.18);
  g.add(cabin);
  const wind = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.46, 1.55), glass);
  wind.position.set(0, 1.1, -0.14);
  g.add(wind);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 1.2), paint);
  hood.position.set(0, 0.84, 1.32);
  hood.rotation.x = -0.1;
  g.add(hood);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.72), paint);
  trunk.position.set(0, 0.82, -1.62);
  g.add(trunk);
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.22, 0.22), chrome);
  bumperF.position.set(0, 0.34, 2.12);
  g.add(bumperF);
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.22, 0.2), chrome);
  bumperR.position.set(0, 0.34, -2.12);
  g.add(bumperR);

  for (const sx of [-0.68, 0.68]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.08), light);
    lamp.position.set(sx, 0.52, 2.12);
    g.add(lamp);
    const stop = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), tail);
    stop.position.set(sx, 0.54, -2.13);
    g.add(stop);
  }

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
  wheelGeo.rotateZ(Math.PI * 0.5);
  for (const [sx, sz] of [[-0.78, 1.28], [0.78, 1.28], [-0.78, -1.32], [0.78, -1.32]]) {
    const w = new THREE.Mesh(wheelGeo, rubber);
    w.position.set(sx, 0.32, sz);
    g.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 8), chrome);
    hub.rotation.z = Math.PI * 0.5;
    hub.position.copy(w.position);
    g.add(hub);
    wheels.push(w);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return { group: g, wheels, lights: light, tails: tail };
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
        mesh: built.group,
        wheels: built.wheels,
        lights: built.lights,
        tails: built.tails,
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
    };
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
      const stepped = stepDrive({
        speed: local.speed,
        yaw: local.yaw,
        throttle: THREE.MathUtils.clamp(f, -1, 1),
        steer: THREE.MathUtils.clamp(s, -1, 1),
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
