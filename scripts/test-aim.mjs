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
