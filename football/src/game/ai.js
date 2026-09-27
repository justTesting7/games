import * as THREE from 'three';
import { PITCH, GOAL } from '../world/dims.js';
import { groundPassSpeed } from './ball.js';

const HL = PITCH.halfLength, HW = PITCH.halfWidth;
const clamp = THREE.MathUtils.clamp;
const _v = new THREE.Vector3();

// Results are cached per simulation tick, keyed on match.time.
function cached(match, team, key, build) {
  const c = team._cache || (team._cache = {});
  if (c[key] && c[key].t === match.time) return c[key].v;
  const v = build();
  c[key] = { t: match.time, v };
  return v;
}

// Formation slots shifted as a block toward the ball, compressed when
// defending and stretched when attacking. Returns Map<player, Vector3>.
export function teamShape(match, team) {
  return cached(match, team, 'shape', () => {
    const m = team.m;
    const ball = match.ball.pos;
    const dir = team.dir;
    const bx = ball.x * dir / HL; // ball in team frame, -1..1
    const bz = ball.z * dir / HW;
    const attacking = match.owner?.team === team || match.pass?.team === team;
    const out = new Map();
    for (const p of team.players) {
      const d = p.def;
      if (p.role === 'GK') { out.set(p, team.toWorld(-0.96, 0)); continue; }
      let x = d.x, z = d.z;
      const push = attacking ? 0.36 + (m.counter ? 0.1 : 0) : 0.18;
      x += bx * push + (attacking ? 0.16 : -0.04) + m.line / HL;
      if (p.role === 'FWD') x = Math.max(x, bx - 0.05 + (attacking ? 0.12 : 0));
      if (p.role === 'DEF') x = Math.min(x, bx - 0.12);
      // Slide across with the ball; wide players tuck in when it's far side.
      const width = (attacking ? 1.08 : 0.78) * m.width;
      z = z * width + bz * (attacking ? 0.2 : 0.34);
      if (m.counter && !attacking && p.role === 'FWD') x = Math.max(x, -0.05);
      // Hold the offside line: nobody ahead of the last defender unless moving.
      x = clamp(x, -0.9, offsideLine(match, team) - 0.01);
      z = clamp(z, -0.94, 0.94);
      out.set(p, team.toWorld(x, z));
    }
    return out;
  });
}

// Second-last opponent in the team frame (normalised), for staying onside.
export function offsideLine(match, team) {
  const xs = team.opp.players.map((o) => o.pos.x * team.dir / HL).sort((a, b) => b - a);
  const ball = match.ball.pos.x * team.dir / HL;
  return Math.max(0, xs[1] ?? 0, ball);
}

// For each team, who gets to the loose/passed ball first, and where.
// Returns Map<player, { t, point, lead }>, with lead = fastest on his team.
export function chooseChasers(match, path) {
  const out = new Map();
  for (const team of match.teams) {
    const list = [];
    for (const p of team.players) {
      if (p.busy && !p.dive) continue;
      let best = null;
      for (const s of path) {
        if (s.pos.y > (p.role === 'GK' ? 2.4 : 2.2)) continue;
        const dx = s.pos.x - p.pos.x, dz = s.pos.z - p.pos.z;
        const d = Math.max(0, Math.hypot(dx, dz) - 0.5);
        const reachT = d / p.maxSpeed + 0.15;
        if (reachT <= s.t || s === path[path.length - 1]) {
          best = { t: Math.max(reachT, s.t), point: s.pos.clone() };
          break;
        }
      }
      if (best) list.push([p, best]);
    }
    list.sort((a, b) => a[1].t - b[1].t);
    // Pass receivers always attack their ball.
    const recv = match.pass?.team === team ? match.pass.to : null;
    list.forEach(([p, c], i) => {
      c.lead = recv ? p === recv : i === 0 && p.role !== 'GK' || i === 0 && p.role === 'GK' && match.inOwnBox(p, c.point);
      out.set(p, c);
    });
  }
  return out;
}

