import * as THREE from 'three';
import { FLOAT_Y, canExitWater, shouldSwim, stepSwim, swimSpeed, hasSea } from './swim.js';
import { cockpitEye, driverPose } from './cars.js';

const GRAVITY = 16;
const JUMP_V = 5.4;
const RADIUS = 0.3;
const SPEED = { walk: 1.7, jog: 3.9, sprint: 6.3, aim: 3.0, aimWalk: 1.6, crouch: 0.95 };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Look a living subject is using — same yaw/pitch their own camera would have. */
export function spectateLook(sub) {
  if (!sub) return { yaw: 0, pitch: -0.08, aiming: false };
  if (Number.isFinite(sub.lookYaw)) {
    return {
      yaw: sub.lookYaw,
      pitch: Number.isFinite(sub.lookPitch) ? sub.lookPitch : 0,
      aiming: !!sub.aiming,
    };
  }
  if (sub.lookPoint && sub.pos) {
    const eyeY = sub.pos.y + 1.5;
    const dx = sub.lookPoint.x - sub.pos.x;
    const dy = sub.lookPoint.y - eyeY;
    const dz = sub.lookPoint.z - sub.pos.z;
    const flat = Math.hypot(dx, dz) || 1e-6;
    return {
      yaw: Math.atan2(dx, dz),
      pitch: Math.atan2(dy, flat),
      aiming: !!sub.aiming,
    };
  }
  return {
    yaw: sub.yaw ?? 0,
    pitch: Number.isFinite(sub.pitch) ? sub.pitch : -0.08,
    aiming: !!sub.aiming,
  };
}

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
    this.swimming = false;
    this.diving = false;
    this.swimPitch = 0;
  }

  spawn(x, z, yaw) {
    if (this.vehicle) this.world.cars?.ejectLocal(this);
    this._carYaw = undefined;
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
    this.swimming = false;
    this.diving = false;
    this.swimPitch = 0;
  }

  kick(side, strength = 1) {
    this.recoilPitch += 0.018 * strength;
    // and a little sideways: sustained fire wanders, it doesn't only climb
    this.camYaw += (Math.random() - 0.5) * 0.005 * strength;
    this.shake = Math.max(this.shake, 0.12 * Math.sqrt(strength));
    this.shakeSide = side ? -1 : 1;
  }

  look(dx, dy) {
    this.lookIdle = 0;
    this.camYaw -= dx;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - dy, -1.25, 0.95);
  }

  update(dt, input, follow = null) {
    if (this.vehicle && !follow) return this.updateInCar(dt, input);
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
    this.crouching = !!(input.crouch || this.crouchToggle) && this.onGround && !this.swimming;
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
      if (this.character.stagger > 0) target *= 0.45; // shot in the leg
    }

    // Face the mouse look so the body points where the reticle goes.
    // Movement stays camera-relative; walk/strafe/back come from localDir.
    {
      const err = wrapAngle(this.camYaw - this.yaw);
      const rate = aiming ? Math.max(Math.abs(err) * 16, 8) : Math.max(Math.abs(err) * 12, 5);
      this.yaw += Math.sign(err) * Math.min(Math.abs(err), rate * dt);
    }

    const look3 = this.lookDir();
    const swimUp = !!(input.climb || input.jump);
    const swimDown = !!(input.crouch || (this.swimming && this.crouchToggle));
    const floorNow = terrain.heightAt(this.pos.x, this.pos.z);
    this.swimming = shouldSwim(this.pos.y, floorNow, this.swimming);
    this.diving = this.swimming && (swimDown || this.pos.y < FLOAT_Y - 0.55);

    let jumpStarted = false;
    const next = this.pos.clone();
    if (this.swimming) {
      const spd = swimSpeed(this.diving, !!(input.sprint && !aiming), stick);
      const wish3 = new THREE.Vector3();
      if (this.diving) {
        wish3.addScaledVector(look3, f).addScaledVector(camRight, s);
        if (swimUp) wish3.y += 1;
        if (swimDown) wish3.y -= 1;
      } else {
        wish3.copy(wish);
        if (swimUp) wish3.y += 0.55;
        if (swimDown) wish3.y -= 1.15;
      }
      if (wish3.lengthSq() > 1e-6) wish3.normalize();
      const desired = wish3.multiplyScalar(spd);
      const accel = 7;
      this.vel.x += (desired.x - this.vel.x) * Math.min(1, dt * accel);
      this.vel.z += (desired.z - this.vel.z) * Math.min(1, dt * accel);
      next.x += this.vel.x * dt;
      next.z += this.vel.z * dt;
      if (!terrain.inBounds(next.x, next.z)) {
        next.x = this.pos.x;
        next.z = this.pos.z;
        this.vel.x *= 0.2;
        this.vel.z *= 0.2;
      }
      const floor = terrain.heightAt(next.x, next.z);
      const stepped = stepSwim({
        y: this.pos.y, vy: this.vel.y, wishY: desired.y, diving: this.diving, dt, floor,
      });
      next.y = stepped.y;
      this.vel.y = stepped.vy;
      this.onGround = false;
      this.airTime = 0;
      if (canExitWater(floor, next.y, swimUp && floor > -0.55)) {
        next.y = floor;
        this.vel.y = swimUp ? 3.2 : 0;
        this.swimming = false;
        this.diving = false;
        this.onGround = true;
        this.onLand?.(2);
      }
    } else {
      const horiz = new THREE.Vector3(this.vel.x, 0, this.vel.z);
      const desired = wish.clone().multiplyScalar(target);
      const accel = this.onGround ? (target > horiz.length() ? 9 : 12) : 1.5;
      horiz.lerp(desired, Math.min(1, dt * accel));
      this.vel.x = horiz.x;
      this.vel.z = horiz.z;
      const knock = this.fighter?.knock;
      if (knock && knock.lengthSq() > 1e-6) { // a blast throws you
        this.vel.add(knock);
        if (knock.y > 0.3) this.onGround = false;
        knock.set(0, 0, 0);
      }

      if (input.jump && this.onGround) {
        this.vel.y = JUMP_V;
        this.onGround = false;
        jumpStarted = true;
      }
      this.vel.y -= GRAVITY * dt;

      next.addScaledVector(this.vel, dt);
      const ground = terrain.heightAt(next.x, next.z);
      const n = terrain.normalAt(next.x, next.z);
      const uphill = n.x * this.vel.x + n.z * this.vel.z < 0;
      if ((n.y < 0.62 && uphill && ground > this.pos.y + 0.05) || !terrain.inBounds(next.x, next.z)) {
        next.x = this.pos.x;
        next.z = this.pos.z;
        this.vel.x *= 0.2;
        this.vel.z *= 0.2;
      }

      const g2 = terrain.heightAt(next.x, next.z);
      if (shouldSwim(next.y, g2, false) && next.y < 0.35) {
        this.swimming = true;
        this.onGround = false;
        this.world.fx?.impact?.(next.clone().setY(0.02), new THREE.Vector3(0, 1, 0), 'water', new THREE.Vector3(0, -1, 0));
      } else {
        const wasGround = this.onGround;
        if (next.y <= g2 || (wasGround && this.vel.y <= 0 && next.y - g2 < 0.45)) {
          if (!wasGround && this.airTime > 0.25) {
            this.onLand?.(-this.vel.y);
            this.landDip = Math.min(0.28, Math.max(this.landDip || 0, -this.vel.y * 0.035)); // knees take the landing
          }
          next.y = g2;
          this.vel.y = 0;
          this.onGround = true;
          this.airTime = 0;
        } else {
          this.onGround = false;
          this.airTime += dt;
        }
      }
    }

    const standH = 1.7 - this.crouchT * 0.50;
    this.world.veg.colliders.resolveXZ(next, RADIUS, next.y, next.y + standH);
    this.world.props.collidePlayer(next, RADIUS, this.vel, standH);
    this.world.cars?.collideWalker(next, RADIUS, this.vehicle);
    for (const f of this.world.combat.fighters) {
      if (f === this.fighter || !f.alive) continue;
      const dx = next.x - f.pos.x, dz = next.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < RADIUS * 2 && d > 1e-4) { next.x = f.pos.x + (dx / d) * RADIUS * 2; next.z = f.pos.z + (dz / d) * RADIUS * 2; }
    }
    this.pos.copy(next);

    this.facingError = Math.abs(wrapAngle(this.camYaw - this.yaw));
    const speed = Math.hypot(this.vel.x, this.vel.y * (this.swimming ? 1 : 0), this.vel.z);
    const fwdBody = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // The avatar's local +X is her left side.
    const leftBody = new THREE.Vector3(fwdBody.z, 0, -fwdBody.x);
    if (speed > 0.05) this.localDir.set(this.vel.x * leftBody.x + this.vel.z * leftBody.z, 0, this.vel.x * fwdBody.x + this.vel.z * fwdBody.z).normalize();

    const ch = this.character;
    ch.root.position.copy(this.pos);
    const pitchGoal = this.diving ? 1.05 : this.swimming ? 0.32 : 0;
    this.swimPitch += (pitchGoal - this.swimPitch) * Math.min(1, dt * 5);
    ch.root.rotation.order = 'YXZ';
    ch.root.rotation.x = this.swimPitch;
    ch.root.rotation.y = this.yaw;
    ch.root.rotation.z = 0;

    if (follow) {
      const look = spectateLook(follow);
      this.camYaw = look.yaw;
      this.camPitch = THREE.MathUtils.clamp(look.pitch, -1.25, 0.95);
      this.scoped = false;
      this.scopeT = 0;
      this.holdingBreath = false;
      const spd = follow.speed ?? 0;
      this.updateCamera(dt, look.aiming, spd > 4.5 && !look.aiming, spd, follow);
    } else {
      this.updateCamera(dt, aiming, input.sprint && speed > 4.5 && !this.scoped && !this.crouching, speed);
      this.updateAim();
    }

    ch.update(dt, {
      speed, onGround: this.onGround, airTime: this.airTime, strafe: true, localDir: this.localDir,
      jumpStarted, predictedAir: (2 * JUMP_V) / GRAVITY, aiming: aiming && !this.swimming, aimPoint: this.aimPoint,
      lookDir: this.lookDir(), crouch: this.crouchT, swimming: this.swimming, diving: this.diving,
    });
    return { speed, aiming };
  }

  updateInCar(dt, input) {
    const car = this.vehicle;
    if (input.toggleWalk) this.cockpitView = !this.cockpitView;
    const dyaw = wrapAngle(car.yaw - (this._carYaw ?? car.yaw));
    this.camYaw += dyaw;
    this._carYaw = car.yaw;
    this.pos.copy(car.seat);
    this.vel.copy(car.vel);
    this.yaw = car.yaw;
    this.onGround = true;
    this.airTime = 0;
    this.swimming = false;
    this.diving = false;
    this.crouching = false;
    this.crouchT += (0 - this.crouchT) * Math.min(1, dt * 8);
    this.scoped = false;
    this.scopeT = 0;
    this.holdingBreath = false;
    this.aimHold = 0;
    this.time = (this.time || 0) + dt;
    const ch = this.character;
    ch.root.position.copy(this.pos);
    const standing = car.kind === 'scooter'; // a scooter rider is on show, not in a cockpit
    ch.root.rotation.order = 'YXZ';
    ch.root.rotation.x = 0;
    ch.root.rotation.y = this.yaw;
    ch.root.rotation.z = standing ? car.body?.r || 0 : 0; // lean with the deck
    ch.root.visible = true; // seen through the glass from the chase camera
    if (!standing) {
      if (ch.rifle) ch.rifle.visible = false;
      ch.pistols?.forEach((p) => { p.visible = false; });
    }
    ch.steer = car.steer || 0;
    this.updateCamera(dt, false, Math.abs(car.speed) > (standing ? 9 : 14), Math.abs(car.speed));
    this.updateAim();
    ch.update(dt, {
      speed: 0, onGround: true, airTime: 0, strafe: false, localDir: this.localDir.set(0, 0, 1),
      jumpStarted: false, predictedAir: 0, aiming: false, aimPoint: this.aimPoint,
      lookDir: this.lookDir(), crouch: 0, swimming: false, diving: false, seat: driverPose(car),
    });
    return { speed: Math.abs(car.speed), aiming: false, driving: true };
  }

  updateCamera(dt, aiming, sprinting, speed = 0, follow = null) {
    const cam = this.camera;
    const { terrain, veg } = this.world;
    const k = Math.min(1, dt * 10);
    const scoped = follow ? false : this.scoped;
    const rideCar = (v) => (v && v.kind !== 'scooter' ? v : null); // scooters keep the third-person camera
    const ride = rideCar(follow?.vehicle) || (!follow && rideCar(this.vehicle));
    if (ride) {
      // Chase camera by default; V switches to the cockpit in cars that have an interior.
      if (!(this.cockpitView && ride.cockpit)) { this.updateChaseCamera(dt, ride, follow); return; }
      this.updateCockpitCamera(dt, ride, follow, sprinting, speed);
      return;
    }
    this.chasePos = null;
    if (this._cockpitHide?.root) this._cockpitHide.root.visible = true;
    this._cockpitHide = null;
    const body = follow?.pos || this.pos;
    const crouch = follow
      ? (follow.crouchT ?? follow.crouch ?? follow.character?.crouchT ?? 0)
      : this.crouchT;
    const reloading = !follow && (this.character.action?.type === 'reload' || this.character.action?.type === 'pistolReload');
    const through = !follow && this.scopeT > 0.55 && !reloading;
    this.reloadLook = (this.reloadLook || 0) + ((reloading ? 1 : 0) - (this.reloadLook || 0)) * Math.min(1, dt * 8);
    const swimCam = !follow && this.swimming;
    this.camDist += ((through ? 0.04 : reloading ? 1.18 : swimCam ? 2.4 : aiming ? 1.55 : 3.1) - this.camDist) * k;
    this.shoulder += ((through ? 0.02 : reloading ? 0.4 : aiming ? 0.6 : 0.5) - this.shoulder) * k;
    const fovGoal = through ? 7.5 : aiming ? 48 : sprinting ? 66 : 60;
    this.fov += (fovGoal - this.fov) * Math.min(1, dt * (through ? 11 : 6));
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    const inCockpit = !!rideCar(this.vehicle);
    if (this.character.root && !inCockpit) this.character.root.visible = follow ? true : !through;
    if (this.character.rifle && !inCockpit && !this.character.rifle.userData.dropHidden) this.character.rifle.visible = follow ? true : !through;

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
    this.landDip = (this.landDip || 0) * Math.exp(-dt * 7);
    const eye = (through ? 1.64 : aiming ? 1.58 : 1.55) - crouch * 0.38 - (follow ? 0 : this.landDip);
    const pivot = body.clone().add(new THREE.Vector3(0, eye, 0));
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
    // City maps: walls are the real triangles (the walking boxes skip rays there).
    const sHit = this.world.shots?.raycast(shoulderPt, back, dist + 0.2);
    if (sHit) dist = Math.min(dist, Math.max(0.4, sHit.t - 0.2));
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

  // Third person behind the car: trails into turns, sits back and widens with speed, and
  // swings back behind the car a moment after the mouse stops moving.
  updateChaseCamera(dt, car, follow) {
    const cam = this.camera;
    const spd = Math.abs(car.speed || 0);
    this.lookIdle = (this.lookIdle || 0) + dt;
    if (follow) {
      const look = spectateLook(follow);
      this.camYaw = look.yaw;
      this.camPitch = THREE.MathUtils.clamp(look.pitch, -0.6, 0.35);
    } else if (this.lookIdle > 0.8 && spd > 1.5) {
      this.camYaw += wrapAngle(car.yaw - this.camYaw) * (1 - Math.exp(-dt * 2.2)); // behind the nose, reversing too
      this.camPitch += (-0.06 - this.camPitch) * (1 - Math.exp(-dt * 1.5));
    }
    const fovGoal = 62 + Math.min(spd, 30) * 0.4;
    this.fov += (fovGoal - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    const yaw = this.camYaw;
    const pitch = THREE.MathUtils.clamp(this.camPitch - 0.14, -0.7, 0.3);
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const lead = Math.min(spd, 25) * 0.04 * Math.sign(car.speed || 0);
    const target = new THREE.Vector3(car.x + Math.sin(car.yaw) * lead, car.y + 1.3, car.z + Math.cos(car.yaw) * lead);
    let dist = 5.4 + Math.min(spd, 30) * 0.05;
    const back = dir.clone().negate();
    const up = 0.5;
    const probe = back.clone().multiplyScalar(dist).setY(back.y * dist + up).normalize();
    const hit = this.world.shots?.raycast(target, probe, dist + 0.5);
    const tHit = this.world.terrain.raycast(target, probe, dist + 0.5);
    const near = Math.min(hit ? hit.t : Infinity, tHit ?? Infinity);
    if (near < dist + 0.3) dist = Math.max(1.2, near - 0.35);
    const desired = target.clone().addScaledVector(probe, dist);
    const minY = this.world.terrain.heightAt(desired.x, desired.z) + 0.4;
    if (desired.y < minY) desired.y = minY;
    if (!this.chasePos || this.chasePos.distanceTo(desired) > 25) this.chasePos = desired.clone();
    else this.chasePos.lerp(desired, 1 - Math.exp(-dt * 12));
    // never let the smoothing drag the camera through a wall the probe just found
    if (near < Infinity && this.chasePos.distanceTo(target) > dist + 0.2) {
      this.chasePos.sub(target).setLength(dist).add(target);
    }
    this.camDist = dist;
    this.smoothDist = dist;
    this.camPos.copy(this.chasePos);
    this.smoothPivot = target.clone();
    this.shake *= Math.exp(-dt * 18);
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    cam.position.copy(this.chasePos).addScaledVector(right, this.shake * this.shakeSide * 0.03);
    cam.lookAt(target.clone().addScaledVector(dir, 4));
    cam.rotateZ(this.shake * this.shakeSide * 0.02);
  }

  updateCockpitCamera(dt, ride, follow, sprinting, speed = 0) {
    const cam = this.camera;
    const eye = cockpitEye(ride);
    this.camDist = 0;
    this.smoothDist = 0;
    const fovGoal = sprinting || speed > 18 ? 76 : 70;
    this.fov += (fovGoal - this.fov) * Math.min(1, dt * 6);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    if (this.character.root) this.character.root.visible = false;
    if (this.character.rifle) this.character.rifle.visible = false;
    if (follow?.character?.root) {
      follow.character.root.visible = false;
      this._cockpitHide = follow.character;
    }
    const look = follow ? spectateLook(follow) : null;
    const yaw = look ? look.yaw : this.camYaw;
    const pitch = THREE.MathUtils.clamp(look ? look.pitch : this.camPitch, -0.55, 0.42);
    const dir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    );
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    this.camPos.set(eye.x, eye.y, eye.z);
    this.smoothPivot = this.camPos.clone();
    this.shake *= Math.exp(-dt * 18);
    cam.position.copy(this.camPos).addScaledVector(right, this.shake * this.shakeSide * 0.012);
    cam.lookAt(cam.position.clone().add(dir));
    cam.rotateZ((ride.steer || 0) * -0.035 + this.shake * this.shakeSide * 0.02);
  }

  // Eye height at the body, not the shoulder camera, so cover the player is
  // standing behind actually sits on the aim ray.
  eyeHeight() {
    const through = this.scopeT > 0.4;
    return (through ? 1.64 : this.character?.aimWeight > 0.5 ? 1.58 : 1.55) - this.crouchT * 0.38;
  }

  losOrigin(out = new THREE.Vector3()) {
    return out.copy(this.pos).setY(this.pos.y + this.eyeHeight());
  }

  lookDir(out = new THREE.Vector3()) {
    this.camera.getWorldDirection(out);
    return out;
  }

  // Same origin + look the crosshair uses. Hip-fire must travel this ray:
  // a chest→aimPoint line sits left of the reticle and still clips a head
  // the player already aimed past on the right.
  aimRay(outOrigin = new THREE.Vector3(), outDir = new THREE.Vector3()) {
    this.lookDir(outDir);
    const through = this.scopeT > 0.4;
    if (through) this.losOrigin(outOrigin).addScaledVector(outDir, 0.2);
    else {
      const along = Math.max(0.35, this.smoothDist ?? this.camDist ?? 1.55);
      outOrigin.copy(this.camera.position).addScaledVector(outDir, along);
    }
    return { origin: outOrigin, dir: outDir };
  }

  // The on-screen crosshair is the camera look. Hip-fire aim must use that
  // ray — a body-center ray sits ~0.5 m left of the shoulder camera, so the
  // reticle went red while the pistols still missed to the left.
  updateAim() {
    const d = new THREE.Vector3();
    const start = new THREE.Vector3();
    this.aimRay(start, d);
    const through = this.scopeT > 0.4;
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

  get underwater() { return hasSea() && (this.camera.position.y < 0.02 || (this.diving && this.pos.y < FLOAT_Y - 0.2)); }
}
