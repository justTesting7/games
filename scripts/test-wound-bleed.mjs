import { readFileSync } from 'node:fs';

const blood = readFileSync(new URL('../src/game/blood.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const weapons = readFileSync(new URL('../src/game/weapons.js', import.meta.url), 'utf8');

for (const [file, src, needle] of [
  ['blood.js', blood, 'bleed(point, dir, amount = 10)'],
  ['blood.js', blood, 'this.wounds = []'],
  ['blood.js', blood, 'if (i < 0) break'],
  ['blood.js', blood, 'mesh.userData.wound = true'],
  ['main.js', main, 'fx.decals.bleed(info.at || victim.pos'],
  ['weapons.js', weapons, 'at: end'],
]) {
  if (!src.includes(needle)) throw new Error(`${file} missing ${needle}`);
}

function mergeWound(wounds, x, z, amount) {
  for (const w of wounds) {
    if (Math.hypot(w.x - x, w.z - z) < 0.85) {
      w.strength = Math.min(2.4, w.strength + Math.min(0.45, amount / 40));
      return w;
    }
  }
  const w = { x, z, strength: Math.min(1.5, 0.55 + amount / 50) };
  wounds.push(w);
  return w;
}

const sites = [];
const a = mergeWound(sites, 0, 0, 9);
const b = mergeWound(sites, 0.4, 0.2, 9);
const c = mergeWound(sites, 4, 0, 9);
if (a !== b) throw new Error('nearby hits should feed the same wound');
if (sites.length !== 2) throw new Error(`expected 2 sites, got ${sites.length}`);
if (c === a) throw new Error('far hits should start a new wound');
if (a.strength <= 0.55 + 9 / 50) throw new Error('repeat hit should strengthen the wound');

console.log('wound bleed ok');
