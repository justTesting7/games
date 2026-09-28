import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CAR, SCOOTER, stepDrive, seatOf, exitOf, nearestEnter, resolveCarBox, carOverlap, Cars } from '../src/game/cars.js';

const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// a scooter is slower than a car and tops out at its own speed
let st = { speed: 0, yaw: 0 };
for (let i = 0; i < 600; i++) st = stepDrive({ speed: st.speed, yaw: st.yaw, throttle: 1, steer: 0, dt: 1 / 60, spec: SCOOTER });
if (!near(st.speed, SCOOTER.maxSpeed)) fail(`scooter should top out at ${SCOOTER.maxSpeed}, got ${st.speed}`);
let sprint = { speed: 0, yaw: 0 };
for (let i = 0; i < 600; i++) sprint = stepDrive({ speed: sprint.speed, yaw: sprint.yaw, throttle: 1, steer: 0, dt: 1 / 60, sprint: true, spec: SCOOTER });
if (!near(sprint.speed, SCOOTER.boostSpeed)) fail('scooter sprint speed');
let car = { speed: 0, yaw: 0 };
for (let i = 0; i < 600; i++) car = stepDrive({ speed: car.speed, yaw: car.yaw, throttle: 1, steer: 0, dt: 1 / 60 });
if (!near(car.speed, CAR.maxSpeed)) fail('cars must still use the car spec by default');

// footprint, seat and mounting range come from the scooter's spec
const sc = { kind: 'scooter', spec: SCOOTER, x: 10, y: 0, z: 5, yaw: Math.PI / 2, speed: 0, driver: null };
const seat = seatOf(sc);
if (Math.abs(seat.x - (10 + SCOOTER.seatZ)) > 1e-9 || !near(seat.y, SCOOTER.seatY)) fail(`scooter seat ${JSON.stringify(seat)}`);
if (nearestEnter(10 + SCOOTER.enterR - 0.1, 5, [sc]) !== sc) fail('should be able to mount from just inside enter range');
if (nearestEnter(10 + SCOOTER.enterR + 0.1, 5, [sc])) fail('should not mount from outside enter range');
if (carOverlap(10 + 1.2, 5, 0, sc)) fail('scooter footprint is far smaller than a car');
const p = { x: 10 + 0.5, z: 5 };
if (!resolveCarBox(p, 0.3, sc)) fail('a walker overlapping the scooter should be pushed out');
const ex = exitOf(sc);
if (Math.hypot(ex.x - 10, ex.z - 5) < SCOOTER.halfW + 0.5) fail('the rider should step off beside the scooter');

// the baked map has scooters, and every original piece to replace is a proper box
const nav = JSON.parse(readFileSync(new URL('../public/assets/maps/dizengoff-square/nav.json', import.meta.url), 'utf8'));
if (!(nav.scooters?.length >= 5)) fail(`expected several scooters baked into the Square, got ${nav.scooters?.length}`);
for (const s of nav.scooters) if (![s.x, s.y, s.z, s.yaw].every(Number.isFinite)) fail('scooter spot is not finite');
for (const b of nav.scooterRemove) if (b.length !== 6 || b.some((v) => !Number.isFinite(v)) || b[0] >= b[3] || b[1] >= b[4] || b[2] >= b[5]) fail('bad scooter part box');

// they can be added to a world's fleet after the cars and get their own ids
const world = { terrain: { heightAt: () => 0 } };
const cars = new Cars(world, new THREE.Scene());
cars.spawnCustom([{ x: 0, z: 0, yaw: 0, mesh: new THREE.Group() }, { x: 4, z: 0, yaw: 0, mesh: new THREE.Group() }]);
cars.addScooters(nav.scooters.slice(0, 3));
if (cars.list.length !== 5) fail('fleet size');
if (cars.list.map((c) => c.id).join() !== '0,1,2,3,4') fail('ids must be unique and sequential');
if (cars.list.filter((c) => c.kind === 'scooter').length !== 3) fail('scooter kind');
console.log('scooter tests passed:', nav.scooters.length, 'scooters baked in the Square');
