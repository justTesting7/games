// Routes for rival drivers: A* over a 2 m grid of where a car fits (no wall, post, railing
// or tree in a car's width at body height), built lazily cell by cell as searches touch it.
// Climbing a kerb costs extra, so routes keep to the road they start on and cross pavement
// only where it saves a long way round. The route is pulled straight wherever a car could
// drive the line between two points.

const CELL = 2;
const CLEAR = 1.25; // metres around a cell centre that must be free (half a car's width + a margin)
const KERB = 0.08; // a step higher than this between cells is a kerb
const SQ2 = Math.SQRT2;

export class DriveGrid {
  /** world: { terrain: { heightAt(x, z), inBounds?(x, z) }, veg?: { colliders: { query(x, z, r, out) } } } */
  constructor(world, cell = CELL) {
    this.world = world;
    this.cell = cell;
    this.cache = new Map(); // key -> height of a free cell, or NaN when blocked
    this._tmp = [];
  }

  key(ix, iz) { return ix * 100000 + iz; } // exact: |iz| stays far below 50000

  /** Ground height of a cell a car fits in, or NaN. */
  free(ix, iz) {
    const k = this.key(ix, iz);
    let h = this.cache.get(k);
    if (h !== undefined) return h;
    const x = (ix + 0.5) * this.cell, z = (iz + 0.5) * this.cell;
    const t = this.world.terrain;
    h = t.inBounds && !t.inBounds(x, z) ? NaN : t.heightAt(x, z);
    const cols = this.world.veg?.colliders;
    if (cols && !Number.isNaN(h)) {
      for (const c of cols.query(x, z, CLEAR + 0.5, this._tmp)) {
        if (c.y1 < h + 0.25 || c.y0 > h + 1.3) continue; // under the bumper or over the roof
        const hit = c.box
          ? x > c.x0 - CLEAR && x < c.x1 + CLEAR && z > c.z0 - CLEAR && z < c.z1 + CLEAR
          : Math.hypot(x - c.x, z - c.z) < (c.r || 0) + CLEAR;
        if (hit) { h = NaN; break; }
      }
    }
    this.cache.set(k, h);
    return h;
  }

  /** True when a car can drive straight from a to b (sampled every half cell, no kerb climbs). */
  line(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const n = Math.ceil(len / (this.cell * 0.5));
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const x = a.x + (dx * i) / n, z = a.z + (dz * i) / n;
      const h = this.free(Math.floor(x / this.cell), Math.floor(z / this.cell));
      if (Number.isNaN(h)) return false;
      if (prev !== null && h - prev > KERB) return false;
      prev = h;
    }
    return true;
  }

  /**
   * A route from `from` to near `to` ({x, z} each), as points; null when none is found.
   * Stops within `near` metres of the goal, or at the closest reachable cell when the goal
   * itself is somewhere no car fits.
   */
  find(from, to, { near = 8, maxNodes = 7000 } = {}) {
    const c = this.cell;
    const sx = Math.floor(from.x / c), sz = Math.floor(from.z / c);
    const gx = Math.floor(to.x / c), gz = Math.floor(to.z / c);
    const nearCells = near / c;
    const hOf = (ix, iz) => { const ax = Math.abs(ix - gx), az = Math.abs(iz - gz); return (Math.max(ax, az) + (SQ2 - 1) * Math.min(ax, az)) * c; };
    const start = this.key(sx, sz);
    const nodes = new Map([[start, { ix: sx, iz: sz, g: 0, f: hOf(sx, sz), parent: null, h: this.world.terrain.heightAt(from.x, from.z), open: true }]]);
    const heap = [nodes.get(start)];
    const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= heap[i].f) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l].f < heap[m].f) m = l;
          if (r < heap.length && heap[r].f < heap[m].f) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    let best = nodes.get(start), bestH = hOf(sx, sz), expanded = 0, goal = null;
    while (heap.length && expanded < maxNodes) {
      const n = pop();
      if (!n.open) continue;
      n.open = false;
      expanded++;
      const hd = hOf(n.ix, n.iz);
      if (hd < bestH) { bestH = hd; best = n; }
      if (hd <= nearCells * c) { goal = n; break; }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const ix = n.ix + dx, iz = n.iz + dz;
        const h = this.free(ix, iz);
        if (Number.isNaN(h)) continue;
        // no cutting a corner past a blocked cell
        if (dx && dz && (Number.isNaN(this.free(n.ix + dx, n.iz)) || Number.isNaN(this.free(n.ix, n.iz + dz)))) continue;
        const climb = h - n.h;
        if (climb > 0.6) continue; // a wall-sized step: no car gets up that
        const step = (dx && dz ? SQ2 : 1) * c * (climb > KERB ? 4 : Math.abs(climb) > KERB ? 2 : 1);
        const k = this.key(ix, iz);
        const g = n.g + step;
        const old = nodes.get(k);
        if (old && (old.g <= g || !old.open)) continue;
        const m = { ix, iz, g, f: g + hOf(ix, iz), parent: n, h, open: true };
        nodes.set(k, m);
        push(m);
      }
    }
    const end = goal || best;
    if (!end || end === nodes.get(start)) return null;
    const raw = [];
    for (let n = end; n; n = n.parent) raw.push({ x: (n.ix + 0.5) * c, z: (n.iz + 0.5) * c });
    raw.reverse();
    raw[0] = { x: from.x, z: from.z };
    // pull it straight: from each kept point, jump to the farthest one in plain line
    const out = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = Math.min(raw.length - 1, i + 24);
      while (j > i + 1 && !this.line(raw[i], raw[j])) j--;
      out.push(raw[j]);
      i = j;
    }
    out.reached = !!goal;
    return out;
  }
}

/**
 * Where to steer on a route: the point `ahead` metres along it past the spot nearest the
 * car (route = points from find()). Also returns how sharply the route turns there.
 */
export function followRoute(route, x, z, ahead) {
  let bi = 0, bd = Infinity, bt = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2));
    const d = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
    if (d < bd) { bd = d; bi = i; bt = t; }
  }
  let left = ahead, i = bi, t = bt;
  let px = 0, pz = 0;
  for (;;) {
    const a = route[i], b = route[i + 1] || a;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    const rest = seg * (1 - t);
    if (rest >= left || i >= route.length - 2) {
      const k = seg > 0 ? Math.min(1, t + left / seg) : 1;
      px = a.x + (b.x - a.x) * k; pz = a.z + (b.z - a.z) * k;
      break;
    }
    left -= rest; i++; t = 0;
  }
  // the turn coming up: the angle between this leg and the next
  const a = route[bi], b = route[bi + 1] || a, c = route[bi + 2];
  let turn = 0;
  if (c) {
    const a1 = Math.atan2(b.x - a.x, b.z - a.z), a2 = Math.atan2(c.x - b.x, c.z - b.z);
    turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
  }
  return { x: px, z: pz, off: bd, turn, end: bi >= route.length - 2 && bt > 0.9 };
}
