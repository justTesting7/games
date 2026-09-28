import * as THREE from 'three';
import { Ball, groundPassSpeed, loftSpeed, rollTime, rollSpeedAfter } from './ball.js';
import { BALL_RADIUS } from '../world/dims.js';

// Box-Muller normal sample for kick error.
export function gauss(rnd = Math.random) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const loftCache = new Map();
export function cachedLoftSpeed(dist, angle) {
  const d = Math.max(3, Math.min(80, Math.round(dist * 2) / 2));
  const a = Math.round(angle * 20) / 20;
  const key = `${d}|${a}`;
  let v = loftCache.get(key);
  if (v === undefined) { v = loftSpeed(d, a); loftCache.set(key, v); }
  return v;
}

const _d = new THREE.Vector3();

// Ground pass towards `target`, arriving at a speed that scales with range.
export function groundPass(from, target, { error = 0, rnd = Math.random, arrive } = {}) {
  _d.subVectors(target, from).setY(0);
  const dist = Math.max(1, _d.length());
  const want = arrive ?? THREE.MathUtils.clamp(7 + dist * 0.18, 8, 14);
  let speed = Math.min(34, groundPassSpeed(dist, want));
  // The rolling solve can come up short; a pass has to actually arrive.
  if (rollSpeedAfter(speed, dist) < want * 0.8) speed = Math.min(36, speed + 4);
  const yaw = Math.atan2(_d.z, _d.x) + gauss(rnd) * error;
  const k = 1 + gauss(rnd) * error * 0.8;
  return new THREE.Vector3(Math.cos(yaw) * speed * k, 0, Math.sin(yaw) * speed * k);
}

// Lofted ball landing on `target` at elevation `angle`.
export function loftedPass(from, target, angle, { error = 0, rnd = Math.random } = {}) {
  _d.subVectors(target, from).setY(0);
  const dist = Math.max(2, _d.length());
  const speed = cachedLoftSpeed(dist, angle) * (1 + gauss(rnd) * error * 0.7);
  const yaw = Math.atan2(_d.z, _d.x) + gauss(rnd) * error;
  const a = angle + gauss(rnd) * error * 0.5;
  return new THREE.Vector3(Math.cos(yaw) * Math.cos(a) * speed, Math.sin(a) * speed, Math.sin(yaw) * Math.cos(a) * speed);
}

// Driven punt whose first bounce is at `target`, solved from the real release
// height. A ground solver sends a chest-high goal kick well short of midfield.
const _punt = new Ball();
_punt.silent = true;
_punt.collideGoal = () => {};
_punt.collideBoards = () => {};
function puntRange(y0, speed, angle) {
  const b = _punt;
  b.place(-20, 0, y0);
  b.vel.set(Math.cos(angle) * speed, Math.sin(angle) * speed, 0);
  b.spin.set(0, 0, 0);
  b.inGoal = 0;
  b.acc = 0;
  b.quat.identity();
  b.onGround = false;
  b.events.length = 0;
  let airborne = false;
  const h = 1 / 240;
  for (let t = 0; t < 4.5; t += h) {
    b.substep(h);
    if (b.pos.y > BALL_RADIUS + 0.35) airborne = true;
    if (airborne && b.pos.y <= BALL_RADIUS + 0.02) return b.pos.x + 20;
  }
  return b.pos.x + 20;
}

export function puntVelocity(from, target, angle = 0.46) {
  _d.subVectors(target, from).setY(0);
  const dist = Math.max(8, _d.length());
  const yaw = Math.atan2(_d.z, _d.x);
  const y0 = Math.max(BALL_RADIUS + 0.02, from.y);
  let lo = 12, hi = 40;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (puntRange(y0, mid, angle) < dist) lo = mid;
    else hi = mid;
  }
  const speed = (lo + hi) / 2;
  return new THREE.Vector3(Math.cos(yaw) * Math.cos(angle) * speed, Math.sin(angle) * speed, Math.sin(yaw) * Math.cos(angle) * speed);
}

// Velocity that sends the ball through `target` (a point on the goal plane)
// at roughly `speed`, found by simulating the real flight and correcting.
export function shotVelocity(from, target, speed, spin) {
  const b = new Ball();
  b.silent = true;
  _d.subVectors(target, from);
  const horiz = Math.hypot(_d.x, _d.z);
  let yaw = Math.atan2(_d.z, _d.x);
  let pitch = Math.atan2(_d.y + 0.02 * horiz, horiz);
  const v = new THREE.Vector3();
  for (let it = 0; it < 7; it++) {
    v.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).multiplyScalar(speed);
    b.pos.copy(from); b.vel.copy(v); b.spin.copy(spin || new THREE.Vector3()); b.inGoal = 0; b.acc = 0;
    let best = null;
    const dirX = Math.cos(yaw), dirZ = Math.sin(yaw);
    for (let t = 0; t < 3; t += 1 / 120) {
      b.substep(1 / 120);
      const along = (b.pos.x - from.x) * dirX + (b.pos.z - from.z) * dirZ;
      if (along >= horiz) { best = b.pos.clone(); break; }
    }
    if (!best) { pitch += 0.05; continue; }
    const errY = target.y - best.y;
    const lat = new THREE.Vector3(-dirZ, 0, dirX);
    const errLat = (target.x - best.x) * lat.x + (target.z - best.z) * lat.z;
    pitch += Math.atan2(errY, horiz) * 0.9;
    yaw += Math.atan2(errLat, horiz) * 0.9;
    if (Math.abs(errY) < 0.03 && Math.abs(errLat) < 0.03) break;
  }
  return v.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).multiplyScalar(speed);
}

// Where to aim a pass to a moving receiver so ball and player meet.
export function leadTarget(from, receiverPos, receiverVel, lead = 1) {
  const t = new THREE.Vector3().copy(receiverPos);
  for (let i = 0; i < 3; i++) {
    const dist = Math.max(1, from.distanceTo(t));
    const v0 = groundPassSpeed(dist, THREE.MathUtils.clamp(3.5 + dist * 0.14, 4, 10));
    const tt = Math.min(2.5, rollTime(v0, dist));
    t.copy(receiverPos).addScaledVector(receiverVel, tt * lead);
  }
  t.y = BALL_RADIUS;
  return t;
}
