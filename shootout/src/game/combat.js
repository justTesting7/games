import * as THREE from 'three';

export const MAX_HEALTH = 100;
const BODY_R = 0.25;
const HEAD_R = 0.14;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

// [from bone, to bone, radius m, zone]
const CAPSULES = [
  ['Hips', 'Spine2', 0.17, 'body'],
  ['Spine2', 'Neck', 0.17, 'body'],
  ['LeftArm', 'LeftForeArm', 0.055, 'limb'],
  ['LeftForeArm', 'LeftHand', 0.045, 'limb'],
  ['RightArm', 'RightForeArm', 0.055, 'limb'],
  ['RightForeArm', 'RightHand', 0.045, 'limb'],
  ['LeftUpLeg', 'LeftLeg', 0.085, 'limb'],
  ['LeftLeg', 'LeftFoot', 0.06, 'limb'],
  ['RightUpLeg', 'RightLeg', 0.085, 'limb'],
  ['RightLeg', 'RightFoot', 0.06, 'limb'],
];
export const LIMB_DAMAGE = 0.65;
const PUSH = { knife: 1.2, pistols: 1.8, rifle: 3, grenade: 6, drone: 6, car: 7 };

/** Distance along the unit ray o + t d to capsule a-b of radius r, or null (Inigo Quilez). */
export function rayCapsule(o, d, a, b, r) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const oax = o.x - a.x, oay = o.y - a.y, oaz = o.z - a.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const A = baba - bard * bard;
  let B = baba * rdoa - baoa * bard;
  let C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0 && A > 1e-12) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
  }
  // the rounded ends
  let best = null;
  for (const end of [0, 1]) {
    const ex = oax - bax * end, ey = oay - bay * end, ez = oaz - baz * end;
    B = d.x * ex + d.y * ey + d.z * ez;
    C = ex * ex + ey * ey + ez * ez - r * r;
    h = B * B - C;
    if (h > 0) { const t = -B - Math.sqrt(h); if (t > 0 && (best === null || t < best)) best = t; }
  }
  return best;
}

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
      if (f.alive || f.character?.ragdoll) f.character.bones.Head.getWorldPosition(f.head).y += f.alive ? 0.06 : 0;
    }
  }

  chest(f, out = new THREE.Vector3()) {
    const spine = f.character?.bones?.Spine2;
    if (spine) return spine.getWorldPosition(out);
    return out.copy(f.pos).setY(f.pos.y + 1.2);
  }

  // Bone capsules for each fighter, refreshed once per combat tick (the skeleton has
  // been posed by then): torso, arms and legs where they actually are, so arms held out
  // to aim, a kneeling player or a seated driver are hit where they are drawn.
  hitShape(f) {
    if (f.shapeT === this.time && f.shape) return f.shape;
    const B = f.character?.bones;
    const shape = f.shape || (f.shape = CAPSULES.map(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() })));
    f.shapeT = this.time;
    if (!B?.Hips) { shape.valid = false; return shape; }
    CAPSULES.forEach(([from, to], i) => {
      const bf = B[from], bt = B[to];
      if (!bf || !bt) { shape[i].r = 0; return; }
      bf.getWorldPosition(shape[i].a);
      bt.getWorldPosition(shape[i].b);
      shape[i].r = CAPSULES[i][2];
    });
    shape.valid = true;
    return shape;
  }

  // Bullets hit the bone capsules, or the head sphere; limb hits are marked.
  raycast(o, d, maxDist, ignore) {
    let best = null;
    for (const f of this.fighters) {
      const corpse = !f.alive && !!f.character?.ragdoll; // bodies stop rounds and take the hit
      if ((!f.alive && !corpse) || f === ignore) continue;
      // a corpse lies where its ragdoll is, not at its last standing position
      const cx = corpse ? f.character.bones.Hips.getWorldPosition(tmpB).x : f.pos.x;
      const cz = corpse ? tmpB.z : f.pos.z;
      const ox = o.x - cx, oz = o.z - cz;
      const along = -(ox * d.x + oz * d.z);
      if (along < -1.5 || along > maxDist + 1.5) continue;
      // cheap reject: the ray must pass within reach of the body's vertical axis
      const a2 = d.x * d.x + d.z * d.z;
      if (a2 > 1e-8) {
        const tc = Math.max(0, -(ox * d.x + oz * d.z) / a2);
        const cx = ox + d.x * tc, cz = oz + d.z * tc;
        if (cx * cx + cz * cz > 1.4 * 1.4) continue;
      }
      const hc = tmpA.subVectors(o, f.head);
      const hb = hc.dot(d);
      const hdisc = hb * hb - (hc.lengthSq() - HEAD_R * HEAD_R);
      if (hdisc > 0) {
        const t = -hb - Math.sqrt(hdisc);
        if (t > 0 && t < (best ? best.t : maxDist)) {
          const p = tmpB.copy(o).addScaledVector(d, t);
          best = { t, normal: p.sub(f.head).normalize().clone(), surface: 'flesh', fighter: f, head: true };
        }
      }
      const shape = this.hitShape(f);
      if (!shape.valid) continue;
      for (let i = 0; i < shape.length; i++) {
        const c = shape[i];
        if (!c.r) continue;
        const t = rayCapsule(o, d, c.a, c.b, c.r);
        if (t === null || t <= 0 || t >= (best ? best.t : maxDist)) continue;
        const p = new THREE.Vector3().copy(o).addScaledVector(d, t);
        // normal: away from the capsule's axis
        const ab = tmpA.subVectors(c.b, c.a);
        const k = THREE.MathUtils.clamp(tmpB.subVectors(p, c.a).dot(ab) / Math.max(ab.lengthSq(), 1e-8), 0, 1);
        const normal = p.clone().sub(tmpB.copy(c.a).addScaledVector(ab, k)).normalize();
        best = { t, normal, surface: 'flesh', fighter: f, head: false, limb: CAPSULES[i][3] === 'limb', part: CAPSULES[i][0] };
      }
    }
    return best;
  }

  // `info` is { head, weapon } and is passed on to the callbacks.
  damage(victim, attacker, amount, dir, info = {}) {
    if (!victim.alive || amount <= 0) return;
    victim.lastAttacker = attacker;
    victim.lastHitT = this.time;
    // the wound shows on the clothes; a rifle round leaves an exit wound too
    if (info.at && dir && !info.blast) {
      const part = info.head ? 'Head' : info.part;
      victim.character.stain?.(info.at, dir, part);
      if (info.weapon === 'rifle' && !info.head) victim.character.stain?.(info.at.clone().addScaledVector(dir, info.limb ? 0.1 : 0.28), dir, part, true);
    }
    const push = PUSH[info.weapon] ?? 2.5; // how hard the killing blow throws the body (m/s)
    if (info.head) {
      victim.health = 0;
      victim.alive = false;
      victim.character.die(dir, push * 0.8);
      if (attacker && attacker !== victim) attacker.kills++;
      this.onKill?.(victim, attacker, { ...info, head: true, dir });
      return;
    }
    victim.health = Math.max(0, victim.health - amount);
    if (victim.health <= 0) {
      victim.alive = false;
      victim.character.die(dir, push);
      if (attacker && attacker !== victim) attacker.kills++;
      this.onKill?.(victim, attacker, { ...info, dir });
    } else {
      victim.character.hitReact(dir, info.part);
      if (info.knock) (victim.knock || (victim.knock = new THREE.Vector3())).add(info.knock);
      this.onDamage?.(victim, attacker, amount, dir, info);
    }
  }

  // Blast damage falls off with distance and is mostly stopped by cover.
  explode(world, pos, radius, maxDamage, attacker, opts = {}) {
    const session = world.weapons?.session;
    const skipNet = opts.skipNet ?? !!session?.multi;
    const netHits = [];
    for (const f of this.fighters) {
      if (!f.alive) {
        // bodies get thrown by the blast too
        const rd = f.character?.ragdoll;
        if (rd) {
          const c = this.chest(f);
          const to = c.clone().sub(pos);
          const d = to.length();
          if (d < radius) rd.kick(c, to.normalize().multiplyScalar(9 * (1 - d / radius)).setY(4 * (1 - d / radius)));
        }
        continue;
      }
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
      const k = Math.pow(1 - d / radius, 1.4) * (covered ? 0.25 : 1);
      const networked = skipNet && (f.net || f.isPlayer);
      if (networked) {
        if (attacker?.isPlayer) {
          netHits.push({
            id: f.isPlayer ? (session?.net.id || f.id) : f.id,
            k,
            dir: [to.x, to.y, to.z],
            w: opts.weapon || 'grenade',
          });
        }
        continue;
      }
      // survivors are thrown back by the blast (the controllers take it as a velocity kick)
      const knock = to.clone().setY(0).normalize().multiplyScalar(7 * k).setY(2.5 * k);
      this.damage(f, attacker, Math.round(maxDamage * k), to, { weapon: opts.weapon || 'grenade', knock });
    }
    if (netHits.length) world.weapons?.session?.reportBlast(netHits, opts.weapon || 'grenade');
    // the blast also shoves cars and scooters and blows their windows in
    world.cars?.blast?.(pos, radius * 1.3, { report: !!attacker?.isPlayer });
    // and blows in the shop and office windows around it
    if (world.shots?.glassNear && world.studio?.root) {
      let n = 0;
      for (const tri of world.shots.glassNear(pos, radius * 1.4)) {
        const pane = world.shots.breakPane(tri, [world.studio.root]);
        if (pane && n++ < 8) world.fx?.shatter?.(pane.center, pane.size, pane.center.clone().sub(pos).normalize(), pane.center.clone().sub(pos).normalize());
      }
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
