import * as THREE from 'three';

// Vaulting low obstacles. The walking grid makes every knee-to-waist-high obstacle a
// 2.4 m wall, so a jump never clears a low wall, a railing or a bollard line. A vault
// measures the obstacle's real top on the shot geometry and carries the body over it.

/**
 * A vault from `pos` along `dir` (xz): the obstacle right ahead must stand 0.4-1.35 m
 * above the feet with clear ground within ~2 m beyond. Returns the plan or null.
 */
export function findVault(world, pos, dir) {
  const { terrain, veg, shots } = world;
  const cols = veg?.colliders;
  if (!cols || !shots) return null;
  const d = new THREE.Vector3(dir.x, 0, dir.z);
  if (d.lengthSq() < 1e-6) return null;
  d.normalize();
  const blocked = (x, z) => cols.query(x, z, 0.5).some((c) => (c.box
    ? x > c.x0 - 0.25 && x < c.x1 + 0.25 && z > c.z0 - 0.25 && z < c.z1 + 0.25
    : Math.hypot(x - c.x, z - c.z) < (c.r || 0) + 0.25) && c.y1 > pos.y + 0.3 && c.y0 < pos.y + 1.5);
  const ax = pos.x + d.x * 0.7, az = pos.z + d.z * 0.7;
  if (!blocked(ax, az)) return null;
  const h = shots.raycast(new THREE.Vector3(ax, pos.y + 2.4, az), new THREE.Vector3(0, -1, 0), 2.4);
  if (!h) return null;
  const top = pos.y + 2.4 - h.t;
  const rise = top - pos.y;
  if (rise < 0.4 || rise > 1.35) return null;
  for (let s = 1.0; s <= 2.3; s += 0.2) {
    const lx = pos.x + d.x * s, lz = pos.z + d.z * s;
    if (blocked(lx, lz)) continue;
    const gy = terrain.heightAt(lx, lz);
    if (Math.abs(gy - pos.y) > 1.2) return null;
    return { from: pos.clone(), to: new THREE.Vector3(lx, gy, lz), top, t: 0, dur: 0.38 + rise * 0.18 };
  }
  return null;
}

/** Moves `next` (and sets `vel`) along the vault; true when it has landed. */
export function stepVault(v, next, vel, dt) {
  v.t = Math.min(1, v.t + dt / v.dur);
  const k = v.t;
  const up = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5);
  next.x = v.from.x + (v.to.x - v.from.x) * k;
  next.z = v.from.z + (v.to.z - v.from.z) * k;
  next.y = k < 0.6 ? v.from.y + (v.top + 0.12 - v.from.y) * up : v.top + 0.12 + (v.to.y - v.top - 0.12) * ((k - 0.6) / 0.4) ** 2;
  vel.set((v.to.x - v.from.x) / v.dur * 0.3, 0, (v.to.z - v.from.z) / v.dur * 0.3);
  if (k >= 1) { next.y = v.to.y; return true; }
  return false;
}
