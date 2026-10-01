import * as THREE from 'three';
import { hasSea } from './swim.js';
import { driverPose } from './cars.js';
import { Character } from './character.js';
import { Loadout } from './weapons.js';
import { byId, resolveLooks } from './roster.js';
import { RemoteDrone } from './drone.js';
import { standSpawn } from '../world/arenaLayout.js';
import { studioSlotSpawn } from '../world/studioLayout.js';
import { getMap } from '../world/maps.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const vec = (a, fallback = [0, 0, 0]) => new THREE.Vector3(a?.[0] ?? fallback[0], a?.[1] ?? fallback[1], a?.[2] ?? fallback[2]);

class Remote {
  constructor(snap, fighter, character) {
    this.id = snap.id;
    this.fighter = fighter;
    this.character = character;
    this.pos = fighter.pos;
    this.yaw = snap.yaw || 0;
    this.pitch = 0;
    this.speed = 0;
    this.onGround = true;
    this.crouch = 0;
    this.aiming = false;
    this.weapon = snap.w || 'pistols';
    this.target = this.pos.clone();
    this.body = this.pos.clone();
    this.targetYaw = this.yaw;
    this.persona = { name: snap.name, color: snap.color };
    this.roster = snap.roster || 'adventurer';
    this.label = 'human';
    this.source = 'net';
    this.confidence = 1;
    this.away = !!snap.away;
    this.applySnap(snap);
  }

  applySnap(s) {
    if (s.name) this.persona.name = this.fighter.name = s.name;
    if (s.color) this.persona.color = this.fighter.color = s.color;
    if (Array.isArray(s.p)) this.target.set(s.p[0], s.p[1], s.p[2]);
    if (Number.isFinite(s.yaw)) this.targetYaw = s.yaw;
    if (Number.isFinite(s.pitch)) this.pitch = s.pitch;
    if (Number.isFinite(s.spd)) this.speed = s.spd;
    if (s.g !== undefined) this.onGround = !!s.g;
    if (Number.isFinite(s.cr)) this.crouch = s.cr;
    if (s.aim !== undefined) this.aiming = !!s.aim;
    if (s.w && s.w !== this.weapon) {
      this.weapon = s.w;
      this.fighter.loadout.current = s.w;
      this.character.setWeapon(s.w);
    }
    if (Number.isFinite(s.hp)) this.fighter.health = s.hp;
    if (s.roster) this.roster = s.roster;
    if (s.away !== undefined) this.away = !!s.away;
    if ('car' in s) this.carId = Number.isFinite(s.car) ? s.car : undefined;
    if (s.alive === false && this.fighter.alive) {
      this.fighter.alive = false;
      this.character.die(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
    } else if (s.alive === true && !this.fighter.alive) {
      this.fighter.alive = true;
      this.fighter.health = Number.isFinite(s.hp) ? s.hp : 100;
      this.character.revive();
    }
  }

  tick(dt) {
    this.body.lerp(this.target, 1 - Math.exp(-dt * 14));
    this.yaw += wrap(this.targetYaw - this.yaw) * Math.min(1, dt * 10);
    this.lookYaw = this.yaw;
    this.lookPitch = this.pitch;
    const fleet = this.cars || null;
    if (Number.isFinite(this.carId) && fleet) {
      const car = fleet.byId(this.carId);
      if (car) {
        this.vehicle = car;
        car.driver = this.fighter;
        car.remote = true;
        car.x = this.body.x;
        car.y = this.body.y;
        car.z = this.body.z;
        car.yaw = this.yaw;
        car.speed = this.speed;
        fleet.refreshSeat(car);
        fleet.placeMesh(car);
        this.pos.copy(car.seat);
      } else {
        this.pos.copy(this.body);
      }
    } else {
      if (this.vehicle) {
        if (this.vehicle.driver === this.fighter) this.vehicle.driver = null;
        this.vehicle = null;
      }
      this.pos.copy(this.body);
    }
    const ch = this.character;
    ch.root.position.copy(this.pos);
    const swimming = hasSea() && this.pos.y < 0.15;
    const inCar = this.vehicle && this.vehicle.kind !== 'scooter';
    if (!ch.dead) {
      ch.root.rotation.order = 'YXZ';
      ch.root.rotation.x = swimming && this.pos.y < -1.6 ? 0.9 : swimming ? 0.3 : 0;
      ch.root.rotation.y = this.yaw;
      ch.root.rotation.z = 0;
    }
    const look = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch || 0),
      Math.sin(this.pitch || 0),
      Math.cos(this.yaw) * Math.cos(this.pitch || 0),
    );
    const aimPoint = this.pos.clone().addScaledVector(look, 20).setY(this.pos.y + 1.4);
    if (this.vehicle) ch.steer = this.vehicle.steer || 0;
    if (!!inCar !== !!this.gunsStowed) { // guns go away behind the wheel and come back out after
      this.gunsStowed = !!inCar;
      if (ch.rifle) ch.rifle.visible = !inCar;
      ch.pistols?.forEach((p) => { p.visible = !inCar; });
    }
    ch.update(dt, {
      speed: this.vehicle ? 0 : this.speed,
      seat: inCar ? driverPose(this.vehicle) : null,
      onGround: this.onGround,
      airTime: this.onGround ? 0 : 0.4,
      strafe: this.aiming,
      localDir: new THREE.Vector3(0, 0, 1),
      jumpStarted: false,
      predictedAir: 0.6,
      aiming: this.aiming && !swimming,
      aimPoint,
      lookDir: look,
      crouch: this.crouch,
      swimming,
      diving: swimming && this.pos.y < -1.5,
    });
  }

  dispose(scene) {
    const drop = (o) => { if (o) o.removeFromParent(); };
    drop(this.character.root);
    drop(this.character.rifle);
    drop(this.character.grenade);
    drop(this.character.braid);
    this.character.pistols?.forEach(drop);
    this.character.holsters?.forEach((h) => { drop(h.holster); drop(h.band); });
  }
}

