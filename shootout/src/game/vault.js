import * as THREE from 'three';

// Vaulting and climbing. The walking grid makes every knee-to-waist-high obstacle a
// 2.4 m wall, so a jump never clears a low wall, a railing or a bollard line, and cars
// push walkers away. A jump at one measures what's there (a car's roof, an obstacle's
// real top on the shot geometry) and carries the body up and over it.

// How high a car stands (its roof), measured once from its mesh.
function carTop(car) {
  if (car.topH === undefined) {
    const box = new THREE.Box3();
    if (car.mesh) {
      car.mesh.updateMatrixWorld(true);
      box.setFromObject(car.mesh);
      car.topH = Number.isFinite(box.max.y) ? Math.min(2.6, Math.max(0.6, box.max.y - car.y)) : 1.4;
    } else car.topH = 1.4;
  }
  return car.y + car.topH;
}

// The car (or scooter, bike) right ahead of `pos` along `d`, if a stride would touch it.
function carAhead(cars, pos, d) {
  for (const car of cars || []) {
    if (car.driver && Math.abs(car.speed) > 2) continue; // not one driving off
    const hl = car.hl ?? car.spec?.halfL ?? 2.2, hw = car.hw ?? car.spec?.halfW ?? 1;
    if (Math.abs(car.x - pos.x) > hl + hw + 2 || Math.abs(car.z - pos.z) > hl + hw + 2) continue;
    const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
    for (let t = 0.3; t <= 1.3; t += 0.2) {
      const dx = pos.x + d.x * t - car.x, dz = pos.z + d.z * t - car.z;
      if (Math.abs(dx * s + dz * c) < hl + 0.15 && Math.abs(dx * c - dz * s) < hw + 0.15) return { car, hl, hw, s, c };
    }
  }
  return null;
}

/**
 * A vault or a climb from `pos` along `dir` (xz), when jumping at something:
 *   a car (or a scooter, a bike): up onto it and over, landing beyond its far side;
 *   a low wall, railing, crate (0.4-1.35 m): a quick vault;
 *   a higher one, up to 2.2 m: a slower climb over it, hands first.
 * The ground beyond has to be clear (within ~3 m). Returns the plan or null.
 */
export function findVault(world, pos, dir, { overCars = true } = {}) {
  const { terrain, veg, shots, cars } = world;
  const cols = veg?.colliders;
  const d = new THREE.Vector3(dir.x, 0, dir.z);
  if (d.lengthSq() < 1e-6) return null;
  d.normalize();
  const blocked = (x, z) => !!cols && cols.query(x, z, 0.5).some((c) => (c.box
    ? x > c.x0 - 0.25 && x < c.x1 + 0.25 && z > c.z0 - 0.25 && z < c.z1 + 0.25
    : Math.hypot(x - c.x, z - c.z) < (c.r || 0) + 0.25) && c.y1 > pos.y + 0.3 && c.y0 < pos.y + 2.4);
  const plan = (top, lx, lz, dist) => {
    const gy = terrain.heightAt(lx, lz);
    if (Math.abs(gy - pos.y) > 1.6) return null;
    const rise = top - pos.y;
    // a climb takes longer than a vault; a long one (across a car) longer again
    const dur = 0.36 + Math.max(0, rise) * (rise > 1.35 ? 0.38 : 0.18) + dist * 0.06;
    return { from: pos.clone(), to: new THREE.Vector3(lx, gy, lz), top, t: 0, dur, climb: rise > 1.35 };
  };

  // a car ahead: over it, landing just past the far side
  const hit = overCars ? carAhead(cars?.list, pos, d) : null;
  if (hit) {
    const { car, hl, hw, s, c } = hit;
    const top = carTop(car);
    if (top - pos.y > 2.4) return null;
    const inside = (x, z) => { const dx = x - car.x, dz = z - car.z; return Math.abs(dx * s + dz * c) < hl + 0.45 && Math.abs(dx * c - dz * s) < hw + 0.45; };
    for (let t = 0.6; t <= 5.6; t += 0.15) {
      const lx = pos.x + d.x * t, lz = pos.z + d.z * t;
      if (inside(lx, lz)) continue;
      if (blocked(lx, lz) || carAhead(cars.list, { x: lx - d.x * 0.3, z: lz - d.z * 0.3 }, d)?.car === car) return null;
      return plan(top, lx, lz, t);
    }
    return null;
  }

  // a wall, a railing, a crate: its real top from the shot geometry
  if (!cols || !shots) return null;
  const ax = pos.x + d.x * 0.7, az = pos.z + d.z * 0.7;
  if (!blocked(ax, az)) return null;
  const h = shots.raycast(new THREE.Vector3(ax, pos.y + 2.6, az), new THREE.Vector3(0, -1, 0), 2.6);
  if (!h) return null;
  const top = pos.y + 2.6 - h.t;
  const rise = top - pos.y;
  if (rise < 0.4 || rise > 2.2) return null;
  for (let t = 1.0; t <= 3.2; t += 0.2) {
    const lx = pos.x + d.x * t, lz = pos.z + d.z * t;
    if (blocked(lx, lz)) continue;
    return plan(top, lx, lz, t);
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
