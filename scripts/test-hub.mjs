import { existsSync, readFileSync } from 'node:fs';

const fail = (msg) => { console.error(msg); process.exit(1); };

const hub = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
if (!hub.includes('href="/shootout/"')) fail('hub must link to /shootout/');
if (!hub.includes('Shootout')) fail('hub should name Shootout');

for (const p of [
  'shootout/index.html',
  'shootout/src/main.js',
  'shootout/src/server/index.js',
  'shootout/vite.config.js',
  'shootout/public/assets/maps/custom.glb',
]) {
  if (!existsSync(new URL(`../${p}`, import.meta.url))) fail(`missing ${p}`);
}

const game = readFileSync(new URL('../shootout/index.html', import.meta.url), 'utf8');
if (!game.includes('./src/main.js')) fail('shootout html should load the game from a relative src');
if (!game.includes('value="studio"')) fail('Dizengoff should still be on the shootout map list');

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!pkg.scripts.build.includes('shootout/vite.config.js')) fail('build should use the shootout Vite config');
const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
if (!wrangler.includes('shootout/src/server/index.js')) fail('worker entry should stay with the shootout server');

const ads = readFileSync(new URL('../shootout/src/world/arenaMaterials.js', import.meta.url), 'utf8');
if (ads.includes('fract(-ang * WRAP')) fail('Garden ads fix should be folded into shootout');
if (!ads.includes('fract(ang * WRAP + ticker(uTime))')) fail('Garden ads should read left-to-right from the stands');

console.log('hub ok');