export class Session {
  constructor({ net, world, combat, weapons, player, rivals, charAssets, scene, spawn, facing, mapId, slotSpawn, onRoster, onRound, onSettings, onHost }) {
    this.net = net;
    this.world = world;
    this.combat = combat;
    this.weapons = weapons;
    this.player = player;
    this.rivals = rivals;
    this.charAssets = charAssets;
    this.scene = scene;
    this.spawn = spawn;
    this.facing = facing;
    this.mapId = mapId;
    this.slotSpawn = slotSpawn;
    this.onRoster = onRoster;
    this.onRound = onRound;
    this.onSettings = onSettings;
    this.onHost = onHost;
    this.remotes = new Map();
    this.pending = new Map();
    this.drones = new Map();
    world.netDrones = this.drones;
    world.session = this;
    this.poseAcc = 0;
    this.lastPoseKey = '';
    this.lastPoseAt = 0;
    this.lastDroneKey = '';
    this.lastDroneAt = 0;
    this.wantReady = false;
    this.readySent = false;
    this.botsParked = false;
    this.wanted = !!net.wanted;
    this.hostId = '';
    this.minPlayers = 2;
    this.slot = 0;
    weapons.session = this;
  }

  get isHost() { return !this.wanted || !this.hostId || this.hostId === this.net.id; }

  get multi() { return this.wanted && this.net.status === 'online'; }
  get peerCount() { return this.remotes.size; }

  connect(identity) {
    if (!this.wanted) return;
    this.net.connect({ ...identity, map: this.mapId, time: identity.time, min: identity.min });
  }

  update(dt) {
    for (const msg of this.net.take()) this.handle(msg);
    if (this.net.status === 'online') this.sendPose(dt);
    if (this.wantReady && !this.readySent && this.net.status === 'online') {
      this.net.send({ t: 'ready' });
      this.readySent = true;
    }
    for (const r of this.remotes.values()) r.tick(dt);
    for (const d of this.drones.values()) d.tick(dt, this.world.terrain);
    this.syncBots();
  }

  sendPose(dt) {
    this.poseAcc += dt;
    const force = dt >= 1;
    if (this.poseAcc < (force ? 1 : 1 / 8)) return;
    this.poseAcc = 0;
    const p = this.player;
    const L = p.fighter.loadout;
    const body = p.vehicle || p.pos;
    const msg = {
      t: 'pose',
      p: [+body.x.toFixed(2), +body.y.toFixed(2), +body.z.toFixed(2)],
      yaw: +p.yaw.toFixed(3),
      pitch: +p.camPitch.toFixed(3),
      spd: +(p.vehicle ? p.vehicle.speed : Math.hypot(p.vel.x, p.vel.z)).toFixed(2),
      g: p.onGround,
      cr: +p.crouchT.toFixed(2),
      aim: p.aimHold > 0 || p.scoped,
      w: L.current,
      alive: p.fighter.alive,
      car: Number.isFinite(p.vehicle?.id) ? p.vehicle.id : null,
    };
    const key = `${msg.p}|${msg.yaw}|${msg.pitch}|${msg.spd}|${msg.g}|${msg.cr}|${msg.aim}|${msg.w}|${msg.alive}|${msg.car}`;
    const now = performance.now();
    // Standing still: at most a 2s heartbeat so idle sockets stay alive.
    if (!force && key === this.lastPoseKey && now - this.lastPoseAt < 2000) return;
    this.lastPoseKey = key;
    this.lastPoseAt = now;
    this.net.send(msg);
  }

