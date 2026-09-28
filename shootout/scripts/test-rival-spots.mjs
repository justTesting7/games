import { readFileSync } from 'node:fs';
import { pickRivalSpots } from '../src/world/rivalSpots.js';

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
console.log('rival spot tests passed');
