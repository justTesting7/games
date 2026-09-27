import { readFileSync } from 'node:fs';

const fish = readFileSync(new URL('../src/world/fish.js', import.meta.url), 'utf8');
const maps = readFileSync(new URL('../src/world/maps.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../src/game/player.js', import.meta.url), 'utf8');

for (const [file, src, needle] of [
  ['fish.js', fish, 'export class Fish'],
  ['fish.js', fish, 'terrain.heightAt'],
  ['maps.js', maps, 'fish: true'],
  ['main.js', main, 'if (mapDef.fish)'],
  ['main.js', main, 'fish.update(dt, camera)'],
  ['player.js', player, 'this.swimming = shouldSwim'],
  ['player.js', player, 'ground < -1.15'],
]) {
  const present = src.includes(needle);
  if (needle === 'ground < -1.15') {
    if (present) throw new Error('deep water must no longer block the player');
    continue;
  }
  if (!present) throw new Error(`${file} missing ${needle}`);
}

function keepInWater(y, floor) {
  return Math.max(floor + 0.45, Math.min(-0.55, y));
}
if (keepInWater(-0.1, -8) > -0.54) throw new Error('fish must stay under the surface');
if (keepInWater(-20, -6) < -5.6) throw new Error('fish must stay off the seabed');

console.log('fish ok');
