import * as THREE from 'three';

export const MAX_HEALTH = 100;
const BODY_R = 0.25;
const HEAD_R = 0.14;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

// Everyone who can shoot and be shot: the player and the rivals.
export class Combat {
  constructor() {
    this.fighters = [];
    this.onDamage = null;
    this.onKill = null;
    this.time = 0;
  }

  add({ id, name, character, pos, isPlayer = false, color = '#fff' }) {
    const f = {
      id, name, character, pos, isPlayer, color,
      health: MAX_HEALTH, alive: true, kills: 0,
      lastAttacker: null, lastHitT: -99, lastShotT: -99,
      head: new THREE.Vector3(),
    };
    this.fighters.push(f);
    return f;
  }

  reset(f) {
    f.health = MAX_HEALTH;
    f.alive = true;
    f.lastAttacker = null;
    f.lastHitT = -99;
    f.character.revive();
  }

  update(dt) {
    this.time += dt;
    for (const f of this.fighters) {
      if (f.alive) f.character.bones.Head.getWorldPosition(f.head).y += 0.06;
    }
  }

  chest(f, out = new THREE.Vector3()) {
    return out.copy(f.pos).setY(f.pos.y + 1.2);
  }

  // Bullets hit a vertical cylinder for the body and a sphere for the head.
  raycast(o, d, maxDist, ignore) {
    let best = null;
    for (const f of this.fighters) {
      if (!f.alive || f === ignore) continue;
      const ox = o.x - f.pos.x, oz = o.z - f.pos.z;
      const along = -(ox * d.x + oz * d.z);
      if (along < -1 || along > maxDist + 1) continue;
      const hc = tmpA.subVectors(o, f.head);
      const hb = hc.dot(d);
      const hcc = hc.lengthSq() - HEAD_R * HEAD_R;
      const hdisc = hb * hb - hcc;
      if (hdisc > 0) {
        const t = -hb - Math.sqrt(hdisc);
        if (t > 0 && t < (best ? best.t : maxDist)) {
          const p = tmpB.copy(o).addScaledVector(d, t);
          best = { t, normal: p.sub(f.head).normalize().clone(), surface: 'flesh', fighter: f, head: true };
        }
      }
      const a = d.x * d.x + d.z * d.z;
      if (a < 1e-8) continue;
      const b = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - BODY_R * BODY_R;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t <= 0 || t >= (best ? best.t : maxDist)) continue;
      const y = o.y + d.y * t - f.pos.y;
      if (y < 0.05 || y > f.head.y - f.pos.y - HEAD_R * 0.6) continue;
      const normal = new THREE.Vector3(ox + d.x * t, 0, oz + d.z * t).normalize();
      best = { t, normal, surface: 'flesh', fighter: f, head: false };
    }
    return best;
  }

  // `info` is { head, weapon } and is passed on to the callbacks.
  damage(victim, attacker, amount, dir, info = {}) {
    if (!victim.alive || amount <= 0) return;
    victim.lastAttacker = attacker;
    victim.lastHitT = this.time;
    if (info.head) {
      victim.health = 0;
      victim.alive = false;
      victim.character.die(dir);
      if (attacker && attacker !== victim) attacker.kills++;
      this.onKill?.(victim, attacker, { ...info, head: true });
      return;
    }
    victim.health = Math.max(0, victim.health - amount);
    if (victim.health <= 0) {
      victim.alive = false;
      victim.character.die(dir);
      if (attacker && attacker !== victim) attacker.kills++;
      this.onKill?.(victim, attacker, info);
    } else {
      victim.character.hitReact(dir);
      this.onDamage?.(victim, attacker, amount, dir, info);
    }
  }

  // Blast damage falls off with distance and is mostly stopped by cover.
  explode(world, pos, radius, maxDamage, attacker) {
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const c = this.chest(f);
      const to = c.clone().sub(pos);
      const d = to.length();
      if (d > radius) continue;
      to.divideScalar(d || 1);
      const from = pos.clone().addScaledVector(to, 0.05).setY(pos.y + 0.15);
      const dir = c.clone().sub(from);
      const len = dir.length();
      dir.divideScalar(len || 1);
      const hit = world.raycast(from, dir, len, null);
      const covered = hit && !hit.fighter && hit.t < len - 0.3;
      const k = Math.pow(1 - d / radius, 1.4);
      this.damage(f, attacker, Math.round(maxDamage * k * (covered ? 0.25 : 1)), to, { weapon: 'grenade' });
    }
  }

  // Whether `f` is currently pointing its guns at `other`.
  aimingAt(f, other) {
    const ch = f.character;
    if (!f.alive || ch.aimWeight < 0.5) return false;
    const to = this.chest(other, tmpA).sub(ch.bones.Spine2.getWorldPosition(tmpB)).normalize();
    return to.dot(ch.aimDir) > 0.985;
  }

  alive() { return this.fighters.filter((f) => f.alive); }
}
