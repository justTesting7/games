import { radarOffset, radarBlips, radarSubjects, RADAR_RANGE } from '../src/game/radar.js';

const self = { x: 0, z: 0 };
const front = radarOffset(self, 0, { x: 0, z: 20 });
if (Math.abs(front.x) > 1e-9 || Math.abs(front.y - 20) > 1e-9) {
  throw new Error(`ahead should be +y, got ${front.x}, ${front.y}`);
}

const camRight = radarOffset(self, 0, { x: -15, z: 0 });
if (Math.abs(camRight.y) > 1e-9 || Math.abs(camRight.x - 15) > 1e-9) {
  throw new Error(`camera-right should be +x, got ${camRight.x}, ${camRight.y}`);
}

const turned = radarOffset(self, Math.PI / 2, { x: 12, z: 0 });
if (Math.abs(turned.x) > 1e-9 || Math.abs(turned.y - 12) > 1e-9) {
  throw new Error(`facing +X, someone on +X should be ahead, got ${turned.x}, ${turned.y}`);
}

const far = radarOffset(self, 0, { x: 0, z: 400 }, 80);
if (!far.edge || Math.abs(far.y - 80) > 1e-6) {
  throw new Error(`far blip should sit on the rim, got edge=${far.edge} y=${far.y}`);
}

const blips = radarBlips(self, 0, [
  { id: 'live', name: 'Nagar', color: '#8fc8ff', alive: true, x: 0, z: 10 },
  { id: 'dead', name: 'Ben', alive: false, x: 4, z: 4 },
], RADAR_RANGE);
if (blips.length !== 1 || blips[0].name !== 'Nagar') {
  throw new Error(`dead players must stay off the radar, got ${blips.map((b) => b.name)}`);
}

const subjects = radarSubjects([
  { fighter: { id: 'r', name: 'Dror', color: '#ff9ad0', alive: true }, persona: { name: 'Dror' }, pos: { x: 3, z: 1 } },
  { fighter: { id: 'x', name: 'Gone', alive: false }, pos: { x: 1, z: 1 } },
]);
if (subjects[0].name !== 'Dror' || subjects[1].alive !== false) {
  throw new Error('radarSubjects should keep name, color, and alive');
}

console.log('radar ok', { front, camRight, far, range: RADAR_RANGE });
