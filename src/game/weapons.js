import * as THREE from 'three';

const FIRE_INTERVAL = 0.13;

export class Weapons {
  constructor(world, player, character, fx, audio) {
    this.world = world;
    this.player = player;
    this.character = character;
    this.fx = fx;
    this.audio = audio;
    this.cooldown = 0;
    this.side = 0;
    this.onHit = null;
  }

  update(dt, firing) {
    this.cooldown -= dt;
    if (!firing) return;
    // Firing from the hip raises both guns first, then shoots.
    this.player.aimHold = 0.9;
    if (this.character.aimWeight < 0.7 || this.cooldown > 0) return;
    this.cooldown = FIRE_INTERVAL;
    this.fire(this.side);
    this.side = 1 - this.side;
  }

  fire(side) {
    const ch = this.character;
    const muzzle = ch.muzzleWorld(side);
    const axis = ch.pistolAxis(side);
    const target = this.player.aimPoint.clone();
    const spread = 0.0035 * target.distanceTo(muzzle);
    target.add(new THREE.Vector3().randomDirection().multiplyScalar(spread * Math.random()));
    const dir = target.clone().sub(muzzle).normalize();
    const maxDist = muzzle.distanceTo(target) + 5;
    const hit = this.world.raycast(muzzle, dir, Math.min(maxDist, 600));

    this.fx.muzzle(muzzle, axis);
    const up = new THREE.Vector3().setFromMatrixColumn(ch.pistols[side].matrixWorld, 1);
    const right = new THREE.Vector3().crossVectors(axis, up).multiplyScalar(side === 0 ? 1 : -1);
    this.fx.ejectCasing(muzzle.clone().addScaledVector(axis, -0.08).addScaledVector(up, 0.02), right, up);
    ch.fired(side);
    this.player.recoilPitch += 0.012;
    this.audio.gunshot(side);

    const end = hit ? muzzle.clone().addScaledVector(dir, hit.t) : muzzle.clone().addScaledVector(dir, 400);
    this.fx.tracer(muzzle, end);
    if (!hit) return;
    this.fx.impact(end, hit.normal, hit.surface, dir);
    this.audio.impact(hit.surface, hit.t);
    if (hit.body || hit.target) {
      const scored = this.world.props.hit(hit, end, dir);
      this.onHit?.(scored);
    }
  }
}