  reportShot(o, d, w, hid, head) {
    if (!this.multi) return;
    this.shotSeq = (this.shotSeq || 0) + 1;
    this.net.send({
      t: 'shot',
      n: this.shotSeq,
      o: [o.x, o.y, o.z],
      d: [d.x, d.y, d.z],
      w,
      hid: hid || undefined,
      head: !!head,
    });
  }

  reportNade(pos, vel) {
    if (!this.multi) return;
    this.net.send({
      t: 'nade',
      o: [pos.x, pos.y, pos.z],
      v: [vel.x, vel.y, vel.z],
    });
  }

  reportBlast(hits, w = 'grenade') {
    if (!this.multi || !hits.length) return;
    this.net.send({ t: 'blast', w, hits });
  }

  reportCar(action, extra = {}) {
    if (!this.multi) return;
    this.net.send({ t: 'car', a: action, ...extra });
  }

  reportRunover(victim, dir) {
    if (!this.multi || !victim) return;
    const id = victim.isPlayer ? this.net.id : victim.id;
    if (!id) return;
    this.net.send({
      t: 'runover',
      hid: id,
      dir: dir ? [dir.x, dir.y, dir.z] : undefined,
    });
  }

  reportDrone(action, extra = {}) {
    if (!this.multi) return;
    if (action === 'pose' && extra.p) {
      const key = `${extra.p}|${extra.yaw}|${extra.pitch}`;
      const now = performance.now();
      if (key === this.lastDroneKey && now - this.lastDroneAt < 250) return;
      this.lastDroneKey = key;
      this.lastDroneAt = now;
    }
    this.net.send({ t: 'drone', a: action, ...extra });
  }

  ready() {
    this.wantReady = true;
    this.readySent = false;
  }

  beginRound(msg) {
    this.wantReady = false;
    this.readySent = false;
    for (const r of this.remotes.values()) {
      r.fighter.health = 100;
      r.fighter.alive = true;
      r.character.revive();
      r.fighter.loadout?.reset();
      r.weapon = 'pistols';
      r.character.setWeapon('pistols');
    }
    this.clearDrones();
    this.world.cars?.reset();
    if (msg.cars) this.world.cars?.applyFleet(msg.cars);
    (msg.peers || []).forEach((p) => this.upsert(p));
  }

  clearDrones() {
    for (const d of this.drones.values()) d.dispose();
    this.drones.clear();
  }

  placeLocal(slot = this.slot) {
    if (this.mapId === 'garden') {
      const s = standSpawn(slot);
      this.player.spawn(s.x, s.z, s.yaw);
    } else if (getMap(this.mapId).cityFolder) {
      const s = this.slotSpawn?.(slot) || studioSlotSpawn(this.spawn, slot);
      this.player.spawn(s.x, s.z, s.yaw);
    } else {
      const ang = slot * 2.15;
      const x = this.spawn.x + Math.sin(ang) * 14;
      const z = this.spawn.z + Math.cos(ang) * 14;
      this.player.spawn(x, z, ang + Math.PI);
    }
    this.player.vel.set(0, 0, 0);
  }

