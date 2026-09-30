// City maps have no sea: streets below y = 0 are dry ground (players used to swim
// down Dizengoff Square's low streets, and rivals refused to walk them).
import { readFileSync } from 'node:fs';
import { setSea, hasSea, shouldSwim, waterColumn } from '../src/game/swim.js';

if (!hasSea() || !shouldSwim(-0.5, -1.5)) throw new Error('the island still has its sea');
setSea(false);
if (waterColumn(-1.5) || shouldSwim(-1.5, -1.5) || shouldSwim(-0.5, -1.5, true)) throw new Error('no swimming on a map without sea');
setSea(true);

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
if (!main.includes('setSea(!mapDef.cityFolder && !mapDef.lab);')) throw new Error('city maps and the lab must switch the sea off');
if (!main.includes('if (hasSea() && o.y > 0 && d.y < 0)')) throw new Error('bullets must not hit a sea surface on the city maps');
const rival = readFileSync(new URL('../src/game/rival.js', import.meta.url), 'utf8');
if (!rival.includes('(hasSea() && ground < 0.1)')) throw new Error('rivals must walk streets below y = 0 on the city maps');
const player = readFileSync(new URL('../src/game/player.js', import.meta.url), 'utf8');
if (!player.includes('get underwater() { return hasSea() &&')) throw new Error('no underwater view on the city maps');
console.log('ok no sea');
