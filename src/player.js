import * as THREE from 'three';
import { BLOCKS } from './blocks.js';

const HALF_W = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;
const EPS = 1e-4;

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.headInWater = false;
    this.bob = 0;
    this.bobAmt = 0;
    this.fov = 72;
    this.lastSpace = 0;
  }

  look(dx, dy, sens) {
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
  }

  collides(world) {
    const x0 = Math.floor(this.pos.x - HALF_W), x1 = Math.floor(this.pos.x + HALF_W);
    const y0 = Math.floor(this.pos.y), y1 = Math.floor(this.pos.y + HEIGHT);
    const z0 = Math.floor(this.pos.z - HALF_W), z1 = Math.floor(this.pos.z + HALF_W);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (world.isSolid(x, y, z)) return { x, y, z };
    return null;
  }

  moveAxis(world, axis, d) {
    if (d === 0) return false;
    this.pos[axis] += d;
    const hit = this.collides(world);
    if (!hit) return false;
    if (axis === 'y') {
      this.pos.y = d > 0 ? hit.y - HEIGHT - EPS : hit.y + 1 + EPS;
    } else {
      const c = hit[axis];
      this.pos[axis] = d > 0 ? c - HALF_W - EPS : c + 1 + HALF_W + EPS;
    }
    return true;
  }

  intersectsBlock(x, y, z) {
    return this.pos.x + HALF_W > x && this.pos.x - HALF_W < x + 1 &&
      this.pos.y + HEIGHT > y && this.pos.y < y + 1 &&
      this.pos.z + HALF_W > z && this.pos.z - HALF_W < z + 1;
  }

  update(dt, input, world) {
    const feet = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z));
    const head = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z));
    this.inWater = feet > 0 && BLOCKS[feet].liquid;
    this.headInWater = head > 0 && BLOCKS[head].liquid;

    const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(-sin * fwd + cos * strafe, 0, -cos * fwd - sin * strafe);
    if (wish.lengthSq() > 0) wish.normalize();

    let speed = input.sprint ? 5.8 : 4.3;
    if (this.flying) speed = input.sprint ? 22 : 11;
    else if (this.inWater) speed = input.sprint ? 3.2 : 2.4;

    const target = wish.multiplyScalar(speed);
    const control = this.flying ? 8 : this.onGround ? 14 : this.inWater ? 5 : 2.5;
    const k = 1 - Math.exp(-dt * control);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;

    if (this.flying) {
      const vy = ((input.jump ? 1 : 0) - (input.descend ? 1 : 0)) * (input.sprint ? 16 : 9);
      this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-dt * 10));
    } else if (this.inWater) {
      this.vel.y -= 9 * dt;
      this.vel.y *= Math.exp(-dt * 2.5);
      if (input.jump) this.vel.y = Math.min(this.vel.y + 28 * dt, 3.5);
      this.vel.y = Math.max(this.vel.y, -3);
    } else {
      this.vel.y -= 28 * dt;
      this.vel.y = Math.max(this.vel.y, -60);
      if (input.jump && this.onGround) {
        this.vel.y = 8.6;
        this.onGround = false;
      }
    }

    const steps = Math.ceil((this.vel.length() * dt) / 0.4) || 1;
    const sdt = dt / steps;
    let grounded = false;
    for (let i = 0; i < steps; i++) {
      if (this.moveAxis(world, 'y', this.vel.y * sdt)) {
        if (this.vel.y < 0) grounded = true;
        this.vel.y = 0;
      }
      const hx = this.moveAxis(world, 'x', this.vel.x * sdt);
      const hz = this.moveAxis(world, 'z', this.vel.z * sdt);
      // Let the player climb out of water onto a ledge.
      if ((hx || hz) && this.inWater && input.jump) this.vel.y = 5;
      if (hx) this.vel.x = 0;
      if (hz) this.vel.z = 0;
    }
    this.onGround = grounded;
    if (grounded && this.flying) this.flying = false;

    const hs = Math.hypot(this.vel.x, this.vel.z);
    const walking = this.onGround && hs > 0.5;
    this.bobAmt += ((walking ? Math.min(hs / 5, 1.2) : 0) - this.bobAmt) * (1 - Math.exp(-dt * 8));
    if (walking) this.bob += hs * dt * 1.9;

    const targetFov = 72 + (input.sprint && hs > 4 ? (this.flying ? 12 : 8) : 0);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 8));

    const cam = this.camera;
    const bobY = Math.abs(Math.sin(this.bob * Math.PI)) * 0.055 * this.bobAmt;
    const bobX = Math.cos(this.bob * Math.PI) * 0.03 * this.bobAmt;
    cam.position.set(this.pos.x + cos * bobX, this.pos.y + EYE + bobY, this.pos.z - sin * bobX);
    cam.rotation.set(this.pitch, this.yaw, Math.cos(this.bob * Math.PI) * 0.004 * this.bobAmt, 'YXZ');
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