// Out of possession: one presser, one cover, zonal-man marking for the rest.
export function defendTargets(match, team, shape) {
  return cached(match, team, 'defend', () => {
    const out = new Map();
    const carrier = match.owner;
    if (!carrier) return out;
    const m = team.m;
    const goal = team.ownGoal;
    const outfield = team.players.filter((p) => p.role !== 'GK' && !p.busy);
    const byDist = outfield.slice().sort((a, b) => a.pos.distanceTo(carrier.pos) - b.pos.distanceTo(carrier.pos));
    const carrierX = carrier.pos.x * team.dir; // how far into our half (negative = our half)
    const dangerous = carrierX < -HL * 0.25;
    const pressRange = 18 + m.press * 22;
    const presser = byDist[0];
    const assigned = new Set();
    if (presser && (presser.pos.distanceTo(carrier.pos) < pressRange || dangerous)) {
      // Close down on the goal side of the carrier.
      const toGoal = _v.subVectors(goal, carrier.pos).setY(0).normalize();
      const pt = carrier.pos.clone().addScaledVector(toGoal, 0.9);
      if (carrier.speed > 1) pt.addScaledVector(carrier.vel, 0.25);
      out.set(presser, { point: pt, speed: presser.maxSpeed * (0.82 + m.press * 0.18), press: true });
      assigned.add(presser);
      const cover = byDist[1];
      if (cover) {
        const cp = carrier.pos.clone().addScaledVector(toGoal, 6);
        out.set(cover, { point: cp, speed: cover.maxSpeed * 0.8, press: cover.pos.distanceTo(carrier.pos) < 2.2 });
        assigned.add(cover);
      }
    }
    // Everyone else: mark the most dangerous nearby attacker in his zone.
    const threats = team.opp.players.filter((o) => o !== carrier && o.role !== 'GK')
      .map((o) => ({ o, danger: -o.pos.distanceTo(goal) }))
      .sort((a, b) => b.danger - a.danger);
    const taken = new Set();
    for (const p of outfield) {
      if (assigned.has(p)) continue;
      const home = shape.get(p);
      let best = null, bs = Infinity;
      for (const { o } of threats) {
        if (taken.has(o)) continue;
        const d = o.pos.distanceTo(home);
        if (d < 14 && d < bs) { bs = d; best = o; }
      }
      if (best && (p.role === 'DEF' || best.pos.distanceTo(goal) < 40)) {
        taken.add(best);
        // Goal side and ball side of the man.
        const side = _v.subVectors(goal, best.pos).setY(0).normalize().multiplyScalar(1.6);
        const bsd = new THREE.Vector3().subVectors(carrier.pos, best.pos).setY(0).normalize().multiplyScalar(0.8);
        const pt = best.pos.clone().add(side).add(bsd).lerp(home, p.role === 'DEF' ? 0.25 : 0.45);
        out.set(p, { point: pt, speed: pt.distanceTo(p.pos) > 5 ? 6.4 : 4.5, press: pt.distanceTo(carrier.pos) < 2 });
      } else out.set(p, { point: home, speed: home.distanceTo(p.pos) > 6 ? 6 : 4, press: false });
    }
    return out;
  });
}

// In possession: offer angles near the carrier and run in behind.
export function supportTargets(match, team, shape) {
  return cached(match, team, 'support', () => {
    const out = new Map();
    const c = match.owner || match.pass?.from;
    if (!c) return out;
    const goal = team.attackGoal;
    const line = offsideLine(match, team) * HL; // team frame metres
    const t = match.time;
    for (const p of team.players) {
      if (p === c || p.role === 'GK' || p.busy) continue;
      const home = shape.get(p);
      const pt = home.clone();
      const rel = _v.subVectors(p.pos, c.pos);
      const dist = rel.length();
      // Runs in behind: forwards and wide men peel off on a timer.
      const phase = (t * 0.23 + p.index * 0.37) % 1;
      const carrierX = c.pos.x * team.dir;
      const inRun = (p.role === 'FWD' || p.pos === 'LM' || p.pos === 'RM' || p.index === 6 && phase > 0.8) && phase > 0.55 && carrierX > -HL * 0.4;
      if (inRun) {
        const runX = Math.min(line + 8 + phase * 6, HL - 6);
        pt.x = runX * team.dir;
        pt.z = clamp(home.z * 0.8, -HW + 3, HW - 3);
        p.run = { t };
        out.set(p, { point: pt, speed: p.maxSpeed * 0.95 });
        continue;
      }
      p.run = null;
      // Offer a short angle when the carrier is under pressure.
      if (dist < 22 && (p.role === 'MID' || p.role === 'DEF')) {
        const pressure = match.pressureOn(c).dist < 3;
        if (pressure && dist < 16) {
          const ang = Math.atan2(rel.z, rel.x);
          pt.set(c.pos.x + Math.cos(ang) * 11, 0, c.pos.z + Math.sin(ang) * 11);
        }
      }
      // Stay onside unless on a timed run.
      const px = pt.x * team.dir;
      if (px > line - 0.5) pt.x = (line - 0.8) * team.dir;
      // Avoid standing in a passing shadow: nudge away from the nearest opponent.
      let near = null, nd = 4;
      for (const o of team.opp.players) {
        const d = o.pos.distanceTo(pt);
        if (d < nd) { nd = d; near = o; }
      }
      if (near) pt.addScaledVector(_v.subVectors(pt, near.pos).setY(0).normalize(), 4 - nd);
      pt.x = clamp(pt.x, -HL + 2, HL - 2);
      pt.z = clamp(pt.z, -HW + 1.5, HW - 1.5);
      if (goal.distanceTo(pt) < 6) pt.addScaledVector(_v.subVectors(pt, goal).setY(0).normalize(), 3);
      out.set(p, { point: pt, speed: pt.distanceTo(p.pos) > 8 ? 6.5 : 4.2 });
    }
    return out;
  });
}

