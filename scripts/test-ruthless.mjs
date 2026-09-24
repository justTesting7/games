import { readFileSync } from 'node:fs';

const roster = readFileSync(new URL('../src/game/roster.js', import.meta.url), 'utf8');
const rival = readFileSync(new URL('../src/game/rival.js', import.meta.url), 'utf8');

const nagar = roster.match(/id: 'greytee', name: 'Nagar'[\s\S]*?style: '(\w+)'/);
if (!nagar || nagar[1] !== 'ruthless') throw new Error(`Nagar style should be ruthless, got ${nagar?.[1]}`);
if (!roster.includes("label: 'Ruthless'")) throw new Error('missing ruthless style');
if (!roster.includes('ruthless: true')) throw new Error('ruthless flag missing');

for (const needle of [
  'isRuthless()',
  "if (this.isRuthless()) return true;",
  "Never take cover. Never retreat.",
  "this.persona.ruthless ? 'push' : 'take_cover'",
]) {
  if (!rival.includes(needle)) throw new Error(`rival.js missing ${needle}`);
}

console.log('nagar ruthless ok');
