import {
  CAR, cityCarSpots, manhattanCarSpots, carSpotsForMap, spotOnRoad, canEnter, nearestEnter, carOverlap, resolveCarBox,
  runOverHits, stepDrive, seatOf, exitOf, localOffset, cockpitEye, hitCar,
  paneBit, glassIntact, glassMaskAfterHit,
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
if (!room.includes("act === 'glass'")) throw new Error('room must sync broken glass');
if (!room.includes("'manhattan'")) throw new Error('room must accept the midtown map');
if (!room.includes('const FLEET = 64')) throw new Error('room fleet must cover the packed midtown cars');

const maps = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/world/maps.js', import.meta.url), 'utf8'));
if (!maps.includes("id: 'manhattan'")) throw new Error('maps must expose Midtown');

const midtown = manhattanCarSpots();
if (midtown.length < 40) throw new Error(`midtown should pack the avenues, got ${midtown.length}`);
const midKeys = new Set(midtown.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`));
if (midKeys.size !== midtown.length) throw new Error('midtown spots must be unique');
for (const s of midtown) {
  if (!spotOnRoad(s)) throw new Error(`midtown spot ${s.x},${s.z} is not on a road`);
  if (Math.hypot(s.x, s.z) < 28) throw new Error('keep the plaza clear of parked cars');
}
if (carSpotsForMap('manhattan').length !== midtown.length) throw new Error('manhattan map must use the packed fleet');
if (carSpotsForMap('city').length !== 8) throw new Error('dead district still has eight cars');
if (carSpotsForMap('island').length) throw new Error('island should not spawn street cars');

const car = { x: 0, y: 0, z: 0, yaw: 0, glass: 0 };
const throughWind = hitCar({ x: 0, y: 0.88, z: 2.4 }, { x: 0, y: 0, z: -1 }, car, 8);
if (!throughWind?.glass || throughWind.pane !== 'wind') {
  throw new Error(`windshield should catch a shot into the cabin, got ${throughWind?.surface} ${throughWind?.pane}`);
}
const hood = hitCar({ x: 0, y: 0.60, z: 3 }, { x: 0, y: 0, z: -1 }, car, 8);
if (!hood || hood.surface !== 'metal') throw new Error('the hood must stop a low shot');
const open = hitCar({ x: 0, y: 0.88, z: 2.4 }, { x: 0, y: 0, z: -1 }, { ...car, glass: paneBit('wind') }, 2.2, { metalOnly: true });
if (open) throw new Error('broken windshield should leave a hole into the cabin');
if (glassIntact(glassMaskAfterHit(0, 'wind'), 'wind')) throw new Error('a hit pane must stay broken');

const eye = cockpitEye({ x: 10, y: 2, z: 4, yaw: 0 });
if (eye.y < 2.7 || eye.y > 3.0) throw new Error(`cockpit eye should sit in the low cabin, got ${eye.y}`);
if (eye.z >= 4 + 0.40) throw new Error('driver view must start behind the windshield');

const weapons = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/game/weapons.js', import.meta.url), 'utf8'));
if (!weapons.includes('breakAlong')) throw new Error('shots into a car must break glass along the ray');
const playerSrc = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/game/player.js', import.meta.url), 'utf8'));
if (!playerSrc.includes('updateCockpitCamera')) throw new Error('driving must use an in-car camera');

console.log('cars ok', { spots: spots.length, speed: +d.speed.toFixed(1), yaw: +turned.yaw.toFixed(3) });
