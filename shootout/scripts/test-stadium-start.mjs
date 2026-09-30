import { readFileSync } from 'node:fs';
import { stadiumSlotSpawns, classifyStadium, STAND_ANGLES } from '../src/world/stadium.js';

const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const nav = JSON.parse(readFileSync(new URL('../public/assets/maps/bloomfield/nav.json', import.meta.url), 'utf8'));
const slots = stadiumSlotSpawns(nav.stadium);
if (slots.length !== 16) fail('16 slots expected');

// blocked rectangles, eroded by the player's radius like the real collision
const blocked = (x, z, r = 0.75) => nav.boxes.some(([x0, z0, x1, z1]) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r);
for (const [i, s] of slots.entries()) {
  if (classifyStadium(nav.stadium, s.x, s.z) !== 'hall') fail(`slot ${i} is not in the hall under a stand`);
  if (blocked(s.x, s.z)) fail(`slot ${i} starts inside a wall or obstacle`);
  // looking at the pitch: the heading points at the stadium centre
  const toCentre = Math.atan2(nav.stadium.c[0] - s.x, nav.stadium.c[1] - s.z);
  if (Math.abs(s.yaw - toCentre) > 1e-9) fail(`slot ${i} does not face the pitch`);
}
// two players start on opposite stands; four take all four
const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
if (d(slots[0], slots[1]) < 80) fail(`the first two players are only ${d(slots[0], slots[1]).toFixed(0)} m apart`);
const sides = new Set(slots.slice(0, 4).map((s) => Math.round((Math.atan2(s.x - nav.stadium.c[0], s.z - nav.stadium.c[1]) * 180 / Math.PI + 360) % 360 / 90) % 4));
if (sides.size !== 4) fail('the first four players should take four different stands');
let closest = Infinity;
for (const [i, a] of slots.entries()) for (const b of slots.slice(i + 1)) closest = Math.min(closest, d(a, b));
if (closest < 15) fail(`two of the 16 slots are only ${closest.toFixed(0)} m apart`);
if (STAND_ANGLES.length !== new Set(STAND_ANGLES).size) fail('duplicate stand angles');
console.log('stadium start tests passed: first two', d(slots[0], slots[1]).toFixed(0), 'm apart, closest of 16', closest.toFixed(0), 'm');
