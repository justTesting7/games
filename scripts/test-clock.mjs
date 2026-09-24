import { consume, STEP, MAX_CATCHUP } from '../src/engine/clock.js';

const sum = (a) => a.reduce((s, x) => s + x, 0);
const near = (a, b) => Math.abs(a - b) < 1e-9;

const one = consume(0.016);
if (one.length !== 1 || !near(one[0], 0.016)) throw new Error(`visible frame: ${one}`);

const hidden = consume(1);
if (hidden.length !== 20 || !hidden.every((dt) => near(dt, STEP))) {
  throw new Error(`1s hidden tick should be 20×50ms, got ${hidden.length} ${hidden[0]}`);
}
if (!near(sum(hidden), 1)) throw new Error(`1s catch-up summed to ${sum(hidden)}`);

const old = consume(1);
const dt = Math.min(0.05, 1);
if (near(dt, 0.05) && old.length === 1) throw new Error('old clamp still pauses');
if (sum(hidden) < 0.9) throw new Error('background tab would still crawl');

const cap = consume(8);
if (!near(sum(cap), MAX_CATCHUP)) throw new Error(`cap ${sum(cap)}`);

const zero = consume(0);
if (zero.length) throw new Error('zero elapsed should skip');

console.log('clock catch-up ok', {
  frame: one,
  hiddenSteps: hidden.length,
  hiddenSum: sum(hidden),
  capSteps: cap.length,
});

globalThis.document = {
  visibilityState: 'hidden',
  addEventListener() {},
};
globalThis.requestAnimationFrame = () => 0;

const { startClock } = await import('../src/engine/clock.js');
let sim = 0;
let draws = 0;
const clock = startClock((dt, draw) => {
  sim += dt;
  if (draw) draws++;
});
await new Promise((r) => setTimeout(r, 280));
clock.stop();
if (sim < 0.18) throw new Error(`hidden clock only advanced ${sim.toFixed(3)}s`);
if (draws !== 0) throw new Error(`hidden tab should not render, drew ${draws}`);
console.log('hidden worker/timer clock ok', { sim: +sim.toFixed(3), draws });
