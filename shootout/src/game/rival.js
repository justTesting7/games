import * as THREE from 'three';
import { DriveGrid, followRoute, walkGrid } from './drivePath.js';
import { hasSea } from './swim.js';
import { driverPose, exitOf } from './cars.js';
import { findVault, stepVault } from './vault.js';
import { Loadout, WEAPONS, Weapons } from './weapons.js';
import { bowlWaypoint } from '../world/arenaLayout.js';

const GRAVITY = 16;
const JUMP_V = 5.0;
const RADIUS = 0.3;
const UP = new THREE.Vector3(0, 1, 0);
const COVER_BUDGET = { at: -1, used: 0 }; // cover searches run this tick (see Rival.findCover)
const SHELTER_SPRINT = 5.6;
const EXPOSE_LIMIT = 1.15;
const COVER_PAD = RADIUS + 0.5;
const SEARCH_R = 40;
// Humans commit to a plan for a few seconds. Sub-second retargets look robotic.
const THINK_HOLD = 2.8;
const THINK_SPREAD = 1.6;
const HIT_RETHINK = 0.7;
const STRAFE_HOLD = 2.8;
const STRAFE_SPREAD = 2.0;
const TARGET_STICK = 8;

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;

export const TACTICS = {
  push: { label: 'pushing', text: 'close the distance on the target and shoot on the move' },
  strafe: { label: 'strafing', text: 'sidestep left and right at the current range while shooting' },
  hold: { label: 'holding', text: 'stand still and take slow, accurate shots' },
  flank: { label: 'flanking', text: 'circle around the target to attack from the side' },
  take_cover: { label: 'taking cover', text: 'break to cover only when badly hurt, then peek and return fire' },
  retreat: { label: 'retreating', text: 'back away from the target while returning fire' },
  hunt: { label: 'hunting', text: 'move towards where an enemy was last seen to find them' },
};

const healthWord = (h) => (h > 70 ? 'healthy' : h > 40 ? 'wounded' : h > 15 ? 'badly wounded' : 'nearly dead');
const rangeWord = (d) => (d < 6 ? 'point blank' : d < 14 ? 'close' : d < 30 ? 'medium range' : 'far away');
const GUNS = {
  pistols: 'dual pistols: fast fire, accurate only within about 20 m',
  rifle: '7.62 sniper: first-person scope, one very heavy bolt-action shot, deadly at long range, useless from the hip',
  grenade: 'throw a grenade: flushes an enemy out of cover or punishes one standing still, 8-30 m away',
};
const ammoWord = (L, key) => {
  if (key === 'grenade') return `${L.grenades} left`;
  const total = L.mag[key] + L.reserve[key];
  return total === 0 ? 'empty' : L.mag[key] === 0 ? 'magazine empty' : `${L.mag[key]} in the magazine, ${L.reserve[key]} spare`;
};

export class Rival {
  constructor(world, combat, weapons, jev, persona, character) {
    this.world = world;
    this.combat = combat;
    this.weapons = weapons;
    this.jev = jev;
    this.persona = persona;
    this.character = character;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.aiming = false;
    this.onGround = true;
    this.airTime = 0;
    this.localDir = new THREE.Vector3(0, 0, 1);
    this.aimPoint = new THREE.Vector3();
    this.aimErr = new THREE.Vector3();
    this.aimErrGoal = new THREE.Vector3();
    this.lookPoint = new THREE.Vector3();
    this.fighter = combat.add({ id: persona.id, name: persona.name, character, pos: this.pos, color: persona.color });
    this.fighter.loadout = new Loadout(persona.grenadier ? 3 : 2);
    this.cols = [];
    this.memory = new Map();
    this.reset();
  }

  reset() {
    this.tactic = 'push';
    this.target = null;
    this.confidence = 0;
    this.source = 'local';
    this.thinkT = 0.8 + Math.random() * 1.2;
    this.thinking = false;
    this.epoch = (this.epoch || 0) + 1;
    this.perceiveT = 0;
    this.cooldown = this.persona.ruthless ? 0.15 : 0.22;
    this.burst = 3;
    this.burstPause = 0;
    this.side = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = STRAFE_HOLD + Math.random() * STRAFE_SPREAD;
    this.flankSide = Math.random() < 0.5 ? 1 : -1;
    this.errT = 0;
    this.cover = null;
    this.reachedShelter = true;
    this.needFirstCover = false;
    this.exposedT = 0;
    this.safeT = 0;
    this.runningToShelter = false;
    this.coverScanT = 0;
    this.droneSightT = 0;
    this.peeking = false;
    this.peekT = 0;
    this.peekWait = 0.55 + Math.random() * 0.4;
    this.stuckT = 0;
    this.detour = 0;
    this.lastProgress = this.pos.clone();
    this.progressT = 0;
    this.memory.clear();
    this.gun = 'pistols';
    this.want = 'pistols';
    this.throwAt = null;
    this.fighter.loadout.reset();
    this.fighter.preferRifle = false;
    this.character.setWeapon('pistols');
    this.character.weapon = 'pistols';
    this.character.equipT = 1;
  }

  // Sit in a parked car as its driver: no AI, no guns, a target seen through the glass.
  sitIn(car) {
    this.standUp();
    if (!car || car.driver) return;
    this.seatedIn = car;
    car.driver = this.fighter;
    this.vehicle = car;
    const ch = this.character;
    if (ch.rifle) ch.rifle.visible = false;
    ch.pistols?.forEach((p) => { p.visible = false; });
  }

  standUp() {
    const car = this.seatedIn;
    if (!car) return;
    if (car.driver === this.fighter) car.driver = null;
    this.seatedIn = null;
    this.vehicle = null;
    const ch = this.character;
    if (ch.rifle) ch.rifle.visible = true;
    ch.pistols?.forEach((p) => { p.visible = true; });
  }

  updateSeated(dt) {
    const car = this.seatedIn, ch = this.character;
    this.pos.copy(car.seat);
    this.vel.set(0, 0, 0);
    this.yaw = car.yaw;
    const fwd = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    this.lookPoint.copy(this.pos).addScaledVector(fwd, 10).setY(this.pos.y + 1.1);
    ch.root.position.copy(this.pos);
    ch.root.rotation.set(0, car.yaw, 0);
    ch.steer = car.steer || 0;
    ch.update(dt, {
      speed: 0, onGround: true, airTime: 0, strafe: false, localDir: this.localDir.set(0, 0, 1),
      jumpStarted: false, predictedAir: 0, aiming: false, aimPoint: this.lookPoint,
      lookDir: fwd, seat: driverPose(car),
    });
  }

