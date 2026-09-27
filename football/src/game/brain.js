import * as THREE from 'three';
import { PITCH } from '../world/dims.js';
import { carrierOptions, passWindow, throughWindow, doubleReturnWindow, callWindow, ballCalls, playerOffside, aheadOfEveryone, moveOptions } from './ai.js';
import { MENTALITY } from './match.js';

const HL = PITCH.halfLength, HW = PITCH.halfWidth;
const MENTALITY_TEXT = {
  high_press: 'press high up the pitch and win the ball back fast',
  mid_block: 'hold a compact mid block and stay balanced',
  low_block: 'sit deep in a low block and protect the goal',
  possession: 'keep the ball, pass patiently and wait for an opening',
  counter: 'defend deep and break fast on the counter-attack',
  all_out_attack: 'throw bodies forward and attack with everything',
};

function zone(team, pos) {
  const x = pos.x * team.dir;
  const third = x < -HL / 3 ? 'defensive third' : x > HL / 3 ? 'attacking third' : 'middle third';
  const side = Math.abs(pos.z) < HW / 3 ? 'central' : (pos.z * team.dir > 0 ? 'right' : 'left') + ' flank';
  return `${third}, ${side}`;
}

// The touch Jev is asked to choose. The offline pick follows this same order,
// because the ball is played before a reply gets back. The team scores by
// getting a man into the penalty area and finishing, not by keeping the ball.
const CARRIER_INSTRUCTIONS = `You have the ball. Score with a long through pass to a forward, or with a double pass.
A teammate is offside when he is in the opponent's half and nearer their goal than both the ball and the second-last defender. Never pass to him. A pass into the space beyond that line is allowed when he is still level with it.
If you are ahead of every defender, keep running at goal. Do not pass. Shoot when a shot on that run is listed. Until then, take another touch toward goal.
If you just received a double pass and the return is listed, play it first time into the runner's path.
Forwards without the ball are always running ahead and calling for a long through pass. If that through pass is listed and he reaches the space before a defender, play it.
If a double pass is listed, start it. He returns the ball into your run.
If a shot from inside the penalty area is listed, shoot. Do not pass a chance in the box away.
If a clear sight of goal from inside 22 m is listed, shoot.
If a through pass is listed that puts a teammate in the penalty area, play that.
If you are wide and a cross is listed with a teammate in the box, cross it.
If a pass to feet is listed that puts a teammate in the penalty area, play that.
If a forward pass to feet is listed, play it. A square pass is not forward.
Carry toward goal when no shot, no long through and no double pass is on and there is space.
Pass backward only when every forward ball is closed and you cannot carry the ball forward.`;

// How often each player asks Jev. Close to the ball means a decision every
// 300 ms. Everyone else, once a second. One request per player at a time.
const CLOSE_TO_BALL = 12;

const OFF_BALL_INSTRUCTIONS = `You do not have the ball. Choose where to run.
If the ball is played to you, run onto it. Do not slow down before you reach it.
If you are a forward and your team has the ball, run ahead and call for a long through pass. Stay onside until it is played.
If a run into a gap behind the defence is listed, take it and call for the ball.
If closing the carrier down is listed, press him. You are the nearest player.
If marking your man is listed, stay goal-side of him.
Hold your position in the shape when none of those runs is on.`;

// Carrier decisions: a local choice is made instantly and executed after a
// short, pressure-dependent hold. If Jev's answer arrives first it replaces
// the local choice. Low-confidence answers only win when the local choice
// is weak. Every player without the ball asks on his own cadence. Team
// mentality is re-asked every ~20 s of play.
export class Brain {
  constructor(match, jev, { rnd = Math.random, teams } = {}) {
    this.match = match;
    this.jev = jev;
    this.rnd = rnd;
    this.teams = teams || match.teams.filter((t) => !t.human);
    this.decisions = new Map();
    this.moves = new Map();
    this.lastAsk = new Map();
    this.inflight = new Set();
    this.log = [];
    this.mentalityT = new Map(this.teams.map((t) => [t, 2]));
    this.stats = { asked: 0, answered: 0, overrides: 0 };
    match.brain = this;
  }

