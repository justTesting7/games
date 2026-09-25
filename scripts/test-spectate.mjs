import { readFileSync } from 'node:fs';
import { spectateLook } from '../src/game/player.js';

const player = readFileSync(new URL('../src/game/player.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

for (const [file, src, needle] of [
  ['player.js', player, 'update(dt, input, follow = null)'],
  ['player.js', player, 'this.updateCamera(dt, look.aiming, spd > 4.5 && !look.aiming, spd, follow)'],
  ['player.js', player, 'const ride = follow?.vehicle || (!follow && this.vehicle)'],
  ['player.js', player, 'const body = ride ? new THREE.Vector3(ride.x, ride.y, ride.z) : (follow?.pos || this.pos)'],
  ['main.js', main, 'const refreshSpectate = ()'],
  ['main.js', main, 'const spec = refreshSpectate()'],
  ['main.js', main, 'player.update(dt, alive && !flying ? input : NO_INPUT, spec)'],
  ['main.js', main, 'Spectating ${spec.persona?.name || spec.fighter.name}'],
  ['main.js', main, 'else if (player.fighter.alive) player.look'],
  ['player.js', player, 'const look = spectateLook(follow)'],
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

const jev = {
  pos: { x: 0, y: 2, z: 0 },
  lookPoint: { x: 10, y: 4, z: 10 },
  aiming: true,
};
const view = spectateLook(jev);
if (Math.abs(view.yaw - Math.atan2(10, 10)) > 1e-6) throw new Error(`jev yaw ${view.yaw}`);
if (view.pitch <= 0) throw new Error('jev should look up at the aim point');
if (!view.aiming) throw new Error('jev aiming should pass through');

const locked = spectateLook({ lookYaw: 0.8, lookPitch: -0.25, aiming: true });
if (locked.yaw !== 0.8 || locked.pitch !== -0.25) throw new Error('lookYaw should win over body yaw');

const remote = { yaw: 1.2, pitch: -0.35, aiming: false };
const net = spectateLook(remote);
if (net.yaw !== 1.2 || net.pitch !== -0.35) throw new Error('remote look should use pose pitch');

console.log('spectate ok');
