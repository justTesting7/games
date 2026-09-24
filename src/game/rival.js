import * as THREE from 'three';
import { Loadout, WEAPONS, Weapons } from './weapons.js';

const GRAVITY = 16;
const JUMP_V = 5.0;
const RADIUS = 0.3;
const UP = new THREE.Vector3(0, 1, 0);
const SHELTER_SPRINT = 7.4;
const EXPOSE_LIMIT = 1.15;
const COVER_PAD = RADIUS + 0.5;
const SEARCH_R = 40;

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;

export const TACTICS = {
  push: { label: 'pushing', text: 'close the distance on the target and shoot on the move' },
  strafe: { label: 'strafing', text: 'sidestep left and right at the current range while shooting' },
  hold: { label: 'holding', text: 'stand still and take slow, accurate shots' },
  flank: { label: 'flanking', text: 'circle around the target to attack from the side' },
  take_cover: { label: 'taking cover', text: 'sprint to solid cover first, then peek and shoot from safety' },
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
    this.tactic = 'take_cover';
    this.target = null;
    this.confidence = 0;
    this.source = 'local';
    this.thinkT = 0.2 + Math.random() * 0.5;
    this.thinking = false;
    this.epoch = (this.epoch || 0) + 1;
    this.perceiveT = 0;
    this.cooldown = 0.5;
    this.burst = 3;
    this.burstPause = 0;
    this.side = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 1;
    this.flankSide = Math.random() < 0.5 ? 1 : -1;
    this.errT = 0;
    this.cover = null;
    this.reachedShelter = false;
    this.needFirstCover = true;
    this.exposedT = 0;
    this.safeT = 0;
    this.runningToShelter = true;
    this.coverScanT = 0;
    this.droneSightT = 0;
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

  spawn(x, z, yaw) {
    this.pos.set(x, this.world.terrain.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
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
    if (h < 0.15) return null;
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

  findCover(threat, { mustHide = true } = {}) {
    if (!threat) return null;
    const cols = this.world.veg.colliders.query(this.pos.x, this.pos.z, SEARCH_R, this.cols);
    let best = null, bestS = Infinity;
    for (const c of cols) {
      if (!this.coverUsable(c)) continue;
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

  canFight() {
    return !this.needFirstCover && this.reachedShelter && !this.runningToShelter && this.onFarSide(this.anyThreat());
  }

  inDanger() {
    if (this.needFirstCover) return true;
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
    if (!this.inDanger()) return false;
    return !this.onFarSide(this.anyThreat());
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
    if (anyVisible) ['push', 'strafe', 'hold', 'flank', 'retreat'].forEach(offer);
    else ['hunt', 'hold'].forEach(offer);
    if (cover || this.shouldShelter()) offer('take_cover');

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
        instructions: `You are ${me.name}, ${this.persona.personality}. Get to cover first, then fight from it. Do not stand in the open while shots are flying. Last one standing wins. Pick your tactic for the next second, in character.`,
        criteria: options,
      },
    };
    if (enemies.length > 1) {
      const crit = {};
      enemies.forEach((e) => { crit[e.id] = `${e.name}${e.isPlayer ? ' (the human player)' : ''}`; });
      questions.target = {
        type: 'choice',
        instructions: `You are ${me.name}. Which enemy should you fight right now? Prefer enemies you can see, that threaten you, or that are weak.`,
        criteria: crit,
      };
    }

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
      this.thinkT = 0.8 + Math.random() * 0.5;
    });
  }

  decide(ans, options, enemies, cover) {
    const alive = enemies.filter((e) => e.alive);
    if (!alive.length) return;
    let target = null;
    if (ans?.target) target = alive.find((e) => e.id === ans.target.choice);
    if (!target && alive.length === 1) target = alive[0];
    if (!target) target = this.localTarget(alive);
    this.setTarget(target);

    if (this.needFirstCover || this.shouldShelter()) {
      this.source = this.source === 'jev' ? 'jev' : 'local';
      this.setTactic('take_cover', cover);
      return;
    }

    const t = ans?.tactic;
    const seen = this.enemies().some((e) => this.seen(e).visible);
    const holdCover = this.reachedShelter && this.cover && (seen || this.shotsFlying() || this.underFire());
    if (holdCover && t && (t.choice === 'push' || t.choice === 'hunt' || t.choice === 'flank')) {
      this.source = 'local';
      this.setTactic(seen ? (Math.random() < 0.5 ? 'hold' : 'strafe') : 'take_cover', cover);
      return;
    }

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

  localTarget(alive) {
    let best = null, bestS = Infinity;
    for (const e of alive) {
      const m = this.seen(e);
      const s = e.pos.distanceTo(this.pos) * (m.visible ? 1 : 2.5) + e.health * 0.1 - (this.fighter.lastAttacker === e ? 15 : 0);
      if (s < bestS) { bestS = s; best = e; }
    }
    return best;
  }

  localTactic(options, cover) {
    const me = this.fighter;
    const visible = this.target && this.seen(this.target).visible;
    if (this.shouldShelter()) return cover ? 'take_cover' : 'retreat';
    if (this.reachedShelter && cover) {
      if (!visible) return 'take_cover';
      return Math.random() < 0.55 ? 'hold' : 'strafe';
    }
    if (!visible) return this.shotsFlying() && cover ? 'take_cover' : 'hunt';
    const d = this.target.pos.distanceTo(this.pos);
    if (me.health < 35) return cover ? 'take_cover' : 'retreat';
    if (!this.shotsFlying() && !this.underFire() && d > 28) return 'push';
    return cover ? 'take_cover' : 'hold';
  }

  setTarget(t) {
    if (t === this.target) return;
    this.target = t;
    const m = t ? this.seen(t) : null;
    if (m) m.sightT = Math.min(m.sightT, 0.1);
  }

  setTactic(t, cover) {
    if (t === 'take_cover') this.cover = cover || this.cover || this.findCover(this.threatPos()) || this.findNearestBulk(this.threatPos());
    if (t === this.tactic) return;
    this.tactic = t;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 0.6 + Math.random();
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
    this.coverScanT = (this.coverScanT || 0) - dt;
    if (threat && (this.coverScanT <= 0 || !this.cover)) {
      this.coverScanT = this.runningToShelter ? 0.45 : 0.2;
      const found = this.pickCover(threat);
      if (found) this.cover = found;
    }
    if (threat && this.cover && !this.isSheltered(threat)) {
      const spot = this.coverSpot(this.cover.c, threat);
      if (spot) this.cover.spot.copy(spot);
    }
    const anySeen = this.enemies().some((e) => this.seen(e).visible);
    const shots = this.underFire() || this.shotsFlying();
    if (!anySeen && !shots) {
      this.exposedT = 0;
      if (this.safeT > 3.5) this.reachedShelter = false;
    }
    const sheltered = this.onFarSide(threat);
    if (sheltered) {
      this.safeT += dt;
      this.exposedT = 0;
      if (this.safeT > 0.2) {
        this.reachedShelter = true;
        this.runningToShelter = false;
        this.needFirstCover = false;
      }
    } else {
      this.exposedT += dt;
      this.safeT = 0;
      if (this.shouldShelter()) this.reachedShelter = false;
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
      out.aim = false;
      this.runningToShelter = true;
      this.reachedShelter = false;
      return;
    }
    const dest = this.coverSpot(c.c, tp) || c.spot;
    c.spot.copy(dest);
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
    const to = new THREE.Vector3(via.x - this.pos.x, 0, via.z - this.pos.z);
    const len = to.length() || 1;
    out.dir.copy(to).divideScalar(len);
    out.speed = SHELTER_SPRINT;
    out.aim = false;
    this.runningToShelter = true;
    this.reachedShelter = false;
  }

  // Turns the tactic into a movement wish for this frame.
  steer(dt) {
    const out = { dir: new THREE.Vector3(), speed: 0, aim: false, jump: false };
    const T = this.target;
    const tp = this.anyThreat() || (T ? T.pos : null);
    this.updateShelter(dt, tp);
    if (!tp) return out;
    const m = T ? this.seen(T) : { visible: false };
    const to = new THREE.Vector3(tp.x - this.pos.x, 0, tp.z - this.pos.z);
    const d = to.length() || 1;
    to.divideScalar(d);
    const side = new THREE.Vector3(to.z, 0, -to.x);
    const visible = !!(T && m.visible);
    out.aim = visible && d < 70 && this.canFight();

    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = 0.7 + Math.random() * 1.4; }

    const exposed = this.needFirstCover || this.shouldShelter() || this.runningToShelter;
    if (exposed || this.tactic === 'take_cover') {
      this.steerToCover(out, tp, side, visible);
      if (exposed && !this.onFarSide(tp)) {
        out.aim = false;
        out.speed = SHELTER_SPRINT;
      }
    } else switch (this.tactic) {
      case 'push':
        if (d > 7) { out.dir.copy(to).addScaledVector(side, this.strafeDir * 0.35); out.speed = visible ? 3.6 : 4.8; }
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
        out.dir.copy(side).multiplyScalar(this.flankSide).addScaledVector(to, d > 14 ? 0.6 : d < 8 ? -0.3 : 0.1);
        out.speed = 4.2;
        break;
      case 'retreat':
        out.dir.copy(to).negate().addScaledVector(side, this.strafeDir * 0.5);
        out.speed = SHELTER_SPRINT;
        break;
      case 'hunt':
      default:
        if (d > 4) { out.dir.copy(to); out.speed = d > 15 ? 4.6 : 3.2; }
        out.aim = visible && this.canFight() && !this.shouldShelter();
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
    if (this.detour > 0) {
      this.detour -= dt;
      out.dir.applyAxisAngle(UP, this.detourAngle);
      out.speed = Math.max(out.speed, 3);
    }
    return out;
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
    if (!drone || drone.dying || !this.canFight()) return false;
    if ((drone.born || 0) < 0.85) return false;
    const from = this.droneEye();
    const len = from.distanceTo(drone.pos);
    if (len < 6 || len > 30) return false;
    return this.droneLosClear(from, drone.pos);
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
    if (this.needFirstCover || !this.canFight() || this.fighter.loadout.current === 'grenade') {
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
    if (this.needFirstCover || !this.canFight() || L.current === 'grenade') return;
    if (this.tryShootDrone(dt)) return;
    if (!T || !wish.aim) return;
    const m = this.seen(T);
    const rifle = L.current === 'rifle';
    if (!m.visible || m.sightT < this.persona.reaction + (rifle ? 0.3 : 0)) return;
    if (this.character.aimWeight < 0.85) return;
    const want = Math.atan2(this.aimPoint.x - this.pos.x, this.aimPoint.z - this.pos.z);
    if (Math.abs(wrapAngle(want - this.yaw)) > 0.3) return;
    if (this.burstPause > 0) { this.burstPause -= dt; return; }
    if (this.cooldown > 0) return;
    if (!this.weapons.trigger(this.fighter, this.aimPoint, rifle ? 0.0015 : 0.004)) return;
    if (rifle) {
      this.cooldown = 0.3 + Math.random() * 0.5;
      return;
    }
    this.cooldown = this.persona.fireInterval * (0.8 + Math.random() * 0.4);
    if (--this.burst <= 0) {
      this.burst = 3 + Math.floor(Math.random() * 4);
      this.burstPause = this.tactic === 'hold' ? 0.3 + Math.random() * 0.4 : 0.5 + Math.random() * 0.8;
    }
  }

  move(dt, wish) {
    const { terrain } = this.world;
    const horiz = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const desired = wish.dir.clone().multiplyScalar(wish.speed);
    const accel = this.onGround ? (wish.speed >= SHELTER_SPRINT ? 18 : wish.speed > horiz.length() ? 8 : 11) : 1.5;
    horiz.lerp(desired, Math.min(1, dt * accel));
    this.vel.x = horiz.x;
    this.vel.z = horiz.z;

    let jumpStarted = false;
    if (wish.jump && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
      jumpStarted = true;
    }
    this.vel.y -= GRAVITY * dt;

    const next = this.pos.clone().addScaledVector(this.vel, dt);
    const ground = terrain.heightAt(next.x, next.z);
    const n = terrain.normalAt(next.x, next.z);
    const uphill = n.x * this.vel.x + n.z * this.vel.z < 0;
    let blocked = false;
    if ((n.y < 0.62 && uphill && ground > this.pos.y + 0.05) || ground < 0.1 || !terrain.inBounds(next.x, next.z)) {
      next.x = this.pos.x;
      next.z = this.pos.z;
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
      blocked = true;
    }
    this.world.veg.colliders.resolveXZ(next, RADIUS, next.y, next.y + 1.7);
    this.world.props.collidePlayer(next, RADIUS, this.vel);
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
        this.detour = 0.9 + Math.random() * 0.6;
        this.detourAngle = (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random() * 0.8);
        if (!blocked && this.onGround && Math.random() < 0.4) jumpStarted = this.forceJump();
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

  update(dt, active) {
    const ch = this.character;
    if (!this.fighter.alive) {
      ch.root.position.copy(this.pos);
      ch.update(dt, {});
      return;
    }
    if (active) this.handleWeapons();
    let wish = { dir: new THREE.Vector3(), speed: 0, aim: false, jump: false };
    if (active) {
      this.perceive(dt);
      if (!this.target || !this.target.alive) this.setTarget(this.localTarget(this.enemies()));
      // Getting shot or losing the target calls for a quick rethink.
      if (this.combat.time - this.fighter.lastHitT < dt * 1.5) this.thinkT = Math.min(this.thinkT, 0.12);
      this.thinkT -= dt;
      if (this.thinkT <= 0 && !this.thinking) this.think();
      if (this.target && !this.enemies().includes(this.target)) this.target = null;
      wish = this.steer(dt);
    }
    this.updateAim(dt, wish);
    const jumpStarted = this.move(dt, wish);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (wish.aim) {
      const want = Math.atan2(this.aimPoint.x - this.pos.x, this.aimPoint.z - this.pos.z);
      const err = wrapAngle(want - this.yaw);
      this.yaw += Math.sign(err) * Math.min(Math.abs(err), Math.max(Math.abs(err) * 10, 4) * dt);
    } else if (speed > 0.4) {
      this.yaw += wrapAngle(Math.atan2(this.vel.x, this.vel.z) - this.yaw) * Math.min(1, dt * 8);
    }
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    if (speed > 0.05) this.localDir.set(this.vel.x * left.x + this.vel.z * left.z, 0, this.vel.x * fwd.x + this.vel.z * fwd.z).normalize();

    if (wish.aim) this.lookPoint.copy(this.aimPoint);
    else this.lookPoint.copy(this.pos).addScaledVector(fwd, 10).setY(this.pos.y + 1.5);
    ch.root.position.copy(this.pos);
    ch.root.rotation.y = this.yaw;
    ch.update(dt, {
      speed, onGround: this.onGround, airTime: this.airTime, strafe: wish.aim, localDir: this.localDir,
      jumpStarted, predictedAir: (2 * JUMP_V) / GRAVITY, aiming: wish.aim, aimPoint: this.lookPoint,
    });
    if (active) this.shoot(dt, wish);
    this.weapons.tick(this.fighter, dt);
  }

  get label() { return TACTICS[this.tactic].label; }
}