  controls(p) { return this.teams.includes(p.team) && !(this.match.human === p); }

  update(dt) {
    const m = this.match;
    if (m.state !== 'play' && m.state !== 'dead') return;
    for (const t of this.teams) {
      const left = this.mentalityT.get(t) - dt;
      this.mentalityT.set(t, left);
      if (left <= 0 && !t.askingMentality) {
        this.mentalityT.set(t, 18 + this.rnd() * 6);
        this.askMentality(t);
      }
      if (m.state !== 'play') continue;
      for (const p of t.players) {
        if (!this.controls(p) || p === m.owner) continue;
        this.tickMove(p);
      }
    }
    if (m.state === 'play' && m.owner && this.controls(m.owner)) this.refreshCarrier(m.owner);
  }

  // Close to the ball: 300 ms. Far from it: 1 s. The carrier is always close.
  cadence(p) {
    const m = this.match;
    if (p === m.owner || p === m.pass?.to) return 0.3;
    return p.pos.distanceTo(m.ball.pos) < CLOSE_TO_BALL ? 0.3 : 1;
  }

  // ------------------------------------------------------------ carrier

  onPossession(p) {
    this.decisions.delete(p);
    if (!this.controls(p)) return;
    this.decide(p, null, true);
  }

  options(p) {
    const list = carrierOptions(this.match, p);
    return { list, best: this.pick(list) };
  }

  // Offline reading of CARRIER_INSTRUCTIONS. Jev replaces this if its answer arrives.
  pick(list) {
    if (!list.length) return null;
    const live = list.filter((o) => o.value > 0.15 && !o.offside);
    const src = live.length ? live : [list.find((o) => o.kind === 'dribble') || list[0]];
    const breakShot = src.find((o) => o.finish === 'break');
    if (breakShot) return breakShot;
    const breakRun = src.find((o) => o.alone && o.kind === 'dribble');
    if (breakRun) return breakRun;
    const ret = src.find((o) => o.combo === 'return');
    if (ret) return ret;
    const box = src.filter((o) => o.finish === 'box');
    if (box.length) return this.among(box);
    const sight = src.filter((o) => o.finish === 'sight');
    if (sight.length) return this.among(sight);
    const calls = src.filter((o) => o.call && o.sensible);
    if (calls.length) return this.among(calls);
    const dbl = src.filter((o) => o.combo === 'double');
    if (dbl.length) return this.among(dbl);
    const thr = src.filter((o) => o.kind === 'through' && !o.call && o.intoBox);
    if (thr.length) return this.among(thr);
    const cross = src.find((o) => o.kind === 'cross' && o.boxMates > 0);
    if (cross) return cross;
    const into = src.filter((o) => o.intoBox && o.kind !== 'through');
    if (into.length) return this.among(into);
    const fwd = src.filter((o) => (o.kind === 'pass' || o.kind === 'lob') && (o.gain ?? 0) > 1);
    if (fwd.length) return this.among(fwd);
    const carry = src.find((o) => o.kind === 'dribble' && o.value >= 0.45);
    if (carry) return carry;
    const rest = src.filter((o) => o.kind !== 'through' || o.call || o.intoBox || o.combo === 'return');
    return this.among(rest.length ? rest : src);
  }

