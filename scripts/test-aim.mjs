// Shoulder camera sits ~0.5 m right of the body. A look-parallel ray from
// the body misses a target the crosshair is on; a ray from the body to that
// aim point hits it.
const shoulder = 0.5;
const target = { x: shoulder, y: 0, z: 20 };

const oldHitX = 0 + 0 * target.z;
if (Math.abs(oldHitX - target.x) < 0.1) {
  throw new Error('old parallel body ray would already hit the crosshair target');
}

const dirX = target.x - 0;
const dirZ = target.z - 0;
const len = Math.hypot(dirX, dirZ);
const newHitX = 0 + (dirX / len) * target.z;
if (Math.abs(newHitX - target.x) > 0.02) {
  throw new Error(`converging shot missed crosshair target: ${newHitX} vs ${target.x}`);
}

console.log('pistol aim offset ok', { oldHitX, newHitX, targetX: target.x, miss: target.x - oldHitX });

// A hit 0.8 m in front of the chest would pitch the barrels into the dirt.
// The pose should keep the look direction instead.
const from = { x: 0, y: 1.4, z: 0 };
const near = { x: 0.05, y: 0.3, z: 0.6 };
const dx = near.x - from.x, dy = near.y - from.y, dz = near.z - from.z;
const nearLen = Math.hypot(dx, dy, dz);
if (nearLen >= 2.2) throw new Error('fixture is not a close aim point');
const look = { x: 0.02, y: -0.05, z: 1 };
const useLook = nearLen < 2.2;
const ax = useLook ? look.x : dx / nearLen;
const az = useLook ? look.z : dz / nearLen;
if (Math.abs(ax - look.x) > 1e-9 || Math.abs(az - look.z) > 1e-9) {
  throw new Error('close aim should follow the look, not the dirt');
}

console.log('close-aim look fallback ok', { nearLen });
