import * as THREE from 'three';
import { PITCH, GOAL } from '../world/dims.js';
import { groundPassSpeed, rollTime } from './ball.js';

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
      if (attacking) {
        // Higher than the ball, but close enough that a pass can still arrive.
        // The station lifts a deep team into the opponent half; the cap stops
        // the target being a point that runs away up the pitch.
        x += bx * 0.4 + 0.1 + m.line / HL;
        const wide = d.pos === 'LM' || d.pos === 'RM';
        const full = d.pos === 'LB' || d.pos === 'RB';
        // Strikers live in the final third so a call is a ball into the box,
        // not another pass in midfield. The cap still keeps the run reachable.
        const lead = p.role === 'FWD' ? 0.32 : wide ? 0.14 : d.pos === 'CM' ? 0.02 : full ? -0.04 : -0.16;
        const station = p.role === 'FWD' ? 0.4 : wide ? 0.18 : d.pos === 'CM' ? 0.0 : full ? -0.08 : -0.24;
        const cap = bx + (p.role === 'FWD' ? 0.52 : wide ? 0.38 : p.role === 'DEF' ? 0.1 : 0.28);
        const depth = Math.min(Math.max(bx + lead, station), cap);
        x = clamp(Math.max(x, depth), -0.88, 0.9);
      } else {
        // Ball lost: sprint onto a compact line just goalside of it.
        // Too deep and the next attack starts from the penalty box.
        const drop = p.role === 'FWD' ? 0.02 : p.role === 'MID' ? 0.08 : (d.pos === 'LB' || d.pos === 'RB' ? 0.12 : 0.18);
        x = clamp(bx - drop, -0.88, Math.min(offsideLine(match, team), bx - 0.01));
      }
      const width = (attacking ? 1.18 : 0.7) * m.width;
      z = z * width + bz * (attacking ? 0.08 : 0.3);
      z = clamp(z, -0.94, 0.94);
      out.set(p, team.toWorld(x, z));
    }
    return out;
  });
}

// Second-last opponent in the team frame (normalised). Level with him, or
// with the ball, is onside. Own half is always onside.
export function offsideLine(match, team) {
  const xs = team.opp.players.map((o) => o.pos.x * team.dir / HL).sort((a, b) => b - a);
  const ball = match.ball.pos.x * team.dir / HL;
  return Math.max(0, xs[1] ?? 0, ball);
}

// Furthest team-frame metres a player can stand and still be onside.
export function onsideMax(match, team) {
  const dir = team.dir;
  const xs = team.opp.players.map((o) => o.pos.x * dir).sort((a, b) => b - a);
  const second = xs[1] ?? xs[0] ?? 0;
  const ball = match.ball.pos.x * dir;
  return Math.max(second, ball) - 0.55;
}

export function playerOffside(match, p) {
  if (!p || p.role === 'GK') return false;
  const dir = p.team.dir;
  const x = p.pos.x * dir;
  if (x <= 0.05) return false;
  const xs = p.team.opp.players.map((o) => o.pos.x * dir).sort((a, b) => b - a);
  const second = xs[1] ?? xs[0] ?? -HL;
  const ball = match.ball.pos.x * dir;
  return x > second + 0.12 && x > ball + 0.12;
}

// Through on goal: every outfield opponent is behind him. The keeper is still to beat.
export function aheadOfEveryone(match, p) {
  if (!p || p.role === 'GK') return false;
  const dir = p.team.dir;
  const x = p.pos.x * dir;
  for (const o of p.team.opp.players) {
    if (o.role === 'GK') continue;
    if (o.pos.x * dir > x + 0.4) return false;
  }
  return true;
}

