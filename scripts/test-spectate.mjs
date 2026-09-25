import { readFileSync } from 'node:fs';

const player = readFileSync(new URL('../src/game/player.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

for (const [file, src, needle] of [
  ['player.js', player, 'update(dt, input, follow = null)'],
  ['player.js', player, 'updateCamera(dt, false, false, 0, follow)'],
  ['player.js', player, 'const body = follow?.pos || this.pos'],
  ['main.js', main, 'const refreshSpectate = ()'],
  ['main.js', main, 'const spec = refreshSpectate()'],
  ['main.js', main, 'player.update(dt, alive && !flying ? input : NO_INPUT, spec)'],
  ['main.js', main, 'Spectating ${spec.persona?.name || spec.fighter.name}'],
]) {
  if (!src.includes(needle)) throw new Error(`${file} missing ${needle}`);
}

function nextSubject(live, from, current) {
  if (current?.alive) return current;
  const rest = live.filter((r) => r.alive);
  if (!rest.length) return null;
  rest.sort((a, b) => {
    const da = (a.x - from.x) ** 2 + (a.z - from.z) ** 2;
    const db = (b.x - from.x) ** 2 + (b.z - from.z) ** 2;
    return da - db;
  });
  return rest[0];
}

const a = { id: 'a', alive: true, x: 10, z: 0 };
const b = { id: 'b', alive: true, x: 3, z: 0 };
const dead = { id: 'd', alive: false, x: 1, z: 0 };
const first = nextSubject([a, b, dead], { x: 0, z: 0 }, null);
if (first !== b) throw new Error(`first spectate should be closest living, got ${first?.id}`);
b.alive = false;
const second = nextSubject([a, b, dead], b, b);
if (second !== a) throw new Error(`next should be the remaining player, got ${second?.id}`);
a.alive = false;
const none = nextSubject([a, b, dead], a, a);
if (none) throw new Error('should stop when nobody is left');

console.log('spectate ok');
