import {
  ARENA, BOWL, LOWER_ROWS, arenaHeightAt, arenaZone, buildArenaHeightmap,
  enumerateSeats, generateArenaLayout, hoopX, ovalPoint, ovalU, standSpawn,
} from '../src/world/arenaLayout.js';
import { getMap, MAPS } from '../src/world/maps.js';

const noise = { fbm2: () => 0 };
const fail = (msg) => { console.error(msg); process.exit(1); };

if (!MAPS.garden || getMap('garden').id !== 'garden') fail('garden map is not registered');
if (getMap('garden').label !== 'Madison Square Garden') fail('garden label');
if (!MAPS.garden.fixedTime) fail('garden should disable day/night');

const seats = enumerateSeats();
if (seats.length < 19000 || seats.length > 22000) fail(`expected ~20k seats, got ${seats.length}`);

const layout = generateArenaLayout(1);
const s0 = standSpawn(0);
if (Math.hypot(layout.spawn.x - s0.x, layout.spawn.z - s0.z) > 0.05) fail('layout spawn should be stand 0');
if (s0.row !== 18) fail(`stand spawn row ${s0.row}`);
if (Math.abs(s0.y - LOWER_ROWS[17].y) > 0.01) fail('spawn height should match the 18th step');

const used = new Set();
for (let i = 0; i < 8; i++) {
  const s = standSpawn(i);
  if (s.row !== 18) fail(`slot ${i} not on the 18th step`);
  if (used.has(s.section)) fail(`two players share stand ${s.section}`);
  used.add(s.section);
  if (Math.abs(arenaHeightAt(s.x, s.z, layout, noise) - s.y) > 0.08) fail(`slot ${i} not standing on the terrace`);
  const toCourt = Math.hypot(s.x, s.z);
  const dot = (Math.sin(s.yaw) * -s.x + Math.cos(s.yaw) * -s.z) / toCourt;
  if (dot < 0.6) fail(`slot ${i} not facing the court (${dot.toFixed(2)})`);
}

if (arenaZone(0, 0) !== 'court') fail(`center is ${arenaZone(0, 0)}, expected court`);
if (Math.abs(hoopX() - (ARENA.courtHX - ARENA.hoopInset)) > 1e-6) fail('hoop');

const row18 = LOWER_ROWS[BOWL.spawnRow - 1];
for (let i = 0; i < 32; i++) {
  const ang = (i / 32) * Math.PI * 2;
  const p = ovalPoint(row18.walkU, ang);
  const h = arenaHeightAt(p.x, p.z, layout, noise);
  if (h < row18.y - 0.3) fail(`stand gap at ang=${ang.toFixed(2)} h=${h} expected ~${row18.y}`);
}
const midRow = LOWER_ROWS[9];
for (const ang of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
  const p = ovalPoint((midRow.u0 + midRow.u1) * 0.5, ang);
  const h = arenaHeightAt(p.x, p.z, layout, noise);
  if (h < midRow.y - 0.3) fail(`mid-bowl hole at ${ang} h=${h}`);
}

const courtH = arenaHeightAt(0, 0, layout, noise);
if (Math.abs(courtH - ARENA.baseY) > 0.08) fail(`court height ${courtH}`);

const conc = ovalPoint((ARENA.concIn + ARENA.concOut) * 0.5, 0.35);
if (arenaZone(conc.x, conc.z) !== 'concourse') fail(`expected concourse zone, got ${arenaZone(conc.x, conc.z)}`);
const concH = arenaHeightAt(conc.x, conc.z, layout, noise);
if (Math.abs(concH - ARENA.concY) > 0.05) fail(`concourse should be raised, got ${concH}`);

const hall = ovalPoint((ARENA.hallIn + ARENA.hallOut) * 0.5, 2.2);
if (arenaZone(hall.x, hall.z) !== 'hall') fail(`expected hall, got ${arenaZone(hall.x, hall.z)} u=${ovalU(hall.x, hall.z)}`);
if (Math.abs(arenaHeightAt(hall.x, hall.z) - ARENA.topY) > 0.05) fail('hall should sit level with the top row');

const data = buildArenaHeightmap(20240611);
if (data.heights.length !== 1025 * 1025) fail('heightmap size');
if (Math.hypot(data.spawn.x - s0.x, data.spawn.z - s0.z) > 0.2) fail('heightmap spawn');

const N = 1025;
const mid = (512 * N + 512);
if (Math.abs(data.heights[mid] - ARENA.baseY) > 0.2) fail(`mid height ${data.heights[mid]}`);

console.log('ok: Garden 20k seats, 18th-step stands, closed bowl', {
  seats: seats.length, sections: BOWL.sections, spawnRow: BOWL.spawnRow,
});