// Keeper stands on the line bisecting the posts, a few metres off it, and
// comes out further when the ball is closer.
export function keeperTarget(match, k) {
  const team = k.team;
  const goal = team.ownGoal;
  const ball = match.ball.pos;
  const toBall = _v.subVectors(ball, goal).setY(0);
  const d = toBall.length();
  const off = clamp(1 + (40 - d) * 0.06, 0.8, 3.6);
  const out = goal.clone().addScaledVector(toBall.normalize(), d > 0.1 ? off : 1);
  out.z = clamp(out.z, -GOAL.halfWidth + 0.4, GOAL.halfWidth - 0.4);
  if (match.owner?.team === team && match.owner !== k) {
    out.x = goal.x + team.dir * clamp((ball.x * team.dir + HL) * 0.25, 2, 16);
    out.z = ball.z * 0.15;
  }
  out.y = 0;
  return out;
}

// ---------------------------------------------------------------- options

// Ranked, reasoned options for a ball carrier. Used both as Jev's candidate
// set and as the offline fallback. Each option carries a heuristic value.
export function carrierOptions(match, p) {
  const T = p.team;
  const goal = T.attackGoal;
  const opts = [];
  const distGoal = p.pos.distanceTo(goal);
  const pr = match.pressureOn(p);
  const ang = Math.abs(Math.atan2(p.pos.z, Math.abs(goal.x - p.pos.x)));
  const inRange = distGoal < 28 && ang < 1.1;
  const keeper = T.opp.keeper;
  // Shot quality: distance, angle, blockers in the cone.
  let blockers = 0;
  for (const o of T.opp.players) {
    if (o === keeper) continue;
    const a = _v.subVectors(o.pos, p.pos).setY(0);
    const g = new THREE.Vector3().subVectors(goal, p.pos).setY(0);
    const along = a.dot(g.normalize());
    if (along > 0 && along < distGoal) {
      const perp = Math.sqrt(Math.max(0, a.lengthSq() - along * along));
      if (perp < 1.2 + along * 0.08) blockers++;
    }
  }
  if (inRange) {
    const q = clamp(1.25 - distGoal / 24 - ang * 0.35 - blockers * 0.22 + p.def.shooting * 0.3, 0, 1);
    opts.push({ id: 'shoot', kind: 'shoot', value: q * 1.3 + (distGoal < 13 ? 0.35 : 0), text: `shoot at goal from ${Math.round(distGoal)} m${blockers ? `, ${blockers} defender${blockers > 1 ? 's' : ''} in the way` : ', clear sight of goal'}` });
  }
  const mates = T.players.filter((q) => q !== p && !q.busy);
  const passes = [];
  for (const q of mates) {
    const d = q.pos.distanceTo(p.pos);
    if (d < 5 || d > 50) continue;
    const lane = laneOpen(match, p.pos, q.pos);
    const open = match.openness(q);
    const gain = (q.pos.x - p.pos.x) * T.dir;
    const qGoal = q.pos.distanceTo(goal);
    let v = lane * 1.1 - (lane < 0.3 ? 0.6 : 0) + open * 0.35 + clamp(gain / 30, -0.5, 0.6) + (qGoal < 25 ? 0.25 : 0) - (q.role === 'GK' ? 0.8 : 0) - d * 0.006;
    const lofted = lane < 0.45 && d > 12;
    if (lofted) {
      // Defenders close in while the ball hangs in the air.
      const flight = 0.6 + d / 20;
      let md = Infinity;
      for (const o of T.opp.players) md = Math.min(md, o.pos.distanceTo(q.pos));
      const landing = clamp((md - 1.5 - flight * 2.5) / 5, 0, 1);
      v = landing * 0.9 - 0.2 + clamp(gain / 30, -0.5, 0.6) + (qGoal < 25 ? 0.2 : 0) - d * 0.006 - (q.role === 'GK' ? 0.8 : 0);
    }
    passes.push({ id: `pass_${q.number}`, kind: lofted ? 'lob' : 'pass', receiver: q, value: v * 0.9, text: `${lofted ? 'chip a lofted ball' : 'pass'} to ${q.name} (#${q.number}, ${q.slot}), ${Math.round(d)} m ${gain > 4 ? 'forward' : gain < -4 ? 'back' : 'square'}, ${open > 0.6 ? 'unmarked' : open > 0.25 ? 'loosely marked' : 'tightly marked'}` });
    if (q.run && gain > 6) {
      const runDir = q.vel.lengthSq() > 4 ? q.vel.clone().setY(0).normalize() : new THREE.Vector3().subVectors(goal, q.pos).setY(0).normalize();
      const spot = q.pos.clone().addScaledVector(runDir, 7 + q.speed * 0.6);
      const tl = laneOpen(match, p.pos, spot);
      const tv = tl * 0.9 - (tl < 0.3 ? 0.5 : 0) + open * 0.3 + clamp(gain / 25, 0, 0.8) + (qGoal < 30 ? 0.3 : 0) + p.def.passing * 0.2 - 0.3;
      passes.push({ id: `through_${q.number}`, kind: 'through', receiver: q, value: tv, text: `through ball into the path of ${q.name} (#${q.number}) running in behind` });
    }
  }
  passes.sort((a, b) => b.value - a.value);
  opts.push(...passes.slice(0, 4));
  const wide = Math.abs(p.pos.z) > HW - 18 && p.pos.x * T.dir > HL - 30;
  if (wide) {
    const inBox = T.players.filter((m) => m !== p && Math.abs(m.pos.x - goal.x) < 17 && Math.abs(m.pos.z) < 18).length;
    opts.push({ id: 'cross', kind: 'cross', value: 0.35 + inBox * 0.2, text: `whip a cross into the box (${inBox} teammate${inBox === 1 ? '' : 's'} there)` });
  }
  // Dribble: open space ahead?
  const fwd = new THREE.Vector3().subVectors(goal, p.pos).setY(0).normalize();
  const space = spaceAhead(match, p, fwd);
  opts.push({ id: 'dribble', kind: 'dribble', dir: fwd, value: clamp(space / 14, 0, 1) * 0.7 + p.def.pace * 0.2 - (pr.dist < 1.6 ? 0.3 : 0), text: `dribble forward toward goal (${space > 10 ? 'lots of space ahead' : space > 5 ? 'some space ahead' : 'crowded ahead'})` });
  const inOwnThird = p.pos.x * T.dir < -HL * 0.45;
  if (inOwnThird && pr.dist < 3) opts.push({ id: 'clear', kind: 'clear', value: 0.55 + (p.role === 'DEF' ? 0.2 : 0), text: 'clear the ball upfield to safety' });
  if (pr.dist < 2.5 && p.pos.x * T.dir > -10) opts.push({ id: 'shield', kind: 'shield', dir: fwd.clone().negate(), value: 0.2, text: 'shield the ball and hold it up' });
  opts.sort((a, b) => b.value - a.value);
  return opts;
}

