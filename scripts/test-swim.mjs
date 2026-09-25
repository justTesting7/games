import { canExitWater, clampSwimY, shouldSwim, stepSwim, swimSpeed, FLOAT_Y, WATER_Y } from '../src/game/swim.js';

if (shouldSwim(0.4, 2)) throw new Error('land should not swim');
if (shouldSwim(0.1, -0.15)) throw new Error('shallow wade should not swim');
if (!shouldSwim(0.1, -2)) throw new Error('deep water at the surface should swim');
if (!shouldSwim(-3, -12, true)) throw new Error('already swimming in the deep should stay swimming');
if (shouldSwim(-0.1, -0.2, true)) throw new Error('reaching the beach shelf should stop swimming');

if (!canExitWater(-0.2, -0.4, true)) throw new Error('jump on a shelf should climb out');
if (canExitWater(-8, -3, true)) throw new Error('jump in the deep should not teleport to land');

const floor = -18;
const sunk = clampSwimY(-40, floor);
if (sunk < floor + 0.38 - 1e-9) throw new Error(`seafloor clamp failed: ${sunk}`);
if (clampSwimY(4, floor) > WATER_Y - 0.08 + 1e-9) throw new Error('must stay under the water plane');

let y = -6, vy = 0;
for (let i = 0; i < 80; i++) {
  const s = stepSwim({ y, vy, wishY: 0, diving: false, dt: 0.05, floor: -20 });
  y = s.y;
  vy = s.vy;
}
if (Math.abs(y - FLOAT_Y) > 0.2) throw new Error(`surface swim should float near ${FLOAT_Y}, got ${y}`);

let dy = -2, dvy = 0;
for (let i = 0; i < 20; i++) {
  const s = stepSwim({ y: dy, vy: dvy, wishY: -1, diving: true, dt: 0.05, floor: -20 });
  dy = s.y;
  dvy = s.vy;
}
if (dy > -2.4) throw new Error(`dive should go down, got ${dy}`);

if (swimSpeed(false, false) >= swimSpeed(false, true)) throw new Error('sprint should be faster on the surface');
if (swimSpeed(true, true) <= swimSpeed(false, false)) throw new Error('dive sprint should outrun an easy surface stroke');

console.log('swim ok', { float: y, dive: dy });
