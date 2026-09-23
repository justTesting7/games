import * as THREE from 'three';
import { Character } from './character.js';

export const WEAPONS = {
  pistols: {
    key: 'pistols', name: 'Dual pistols', short: 'pistols', slot: 1, auto: true,
    mag: 16, reserve: 96, reload: 1.7, interval: 0.13, body: 9, head: 30, spread: 0.0035, hipSpread: 0.0035, force: 4.5,
  },
  rifle: {
    key: 'rifle', name: 'Bolt-action rifle', short: 'rifle', slot: 2, auto: false,
    mag: 5, reserve: 20, reload: 2.6, interval: 0.95, body: 55, head: 200, spread: 0.0003, hipSpread: 0.03, force: 14,
  },
  grenade: {
    key: 'grenade', name: 'Stick grenades', short: 'grenade', slot: 3,
    count: 3, fuse: 3.4, radius: 8, damage: 120, speed: 16,
  },
};
export const SLOTS = ['pistols', 'rifle', 'grenade'];
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
    this.reloadT = 0;
    this.cooldown = 0;
    this.autoReload = 0;
    this.side = 0;
    this.throwVel = new THREE.Vector3();
    this.ejected = true;
  }

  has(key) {
    return key === 'grenade' ? this.grenades > 0 : this.mag[key] + this.reserve[key] > 0;
  }

  get reloading() { return this.reloadT > 0; }
}

const tmp = new THREE.Vector3();