// 1 when no defender can reach the ground-pass lane before the ball does,
// falling to 0 when one gets there comfortably first.
export function laneOpen(match, from, to) {
  const team = match.owner?.team;
  const opps = team ? team.opp.players : match.players;
  const ab = new THREE.Vector3().subVectors(to, from).setY(0);
  const len = ab.length();
  ab.divideScalar(len || 1);
  const v0 = groundPassSpeed(len, 6);
  const pt = new THREE.Vector3();
  let worst = 1;
  for (let x = 0.8; x < len - 0.8; x += 1.5) {
    // Rolling decelerates roughly linearly between v0 and the arrival speed.
    const v = v0 + (6 - v0) * (x / len);
    const ballT = 2 * x / (v0 + v);
    pt.copy(from).addScaledVector(ab, x);
    for (const o of opps) {
      const d = Math.max(0, Math.hypot(o.pos.x - pt.x, o.pos.z - pt.z) - 0.6);
      // From a near standstill: accelerate at ~6 m/s² up to top speed.
      const dAcc = o.maxSpeed * o.maxSpeed / 12.4;
      const reachT = 0.22 + (d < dAcc ? Math.sqrt(d / 3.1) : o.maxSpeed / 6.2 + (d - dAcc) / o.maxSpeed);
      worst = Math.min(worst, clamp((reachT - ballT + 0.05) / 0.35, 0, 1));
    }
  }
  return worst;
}

function spaceAhead(match, p, dir) {
  let min = 25;
  for (const o of p.team.opp.players) {
    const a = _v.subVectors(o.pos, p.pos).setY(0);
    const along = a.dot(dir);
    if (along < -0.5) continue;
    const perp = Math.sqrt(Math.max(0, a.lengthSq() - along * along));
    if (perp < 3 + along * 0.25) min = Math.min(min, Math.max(0, along));
  }
  return min;
}
