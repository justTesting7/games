import * as THREE from 'three';
import { PITCH } from '../world/dims.js';
import { carrierOptions, passWindow, throughWindow } from './ai.js';
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

// Carrier decisions: a local choice is made instantly and executed after a
// short, pressure-dependent hold. If Jev's answer arrives first it replaces
// the local choice. Low-confidence answers only win when the local choice
// is weak. Team mentality is re-asked every ~20 s of play.
export class Brain {
  constructor(match, jev, { rnd = Math.random, teams } = {}) {
    this.match = match;
    this.jev = jev;
    this.rnd = rnd;
    this.teams = teams || match.teams.filter((t) => !t.human);
    this.decisions = new Map();
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
    }
  }

  // ------------------------------------------------------------ carrier

  onPossession(p) {
    this.decisions.delete(p);
    if (!this.controls(p)) return;
    this.decide(p);
  }

  options(p) {
    const list = carrierOptions(this.match, p);
    return { list, best: this.pick(list) };
  }

  // Softmax-ish local pick so AI isn't perfectly predictable.
  pick(list) {
    if (!list.length) return null;
    let src = list.filter((o) => o.value > 0.15);
    if (!src.length) src = [list.find((o) => o.kind === 'dribble') || list[0]];
    const top = src[0].value;
    const pool = src.filter((o) => o.value > top - 0.08);
    const w = pool.map((o) => Math.exp((o.value - top) * 6));
    let r = this.rnd() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
    return pool[0];
  }

  decide(p, filter = null) {
    const m = this.match;
    let { list, best } = this.options(p);
    if (filter) {
      list = list.filter(filter);
      best = this.pick(list);
    }
    const pr = m.pressureOn(p).dist;
    // A tackle on top of him is released at once. A simple pass is one touch.
    // Anything else gets a look up so a teammate can arrive.
    let hold = p.holding ? 1.2 + this.rnd() * 0.6 : pr < 1.15 ? 0.08 : pr < 3.5 ? 0.42 + this.rnd() * 0.2 : 0.6 + this.rnd() * 0.3;
    if (!p.holding && best?.kind === 'shoot') hold = pr < 2.5 ? 0.1 : 0.2;
    else if (!p.holding && best?.kind === 'pass' && best.dist < 17 && pr > 2) hold = 0.16 + this.rnd() * 0.1;
    else if (!p.holding && best?.kind === 'through') hold = 0.26 + this.rnd() * 0.1;
    const d = { at: m.time + hold, choice: best, list, source: 'local', confidence: 0, epoch: m.time, player: p };
    this.decisions.set(p, d);
    this.ask(p, d, list);
    return d;
  }

  planFor(p) {
    if (!this.controls(p)) return null;
    const m = this.match;
    let d = this.decisions.get(p);
    if (!d) d = this.decide(p);
    // Dribbling: re-evaluate every so often, faster when pressed.
    if (d.choice?.kind === 'dribble' || d.choice?.kind === 'shield') {
      if (m.time >= d.at) {
        const pr = m.pressureOn(p).dist;
        const until = d.dribbleUntil ?? (d.dribbleUntil = m.time + (pr < 2.4 ? 0.28 : 0.85 + this.rnd() * 0.35));
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
      if (p.holding && choice.kind === 'pass') return { kind: 'gkThrow', receiver: choice.receiver };
      // The window may have closed while he shaped to pass.
      if (choice.kind === 'pass') {
        const w = passWindow(this.match, p.pos, choice.receiver);
        if (w.margin < 0.06 || w.recvLate > 0.3) return null;
      } else if (choice.kind === 'through') {
        const w = throughWindow(this.match, p.pos, choice.receiver);
        if (w.margin < 0.08 || w.recvLate > 0.35) return null;
      }
      return { kind: choice.kind, receiver: choice.receiver };
    }
    if (p.holding && choice.kind !== 'lob' && choice.kind !== 'pass') {
      const fwd = p.team.players.filter((q) => q.role !== 'GK').sort((a, b) => b.pos.x * p.team.dir - a.pos.x * p.team.dir)[3];
      return { kind: 'lob', receiver: fwd };
    }
    if (choice.kind === 'dribble' || choice.kind === 'shield') {
      return { kind: choice.kind, dir: new THREE.Vector3().subVectors(p.team.attackGoal, p.pos).setY(0).normalize().lerp(choice.dir || new THREE.Vector3(), 0.3).normalize() };
    }
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
      d = this.decide(p, (o) => o.kind === 'pass' || o.kind === 'lob' || r.type === 'freekick' && (o.kind === 'shoot' || o.kind === 'through'));
      d.restart = r;
      d.at = m.time + 0.9;
    }
    if (m.time < d.at) return { wait: true };
    this.consume(p);
    const plan = this.resolve(p, d.choice);
    if (!plan || plan.kind === 'dribble' || plan.kind === 'shield' || plan.kind === 'shoot' && r.type === 'throw') return null;
    if (r.type === 'throw') return { kind: 'throw', receiver: plan.receiver };
    return plan;
  }

  ask(p, d, list) {
    if (!this.jev || !list.length) return;
    const m = this.match;
    const T = p.team;
    const criteria = {};
    for (const o of list.slice(0, 7)) criteria[o.id] = o.text;
    const state = this.carrierState(p);
    const questions = {
      action: {
        type: 'choice',
        instructions: `You are ${p.name} (#${p.number}, ${p.slot}) of ${T.club.name}, ${p.def.personality}. Team instruction: ${MENTALITY_TEXT[T.mentality]}. You have the ball right now. Pick the one action to take in the next second, in character.`,
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
      if (!opt) return;
      this.stats.answered++;
      const conf = a.confidence ?? 0.5;
      const localVal = cur.choice?.value ?? -1;
      if (conf >= 0.3 || opt.value > localVal - 0.3) {
        if (opt !== cur.choice) this.stats.overrides++;
        cur.choice = opt;
        cur.source = 'jev';
        cur.confidence = conf;
      }
    });
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
      team_mentality: MENTALITY[T.mentality].label,
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
