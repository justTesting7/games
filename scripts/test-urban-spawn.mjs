import { urbanRivalSpots, cityCell, CITY } from '../src/world/cityLayout.js';

const origin = { x: 6.2, z: 40 };
const cars = [
  { x: origin.x + 18, z: origin.z + 4 },
  { x: origin.x - 12, z: origin.z + 16 },
];
const spots = urbanRivalSpots(origin.x, origin.z, 5, { taken: cars });
if (spots.length !== 5) throw new Error(`need 5 jev spots, got ${spots.length}`);

const keys = new Set(spots.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`));
if (keys.size !== 5) throw new Error('jev spots must be unique');

for (const s of spots) {
  const d = Math.hypot(s.x - origin.x, s.z - origin.z);
  if (d < 12) throw new Error(`jev too close to the player (${d.toFixed(1)})`);
  const cell = cityCell(s.x, s.z);
  const r = Math.hypot(s.x, s.z);
  const plazaRing = r >= CITY.plazaLawn && r <= CITY.plazaRoad + 2;
  if (!cell.onRoad && !plazaRing) throw new Error(`jev ${s.x},${s.z} is not on a street`);
  if (cars.some((c) => Math.hypot(c.x - s.x, c.z - s.z) < 10)) {
    throw new Error('jev spawned on a parked car');
  }
}
for (let i = 0; i < spots.length; i++) {
  for (let j = i + 1; j < spots.length; j++) {
    const d = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
    if (d < 10) throw new Error(`jevs ${i} and ${j} start ${d.toFixed(1)}m apart`);
  }
}

const main = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'));
if (!main.includes('urbanRivalSpots')) throw new Error('midtown must use street jev spots');
if (main.includes('i ? -5 : 5')) throw new Error('the stacked fallback must not remain');

console.log('urban spawn ok', spots.map((s) => ({
  x: +s.x.toFixed(1), z: +s.z.toFixed(1), d: +Math.hypot(s.x - origin.x, s.z - origin.z).toFixed(1),
})));
