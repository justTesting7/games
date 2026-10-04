import * as THREE from 'three';
import { DriveGrid, followRoute } from './drivePath.js';
import { driverPose, sizeOf } from './cars.js';

// Ambient traffic: a few of the parked cars pull out with a civilian at the wheel and cruise
// the streets on planned routes, about town speed, stopping for anyone in the road ahead
// and slowing for corners. Gunfire or a blast nearby and they floor it away from it. They
// use the same car physics, lamps, spray and engine voices as any driven car. Solo only:
// in a room every client would plan its own.

const CRUISE = 11; // m/s, ~40 km/h
const FLEE = 22;

export class Traffic {
  /** makeDriver(i) -> a Character, already added to the scene. */
  constructor(world, makeDriver, count = 4, { minDist = 35 } = {}) {
    this.world = world;
    this.minDist = minDist;
    this.makeDriver = makeDriver;
    this.count = count;
    this.agents = [];
    this.tmp = [];
  }

  /** Clears the traffic (the round's car reset puts every car back where it was parked). */
  reset() {
    for (const a of this.agents) this.release(a);
    this.agents = [];
    this.nextT = 2;
  }

  release(a) {
    if (a.car.driver === a.fighter) a.car.driver = null;
    a.car.ai = null;
    a.car.speed = 0;
    a.car.vel?.set(0, 0, 0);
    a.ch.root.visible = false;
    a.ch.dead = null;
    // its driver goes back to the pool for the next car
    const i = (this.drivers || []).indexOf(a.ch);
    if (i >= 0) { this.drivers.splice(i, 1); this.drivers.push(a.ch); }
  }

  /** A parked car that can pull straight out (nothing parked just ahead of it). */
  free(car) {
    const cars = this.world.cars.list;
    if (car.driver || car.wrecked || car.spec || car.startFor || (car.hp ?? 100) < 60) return false; // (startFor: kept for a player's start)
    return !cars.some((o) => {
      if (o === car) return false;
      const dx = o.x - car.x, dz = o.z - car.z;
      const along = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
      const side = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
      return along > 0 && along < 6.5 && Math.abs(side) < 1.6;
    });
  }

  /** A goal 120-260 m off, roughly away from `from` when fleeing. */
  goalFor(car, away = null) {
    const a = away ? Math.atan2(car.x - away.x, car.z - away.z) + (Math.random() - 0.5) * 0.8 : Math.random() * Math.PI * 2;
    const d = 120 + Math.random() * 140;
    return { x: car.x + Math.sin(a) * d, z: car.z + Math.cos(a) * d };
  }

  spawn(near) {
    const cars = this.world.cars?.list || [];
    const cands = cars.filter((c) => {
      const d = Math.hypot(c.x - near.x, c.z - near.z);
      return d > this.minDist && d < 170 && this.free(c);
    });
    if (!cands.length) return;
    const car = cands[Math.floor(Math.random() * cands.length)];
    const i = this.agents.length;
    this.drivers = this.drivers || [];
    const busy = new Set(this.agents.map((x) => x.ch));
    let ch = this.drivers.find((d) => !busy.has(d));
    if (!ch) { ch = this.makeDriver(this.drivers.length); this.drivers.push(ch); }
    ch.root.visible = true;
    ch.dead = null;
    if (ch.revive) ch.revive();
    const fighter = { id: `traffic-${i}`, name: 'Driver', isPlayer: false, alive: true, ambient: true, character: ch, pos: new THREE.Vector3() };
    ch.dead = null;
    car.driver = fighter;
    car.ai = { throttle: 0, steer: 0, handbrake: false };
    if (car.body) car.body.rest = false;
    this.agents.push({ car, ch, fighter, hp: 45, route: null, goal: this.goalFor(car), replan: 0, flee: 0, stuck: 0, reverse: 0, t: 0 });
  }

