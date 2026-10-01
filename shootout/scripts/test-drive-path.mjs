import { DriveGrid, followRoute } from '../src/game/drivePath.js';

const fail = (msg) => { console.error(msg); process.exit(1); };

// a 100 m yard: a wall across the middle (z = 0) with a gap at x 30..40,
// and a raised pavement strip (kerb 0.15) along x < -20
const boxes = [
  { box: true, x0: -50, x1: 30, z0: -0.5, z1: 0.5, y0: 0, y1: 3 },
  { box: true, x0: 40, x1: 50, z0: -0.5, z1: 0.5, y0: 0, y1: 3 },
];
const world = {
  terrain: { heightAt: (x) => (x < -20 ? 0.15 : 0), inBounds: (x, z) => Math.abs(x) < 50 && Math.abs(z) < 50 },
  veg: { colliders: { query: (x, z, r, out) => { out.length = 0; for (const b of boxes) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) out.push(b); return out; } } },
};
const grid = new DriveGrid(world);
const route = grid.find({ x: 0, z: -30 }, { x: 0, z: 30 });
if (!route || !route.reached) fail('no route through the gap');
// every leg is drivable and the route goes through the gap
for (let i = 0; i < route.length - 1; i++) if (!grid.line(route[i], route[i + 1])) fail(`leg ${i} is not drivable`);
const crossing = route.find((p, i) => i && Math.sign(p.z) !== Math.sign(route[i - 1].z));
const viaGap = route.some((p) => p.x > 30 && p.x < 40 && Math.abs(p.z) < 6) || (crossing && crossing.x > 28);
if (!viaGap) fail(`route does not use the gap: ${JSON.stringify(route)}`);
if (route.length > 8) fail(`route not straightened: ${route.length} points`);
const end = route[route.length - 1];
if (Math.hypot(end.x - 0, end.z - 30) > 9) fail('route ends too far from the goal');
// a goal inside the wall: gets as close as it can
const blockedGoal = grid.find({ x: 0, z: -30 }, { x: 0, z: 0 });
if (!blockedGoal) fail('no fallback route to a blocked goal');
// kerbs: driving along the road from x = -10 to x = -10, z far, the route stays off the pavement
const road = grid.find({ x: -12, z: -40 }, { x: -12, z: -5 });
if (road.some((p) => p.x < -20)) fail('route climbed onto the pavement for no reason');
// following: a point ahead along the route
const f = followRoute(route, 0, -30, 10);
if (!(f.z > -30)) fail('follow point should be ahead');
if (f.off > 0.5) fail('car at the start should be on the route');
console.log('ok drive path', route.length, 'points');