  spawn(x, z, yaw) {
    if (this.drive) this.leaveCar();
    this.drive = null;
    this.driveCooldown = 0;
    this.standUp();
    this.pos.set(x, this.world.terrain.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.lookYaw = yaw;
    this.lookPitch = 0;
    this.aiming = false;
    this.onGround = true;
    this.airTime = 0;
    this.character.root.position.copy(this.pos);
    this.character.root.rotation.set(0, yaw, 0);
    this.aimPoint.set(x + Math.sin(yaw) * 10, this.pos.y + 1.4, z + Math.cos(yaw) * 10);
    this.combat.reset(this.fighter);
    this.reset();
  }

  enemies() { return this.combat.fighters.filter((f) => f !== this.fighter && f.alive); }

  seen(f) {
    let m = this.memory.get(f);
    if (!m) { m = { visible: false, sightT: 0, lastPos: null, lastT: -99 }; this.memory.set(f, m); }
    return m;
  }

  // Line of sight from the eyes to each enemy's chest.
  perceive(dt) {
    const eye = this.pos.clone().setY(this.pos.y + 1.6);
    for (const f of this.combat.fighters) {
      if (f === this.fighter) continue;
      const m = this.seen(f);
      if (!f.alive) { m.visible = false; continue; }
      if (m.visible) m.sightT += dt;
      if (this.perceiveT > 0) continue;
      const to = this.combat.chest(f).sub(eye);
      const d = to.length();
      to.divideScalar(d);
      const hit = d < 120 ? this.world.raycast(eye, to, d + 0.5, this.fighter) : null;
      const vis = d < 120 && (!hit || hit.fighter === f || hit.t > d - 0.3);
      if (vis && !m.visible) m.sightT = 0;
      m.visible = vis;
      if (vis) { m.lastPos = f.pos.clone(); m.lastT = this.combat.time; }
    }
    // Being shot reveals the shooter.
    const me = this.fighter;
    if (me.lastAttacker && me.lastAttacker.alive && this.combat.time - me.lastHitT < 0.1) {
      const m = this.seen(me.lastAttacker);
      m.lastPos = me.lastAttacker.pos.clone();
      m.lastT = this.combat.time;
    }
    if (this.perceiveT <= 0) this.perceiveT = 0.15;
    this.perceiveT -= dt;
  }

  coverBulk(c) {
    if (c.box) return Math.min(c.x1 - c.x0, c.z1 - c.z0);
    return c.r * 2;
  }

  // Poles, hydrants and lamp posts look like cover from a query but hide nobody.
  coverUsable(c) {
    const t = this.world.terrain;
    const cx = c.box ? (c.x0 + c.x1) * 0.5 : c.x;
    const cz = c.box ? (c.z0 + c.z1) * 0.5 : c.z;
    const stand = c.y1 - t.heightAt(cx, cz);
    if (stand < 1.15) return false;
    if (c.box) {
      const w = c.x1 - c.x0, d = c.z1 - c.z0;
      if (Math.min(w, d) < 0.8 && Math.max(w, d) < 1.2) return false;
    } else if (c.r < 0.22) {
      return false;
    }
    return true;
  }

  coverKind(c) {
    if (c.type === 'wood') return 'tree';
    if (c.type === 'metal') return 'metal';
    if (c.box) return 'cover';
    return 'rock';
  }

  groundSpot(sx, sz) {
    const t = this.world.terrain;
    if (!t.inBounds(sx, sz)) return null;
    const h = t.heightAt(sx, sz);
    if (hasSea() && h < 0.15) return null;
    return new THREE.Vector3(sx, h, sz);
  }

  coverSpot(c, threat) {
    const pad = COVER_PAD;
    if (!c.box) {
      const away = new THREE.Vector3(c.x - threat.x, 0, c.z - threat.z);
      if (away.lengthSq() < 1e-5) away.set(this.pos.x - c.x, 0, this.pos.z - c.z);
      if (away.lengthSq() < 1e-5) away.set(1, 0, 0);
      away.normalize();
      return this.groundSpot(c.x + away.x * (c.r + pad), c.z + away.z * (c.r + pad));
    }
    const faces = [
      { x: c.x0 - pad, z: THREE.MathUtils.clamp(this.pos.z, c.z0 + 0.4, c.z1 - 0.4), nx: -1, nz: 0 },
      { x: c.x1 + pad, z: THREE.MathUtils.clamp(this.pos.z, c.z0 + 0.4, c.z1 - 0.4), nx: 1, nz: 0 },
      { x: THREE.MathUtils.clamp(this.pos.x, c.x0 + 0.4, c.x1 - 0.4), z: c.z0 - pad, nx: 0, nz: -1 },
      { x: THREE.MathUtils.clamp(this.pos.x, c.x0 + 0.4, c.x1 - 0.4), z: c.z1 + pad, nx: 0, nz: 1 },
    ];
    let best = null, bestS = Infinity;
    for (const f of faces) {
      const away = (f.x - threat.x) * f.nx + (f.z - threat.z) * f.nz;
      if (away < -0.2) continue;
      const spot = this.groundSpot(f.x, f.z);
      if (!spot) continue;
      const d = spot.distanceTo(this.pos);
      if (d > 36) continue;
      const s = d - Math.min(away, 8) * 0.15;
      if (s < bestS) { bestS = s; best = spot; }
    }
    if (best) return best;
    const cx = (c.x0 + c.x1) * 0.5, cz = (c.z0 + c.z1) * 0.5;
    const ax = cx - threat.x, az = cz - threat.z;
    if (Math.abs(ax) * (c.z1 - c.z0) >= Math.abs(az) * (c.x1 - c.x0)) {
      const sx = ax >= 0 ? c.x1 + pad : c.x0 - pad;
      const sz = THREE.MathUtils.clamp(this.pos.z, c.z0 + 0.4, c.z1 - 0.4);
      return this.groundSpot(sx, sz);
    }
    const sz = az >= 0 ? c.z1 + pad : c.z0 - pad;
    const sx = THREE.MathUtils.clamp(this.pos.x, c.x0 + 0.4, c.x1 - 0.4);
    return this.groundSpot(sx, sz);
  }

  nearCollider(c, at, pad = 1.6) {
    if (!c || !at) return false;
    if (c.box) {
      const px = Math.max(c.x0, Math.min(at.x, c.x1));
      const pz = Math.max(c.z0, Math.min(at.z, c.z1));
      return Math.hypot(at.x - px, at.z - pz) < pad;
    }
    return Math.hypot(at.x - c.x, at.z - c.z) < c.r + pad;
  }

  // Spot is behind this object: LOS is blocked by it, and the spot sits on its far face.
  coverHides(spot, threat, c) {
    if (!spot || !threat) return false;
    if (c && !this.nearCollider(c, spot, COVER_PAD + 0.9)) return false;
    const from = threat.clone().setY((threat.y || 0) + 1.55);
    const aim = spot.clone().setY(spot.y + 1.25);
    const dir = aim.sub(from);
    const len = dir.length();
    if (len < 0.5) return false;
    dir.divideScalar(len);
    const hit = this.world.raycast(from, dir, len - 0.15, this.fighter);
    if (!hit || hit.fighter || hit.t > len - 0.2) return false;
    if (c && hit.collider && hit.collider !== c) return false;
    return true;
  }

  coverCenter(c) {
    return { x: c.box ? (c.x0 + c.x1) * 0.5 : c.x, z: c.box ? (c.z0 + c.z1) * 0.5 : c.z };
  }

  // Shoulder of the same object, toward the threat — step out, shoot, duck back.
  peekSpot(threat) {
    const c = this.cover?.c;
    if (!c || !threat) return null;
    const sideSign = this.strafeDir || 1;
    if (!c.box) {
      const to = new THREE.Vector3(threat.x - c.x, 0, threat.z - c.z);
      if (to.lengthSq() < 1e-5) return null;
      to.normalize();
      const side = new THREE.Vector3(to.z, 0, -to.x).multiplyScalar(sideSign);
      const r = c.r + COVER_PAD * 0.9;
      return this.groundSpot(c.x + side.x * r + to.x * c.r * 0.2, c.z + side.z * r + to.z * c.r * 0.2);
    }
    const cx = (c.x0 + c.x1) * 0.5, cz = (c.z0 + c.z1) * 0.5;
    const tx = threat.x - cx, tz = threat.z - cz;
    const pad = COVER_PAD * 0.85;
    if (Math.abs(tx) * (c.z1 - c.z0) >= Math.abs(tz) * (c.x1 - c.x0)) {
      const sx = tx >= 0 ? c.x1 + pad : c.x0 - pad;
      const sz = sideSign > 0 ? c.z1 + 0.15 : c.z0 - 0.15;
      return this.groundSpot(sx, THREE.MathUtils.clamp(sz, c.z0 - pad, c.z1 + pad));
    }
    const sz = tz >= 0 ? c.z1 + pad : c.z0 - pad;
    const sx = sideSign > 0 ? c.x1 + 0.15 : c.x0 - 0.15;
    return this.groundSpot(THREE.MathUtils.clamp(sx, c.x0 - pad, c.x1 + pad), sz);
  }

  updatePeek(dt, threat) {
    if (this.isRuthless()) {
      this.peeking = false;
      return;
    }
    if (!this.cover || !threat || this.runningToShelter) {
      this.peeking = false;
      return;
    }
    if (this.peeking && this.combat.time - this.fighter.lastHitT < 0.12 && this.fighter.health < 40) {
      this.peeking = false;
      this.peekT = 0;
      this.peekWait = 0.45 + Math.random() * 0.3;
      return;
    }
    if (this.peeking) {
      this.peekT -= dt;
      if (this.peekT <= 0) {
        this.peeking = false;
        this.peekWait = 0.7 + Math.random() * 0.5;
      }
      return;
    }
    this.peekWait -= dt;
    if (this.peekWait <= 0) {
      this.peeking = true;
      this.runningToShelter = false;
      this.peekT = 1.15 + Math.random() * 0.85;
      this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    }
  }

  // Standing on the far face: the object sits between us and the threat.
  onFarSide(threat, at = this.pos) {
    const c = this.cover?.c;
    if (!c || !threat) return false;
    if (!this.nearCollider(c, at, 1.55)) return false;
    const cc = this.coverCenter(c);
    const vx = cc.x - threat.x, vz = cc.z - threat.z;
    const mx = at.x - cc.x, mz = at.z - cc.z;
    if (vx * mx + vz * mz < 0.2) return false;
    const from = threat.clone().setY((threat.y || 0) + 1.55);
    const chest = at.clone().setY((at.y || this.pos.y) + 1.3);
    const dir = chest.sub(from);
    const len = dir.length();
    if (len < 0.8) return false;
    dir.divideScalar(len);
    const hit = this.world.raycast(from, dir, len - 0.15, this.fighter);
    return !!(hit && !hit.fighter && hit.t < len - 0.2);
  }

  isHiddenFrom(threat, at = this.pos) {
    return this.onFarSide(threat, at);
  }

  packCover(c, spot) {
    return { c, spot, type: this.coverKind(c) };
  }

  // Cover searches are the heaviest thing a rival does (tens of milliseconds on a city
  // map), and a kill sets every survivor rethinking at once. So searches are rationed:
  // one a tick across all rivals; the others keep their last answer and get their turn on
  // a following tick.
  findCover(threat, opts = {}) {
    if (!threat) return null;
    const key = opts.mustHide === false ? 'bulk' : 'hide';
    const now = this.combat.time, R = COVER_BUDGET;
    if (R.at !== now) { R.at = now; R.used = 0; }
    const last = this._coverCache?.[key];
    if (R.used >= 1) return last && last.threat.distanceTo(threat) < 6 ? last.result : null;
    R.used++;
    const result = this.searchCover(threat, opts);
    (this._coverCache || (this._coverCache = {}))[key] = { result, threat: threat.clone() };
    return result;
  }

  searchCover(threat, { mustHide = true } = {}) {
    if (!threat) return null;
    const cols = this.world.veg.colliders.query(this.pos.x, this.pos.z, SEARCH_R, this.cols);
    // City maps put well over a thousand boxes in range. Walk them nearest first and
    // stop once even the biggest size bonus can't beat the best spot found (the score
    // is distance minus at most 8 * 2.1): a full scan used to stall the frame 35 ms.
    const cand = this.coverCand || (this.coverCand = []);
    cand.length = 0;
    for (const c of cols) {
      if (c.coverOk === undefined) c.coverOk = this.coverUsable(c); // static
      if (!c.coverOk) continue;
      const near = c.box
        ? Math.hypot(this.pos.x - Math.max(c.x0, Math.min(this.pos.x, c.x1)), this.pos.z - Math.max(c.z0, Math.min(this.pos.z, c.z1)))
        : Math.max(0, Math.hypot(this.pos.x - c.x, this.pos.z - c.z) - c.r);
      if (near > 32 + COVER_PAD) continue;
      cand.push({ near, c });
    }
    cand.sort((a, b) => a.near - b.near);
    let best = null, bestS = Infinity;
    for (const { near, c } of cand) {
      if (near - COVER_PAD - 8 * 2.1 >= bestS) break;
      const spot = this.coverSpot(c, threat);
      if (!spot) continue;
      const d = spot.distanceTo(this.pos);
      if (d > 32) continue;
      const hides = this.coverHides(spot, threat, c);
      if (mustHide && !hides) continue;
      const score = d - Math.min(this.coverBulk(c), 8) * 2.1 + (hides ? 0 : 18);
      if (score < bestS) {
        bestS = score;
        best = this.packCover(c, spot);
      }
    }
    return best;
  }

  findNearestBulk(threat) {
    return this.findCover(threat, { mustHide: false });
  }

  isSheltered(threat) {
    return this.onFarSide(threat);
  }

  sameCover(a, b) {
    return !!(a && b && a.c === b.c);
  }

  // Go around the obstacle instead of running through it to the far face.
  wrapPoint(c, dest) {
    const pad = COVER_PAD + 0.08;
    if (!c.box) {
      const mx = (this.pos.x + dest.x) * 0.5, mz = (this.pos.z + dest.z) * 0.5;
      if (Math.hypot(mx - c.x, mz - c.z) > c.r + 0.15) return dest;
      const toMe = new THREE.Vector3(this.pos.x - c.x, 0, this.pos.z - c.z);
      if (toMe.lengthSq() < 1e-6) toMe.set(1, 0, 0);
      const perp = new THREE.Vector3(-toMe.z, 0, toMe.x).normalize();
      const r = c.r + pad;
      const a = this.groundSpot(c.x + perp.x * r, c.z + perp.z * r);
      const b = this.groundSpot(c.x - perp.x * r, c.z - perp.z * r);
      const da = a ? a.distanceTo(this.pos) + a.distanceTo(dest) : Infinity;
      const db = b ? b.distanceTo(this.pos) + b.distanceTo(dest) : Infinity;
      return da <= db ? a || dest : b || dest;
    }
    const x0 = c.x0 - 0.12, x1 = c.x1 + 0.12, z0 = c.z0 - 0.12, z1 = c.z1 + 0.12;
    const inside = (x, z) => x > x0 && x < x1 && z > z0 && z < z1;
    const dx = dest.x - this.pos.x, dz = dest.z - this.pos.z;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (Math.abs(p) < 1e-8) return q >= 0;
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
      return true;
    };
    const hits = inside(this.pos.x, this.pos.z) || inside(dest.x, dest.z)
      || (clip(-dx, this.pos.x - x0) && clip(dx, x1 - this.pos.x) && clip(-dz, this.pos.z - z0) && clip(dz, z1 - this.pos.z));
    if (!hits) return dest;
    const corners = [
      [c.x0 - pad, c.z0 - pad], [c.x1 + pad, c.z0 - pad],
      [c.x0 - pad, c.z1 + pad], [c.x1 + pad, c.z1 + pad],
    ];
    let best = dest, bestD = Infinity;
    for (const [x, z] of corners) {
      const p = this.groundSpot(x, z);
      if (!p) continue;
      const d = p.distanceTo(this.pos) + p.distanceTo(dest);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  shotsFlying() {
    const now = this.combat.time;
    return this.combat.fighters.some((f) => f.alive && now - (f.lastShotT ?? -99) < 2.0);
  }

  underFire() {
    return this.combat.time - this.fighter.lastHitT < 2.4;
  }

  nearCover() {
    return !!(this.cover?.spot && this.pos.distanceTo(this.cover.spot) < 2.2);
  }

  isRuthless() {
    return !!this.persona.ruthless;
  }

  canFight() {
    if (this.isRuthless()) return true;
    return this.fighter.alive;
  }

  inDanger() {
    if (this.underFire() || this.shotsFlying()) return true;
    return this.enemies().some((e) => this.seen(e).visible || this.combat.time - this.seen(e).lastT < 3);
  }

  anyThreat() {
    return this.threatPos() || this.enemies().reduce((a, e) => {
      if (!a) return e.pos;
      return e.pos.distanceTo(this.pos) < a.distanceTo(this.pos) ? e.pos : a;
    }, null);
  }

  shouldShelter() {
    if (this.isRuthless() || this.peeking) return false;
    const hp = this.fighter.health;
    if (hp < 26) return true;
    if (this.persona.prefersCover && hp < 40 && this.underFire()) return true;
    return false;
  }

  threatPos() {
    if (!this.target) return null;
    const m = this.seen(this.target);
    return m.visible ? this.target.pos : m.lastPos || this.target.pos;
  }

  // Asks Jev for a tactic and a target, with a compact, semantic state.
  think() {
    const me = this.fighter;
    const enemies = this.enemies();
    if (!enemies.length) return;
    const now = this.combat.time;
    const anyVisible = enemies.some((e) => this.seen(e).visible);
    const threat = this.threatPos() || enemies[0].pos;
    const cover = this.findCover(threat) || this.findNearestBulk(threat);
    const options = {};
    const offer = (k) => { options[k] = TACTICS[k].text; };
    if (this.persona.ruthless) {
      if (anyVisible) ['push', 'flank'].forEach(offer);
      else offer('hunt');
    } else {
      if (anyVisible) ['push', 'strafe', 'hold', 'flank', 'retreat'].forEach(offer);
      else ['hunt', 'hold'].forEach(offer);
      if (cover || this.shouldShelter()) offer('take_cover');
    }

    const L = me.loadout;
    const nearest = enemies.reduce((a, e) => Math.min(a, e.pos.distanceTo(this.pos)), Infinity);
    const danger = this.grenadeDanger();
    const state = {
      you: {
        name: me.name,
        personality: this.persona.personality,
        health: healthWord(me.health),
        weapon: WEAPONS[L.current].name,
        ammo: { pistols: ammoWord(L, 'pistols'), rifle: ammoWord(L, 'rifle'), grenades: ammoWord(L, 'grenade') },
        reloading: L.reloading ? 'yes' : 'no',
        live_grenade_near_you: danger ? 'yes, run!' : 'no',
        under_fire: now - me.lastHitT < 2.5 ? `yes, just shot by ${me.lastAttacker?.name}` : 'no',
        current_tactic: TACTICS[this.tactic].label,
        nearest_cover: cover ? `a ${cover.type} ${Math.round(cover.spot.distanceTo(this.pos))} m away` : 'none nearby',
      },
      enemies: enemies.map((e) => {
        const m = this.seen(e);
        const d = e.pos.distanceTo(this.pos);
        const target = this.combat.fighters.find((o) => o !== e && o.alive && this.combat.aimingAt(e, o));
        return {
          id: e.id,
          name: e.name,
          in_sight: m.visible ? 'yes' : m.lastT > -50 ? `no, last seen ${Math.round(now - m.lastT)} s ago` : 'no, never seen',
          distance: rangeWord(d),
          health: healthWord(e.health),
          weapon: WEAPONS[e.loadout?.current || 'pistols'].name,
          aiming_at: target ? (target === me ? 'you' : target.name) : 'nobody',
          shot_you_recently: me.lastAttacker === e && now - me.lastHitT < 4 ? 'yes' : 'no',
        };
      }),
      enemies_left: enemies.length,
    };
    const questions = {
      tactic: {
        type: 'choice',
        instructions: this.persona.ruthless
          ? `You are ${me.name}, ${this.persona.personality}. Never take cover. Never retreat. Always push and shoot. Last one standing wins. Pick your tactic for the next few seconds and commit to it, in character.`
          : `You are ${me.name}, ${this.persona.personality}. Fight aggressively. Push, flank, and shoot. Only take cover if you are badly wounded. Last one standing wins. Pick your tactic for the next few seconds and commit to it, in character.`,
        criteria: options,
      },
    };
    const weapons = {};
    if (L.has('pistols')) weapons.pistols = GUNS.pistols;
    if (L.has('rifle')) weapons.rifle = GUNS.rifle;
    const tp = this.threatPos();
    const td = tp ? tp.distanceTo(this.pos) : Infinity;
    if (L.grenades > 0 && !danger) {
      const inRange = td > (this.persona.grenadier ? 5 : 8) && td < (this.persona.grenadier ? 38 : 30);
      if (inRange) weapons.grenade = this.persona.grenadier ? `${GUNS.grenade} (your specialty — use often)` : GUNS.grenade;
    }
    if (Object.keys(weapons).length > 1) {
      questions.weapon = {
        type: 'choice',
        instructions: `You are ${me.name}. The nearest enemy is ${rangeWord(nearest)}. Which weapon should you use right now?`,
        criteria: weapons,
      };
    }

    this.thinking = true;
    const epoch = this.epoch;
    this.jev.ask(state, questions).then((ans) => {
      if (epoch !== this.epoch || !this.fighter.alive) return;
      this.decide(ans, options, enemies, cover);
      this.chooseWeapon(ans?.weapon?.choice, weapons);
    }).finally(() => {
      if (epoch !== this.epoch) return;
      this.thinking = false;
      this.thinkT = THINK_HOLD + Math.random() * THINK_SPREAD;
    });
  }

  decide(ans, options, enemies, cover) {
    const alive = enemies.filter((e) => e.alive);
    if (!alive.length) return;
    this.pickTarget();

    if (this.isRuthless()) {
      this.source = ans?.tactic ? 'jev' : 'local';
      this.setTactic(ans?.tactic?.choice === 'flank' ? 'flank' : (this.enemies().some((e) => this.seen(e).visible) ? 'push' : 'hunt'), cover);
      return;
    }

    if (this.shouldShelter()) {
      this.source = 'local';
      this.setTactic('take_cover', cover);
      return;
    }

    const t = ans?.tactic;
    if (t && options[t.choice]) {
      this.source = 'jev';
      this.confidence = t.confidence;
      // An unsure answer does not override a plan that is still valid.
      if (t.confidence >= 0.3 || !options[this.tactic]) this.setTactic(t.choice, cover);
    } else {
      this.source = 'local';
      this.confidence = 0;
      this.setTactic(this.localTactic(options, cover), cover);
    }
  }

  chooseWeapon(choice, offered) {
    if (!choice || !offered[choice]) {
      const d = this.target ? this.threatPos().distanceTo(this.pos) : 20;
      const L = this.fighter.loadout;
      choice = d > 22 && L.has('rifle') ? 'rifle' : L.has('pistols') ? 'pistols' : 'rifle';
      const hidden = this.target && !this.seen(this.target).visible && this.seen(this.target).lastT > -50;
      if (offered.grenade && hidden && Math.random() < 0.3) choice = 'grenade';
    }
    if (this.persona.grenadier && offered.grenade && this.fighter.loadout.grenades > 0) {
      const d = this.target ? this.threatPos()?.distanceTo(this.pos) ?? 20 : 20;
      const hidden = this.target && !this.seen(this.target).visible;
      if (d > 5 && d < 38 && (hidden || Math.random() < 0.62)) choice = 'grenade';
    }
    if (choice === 'grenade' && this.canFight()) {
      this.want = 'grenade';
      this.throwAt = this.threatPos()?.clone() || null;
    } else {
      if (choice !== 'grenade') this.gun = choice;
      if (this.want !== 'grenade') this.want = this.gun;
    }
    this.fighter.preferRifle = this.gun === 'rifle';
  }

  // A live grenade within blast range that is not about to be thrown by us.
  grenadeDanger() {
    let best = null, bestD = WEAPONS.grenade.radius;
    for (const g of this.weapons.live) {
      const d = g.pos.distanceTo(this.pos);
      if (d < bestD && g.fuse < WEAPONS.grenade.fuse - 0.25) { bestD = d; best = g; }
    }
    return best;
  }

  // First target is always the closest living enemy. If anyone is in sight,
  // shoot the nearest visible one instead of a closer body behind a wall.
  closestEnemy(alive = this.enemies()) {
    const list = alive.filter((e) => e.alive);
    if (!list.length) return null;
    const seen = list.filter((e) => this.seen(e).visible);
    const pool = seen.length ? seen : list;
    let best = pool[0], bestD = best.pos.distanceTo(this.pos);
    for (let i = 1; i < pool.length; i++) {
      const d = pool[i].pos.distanceTo(this.pos);
      if (d < bestD) { best = pool[i]; bestD = d; }
    }
    return best;
  }

  localTarget(alive) {
    return this.closestEnemy(alive);
  }

  localTactic(options, cover) {
    if (this.isRuthless()) return this.target && this.seen(this.target).visible ? 'push' : 'hunt';
    const me = this.fighter;
    const visible = this.target && this.seen(this.target).visible;
    if (this.shouldShelter()) return cover ? 'take_cover' : 'retreat';
    if (!visible) return this.tactic === 'hold' && options?.hold ? 'hold' : 'hunt';
    const d = this.target.pos.distanceTo(this.pos);
    if (me.health < 26 && cover && this.underFire()) return 'take_cover';
    // Keep a still-valid plan instead of rolling a new one every think.
    if (this.tactic === 'strafe' && d < 22) return 'strafe';
    if (this.tactic === 'hold' && d > 8) return 'hold';
    if (this.tactic === 'push' || this.tactic === 'flank') return this.tactic;
    if (d > 7) return Math.random() < 0.38 ? 'flank' : 'push';
    return Math.random() < 0.55 ? 'strafe' : 'push';
  }

  // Stick with the current mark unless they die or someone else is clearly closer.
  pickTarget() {
    const alive = this.enemies();
    if (!alive.length) { this.setTarget(null); return; }
    const cur = this.target?.alive ? this.target : null;
    const best = this.closestEnemy(alive);
    if (!cur) { this.setTarget(best); return; }
    if (!best || best === cur) return;
    const curVis = this.seen(cur).visible;
    const bestVis = this.seen(best).visible;
    const curD = cur.pos.distanceTo(this.pos);
    const bestD = best.pos.distanceTo(this.pos);
    if (!curVis && bestVis) this.setTarget(best);
    else if (bestD + TARGET_STICK < curD) this.setTarget(best);
  }

  setTarget(t) {
    if (t === this.target) return;
    this.target = t;
    const m = t ? this.seen(t) : null;
    if (m) m.sightT = Math.min(m.sightT, 0.1);
  }

  setTactic(t, cover) {
    if (this.isRuthless() && (t === 'take_cover' || t === 'retreat' || t === 'hold' || t === 'strafe')) {
      t = this.target && this.seen(this.target).visible ? 'push' : 'hunt';
    }
    if (t === 'take_cover') this.cover = cover || this.cover || this.findCover(this.threatPos()) || this.findNearestBulk(this.threatPos());
    if (t === this.tactic) return;
    this.tactic = t;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = STRAFE_HOLD + Math.random() * 1.2;
    this.flankSide = Math.random() < 0.5 ? 1 : -1;
    if (t !== 'take_cover' && !this.runningToShelter) this.cover = cover || this.cover;
  }

  pickCover(threat) {
    const hide = this.findCover(threat);
    const bulk = this.findNearestBulk(threat);
    let chosen = hide || bulk;
    if (this.needFirstCover && bulk && (!hide || this.coverBulk(bulk.c) > this.coverBulk(hide.c) + 0.6)) {
      chosen = bulk;
    }
    if (this.runningToShelter && this.cover && this.coverUsable(this.cover.c)) {
      const here = this.cover.spot.distanceTo(this.pos);
      const better = chosen && !this.sameCover(chosen, this.cover)
        && chosen.spot.distanceTo(this.pos) + 8 < here
        && this.coverBulk(chosen.c) >= this.coverBulk(this.cover.c);
      if (!better) {
        const spot = this.coverSpot(this.cover.c, threat);
        if (spot) this.cover.spot.copy(spot);
        return this.cover;
      }
    }
    return chosen || this.cover;
  }

  updateShelter(dt, threat) {
    if (this.isRuthless()) {
      this.needFirstCover = false;
      this.reachedShelter = true;
      this.runningToShelter = false;
      this.peeking = false;
      return;
    }
    this.coverScanT = (this.coverScanT || 0) - dt;
    if (threat && (this.coverScanT <= 0 || !this.cover)) {
      this.coverScanT = this.runningToShelter ? 1.2 : 1.5;
      const found = this.pickCover(threat);
      if (found) this.cover = found;
      if (this.cover && threat) {
        const spot = this.coverSpot(this.cover.c, threat);
        if (spot) {
          if (!this.cover.spot) this.cover.spot = spot.clone();
          else this.cover.spot.lerp(spot, 0.28);
        }
      }
    }
    const sheltered = this.onFarSide(threat);
    if (sheltered) {
      this.safeT += dt;
      this.exposedT = 0;
      if (this.safeT > 0.15) {
        this.reachedShelter = true;
        this.runningToShelter = false;
      }
    } else {
      this.exposedT += dt;
      this.safeT = 0;
    }
    if (this.shouldShelter()) {
      this.runningToShelter = true;
      this.reachedShelter = false;
      this.setTactic('take_cover', this.cover);
    }
  }

  steerToCover(out, tp, side, visible) {
    let c = this.cover;
    if (!c || !c.spot) {
      c = this.pickCover(tp);
      this.cover = c;
    }
    if (!c) {
      out.dir.set(this.pos.x - tp.x, 0, this.pos.z - tp.z);
      if (out.dir.lengthSq() < 1e-6) out.dir.copy(side);
      else out.dir.normalize();
      out.speed = SHELTER_SPRINT;
      out.aim = visible;
      this.runningToShelter = true;
      this.reachedShelter = false;
      return;
    }
    const dest = c.spot;
    if (!dest) {
      out.dir.set(this.pos.x - tp.x, 0, this.pos.z - tp.z);
      if (out.dir.lengthSq() < 1e-6) out.dir.copy(side);
      else out.dir.normalize();
      out.speed = SHELTER_SPRINT;
      out.aim = visible;
      return;
    }
    if (this.onFarSide(tp) && this.pos.distanceTo(dest) < 1.8) {
      this.runningToShelter = false;
      this.reachedShelter = true;
      this.needFirstCover = false;
      out.aim = visible && this.canFight();
      if (!visible || this.underFire()) {
        out.dir.copy(side).multiplyScalar(this.strafeDir);
        out.speed = 1.2;
      }
      return;
    }
    const via = this.wrapPoint(c.c, dest);
    this.navGoal = dest;
    const to = new THREE.Vector3(via.x - this.pos.x, 0, via.z - this.pos.z);
    const len = to.length() || 1;
    out.dir.copy(to).divideScalar(len);
    out.speed = SHELTER_SPRINT;
    out.aim = visible;
    this.runningToShelter = true;
    this.reachedShelter = false;
  }

  // Turns the tactic into a movement wish for this frame.
  steer(dt) {
    const out = { dir: new THREE.Vector3(), speed: 0, aim: false, jump: false };
    const T = this.target;
    const tp = this.anyThreat() || (T ? T.pos : null);
    this.updateShelter(dt, tp);
    this.updatePeek(dt, tp);
    if (!tp) return out;
    const m = T ? this.seen(T) : { visible: false };
    const to = new THREE.Vector3(tp.x - this.pos.x, 0, tp.z - this.pos.z);
    const d = to.length() || 1;
    to.divideScalar(d);
    const side = new THREE.Vector3(to.z, 0, -to.x);
    const visible = !!(T && m.visible);
    out.aim = visible && d < 70 && this.canFight();

    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = STRAFE_HOLD + Math.random() * STRAFE_SPREAD; }

    if (this.isRuthless()) {
      this.needFirstCover = false;
      this.runningToShelter = false;
      this.peeking = false;
      if (this.tactic === 'take_cover' || this.tactic === 'retreat' || this.tactic === 'hold' || this.tactic === 'strafe') {
        this.tactic = visible ? 'push' : 'hunt';
      }
    }

    this.navGoal = (this.tactic === 'push' || this.tactic === 'hunt' || this.tactic === 'flank') ? tp : null;
    const exposed = !this.isRuthless() && (this.shouldShelter() || (this.runningToShelter && !this.peeking));
    if (this.peeking && this.cover) {
      const dest = this.peekSpot(tp) || this.cover.spot;
      if (dest) {
        const step = new THREE.Vector3(dest.x - this.pos.x, 0, dest.z - this.pos.z);
        const sl = step.length();
        if (sl > 0.28) {
          out.dir.copy(step).divideScalar(sl);
          out.speed = 3.5;
        }
      }
      out.aim = true;
    } else if (exposed || this.tactic === 'take_cover') {
      this.steerToCover(out, tp, side, visible);
      if (exposed && !this.onFarSide(tp)) out.speed = SHELTER_SPRINT;
      out.aim = visible;
    } else switch (this.tactic) {
      case 'push':
        if (this.isRuthless()) {
          if (d > 3.2) { out.dir.copy(to).addScaledVector(side, this.strafeDir * 0.2); out.speed = visible ? 4.9 : 5.4; }
          else { out.dir.copy(side).multiplyScalar(this.strafeDir); out.speed = 3.0; }
          out.aim = visible;
        } else if (d > 7) { out.dir.copy(to).addScaledVector(side, this.strafeDir * 0.35); out.speed = visible ? 3.6 : 4.8; }
        else { out.dir.copy(side).multiplyScalar(this.strafeDir); out.speed = 2.4; }
        break;
      case 'strafe':
        out.dir.copy(side).multiplyScalar(this.strafeDir).addScaledVector(to, d < 9 ? -0.4 : d > 26 ? 0.45 : 0);
        out.speed = 2.6;
        break;
      case 'hold':
        if (!visible) { out.dir.copy(side).multiplyScalar(this.strafeDir); out.speed = 1.4; }
        break;
      case 'flank':
        if (this.isRuthless()) {
          out.dir.copy(side).multiplyScalar(this.flankSide).addScaledVector(to, d > 5 ? 0.85 : 0.2);
          out.speed = 5.0;
          out.aim = visible;
        } else {
          out.dir.copy(side).multiplyScalar(this.flankSide).addScaledVector(to, d > 14 ? 0.6 : d < 8 ? -0.3 : 0.1);
          out.speed = 4.2;
        }
        break;
      case 'retreat':
        out.dir.copy(to).negate().addScaledVector(side, this.strafeDir * 0.5);
        out.speed = SHELTER_SPRINT;
        break;
      case 'hunt':
      default:
        if (this.isRuthless()) {
          if (d > 3.2) { out.dir.copy(to); out.speed = 5.4; }
          out.aim = visible;
        } else {
          if (d > 4) { out.dir.copy(to); out.speed = d > 15 ? 4.8 : 3.6; }
          out.aim = visible;
        }
        break;
    }

    const danger = this.grenadeDanger();
    if (danger) {
      out.dir.set(this.pos.x - danger.pos.x, 0, this.pos.z - danger.pos.z).normalize();
      out.speed = 5.8;
      out.aim = false;
      out.jump = danger.fuse < 0.6 && Math.random() < 0.3;
    }
    if (this.want === 'grenade' && this.throwAt && this.canFight()) out.aim = true;
    if (this.canSeeDrone()) out.aim = true;

    // Personal space, and a way around whatever is blocking the path.
    for (const f of this.combat.fighters) {
      if (f === this.fighter || !f.alive) continue;
      const dx = this.pos.x - f.pos.x, dz = this.pos.z - f.pos.z;
      const dd = Math.hypot(dx, dz);
      if (dd < 3 && dd > 1e-3) out.dir.add(new THREE.Vector3(dx / dd, 0, dz / dd).multiplyScalar((3 - dd) * 0.6));
    }
    if (out.dir.lengthSq() > 1e-6) out.dir.normalize();
    // (on the way to a car, walkToCar does the routing, to the door)
    if (!danger && !this.peeking && out.speed > 0.6 && !this.world.terrain?.arena && this.drive?.phase !== 'walk') this.navigate(out, dt);
    if (this.detour > 0) {
      this.detour -= dt;
      out.dir.applyAxisAngle(UP, this.detourAngle);
      out.speed = Math.max(out.speed, 3);
    } else if (!danger && this.world.terrain?.arena && out.speed > 0.35 && tp) {
      this.steerBowl(out, tp);
    }
    return out;
  }

  // On foot around the walls: while the way straight ahead is open, go straight; when a
  // wall, a fence or a parked car is in it, follow a route (A* on a 1 m grid of where a
  // body fits) to where they're headed, re-planned as the goal moves. One plan a frame
  // across all the rivals.
  navigate(out, dt) {
    const world = this.world;
    if (!world.veg?.colliders) return;
    let grid = world.walkGrid;
    if (!grid || grid.world.terrain !== world.terrain) grid = world.walkGrid = walkGrid(world);
    const L = THREE.MathUtils.clamp(out.speed * 1.5, 2.5, 7);
    const from = { x: this.pos.x + out.dir.x * 0.6, z: this.pos.z + out.dir.z * 0.6 };
    const probe = { x: this.pos.x + out.dir.x * L, z: this.pos.z + out.dir.z * L };
    this.navT = (this.navT || 0) - dt;
    const following = this.navRoute && this.navT > 0;
    if (!following && !this.navForce && grid.line(from, probe)) { this.navRoute = null; return; }
    const g = this.navGoal && Math.hypot(this.navGoal.x - this.pos.x, this.navGoal.z - this.pos.z) < 70 ? this.navGoal : probe;
    const moved = this.navRoute?.goal ? Math.hypot(this.navRoute.goal.x - g.x, this.navRoute.goal.z - g.z) : 99;
    const now = this.combat.time;
    if ((!this.navRoute || moved > 3 || this.navT <= 0 || this.navForce) && DriveGrid.walkPlanned !== now) {
      DriveGrid.walkPlanned = now;
      this.navForce = false;
      const route = grid.find({ x: this.pos.x, z: this.pos.z }, { x: g.x, z: g.z }, { near: 1.5, maxNodes: 1500 }); // capped: an unreachable goal costs a few ms, not a hitch
      if (route) route.goal = { x: g.x, z: g.z };
      this.navRoute = route;
      this.navT = 2.5; // follow it a while before trusting the straight line again
    }
    if (!this.navRoute) return;
    const f = followRoute(this.navRoute, this.pos.x, this.pos.z, 0.9 + out.speed * 0.2); // short: corners are taken, not cut
    if (f.end) { this.navRoute = null; return; }
    const dx = f.x - this.pos.x, dz = f.z - this.pos.z, len = Math.hypot(dx, dz);
    if (len > 0.2) out.dir.set(dx / len, 0, dz / len);
    // ease off into a sharp corner
    if (f.turn > 0.8) out.speed = Math.min(out.speed, 3.2);
  }

  // Garden stands: take the stairs, or hop a seat row — never walk the chairs.
  steerBowl(out, dest) {
    const nav = bowlWaypoint(this.pos, dest);
    if (!nav) return;
    const dx = nav.x - this.pos.x;
    const dz = nav.z - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.16) out.dir.set(dx / len, 0, dz / len);
    if (nav.jump) out.jump = true;
  }

