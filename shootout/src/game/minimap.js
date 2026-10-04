// A small street map, bottom left: the city drawn once from the baked collision data
// (open ground light, buildings and walls dark), shown through a circle that turns with
// the player so "up" is where they face.
const SCALE = 1; // map pixels per metre
const VIEW = 0.9; // screen pixels per metre

export function buildMinimap(nav) {
  const x0 = nav.x0, z0 = nav.z0;
  const w = Math.ceil(nav.w * nav.cell), h = Math.ceil(nav.h * nav.cell);
  const img = document.createElement('canvas');
  img.width = w * SCALE; img.height = h * SCALE;
  const c = img.getContext('2d');
  c.fillStyle = '#7b8288'; // streets and squares
  c.fillRect(0, 0, img.width, img.height);
  for (const [bx0, bz0, bx1, bz1, tall] of nav.boxes) {
    c.fillStyle = tall ? '#1a1f23' : '#39414a'; // walls and buildings; low things (railings, posts)
    c.fillRect((bx0 - x0) * SCALE, (bz0 - z0) * SCALE, Math.max(1, (bx1 - bx0) * SCALE), Math.max(1, (bz1 - bz0) * SCALE));
  }
  return { img, x0, z0 };
}

export function drawMinimap(canvas, map, { x, z, yaw }) {
  const size = canvas.width, c = canvas.getContext('2d'), r = size / 2;
  c.clearRect(0, 0, size, size);
  c.save();
  c.beginPath(); c.arc(r, r, r - 1, 0, Math.PI * 2); c.clip();
  c.fillStyle = '#0c0f11'; c.fillRect(0, 0, size, size);
  c.translate(r, r);
  c.rotate(yaw - Math.PI);
  c.scale(VIEW / SCALE, VIEW / SCALE);
  c.drawImage(map.img, -(x - map.x0) * SCALE, -(z - map.z0) * SCALE);
  c.restore();
  // north, and you in the middle
  c.save();
  c.translate(r, r);
  c.fillStyle = '#f3dcb0'; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, -size * 0.07); c.lineTo(size * 0.045, size * 0.05); c.lineTo(0, size * 0.025); c.lineTo(-size * 0.045, size * 0.05); c.closePath(); c.fill(); c.stroke();
  c.restore();
  // N: where world -z (north) lies on the turned map
  const th = yaw - Math.PI, nr = r - size * 0.1;
  c.fillStyle = '#fff8e8'; c.font = `700 ${Math.round(size * 0.08)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.8)';
  c.strokeText('N', r + Math.sin(th) * nr, r - Math.cos(th) * nr);
  c.fillText('N', r + Math.sin(th) * nr, r - Math.cos(th) * nr);
  c.strokeStyle = 'rgba(243, 220, 176, 0.55)'; c.lineWidth = 3;
  c.beginPath(); c.arc(r, r, r - 1.5, 0, Math.PI * 2); c.stroke();
}
