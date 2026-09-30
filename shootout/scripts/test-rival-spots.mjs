import { readFileSync } from 'node:fs';
import { pickRivalSpots, slotSpawns } from '../src/world/rivalSpots.js';

const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

for (const map of ['dizengoff-center', 'dizengoff-square', 'bloomfield']) {
  const nav = JSON.parse(readFileSync(new URL(`../public/assets/maps/${map}/nav.json`, import.meta.url), 'utf8'));
  if (!nav.spots?.length) fail(`${map}: no baked spawn candidates`);
  const origin = nav.spawn;
  for (const count of [2, 3, 5]) {
    for (let round = 0; round < 20; round++) {
      const spots = pickRivalSpots(nav.spots, origin, count, rand);
      if (!spots || spots.length !== count) fail(`${map}: could not place ${count} rivals`);
      for (const [i, a] of spots.entries()) {
        const d = Math.hypot(a.x - origin.x, a.z - origin.z);
        if (d > 220) fail(`${map}: rival ${i} starts ${d.toFixed(0)} m away`);
        if (d < 30) fail(`${map}: rival ${i} starts only ${d.toFixed(0)} m from the player`);
        for (const b of spots.slice(i + 1)) {
          const e = Math.hypot(a.x - b.x, a.z - b.z);
          if (e < 25) fail(`${map}: two rivals start ${e.toFixed(0)} m apart`);
        }
        const face = Math.atan2(origin.x - a.x, origin.z - a.z);
        if (Math.abs(a.yaw - face) > 1e-9) fail(`${map}: rival does not face the player`);
      }
    }
  }
  const spots = pickRivalSpots(nav.spots, origin, 3, rand);
  console.log(map, 'rivals start', spots.map((s) => Math.hypot(s.x - origin.x, s.z - origin.z).toFixed(0)).join(', '), 'm from the player');
}
// multiplayer slots: deterministic, spread over the map, every spot inside the open area
for (const map of ['dizengoff-center', 'dizengoff-square', 'bloomfield']) {
  const nav = JSON.parse(readFileSync(new URL(`../public/assets/maps/${map}/nav.json`, import.meta.url), 'utf8'));
  const a = slotSpawns(nav.spots, 16), b = slotSpawns(nav.spots.slice().reverse(), 16);
  if (a.length !== 16) fail(`${map}: expected 16 slot spawns, got ${a.length}`);
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${map}: slot spawns must not depend on the order of the spots`);
  const pairs = [];
  for (const [i, p] of a.entries()) for (const q of a.slice(i + 1)) pairs.push(Math.hypot(p.x - q.x, p.z - q.z));
  const closest = Math.min(...pairs);
  if (closest < 10) fail(`${map}: two slots start only ${closest.toFixed(0)} m apart`);
  const two = Math.hypot(a[0].x - a[1].x, a[0].z - a[1].z);
  if (two < 100 || two > 130) fail(`${map}: the first two players start ${two.toFixed(0)} m apart, wanted about 110`);
  for (const p of a) if (!nav.spots.some(([x, z]) => x === p.x && z === p.z)) fail(`${map}: slot spawn is not a baked open spot`);
  console.log(map, 'slot spawns: first two', two.toFixed(0), 'm apart, closest pair', closest.toFixed(0), 'm');
}
console.log('rival spot tests passed');