  // Aim wanders around the target by an error that grows with range and
  // movement and settles the longer the target stays in sight.
  updateAim(dt, wish) {
    const T = this.target;
    if (!T) return;
    const m = this.seen(T);
    const chest = this.combat.chest(T);
    const d = chest.distanceTo(this.pos);
    const mySpeed = Math.hypot(this.vel.x, this.vel.z);
    const theirSpeed = T.isPlayer ? Math.hypot(this.world.player.vel.x, this.world.player.vel.z) : 3;
    const settle = 1 + 1.4 * Math.exp(-m.sightT * 1.5);
    const stance = (this.tactic === 'hold' ? 0.65 : 1) * (this.character.weapon === 'rifle' ? 0.4 : 1);
    const sigma = 0.02 * d * this.persona.accuracy * settle * stance * (1 + mySpeed * 0.12 + theirSpeed * 0.06) + 0.05;
    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = 0.18 + Math.random() * 0.12;
      this.aimErrGoal.set(gauss() * sigma, gauss() * sigma * 0.9, gauss() * sigma);
    }
    this.aimErr.lerp(this.aimErrGoal, 1 - Math.exp(-dt * 10));
    const goal = chest.add(this.aimErr);
    if (!wish.aim) { const tp = this.threatPos(); goal.set(tp.x, tp.y + 1.3, tp.z); }
    if (this.want === 'grenade' && this.throwAt) goal.copy(this.throwAt).setY(this.throwAt.y + 1.5);
    this.aimPoint.lerp(goal, 1 - Math.exp(-dt * 9));
  }

  // Switches to the wanted weapon, throws a pending grenade, and reloads
  // when the magazine runs low with nobody in sight.
  handleWeapons() {
    const f = this.fighter;
    const L = f.loadout;
    const ch = this.character;
    let want = this.want;
    if (want === 'grenade' && (L.grenades <= 0 || !this.throwAt)) want = this.want = this.gun;
    if (want === 'grenade' && !this.canFight()) want = this.gun;
    if (!L.has(want)) want = L.has(this.gun) ? this.gun : L.has('pistols') ? 'pistols' : 'rifle';
    if (want !== L.current && !(L.current === 'grenade' && ch.action)) this.weapons.equip(f, want);
    if (this.canFight() && L.current === 'grenade' && ch.weapon === 'grenade' && ch.equipT >= 1 && !ch.action && this.throwAt) {
      const facing = Math.atan2(this.throwAt.x - this.pos.x, this.throwAt.z - this.pos.z);
      if (Math.abs(wrapAngle(facing - this.yaw)) < 0.25) {
        const from = this.pos.clone().setY(this.pos.y + 1.75);
        const spot = this.throwAt.clone().add(new THREE.Vector3(gauss() * 1.4, 0, gauss() * 1.4));
        const lob = !(this.target && this.seen(this.target).visible);
        const dist = from.distanceTo(spot);
        const charge = THREE.MathUtils.clamp((dist - 6) / 28, 0.15, 1);
        const speed = THREE.MathUtils.lerp(WEAPONS.grenade.speedMin, WEAPONS.grenade.speedMax, charge);
        L.throwVel.copy(Weapons.aimThrow(from, spot, speed, lob));
        if (this.weapons.trigger(f, this.aimPoint)) { this.throwAt = null; this.want = this.gun; }
      }
    }
    const def = WEAPONS[L.current];
    const visible = this.target && this.seen(this.target).visible;
    if (def.mag && !visible && !L.reloading && !ch.action && L.mag[def.key] < def.mag * 0.5) this.weapons.reload(f);
  }

  droneEye() {
    return this.pos.clone().setY(this.pos.y + 1.55);
  }

  canSeeDrone() {
    const drone = this.world.drone?.live;
    return !!(drone && !drone.dying && this.canFight() && (drone.born || 0) > 0.85);
  }

  // Trunks are thin; a center ray often slips past a tree the drone is
  // hiding behind. A fat probe plus a wider wood radius matches what you see.
  droneLosClear(from, dest) {
    const dir = dest.clone().sub(from);
    const len = dir.length();
    if (len < 1.2) return false;
    dir.divideScalar(len);
    const probe = (origin) => {
      const hit = this.world.raycast(origin, dir, len - 0.15, this.fighter);
      return !hit || !!hit.drone;
    };
    if (!probe(from)) return false;
    const up = UP;
    const right = new THREE.Vector3().crossVectors(dir, up);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    else right.normalize();
    for (const [sx, sy] of [[0.34, 0], [-0.34, 0], [0, 0.3]]) {
      const o = from.clone().addScaledVector(right, sx).addScaledVector(up, sy);
      if (!probe(o)) return false;
    }
    const cols = this.world.veg?.colliders;
    if (!cols) return true;
    const tmp = [];
    for (let t = 0; t < len; t += 5) {
      cols.query(from.x + dir.x * t, from.z + dir.z * t, 6, tmp);
      for (const c of tmp) {
        if (c.type !== 'wood') continue;
        const y0 = Math.min(from.y, dest.y) - 0.5;
        const y1 = Math.max(from.y, dest.y) + 0.5;
        if (c.y1 < y0 || c.y0 > y1) continue;
        const bx = dest.x - from.x, bz = dest.z - from.z;
        const bl = bx * bx + bz * bz || 1;
        const u = Math.max(0, Math.min(1, ((c.x - from.x) * bx + (c.z - from.z) * bz) / bl));
        const dist = Math.hypot(c.x - (from.x + bx * u), c.z - (from.z + bz * u));
        if (dist < c.r + 1.2) return false;
      }
    }
    return true;
  }

  tryShootDrone(dt) {
    const drone = this.world.drone?.live;
    if (!drone || drone.dying) {
      this.droneSightT = 0;
      return false;
    }
    if (!this.canFight() || this.fighter.loadout.current === 'grenade') {
      this.droneSightT = 0;
      return false;
    }
    const from = this.droneEye();
    const len = from.distanceTo(drone.pos);
    if ((drone.born || 0) < 0.85 || len < 6 || len > 30 || !this.droneLosClear(from, drone.pos)) {
      this.droneSightT = 0;
      return false;
    }
    this.droneSightT += dt;
    const rifle = this.fighter.loadout.current === 'rifle';
    const need = this.persona.reaction + (rifle ? 0.55 : 0.35);
    if (this.droneSightT < need || this.character.aimWeight < 0.88 || this.cooldown > 0) return false;
    const miss = 0.7 + len * 0.05 + (rifle ? 0.9 : 0);
    const aim = drone.pos.clone().add(new THREE.Vector3(gauss() * miss, gauss() * miss * 0.7, gauss() * miss));
    const spread = rifle ? 0.028 : 0.02;
    if (!this.weapons.trigger(this.fighter, aim, spread)) return false;
    this.cooldown = this.persona.fireInterval * (rifle ? 1.6 : 1.25);
    return true;
  }

  shoot(dt, wish) {
    this.cooldown -= dt;
    const T = this.target;
    const L = this.fighter.loadout;
    if (!this.canFight() || L.current === 'grenade') return;
    if (this.tryShootDrone(dt)) return;
    if (!T || !wish.aim) return;
    const m = this.seen(T);
    const rifle = L.current === 'rifle';
    const rush = this.peeking || this.isRuthless() || this.tactic === 'push' || this.tactic === 'flank';
    const react = this.persona.reaction * (rush ? 0.75 : 1) + (rifle ? 0.12 : 0);
    if (!m.visible || m.sightT < react) return;
    if (this.character.aimWeight < (rush ? 0.55 : 0.68)) return;
    const want = Math.atan2(this.aimPoint.x - this.pos.x, this.aimPoint.z - this.pos.z);
    if (Math.abs(wrapAngle(want - this.yaw)) > (rush ? 0.5 : 0.35)) return;
    if (this.burstPause > 0) { this.burstPause -= dt; return; }
    if (this.cooldown > 0) return;
    if (!this.weapons.trigger(this.fighter, this.aimPoint, rifle ? 0.002 : 0.005)) return;
    if (rifle) {
      this.cooldown = 0.22 + Math.random() * 0.28;
      return;
    }
    this.cooldown = this.persona.fireInterval * (rush ? 0.4 : 0.55);
    if (--this.burst <= 0) {
      this.burst = rush ? 6 + Math.floor(Math.random() * 4) : 4 + Math.floor(Math.random() * 3);
      this.burstPause = rush ? 0.08 + Math.random() * 0.14 : 0.18 + Math.random() * 0.22;
    }
  }

  move(dt, wish) {
    const { terrain } = this.world;
    const horiz = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    // people turn, they don't snap: the heading swings toward the wish at a human rate
    // (quicker when slow), and they slow into a sharp change of direction
    const md = this.moveDir || (this.moveDir = wish.dir.clone());
    let speedK = 1;
    if (wish.dir.lengthSq() > 1e-6 && wish.speed > 0.05) {
      const ang = Math.atan2(md.x * wish.dir.z - md.z * wish.dir.x, md.x * wish.dir.x + md.z * wish.dir.z);
      const rate = (horiz.length() > 3.5 ? 5 : 9) * dt;
      if (md.lengthSq() < 0.25 || (Math.abs(ang) > 2.6 && horiz.length() < 1.5)) md.copy(wish.dir); // from a standstill: turn on the spot
      else md.applyAxisAngle(UP, -THREE.MathUtils.clamp(ang, -rate, rate)).normalize();
      speedK = 0.55 + 0.45 * Math.max(0, Math.cos(Math.min(Math.abs(ang), Math.PI)));
    }
    const desired = md.clone().multiplyScalar(wish.speed * speedK * (this.character.stagger > 0 ? 0.45 : 1));
    const accel = this.onGround ? (wish.speed >= SHELTER_SPRINT - 0.05 ? 8 : wish.speed > horiz.length() ? 6 : 8) : 1.5;
    horiz.lerp(desired, Math.min(1, dt * accel));
    this.vel.x = horiz.x;
    this.vel.z = horiz.z;
    const knock = this.fighter.knock;
    if (knock && knock.lengthSq() > 1e-6) {
      this.vel.add(knock);
      if (knock.y > 0.3) this.onGround = false;
      knock.set(0, 0, 0);
    }

    let jumpStarted = false;
    if (wish.jump && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
      jumpStarted = true;
    }
    this.vel.y -= GRAVITY * dt;

    // a low wall or railing in the way: vault it rather than run into it
    if (!this.vault && this.onGround && wish.speed > 1.5 && this.world.shots) {
      this.vaultCheckT = (this.vaultCheckT || 0) - dt;
      if (this.vaultCheckT <= 0) {
        this.vaultCheckT = 0.25;
        this.vault = findVault(this.world, this.pos, wish.dir);
        if (this.vault) { this.onGround = false; jumpStarted = true; }
      }
    }
    if (this.vault) {
      const nv = this.pos.clone();
      if (stepVault(this.vault, nv, this.vel, dt)) { this.vault = null; this.onGround = true; this.airTime = 0; }
      this.pos.copy(nv);
      return jumpStarted;
    }
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    const ground = terrain.heightAt(next.x, next.z);
    const n = terrain.normalAt(next.x, next.z);
    const uphill = n.x * this.vel.x + n.z * this.vel.z < 0;
    let blocked = false;
    if ((n.y < 0.62 && uphill && ground > this.pos.y + 0.05) || (hasSea() && ground < 0.1) || !terrain.inBounds(next.x, next.z)) {
      next.x = this.pos.x;
      next.z = this.pos.z;
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
      blocked = true;
    }
    this.world.veg.colliders.resolveXZ(next, RADIUS, next.y, next.y + 1.7);
    this.world.props.collidePlayer(next, RADIUS, this.vel);
    this.world.cars?.collideWalker(next, RADIUS, null);
    for (const f of this.combat.fighters) {
      if (f === this.fighter || !f.alive) continue;
      const dx = next.x - f.pos.x, dz = next.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      const r = RADIUS * 2;
      if (d < r && d > 1e-4) { next.x = f.pos.x + (dx / d) * r; next.z = f.pos.z + (dz / d) * r; }
    }

    const g2 = terrain.heightAt(next.x, next.z);
    if (next.y <= g2 || (this.onGround && this.vel.y <= 0 && next.y - g2 < 0.45)) {
      next.y = g2;
      this.vel.y = 0;
      this.onGround = true;
      this.airTime = 0;
    } else {
      this.onGround = false;
      this.airTime += dt;
    }
    this.pos.copy(next);

    // Stuck on a slope, the shore or a tree: hop, then try another way.
    this.progressT += dt;
    if (this.progressT > 0.8) {
      const moved = this.pos.distanceTo(this.lastProgress);
      if (wish.speed > 1.5 && moved < 0.35 * this.progressT && this.detour <= 0) {
        // held up: plan a way round first; only if that fails too, try a short detour
        if (!this.navForce && !this.navRoute) this.navForce = true;
        else {
          this.detour = 0.7 + Math.random() * 0.5;
          this.detourAngle = (Math.random() < 0.5 ? 1 : -1) * (1.0 + Math.random() * 0.6);
          this.navRoute = null;
        }
      }
      this.lastProgress.copy(this.pos);
      this.progressT = 0;
    }
    return jumpStarted;
  }

  forceJump() {
    this.vel.y = JUMP_V;
    this.onGround = false;
    return true;
  }

  // ---- taking a car ---------------------------------------------------------------
  // A rival whose target is far off takes the nearest empty car within reach: walks to
  // the driver's door, gets in, drives at the target (running down anyone in the way)
  // and jumps out to fight when close, or when the car is wedged or burning.
  considerCar() {
    if (this.drive || !this.target || this.combat.time < (this.driveCooldown || 0)) return;
    // looked over a few times a second, not every frame
    if (this.combat.time < (this.carLookT || 0)) return;
    this.carLookT = this.combat.time + 0.4;
    const cars = this.world.cars;
    if (!cars?.list.length) return;
    const tp = this.threatPos();
    const far = tp ? Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z) : 0;
    if (!tp || far < 70) return;
    // a parked car boxed in front and back by others can't get out: skip those
    const lane = (car, dir) => !cars.list.some((o) => {
      if (o === car) return false;
      const dx = o.x - car.x, dz = o.z - car.z;
      const along = (dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw)) * dir;
      const side = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
      return along > 0 && along < 6.5 && Math.abs(side) < 1.6;
    });
    // any car worth the walk: well short of the way to the target (the nearest wins), not
    // one another jev is already heading for, nor one that just let this one down
    const now = this.combat.time;
    let best = null, bd = Math.min(far * 0.6, 220), out = 0;
    for (const car of cars.list) {
      if (car.driver || car.wrecked || car.spec || (car.hp ?? 100) < 30) continue;
      if (car.claim && car.claim.f !== this.fighter && car.claim.until > now) continue;
      if ((this.badCars?.get(car) || 0) > now) continue;
      const d = Math.hypot(car.x - this.pos.x, car.z - this.pos.z);
      if (d >= bd) continue;
      const fwdFree = lane(car, 1), backFree = lane(car, -1);
      if (!fwdFree && !backFree) continue;
      bd = d; best = car; out = fwdFree ? 0 : 1.3; // reverse out first when only the back is free
    }
    if (best) {
      // time to get there on foot (round corners), then it gives up on it
      this.drive = { car: best, phase: 'walk', t: 0, stuck: 0, tries: 0, reverse: out, walkFor: 8 + bd / 2.5 };
      best.claim = { f: this.fighter, until: now + this.drive.walkFor };
    }
  }

  // Looks ahead along the heading and 25 deg to each side for whatever the car would hit
  // (the walking grid it collides with, other cars, building walls): returns a steer away
  // from the nearer side, scaled by how close it is (0 = clear).
  carAvoid(car) {
    const cols = this.world.veg?.colliders, cars = this.world.cars?.list || [];
    const reach = 6 + Math.min(Math.abs(car.speed), 20) * 0.45;
    const tmp = this._avoidTmp || (this._avoidTmp = []);
    // only the cars that could be within reach (the probes test them ~30 times)
    const near = this._nearCars || (this._nearCars = []);
    near.length = 0;
    const span = reach + 3;
    for (const o of cars) if (Math.abs(o.x - car.x) < span && Math.abs(o.z - car.z) < span) near.push(o);
    const hitAt = (x, z) => {
      if (cols) {
        for (const c of cols.query(x, z, 1.4, tmp)) {
          if (c.y1 < car.y + 0.2 || c.y0 > car.y + 1.3) continue;
          if (c.box ? x > c.x0 - 0.9 && x < c.x1 + 0.9 && z > c.z0 - 0.9 && z < c.z1 + 0.9 : Math.hypot(x - c.x, z - c.z) < (c.r || 0) + 0.9) return true;
        }
      }
      for (const o of near) if (o !== car && Math.abs(o.x - x) < 2.4 && Math.abs(o.z - z) < 2.4 && Math.hypot(o.x - x, o.z - z) < 2.2) return true;
      return false;
    };
    const look = (a) => {
      const yaw = car.yaw + a * Math.sign(car.speed || 1);
      const fx = Math.sin(yaw) * Math.sign(car.speed || 1), fz = Math.cos(yaw) * Math.sign(car.speed || 1);
      for (let t = 2.6; t < reach; t += 1) if (hitAt(car.x + fx * t, car.z + fz * t)) return t;
      return reach;
    };
    const c = look(0);
    if (c >= reach) return 0;
    const l = look(0.45), r = look(-0.45);
    if (l >= reach && r >= reach) return 0.8;
    return (l > r ? 1 : -1) * (1 - c / reach); // +steer turns left
  }

  walkToCar(wish, dt) {
    const car = this.drive.car;
    this.drive.t += dt;
    if (car.driver || car.wrecked) { this.leaveCar(); return; } // someone else got there first
    if (this.drive.t > (this.drive.walkFor || 8)) { this.leaveCar(true); return; } // can't get to it
    const door = exitOf(car, 1);
    const to = new THREE.Vector3(door.x - this.pos.x, 0, door.z - this.pos.z);
    if (to.length() < 1.3) {
      car.driver = this.fighter;
      car.ai = { throttle: 0, steer: 0, handbrake: false };
      this.seatedIn = car;
      this.vehicle = car;
      this.drive.phase = 'drive';
      this.drive.t = 0;
      const ch = this.character;
      if (ch.rifle) ch.rifle.visible = false;
      ch.pistols?.forEach((p) => { p.visible = false; });
      return;
    }
    wish.dir.copy(to.normalize());
    wish.speed = 5.2;
    wish.aim = false;
    // round the buildings on the walk grid, not straight into a wall
    this.navGoal = door;
    this.navigate(wish, dt);
  }

  updateDriving(dt) {
    const d = this.drive, car = d.car;
    d.t += dt;
    const tp = this.threatPos();
    if (!tp || car.wrecked || (car.hp ?? 100) < 25) { this.leaveCar(); return; }
    const dist = Math.hypot(tp.x - car.x, tp.z - car.z);
    // a route along the streets to the target, replanned now and then or when thrown off it
    // (one plan a frame across all drivers: a search can take a few milliseconds)
    const grid = this.world.cars.driveGrid || (this.world.cars.driveGrid = new DriveGrid(this.world));
    d.replan = (d.replan ?? 0) - dt;
    const now = this.combat.time;
    const offRoute = d.route && followRoute(d.route, car.x, car.z, 0).off > 7;
    if ((!d.route || d.replan <= 0 || offRoute) && DriveGrid.planned !== now) {
      DriveGrid.planned = now;
      d.route = grid.find({ x: car.x, z: car.z }, { x: tp.x, z: tp.z }, { near: 20, maxNodes: 2500 }); // capped: no hitch
      d.replan = 5;
    }
    let aimX = tp.x, aimZ = tp.z, turn = 0;
    if (d.route) {
      const f = followRoute(d.route, car.x, car.z, 7 + Math.abs(car.speed) * 0.45);
      aimX = f.x; aimZ = f.z; turn = f.turn;
    }
    const err = wrapAngle(Math.atan2(aimX - car.x, aimZ - car.z) - car.yaw);
    const ai = car.ai;
    if (d.reverse > 0) {
      d.reverse -= dt;
      ai.throttle = -1;
      ai.steer = -Math.sign(err);
    } else {
      const avoid = this.carAvoid(car);
      ai.steer = THREE.MathUtils.clamp(err * 2.2 + avoid * 2.5, -1, 1);
      // ease off for a sharp corner coming up, and brake into it at speed
      const corner = turn > 0.9 && car.speed > 9 ? -0.6 : turn > 0.5 ? 0.55 : 1;
      ai.throttle = dist < 32 ? (car.speed > 1 ? -1 : 0) : Math.abs(err) > 1.3 || Math.abs(avoid) > 0.6 ? 0.4 : corner;
      if (Math.abs(car.speed) < 1.2 && ai.throttle > 0) d.stuck += dt; else d.stuck = Math.max(0, d.stuck - dt);
      if (d.stuck > 1.4) { d.stuck = 0; d.reverse = 1.1; d.tries++; }
    }
    if (dist < 32 && Math.abs(car.speed) < 2) { this.leaveCar(); return; } // close enough: out and fight
    if (d.tries > 3 || d.t > 90) { this.leaveCar(true); return; } // wedged: out, and find another
    this.updateSeated(dt);
  }

  // failed: the car couldn't be reached or got wedged (it isn't picked again for a while)
  leaveCar(failed = false) {
    const d = this.drive;
    this.drive = null;
    // soon looking for another while the target is still far (considerCar wants 70 m+)
    this.driveCooldown = this.combat.time + 3;
    if (!d) return;
    const car = d.car;
    if (car.claim?.f === this.fighter) car.claim = null;
    if (failed) (this.badCars || (this.badCars = new Map())).set(car, this.combat.time + 40);
    if (car.driver === this.fighter) car.driver = null;
    car.ai = null;
    if (this.seatedIn === car) {
      this.standUp();
      const at = exitOf(car, 1);
      this.pos.set(at.x, this.world.terrain.heightAt(at.x, at.z), at.z);
      this.vel.set(0, 0, 0);
      this.yaw = car.yaw;
    }
  }

  update(dt, active) {
    const ch = this.character;
    if (this.drive?.phase === 'drive') {
      if (this.fighter.alive && active) { this.updateDriving(dt); this.weapons.tick(this.fighter, dt); return; }
      if (!this.fighter.alive) {
        if (this.drive.car) this.drive.car.ai = null; // roll on; the body stays in the seat
        this.drive = null;
      }
    }
    if (this.seatedIn && !this.drive) { this.updateSeated(dt); return; }
    if (!this.fighter.alive) {
      ch.root.position.copy(this.pos);
      ch.update(dt, {});
      return;
    }
    if (active) this.handleWeapons();
    let wish = { dir: new THREE.Vector3(), speed: 0, aim: false, jump: false };
    if (active) {
      this.perceive(dt);
      this.pickTarget();
      // A hit gets a human beat to reconsider — not an instant plan swap.
      if (this.combat.time - this.fighter.lastHitT < dt * 1.5) this.thinkT = Math.min(this.thinkT, HIT_RETHINK);
      this.thinkT -= dt;
      if (this.thinkT <= 0 && !this.thinking) this.think();
      if (this.target && !this.enemies().includes(this.target)) this.target = null;
      wish = this.steer(dt);
      this.considerCar();
      if (this.drive?.phase === 'walk') this.walkToCar(wish, dt);
    }
    this.updateAim(dt, wish);
    const jumpStarted = this.move(dt, wish);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (wish.aim) {
      const want = Math.atan2(this.aimPoint.x - this.pos.x, this.aimPoint.z - this.pos.z);
      const err = wrapAngle(want - this.yaw);
      this.yaw += Math.sign(err) * Math.min(Math.abs(err), Math.max(Math.abs(err) * 5, 2.2) * dt);
    } else if (speed > 0.4) {
      this.yaw += wrapAngle(Math.atan2(this.vel.x, this.vel.z) - this.yaw) * Math.min(1, dt * 5);
    }
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    if (speed > 0.05) this.localDir.set(this.vel.x * left.x + this.vel.z * left.z, 0, this.vel.x * fwd.x + this.vel.z * fwd.z).normalize();

    if (wish.aim) this.lookPoint.copy(this.aimPoint);
    else this.lookPoint.copy(this.pos).addScaledVector(fwd, 10).setY(this.pos.y + 1.5);
    this.aiming = !!wish.aim;
    const eyeY = this.pos.y + 1.5;
    const ldx = this.lookPoint.x - this.pos.x;
    const ldy = this.lookPoint.y - eyeY;
    const ldz = this.lookPoint.z - this.pos.z;
    this.lookYaw = Math.atan2(ldx, ldz);
    this.lookPitch = Math.atan2(ldy, Math.hypot(ldx, ldz) || 1e-6);
    ch.root.position.copy(this.pos);
    ch.root.rotation.y = this.yaw;
    const cam = this.world.player?.camera?.position;
    ch.detail = cam && cam.distanceToSquared(this.pos) > 35 * 35 ? 0 : 1;
    ch.update(dt, {
      speed, onGround: this.onGround, airTime: this.airTime, strafe: wish.aim, localDir: this.localDir,
      jumpStarted, predictedAir: (2 * JUMP_V) / GRAVITY, aiming: wish.aim, aimPoint: this.lookPoint,
      lookDir: this.lookPoint.clone().sub(this.pos).normalize(),
    });
    if (active) this.shoot(dt, wish);
    this.weapons.tick(this.fighter, dt);
  }

  get label() { return TACTICS[this.tactic].label; }
}
