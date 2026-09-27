// Ball physics: rolling distances, pass-speed solver, lofted range, posts and net.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Ball, groundPassSpeed, rollSpeedAfter, loftSpeed } from '../src/game/ball.js';
import { PITCH, GOAL, BALL_RADIUS } from '../src/world/dims.js';

const run = (b, secs) => { for (let t = 0; t < secs; t += 1 / 60) b.step(1 / 60); };

{
  const b = new Ball();
  b.place(-40, 0);
  b.kick(new THREE.Vector3(12, 0, 0));
  run(b, 20);
  const d = b.pos.x + 40;
  assert.ok(d > 25 && d < 55, `12 m/s pass rolls a realistic distance (${d.toFixed(1)} m)`);
  assert.ok(b.speed < 0.05, 'ball comes to rest');
}

{
  const v = groundPassSpeed(20, 6);
  const left = rollSpeedAfter(v, 20);
  assert.ok(Math.abs(left - 6) < 0.2, `pass solver arrives at 6 m/s (${left.toFixed(2)})`);
  assert.ok(v > 7 && v < 16, `20 m pass needs a sensible speed (${v.toFixed(1)})`);
}

{
  const angle = 0.5;
  const v = loftSpeed(35, angle);
  const b = new Ball();
  b.place(-50, 0);
  b.pos.y = BALL_RADIUS + 0.01;
  b.kick(new THREE.Vector3(Math.cos(angle) * v, Math.sin(angle) * v, 0));
  let landed = null;
  for (let t = 0; t < 6; t += 1 / 120) {
    b.step(1 / 120);
    if (b.vel.y < 0 && b.pos.y <= BALL_RADIUS + 0.03) { landed = b.pos.x + 50; break; }
  }
  assert.ok(landed && Math.abs(landed - 35) < 1.5, `lofted ball lands near target (${landed?.toFixed(1)})`);
}

{
  // Curl: sidespin bends a shot.
  const b = new Ball();
  b.place(-30, 0);
  b.pos.y = 0.3;
  b.kick(new THREE.Vector3(25, 3, 0), new THREE.Vector3(0, 40, 0));
  run(b, 1);
  assert.ok(Math.abs(b.pos.z) > 1, `sidespin curls the ball (${b.pos.z.toFixed(2)} m)`);
}

{
  // Shot into the net: ball enters, is flagged as a goal and stops inside.
  const b = new Ball();
  b.place(PITCH.halfLength - 12, 1);
  b.kick(new THREE.Vector3(28, 2.2, 0));
  let net = false;
  for (let t = 0; t < 3; t += 1 / 60) {
    const ev = b.step(1 / 60);
    if (ev.some((e) => e.type === 'net')) net = true;
  }
  assert.equal(b.inGoal, 1, 'ball registered in the +X goal');
  assert.ok(net, 'net impact reported');
  const depth = b.pos.x - PITCH.halfLength;
  assert.ok(depth > 0 && depth < GOAL.depth + 0.2, `ball held by the net (${depth.toFixed(2)})`);
}

{
  // Post: a ball straight at the post bounces back.
  const b = new Ball();
  b.place(PITCH.halfLength - 5, GOAL.halfWidth + GOAL.post);
  b.pos.y = 1;
  b.kick(new THREE.Vector3(20, 0.5, 0));
  let post = false;
  for (let t = 0; t < 1; t += 1 / 60) if (b.step(1 / 60).some((e) => e.type === 'post')) post = true;
  assert.ok(post, 'post hit reported');
  assert.equal(b.inGoal, 0, 'no goal off the post');
  assert.ok(b.vel.x < 0, 'ball rebounds off the post');
}

{
  // Prediction matches simulation.
  const b = new Ball();
  b.place(0, 0);
  b.kick(new THREE.Vector3(10, 4, 3));
  const p = b.predict(1.0);
  run(b, 1.0);
  assert.ok(p.distanceTo(b.pos) < 0.2, `predict() tracks the real path (${p.distanceTo(b.pos).toFixed(3)})`);
}

console.log('ball ok');
