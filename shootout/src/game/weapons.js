import * as THREE from 'three';
import { LIMB_DAMAGE } from './combat.js';
import { hasSea } from './swim.js';
import { Character } from './character.js';
import { SuicideDrone } from './drone.js';

export const WEAPONS = {
  pistols: {
    key: 'pistols', name: 'Dual pistols', short: 'pistols', slot: 1, auto: true,
    mag: 16, reserve: 96, reload: 1.7, interval: 0.13, body: 9, head: 30, spread: 0.0035, hipSpread: 0.0035, force: 4.5,
  },
  rifle: {
    key: 'rifle', name: '7.62 Sniper', short: 'sniper', slot: 2, auto: false,
    mag: 5, reserve: 15, reload: 2.9, interval: 1.35, body: 80, head: 200, spread: 0.00012, hipSpread: 0.05, force: 18,
  },
  grenade: {
    key: 'grenade', name: 'Stick grenades', short: 'grenade', slot: 3,
    count: 3, fuse: 3.4, radius: 8, damage: 120,
    speed: 16, speedMin: 7, speedMax: 24, chargeMax: 1.35,
  },
  drone: {
    key: 'drone', name: 'Suicide drone', short: 'drone', slot: 4,
    count: 10, radius: 9.5, damage: 150,
  },
  knife: {
    // a stab lands mid-thrust on whoever is within reach in front; from behind it kills
    key: 'knife', name: 'Combat knife', short: 'knife', slot: 5, melee: true,
    interval: 0.55, body: 55, back: 200, reach: 2.0, cone: 0.6,
  },
  car: { key: 'car', name: 'Car', short: 'car' },
};
export const SLOTS = ['pistols', 'rifle', 'grenade', 'drone', 'knife'];
const THROW_DUR = 0.8;
const THROW_RELEASE = 0.42;
const GRAVITY = 9.8;

export class Loadout {
  constructor(grenades = WEAPONS.grenade.count) {
    this.maxGrenades = grenades;
    this.reset();
  }

  reset() {
    this.current = 'pistols';
    this.mag = { pistols: WEAPONS.pistols.mag, rifle: WEAPONS.rifle.mag };
    this.reserve = { pistols: WEAPONS.pistols.reserve, rifle: WEAPONS.rifle.reserve };
    this.grenades = this.maxGrenades;
    this.drones = WEAPONS.drone.count;
    this.reloadT = 0;
    this.cooldown = 0;
    this.autoReload = 0;
    this.side = 0;
    this.throwVel = new THREE.Vector3();
    this.ejected = true;
  }

  has(key) {
    if (key === 'knife') return true;
    if (key === 'grenade') return this.grenades > 0;
    if (key === 'drone') return this.drones > 0;
    return this.mag[key] + this.reserve[key] > 0;
  }

  get reloading() { return this.reloadT > 0; }
}

const tmp = new THREE.Vector3();

// Arms and legs take less than the torso. Networked victims keep the room's body damage
// (the server scores those hits and only hears head or body).
function shotDamage(def, hit) {
  const through = Math.pow(0.6, hit.pierced || 0); // each layer it punched through
  if (hit.head) return Math.round(def.head * through);
  return Math.round((hit.limb && !hit.fighter?.net ? def.body * LIMB_DAMAGE : def.body) * through);
}

/** What a round goes through: a rifle punches wood, glass and car bodies, a pistol only glass. */
function pierceable(hit, rifle) {
  if (hit.surface === 'glass') return true;
  return rifle && (hit.surface === 'wood' || hit.surface === 'target' || !!hit.car);
}