export class Weapons {
  constructor(world, player, character, fx, audio, combat) {
    this.world = world;
    this.player = player;
    this.character = character;
    this.fx = fx;
    this.audio = audio;
    this.combat = combat;
    this.queued = 0;
    this.onHit = null;
    this.onNearMiss = null;
    this.onExplosion = null;
    this.live = [];
    this.template = null;

    const n = 64;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.arc = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 1.9, 1.3) }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.9, 1.3) }));
    this.marker.visible = false;
    fx.pipeline.scene.add(this.arc, this.marker);
  }

  setGrenadeModel(gltf) { this.template = Character.grenadeModel(gltf); }

  // --- Shared by the player and the rivals ---------------------------------

  equip(f, key) {
    const L = f.loadout;
    if (key === L.current || !L.has(key)) return false;
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
    if (L.current === 'grenade' || L.reloading || L.mag[def.key] >= def.mag || L.reserve[def.key] <= 0) return false;
    if (f.character.weapon !== def.key) return false;
    L.reloadT = def.reload;
    f.character.startAction(def.key === 'rifle' ? 'reload' : 'pistolReload', def.reload);
    const plan = def.key === 'rifle'
      ? [[0.3, 'boltBack'], [0.7, 'round'], [0.95, 'round'], [1.2, 'round'], [1.45, 'round'], [1.7, 'round'], [2.1, 'boltFwd']]
      : [[0.2, 'magOut'], [1.0, 'magIn'], [1.45, 'slide']];
    plan.forEach(([t, kind]) => setTimeout(() => { if (L.reloading) this.sound(f, kind); }, t * 1000));
    return true;
  }

  // Tries to fire the current weapon; returns true if it went off.
  trigger(f, aimPoint, spread) {
    const L = f.loadout;
    const ch = f.character;
    const key = L.current;
    const def = WEAPONS[key];
    if (ch.weapon !== key || ch.equipT < 1 || L.reloading || L.cooldown > 0) return false;
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

  tick(f, dt) {
    const L = f.loadout;
    const ch = f.character;
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
      this.fx.ejectCasing(port, right, up);
    }
    ch.showGrenade = L.grenades > 0 || (ch.action?.type === 'throw');
    if (ch.consumeRelease()) {
      const from = ch.handPosition();
      this.throwGrenade(f, from, L.throwVel);
      this.sound(f, 'throw');
    }
    // Out of grenades: go back to a gun once the throw is done.
    if (L.current === 'grenade' && L.grenades <= 0 && !ch.action) this.equip(f, L.has('rifle') && f.preferRifle ? 'rifle' : 'pistols');
    if (L.current !== 'grenade' && !L.has(L.current)) this.equip(f, L.current === 'rifle' ? 'pistols' : 'rifle');
  }

  // Fires one gun of `shooter` towards `aimPoint`; spread is in radians.
  // `side` picks a pistol, or -1 for the rifle.
  shoot(shooter, side, aimPoint, spread, def) {
    const ch = shooter.character;
    const rifle = side < 0;
    const muzzle = rifle ? ch.rifleMuzzle() : ch.muzzleWorld(side);
    const axis = rifle ? ch.rifleAxis() : ch.pistolAxis(side);
    const target = aimPoint.clone();
    const r = spread * target.distanceTo(muzzle);
    target.add(new THREE.Vector3().randomDirection().multiplyScalar(r * Math.random()));
    const dir = target.clone().sub(muzzle).normalize();
    const hit = this.world.raycast(muzzle, dir, 900, shooter);

    this.fx.muzzle(muzzle, axis, rifle ? 1.8 : 1);
    if (!rifle) {
      const up = new THREE.Vector3().setFromMatrixColumn(ch.pistols[side].matrixWorld, 1);
      const right = new THREE.Vector3().crossVectors(axis, up).multiplyScalar(side === 0 ? 1 : -1);
      this.fx.ejectCasing(muzzle.clone().addScaledVector(axis, -0.08).addScaledVector(up, 0.02), right, up);
      ch.fired(side);
    }
    shooter.lastShotT = this.combat.time;
    const { dist, pan } = this.listen(muzzle);
    this.audio.gunshot(side < 0 ? 0 : side, shooter.isPlayer ? 0 : dist, shooter.isPlayer ? null : pan, rifle);

    const end = hit ? muzzle.clone().addScaledVector(dir, hit.t) : muzzle.clone().addScaledVector(dir, 500);
    this.fx.tracer(muzzle, end);
    if (!shooter.isPlayer) this.checkNearMiss(muzzle, end, hit);
    if (!hit) return null;
    const dist = end.distanceTo(this.player.camera.position);
    if (hit.head && hit.fighter) {
      this.fx.headshot(end, dir, hit.normal, rifle ? 1.35 : 1);
      this.audio.headshot(dist);
    } else {
      this.fx.impact(end, hit.normal, hit.surface, dir);
      this.audio.impact(hit.surface, dist);
    }
    if (hit.fighter) this.combat.damage(hit.fighter, shooter, hit.head ? def.head : def.body, dir, { head: hit.head, weapon: def.key });
    else if (hit.body || hit.target) hit.scored = this.world.props.hit(hit, end, dir, def.force);
    return hit;
  }

  listen(pos) {
    const cam = this.player.camera;
    const to = pos.clone().sub(cam.position);
    const dist = to.length();
    const right = tmp.setFromMatrixColumn(cam.matrixWorld, 0);
    return { dist, pan: to.normalize().dot(right) };
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

  throwGrenade(owner, pos, vel) {
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
    p.addScaledVector(v, dt);
    let bounced = 0;
    const h = terrain.heightAt(p.x, p.z);
    if (p.y < 0.03 && h < 0) {
      if (p.y < 0) { v.multiplyScalar(Math.exp(-dt * 8)); bounced = -1; }
    } else if (p.y < h + 0.035) {
      const n = terrain.normalAt(p.x, p.z);
      const vn = v.dot(n);
      if (vn < 0) {
        v.addScaledVector(n, -vn * 1.35);
        const vt = v.clone().addScaledVector(n, -v.dot(n));
        v.addScaledVector(vt, -0.35);
        bounced = -vn;
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
      const onGround = g.pos.y - Math.max(0, this.world.terrain.heightAt(g.pos.x, g.pos.z)) < 0.05;
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

  update(dt, input) {
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
    const def = WEAPONS[L.current];
    if (input.firePressed) this.queued = L.current === 'rifle' ? 1.1 : 0.5;
    this.queued = Math.max(0, this.queued - dt);

    if (L.current === 'grenade') {
      const vel = this.playerThrowVelocity();
      L.throwVel.copy(vel);
      if (this.queued > 0) this.player.aimHold = Math.max(this.player.aimHold, 0.9);
      if (this.queued > 0 && this.player.facingError < 0.4 && this.trigger(f, this.player.aimPoint)) this.queued = 0;
      this.updateArc(input.aim && ch.weapon === 'grenade' && L.grenades > 0 && !ch.action, vel);
    } else {
      this.updateArc(false);
      const firing = (def.auto && input.fire) || this.queued > 0;
      if (firing) {
        // Firing from the hip turns her to the target and raises the gun
        // first; a quick click is remembered until it is up.
        this.player.aimHold = 1.2;
        const ready = ch.aimWeight > 0.8 && this.player.facingError < 0.35;
        const spread = L.current === 'rifle' ? (this.player.scoped ? def.spread : def.hipSpread) : def.spread;
        const side = L.side;
        if (ready && this.trigger(f, this.player.aimPoint, spread)) {
          this.queued = 0;
          this.player.kick(side, L.current === 'rifle' ? 3.2 : 1);
          const hit = this.lastHit;
          if (hit?.fighter) this.onHit?.(hit.head ? 'kill head' : (hit.fighter.alive ? 'body' : 'kill'));
          else if (hit?.scored || hit?.body) this.onHit?.('prop');
        }
      }
    }
    this.tick(f, dt);
  }

  playerThrowVelocity() {
    const d = new THREE.Vector3();
    this.player.camera.getWorldDirection(d);
    d.y += 0.28;
    d.normalize().multiplyScalar(WEAPONS.grenade.speed);
    return d.addScaledVector(this.player.vel, 0.5);
  }

  updateArc(show, vel) {
    this.arc.visible = show;
    this.marker.visible = show;
    if (!show) return;
    const p = this.player.pos.clone().setY(this.player.pos.y + 1.75);
    const right = new THREE.Vector3(-Math.cos(this.player.yaw), 0, Math.sin(this.player.yaw));
    p.addScaledVector(right, 0.2);
    const v = vel.clone();
    const attr = this.arc.geometry.attributes.position;
    let n = 0;
    let settled = 0;
    for (; n < attr.count; n++) {
      attr.setXYZ(n, p.x, p.y, p.z);
      for (let k = 0; k < 3; k++) this.stepGrenade(p, v, 1 / 60, true);
      if (v.lengthSq() < 1) settled++;
      if (settled > 3) { n++; break; }
    }
    for (let i = n; i < attr.count; i++) attr.setXYZ(i, p.x, p.y, p.z);
    attr.needsUpdate = true;
    this.arc.geometry.setDrawRange(0, n);
    this.marker.position.copy(p).setY(Math.max(p.y, 0) + 0.03);
  }
}