  handle(msg) {
    switch (msg.t) {
      case 'hello':
        this.slot = msg.slot || 0;
        this.player.fighter.id = msg.id;
        this.hostId = msg.hostId || (msg.host ? msg.id : this.hostId);
        if (msg.settings) this.onSettings?.(msg.settings);
        if (msg.cars) this.world.cars?.applyFleet(msg.cars);
        if (msg.map && msg.map !== this.mapId) {
          localStorage.setItem('relic-map', msg.map);
          location.reload();
          return;
        }
        (msg.peers || []).forEach((p) => this.upsert(p));
        if (msg.round) this.onRound?.(msg.round);
        this.readySent = false;
        this.onHost?.(this.isHost);
        break;
      case 'settings':
        this.hostId = msg.hostId || this.hostId;
        this.onSettings?.(msg);
        this.onHost?.(this.isHost);
        if (msg.map && msg.map !== this.mapId) {
          localStorage.setItem('relic-map', msg.map);
          location.reload();
        }
        break;
      case 'map':
        if (msg.id && msg.id !== this.mapId) {
          localStorage.setItem('relic-map', msg.id);
          location.reload();
        }
        break;
      case 'away':
        if (this.remotes.has(msg.id)) this.remotes.get(msg.id).away = true;
        break;
      case 'back':
        if (this.remotes.has(msg.id)) this.remotes.get(msg.id).away = false;
        break;
      case 'join':
      case 'peer':
        this.upsert(msg);
        break;
      case 'leave':
        this.remove(msg.id);
        break;
      case 'pose':
        if (this.remotes.has(msg.id)) this.remotes.get(msg.id).applySnap(msg);
        else if (this.pending.has(msg.id)) Object.assign(this.pending.get(msg.id), msg);
        else this.upsert(msg);
        break;
      case 'shot':
        this.seeShot(msg);
        break;
      case 'nade':
        this.seeNade(msg);
        break;
      case 'hit':
      case 'kill':
        this.applyAuth(msg);
        break;
      case 'round':
        this.onRound?.(msg);
        break;
      case 'drone':
        this.seeDrone(msg);
        break;
      case 'car':
        this.seeCar(msg);
        break;
      default:
        break;
    }
  }

  upsert(snap) {
    if (!snap?.id || snap.id === this.net.id) return;
    const cur = this.remotes.get(snap.id);
    if (cur) {
      cur.cars = this.world.cars;
      if (snap.roster && snap.roster !== cur.roster) this.restyle(cur, snap);
      else cur.applySnap(snap);
      if (snap.drone?.p) this.upsertDrone(snap.id, snap.drone);
      this.onRoster?.();
      return;
    }
    if (this.pending.has(snap.id)) {
      Object.assign(this.pending.get(snap.id), snap);
      return;
    }
    this.pending.set(snap.id, { ...snap });
    this.spawnRemote(snap);
  }

  async restyle(remote, snap) {
    const entry = byId(snap.roster) || byId('adventurer');
    const [look] = await resolveLooks([entry]);
    remote.dispose(this.scene);
    const ch = new Character();
    ch.load(this.charAssets, look);
    ch.addTo(this.scene);
    ch.equipT = 1;
    remote.character = ch;
    remote.fighter.character = ch;
    remote.fighter.name = snap.name || entry.name;
    remote.fighter.color = snap.color || entry.color;
    remote.roster = entry.id;
    remote.applySnap(snap);
  }

  async spawnRemote(snap) {
    const entry = byId(snap.roster) || byId('adventurer');
    const [look] = await resolveLooks([entry]);
    if (!this.pending.has(snap.id)) return;
    const latest = { ...snap, ...this.pending.get(snap.id) };
    const ch = new Character();
    ch.load(this.charAssets, look);
    ch.addTo(this.scene);
    ch.equipT = 1;
    const pos = vec(latest.p, [this.spawn.x, 2, this.spawn.z]);
    const fighter = this.combat.add({
      id: latest.id, name: latest.name || entry.name, character: ch, pos, color: latest.color || entry.color,
    });
    fighter.net = true;
    fighter.loadout = new Loadout(3);
    fighter.loadout.current = latest.w || 'pistols';
    ch.setWeapon(fighter.loadout.current);
    const remote = new Remote(latest, fighter, ch);
    remote.cars = this.world.cars;
    this.remotes.set(latest.id, remote);
    this.pending.delete(snap.id);
    if (latest.drone?.p) this.upsertDrone(latest.id, latest.drone);
    this.onRoster?.();
  }

  remove(id) {
    this.pending.delete(id);
    this.dropDrone(id);
    const r = this.remotes.get(id);
    if (!r) return;
    r.dispose(this.scene);
    this.combat.fighters = this.combat.fighters.filter((f) => f !== r.fighter);
    this.remotes.delete(id);
    this.onRoster?.();
  }

  upsertDrone(id, snap) {
    if (!id || id === this.net.id) return;
    let d = this.drones.get(id);
    if (!d) {
      d = new RemoteDrone(this.scene, this.world.fx, this.weapons.audio, id);
      this.drones.set(id, d);
    }
    d.apply(snap.p, snap.yaw, snap.pitch);
  }

  dropDrone(id) {
    const d = this.drones.get(id);
    if (!d) return;
    d.dispose();
    this.drones.delete(id);
  }