export class Weapons {
  constructor(world, player, character, fx, audio, combat) {
    this.world = world;
    this.player = player;
    this.character = character;
    this.fx = fx;
    this.audio = audio;
    this.combat = combat;
    this.queued = 0;
    this.sniperHeld = false;
    this.sniperWasScoped = false;
    this.onHit = null;
    this.onNearMiss = null;
    this.onExplosion = null;
    this.live = [];
    this.template = null;
    this.grenadeCharge = 0;
    this.chargingGrenade = false;
    this.pendingThrow = 0;
    this.session = null;
    this.pendingCharge = 0;
    this.previewVel = new THREE.Vector3();
    this.drone = new SuicideDrone(world, fx, audio, combat, fx.pipeline.scene);
    world.drone = this.drone;

    const n = 64;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.arc = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 1.9, 1.3) }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.9, 1.3) }));
    this.markerMat = this.marker.material;
    this.arcMat = this.arc.material;
    this.marker.visible = false;
    fx.pipeline.scene.add(this.arc, this.marker);
  }

  setGrenadeModel(gltf) { this.template = Character.grenadeModel(gltf); }

  // --- Shared by the player and the rivals ---------------------------------

  equip(f, key) {
    const L = f.loadout;
    if (key === L.current || !L.has(key)) return false;
    if (f.isPlayer) {
      this.chargingGrenade = false; this.grenadeCharge = 0; this.pendingThrow = 0;
      this.sniperHeld = false; this.sniperWasScoped = false;
      if (this.player) this.player.sniperPending = false;
      if (key !== 'drone' && this.drone.flying && !this.drone.dying) this.drone.explode('abort');
    }
    L.current = key;
    L.reloadT = 0;
    L.autoReload = 0;
    f.character.action = null;
    f.character.setWeapon(key);
    this.sound(f, 'equip');
    return true;
  }

  reload(f) {
    const L = f.loadout;
    const def = WEAPONS[L.current];
    if (L.current === 'grenade' || L.current === 'drone' || L.current === 'knife' || L.reloading || L.mag[def.key] >= def.mag || L.reserve[def.key] <= 0) return false;
    if (f.character.weapon !== def.key) return false;
    L.reloadT = def.reload;
    f.character.startAction(def.key === 'rifle' ? 'reload' : 'pistolReload', def.reload);
    if (f === this.player?.fighter) this.player.aimHold = 0; // reloading on the run: free to sprint
    f.character.reloadCues = def.key === 'rifle'
      ? [[0.38, 'boltBack'], [0.8, 'round'], [1.1, 'round'], [1.4, 'round'], [1.7, 'round'], [2.0, 'round'], [2.32, 'boltFwd']]
      : [[0.18, 'magOut'], [0.96, 'magIn'], [1.28, 'slide']];
    f.character.reloadCueI = 0;
    if (f.isPlayer) { this.player.sniperPending = false; this.sniperWasScoped = false; }
    this.sound(f, 'reloadStart');
    return true;
  }

  // Tries to fire the current weapon; returns true if it went off.
  trigger(f, aimPoint, spread) {
    const L = f.loadout;
    const ch = f.character;
    const key = L.current;
    const def = WEAPONS[key];
    if (ch.weapon !== key || ch.equipT < 1 || L.reloading || L.cooldown > 0) return false;
    if (key === 'drone') return false;
    if (key === 'knife') {
      // the thrust; it strikes partway through (stab, from tick)
      if (ch.action) return false;
      ch.startAction('stab', def.interval);
      L.cooldown = def.interval;
      this.sound(f, 'swish');
      return true;
    }
    if (key === 'grenade') {
      if (L.grenades <= 0 || ch.action) return false;
      L.grenades--;
      ch.startAction('throw', THROW_DUR);
      if (ch.aimWeight > 0.5) ch.action.t = THROW_DUR * 0.3 * ch.aimWeight;
      L.cooldown = THROW_DUR;
      this.sound(f, 'pin');
      return true;
    }
    if (key === 'rifle' && ch.action) return false;
    if (L.mag[key] <= 0) {
      L.cooldown = 0.25;
      this.sound(f, 'dry');
      if (!this.reload(f)) L.autoReload = 0;
      return false;
    }
    L.mag[key]--;
    L.cooldown = def.interval;
    let hit;
    if (key === 'rifle') {
      hit = this.shoot(f, -1, aimPoint, spread ?? def.spread, def);
      ch.firedRifle();
      if (L.mag.rifle > 0) {
        ch.startAction('bolt', def.interval);
        L.ejected = false;
        setTimeout(() => this.sound(f, 'boltBack'), def.interval * 0.33 * 1000);
        setTimeout(() => this.sound(f, 'boltFwd'), def.interval * 0.55 * 1000);
      }
    } else {
      hit = this.shoot(f, L.side, aimPoint, spread ?? def.spread, def);
      L.side = 1 - L.side;
    }
    if (L.mag[key] === 0 && L.reserve[key] > 0) L.autoReload = 0.35;
    this.lastHit = hit;
    return true;
  }

  playReloadCues(f) {
    const ch = f.character;
    const a = ch.action;
    if (!a || (a.type !== 'reload' && a.type !== 'pistolReload') || !ch.reloadCues) {
      ch.reloadCues = null;
      ch.reloadCueI = 0;
      return;
    }
    while (ch.reloadCueI < ch.reloadCues.length && a.t >= ch.reloadCues[ch.reloadCueI][0]) {
      this.sound(f, ch.reloadCues[ch.reloadCueI][1]);
      ch.reloadCueI++;
    }
  }

  tick(f, dt) {
    const L = f.loadout;
    const ch = f.character;
    this.playReloadCues(f);
    L.cooldown -= dt;
    if (L.reloading) {
      L.reloadT -= dt;
      if (L.reloadT <= 0) {
        const def = WEAPONS[L.current];
        const take = Math.min(def.mag - L.mag[def.key], L.reserve[def.key]);
        L.mag[def.key] += take;
        L.reserve[def.key] -= take;
        L.reloadT = 0;
      }
    }
    if (L.autoReload > 0) {
      L.autoReload -= dt;
      if (L.autoReload <= 0 && !ch.action) this.reload(f);
      else if (L.autoReload <= 0) L.autoReload = 0.1;
    }
    // The spent case flies out when the bolt opens.
    if (!L.ejected && ch.boltOpen > 0.7) {
      L.ejected = true;
      const m = ch.rifle.matrixWorld;
      const port = new THREE.Vector3(-0.22, 0.07, 0.02).applyMatrix4(m);
      const right = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize();
      const up = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
      this.fx.ejectCasing(port, right, up, this.nearAtt(f));
    }
    ch.showGrenade = L.grenades > 0 || (ch.action?.type === 'throw');
    if (ch.consumeStrike()) this.stab(f);
    if (ch.consumeRelease()) {
      const from = f.isPlayer ? this.throwOrigin() : ch.handPosition();
      this.throwGrenade(f, from, L.throwVel);
      this.sound(f, 'throw');
    }
    // Out of grenades: go back to a gun once the throw is done.
    if (L.current === 'grenade' && L.grenades <= 0 && !ch.action) this.equip(f, L.has('rifle') && f.preferRifle ? 'rifle' : 'pistols');
    if (L.current === 'drone' && L.drones <= 0 && !this.drone.flying) this.equip(f, L.has('pistols') ? 'pistols' : 'rifle');
    if (L.current !== 'grenade' && L.current !== 'drone' && !L.has(L.current)) this.equip(f, L.current === 'rifle' ? 'pistols' : 'rifle');
  }

  /**
   * The knife's thrust lands: the nearest fighter within reach and in front (and not
   * behind a wall) is cut; one facing away is killed outright. Otherwise the blade
   * meets whatever is in front, or air.
   */
  stab(f) {
    const def = WEAPONS.knife;
    const ch = f.character;
    const from = this.combat.chest(f);
    const aim = ch.aimDir.lengthSq() > 0.5 ? ch.aimDir : tmp.set(0, 0, 1).applyQuaternion(ch.root.quaternion);
    const fx = aim.x, fz = aim.z, fl = Math.hypot(fx, fz) || 1;
    let best = null, bestD = def.reach;
    for (const v of this.combat.fighters) {
      if (v === f || !v.alive) continue;
      const to = this.combat.chest(v).sub(from);
      const d = Math.hypot(to.x, to.z);
      if (d > bestD || Math.abs(to.y) > 1.2) continue;
      if ((to.x * fx + to.z * fz) / (fl * (d || 1)) < def.cone) continue; // not in front
      const len = to.length();
      const hit = this.world.raycast(from, to.clone().divideScalar(len || 1), len, f);
      if (hit && !hit.fighter && hit.t < len - 0.35) continue; // a wall between
      best = v; bestD = d;
    }
    const multi = f.isPlayer && this.session?.multi;
    if (best) {
      const at = this.combat.chest(best);
      const dir = at.clone().sub(from).normalize();
      // from behind: the victim faces the same way the blade goes
      const vf = best.character?.root ? tmp.set(0, 0, 1).applyQuaternion(best.character.root.quaternion) : null;
      const back = !!vf && vf.x * dir.x + vf.z * dir.z > 0.45;
      const dmg = back ? def.back : def.body;
      this.fx.bloodHit(at, dir, dir.clone().negate(), back ? 1.5 : 1.15);
      this.sprayBehind(at, dir, best, back ? 0.9 : 0.5);
      this.audio.impact('flesh', at.distanceTo(this.player.camera.position));
      this.audio.stab?.(this.nearAtt(f));
      if (multi && best.net) this.session.reportShot(from, dir, 'knife', best.id, back);
      this.combat.damage(best, f, dmg, dir, { weapon: 'knife', at, part: 'Spine2', limb: false, head: false });
      if (f.isPlayer) this.onHit?.(best.alive ? 'body' : 'kill');
      return best;
    }
    if (multi) this.session.reportShot(from, aim, 'knife');
    // nobody there: the point meets a wall or a car, or just air
    const ad = tmp.set(fx / fl, aim.y, fz / fl).normalize();
    const hit = this.world.raycast(from, ad, 1.3, f);
    if (hit && !hit.fighter) {
      const p = from.clone().addScaledVector(ad, hit.t);
      this.fx.impact(p, hit.normal, hit.surface, ad.clone());
      this.audio.impact(hit.surface, p.distanceTo(this.player.camera.position));
    }
    return null;
  }

  /**
   * A rifle round's flight: 820 m/s under gravity, traced in 10 ms segments up to 900 m.
   * On a hit, `dir` is turned to point straight at the impact and hit.t is that distance.
   */
  ballistic(from, dir, shooter) {
    const SPEED = 820, STEP = 0.01;
    const p = from.clone(), v = dir.clone().multiplyScalar(SPEED);
    const seg = new THREE.Vector3();
    for (let travelled = 0; travelled < 900;) {
      v.y -= 9.8 * STEP;
      seg.copy(v).multiplyScalar(STEP);
      const len = seg.length();
      seg.divideScalar(len);
      const hit = this.world.raycast(p, seg, len, shooter);
      if (hit) {
        const at = p.clone().addScaledVector(seg, hit.t);
        const straight = at.sub(from);
        hit.t = straight.length();
        dir.copy(straight.divideScalar(hit.t));
        return hit;
      }
      p.addScaledVector(seg, len);
      travelled += len;
    }
    return null;
  }

  // Fires one gun of `shooter` towards `aimPoint`; spread is in radians.
  // `side` picks a pistol, or -1 for the rifle.
  shoot(shooter, side, aimPoint, spread, def) {
    const ch = shooter.character;
    const rifle = side < 0;
    const flashAt = rifle ? ch.rifleMuzzle() : ch.muzzleWorld(side);
    const flashAxis = rifle ? ch.rifleAxis() : ch.pistolAxis(side);
    let from, dir;
    if (shooter.isPlayer) {
      // Same ray as the crosshair. A chest→aimPoint line sits left of the
      // reticle and still clips a head the player already aimed past.
      const origin = new THREE.Vector3();
      const look = new THREE.Vector3();
      this.player.aimRay(origin, look);
      from = origin;
      const target = aimPoint.clone();
      const r = (spread ?? 0) * Math.max(1, target.distanceTo(from));
      if (r > 0) target.add(new THREE.Vector3().randomDirection().multiplyScalar(r * Math.random()));
      dir = target.sub(from);
      if (dir.lengthSq() < 1e-8) dir.copy(look);
      else dir.normalize();
    } else {
      // From the chest, not the muzzle: a barrel against a wall must not fire from its far side.
      from = this.combat.chest(shooter);
      const target = aimPoint.clone();
      const r = spread * target.distanceTo(from);
      target.add(new THREE.Vector3().randomDirection().multiplyScalar(r * Math.random()));
      dir = target.sub(from).normalize();
    }
    // car glass breaks along the round's path, up to the first wall it meets
    const wall = this.world.shots?.raycast(from, dir, 900);
    this.world.cars?.breakAlong(from, dir, wall ? wall.t : 900, shooter);
    // rifle rounds drop over distance: trace the arc, then treat the hit as a straight
    // shot to where the round actually landed (so cover, tracer and reports agree)
    let hit = rifle ? this.ballistic(from, dir, shooter) : this.world.raycast(from, dir, 900, shooter);
    // Penetration: a rifle round punches through wood, glass and car bodywork, a pistol
    // round through glass; each layer leaves its mark and costs 40% of the damage.
    for (let layer = 0; hit && layer < 2 && !hit.fighter && !hit.drone && pierceable(hit, rifle); layer++) {
      const entry = from.clone().addScaledVector(dir, hit.t);
      this.fx.impact(entry, hit.normal, hit.surface, dir);
      let pane = null;
      if (hit.surface === 'glass' && hit.tri !== undefined && this.world.studio?.root) {
        pane = this.world.shots?.breakPane(hit.tri, [this.world.studio.root]);
        if (pane) this.fx.shatter?.(pane.center, pane.size, hit.normal, dir);
      }
      if (!hit.car && !pane) this.fx.bulletHole?.(entry, hit.normal, hit.surface);
      if (hit.car) { this.fx.holes?.addToCar(hit.car, entry, hit.normal, 'metal', 0.11); this.world.cars?.damage(hit.car, rifle ? 16 : 4, shooter); }
      let through = hit.car ? 2.2 : 0.3; // a car is crossed whole, a board or pane barely
      let next = this.world.raycast(entry.clone().addScaledVector(dir, through), dir, 900, shooter);
      // the far face of the same crate or pane is where it comes out, not a second layer
      if (next && !next.fighter && !next.car && next.surface === hit.surface && next.t < 1.2) {
        through += next.t + 0.05;
        next = this.world.raycast(entry.clone().addScaledVector(dir, through), dir, 900, shooter);
      }
      const pierced = (hit.pierced || 0) + 1;
      if (!next) { hit = null; break; }
      next.t += hit.t + through;
      next.pierced = pierced;
      hit = next;
    }
    // Cover the chest is standing behind still stops the shot. A fighter
    // on that chest line that the crosshair missed is ignored.
    if (shooter.isPlayer && hit && !hit.drone) {
      const body = this.player.losOrigin();
      const to = from.clone().addScaledVector(dir, hit.t).sub(body);
      const len = to.length();
      if (len > 0.35) {
        to.multiplyScalar(1 / len);
        const cover = this.world.raycast(body, to, len - 0.15, shooter);
        if (cover && !cover.fighter && !cover.drone && !(hit.pierced && pierceable(cover, rifle))) hit = cover;
      }
    }
    this.fx.muzzle(flashAt, flashAxis, rifle ? 2.4 : 1);
    if (!rifle) {
      const up = new THREE.Vector3().setFromMatrixColumn(ch.pistols[side].matrixWorld, 1);
      const right = new THREE.Vector3().crossVectors(flashAxis, up).multiplyScalar(side === 0 ? 1 : -1);
      this.fx.ejectCasing(flashAt.clone().addScaledVector(flashAxis, -0.08).addScaledVector(up, 0.02), right, up, this.nearAtt(shooter));
      ch.fired(side);
    }
    shooter.lastShotT = this.combat.time;
    this.world.pigeons?.scare(flashAt, rifle ? 60 : 40);
    this.world.traffic?.scare(flashAt, rifle ? 90 : 60);
    const { dist, pan, occluded } = this.listen(flashAt);
    this.audio.gunshot(side < 0 ? 0 : side, shooter.isPlayer ? 0 : dist, shooter.isPlayer ? null : pan, rifle, occluded && !shooter.isPlayer);

    const end = hit ? from.clone().addScaledVector(dir, hit.t) : from.clone().addScaledVector(dir, 500);
    this.tracerN = (this.tracerN || 0) + 1;
    this.fx.tracer(flashAt, end, rifle ? 'rifle' : this.tracerN % 3 === 0 ? 'bright' : 'faint');
    if (!shooter.isPlayer) this.checkNearMiss(from, end, hit);
    // Open-air misses used to return here, so the room never heard the
    // round. The other player only saw the aim pose until a hit landed.
    if (shooter.isPlayer && this.session?.multi && !hit?.drone) {
      this.session.reportShot(from, dir, def.key, hit?.fighter?.net ? hit.fighter.id : undefined, !!hit?.head);
    }
    if (!hit) return null;
    const hitDist = end.distanceTo(this.player.camera.position);
    if (hit.fighter || hit.traffic) {
      if (hit.head) {
        this.fx.headshot(end, dir, hit.normal, rifle ? 1.35 : 1);
        this.audio.headshot(hitDist);
      } else {
        this.fx.bloodHit(end, dir, hit.normal, rifle ? 1.3 : 1);
        this.audio.impact('flesh', hitDist);
      }
      if (hit.fighter) this.sprayBehind(end, dir, hit.fighter, (hit.head ? 1 : 0.6) * (rifle ? 1.25 : 1));
    } else {
      this.fx.impact(end, hit.normal, hit.surface, dir);
      // a shop or office window shatters (and leaves no hole hanging in the air)
      let pane = null;
      if (hit.surface === 'glass' && hit.tri !== undefined && this.world.studio?.root) {
        pane = this.world.shots?.breakPane(hit.tri, [this.world.studio.root]);
        if (pane) this.fx.shatter?.(pane.center, pane.size, hit.normal, dir);
      }
      if (!hit.car && !hit.drone && !pane) this.fx.bulletHole?.(end, hit.normal, hit.surface);
      if (hit.car) { this.fx.holes?.addToCar(hit.car, end, hit.normal, 'metal', 0.11); this.world.cars?.damage(hit.car, rifle ? 16 : 4, shooter); }
      this.audio.impact(hit.surface, hitDist);
      if (hit.surface !== 'water') this.bounceOff(shooter, end, dir, hit);
    }
    if (hit.traffic) { // a civilian driver
      const killed = this.world.traffic?.hitDriver(hit.traffic, dir, { head: hit.head, amount: rifle ? 999 : 30 });
      if (shooter.isPlayer) this.onHit?.(killed ? (hit.head ? 'kill head' : 'kill') : 'body');
      return hit;
    }
    if (hit.drone) {
      hit.drone.kill(shooter);
      if (shooter.isPlayer && this.session?.multi) {
        const ownerId = hit.drone.ownerId || hit.drone.live?.owner?.id || this.session.net.id;
        const from = hit.drone.pos || hit.drone.live?.pos;
        this.session.reportDrone('down', {
          id: ownerId,
          p: from ? [from.x, from.y, from.z] : undefined,
          dir: [dir.x, dir.y, dir.z],
        });
        this.session.reportShot(from || flashAt, dir, def.key);
      }
      return hit;
    }
    if (hit.fighter && !hit.fighter.alive) { // a body: it jerks with the round, no damage
      hit.fighter.character.ragdoll?.kick(end, dir.clone().multiplyScalar(rifle ? 5 : 2.5));
      return hit;
    }
    if (hit.fighter?.net) {
      this.combat.damage(hit.fighter, shooter, shotDamage(def, hit), dir, { head: hit.head, limb: hit.limb, part: hit.part, weapon: def.key, at: end });
      return hit;
    }
    if (hit.fighter) this.combat.damage(hit.fighter, shooter, shotDamage(def, hit), dir, { head: hit.head, limb: hit.limb, part: hit.part, weapon: def.key, at: end });
    else if (hit.body || hit.target) hit.scored = this.world.props.hit(hit, end, dir, def.force);
    return hit;
  }

  // The round stops at the first solid thing and glances off. It does not
  // keep going through cover to whoever is standing behind it.
  bounceOff(shooter, pos, dir, hit) {
    const n = hit.normal.clone();
    if (n.dot(dir) > 0) n.negate();
    const bounce = dir.clone().reflect(n);
    bounce.add(new THREE.Vector3().randomDirection().multiplyScalar(0.06)).normalize();
    if (bounce.dot(n) < 0.04) bounce.addScaledVector(n, 0.14).normalize();
    const start = pos.clone().addScaledVector(n, 0.04);
    const reach = 18;
    const next = this.world.raycast(start, bounce, reach, shooter);
    const to = start.clone().addScaledVector(bounce, next ? Math.max(next.t, 0.35) : reach);
    this.fx.tracer(start, to);
    const { dist } = this.listen(pos);
    this.audio.ricochet(Math.min(1, 8 / Math.max(dist, 1)));
    if (next && !next.fighter && next.surface !== 'water') {
      const p = start.clone().addScaledVector(bounce, next.t);
      this.fx.impact(p, next.normal, next.surface, bounce);
    }
  }

  // Exit spray lands on whatever is behind the victim, plus a spatter on the
  // ground where the heavier drops come down.
  sprayBehind(end, dir, victim, k) {
    const decals = this.fx.decals;
    const exit = end.clone().addScaledVector(dir, 0.35);
    const reach = 2.5 + 2.5 * k;
    const back = this.world.raycast(exit, dir, reach, victim);
    if (back && !back.fighter && back.surface !== 'water') {
      const p = exit.clone().addScaledVector(dir, back.t);
      decals.splat(p, back.normal, dir, (0.45 + back.t * 0.2) * (0.6 + k * 0.5));
    }
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0);
    flat.normalize();
    const land = Math.min(back ? back.t : reach, 0.5 + Math.random() * 1.4 * k);
    const g = exit.clone().addScaledVector(flat, land);
    const terrain = this.world.terrain;
    g.y = terrain.heightAt(g.x, g.z);
    if (g.y > 0.05) decals.splat(g, terrain.normalAt(g.x, g.z), flat, 0.55 + 0.6 * k * Math.random() + 0.3 * k);
  }

  listen(pos) {
    const cam = this.player.camera;
    const to = pos.clone().sub(cam.position);
    const dist = to.length();
    const right = tmp.setFromMatrixColumn(cam.matrixWorld, 0);
    const dir = to.normalize();
    // a wall between the sound and the listener muffles it (city maps: the shot BVH)
    const occluded = dist > 3 && !!this.world.shots?.raycast(cam.position, dir, dist - 1);
    return { dist, pan: dir.dot(right), occluded };
  }

  /** How loud a small sound near f is to the player (no occlusion test: it's cheap). */
  nearAtt(f) {
    return f.isPlayer ? 1 : Math.min(1, 3 / Math.max(1, this.player.camera.position.distanceTo(f.pos)));
  }

  sound(f, kind) {
    const { dist } = f.isPlayer ? { dist: 0 } : this.listen(f.pos);
    this.audio.mech(kind, Math.min(1, 4 / Math.max(dist, 1)));
  }

  // A bullet that passes close to the player's head cracks past her ear.
  checkNearMiss(from, to, hit) {
    const me = this.player.fighter;
    if (!me.alive || hit?.fighter === me) return;
    const seg = tmp.subVectors(to, from);
    const len = seg.length();
    seg.divideScalar(len);
    const rel = me.head.clone().sub(from);
    const along = rel.dot(seg);
    if (along < 0 || along > len) return;
    const miss = rel.addScaledVector(seg, -along).length();
    if (miss < 1.6) this.onNearMiss?.(miss);
  }

  // --- Grenades --------------------------------------------------------------

  throwGrenade(owner, pos, vel, opts = {}) {
    const mesh = this.template.clone(true);
    mesh.matrixAutoUpdate = false;
    this.fx.pipeline.scene.add(mesh);
    const g = {
      owner, mesh, pos: pos.clone(), vel: vel.clone(),
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vel.clone().normalize()),
      spin: new THREE.Vector3().randomDirection().multiplyScalar(9 + Math.random() * 6),
      fuse: WEAPONS.grenade.fuse, water: false, bounces: 0,
    };
    this.live.push(g);
    if (!opts.silent && owner.isPlayer) this.session?.reportNade(pos, vel);
  }

  // Launch velocity that lands a grenade on `to`: the low arc, or the high
  // one when something is in the way.
  static aimThrow(from, to, speed, lob) {
    const d = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    const D = Math.max(0.5, d.length());
    d.divideScalar(D);
    const h = to.y - from.y;
    const v2 = speed * speed;
    const disc = v2 * v2 - GRAVITY * (GRAVITY * D * D + 2 * h * v2);
    let ang;
    if (disc < 0) ang = Math.PI / 4;
    else ang = Math.atan((v2 + (lob ? 1 : -1) * Math.sqrt(disc)) / (GRAVITY * D));
    return d.multiplyScalar(Math.cos(ang) * speed).setY(Math.sin(ang) * speed);
  }

  stepGrenade(p, v, dt, collide) {
    const { terrain, veg } = this.world;
    v.y -= GRAVITY * dt;
    let bounced = 0;
    // Sweep the step along the real geometry (walls, balconies, roofs, car bodies) and
    // bounce off the surface it meets; the walking grid below is only a coarse backstop.
    const speed = v.length(), step = speed * dt;
    let moved = false;
    if (step > 1e-5 && (this.world.shots || this.world.cars)) {
      const dir = this._gDir || (this._gDir = new THREE.Vector3());
      dir.copy(v).divideScalar(speed);
      let hit = this.world.shots?.raycast(p, dir, step + 0.05) || null;
      const car = this.world.cars?.raycast(p, dir, hit ? hit.t : step + 0.05, null);
      if (car) hit = car;
      if (hit && hit.t < 0.005) hit = null; // starting inside something: let it move out
      if (hit) {
        p.addScaledVector(dir, Math.max(0, hit.t - 0.05));
        const n = hit.normal;
        const vn = v.dot(n);
        if (vn < 0) {
          v.addScaledVector(n, -vn * 1.42); // restitution ~0.42
          const tx = v.x - n.x * v.dot(n), ty = v.y - n.y * v.dot(n), tz = v.z - n.z * v.dot(n);
          v.x -= tx * 0.3; v.y -= ty * 0.3; v.z -= tz * 0.3; // friction along the surface
          bounced = -vn;
        }
        moved = true;
      }
    }
    if (!moved) p.addScaledVector(v, dt);
    const h = terrain.heightAt(p.x, p.z);
    if (hasSea() && p.y < 0.03 && h < 0) {
      if (p.y < 0) { v.multiplyScalar(Math.exp(-dt * 8)); bounced = -1; }
    } else if (p.y < h + 0.035) {
      const n = terrain.normalAt(p.x, p.z);
      const vn = v.dot(n);
      if (vn < 0) {
        v.addScaledVector(n, -vn * 1.35);
        const vt = v.clone().addScaledVector(n, -v.dot(n));
        v.addScaledVector(vt, -0.35);
        bounced = Math.max(bounced, -vn);
      }
      p.y = h + 0.035;
    }
    if (collide) {
      const prev = p.clone();
      veg.colliders.resolveXZ(p, 0.04, p.y - 0.05, p.y + 0.05);
      if (p.distanceToSquared(prev) > 1e-6) {
        const nx = p.x - prev.x, nz = p.z - prev.z;
        const len = Math.hypot(nx, nz) || 1;
        const nnx = nx / len, nnz = nz / len;
        const vn = v.x * nnx + v.z * nnz;
        if (vn < 0) { v.x -= vn * 1.3 * nnx; v.z -= vn * 1.3 * nnz; v.multiplyScalar(0.72); bounced = Math.max(bounced, -vn); }
      }
    }
    return bounced;
  }

  updateGrenades(dt) {
    const alive = [];
    for (const g of this.live) {
      g.fuse -= dt;
      const b = this.stepGrenade(g.pos, g.vel, dt, true);
      if (b > 1.2 && g.bounces < 6) {
        g.bounces++;
        const { dist } = this.listen(g.pos);
        this.audio.mech('bounce', Math.min(1, 5 / Math.max(dist, 1)) * Math.min(1, b / 5));
        g.spin.multiplyScalar(0.6);
      }
      if (b === -1 && !g.water) {
        g.water = true;
        this.fx.impact(g.pos.clone().setY(0.02), new THREE.Vector3(0, 1, 0), 'water', new THREE.Vector3(0, -1, 0));
      }
      const gh = this.world.terrain.heightAt(g.pos.x, g.pos.z);
      const onGround = g.pos.y - (hasSea() ? Math.max(0, gh) : gh) < 0.05;
      if (onGround) g.spin.multiplyScalar(Math.exp(-dt * 6));
      const w = g.spin.length();
      if (w > 1e-3) g.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(tmp.copy(g.spin).divideScalar(w), w * dt));
      g.mesh.matrix.compose(g.pos, g.quat, new THREE.Vector3(1, 1, 1));
      g.mesh.matrixWorld.copy(g.mesh.matrix);
      g.mesh.children.forEach((c) => c.updateMatrixWorld(true));
      if (g.fuse <= 0) this.explode(g);
      else alive.push(g);
    }
    this.live = alive;
  }

  explode(g) {
    g.mesh.removeFromParent();
    const def = WEAPONS.grenade;
    const pos = g.pos.clone();
    const underwater = g.water && pos.y < -0.2;
    this.fx.explosion(pos, underwater ? 'water' : g.water ? 'water' : 'ground');
    const { dist, pan } = this.listen(pos);
    this.audio.explosion(dist, pan, underwater);
    this.combat.explode(this.world, pos, underwater ? def.radius * 0.5 : def.radius, def.damage, g.owner);
    this.world.props.blast?.(pos, def.radius, 9);
    this.onExplosion?.(pos, dist);
  }

  // --- The player's controls --------------------------------------------------

  // How far the player's shots stray right now, as a multiple of the gun's base spread:
  // sustained fire blooms, moving and jumping throw the aim off, crouching steadies it.
  spreadScale() {
    const p = this.player;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    let k = 1 + (this.bloom || 0) * 2.2 + Math.min(speed / 6, 1) * 1.6 + (p.onGround ? 0 : 2.5);
    if (p.crouching) k *= 0.6;
    return k;
  }

  update(dt, input) {
    this.bloom = Math.max(0, (this.bloom || 0) - dt * 2.4);
    const f = this.player.fighter;
    const L = f.loadout;
    const ch = this.character;
    if (input.slot) {
      const key = SLOTS[input.slot - 1];
      if (key) this.equip(f, key);
    }
    if (input.cycle) {
      const n = SLOTS.length;
      let i = SLOTS.indexOf(ch.nextWeapon);
      for (let k = 0; k < n; k++) {
        i = (i + input.cycle + n) % n;
        if (L.has(SLOTS[i])) { this.equip(f, SLOTS[i]); break; }
      }
    }
    if (input.reload) this.reload(f);
    if (this.player.vehicle) {
      this.chargingGrenade = false;
      this.grenadeCharge = 0;
      this.character.grenadeWindup = 0;
      this.sniperHeld = false;
      this.player.sniperPending = false;
      this.updateArc(false);
      this.tick(f, dt);
      return;
    }
    if (L.current === 'drone' || this.drone.flying) {
      this.updateDrone(dt, input, f, L, ch);
      this.tick(f, dt);
      return;
    }
    const def = WEAPONS[L.current];
    if (L.current !== 'rifle' && input.firePressed) this.queued = 0.5;
    this.queued = Math.max(0, this.queued - dt);

    if (L.current === 'grenade') {
      const gdef = WEAPONS.grenade;
      const canToss = ch.weapon === 'grenade' && L.grenades > 0 && !ch.action && ch.equipT >= 1;
      if (input.fire && canToss) {
        this.chargingGrenade = true;
        this.grenadeCharge = Math.min(1, this.grenadeCharge + dt / gdef.chargeMax);
        this.player.aimHold = Math.max(this.player.aimHold, 1.4);
      } else if (this.chargingGrenade && !input.fire) {
        // The throw keeps exactly the velocity the arc showed at release.
        this.pendingCharge = Math.max(0.06, this.grenadeCharge);
        this.pendingThrow = 0.5;
        this.chargingGrenade = false;
        this.grenadeCharge = 0;
      } else if (!input.fire) {
        this.chargingGrenade = false;
        this.grenadeCharge = Math.max(0, this.grenadeCharge - dt * 4);
      }
      if (this.pendingThrow > 0) {
        this.pendingThrow -= dt;
        if (this.player.facingError < 0.45) {
          const speed = THREE.MathUtils.lerp(gdef.speedMin, gdef.speedMax, this.pendingCharge);
          L.throwVel.copy(this.playerThrowVelocity(speed));
          this.trigger(f, this.player.aimPoint);
          this.pendingThrow = 0;
        }
      }
      const preview = this.chargingGrenade ? this.grenadeCharge : this.pendingThrow > 0 ? this.pendingCharge : (input.aim ? 0.45 : 0.12);
      const previewSpeed = THREE.MathUtils.lerp(gdef.speedMin, gdef.speedMax, preview);
      this.previewVel.copy(this.playerThrowVelocity(previewSpeed));
      ch.grenadeWindup = this.chargingGrenade ? this.grenadeCharge : 0;
      const showArc = canToss && (this.chargingGrenade || input.aim || this.pendingThrow > 0);
      this.updateArc(showArc, this.previewVel, preview);
    } else {
      this.chargingGrenade = false;
      this.grenadeCharge = 0;
      this.character.grenadeWindup = 0;
      this.updateArc(false);
      if (L.current === 'rifle') {
        // Hold Space to scope; the shot goes on release.
        if (input.fire) {
          this.player.aimHold = 1.2;
          this.sniperHeld = true;
        } else if (input.fireReleased && this.sniperHeld) {
          this.sniperHeld = false;
          this.queued = 1.2;
          this.sniperWasScoped = this.player.scopeT > 0.35;
          this.player.sniperPending = true;
        } else if (!input.fire && !this.player.sniperPending) {
          this.sniperHeld = false;
        }
      }
      if (L.current === 'knife') {
        // a stab a press (held: one after another); the body turns to face the aim first
        if (input.fire || this.queued > 0) this.player.aimHold = Math.max(this.player.aimHold, 0.8);
        if ((input.fire || this.queued > 0) && ch.ready && this.player.facingError < 0.6 && this.trigger(f, this.player.aimPoint)) this.queued = 0;
        this.tick(f, dt);
        return;
      }
      const firing = L.current === 'rifle'
        ? this.queued > 0 && !input.fire
        : (def.auto && input.fire) || this.queued > 0;
      if (firing) {
        // (pulling the trigger mid-reload doesn't raise the guns: it would hold you to a walk)
        if (!L.reloading) this.player.aimHold = 1.2;
        const scopedShot = L.current === 'rifle' && (this.sniperWasScoped || this.player.scopeT > 0.4);
        const ready = scopedShot
          ? ch.weapon === 'rifle' && ch.equipT >= 1
          : ch.aimWeight > 0.8 && this.player.facingError < 0.35;
        const spread = (L.current === 'rifle' ? (scopedShot ? 0 : def.hipSpread) : def.spread) * this.spreadScale();
        const side = L.side;
        if (ready && this.trigger(f, this.player.aimPoint, spread)) {
          this.bloom = Math.min(1.5, (this.bloom || 0) + (L.current === 'rifle' ? 1.2 : 0.3));
          this.queued = 0;
          this.sniperWasScoped = false;
          this.player.sniperPending = false;
          this.player.kick(side, L.current === 'rifle' ? 5.2 : 1);
          const hit = this.lastHit;
          if (hit?.fighter) this.onHit?.(hit.head ? 'kill head' : (hit.fighter.alive ? 'body' : 'kill'));
          else if (hit?.scored || hit?.body) this.onHit?.('prop');
        }
      }
      if (L.current === 'rifle' && this.player.sniperPending && this.queued <= 0) {
        this.player.sniperPending = false;
        this.sniperWasScoped = false;
      }
    }
    this.tick(f, dt);
  }

  updateDrone(dt, input, f, L, ch) {
    this.chargingGrenade = false;
    this.grenadeCharge = 0;
    this.updateArc(false);
    if (this.drone.flying) {
      this.drone.update(dt, input);
      if (this.drone.flying && !this.drone.dying) {
        this.dronePoseAcc = (this.dronePoseAcc || 0) + dt;
        if (this.dronePoseAcc >= 1 / 8) {
          this.dronePoseAcc = 0;
          const pack = this.drone.pack();
          if (pack) this.session?.reportDrone('pose', pack);
        }
        if (input.firePressed) this.drone.explode('detonate');
      }
      return;
    }
    const ready = ch.weapon === 'drone' && ch.equipT >= 1 && L.drones > 0 && !ch.action;
    if (ready && input.firePressed) {
      if (this.drone.launch(f)) {
        L.drones--;
        const pack = this.drone.pack();
        if (pack) this.session?.reportDrone('go', pack);
      }
    }
  }

  playerThrowVelocity(speed = WEAPONS.grenade.speed) {
    const d = new THREE.Vector3();
    this.player.camera.getWorldDirection(d);
    d.y += 0.22 + 0.14 * ((speed - WEAPONS.grenade.speedMin) / (WEAPONS.grenade.speedMax - WEAPONS.grenade.speedMin));
    d.normalize().multiplyScalar(speed);
    return d.addScaledVector(this.player.vel, 0.35 + 0.25 * (speed / WEAPONS.grenade.speedMax));
  }

  // Where the player's grenade leaves the hand; shared by the arc preview and
  // the real throw so the two trajectories are identical.
  throwOrigin(out = new THREE.Vector3()) {
    const right = new THREE.Vector3(-Math.cos(this.player.yaw), 0, Math.sin(this.player.yaw));
    return out.copy(this.player.pos).setY(this.player.pos.y + 1.75).addScaledVector(right, 0.2);
  }

  updateArc(show, vel, charge = 0) {
    this.arc.visible = show;
    this.marker.visible = show;
    if (!show) return;
    const c = THREE.MathUtils.clamp(charge, 0, 1);
    const col = new THREE.Color().setHSL(0.12 - c * 0.08, 1, 0.45 + c * 0.25);
    this.arcMat.color.copy(col).multiplyScalar(1.6 + c * 1.4);
    this.markerMat.color.copy(col).multiplyScalar(2 + c * 2);
    this.marker.scale.setScalar(0.85 + c * 1.15);
    const p = this.throwOrigin();
    const v = vel.clone();
    const attr = this.arc.geometry.attributes.position;
    let n = 0;
    let settled = 0;
    for (; n < attr.count; n++) {
      attr.setXYZ(n, p.x, p.y, p.z);
      for (let k = 0; k < 4; k++) this.stepGrenade(p, v, 1 / 60, true);
      if (v.lengthSq() < 1) settled++;
      if (settled > 3) { n++; break; }
    }
    for (let i = n; i < attr.count; i++) attr.setXYZ(i, p.x, p.y, p.z);
    attr.needsUpdate = true;
    this.arc.geometry.setDrawRange(0, n);
    this.marker.position.copy(p).setY(Math.max(p.y, 0) + 0.03);
  }
}