// A run in behind is an advantage when this player reaches the spot before
// every outfield defender. The spot is in a gap, just beyond the offside line.
function bestAdvantage(match, p, passer) {
  if (playerOffside(match, p)) return null;
  const dir = p.team.dir;
  const max = onsideMax(match, p.team);
  const px = p.pos.x * dir;
  if (px > max + 0.2) return null;
  const opps = p.team.opp.players.filter((o) => o.role !== 'GK');
  if (!opps.length) return null;
  const line = opps.map((o) => o.pos.z).sort((a, b) => a - b);
  const lanes = [clamp(p.pos.z, -16, 16)];
  const side = Math.sign(p.pos.z || p.def?.z || 1);
  lanes.push(clamp(p.pos.z + side * 6, -16, 16));
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i + 1] - line[i] < 5) continue;
    const z = (line[i] + line[i + 1]) * 0.5;
    if (Math.abs(z - p.pos.z) <= 16) lanes.push(clamp(z, -16, 16));
  }
  let best = null;
  for (const z of lanes) {
    for (const depth of [4.5, 8]) {
      const spot = new THREE.Vector3(clamp((max + depth) * dir, -HL + 2, HL - 5.5), 0, z);
      if ((spot.x - p.pos.x) * dir < 3) continue;
      if (passer && (spot.x - passer.pos.x) * dir < 2) continue;
      const mine = timeToReach(p, spot);
      let theirs = 99;
      for (const o of opps) theirs = Math.min(theirs, timeToReach(o, spot));
      const margin = theirs - mine;
      const live = p.run && match.time - p.run.t < 0.45;
      if (margin < (live ? 0.04 : 0.12)) continue;
      let score = margin;
      if (passer) {
        const w = callWindow(match, passer.pos, p, spot);
        if (Number.isFinite(w.flight) && w.recvLate < 0.55) score += 0.4 + Math.max(0, w.margin);
      }
      if (!best || score > best.score) best = { spot, margin, score };
    }
  }
  return best;
}

// Pull a run back onto the line. Returns the speed to use so he does not
// sprint through it and get flagged.
function holdOnside(match, team, p, pt, speed) {
  const dir = team.dir;
  const max = onsideMax(match, team);
  if (pt.x * dir > max) pt.x = max * dir;
  const x = p.pos.x * dir;
  if (x > max + 0.15) return p.maxSpeed;
  // Arrive on the shoulder at pace. Only check the stride that would cross the line.
  if (x > max - 0.85) return Math.min(speed, 4.2);
  return speed;
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
        const caught = cover.pos.x * team.dir > carrier.pos.x * team.dir + 2;
        out.set(cover, { point: cp, speed: caught ? cover.maxSpeed : cover.maxSpeed * 0.85, press: cover.pos.distanceTo(carrier.pos) < 2.2 });
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
      const ballX = carrier.pos.x * team.dir;
      const px = p.pos.x * team.dir;
      // Still ahead of the ball: forget the man and sprint back onto the line.
      const recovering = px > ballX - 1;
      if (best && !recovering && (p.role === 'DEF' || best.pos.distanceTo(goal) < 40)) {
        taken.add(best);
        // Goal side and ball side of the man.
        const side = _v.subVectors(goal, best.pos).setY(0).normalize().multiplyScalar(1.6);
        const bsd = new THREE.Vector3().subVectors(carrier.pos, best.pos).setY(0).normalize().multiplyScalar(0.8);
        const pt = best.pos.clone().add(side).add(bsd).lerp(home, p.role === 'DEF' ? 0.35 : 0.55);
        if (pt.x * team.dir > home.x * team.dir) pt.x = home.x;
        const speed = px > ballX - 4 || pt.distanceTo(p.pos) > 7 ? p.maxSpeed : 5;
        out.set(p, { point: pt, speed, press: pt.distanceTo(carrier.pos) < 2 });
      } else {
        const pt = home.clone();
        const speed = recovering || pt.distanceTo(p.pos) > 5 ? p.maxSpeed : 4.8;
        out.set(p, { point: pt, speed, press: false });
      }
    }
    return out;
  });
}

