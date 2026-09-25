import * as THREE from 'three';

const GRAVITY = 16;
const JUMP_V = 5.4;
const RADIUS = 0.3;
const SPEED = { walk: 1.7, jog: 3.9, sprint: 6.3, aim: 3.0, aimWalk: 1.6, crouch: 0.95 };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  constructor(world, character, camera) {
    this.world = world;
    this.character = character;
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.camYaw = 0;
    this.camPitch = -0.08;
    this.onGround = true;
    this.airTime = 0;
    this.walkMode = false;
    this.crouchToggle = false;
    this.crouchT = 0;
    this.crouching = false;
    this.aimHold = 0;
    this.camDist = 3.2;
    this.camPos = new THREE.Vector3();
    this.shoulder = 0.55;
    this.fov = 60;
    this.aimPoint = new THREE.Vector3();
    this.aimHit = null;
    this.recoilPitch = 0;
    this.shake = 0;
    this.shakeSide = 1;
    this.facingError = 0;
    this.bob = 0;
    this.localDir = new THREE.Vector3();
    this.tmp = [];
    this.breath = 1;
    this.holdingBreath = false;
    this.scopeT = 0;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, this.world.terrain.heightAt(x, z), z);
    this.yaw = this.camYaw = yaw;
    this.character.root.position.copy(this.pos);
    this.character.root.visible = true;
    if (this.character.rifle) this.character.rifle.visible = true;
    this.camPos.copy(this.pos).add(new THREE.Vector3(0, 2, 0));
    this.breath = 1;
    this.holdingBreath = false;
    this.scopeT = 0;
    this.scoped = false;
    this.sniperPending = false;
    this.crouchToggle = false;
    this.crouchT = 0;
    this.crouching = false;
  }

  kick(side, strength = 1) {
    this.recoilPitch += 0.018 * strength;
    this.shake = Math.max(this.shake, 0.12 * Math.sqrt(strength));
    this.shakeSide = side ? -1 : 1;
  }

  look(dx, dy) {
    this.camYaw -= dx;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - dy, -1.25, 0.95);
  }

  update(dt, input) {
    const { terrain } = this.world;
    const weapon = this.fighter?.loadout.current;
    const sniping = weapon === 'rifle';
    const holdScope = sniping ? (input.fire || input.fireReleased || this.sniperPending) : input.aim;
    const aiming = holdScope || this.aimHold > 0;
    this.aimHold = Math.max(0, this.aimHold - dt);
    this.time = (this.time || 0) + dt;
    const reloading = this.character.action?.type === 'reload' || this.character.action?.type === 'pistolReload';
    const wantScope = !reloading && !!holdScope && sniping && this.character.weapon === 'rifle' && this.character.aimWeight > 0.85;
    if (wantScope && !this.scoped) this.onScope?.();
    this.scoped = wantScope;
    this.scopeT = THREE.MathUtils.clamp((this.scopeT || 0) + (this.scoped ? dt / 0.16 : -dt / 0.12), 0, 1);
    if (this.scoped && input.sprint && this.breath > 0) {
      this.holdingBreath = this.breath > 0.04;
      this.breath = Math.max(0, this.breath - dt / 2.7);
    } else {
      this.holdingBreath = false;
      this.breath = Math.min(1, this.breath + dt / 1.55);
    }
    if (input.toggleWalk) this.walkMode = !this.walkMode;
    if (input.toggleCrouch) this.crouchToggle = !this.crouchToggle;
    if (input.sprint && !this.scoped) this.crouchToggle = false;
    if (input.jump) this.crouchToggle = false;
    this.crouching = !!(input.crouch || this.crouchToggle) && this.onGround;
    this.crouchT += ((this.crouching ? 1 : 0) - this.crouchT) * Math.min(1, dt * 8);

    const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0) + (input.moveY || 0);
    const s = (input.right ? 1 : 0) - (input.left ? 1 : 0) + (input.moveX || 0);
    const camFwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const camRight = new THREE.Vector3(-camFwd.z, 0, camFwd.x);
    const wish = new THREE.Vector3().addScaledVector(camFwd, f).addScaledVector(camRight, s);
    const stick = Math.min(1, wish.length());
    const moving = stick > 0.06;
    if (moving) wish.multiplyScalar(1 / wish.length());

    let target = 0;
    if (moving) {
      if (this.crouching) target = SPEED.crouch;
      else if (this.scoped) target = SPEED.aimWalk;
      else if (aiming) target = input.sprint ? SPEED.aim : (this.walkMode ? SPEED.aimWalk : SPEED.aim * 0.85);
      else target = input.sprint ? SPEED.sprint : this.walkMode ? SPEED.walk : SPEED.jog;
      if (stick < 0.98) target *= stick;
    }

    // Facing: free movement turns the body, aiming locks it to the camera.
    if (aiming) {
      const err = wrapAngle(this.camYaw - this.yaw);
      this.yaw += Math.sign(err) * Math.min(Math.abs(err), Math.max(Math.abs(err) * 16, 6) * dt);
    } else if (moving) {
      const goal = Math.atan2(wish.x, wish.z);
      const turn = this.onGround ? 10 : 3;
      this.yaw += wrapAngle(goal - this.yaw) * Math.min(1, dt * turn);
    }

    const horiz = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const desired = wish.clone().multiplyScalar(target);
    const accel = this.onGround ? (target > horiz.length() ? 9 : 12) : 1.5;
    horiz.lerp(desired, Math.min(1, dt * accel));
    this.vel.x = horiz.x;
    this.vel.z = horiz.z;

    let jumpStarted = false;
    if (input.jump && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
      jumpStarted = true;
    }
    this.vel.y -= GRAVITY * dt;

    const next = this.pos.clone().addScaledVector(this.vel, dt);
    const ground = terrain.heightAt(next.x, next.z);
    const n = terrain.normalAt(next.x, next.z);
    // Too steep or too deep: stop at the edge.
    const uphill = n.x * this.vel.x + n.z * this.vel.z < 0;
    if ((n.y < 0.62 && uphill && ground > this.pos.y + 0.05) || ground < -1.15 || !terrain.inBounds(next.x, next.z)) {
      next.x = this.pos.x;
      next.z = this.pos.z;
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
    }

    const standH = 1.7 - this.crouchT * 1.05;
    this.world.veg.colliders.resolveXZ(next, RADIUS, next.y, next.y + standH);
    this.world.props.collidePlayer(next, RADIUS, this.vel, standH);
    for (const f of this.world.combat.fighters) {
      if (f === this.fighter || !f.alive) continue;
      const dx = next.x - f.pos.x, dz = next.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < RADIUS * 2 && d > 1e-4) { next.x = f.pos.x + (dx / d) * RADIUS * 2; next.z = f.pos.z + (dz / d) * RADIUS * 2; }
    }

    const g2 = terrain.heightAt(next.x, next.z);
    const wasGround = this.onGround;
    if (next.y <= g2 || (wasGround && this.vel.y <= 0 && next.y - g2 < 0.45)) {
      if (!wasGround && this.airTime > 0.25) this.onLand?.(-this.vel.y);
      next.y = g2;
      this.vel.y = 0;
      this.onGround = true;
      this.airTime = 0;
    } else {
      this.onGround = false;
      this.airTime += dt;
    }
    this.pos.copy(next);

    this.facingError = Math.abs(wrapAngle(this.camYaw - this.yaw));
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const fwdBody = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // The avatar's local +X is her left side.
    const leftBody = new THREE.Vector3(fwdBody.z, 0, -fwdBody.x);
    if (speed > 0.05) this.localDir.set(this.vel.x * leftBody.x + this.vel.z * leftBody.z, 0, this.vel.x * fwdBody.x + this.vel.z * fwdBody.z).normalize();

    const ch = this.character;
    ch.root.position.copy(this.pos);
    ch.root.rotation.y = this.yaw;

    this.updateCamera(dt, aiming, input.sprint && speed > 4.5 && !this.scoped && !this.crouching, speed);
    this.updateAim();

    ch.update(dt, {
      speed, onGround: this.onGround, airTime: this.airTime, strafe: aiming, localDir: this.localDir,
      jumpStarted, predictedAir: (2 * JUMP_V) / GRAVITY, aiming, aimPoint: this.aimPoint,
      lookDir: this.lookDir(), crouch: this.crouchT,
    });
    return { speed, aiming };
  }

  updateCamera(dt, aiming, sprinting, speed = 0) {
    const cam = this.camera;
    const { terrain, veg } = this.world;
    const k = Math.min(1, dt * 10);
    const scoped = this.scoped;
    const reloading = this.character.action?.type === 'reload' || this.character.action?.type === 'pistolReload';
    const through = this.scopeT > 0.55 && !reloading;
    this.reloadLook = (this.reloadLook || 0) + ((reloading ? 1 : 0) - (this.reloadLook || 0)) * Math.min(1, dt * 8);
    this.camDist += ((through ? 0.04 : reloading ? 1.18 : aiming ? 1.55 : 3.1) - this.camDist) * k;
    this.shoulder += ((through ? 0.02 : reloading ? 0.4 : aiming ? 0.6 : 0.5) - this.shoulder) * k;
    const fovGoal = through ? 7.5 : aiming ? 48 : sprinting ? 66 : 60;
    this.fov += (fovGoal - this.fov) * Math.min(1, dt * (through ? 11 : 6));
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    if (this.character.root) this.character.root.visible = !through;
    if (this.character.rifle) this.character.rifle.visible = !through;

    this.recoilPitch *= Math.exp(-dt * (scoped ? 4.5 : 10));
    // Breathing and heartbeat sway the scope, more when moving or hurt.
    let swayYaw = 0, swayPitch = 0;
    if (scoped) {
      const t = this.time;
      const hurt = this.fighter ? 1 + (1 - this.fighter.health / 100) * 1.5 : 1;
      const empty = this.breath < 0.05 ? 1.7 : 1;
      const hold = this.holdingBreath ? 0.1 : 1;
      const amp = (0.0028 + speed * 0.0032) * hurt * empty * hold;
      swayYaw = (Math.sin(t * 0.83) + 0.5 * Math.sin(t * 1.9 + 1.3)) * amp;
      swayPitch = (Math.sin(t * 1.21 + 0.7) + 0.4 * Math.sin(t * 2.6)) * amp * 0.8;
    }
    const pitch = this.camPitch + this.recoilPitch + swayPitch - (this.reloadLook || 0) * 0.2;
    const yaw = this.camYaw + swayYaw;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    const eye = (through ? 1.64 : aiming ? 1.58 : 1.55) - this.crouchT * 0.52;
    const pivot = this.pos.clone().add(new THREE.Vector3(0, eye, 0));
    const smoothPivot = this.smoothPivot || pivot.clone();
    smoothPivot.x = pivot.x;
    smoothPivot.z = pivot.z;
    smoothPivot.y += (pivot.y - smoothPivot.y) * Math.min(1, dt * 14);
    this.smoothPivot = smoothPivot;
    const shoulderPt = smoothPivot.clone().addScaledVector(right, this.shoulder);
    let dist = this.camDist;
    // Pull the camera in front of terrain and trees.
    const back = dir.clone().negate();
    const tHit = terrain.raycast(shoulderPt, back, dist + 0.3);
    if (tHit !== null) dist = Math.min(dist, Math.max(0.4, tHit - 0.3));
    const cHit = veg.colliders.raycast(shoulderPt, back, dist + 0.2);
    if (cHit) dist = Math.min(dist, Math.max(0.4, cHit.t - 0.2));
    if (this.smoothDist === undefined || dist < this.smoothDist) this.smoothDist = dist;
    else this.smoothDist += (dist - this.smoothDist) * Math.min(1, dt * 5);
    this.camPos.copy(shoulderPt).addScaledVector(back, this.smoothDist);
    const minY = terrain.heightAt(this.camPos.x, this.camPos.z) + 0.25;
    if (this.camPos.y < minY) this.camPos.y = minY;
    this.shake *= Math.exp(-dt * 22);
    cam.position.copy(this.camPos).addScaledVector(right, this.shake * this.shakeSide * 0.04);
    cam.lookAt(cam.position.clone().add(dir));
    cam.rotateZ(this.shake * this.shakeSide * 0.06);
  }

  // Eye height at the body, not the shoulder camera, so cover the player is
  // standing behind actually sits on the aim ray.
  eyeHeight() {
    const through = this.scopeT > 0.4;
    return (through ? 1.64 : this.character?.aimWeight > 0.5 ? 1.58 : 1.55) - this.crouchT * 0.52;
  }

  losOrigin(out = new THREE.Vector3()) {
    return out.copy(this.pos).setY(this.pos.y + this.eyeHeight());
  }

  lookDir(out = new THREE.Vector3()) {
    this.camera.getWorldDirection(out);
    return out;
  }

  // The on-screen crosshair is the camera look. Hip-fire aim must use that
  // ray — a body-center ray sits ~0.5 m left of the shoulder camera, so the
  // reticle went red while the pistols still missed to the left.
  updateAim() {
    const d = this.lookDir();
    const through = this.scopeT > 0.4;
    const start = new THREE.Vector3();
    if (through) this.losOrigin(start).addScaledVector(d, 0.2);
    else start.copy(this.camera.position).addScaledVector(d, Math.max(0.35, this.smoothDist ?? this.camDist));
    const reach = through ? 900 : 600;
    const hit = this.world.raycast(start, d, reach, this.fighter);
    if (hit) { this.aimPoint.copy(start).addScaledVector(d, hit.t); this.aimHit = hit; }
    else { this.aimPoint.copy(start).addScaledVector(d, reach); this.aimHit = null; }
    if (!this.aimHit?.fighter || through) return;
    const from = this.losOrigin();
    const to = this.aimPoint.clone().sub(from);
    const len = to.length();
    if (len <= 0.25) return;
    to.multiplyScalar(1 / len);
    from.addScaledVector(to, 0.2);
    const block = this.world.raycast(from, to, len - 0.2, this.fighter);
    if (block && block.fighter !== this.aimHit.fighter) this.aimHit = null;
  }

  get underwater() { return this.camera.position.y < 0.05; }
}
