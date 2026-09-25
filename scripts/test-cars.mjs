import {
  CAR, cityCarSpots, spotOnRoad, canEnter, nearestEnter, carOverlap, resolveCarBox,
  runOverHits, stepDrive, seatOf, exitOf, localOffset,
} from '../src/game/cars.js';

const spots = cityCarSpots();
if (spots.length !== 8) throw new Error(`city needs 8 cars, got ${spots.length}`);
const keys = new Set(spots.map((s) => `${s.x.toFixed(1)},${s.z.toFixed(1)}`));
if (keys.size !== 8) throw new Error('car spots must be unique');
for (const s of spots) {
  if (!spotOnRoad(s)) throw new Error(`spot ${s.x},${s.z} is not on a road`);
}

let d = { speed: 0, yaw: 0 };
for (let i = 0; i < 40; i++) d = stepDrive({ ...d, throttle: 1, steer: 0, dt: 0.05 });
if (d.speed < 12) throw new Error(`throttle should get the car moving, got ${d.speed}`);
if (d.speed > CAR.maxSpeed + 1e-6) throw new Error('must not outrun max speed');

const boosted = stepDrive({ speed: CAR.maxSpeed, yaw: 0, throttle: 1, steer: 0, dt: 0.2, sprint: true });
if (boosted.speed <= CAR.maxSpeed) throw new Error('sprint should raise the cap');

let braking = { speed: 16, yaw: 0 };
for (let i = 0; i < 8; i++) braking = stepDrive({ ...braking, throttle: -1, steer: 0, dt: 0.05 });
if (braking.speed > 8) throw new Error(`brake should cut speed, got ${braking.speed}`);

const turned = stepDrive({ speed: 10, yaw: 0, throttle: 1, steer: 1, dt: 0.2 });
if (turned.yaw <= 0) throw new Error('right steer should increase yaw');

const parked = { x: 0, z: 0, y: 2, yaw: 0, driver: null, speed: 0, squash: {} };
if (!canEnter(1.2, 0.4, parked)) throw new Error('a player beside an empty car can enter');
if (canEnter(8, 0, parked)) throw new Error('too far to enter');
if (canEnter(0, 0, { ...parked, driver: { id: 'p' } })) throw new Error('occupied cars are locked');
if (nearestEnter(0.4, 0.2, [parked, { ...parked, x: 20, z: 0, driver: null }]) !== parked) {
  throw new Error('nearest empty car should win');
}

const moving = { x: 0, z: 0, y: 2, yaw: 0, speed: 12, driver: { id: 'driver' }, squash: {} };
if (!carOverlap(0.2, 0.4, 2, moving)) throw new Error('a body in the chassis should overlap');
if (carOverlap(0, 8, 2, moving)) throw new Error('far ahead of the bumper is not a hit');
if (carOverlap(0, 0, 8, moving)) throw new Error('a rooftop should not count as a run-over');

const driver = { id: 'driver', alive: true, pos: { x: 0, z: 0, y: 2 } };
const vic = { id: 'vic', alive: true, pos: { x: 0.1, z: 0.2, y: 2 } };
const dead = { id: 'dead', alive: false, pos: { x: 0.1, z: 0.2, y: 2 } };
const far = { id: 'far', alive: true, pos: { x: 20, z: 20, y: 2 } };
let hits = runOverHits({ ...moving, driver }, [driver, vic, dead, far], 1);
if (hits.length !== 1 || hits[0] !== vic) throw new Error('only the living pedestrian in the box dies');

hits = runOverHits({ ...moving, speed: 2, driver }, [vic], 1);
if (hits.length) throw new Error('a crawl should not be a kill');

hits = runOverHits({ ...moving, driver, squash: { vic: 2 } }, [vic], 1);
if (hits.length) throw new Error('a recent squash should not double-kill');

const pushed = { x: 0.2, z: 0.1 };
if (!resolveCarBox(pushed, 0.3, parked)) throw new Error('a walker inside the car must be pushed out');
if (carOverlap(pushed.x, pushed.z, 2, parked, 0)) throw new Error('resolve should clear the cabin');

const seat = seatOf({ x: 10, y: 2, z: 4, yaw: 0 });
if (Math.abs(seat.x - (10 + CAR.seatX)) > 1e-6) throw new Error('driver seat sits on the left');
const door = exitOf({ x: 10, y: 2, z: 4, yaw: 0 }, 1);
if (Math.abs(door.x - 10) < 0.5) throw new Error('exit should step out the side');

const o = localOffset(0, 2.15, { x: 0, z: 0, yaw: 0 });
if (Math.abs(o.along - 2.15) > 1e-6) throw new Error('along should follow +Z at yaw 0');

const room = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/server/room.js', import.meta.url), 'utf8'));
if (!room.includes('car: { body: 200')) throw new Error('room must treat a run-over as lethal');
if (!room.includes("t === 'runover'")) throw new Error('room must accept run-over reports');
if (!room.includes("t === 'car'")) throw new Error('room must sync enter/leave/drive');

console.log('cars ok', { spots: spots.length, speed: +d.speed.toFixed(1), yaw: +turned.yaw.toFixed(3) });
