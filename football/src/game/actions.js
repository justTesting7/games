// Durations of procedural actions (seconds), shared by the match logic and
// the animated footballer so ball contact lines up with the swing.
export const ACTION_DUR = {
  kick: 0.62,
  pass: 0.5,
  poke: 0.42,
  touch: 0.26,
  slide: 1.0,
  dive: 1.25,
  header: 0.7,
  jumpCatch: 0.8,
  throw: 1.0,
  fall: 1.8,
  celebrate: 5,
};

// Fraction of a kick at which the foot meets the ball.
export const KICK = { contact: 0.42 };
