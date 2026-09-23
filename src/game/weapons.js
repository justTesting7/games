import * as THREE from 'three';

const FIRE_INTERVAL = 0.13;
const tmp = new THREE.Vector3();

export class Weapons {
  constructor(world, player, character, fx, audio, combat) {
    this.world = world;
    this.player = player;
    this.character = character;
    this.fx = fx;
    this.audio = audio;
    this.combat = combat;
    this.cooldown = 0;
    this.side = 0;
    this.onHit = null;
    this.onNearMiss = null;
  }

  update(dt, firing, pressed) {
    this.cooldown -= dt;
    if (pressed) this.queued = 0.5;
    this.queued = Math.max(0, (this.queued || 0) - dt);
    if (!firing && !this.queued) return;
    // Firing from the hip turns her to the target and raises both guns
    // first; a quick click is remembered until they are up.
    this.player.aimHold = 1.2;
    const ready = this.character.aimWeight > 0.8 && this.player.facingError < 0.35;
    if (!ready || this.cooldown > 0) return;
    this.cooldown = FIRE_INTERVAL;
    this.queued = 0;
    this.fire(this.side);
    this.side = 1 - this.side;
  }

  fire(side) {
    const hit = this.shoot(this.player.fighter, side, this.player.aimPoint, 0.0035);
    this.player.kick(side);
    if (hit?.fighter) this.onHit?.(hit.fighter.alive ? (hit.head ? 'head' : 'body') : 'kill');
    else if (hit?.scored || hit?.body) this.onHit?.('prop');
  }

  // Fires one pistol of `shooter` towards `aimPoint`; spread is in radians.
  shoot(shooter, side, aimPoint, spread) {
    const ch = shooter.character;
    const muzzle = ch.muzzleWorld(side);
    const axis = ch.pistolAxis(side);
    const target = aimPoint.clone();
    const r = spread * target.distanceTo(muzzle);
    target.add(new THREE.Vector3().randomDirection().multiplyScalar(r * Math.random()));
    const dir = target.clone().sub(muzzle).normalize();
    const hit = this.world.raycast(muzzle, dir, 600, shooter);

    this.fx.muzzle(muzzle, axis);
    const up = new THREE.Vector3().setFromMatrixColumn(ch.pistols[side].matrixWorld, 1);
    const right = new THREE.Vector3().crossVectors(axis, up).multiplyScalar(side === 0 ? 1 : -1);
    this.fx.ejectCasing(muzzle.clone().addScaledVector(axis, -0.08).addScaledVector(up, 0.02), right, up);
    ch.fired(side);
    shooter.lastShotT = this.combat.time;
    const listener = this.player.camera.position;
    const camRight = tmp.setFromMatrixColumn(this.player.camera.matrixWorld, 0);
    const toShot = muzzle.clone().sub(listener);
    const dist = toShot.length();
    this.audio.gunshot(side, shooter.isPlayer ? 0 : dist, shooter.isPlayer ? null : toShot.normalize().dot(camRight));

    const end = hit ? muzzle.clone().addScaledVector(dir, hit.t) : muzzle.clone().addScaledVector(dir, 400);
    this.fx.tracer(muzzle, end);
    if (!shooter.isPlayer) this.checkNearMiss(muzzle, end, hit);
    if (!hit) return null;
    this.fx.impact(end, hit.normal, hit.surface, dir);
    this.audio.impact(hit.surface, end.distanceTo(listener));
    if (hit.fighter) this.combat.damage(hit.fighter, shooter, hit.head, dir);
    else if (hit.body || hit.target) hit.scored = this.world.props.hit(hit, end, dir);
    return hit;
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
}