// In possession the team holds its shape. Anyone who can reach a gap in
// behind before a defender runs at it and calls for the through pass.
export function supportTargets(match, team, shape) {
  return cached(match, team, 'support', () => {
    const out = new Map();
    const carrier = match.owner?.team === team ? match.owner : null;
    const ourPass = match.pass?.team === team ? match.pass : null;
    const c = carrier || ourPass?.from;
    if (!c) return out;
    const dir = team.dir;
    const mates = team.players.filter((p) => p !== c && p !== ourPass?.to && p.role !== 'GK' && !p.busy);
    // Anyone off the ball can run, but only into a gap he reaches first. The best three go.
    const chasing = new Map();
    const ranked = [];
    for (const p of mates) {
      const dp0 = match.doublePass;
      if (dp0 && dp0.runner === p && dp0.team === team && match.time < dp0.until && !dp0.returned) continue;
      const run = bestAdvantage(match, p, c);
      if (run) ranked.push([p, run]);
    }
    ranked.sort((a, b) => b[1].score - a[1].score);
    for (const [p, run] of ranked.slice(0, 3)) chasing.set(p, run);

    for (const p of mates) {
      const home = shape.get(p);
      const pt = home.clone();
      const px = p.pos.x * dir;
      const dp = match.doublePass;
      if (dp && dp.runner === p && dp.team === team && match.time < dp.until && !dp.returned) {
        // He has already played the first ball. The run stops on the offside line
        // until the return is struck, then he can go past it.
        pt.x = clamp(p.pos.x + dir * 12, -HL + 2, HL - 2);
        pt.z = clamp(p.pos.z, -HW + 2, HW - 2);
        p.call = null;
        p.run = { t: match.time };
        const speed = holdOnside(match, team, p, pt, p.maxSpeed);
        out.set(p, { point: pt, speed });
        continue;
      }
      const run = chasing.get(p);
      if (run) {
        // Sprint at the gap. Feet stay onside until the through ball is played.
        pt.copy(run.spot);
        if (c && !playerOffside(match, p)) {
          const w = callWindow(match, c.pos, p, run.spot);
          const gain = (run.spot.x - c.pos.x) * dir;
          if (Number.isFinite(w.flight) && w.margin >= 0.08 && w.recvLate < 0.4 && gain > 1) {
            p.call = { spot: run.spot.clone(), until: match.time + 0.9 };
          } else p.call = null;
        } else p.call = null;
        p.run = { t: match.time };
        const speed = holdOnside(match, team, p, pt, p.maxSpeed);
        out.set(p, { point: pt, speed });
        continue;
      }
      p.call = null;
      p.run = null;
      pt.x = clamp(pt.x, -HL + 1.5, HL - 1.5);
      pt.z = clamp(pt.z, -HW + 1.5, HW - 1.5);
      const short = pt.x * dir - px;
      const gap = pt.distanceTo(p.pos);
      // Sprint only while a long way short of the line, then jog onto the pass.
      let speed = short > 8 || gap > 14
        ? p.maxSpeed * 0.92
        : gap > 4 ? 4.8 : 3.2;
      speed = holdOnside(match, team, p, pt, speed);
      out.set(p, { point: pt, speed });
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
  const inRange = distGoal < 32 && ang < 1.2;
  const corner = openCorner(T, p.pos);
  const blockers = corner.blockers;
  const alone = aheadOfEveryone(match, p);
  const fwdDir = new THREE.Vector3().subVectors(goal, p.pos).setY(0).normalize();
  if (inRange) {
    const q = clamp(1.25 - distGoal / 24 - ang * 0.35 - blockers * 0.22 + p.def.shooting * 0.3, 0, 1);
    let value = q * 1.15 + (distGoal < 16 ? 0.35 : 0);
    // A finish is only listed when the open corner is actually free. That is
    // the shot CARRIER_INSTRUCTIONS tells him to take.
    const inBox = distGoal < 16.5 && ang < 1.1 && corner.open;
    const clearSight = distGoal < 22 && ang < 0.8 && corner.open;
    const breakaway = alone && distGoal < 18 && ang < 1.1;
    let finish = null;
    let text = `shoot at goal from ${Math.round(distGoal)} m${blockers ? `, ${blockers} defender${blockers > 1 ? 's' : ''} in the way` : corner.covered ? ', keeper is covering the near corner' : ', clear sight of goal'}`;
    if (breakaway) {
      finish = 'break';
      value = Math.max(value, 2.4);
      text = `you are ahead of every defender, ${Math.round(distGoal)} m from goal. Shoot. Do not pass`;
    } else if (inBox) {
      finish = 'box';
      value = Math.max(value, 2);
      text = `shot from inside the penalty area into the open corner, ${Math.round(distGoal)} m out. Nobody is in the way and the keeper is not covering it. Finish it`;
    } else if (clearSight) {
      finish = 'sight';
      value = Math.max(value, 1.9);
      text = `clear sight of goal from ${Math.round(distGoal)} m into the open corner, inside 22 m. Finish it`;
    } else if (blockers === 0 && ang < 0.55 && distGoal < 32) value = Math.max(value, 1.4);
    else if (distGoal < 18 && blockers <= 1 && ang < 0.9) value = Math.max(value, 1.55);
    else if (distGoal < 13 && blockers <= 2) value = Math.max(value, 1.35);
    opts.push({ id: 'shoot', kind: 'shoot', finish, aimZ: finish ? corner.aimZ : null, alone: breakaway, value, text });
  }
  // Past the defence: run at goal. There is no pass to choose.
  if (alone && !opts.some((o) => o.finish === 'break')) {
    opts.push({
      id: 'dribble', kind: 'dribble', alone: true, dir: fwdDir, value: 2.3,
      text: `you are ahead of every defender. Run at goal and score. Do not pass`,
    });
    opts.sort((a, b) => b.value - a.value);
    return opts;
  }
  if (alone) {
    opts.sort((a, b) => b.value - a.value);
    return opts;
  }
  const mates = T.players.filter((q) => q !== p && !q.busy);
  const passes = [];
  const attThird = p.pos.x * T.dir > HL * 0.05;
  for (const q of mates) {
    const d = q.pos.distanceTo(p.pos);
    if (d < 5 || d > 48) continue;
    const open = match.openness(q);
    const gain = (q.pos.x - p.pos.x) * T.dir;
    const w = passWindow(match, p.pos, q);
    const toward = _v.subVectors(p.pos, q.pos).setY(0);
    const towardLen = toward.length() || 1;
    const coming = q.vel.dot(toward) / towardLen;
    const spinning = q.speed > 6.2 && coming < 0.2;
    let v = -1;
    if (w.margin >= 0.12 && w.recvLate < 0.25 && Number.isFinite(w.flight)) {
      v = 0.32 + clamp(w.margin, 0, 0.7) * 1.05 + open * 0.32 + clamp(gain / 28, -0.2, 0.42);
      if (w.dist > 6 && w.dist < 17) v += 0.32;
      else if (w.dist > 28) v -= 0.35;
      if (q.role === 'GK') v -= 0.75;
      if (gain > 5) v += 0.24;
      if (attThird && gain > 6) v += 0.28;
      if (gain < -4 && pr.dist > 3.5) v -= 0.35;
      const inBox = Math.abs(w.spot.x - goal.x) < 18 && Math.abs(w.spot.z) < 18;
      if (inBox && gain > 0) v += 0.45;
      if (q.run && w.margin > 0.18) v += 0.15;
      // Still sprinting away from the passer: the ball arrives at empty feet.
      if (spinning) v = -1;
    }
    const kind = w.margin < 0.12 && open > 0.6 && d > 16 && gain > 2 && !spinning ? 'lob' : 'pass';
    if (kind === 'lob') v = open * 0.55 + clamp(gain / 32, 0, 0.3) + (attThird ? 0.1 : 0) - 0.2;
    const passBox = spotInBox(goal, w.spot) && gain > 2 && v > 0.45;
    const off = playerOffside(match, q);
    passes.push({
      id: `pass_${q.number}`, kind, receiver: q, dist: Math.round(d), gain, value: off ? -1 : v, intoBox: passBox && !off, offside: off,
      text: `${kind === 'lob' ? 'chip a lofted ball' : 'pass'} to ${q.name} (#${q.number}, ${q.slot}), ${Math.round(d)} m ${gain > 4 ? 'forward' : gain < -4 ? 'back' : 'square'}, ${open > 0.6 ? 'unmarked' : open > 0.25 ? 'loosely marked' : 'tightly marked'}${passBox ? '. This puts him in the penalty area' : ''}${off ? '. He is offside. Do not pass to him' : ''}`,
    });
    const goingOn = q.vel.x * T.dir > 2.2;
    if ((q.run || goingOn) && gain > 2) {
      const tw = throughWindow(match, p.pos, q);
      let tv = -1;
      if (tw.margin >= 0.1 && tw.recvLate < 0.35 && Number.isFinite(tw.flight)) {
        tv = 0.55 + clamp(tw.margin, 0, 0.8) * 0.9 + (attThird ? 0.4 : 0.1);
        if (Math.abs(tw.spot.x - goal.x) < 20) tv += 0.25;
      }
      const throughBox = spotInBox(goal, tw.spot) && tv > 0.45;
      const offRun = playerOffside(match, q);
      passes.push({
        id: `through_${q.number}`, kind: 'through', receiver: q, dist: Math.round(tw.dist), gain, value: offRun ? -1 : tv, intoBox: throughBox && !offRun, offside: offRun,
        text: `through pass into the path of ${q.name} (#${q.number}), who is running in behind. The through pass is on${throughBox ? ' and puts him in the penalty area' : ''}. Play it${offRun ? '. He is offside. Do not pass to him' : ''}`,
      });
    }
  }
  let bestForward = -1;
  for (const o of passes) if (o.gain > 1 && o.value > bestForward) bestForward = o.value;
  const space = spaceAhead(match, p, fwdDir);
  const inOwnThird = p.pos.x * T.dir < -HL * 0.45;
  // A double pass needs a teammate close enough to play off, and room to run past him.
  const dp = match.doublePass;
  // A one-two is for breaking a line. Inside the area the touch is a finish.
  if (!(dp && dp.wall === p) && p.role !== 'GK' && space >= 4 && distGoal >= 16.5) {
    let wall = null, wallScore = -1, wallGain = 0;
    for (const q of mates) {
      if (q.role === 'GK') continue;
      const d = q.pos.distanceTo(p.pos);
      if (d < 6 || d > 16) continue;
      const gain = (q.pos.x - p.pos.x) * T.dir;
      if (gain < -8) continue;
      const w = passWindow(match, p.pos, q);
      const toward = _v.subVectors(p.pos, q.pos).setY(0);
      const coming = q.vel.dot(toward) / (toward.length() || 1);
      const spinning = q.speed > 6.2 && coming < 0.2;
      if (spinning || w.margin < 0.1 || w.recvLate > 0.25 || !Number.isFinite(w.flight)) continue;
      const score = w.margin + match.openness(q) * 0.35;
      if (score > wallScore) { wallScore = score; wall = q; wallGain = gain; }
    }
    if (wall) {
      const off = playerOffside(match, wall);
      opts.push({
        id: `double_${wall.number}`,
        kind: 'pass',
        combo: 'double',
        receiver: wall,
        dist: Math.round(wall.pos.distanceTo(p.pos)),
        gain: wallGain,
        value: off ? -1 : 1.4,
        offside: off,
        text: `double pass with ${wall.name} (#${wall.number}, ${wall.slot}): play it to his feet and sprint past him. He returns it first time into the space you are running into${off ? '. He is offside. Do not pass to him' : ''}`,
      });
    }
  }
  if (dp && dp.wall === p && match.time < dp.until && dp.runner && !dp.runner.busy) {
    const w = doubleReturnWindow(match, p.pos, dp.runner);
    if (w.margin >= -0.04 && w.recvLate < 0.45 && Number.isFinite(w.flight)) {
      const off = playerOffside(match, dp.runner);
      opts.push({
        id: 'double_return',
        kind: 'through',
        combo: 'return',
        receiver: dp.runner,
        dist: Math.round(w.dist),
        gain: (w.spot.x - p.pos.x) * T.dir,
        value: off ? -1 : 1.85,
        offside: off,
        text: `double pass return: first-time ball into the space ${dp.runner.name} (#${dp.runner.number}) is sprinting into, about ${Math.round(w.dist)} m${off ? '. He is offside. Do not pass to him' : ''}`,
      });
    }
  }
  for (const q of mates) {
    const call = q.call;
    if (!call?.spot || match.time > call.until) continue;
    const w = callWindow(match, p.pos, q, call.spot);
    const gain = (call.spot.x - p.pos.x) * T.dir;
    const gap = q.pos.distanceTo(call.spot);
    if (!Number.isFinite(w.flight) || w.recvLate > 0.45 || w.margin < -0.08 || gain < 0) continue;
    const off = playerOffside(match, q);
    const sensible = !off && w.margin >= 0.1 && w.recvLate < 0.35 && gain > 1;
    const where = describeSpot(T, call.spot);
    const inArea = spotInBox(goal, call.spot);
    const verdict = sensible
      ? `he reaches it ${w.margin.toFixed(1)} s before a defender`
      : `a defender gets there first`;
    opts.push({
      id: `call_${q.number}`,
      kind: 'through',
      call: true,
      sensible,
      offside: off,
      receiver: q,
      spot: call.spot.clone(),
      dist: Math.round(w.dist),
      gain,
      value: off ? -1 : sensible ? 1.45 + clamp(w.margin, 0, 0.4) + (inArea ? 0.2 : 0) : 0.05,
      text: `${q.name} (#${q.number}) is running and calling for the ball ${where}. He is ${Math.round(gap)} m from that spot. ${off ? 'He is offside. Do not pass to him' : sensible ? `${verdict}. Play the through pass into that call.` : `${verdict}. Do not play it.`}`,
    });
  }
  passes.sort((a, b) => b.value - a.value);
  const throughs = passes.filter((o) => o.kind === 'through' && o.value > 0.15);
  const feet = passes.filter((o) => o.kind !== 'through');
  opts.push(...throughs, ...feet.slice(0, 4));
  const wide = Math.abs(p.pos.z) > HW - 18 && p.pos.x * T.dir > HL - 30;
  if (wide) {
    const inBox = T.players.filter((m) => m !== p && Math.abs(m.pos.x - goal.x) < 17 && Math.abs(m.pos.z) < 18).length;
    opts.push({ id: 'cross', kind: 'cross', boxMates: inBox, value: 0.55 + inBox * 0.25, text: `cross from wide with ${inBox} teammate${inBox === 1 ? '' : 's'} in the box` });
  }
  // Dribble: open space ahead?
  let dribbleValue = clamp(space / 14, 0, 1) * 0.55 + p.def.pace * 0.12 - (pr.dist < 2 ? 0.35 : 0);
  if (space > 6 && pr.dist > 2.5) dribbleValue += 0.28;
  if (distGoal < 24 && space > 9 && blockers === 0) dribbleValue += 0.25;
  opts.push({ id: 'dribble', kind: 'dribble', dir: fwdDir, value: dribbleValue, text: `dribble forward toward goal (${space > 10 ? 'lots of space ahead' : space > 5 ? 'some space ahead' : 'crowded ahead'})` });
  if (inOwnThird && pr.dist < 3 && bestForward <= 0) opts.push({ id: 'clear', kind: 'clear', value: 0.55 + (p.role === 'DEF' ? 0.2 : 0), text: 'clear the ball upfield to safety' });
  if (pr.dist < 2.5 && p.pos.x * T.dir > -10) opts.push({ id: 'shield', kind: 'shield', dir: fwdDir.clone().negate(), value: 0.2, text: 'shield the ball and hold it up' });
  opts.sort((a, b) => b.value - a.value);
  return opts;
}

// Arrival speed for a ground pass played to feet. Firm enough that a free
// man is reached before a defender covering from several metres away.
export function passArrive(dist) {
  return clamp(8.8 + dist * 0.14, 9.4, 13.2);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// Where a ground pass should arrive: just in front of the receiver, so he
// steps onto it. A runner spinning away is not led — that pass is a through ball.
function feetSpot(from, receiver) {
  const spot = _a.copy(receiver.pos).setY(0);
  const back = _b.subVectors(from, spot).setY(0);
  const gap = back.length();
  if (gap > 0.8) {
    back.multiplyScalar(1 / gap);
    spot.addScaledVector(back, clamp(gap * 0.07, 0.35, 1.35));
  }
  if (receiver.speed > 2 && back.dot(receiver.vel) > 0) {
    const vel = _c.copy(receiver.vel).setY(0);
    if (vel.lengthSq() > 0.04) spot.addScaledVector(vel.normalize(), Math.min(1.3, receiver.speed * 0.22));
  }
  spot.x = clamp(spot.x, -HL + 1.2, HL - 1.2);
  spot.z = clamp(spot.z, -HW + 1.2, HW - 1.2);
  return spot.clone();
}

function throughSpot(receiver) {
  const team = receiver.team;
  const runDir = receiver.vel.lengthSq() > 9
    ? _c.copy(receiver.vel).setY(0).normalize()
    : _c.subVectors(team.attackGoal, receiver.pos).setY(0).normalize();
  const lead = clamp(3.2 + receiver.speed * 0.28, 3.2, 5.6);
  const spot = _a.copy(receiver.pos).addScaledVector(runDir, lead).setY(0);
  spot.x = clamp(spot.x, -HL + 1.2, HL - 1.2);
  spot.z = clamp(spot.z, -HW + 1.2, HW - 1.2);
  return spot.clone();
}

// How late the first defender is, in seconds, at the points that matter.
// Positive means the ball gets there first.
function marginAlong(match, from, spot, arrive, team, receiver) {
  const ab = _a.subVectors(spot, from).setY(0);
  const dist = Math.max(1.2, ab.length());
  ab.multiplyScalar(1 / (ab.length() || 1));
  const v0 = groundPassSpeed(dist, arrive);
  const flight = rollTime(v0, dist);
  const opps = team ? team.opp.players : [];
  let margin = 5;
  const fracs = dist > 18 ? [0.5, 0.78, 1] : [0.72, 1];
  for (const f of fracs) {
    const x = dist * f;
    const v = v0 + (arrive - v0) * f;
    const ballT = 2 * x / Math.max(0.4, v0 + v);
    _b.copy(from).addScaledVector(ab, x).setY(0);
    for (const o of opps) margin = Math.min(margin, timeToReach(o, _b) - ballT);
  }
  const flightT = Number.isFinite(flight) ? flight : 4;
  const recvLate = receiver ? timeToReach(receiver, spot) - flightT : 0;
  return { spot: spot.clone(), arrive, dist, flight, margin, recvLate, v0 };
}

// Ground pass to a teammate's feet, and the same numbers the kick uses.
export function passWindow(match, from, receiver) {
  const spot = feetSpot(from, receiver);
  const dist = Math.max(1.2, spot.distanceTo(from));
  return marginAlong(match, from, spot, passArrive(dist), receiver.team, receiver);
}

// Firm ball into the space a runner is already moving toward.
// The corner furthest from the keeper, and whether a shot there is free.
export function openCorner(team, from) {
  const goal = team.attackGoal;
  const keeper = team.opp.keeper;
  const near = GOAL.halfWidth - 0.45;
  const posts = [-near, near];
  const aimZ = posts.reduce((best, z) => Math.abs(z - keeper.pos.z) > Math.abs(best - keeper.pos.z) ? z : best);
  const aim = _b.set(goal.x, 0, aimZ);
  const dist = Math.max(1, Math.hypot(goal.x - from.x, goal.z - from.z));
  let blockers = 0;
  const gx = aim.x - from.x, gz = aim.z - from.z;
  const glen = Math.hypot(gx, gz) || 1;
  const ux = gx / glen, uz = gz / glen;
  for (const o of team.opp.players) {
    if (o.role === 'GK') continue;
    const ax = o.pos.x - from.x, az = o.pos.z - from.z;
    const along = ax * ux + az * uz;
    if (along > 0.5 && along < dist) {
      const perp = Math.sqrt(Math.max(0, ax * ax + az * az - along * along));
      if (perp < 0.65 + along * 0.035) blockers++;
    }
  }
  const covered = Math.abs(keeper.pos.z - aimZ) < 1.4;
  return { aimZ, blockers, covered, open: blockers === 0 && !covered };
}

function spotInBox(goal, spot) {
  return !!spot && Math.abs(spot.x - goal.x) < 16.5 && Math.abs(spot.z) < 20.5;
}

function describeSpot(team, spot) {
  const dg = Math.round(spot.distanceTo(team.attackGoal));
  const side = Math.abs(spot.z) < 8 ? 'central' : spot.z > 0 ? 'on the right' : 'on the left';
  return `${dg} m from goal, ${side}`;
}

// Broadcasts from teammates running onto a spot. The carrier's decision reads these.
export function ballCalls(match, carrier) {
  const out = [];
  for (const q of carrier.team.players) {
    if (q === carrier || !q.call?.spot || match.time > q.call.until) continue;
    const w = callWindow(match, carrier.pos, q, q.call.spot);
    const gap = Math.round(q.pos.distanceTo(q.call.spot));
    const where = describeSpot(q.team, q.call.spot);
    const on = w.margin >= 0.1 && w.recvLate < 0.35;
    const verdict = on
      ? `he reaches it ${w.margin.toFixed(1)} s before a defender. Play the through pass`
      : `a defender gets there first`;
    out.push(`${q.name} (#${q.number}) is running and calling for the ball ${where}. He is ${gap} m from that spot. ${verdict}.`);
  }
  return out;
}

export function throughWindow(match, from, receiver) {
  const spot = throughSpot(receiver);
  const dist = Math.max(2, spot.distanceTo(from));
  const arrive = clamp(passArrive(dist) * 0.82, 7.5, 11.5);
  return marginAlong(match, from, spot, arrive, receiver.team, receiver);
}

// The second ball of a double pass: further ahead than a normal through ball,
// into the space the runner is already sprinting toward.
// A pass to the spot a runner is calling for, not to where he is standing.
export function callWindow(match, from, runner, spot) {
  const dist = Math.max(4, spot.distanceTo(from));
  const arrive = clamp(9.5 + dist * 0.08, 10, 13.5);
  return marginAlong(match, from, spot.clone().setY(0), arrive, runner.team, runner);
}

export function doubleReturnWindow(match, from, runner) {
  const team = runner.team;
  const speed = Math.max(runner.speed, 5.5);
  const lead = clamp(6.5 + speed * 0.7, 8, 15);
  const spot = _a.copy(runner.pos).setY(0);
  spot.x = clamp(spot.x + team.dir * lead, -HL + 1.2, HL - 1.2);
  spot.z = clamp(spot.z, -HW + 1.2, HW - 1.2);
  const dist = Math.max(4, spot.distanceTo(from));
  const arrive = clamp(10 + dist * 0.06, 10.5, 13.5);
  return marginAlong(match, from, spot.clone(), arrive, team, runner);
}

// 1 when no defender can reach the ground-pass lane before the ball does.
export function laneOpen(match, from, to) {
  const dist = Math.max(1.2, from.distanceTo(to));
  const team = match.owner?.team;
  const w = marginAlong(match, from, to, passArrive(dist), team, null);
  return clamp((w.margin + 0.02) / 0.55, 0, 1);
}

// Seconds for a player to reach `pt`, given the speed he already has toward it.
function timeToReach(o, pt) {
  const dx = pt.x - o.pos.x, dz = pt.z - o.pos.z;
  const dist = Math.hypot(dx, dz);
  const d = Math.max(0, dist - 0.55);
  if (d < 0.05) return 0.08;
  const v = Math.max(0, (o.vel.x * dx + o.vel.z * dz) / dist);
  const a = 6.2, vmax = o.maxSpeed;
  if (v >= vmax - 0.05) return 0.1 + d / vmax;
  const tAcc = (vmax - v) / a;
  const dAcc = v * tAcc + 0.5 * a * tAcc * tAcc;
  if (d <= dAcc) return 0.1 + (-v + Math.sqrt(v * v + 2 * a * d)) / a;
  return 0.1 + tAcc + (d - dAcc) / vmax;
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
