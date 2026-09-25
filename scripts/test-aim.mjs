// Hip-fire must travel along the camera look, not from the chest toward the
// aim point. Chest→aimPoint clips a head the crosshair already passed when
// something behind the target (a stand, a wall) is the aim point.

const HEAD_R = 0.14;

function hitsHead(ox, oz, dx, dz, hx, hz, r) {
  const fx = ox - hx, fz = oz - hz;
  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0;
}

const shoulder = 0.5;
const camZ = -1.55;
const camDist = 1.55;
const head = { x: 0, z: 20 };
// Crosshair just to the right of the head, then a wall a few metres behind.
const aimAtHeadZ = { x: HEAD_R + 0.04, z: head.z };
const wallZ = 28;

const camToAimX = aimAtHeadZ.x - shoulder;
const camToAimZ = aimAtHeadZ.z - camZ;
const lookLen = Math.hypot(camToAimX, camToAimZ);
const ldx = camToAimX / lookLen;
const ldz = camToAimZ / lookLen;

const wallX = shoulder + ldx * ((wallZ - camZ) / ldz);
const startX = shoulder + ldx * camDist;
const startZ = camZ + ldz * camDist;

if (hitsHead(shoulder, camZ, ldx, ldz, head.x, head.z, HEAD_R)) {
  throw new Error('fixture: camera ray should miss just-right of the head');
}

const oldDx = wallX - 0;
const oldDz = wallZ - 0;
const oldLen = Math.hypot(oldDx, oldDz);
if (!hitsHead(0, 0, oldDx / oldLen, oldDz / oldLen, head.x, head.z, HEAD_R)) {
  throw new Error('fixture: old chest→wall ray should still clip the head');
}

if (hitsHead(startX, startZ, ldx, ldz, head.x, head.z, HEAD_R)) {
  throw new Error('camera-look shot hit a head the crosshair missed');
}

// On the head: the same camera-look ray must still hit.
const onX = 0 - shoulder;
const onZ = head.z - camZ;
const onLen = Math.hypot(onX, onZ);
const onDx = onX / onLen;
const onDz = onZ / onLen;
const onStartX = shoulder + onDx * camDist;
const onStartZ = camZ + onDz * camDist;
if (!hitsHead(onStartX, onStartZ, onDx, onDz, head.x, head.z, HEAD_R)) {
  throw new Error('camera-look shot missed a head the crosshair is on');
}

console.log('hip-fire follows the crosshair', {
  missRight: { startX, wallX },
  onHead: { onStartX },
});

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
