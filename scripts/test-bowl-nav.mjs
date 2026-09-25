import {
  ARENA, BOWL, LOWER_ROWS, aisleClearance, arenaZone, bowlFrame, bowlParam,
  bowlWaypoint, nearestAisleT, standSpawn,
} from '../src/world/arenaLayout.js';

const fail = (msg) => { throw new Error(msg); };

const aisleT = nearestAisleT(0.5 / BOWL.sections);
if (Math.abs(aisleT) > 1e-9 && Math.abs(aisleT - 1) > 1e-9) {
  fail(`section 0.5 should snap to an aisle, got ${aisleT}`);
}

const row = LOWER_ROWS[BOWL.spawnRow - 1];
const spawn = standSpawn(0);
if (arenaZone(spawn.x, spawn.z) !== 'bowl') fail(`spawn zone ${arenaZone(spawn.x, spawn.z)}`);
if (aisleClearance(spawn.x, spawn.z).onAisle) fail('spawn sits in the seats, not on an aisle');

const stair = bowlFrame(row.walkR, spawn.section / BOWL.sections);
if (!aisleClearance(stair.x, stair.z).onAisle) fail('section edge should be an aisle');

const court = { x: 0, z: 0 };
const fromSeats = bowlWaypoint(spawn, court);
if (!fromSeats) fail('stand-to-court should route');
if (fromSeats.via !== 'to-aisle') fail(`from seats should walk to the stairs, got ${fromSeats.via}`);
if (fromSeats.jump) fail('long stand-to-court should not hop the chairs');
const via = aisleClearance(fromSeats.x, fromSeats.z);
if (!via.onAisle) fail('first waypoint should sit on an aisle');
if (Math.abs(via.r - bowlParam(spawn.x, spawn.z).r) > 1.2) {
  fail('first waypoint should stay on this row until the aisle');
}

const down = bowlWaypoint(stair, court);
if (!down || down.via !== 'stairs') fail(`on an aisle should take the stairs, got ${down?.via}`);
if (down.jump) fail('stairs should be walked, not hopped');
if (bowlParam(down.x, down.z).r >= bowlParam(stair.x, stair.z).r - 0.2) {
  fail('stairs waypoint should head down toward the court');
}

const nearRow = LOWER_ROWS[1];
const seat = bowlFrame(nearRow.seatR, (spawn.section + 0.5) / BOWL.sections);
const hop = bowlWaypoint(seat, court);
if (!hop || hop.via !== 'hop-seats') fail(`one or two rows should hop the chairs, got ${hop?.via}`);
if (!hop.jump) fail('short cut across seats should jump');

const flat = bowlWaypoint({ x: 2, z: 2 }, { x: -3, z: 1 });
if (flat) fail('court-to-court should not rewrite the path');

console.log('bowl nav ok', { via: fromSeats.via, hop: hop.via });
