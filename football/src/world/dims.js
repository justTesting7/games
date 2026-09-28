// FIFA-standard pitch, in metres. Length runs along X, width along Z, and the
// main (camera) stand is on the +Z side.
export const PITCH = {
  halfLength: 52.5,
  halfWidth: 34,
  line: 0.12,
  centerCircle: 9.15,
  penaltyDepth: 16.5,
  penaltyHalfWidth: 20.16,
  goalAreaDepth: 5.5,
  goalAreaHalfWidth: 9.16,
  penaltySpot: 11,
  cornerArc: 1,
};

export const GOAL = {
  halfWidth: 3.66,
  height: 2.44,
  post: 0.06,
  depth: 2.2,
};

export const BALL_RADIUS = 0.11;

// Distance from the touchlines to the advertising boards and first row.
export const SURROUND = {
  boardSide: 5,
  boardEnd: 5.5,
  standSide: 9,
  standEnd: 10,
};
