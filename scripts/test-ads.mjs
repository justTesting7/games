import { readFileSync } from 'node:fs';
import { AD_COUNT, AD_HOLD, AD_MOVE, AD_SIZE, AD_WRAP, adScroll } from '../src/world/arenaMaterials.js';

const fail = (msg) => { console.error(msg); process.exit(1); };

if (AD_COUNT !== 8) fail(`expected 8 ads, got ${AD_COUNT}`);
if (Math.abs(AD_SIZE - 0.6) > 1e-9) fail(`ads should be 60% size, got ${AD_SIZE}`);
if (Math.abs(AD_WRAP - 1 / 0.6) > 1e-9) fail(`wrap should be ${1 / 0.6}, got ${AD_WRAP}`);
const shader = readFileSync(new URL('../src/world/arenaMaterials.js', import.meta.url), 'utf8');
if (!shader.includes('const float WRAP = 1.6666667')) fail('ribbon shader should wrap ads at 60% size');
if (shader.includes('fract(-ang * WRAP')) fail('ads must not be mirrored for the stand-side view');
if (!shader.includes('fract(ang * WRAP + ticker(uTime))')) fail('ads should read left-to-right from the stands');

const hold = adScroll(AD_MOVE + 0.2);
const next = adScroll(AD_MOVE + AD_HOLD + 0.01);
if (Math.abs(hold - 1 / AD_COUNT) > 1e-6) fail(`hold should sit on ad 1, got ${hold}`);
if (next <= hold) fail('ticker should advance after the hold');

const a = adScroll(0);
const b = adScroll(AD_MOVE * 0.5);
if (!(a < b && b < 1 / AD_COUNT)) fail(`move should ease between ads (${a} ${b})`);

console.log('ads ok', { hold, next });