  among(pool) {
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    const top = pool.reduce((m, o) => Math.max(m, o.value), -Infinity);
    const near = pool.filter((o) => o.value > top - 0.08);
    const w = near.map((o) => Math.exp((o.value - top) * 6));
    let r = this.rnd() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < near.length; i++) { r -= w[i]; if (r <= 0) return near[i]; }
    return near[0];
  }

  decide(p, filter = null, forceAsk = false) {
    const m = this.match;
    let { list, best } = this.options(p);
    if (filter) {
      list = list.filter(filter);
      best = this.pick(list);
    }
    const pr = m.pressureOn(p).dist;
    // Play it at once. A forward pass is a single touch; nothing waits around.
    const passing = best?.kind === 'pass' || best?.kind === 'through' || best?.kind === 'lob';
    let hold = p.holding ? 0.28 : pr < 1.15 ? 0.05 : 0.1;
    if (!p.holding && best?.kind === 'shoot') hold = 0.06;
    else if (!p.holding && (best?.combo || (passing && best.gain > 1))) hold = 0.04;
    else if (!p.holding && passing) hold = 0.08;
    // Leave room for a Jev reply. The answer releases the touch as soon as it lands.
    if (this.jev) hold = Math.max(hold, 0.6);
    const d = { at: m.time + hold, choice: best, list, source: 'local', confidence: 0, epoch: m.time, player: p };
    this.decisions.set(p, d);
    this.ask(p, d, list, forceAsk);
    return d;
  }

  planFor(p) {
    if (!this.controls(p)) return null;
    const m = this.match;
    let d = this.decisions.get(p);
    if (!d) d = this.decide(p);
    // He has gone past the last defender. Drop the pass and run at goal.
    if (d.choice && !d.choice.alone && d.choice.finish !== 'break' && aheadOfEveryone(m, p)) {
      this.decisions.delete(p);
      d = this.decide(p, null, true);
    }
    // Dribbling: re-evaluate every so often, faster when pressed.
    if (d.choice?.kind === 'dribble' || d.choice?.kind === 'shield') {
      if (m.time >= d.at) {
        const until = d.dribbleUntil ?? (d.dribbleUntil = m.time + 0.1);
        if (m.time >= until) { this.decisions.delete(p); d = this.decide(p); }
      }
      return this.resolve(p, d.choice) || { kind: 'dribble' };
    }
    // Emergency: an opponent is about to take it.
    if (m.pressureOn(p).dist < 1.1 && m.time > d.epoch + 0.08) d.at = Math.min(d.at, m.time);
    if (m.time < d.at) return { kind: 'dribble', dir: d.choice?.dir, receiver: d.choice?.receiver, waiting: true };
    const plan = this.resolve(p, d.choice);
    if (!plan) {
      // That pass had closed. Think again instead of forcing it.
      this.decisions.delete(p);
      return { kind: 'dribble' };
    }
    return plan;
  }

  // Refresh option parameters (receiver may have moved), drop stale ones.
  resolve(p, choice) {
    if (!choice) return null;
    if (choice.kind === 'pass' || choice.kind === 'through' || choice.kind === 'lob') {
      if (!choice.receiver || choice.receiver.busy) return null;
      if (playerOffside(this.match, choice.receiver)) return null;
      if (p.holding && choice.kind === 'pass') return { kind: 'gkThrow', receiver: choice.receiver };
      // The window may have closed while he shaped to pass.
      if (choice.call && choice.spot) {
        const w = callWindow(this.match, p.pos, choice.receiver, choice.spot);
        if (w.margin < 0.06 || w.recvLate > 0.4) return null;
        return { kind: 'through', receiver: choice.receiver, call: true, spot: choice.spot.clone() };
      }
      if (choice.kind === 'pass') {
        const q = choice.receiver;
        const dx = p.pos.x - q.pos.x, dz = p.pos.z - q.pos.z;
        const coming = (q.vel.x * dx + q.vel.z * dz) / (Math.hypot(dx, dz) || 1);
        if (q.speed > 6.2 && coming < 0.2) return null;
        const w = passWindow(this.match, p.pos, q);
        if (w.margin < 0.06 || w.recvLate > 0.3) return null;
      } else if (choice.kind === 'through') {
        const w = choice.combo === 'return'
          ? doubleReturnWindow(this.match, p.pos, choice.receiver)
          : throughWindow(this.match, p.pos, choice.receiver);
        if (w.margin < (choice.combo === 'return' ? -0.02 : 0.08) || w.recvLate > (choice.combo === 'return' ? 0.45 : 0.35)) return null;
      }
      return { kind: choice.kind, receiver: choice.receiver, combo: choice.combo || null };
    }
    if (p.holding && choice.kind !== 'lob' && choice.kind !== 'pass') {
      const fwd = p.team.players.filter((q) => q.role !== 'GK').sort((a, b) => b.pos.x * p.team.dir - a.pos.x * p.team.dir)[3];
      return { kind: 'lob', receiver: fwd };
    }
    if (choice.kind === 'dribble' || choice.kind === 'shield') {
      const atGoal = new THREE.Vector3().subVectors(p.team.attackGoal, p.pos).setY(0).normalize();
      const dir = choice.alone ? atGoal : atGoal.lerp(choice.dir || atGoal, 0.3).normalize();
      return { kind: choice.kind, alone: !!choice.alone, dir };
    }
    if (choice.kind === 'shoot') return { kind: 'shoot', aimZ: choice.aimZ ?? null };
    return { kind: choice.kind };
  }

  consume(p) {
    const d = this.decisions.get(p);
    if (d?.choice) this.note(p, d);
    this.decisions.delete(p);
  }

  restartPlan(p, r) {
    if (!this.controls(p)) return null;
    const m = this.match;
    if (r.type === 'penalty') return { kind: 'shoot', power: 0.78 + this.rnd() * 0.12 };
    if (r.type === 'kickoff') return null;
    if (r.type === 'corner') return { kind: 'cross' };
    let d = this.decisions.get(p);
    if (!d || d.restart !== r) {
      d = this.decide(p, (o) => o.kind === 'pass' || o.kind === 'lob' || r.type === 'freekick' && (o.kind === 'shoot' || o.kind === 'through'), true);
      d.restart = r;
      d.at = m.time + 0.28;
    }
    if (m.time < d.at) return { wait: true };
    this.consume(p);
    const plan = this.resolve(p, d.choice);
    if (!plan || plan.kind === 'dribble' || plan.kind === 'shield' || plan.kind === 'shoot' && r.type === 'throw') return null;
    if (r.type === 'throw') return { kind: 'throw', receiver: plan.receiver };
    return plan;
  }

  ask(p, d, list, force = false) {
    if (!this.jev || !list.length) return;
    if (this.inflight.has(p)) return;
    const m = this.match;
    const every = this.cadence(p);
    const last = this.lastAsk.get(p);
    if (!force && last != null && m.time - last < every - 1e-4) return;
    this.inflight.add(p);
    this.lastAsk.set(p, m.time);
    const T = p.team;
    const criteria = {};
    const head = list.filter((o) => o.alone || o.finish === 'break' || o.combo || o.call || o.kind === 'through' || o.finish || o.intoBox || (o.kind === 'cross' && o.boxMates > 0));
    const rest = list.filter((o) => !head.includes(o));
    for (const o of [...head, ...rest].slice(0, 7)) criteria[o.id] = o.text;
    const state = this.carrierState(p);
    const questions = {
      action: {
        type: 'choice',
        instructions: `You are ${p.name} (#${p.number}, ${p.slot}) of ${T.club.name}, ${p.def.personality}. Team instruction: ${MENTALITY_TEXT[T.mentality]}. ${CARRIER_INSTRUCTIONS}`,
        criteria,
      },
    };
    this.stats.asked++;
    const epoch = d.epoch;
    this.jev.ask(state, questions).then((ans) => {
      const cur = this.decisions.get(p);
      if (!cur || cur.epoch !== epoch || m.owner !== p && !cur.restart) return;
      const a = ans?.action;
      const opt = a && list.find((o) => o.id === a.choice);
      if (opt) {
        this.stats.answered++;
        const conf = a.confidence ?? 0.5;
        const localVal = cur.choice?.value ?? -1;
        if (conf >= 0.3 || opt.value > localVal - 0.3) {
          if (opt !== cur.choice) this.stats.overrides++;
          cur.choice = opt;
          cur.source = 'jev';
          cur.confidence = conf;
        }
      }
      cur.at = Math.min(cur.at, m.time);
    }).finally(() => this.inflight.delete(p));
  }

  // The carrier is close to the ball, so his touch is asked again every 300 ms
  // without putting the kick back on the clock.
  refreshCarrier(p) {
    if (!this.jev || this.inflight.has(p)) return;
    const m = this.match;
    const last = this.lastAsk.get(p);
    if (last != null && m.time - last < this.cadence(p) - 1e-4) return;
    let d = this.decisions.get(p);
    if (!d) { this.decide(p, null, true); return; }
    const { list, best } = this.options(p);
    d.list = list;
    if (d.source !== 'jev') d.choice = best;
    d.epoch = m.time;
    this.ask(p, d, list, true);
  }

  // ---------------------------------------------------------------- off the ball

  pickMove(list) {
    if (!list?.length) return null;
    const take = (id) => list.find((o) => o.id === id);
    return take('onto_ball') || take('long_run') || take('gap_run') || take('press') || take('mark') || take('guard') || take('shape') || list[0];
  }

  tickMove(p) {
    const m = this.match;
    if (m.state !== 'play') return;
    if (this.inflight.has(p)) return;
    const last = this.lastAsk.get(p);
    if (this.jev && last != null && m.time - last < this.cadence(p) - 1e-4) return;
    const list = moveOptions(m, p);
    if (!list.length) return;
    const d = { choice: this.pickMove(list), list, epoch: m.time, source: 'local' };
    this.moves.set(p, d);
    this.askMove(p, d, list);
  }

  // The run Jev (or the offline pick) chose, with the spot refreshed for this frame.
  movement(p) {
    this.tickMove(p);
    const d = this.moves.get(p);
    if (!d?.choice) return null;
    const list = moveOptions(this.match, p);
    return list.find((o) => o.id === d.choice.id) || this.pickMove(list);
  }

  askMove(p, d, list) {
    if (!this.jev || !list.length || this.inflight.has(p)) return;
    const m = this.match;
    this.inflight.add(p);
    this.lastAsk.set(p, m.time);
    const criteria = {};
    for (const o of list.slice(0, 6)) criteria[o.id] = o.text;
    const questions = {
      action: {
        type: 'choice',
        instructions: `You are ${p.name} (#${p.number}, ${p.slot}) of ${p.team.club.name}, ${p.def.personality}. Team instruction: ${MENTALITY_TEXT[p.team.mentality]}. ${OFF_BALL_INSTRUCTIONS}`,
        criteria,
      },
    };
    this.stats.asked++;
    const epoch = d.epoch;
    this.jev.ask(this.moverState(p), questions).then((ans) => {
      const cur = this.moves.get(p);
      if (!cur || cur.epoch !== epoch) return;
      const a = ans?.action;
      const opt = a && list.find((o) => o.id === a.choice);
      if (!opt) return;
      this.stats.answered++;
      const conf = a.confidence ?? 0.5;
      const localVal = cur.choice?.value ?? -1;
      if (conf >= 0.3 || opt.value > localVal - 0.3) {
        if (opt.id !== cur.choice?.id) this.stats.overrides++;
        cur.choice = opt;
        cur.source = 'jev';
        cur.confidence = conf;
      }
    }).finally(() => this.inflight.delete(p));
  }

  moverState(p) {
    const m = this.match;
    const T = p.team;
    const ball = m.ball.pos;
    const owner = m.owner;
    return {
      me: {
        name: p.name, position: p.slot, zone: zone(T, p.pos),
        distance_to_ball_m: Math.round(p.pos.distanceTo(ball)),
        distance_to_goal_m: Math.round(p.pos.distanceTo(T.attackGoal)),
      },
      ball: {
        zone: zone(T, ball),
        our_team_has_it: owner?.team === T,
        opponent_has_it: !!(owner && owner.team !== T),
      },
      team_mentality: MENTALITY[T.mentality].label,
    };
  }

  note(p, d) {
    this.log.push({ t: this.match.time, player: p, team: p.team, text: d.choice?.text || '', id: d.choice?.id, source: d.source, confidence: d.confidence });
    if (this.log.length > 12) this.log.shift();
  }

  carrierState(p) {
    const m = this.match;
    const T = p.team;
    const pr = m.pressureOn(p);
    const goal = T.attackGoal;
    const mates = T.players.filter((q) => q !== p && q.role !== 'GK')
      .sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos)).slice(0, 5)
      .map((q) => ({ name: q.name, number: q.number, position: q.slot, distance_m: Math.round(q.pos.distanceTo(p.pos)), marked: m.openness(q) < 0.3, making_run: !!q.run }));
    return {
      match: {
        score: `${T.club.name} ${T.score} - ${T.opp.score} ${T.opp.club.name}`,
        minute: Math.ceil(m.gameMinute()),
        situation: T.score > T.opp.score ? 'winning' : T.score < T.opp.score ? 'losing' : 'level',
      },
      me: {
        name: p.name, position: p.slot, zone: zone(T, p.pos),
        distance_to_goal_m: Math.round(p.pos.distanceTo(goal)),
        nearest_opponent_m: Math.round(pr.dist * 10) / 10,
        under_pressure: pr.dist < 2.5,
        ratings: { pace: +p.def.pace.toFixed(2), passing: +p.def.passing.toFixed(2), shooting: +p.def.shooting.toFixed(2) },
      },
      teammates: mates,
      calls_for_the_ball: ballCalls(m, p),
      team_mentality: MENTALITY[T.mentality].label,
      double_pass: m.doublePass?.wall === p
        ? `${m.doublePass.runner.name} gave you the first ball and is sprinting on. Return it first time into his run.`
        : m.doublePass?.runner === p
          ? `You played the first ball and you are sprinting. ${m.doublePass.wall.name} should return it into your path.`
          : null,
    };
  }

  // ------------------------------------------------------------ mentality

  localMentality(t) {
    const m = this.match;
    const diff = t.score - t.opp.score;
    const min = m.gameMinute();
    if (diff < 0 && min > 75) return 'all_out_attack';
    if (diff < 0) return this.rnd() < 0.5 ? 'high_press' : 'possession';
    if (diff > 0 && min > 70) return 'low_block';
    if (diff > 0) return t.mentality === 'counter' || t.mentality === 'mid_block' ? t.mentality : 'mid_block';
    const level = ['mid_block', 'possession', 'high_press'];
    return level.includes(t.mentality) && this.rnd() < 0.7 ? t.mentality : level[Math.floor(this.rnd() * 3)];
  }

  askMentality(t) {
    const m = this.match;
    const local = this.localMentality(t);
    if (!this.jev) { this.setMentality(t, local, 'local', 0); return; }
    t.askingMentality = true;
    const [a, b] = m.possessionShare();
    const mine = t.index === 0 ? a : b;
    const state = {
      match: {
        us: t.club.name, them: t.opp.club.name,
        score: `${t.score} - ${t.opp.score}`,
        minute: Math.ceil(m.gameMinute()),
        half: m.half,
      },
      stats: {
        our_possession_pct: mine,
        our_shots: t.stats.shots, their_shots: t.opp.stats.shots,
        our_passes_completed: `${t.stats.completed}/${t.stats.passes}`,
      },
      current_mentality: MENTALITY[t.mentality].label,
    };
    const questions = {
      mentality: {
        type: 'choice',
        instructions: `You are the head coach of ${t.club.name}. Choose the team's approach for the next few minutes to win this match. Change it only if the game situation calls for it.`,
        criteria: MENTALITY_TEXT,
      },
    };
    this.jev.ask(state, questions).then((ans) => {
      const c = ans?.mentality;
      if (c && MENTALITY[c.choice]) this.setMentality(t, c.choice, 'jev', c.confidence ?? 0.5);
      else this.setMentality(t, local, 'local', 0);
    }).finally(() => { t.askingMentality = false; });
  }

  setMentality(t, id, source, conf) {
    const changed = t.mentality !== id;
    t.mentality = id;
    t.mentalitySource = source;
    t.mentalityConf = conf;
    if (changed) this.match.emitLater({ type: 'mentality', team: t, id, source, confidence: conf });
  }

  lastDecision(team) {
    for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i].team === team) return this.log[i];
    return null;
  }

  current(p) { return this.decisions.get(p) || null; }
}