  /**
   * A round through a driver's window: the head and the chest are spheres on their bones.
   * Returns { t, normal, surface: 'flesh', traffic: agent, head } for the nearest, or null.
   */
  raycast(o, d, maxDist) {
    let best = null;
    const c = this._c || (this._c = new THREE.Vector3());
    for (const a of this.agents) {
      if (!a.fighter.alive || !a.ch.root.visible) continue;
      if (Math.abs(a.car.x - o.x) > maxDist + 3 || Math.abs(a.car.z - o.z) > maxDist + 3) continue;
      const B = a.ch.bones;
      for (const [bone, r, head] of [[B?.Head, 0.13, true], [B?.Spine2, 0.22, false]]) {
        if (!bone) continue;
        bone.getWorldPosition(c);
        const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
        const b = ox * d.x + oy * d.y + oz * d.z, q = ox * ox + oy * oy + oz * oz - r * r;
        const disc = b * b - q;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t <= 0 || t > (best ? best.t : maxDist)) continue;
        const p = o.clone().addScaledVector(d, t);
        best = { t, normal: p.sub(c).normalize(), surface: 'flesh', traffic: a, head };
      }
    }
    return best;
  }

  /** A driver hit: a head shot or a second round kills; the car rolls to a stop. */
  hitDriver(a, dir, { head = false, amount = 30 } = {}) {
    if (!a?.fighter.alive) return false;
    a.hp = (a.hp ?? 45) - (head ? 999 : amount);
    a.flee = 12;
    if (a.hp > 0) { a.ch.hitReact?.(dir, head ? 'Head' : 'Spine2'); return false; }
    a.fighter.alive = false;
    a.ch.die(dir || new THREE.Vector3(0, 0, 1)); // slumps in the seat
    const car = a.car;
    if (car.ai) { car.ai.throttle = 0; car.ai.steer = 0; car.ai.handbrake = false; }
    car.driver = null; // the car is free to take (the body stays in the seat until someone does)
    return true;
  }

  /** A blast at pos: drivers close by are killed. */
  blast(pos, radius) {
    for (const a of this.agents) {
      if (!a.fighter.alive) continue;
      const dx = a.car.x - pos.x, dz = a.car.z - pos.z, dd = Math.hypot(dx, dz);
      if (dd > radius * 0.6) continue;
      this.hitDriver(a, new THREE.Vector3(dx, 0.3, dz).normalize(), { amount: 999 });
    }
  }

  /** Gunfire or a blast at pos: drivers within reach floor it away from it. */
  scare(pos, radius = 70) {
    for (const a of this.agents) {
      if (Math.hypot(a.car.x - pos.x, a.car.z - pos.z) > radius) continue;
      if (a.flee <= 0) { a.goal = this.goalFor(a.car, pos); a.route = null; }
      a.flee = 12;
    }
  }

  update(dt, { player, fighters = [] } = {}) {
    const world = this.world;
    if (!world.cars?.list.length || !player) return;
    // keep a few cars on the move near the player
    this.nextT = (this.nextT ?? 2) - dt;
    if (this.agents.length < this.count && this.nextT <= 0) { this.nextT = 4; this.spawn(player.pos); }
    // a car that has driven far off parks where it is; another pulls out nearer
    this.agents = this.agents.filter((a) => {
      if (Math.hypot(a.car.x - player.pos.x, a.car.z - player.pos.z) < 260 || a.car.wrecked) return true;
      this.release(a);
      return false;
    });
    this.viewer = player.pos;
    const grid = world.cars.driveGrid || (world.cars.driveGrid = new DriveGrid(world));
    const now = performance.now();
    for (const a of this.agents) {
      const car = a.car, ai = car.ai;
      a.t += dt;
      if (!a.fighter.alive) {
        // shot dead at the wheel: the car coasts to a stop with the body in the seat, and
        // whoever takes the car takes it from there (the body goes)
        if (car.driver && car.driver !== a.fighter) { a.ch.root.visible = false; continue; }
        if (car.ai) { car.ai.throttle = 0; car.ai.steer = 0; }
        if (a.ch.root.visible) this.seat(a, dt);
        continue;
      }
      if (!ai || car.driver !== a.fighter) continue;
      // a wrecked car's driver is dead in the seat; a burning one just stops
      if (car.wrecked) {
        if (!a.ch.dead) a.ch.die(new THREE.Vector3(0, 0, 1));
        ai.throttle = 0; ai.steer = 0;
        this.seat(a, dt);
        continue;
      }
      if ((car.hp ?? 100) < 30) { ai.throttle = car.speed > 0.5 ? -1 : 0; ai.steer = 0; this.seat(a, dt); continue; }
      a.flee = Math.max(0, a.flee - dt);
      a.replan -= dt;
      const atGoal = Math.hypot(car.x - a.goal.x, car.z - a.goal.z) < 18;
      if (atGoal) { a.goal = this.goalFor(car); a.route = null; }
      if ((!a.route || a.replan <= 0) && DriveGrid.planned !== now) {
        DriveGrid.planned = now;
        a.route = grid.find({ x: car.x, z: car.z }, a.goal, { near: 15, maxNodes: 2500 });
        a.replan = 8;
        if (!a.route) a.goal = this.goalFor(car); // nowhere to go that way: try another
      }
      const fwdX = Math.sin(car.yaw), fwdZ = Math.cos(car.yaw);
      let aimX = car.x + fwdX * 10, aimZ = car.z + fwdZ * 10, turn = 0;
      if (a.route) {
        const f = followRoute(a.route, car.x, car.z, 6 + Math.abs(car.speed) * 0.45);
        aimX = f.x; aimZ = f.z; turn = f.turn;
      }
      const err = Math.atan2(Math.sin(Math.atan2(aimX - car.x, aimZ - car.z) - car.yaw), Math.cos(Math.atan2(aimX - car.x, aimZ - car.z) - car.yaw));
      const avoid = this.avoid(car);
      // someone in the road ahead: brake for them (unless running from gunfire)
      let block = 99;
      for (const f of fighters) {
        if (!f.alive || f === a.fighter) continue;
        const dx = f.pos.x - car.x, dz = f.pos.z - car.z;
        const along = dx * fwdX + dz * fwdZ, side = Math.abs(dx * fwdZ - dz * fwdX);
        if (along > 0 && along < 9 + car.speed * 0.6 && side < sizeOf(car).halfW + 1) block = Math.min(block, along);
      }
      const want = a.flee > 0 ? FLEE : turn > 0.9 ? 5 : turn > 0.5 ? 8 : CRUISE;
      if (a.reverse > 0) {
        a.reverse -= dt;
        ai.throttle = -0.8; ai.steer = -Math.sign(err);
      } else {
        ai.steer = THREE.MathUtils.clamp(err * 2 + avoid * 2.4, -1, 1);
        if (block < 99 && a.flee <= 0) ai.throttle = car.speed > 0.3 ? -1 : 0;
        else ai.throttle = car.speed > want + 1 ? -0.5 : car.speed < want ? (Math.abs(avoid) > 0.6 ? 0.4 : 1) : 0;
        if (Math.abs(car.speed) < 1 && ai.throttle > 0) a.stuck += dt; else a.stuck = Math.max(0, a.stuck - dt);
        if (a.stuck > 1.6) { a.stuck = 0; a.reverse = 1.2; a.route = null; }
      }
      ai.handbrake = false;
      this.seat(a, dt);
    }
  }

  // the driver sits and steers (and slumps, dead, in a wreck)
  seat(a, dt) {
    const car = a.car, ch = a.ch;
    a.fighter.pos.copy(car.seat);
    ch.root.position.copy(car.seat);
    ch.root.rotation.set(0, car.yaw, 0);
    ch.steer = car.steer || 0;
    // drivers away from the player are animated at half rate, without the fine detail
    ch.detail = this.viewer && Math.hypot(car.x - this.viewer.x, car.z - this.viewer.z) > 35 ? 0 : 1;
    const fwd = this._fwd || (this._fwd = new THREE.Vector3());
    fwd.set(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    const look = this._look || (this._look = new THREE.Vector3());
    look.copy(car.seat).addScaledVector(fwd, 10).setY(car.seat.y + 1.1);
    ch.update(dt, {
      speed: 0, onGround: true, airTime: 0, strafe: false, localDir: this._ld || (this._ld = new THREE.Vector3(0, 0, 1)),
      jumpStarted: false, predictedAir: 0, aiming: false, aimPoint: look, lookDir: fwd, seat: driverPose(car),
    });
  }

  // look ahead and 25 degrees each side for walls, posts and cars; steer from the nearer side
  avoid(car) {
    const cols = this.world.veg?.colliders, cars = this.world.cars?.list || [];
    const reach = 6 + Math.min(Math.abs(car.speed), 20) * 0.45;
    // only the cars that could be within reach (the probes test them ~30 times)
    const near = this._near || (this._near = []);
    near.length = 0;
    const span = reach + 3;
    for (const o of cars) if (Math.abs(o.x - car.x) < span && Math.abs(o.z - car.z) < span) near.push(o);
    const hitAt = (x, z) => {
      if (cols) {
        for (const c of cols.query(x, z, 1.4, this.tmp)) {
          if (c.y1 < car.y + 0.2 || c.y0 > car.y + 1.3) continue;
          if (c.box ? x > c.x0 - 0.9 && x < c.x1 + 0.9 && z > c.z0 - 0.9 && z < c.z1 + 0.9 : Math.hypot(x - c.x, z - c.z) < (c.r || 0) + 0.9) return true;
        }
      }
      for (const o of near) if (o !== car && Math.abs(o.x - x) < 2.4 && Math.abs(o.z - z) < 2.4 && Math.hypot(o.x - x, o.z - z) < 2.2) return true;
      return false;
    };
    const look = (ang) => {
      const yaw = car.yaw + ang;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      for (let t = 2.6; t < reach; t += 1) if (hitAt(car.x + fx * t, car.z + fz * t)) return t;
      return reach;
    };
    const c = look(0);
    if (c >= reach) return 0;
    const l = look(0.45), r = look(-0.45);
    if (l >= reach && r >= reach) return 0.8;
    return (l > r ? 1 : -1) * (1 - c / reach);
  }
}
