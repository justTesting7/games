// Vehicles are solid to each other: overlapping footprints push apart along the
// shallowest axis, and clear ones don't touch.
import { carPush, CAR, SCOOTER } from '../src/game/cars.js';

const car = (x, z, yaw, spec) => ({ x, z, y: 0, yaw, ...(spec ? { spec } : {}) });
// nose to tail along +z (yaw 0 faces +z): overlap 0.5 m
let h = carPush(car(0, 4, 0), car(0, 0, 0));
if (!h || Math.abs(h.depth - (CAR.halfL * 2 - 4)) > 1e-6 || h.nz < 0.99) throw new Error('rear-end overlap pushes the front car forward');
// side by side, 1.8 m apart: widths are 2.04 m, so 0.24 m overlap pushes sideways
h = carPush(car(1.8, 0, 0), car(0, 0, 0));
if (!h || Math.abs(Math.abs(h.nx) - 1) > 1e-6 || Math.abs(h.depth - 0.24) > 1e-6) throw new Error('side overlap pushes sideways');
// clear gap
if (carPush(car(0, 5, 0), car(0, 0, 0))) throw new Error('cars 5 m apart do not touch');
// crossed at right angles: T-bone into the side
h = carPush(car(0, 2.8, Math.PI / 2), car(0, 0, 0));
if (!h || h.nz < 0.99) throw new Error('a T-bone pushes the hitting car back out along z');
// rotated boxes whose bounding circles overlap but footprints don't
if (carPush(car(2.6, 2.6, Math.PI / 4), car(0, 0, -Math.PI / 4))) throw new Error('parallel diagonal cars side by side apart must not touch');
// scooter against a car
h = carPush(car(1.25, 0, 0, SCOOTER), car(0, 0, 0));
if (!h || h.nx < 0.99) throw new Error('scooter overlapping a car side is pushed out');
// different levels (a car on a deck above) never collide
if (carPush({ ...car(0, 1, 0), y: 3 }, car(0, 0, 0))) throw new Error('cars on different levels do not collide');
console.log('ok car collide');

// City car windows are tested on their own triangles
import { rayTriangles } from '../src/game/cars.js';
import { paneOf } from '../src/world/cityCars.js';
const quad = [-0.5, 0.9, 1, 0.5, 0.9, 1, 0.5, 1.3, 0.6, -0.5, 0.9, 1, 0.5, 1.3, 0.6, -0.5, 1.3, 0.6]; // a raked windscreen
const hitW = rayTriangles({ x: 0, y: 1.1, z: 5 }, { x: 0, y: 0, z: -1 }, quad, 20);
if (!hitW || Math.abs(hitW.t - 4.2) > 0.01 || hitW.nz <= 0) throw new Error('a shot from the front hits the raked windscreen, normal facing it');
if (rayTriangles({ x: 0.9, y: 1.1, z: 5 }, { x: 0, y: 0, z: -1 }, quad, 20)) throw new Error('a shot past the edge of the pane misses it');
if (paneOf(0.9, 0.2, 1, 0, 0, -0.3) !== 'leftF' || paneOf(-0.9, -0.8, -1, 0, 0, -0.3) !== 'rightR') throw new Error('side windows by side and half');
if (paneOf(0, 0.6, 0, 0.3, 0, -0.3) !== 'wind' || paneOf(0, -1.1, 0, -0.3, 0, -0.3) !== 'rear') throw new Error('windscreen at the front, rear window at the back');
console.log('ok car panes');
