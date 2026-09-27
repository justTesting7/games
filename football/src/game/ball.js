import * as THREE from 'three';
import { PITCH, GOAL, BALL_RADIUS, SURROUND } from '../world/dims.js';

const R = BALL_RADIUS;
const G = 9.81;
// Quadratic air drag and Magnus lift for a size-5 ball (430 g, 22 cm).
const DRAG = 0.0105;
const MAGNUS = 0.0055;
const ROLL = 1.05;
const RESTITUTION = 0.58;
const SUB = 1 / 240;
const UP = new THREE.Vector3(0, 1, 0);
const POST_R = GOAL.post;
const GOAL_X = PITCH.halfLength - PITCH.line * 0.5;
const POST_Z = GOAL.halfWidth + POST_R;
const BAR_Y = GOAL.height + POST_R;

// Net height at `d` metres behind the goal line (roof, then back slope).
export function netHeight(d) {
  if (d < 0.95) return GOAL.height;
  return Math.max(0, GOAL.height * (1 - (d - 0.95) / (GOAL.depth - 0.95)));
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Ball {
  constructor() {
    this.pos = new THREE.Vector3(0, R, 0);
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.inGoal = 0;
    this.onGround = true;
    this.events = [];
    this.acc = 0;
  }

  emit(e) {
    if (!this.silent) this.events.push(e);
  }

  place(x, z, y = R) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.inGoal = 0;
    this.onGround = y <= R + 1e-3;
  }

  kick(vel, spin) {
    this.vel.copy(vel);
    this.spin.copy(spin || _a.set(0, 0, 0));
    this.onGround = false;
  }

  get speed() { return this.vel.length(); }

  step(dt) {
    this.events.length = 0;
    this.acc += dt;
    while (this.acc >= SUB) {
      this.acc -= SUB;
      this.substep(SUB);
    }
    return this.events;
  }

  substep(h) {
    const v = this.vel, p = this.pos, w = this.spin;
    const sp = v.length();
    const grounded = p.y <= R + 0.004 && Math.abs(v.y) < 0.6;
    if (grounded) {
      p.y = R;
      v.y = 0;
      const hs = Math.hypot(v.x, v.z);
      if (hs > 1e-4) {
        // Rolling: grass resistance plus air drag; spin locks to roll.
        const dec = (ROLL + DRAG * hs * hs) * h;
        const k = Math.max(0, hs - dec) / hs;
        v.x *= k; v.z *= k;
        // Sidespin from a curled shot keeps bending it a little on the deck.
        _a.crossVectors(w, v).multiplyScalar(MAGNUS * 0.15 * h);
        v.x += _a.x; v.z += _a.z;
      }
      w.crossVectors(UP, v).divideScalar(R);
      this.onGround = true;
    } else {
      this.onGround = false;
      v.y -= G * h;
      if (sp > 1e-3) {
        v.addScaledVector(v, -DRAG * sp * h);
        _a.crossVectors(w, v).multiplyScalar(MAGNUS * h);
        v.add(_a);
      }
      w.multiplyScalar(Math.exp(-0.35 * h));
    }
    const prevX = p.x;
    p.addScaledVector(v, h);

    if (p.y < R) {
      p.y = R;
      if (v.y < -0.6) {
        const impact = -v.y;
        v.y = impact * RESTITUTION * (impact > 8 ? 0.92 : 1);
        // Grass grabs the ball on each bounce; backspin checks it up.
        const slip = _b.set(v.x, 0, v.z).add(_c.crossVectors(w, _a.set(0, -R, 0)));
        v.x -= slip.x * 0.28; v.z -= slip.z * 0.28;
        w.crossVectors(UP, v).divideScalar(R).multiplyScalar(0.6).add(w.multiplyScalar(0.4));
        if (impact > 1.2) this.emit({ type: 'bounce', speed: impact });
      } else v.y = 0;
    }

    this.collideGoal(prevX);
    this.collideBoards();

    if (this.silent) return;
    const ang = w.length() * h;
    if (ang > 1e-6) {
      _q.setFromAxisAngle(_a.copy(w).normalize(), ang);
      this.quat.premultiply(_q).normalize();
    }
  }

  collideGoal(prevX) {
    const p = this.pos, v = this.vel;
    for (const s of [-1, 1]) {
      const d = s * p.x - GOAL_X;
      if (d < -1 || d > GOAL.depth + 1) continue;
      // Posts and crossbar.
      for (const pz of [-POST_Z, POST_Z]) {
        if (p.y < BAR_Y + R) this.bounceOff(_a.set(s * GOAL_X, Math.min(p.y, BAR_Y), pz), POST_R, 'post');
      }
      if (Math.abs(p.z) < POST_Z) this.bounceOff(_a.set(s * GOAL_X, BAR_Y, p.z), POST_R, 'bar');

      const prevD = s * prevX - GOAL_X;
      if (!this.inGoal && prevD <= R && d > R && Math.abs(p.z) < GOAL.halfWidth - R * 0.2 && p.y < GOAL.height) {
        this.inGoal = s;
      }
      if (this.inGoal === s) {
        // Inside the net: soak up the ball's energy against each panel.
        const hw = GOAL.halfWidth + POST_R - R;
        let hit = 0;
        if (Math.abs(p.z) > hw) { p.z = Math.sign(p.z) * hw; hit = Math.max(hit, Math.abs(v.z)); v.z *= -0.15; v.x *= 0.6; }
        const top = netHeight(Math.max(0, d)) - R;
        if (d > 0.95 && p.y > top) {
          // Back panel slopes; push the ball back along its normal.
          const nx = GOAL.height / (GOAL.depth - 0.95), ny = 1;
          const nl = Math.hypot(nx, ny);
          const vn = (v.x * s * nx + v.y * ny) / nl;
          if (vn > 0) {
            hit = Math.max(hit, vn);
            v.x -= s * nx / nl * vn * 1.2;
            v.y -= ny / nl * vn * 1.2;
            v.multiplyScalar(0.35);
          }
          p.y = Math.min(p.y, Math.max(R, top));
          if (d > GOAL.depth - R) p.x = s * (GOAL_X + GOAL.depth - R);
        } else if (p.y > GOAL.height - R && d <= 0.95) {
          p.y = GOAL.height - R;
          if (v.y > 0) { hit = Math.max(hit, v.y); v.y *= -0.1; v.x *= 0.5; }
        }
        if (d > GOAL.depth - R) {
          p.x = s * (GOAL_X + GOAL.depth - R);
          if (s * v.x > 0) { hit = Math.max(hit, s * v.x); v.x *= -0.12; v.z *= 0.5; }
        }
        if (hit > 1.5) this.emit({ type: 'net', side: s, speed: hit, point: p.clone() });
      } else if (d > R && d < GOAL.depth + R && Math.abs(p.z) < GOAL.halfWidth + 0.4 && p.y < netHeight(d) + R) {
        // Outside netting: hitting it from the side or on top.
        const hw = GOAL.halfWidth + POST_R;
        if (Math.abs(p.z) > hw - 0.2) {
          p.z = Math.sign(p.z) * (hw + R);
          v.z = Math.abs(v.z) * Math.sign(p.z) * 0.15;
          v.x *= 0.5;
          this.emit({ type: 'sidenet', side: s, speed: v.length(), point: p.clone() });
        } else if (p.y > netHeight(d) - 0.3) {
          p.y = netHeight(d) + R;
          if (v.y < 0) v.y *= -0.2;
          v.multiplyScalar(0.7);
        }
      }
    }
  }

  bounceOff(c, radius, type) {
    const p = this.pos, v = this.vel;
    _b.subVectors(p, c);
    if (type === 'bar') _b.z = 0;
    else _b.y = 0;
    const dist = _b.length();
    const min = radius + R;
    if (dist >= min || dist < 1e-6) return;
    _b.divideScalar(dist);
    p.addScaledVector(_b, min - dist);
    const vn = v.dot(_b);
    if (vn < 0) {
      v.addScaledVector(_b, -vn * 1.68);
      this.spin.multiplyScalar(0.5);
      if (-vn > 1) this.emit({ type, speed: -vn });
    }
  }

  // Advertising boards stop balls that are already out of play.
  collideBoards() {
    const p = this.pos, v = this.vel;
    if (p.y > 1.0) return;
    const bx = PITCH.halfLength + SURROUND.boardEnd - R - 0.15;
    const bz = PITCH.halfWidth + SURROUND.boardSide - R - 0.15;
    if (Math.abs(p.x) > bx && Math.abs(p.x) < bx + 0.5 && !this.inGoal) {
      p.x = Math.sign(p.x) * bx;
      if (Math.sign(v.x) === Math.sign(p.x)) { v.x *= -0.35; this.emit({ type: 'board', speed: Math.abs(v.x) * 3 }); }
    }
    if (Math.abs(p.z) > bz && Math.abs(p.z) < bz + 0.5) {
      p.z = Math.sign(p.z) * bz;
      if (Math.sign(v.z) === Math.sign(p.z)) { v.z *= -0.35; this.emit({ type: 'board', speed: Math.abs(v.z) * 3 }); }
    }
  }

  // Where the ball will be after `t` seconds, by running the real physics on
  // a copy. Used for interceptions, first touches and the keeper's dive.
  predict(t, out = new THREE.Vector3()) {
    const b = Ball.sim();
    b.pos.copy(this.pos); b.vel.copy(this.vel); b.spin.copy(this.spin);
    b.inGoal = this.inGoal; b.acc = 0;
    const h = 1 / 60;
    for (let s = 0; s < t; s += h) b.substepCoarse(h);
    return out.copy(b.pos);
  }

  // Samples the predicted path at fixed intervals: [{ t, pos }].
  path(duration, interval = 0.1) {
    const b = Ball.sim();
    b.pos.copy(this.pos); b.vel.copy(this.vel); b.spin.copy(this.spin);
    b.inGoal = this.inGoal; b.acc = 0;
    const out = [];
    const h = 1 / 60;
    let next = 0;
    for (let s = 0; s <= duration + 1e-6; s += h) {
      if (s >= next - 1e-6) { out.push({ t: s, pos: b.pos.clone(), vel: b.vel.clone() }); next += interval; }
      b.substepCoarse(h);
    }
    return out;
  }

  static sim() {
    if (!Ball.scratch) { Ball.scratch = new Ball(); Ball.scratch.silent = true; }
    return Ball.scratch;
  }

  substepCoarse(h) {
    const n = 4;
    for (let i = 0; i < n; i++) this.substep(h / n);
  }
}

