import * as THREE from 'three';

const GRAVITY = 16;
const JUMP_V = 5.4;
const RADIUS = 0.3;
const SPEED = { walk: 1.7, jog: 3.9, sprint: 6.3, aim: 3.0, aimWalk: 1.6 };

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
    this.aimHold = 0;
    this.camDist = 3.2;
    this.camPos = new THREE.Vector3();
    this.shoulder = 0.55;
    this.fov = 60;
    this.aimPoint = new THREE.Vector3();
    this.aimHit = null;
    this.recoilPitch = 0;
    this.bob = 0;
    this.localDir = new THREE.Vector3();
    this.tmp = [];
  }

  spawn(x, z, yaw) {
    this.pos.set(x, this.world.terrain.heightAt(x, z), z);
    this.yaw = this.camYaw = yaw;
    this.character.root.position.copy(this.pos);
    this.camPos.copy(this.pos).add(new THREE.Vector3(0, 2, 0));
  }

  look(dx, dy) {
    this.camYaw -= dx;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - dy, -1.25, 0.95);
  }

  update(dt, input) {
    const { terrain } = this.world;
    const aiming = input.aim || this.aimHold > 0;
    this.aimHold = Math.max(0, this.aimHold - dt);
    if (input.toggleWalk) this.walkMode = !this.walkMode;

    const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const s = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const camFwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const camRight = new THREE.Vector3(-camFwd.z, 0, camFwd.x);
    const wish = new THREE.Vector3().addScaledVector(camFwd, f).addScaledVector(camRight, s);
    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();

    let target = 0;
    if (moving) {
      if (aiming) target = input.sprint ? SPEED.aim : (this.walkMode ? SPEED.aimWalk : SPEED.aim * 0.85);
      else target = input.sprint ? SPEED.sprint : this.walkMode ? SPEED.walk : SPEED.jog;
    }

    // Facing: free movement turns the body, aiming locks it to the camera.
    if (aiming) {
      this.yaw += wrapAngle(this.camYaw - this.yaw) * Math.min(1, dt * 14);
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

    const cols = this.world.veg.colliders.query(next.x, next.z, 1.5, this.tmp);
    for (const c of cols) {
      if (next.y > c.y1 || next.y + 1.7 < c.y0) continue;
      const dx = next.x - c.x, dz = next.z - c.z;
      const r = c.r + RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1e-4;
        next.x = c.x + (dx / d) * r;
        next.z = c.z + (dz / d) * r;
        if (next.y > c.y1 - 0.5) { next.y = Math.max(next.y, c.y1); this.vel.y = Math.max(0, this.vel.y); }
      }
    }
    this.world.props.collidePlayer(next, RADIUS, this.vel);

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

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const fwdBody = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // The avatar's local +X is her left side.
    const leftBody = new THREE.Vector3(fwdBody.z, 0, -fwdBody.x);
    if (speed > 0.05) this.localDir.set(this.vel.x * leftBody.x + this.vel.z * leftBody.z, 0, this.vel.x * fwdBody.x + this.vel.z * fwdBody.z).normalize();

    const ch = this.character;
    ch.root.position.copy(this.pos);
    ch.root.rotation.y = this.yaw;

    this.updateCamera(dt, aiming, input.sprint && speed > 4.5);
    this.updateAim();

    ch.update(dt, {
      speed, onGround: this.onGround, airTime: this.airTime, strafe: aiming, localDir: this.localDir,
      jumpStarted, predictedAir: (2 * JUMP_V) / GRAVITY, aiming, aimPoint: this.aimPoint,
    });
    return { speed, aiming };
  }

  updateCamera(dt, aiming, sprinting) {
    const cam = this.camera;
    const { terrain, veg } = this.world;
    const k = Math.min(1, dt * 10);
    this.camDist += ((aiming ? 1.55 : 3.1) - this.camDist) * k;
    this.shoulder += ((aiming ? 0.6 : 0.5) - this.shoulder) * k;
    this.fov += ((aiming ? 48 : sprinting ? 66 : 60) - this.fov) * Math.min(1, dt * 6);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }

    this.recoilPitch *= Math.exp(-dt * 10);
    const pitch = this.camPitch + this.recoilPitch;
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.camYaw) * Math.cos(pitch));
    const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    const pivot = this.pos.clone().add(new THREE.Vector3(0, aiming ? 1.58 : 1.55, 0));
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
    cam.position.copy(this.camPos);
    cam.lookAt(this.camPos.clone().add(dir));
  }

  // Finds what the crosshair points at, so bullets land where it shows.
  updateAim() {
    const cam = this.camera;
    const o = cam.position.clone();
    const d = new THREE.Vector3();
    cam.getWorldDirection(d);
    const skip = o.distanceTo(this.pos) + 0.5;
    const start = o.clone().addScaledVector(d, skip);
    const hit = this.world.raycast(start, d, 600);
    if (hit) { this.aimPoint.copy(start).addScaledVector(d, hit.t); this.aimHit = hit; }
    else { this.aimPoint.copy(start).addScaledVector(d, 600); this.aimHit = null; }
    if (this.aimPoint.distanceTo(this.pos) < 3) this.aimPoint.copy(start).addScaledVector(d, 6);
  }

  get underwater() { return this.camera.position.y < 0.05; }
}