  seeCar(msg) {
    const cars = this.world.cars;
    if (!cars || !Number.isFinite(msg.i)) return;
    const driver = msg.id ? this.fighter(msg.id) : null;
    cars.applySnap(msg.i, msg, driver);
    const remote = this.remotes.get(msg.id);
    if (remote) {
      if (msg.a === 'in') remote.carId = msg.i;
      if (msg.a === 'out') {
        remote.carId = undefined;
        if (remote.vehicle) {
          if (remote.vehicle.driver === remote.fighter) remote.vehicle.driver = null;
          remote.vehicle = null;
        }
      }
    }
  }

  seeDrone(msg) {
    if (!msg.id || msg.id === this.net.id) {
      if (msg.a === 'down' && msg.id === this.net.id) this.weapons.drone.kill(this.fighter(msg.aid));
      return;
    }
    if (msg.a === 'go' || msg.a === 'pose') {
      this.upsertDrone(msg.id, msg);
      return;
    }
    const d = this.drones.get(msg.id);
    if (msg.a === 'down') {
      if (d) d.kill(this.fighter(msg.aid));
      else this.dropDrone(msg.id);
      return;
    }
    if (msg.a === 'boom') {
      if (d) d.explode();
      this.drones.delete(msg.id);
    }
  }

  fighter(id) {
    if (id === this.net.id || id === this.player.fighter.id) return this.player.fighter;
    return this.remotes.get(id)?.fighter || null;
  }

  applyAuth(msg) {
    const vic = this.fighter(msg.vid);
    const atk = this.fighter(msg.aid);
    if (!vic) return;
    const dir = vec(msg.dir, [0, 0, 1]);
    if (!dir.lengthSq()) dir.set(0, 0, 1);
    dir.normalize();
    if (msg.t === 'kill') {
      // Server health is authoritative. Local HP is often still full because
      // remote hits skip client damage, so a 9-damage kill would only flinch.
      if (vic.alive) {
        this.combat.damage(vic, atk, Math.max(msg.amt || 0, vic.health || 0, 1), dir, { head: !!msg.head, weapon: msg.w });
      }
      vic.health = 0;
      vic.alive = false;
      if (!vic.character?.dead) vic.character?.die(dir);
    } else {
      this.combat.damage(vic, atk, msg.amt, dir, { head: msg.head, weapon: msg.w });
      if (Number.isFinite(msg.hp)) vic.health = msg.hp;
    }
    this.onFeed?.(msg, vic, atk);
  }

  seeShot(msg) {
    const r = this.remotes.get(msg.id);
    if (!r) return;
    const from = vec(msg.o);
    const dir = vec(msg.d, [0, 0, 1]);
    if (!dir.lengthSq()) dir.set(Math.sin(r.yaw || 0), 0, Math.cos(r.yaw || 0));
    if (!dir.lengthSq()) return;
    dir.normalize();
    const ch = r.character;
    const rifle = msg.w === 'rifle';
    const flash = rifle && ch.rifleMuzzle ? ch.rifleMuzzle() : ch.muzzleWorld?.(0) || from;
    this.world.fx.muzzle(flash, dir, rifle ? 2.4 : 1);
    if (!rifle) ch.fired?.(0);
    const wall = this.world.shots?.raycast(from, dir, 900); // glass behind a wall the round hit stays whole
    this.world.cars?.breakAlong(from, dir, wall ? wall.t : 900, r.fighter, { silent: true });
    const hit = this.world.raycast(from, dir, 900, r.fighter);
    const end = hit ? from.clone().addScaledVector(dir, hit.t) : from.clone().addScaledVector(dir, 80);
    this.world.fx.tracer(flash, end);
    const dist = from.distanceTo(this.player.pos);
    this.weapons.audio.gunshot(0, dist, (from.x - this.player.pos.x) / Math.max(dist, 1), rifle);
  }

  seeNade(msg) {
    const owner = this.fighter(msg.id);
    if (!owner) return;
    this.weapons.throwGrenade(owner, vec(msg.o), vec(msg.v), { silent: true });
  }

  syncBots() {
    if (!this.rivals.length) return;
    const hide = this.wanted;
    if (hide === this.botsParked) return;
    this.botsParked = hide;
    for (const r of this.rivals) {
      if (hide) {
        r.fighter._parked = r.fighter.alive;
        r.fighter.alive = false;
      } else if (r.fighter._parked) {
        r.fighter.alive = true;
        r.fighter._parked = false;
      }
      r.character.root.visible = !hide;
      if (r.character.rifle) r.character.rifle.visible = !hide;
      r.character.pistols?.forEach((p) => { p.visible = !hide; });
    }
  }

  humansAlive() {
    let n = this.player.fighter.alive ? 1 : 0;
    for (const r of this.remotes.values()) if (r.fighter.alive) n++;
    return n;
  }
}