// Launch velocity for a ground pass that arrives at `target` with roughly
// `arrive` m/s, found by bisection on the rolling model.
export function groundPassSpeed(dist, arrive = 6) {
  let lo = 1, hi = 40;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const v = rollSpeedAfter(mid, dist);
    if (v < arrive) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Speed left after rolling `dist` metres from `v0`, or 0 if it stops short.
export function rollSpeedAfter(v0, dist) {
  let v = v0, d = 0;
  const h = 1 / 120;
  while (d < dist) {
    if (v <= 0.05) return 0;
    d += v * h;
    v -= (ROLL + DRAG * v * v) * h;
  }
  return v;
}

// Time to roll `dist` from `v0`, or Infinity.
export function rollTime(v0, dist) {
  let v = v0, d = 0, t = 0;
  const h = 1 / 120;
  while (d < dist) {
    if (v <= 0.05) return Infinity;
    d += v * h;
    v -= (ROLL + DRAG * v * v) * h;
    t += h;
  }
  return t;
}

// Launch velocity for a lofted ball landing at horizontal distance `dist`
// with elevation `angle` (radians). Accounts for drag by bisection.
export function loftSpeed(dist, angle) {
  let lo = 3, hi = 45;
  const b = new Ball();
  b.silent = true;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    b.place(-50, 0);
    b.vel.set(Math.cos(angle) * mid, Math.sin(angle) * mid, 0);
    b.pos.y = R + 0.01;
    let t = 0;
    while (t < 6) {
      b.substep(1 / 120);
      t += 1 / 120;
      if (b.vel.y < 0 && b.pos.y <= R + 0.02) break;
    }
    if (b.pos.x + 50 < dist) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
