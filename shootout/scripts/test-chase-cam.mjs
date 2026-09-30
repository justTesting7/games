// Driving uses a chase camera (city cars have no interior to sit in); V goes to the
// cockpit only in cars that have one. The body squats, dives and rolls out of turns.
import { readFileSync } from 'node:fs';

const player = readFileSync(new URL('../src/game/player.js', import.meta.url), 'utf8');
const cars = readFileSync(new URL('../src/game/cars.js', import.meta.url), 'utf8');
for (const needle of [
  'if (!(this.cockpitView && ride.panes)) { this.updateChaseCamera(dt, ride, follow); return; }',
  'updateChaseCamera(dt, car, follow) {',
  'if (input.toggleWalk) this.cockpitView = !this.cockpitView;',
  'this.world.shots?.raycast(target, probe, dist + 0.5)',
]) if (!player.includes(needle)) throw new Error(`player.js missing ${needle}`);
if (!cars.includes('this.bodyMotion(car, dt);')) throw new Error('cars must run the body springs');
console.log('ok chase cam');
