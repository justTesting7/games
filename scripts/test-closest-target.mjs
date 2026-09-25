import { readFileSync } from 'node:fs';

const rival = readFileSync(new URL('../src/game/rival.js', import.meta.url), 'utf8');

for (const needle of [
  'closestEnemy(',
  'this.setTarget(this.closestEnemy(alive));',
  'this.setTarget(this.closestEnemy(this.enemies()));',
  'const seen = list.filter((e) => this.seen(e).visible);',
]) {
  if (!rival.includes(needle)) throw new Error(`rival.js missing ${needle}`);
}
if (rival.includes('Prefer enemies you can see, that threaten you, or that are weak')) {
  throw new Error('Jev still chooses the target');
}

function closestEnemy(self, alive) {
  const list = alive.filter((e) => e.alive);
  if (!list.length) return null;
  const seen = list.filter((e) => self.seen[e.id]);
  const pool = seen.length ? seen : list;
  let best = pool[0], bestD = Math.hypot(best.x - self.x, best.z - self.z);
  for (let i = 1; i < pool.length; i++) {
    const d = Math.hypot(pool[i].x - self.x, pool[i].z - self.z);
    if (d < bestD) { best = pool[i]; bestD = d; }
  }
  return best;
}

const self = { x: 0, z: 0, seen: { near: true, far: true, hid: false } };
const near = { id: 'near', alive: true, x: 4, z: 0 };
const far = { id: 'far', alive: true, x: 20, z: 0 };
const hid = { id: 'hid', alive: true, x: 2, z: 0 };
const dead = { id: 'dead', alive: false, x: 1, z: 0 };

const a = closestEnemy(self, [far, near, hid, dead]);
if (a !== near) throw new Error(`visible closest should win, got ${a?.id}`);

const b = closestEnemy({ x: 0, z: 0, seen: {} }, [far, hid]);
if (b !== hid) throw new Error(`hidden closest should win when nobody is in sight, got ${b?.id}`);

console.log('closest target ok');
