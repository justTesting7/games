export const RADAR_RANGE = 80;

// World XZ → look space: +y is the facing direction, +x is camera-right.
export function radarOffset(self, yaw, other, range = RADAR_RANGE) {
  const dx = other.x - self.x;
  const dz = other.z - self.z;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const fwd = dx * s + dz * c;
  const right = -dx * c + dz * s;
  const dist = Math.hypot(right, fwd);
  const edge = dist > range;
  const k = edge ? range / (dist || 1) : 1;
  return { x: right * k, y: fwd * k, dist, edge };
}

export function radarBlips(self, yaw, others, range = RADAR_RANGE) {
  const out = [];
  for (const o of others) {
    if (!o || o.alive === false) continue;
    const pos = o.pos || o;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) continue;
    out.push({
      ...radarOffset(self, yaw, pos, range),
      id: o.id,
      name: o.name || '',
      color: o.color || '#ff5a4a',
    });
  }
  return out;
}

let resizes = 0;
if (typeof window !== 'undefined') window.addEventListener('resize', () => { resizes++; });

function fitCanvas(canvas) {
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  // the CSS size is read only after a resize: reading it every frame forces a layout of
  // the page right after the HUD's writes
  if (!canvas._css || canvas._cssFor !== resizes) { canvas._css = canvas.clientWidth || 148; canvas._cssFor = resizes; }
  const css = canvas._css;
  const size = Math.max(64, Math.round(css * dpr));
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  return size;
}

// How close: red within ~15 m, through orange and yellow, to green past ~250 m (the scale
// spends more of its range on the near distances, where it matters).
export function distanceColor(dist) {
  const t = Math.sqrt(Math.min(1, Math.max(0, (dist - 15) / 235)));
  return `hsl(${Math.round(t * 120)}, 90%, 52%)`;
}

export function drawRadar(canvas, { blips = [], range = RADAR_RANGE, time = 0 } = {}) {
  if (!canvas) return;
  const size = fitCanvas(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cx = size / 2;
  const pad = size * 0.08;
  const rr = cx - pad;
  const scale = rr / range;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 1, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = 'rgba(6, 10, 12, 0.72)';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(243, 220, 176, 0.16)';
  ctx.lineWidth = Math.max(1, size * 0.008);
  for (const k of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cx, rr * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cx - rr);
  ctx.lineTo(cx, cx + rr);
  ctx.moveTo(cx - rr, cx);
  ctx.lineTo(cx + rr, cx);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(243, 220, 176, 0.45)';
  ctx.beginPath();
  ctx.moveTo(cx, cx - rr);
  ctx.lineTo(cx, cx - rr * 0.72);
  ctx.stroke();

  const sweep = ((time * 0.55) % 1) * Math.PI * 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, rr);
  grad.addColorStop(0, 'rgba(243, 220, 176, 0.12)');
  grad.addColorStop(1, 'rgba(243, 220, 176, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx, cx);
  ctx.arc(cx, cx, rr, sweep, sweep + 0.55);
  ctx.closePath();
  ctx.fill();

  for (const b of blips) {
    const px = cx + b.x * scale;
    const py = cx - b.y * scale;
    ctx.fillStyle = Number.isFinite(b.dist) ? distanceColor(b.dist) : b.color;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = Math.max(1, size * 0.01);
    if (b.edge) {
      const ang = Math.atan2(b.x, b.y);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.035);
      ctx.lineTo(size * 0.022, size * 0.02);
      ctx.lineTo(-size * 0.022, size * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      const rad = size * 0.032;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const mark = (b.name || '?').trim().charAt(0).toUpperCase();
    if (mark) {
      ctx.fillStyle = '#fff8e8';
      ctx.font = `700 ${Math.round(size * 0.07)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mark, px, py + size * 0.055);
    }
  }

  ctx.fillStyle = '#f3dcb0';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = Math.max(1, size * 0.012);
  ctx.beginPath();
  ctx.moveTo(cx, cx - size * 0.055);
  ctx.lineTo(cx + size * 0.028, cx + size * 0.032);
  ctx.lineTo(cx, cx + size * 0.01);
  ctx.lineTo(cx - size * 0.028, cx + size * 0.032);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
  ctx.strokeStyle = 'rgba(243, 220, 176, 0.55)';
  ctx.lineWidth = Math.max(1.5, size * 0.014);
  ctx.beginPath();
  ctx.arc(cx, cx, cx - ctx.lineWidth * 0.6, 0, Math.PI * 2);
  ctx.stroke();
}

export function radarSubjects(list) {
  const out = [];
  for (const r of list) {
    if (!r) continue;
    out.push({
      id: r.fighter?.id || r.id,
      name: r.persona?.name || r.fighter?.name || '',
      color: r.persona?.color || r.fighter?.color || '#ff5a4a',
      alive: r.fighter ? !!r.fighter.alive : r.alive !== false,
      x: r.pos?.x,
      z: r.pos?.z,
    });
  }
  return out;
}
