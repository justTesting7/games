import { ARENA, arenaHeightAt, arenaZone, buildArenaHeightmap, generateArenaLayout, hoopX, ovalU, tunnelInfo } from '../src/world/arenaLayout.js';
import { getMap, MAPS } from '../src/world/maps.js';

const noise = { fbm2: () => 0 };
const fail = (msg) => { console.error(msg); process.exit(1); };

if (!MAPS.garden || getMap('garden').id !== 'garden') fail('garden map is not registered');
if (getMap('garden').label !== 'Madison Square Garden') fail('garden label');

const layout = generateArenaLayout(1);
if (layout.spawn.x !== 0 || layout.spawn.z !== 0) fail('spawn should be center court');
if (Math.abs(layout.peak.x - hoopX()) > 0.01) fail('peak should face a hoop');

if (arenaZone(0, 0) !== 'court') fail(`center is ${arenaZone(0, 0)}, expected court`);
if (arenaZone(8, 0) !== 'court') fail('midcourt not court');
if (arenaZone(0, 0.5) !== 'court') fail('paint not court');

const east = tunnelInfo(28, 0);
if (!east.inBand || east.isRamp) fail('east vomitorium should be a level tunnel');
const diag = tunnelInfo(Math.cos(Math.PI / 4) * ARENA.sx * 1.8, Math.sin(Math.PI / 4) * ARENA.sz * 1.8);
if (!diag.inBand || !diag.isRamp) fail('diagonal should ramp to the concourse');

const courtH = arenaHeightAt(0, 0, layout, noise);
if (Math.abs(courtH - ARENA.baseY) > 0.08) fail(`court height ${courtH}`);

const concX = Math.cos(0.35) * ARENA.sx * 2.7;
const concZ = Math.sin(0.35) * ARENA.sz * 2.7;
const conc = ovalU(concX, concZ);
if (conc < ARENA.concIn || conc > ARENA.concOut) fail(`expected concourse u, got ${conc}`);
if (arenaZone(concX, concZ) !== 'concourse') fail(`expected concourse zone, got ${arenaZone(concX, concZ)}`);
const concH = arenaHeightAt(concX, concZ, layout, noise);
if (concH < ARENA.concY - 0.3) fail(`concourse should be raised, got ${concH}`);

const hallX = Math.cos(0.35) * ARENA.sx * 3.7;
const hallZ = Math.sin(0.35) * ARENA.sz * 3.7;
const hallH = arenaHeightAt(hallX, hallZ, layout, noise);
if (Math.abs(hallH - ARENA.baseY) > 0.15) fail(`outer hall should be at grade, got ${hallH}`);

const bowlH = arenaHeightAt(ARENA.sx * 1.6, ARENA.sz * 1.6, layout, noise);
if (bowlH <= ARENA.baseY + 1) fail(`bowl should rise, got ${bowlH}`);

const data = buildArenaHeightmap(20240611);
if (data.heights.length !== 1025 * 1025) fail('heightmap size');
if (data.spawn.x !== 0) fail('heightmap spawn');
if (!data.layout) fail('layout missing');

const N = 1025;
const mid = (512 * N + 512);
if (Math.abs(data.heights[mid] - ARENA.baseY) > 0.2) fail(`mid height ${data.heights[mid]}`);

console.log('ok: Madison Square Garden layout, court, ramps, concourse, halls');
