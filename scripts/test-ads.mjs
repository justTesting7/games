import { AD_COUNT, AD_HOLD, AD_MOVE, adScroll } from '../src/world/arenaMaterials.js';

const fail = (msg) => { console.error(msg); process.exit(1); };

if (AD_COUNT !== 8) fail(`expected 8 ads, got ${AD_COUNT}`);

const hold = adScroll(AD_MOVE + 0.2);
const next = adScroll(AD_MOVE + AD_HOLD + 0.01);
if (Math.abs(hold - 1 / AD_COUNT) > 1e-6) fail(`hold should sit on ad 1, got ${hold}`);
if (next <= hold) fail('ticker should advance after the hold');

const a = adScroll(0);
const b = adScroll(AD_MOVE * 0.5);
if (!(a < b && b < 1 / AD_COUNT)) fail(`move should ease between ads (${a} ${b})`);

console.log('ads ok', { hold, next });
