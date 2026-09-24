// Analog stick + keys should combine, then cap at 1 so a diagonal
// thumb does not run faster than sprint.
const wish = (forward, back, left, right, moveX = 0, moveY = 0) => {
  const f = (forward ? 1 : 0) - (back ? 1 : 0) + moveY;
  const s = (right ? 1 : 0) - (left ? 1 : 0) + moveX;
  return Math.min(1, Math.hypot(f, s));
};

if (Math.abs(wish(true, false, false, false) - 1) > 1e-9) throw new Error('W should be full');
if (wish(false, false, false, false, 0.4, 0) > 0.41) throw new Error('half stick should stay analog');
if (wish(false, false, false, false, 0.9, 0.9) > 1 + 1e-9) throw new Error('diagonal stick must cap');
if (wish(false, false, false, false, 0, 0) !== 0) throw new Error('idle stick');

console.log('touch move ok');
