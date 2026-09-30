export const WATER_Y = 0;
export const FLOAT_Y = -1.08;
export const SWIM_SPEED = { surface: 2.35, sprint: 3.55, dive: 2.7, diveSprint: 4.15 };

// Maps with a sea (the island) float y = 0 as water. The city maps have no sea: their
// streets sit around and below y = 0, which used to make players swim down the road.
let sea = true;
export function setSea(on) { sea = !!on; }
export const hasSea = () => sea;

export function waterColumn(floor) {
  return sea && floor < -0.28;
}

export function shouldSwim(y, floor, already = false) {
  if (!waterColumn(floor)) return false;
  return already ? y < 0.62 : y < 0.22;
}

export function canExitWater(floor, y, jump) {
  return floor > -0.42 && (jump || y > -0.3);
}

export function clampSwimY(y, floor) {
  const min = floor + 0.38;
  const max = WATER_Y - 0.08;
  return Math.min(max, Math.max(min, y));
}

// One integration step. `wish` is a unit-ish 3D swim direction.
export function stepSwim({ y, vy, wishY = 0, speed = 0, diving = false, dt, floor }) {
  let nextY = y;
  let nextVy = vy;
  if (!diving) {
    const spring = (FLOAT_Y - nextY) * 11;
    nextVy += (spring + wishY * 6) * dt;
    nextVy *= Math.exp(-dt * 4.2);
  } else {
    nextVy += (wishY * 14 - 0.7) * dt;
    nextVy *= Math.exp(-dt * 3.2);
  }
  nextY += nextVy * dt;
  const hitFloor = nextY <= floor + 0.38;
  nextY = clampSwimY(nextY, floor);
  if (hitFloor) nextVy = Math.max(0, nextVy);
  if (!diving && nextY > FLOAT_Y - 0.02 && nextVy > 0 && wishY <= 0.05) nextVy *= 0.4;
  return { y: nextY, vy: nextVy, speed };
}

export function swimSpeed(diving, sprint, stick = 1) {
  const top = diving
    ? (sprint ? SWIM_SPEED.diveSprint : SWIM_SPEED.dive)
    : (sprint ? SWIM_SPEED.sprint : SWIM_SPEED.surface);
  return top * Math.min(1, stick);
}
