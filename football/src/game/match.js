import * as THREE from 'three';
import { Ball } from './ball.js';
import { PITCH, GOAL, BALL_RADIUS } from '../world/dims.js';
import { KICKOFF, KICKOFF_DEFEND, squad, CLUBS } from './teams.js';
import { groundPass, loftedPass, shotVelocity, leadTarget, gauss } from './kicks.js';
import { ACTION_DUR, KICK } from './actions.js';
import { teamShape, chooseChasers, defendTargets, supportTargets, keeperTarget, carrierOptions, laneOpen } from './ai.js';

const HL = PITCH.halfLength, HW = PITCH.halfWidth, R = BALL_RADIUS;
const GOAL_LINE = HL - PITCH.line * 0.5;
const UP = new THREE.Vector3(0, 1, 0);
const HALF_MINUTES = 45;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export const MENTALITY = {
  high_press: { line: 10, press: 1, width: 1, label: 'High press' },
  mid_block: { line: 0, press: 0.55, width: 0.95, label: 'Mid block' },
  low_block: { line: -12, press: 0.25, width: 0.8, label: 'Low block' },
  possession: { line: 4, press: 0.6, width: 1.1, label: 'Possession' },
  counter: { line: -6, press: 0.4, width: 0.9, counter: true, label: 'Counter-attack' },
  all_out_attack: { line: 16, press: 0.9, width: 1.1, label: 'All-out attack' },
};

export class Player {
  constructor(team, def, index) {
    this.team = team;
    this.def = def;
    this.index = index;
    this.role = def.role;
    this.slot = def.pos;
    this.number = def.number;
    this.name = def.name;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.target = new THREE.Vector3();
    this.targetSpeed = 0;
    this.face = null;
    this.kickLock = 0;
    this.stun = 0;
    this.touchCd = 0;
    this.action = null;
    this.pendingKick = null;
    this.slide = null;
    this.dive = null;
    this.maxSpeed = def.role === 'GK' ? 6.6 : 7.1 + def.pace * 1.7;
    this.anims = [];
    this.turnRate = 0;
    this.localDir = new THREE.Vector3(0, 0, 1);
    this.run = null;
    this.holdT = 0;
    this.lookAt = new THREE.Vector3();
    this.celebrate = 0;
    this.intent = new THREE.Vector3();
    this.turning = false;
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  left(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get busy() { return !!(this.slide || this.dive || this.stun > 0 || this.action?.type === 'fall'); }

  anim(type, opts = {}) {
    const dur = opts.dur || ACTION_DUR[type] || 0.5;
    this.action = { type, t: 0, dur, ...opts };
    this.anims.push({ type, opts: { ...opts, dur } });
  }

  touchPoint(out = new THREE.Vector3()) {
    return this.forward(out).multiplyScalar(0.42).add(this.pos).setY(R);
  }
}

export class Team {
  constructor(index, clubId, dir, human, seed) {
    this.index = index;
    this.id = clubId;
    this.club = CLUBS[clubId];
    this.dir = dir;
    this.human = human;
    this.score = 0;
    this.mentality = 'mid_block';
    this.mentalitySource = 'local';
    this.mentalityConf = 0;
    this.stats = { shots: 0, onTarget: 0, possession: 0, passes: 0, completed: 0 };
    this.defs = squad(clubId, seed);
    this.players = this.defs.map((d, i) => new Player(this, d, i));
    this.keeper = this.players[0];
  }
  get m() { return MENTALITY[this.mentality] || MENTALITY.mid_block; }
  toWorld(xn, zn, out = new THREE.Vector3()) { return out.set(xn * HL * this.dir, 0, zn * HW * this.dir); }
  get attackGoal() { return new THREE.Vector3(this.dir * GOAL_LINE, 0, 0); }
  get ownGoal() { return new THREE.Vector3(-this.dir * GOAL_LINE, 0, 0); }
}

export class Match {
  constructor({ home = 'kingsbridge', away = 'redmoor', humanTeam = 0, halfSeconds = 240, difficulty = 1, rnd = Math.random } = {}) {
    this.rnd = rnd;
    this.difficulty = difficulty;
    this.halfSeconds = halfSeconds;
    this.ball = new Ball();
    this.teams = [new Team(0, home, 1, humanTeam === 0, 1), new Team(1, away, -1, humanTeam === 1, 2)];
    this.teams[0].opp = this.teams[1];
    this.teams[1].opp = this.teams[0];
    this.players = [...this.teams[0].players, ...this.teams[1].players];
    this.humanTeam = humanTeam === null ? null : this.teams[humanTeam];
    this.human = this.humanTeam ? this.humanTeam.players[9] : null;
    this.time = 0;
    this.clock = 0;
    this.half = 1;
    this.stoppage = 0;
    this.state = 'intro';
    this.stateT = 0;
    this.owner = null;
    this.lastTouch = null;
    this.lastKick = null;
    this.pass = null;
    this.restart = null;
    this.events = [];
    this.later = [];
    this.brain = null;
    this.chasers = new Map();
    this.pathCache = null;
    this.kickoffTeam = this.teams[0];
    this.possessionT = [0, 0];
    this.goals = [];
    this.lastScorer = null;
    this.setupKickoff(this.kickoffTeam, true);
  }

  emit(e) { this.events.push(e); }
  gameMinute() { return this.clock / 60; }

  clockText() {
    const total = Math.floor(this.clock);
    const halfEnd = this.half * HALF_MINUTES * 60;
    if (total >= halfEnd) {
      const extra = Math.floor((total - halfEnd) / 60) + 1;
      return `${this.half * HALF_MINUTES}+${extra}'`;
    }
    const m = Math.floor(total / 60), s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  start() {
    if (this.state === 'intro') {
      this.state = 'kickoff';
      this.stateT = 0;
    }
  }

  // ---------------------------------------------------------------- set pieces

  setupKickoff(team, teleport) {
    this.kickoffTeam = team;
    this.owner = null;
    this.pass = null;
    this.restart = { type: 'kickoff', team, pos: new THREE.Vector3(0, R, 0) };
    this.ball.place(0, 0);
    for (const t of this.teams) {
      const layout = t === team ? KICKOFF : KICKOFF_DEFEND;
      t.players.forEach((p, i) => {
        const [x, z] = layout[i];
        t.toWorld(x, z, p.target);
        if (teleport) {
          p.pos.copy(p.target);
          p.vel.set(0, 0, 0);
          p.yaw = Math.atan2(t.dir, 0);
          p.action = null; p.slide = null; p.dive = null; p.stun = 0; p.pendingKick = null;
        }
      });
    }
    this.restart.taker = team.players[9];
    this.restart.taker.pos.set(-team.dir * 0.35, 0, -0.1);
    this.restart.taker.yaw = Math.atan2(team.dir, 0) + team.dir * 0.3;
    if (this.humanTeam === team) this.human = this.restart.taker;
    else if (this.humanTeam) this.human = this.humanTeam.players[9];
  }

  awardRestart(type, team, pos) {
    this.state = 'dead';
    this.stateT = 0;
    this.owner = null;
    this.pass = null;
    const p = pos.clone();
    if (type === 'throw') {
      p.x = THREE.MathUtils.clamp(p.x, -HL + 0.5, HL - 0.5);
      p.z = Math.sign(p.z) * (HW + 0.2);
    } else if (type === 'corner') {
      p.set(Math.sign(p.x) * (HL - 0.4), R, Math.sign(p.z || 1) * (HW - 0.4));
    } else if (type === 'goalkick') {
      p.set(Math.sign(p.x) * (HL - 5.5), R, Math.sign(p.z || 1) * 5);
    } else if (type === 'penalty') {
      p.set(Math.sign(p.x) * (HL - PITCH.penaltySpot), R, 0);
    }
    p.y = R;
    let taker;
    if (type === 'goalkick') taker = team.keeper;
    else {
      const out = team.players.filter((q) => q.role !== 'GK' && !q.busy);
      const pick = type === 'penalty' || type === 'freekick' && p.distanceTo(team.attackGoal) < 30
        ? out.sort((a, b) => b.def.shooting - a.def.shooting)[0]
        : out.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p))[0];
      taker = pick;
    }
    this.restart = { type, team, pos: p, taker, placed: false };
    if (this.humanTeam === team) this.human = taker;
    else if (this.humanTeam && this.humanTeam.players.includes(this.human)) {
      // Defending a set piece: control whoever is nearest to the ball.
      this.human = this.nearestTo(this.humanTeam, p, true);
    }
    this.emit({ type: 'restart', kind: type, team });
    if (type !== 'throw' && type !== 'goalkick') this.emit({ type: 'whistle', kind: type === 'penalty' ? 'long' : 'short' });
  }

  nearestTo(team, p, outfield = false) {
    let best = null, bd = Infinity;
    for (const q of team.players) {
      if (outfield && q.role === 'GK') continue;
      const d = q.pos.distanceTo(p);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  // ---------------------------------------------------------------- main loop

  // For events raised between frames (async Jev answers).
  emitLater(e) { this.later.push(e); }

  update(dt, input = null) {
    this.events.length = 0;
    if (this.later.length) { this.events.push(...this.later); this.later.length = 0; }
    this.time += dt;
    this.stateT += dt;
    const running = this.state === 'play' || this.state === 'dead' || this.state === 'kickoff' && this.stateT > 1.5;
    if (running && this.state !== 'kickoff') this.clock += dt * (HALF_MINUTES * 60 / this.halfSeconds);
    if (this.owner) this.possessionT[this.owner.team.index] += dt;

    if (this.state === 'intro' || this.state === 'fulltime') {
      this.updatePlayers(dt, null);
      this.stepBall(dt);
      return this.events;
    }
    if (this.state === 'goal') {
      if (this.stateT > 5.2) {
        this.setupKickoff(this.kickoffTeam, true);
        this.state = 'kickoff';
        this.stateT = 0;
        this.emit({ type: 'reset' });
      }
      this.updatePlayers(dt, null);
      this.stepBall(dt);
      return this.events;
    }
    if (this.state === 'halftime') {
      if (this.stateT > 3.5) {
        this.half = 2;
        this.clock = HALF_MINUTES * 60;
        for (const t of this.teams) t.dir = -t.dir;
        this.setupKickoff(this.teams[1], true);
        this.state = 'kickoff';
        this.stateT = 0;
        this.emit({ type: 'reset' });
      }
      this.updatePlayers(dt, null);
      this.stepBall(dt);
      return this.events;
    }

    // End of a half once stoppage time is played and the ball is safe.
    const halfEnd = this.half * HALF_MINUTES * 60 + this.stoppage;
    if (this.clock >= halfEnd && (this.state === 'dead' || this.state === 'play' && Math.abs(this.ball.pos.x) < HL - 30)) {
      this.emit({ type: 'whistle', kind: this.half === 1 ? 'half' : 'full' });
      this.state = this.half === 1 ? 'halftime' : 'fulltime';
      this.stateT = 0;
      this.owner = null;
      if (this.half === 1) this.stoppage = 60 * (1 + Math.floor(this.rnd() * 3));
      return this.events;
    }
    if (this.half === 1 && this.clock > 44 * 60 && !this.stoppage) this.stoppage = 60 * (1 + Math.floor(this.rnd() * 2));
    if (this.half === 2 && this.clock > 89 * 60 && this.stoppage < 60 * 2) this.stoppage = 60 * (2 + Math.floor(this.rnd() * 3));

    if (this.state === 'kickoff' || this.state === 'dead') this.updateRestart(dt, input);
    this.updateHumanSelection(input);
    this.updatePlayers(dt, input);
    if (this.state === 'play') this.updateControl(dt);
    this.updateKicks(dt);
    this.stepBall(dt);
    if (this.state === 'play') this.checkBounds();
    return this.events;
  }

  // ---------------------------------------------------------------- restarts

  updateRestart(dt, input) {
    const r = this.restart;
    if (!r) return;
    if (!r.placed && (this.state === 'kickoff' || this.stateT > 0.9)) {
      this.ball.place(r.pos.x, r.pos.z, r.type === 'throw' ? 1.6 : R);
      r.placed = true;
    }
    if (this.state === 'kickoff' && this.stateT > 1.2 && !r.whistled) {
      r.whistled = true;
      this.emit({ type: 'whistle', kind: 'short' });
    }
    const taker = r.taker;
    if (!taker) return;
    const goalDir = _v.subVectors(r.team.attackGoal, r.pos).setY(0).normalize();
    if (r.type === 'throw') {
      const inward = new THREE.Vector3(0, 0, -Math.sign(r.pos.z));
      taker.target.copy(r.pos).addScaledVector(inward, -0.25).setY(0);
      taker.face = r.pos.clone().addScaledVector(inward, 10).addScaledVector(goalDir, 4);
    } else if (r.type === 'kickoff') {
      taker.target.set(-r.team.dir * 0.35, 0, -0.1);
      taker.face = new THREE.Vector3(-r.team.dir * 6, 0, -3);
    } else {
      const back = r.type === 'penalty' ? 2.2 : r.type === 'corner' ? 1.8 : 1.3;
      const aimDir = r.type === 'corner' ? _w.set(-Math.sign(r.pos.x) * 0.6, 0, -Math.sign(r.pos.z)).normalize() : goalDir;
      taker.target.copy(r.pos).addScaledVector(aimDir, -back).setY(0);
      taker.face = r.pos.clone().addScaledVector(aimDir, 10);
    }
    if (r.placed && r.type === 'throw' && taker.pos.distanceTo(taker.target) < 0.6) {
      // The thrower holds the ball over his head.
      this.ball.pos.copy(taker.pos).addScaledVector(taker.forward(_w), -0.1).setY(2.1);
      this.ball.vel.set(0, 0, 0);
    }
    const ready = r.placed && taker.pos.distanceTo(taker.target) < 0.7 && this.stateT > (this.state === 'kickoff' ? 1.4 : 1.8) && !taker.pendingKick;
    r.ready = ready;
    if (!ready) return;
    if (r.team.human && this.human === taker && this.stateT < 8) {
      if (input) this.humanRestart(taker, r, input);
    } else if (this.stateT > (r.type === 'penalty' ? 3.2 : 2.3)) {
      let plan = this.brain ? this.brain.restartPlan(taker, r) : null;
      if (plan?.wait) return;
      plan = plan || this.localRestartPlan(taker, r);
      if (plan) this.executePlan(taker, plan);
    }
  }

  localRestartPlan(p, r) {
    const mates = p.team.players.filter((q) => q !== p && q.role !== 'GK');
    if (r.type === 'kickoff') {
      const back = mates.filter((q) => q.role === 'MID').sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
      return { kind: 'pass', receiver: back };
    }
    if (r.type === 'penalty') return { kind: 'shoot' };
    if (r.type === 'corner') return { kind: 'cross' };
    if (r.type === 'goalkick') {
      const fwd = mates.filter((q) => q.role !== 'DEF').sort((a, b) => b.pos.x * p.team.dir - a.pos.x * p.team.dir)[0];
      return this.rnd() < 0.5 ? { kind: 'lob', receiver: fwd } : { kind: 'pass', receiver: mates.filter((q) => q.role === 'DEF')[Math.floor(this.rnd() * 4)] };
    }
    const near = mates.sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos)).slice(0, 3);
    return { kind: r.type === 'throw' ? 'throw' : 'pass', receiver: near[Math.floor(this.rnd() * near.length)] };
  }

  humanRestart(p, r, input) {
    if (input.pass || input.through) {
      const recv = this.pickReceiver(p, input.move, input.through);
      if (r.type === 'throw') this.executePlan(p, { kind: 'throw', receiver: recv });
      else if (r.type === 'corner') this.executePlan(p, { kind: 'cross', receiver: recv });
      else this.executePlan(p, { kind: input.through ? 'through' : 'pass', receiver: recv });
    } else if (input.lob) {
      const recv = this.pickReceiver(p, input.move, false, true);
      this.executePlan(p, { kind: r.type === 'throw' ? 'throw' : r.type === 'corner' ? 'cross' : 'lob', receiver: recv });
    } else if (input.shootRelease && r.type !== 'throw') {
      this.executePlan(p, { kind: 'shoot', power: input.shootPower, aim: input.move });
    }
  }

  // ---------------------------------------------------------------- selection

  updateHumanSelection(input) {
    const T = this.humanTeam;
    if (!T || !this.human) return;
    const ball = this.ball.pos;
    if (this.owner && this.owner.team === T && this.owner !== this.human) this.human = this.owner;
    if (this.pass && this.pass.team === T && this.pass.to && this.pass.fresh) {
      this.human = this.pass.to;
      this.pass.fresh = false;
    }
    if (this.state !== 'play') return;
    const mine = this.owner?.team === T;
    if (input?.switch) {
      // Nearest interceptor that is not the current one.
      const list = T.players.filter((q) => q.role !== 'GK' && q !== this.human)
        .sort((a, b) => this.interceptScore(a) - this.interceptScore(b));
      if (list[0]) this.human = list[0];
    } else if (!mine && this.owner && this.owner.team !== T) {
      if (this.lostAt !== this.owner) {
        this.lostAt = this.owner;
        const best = T.players.filter((q) => q.role !== 'GK').sort((a, b) => this.interceptScore(a) - this.interceptScore(b))[0];
        if (best && this.human.pos.distanceTo(ball) > best.pos.distanceTo(ball) + 5) this.human = best;
      }
    } else if (mine) this.lostAt = null;
    // Loose ball or an opponent's pass: hand control to whoever gets there first.
    if (!this.owner && !(this.pass && this.pass.team === T) && !this.human.lunge && !this.human.busy
      && this.time > (this.switchAt || 0) && !input?.switch) {
      const best = T.players.filter((q) => q.role !== 'GK' && !q.busy).sort((a, b) => this.interceptScore(a) - this.interceptScore(b))[0];
      if (best && best !== this.human && this.interceptScore(this.human) - this.interceptScore(best) > 0.5) {
        this.human = best;
        this.switchAt = this.time + 0.8;
      }
    }
    if (input?.switch) this.switchAt = this.time + 1.2;
    if (this.human.role === 'GK' && !(this.owner === this.human)) {
      const best = T.players.filter((q) => q.role !== 'GK').sort((a, b) => this.interceptScore(a) - this.interceptScore(b))[0];
      this.human = best;
    }
  }

  // Where the human's player should be heading for the ball: the meeting
  // point for a loose ball or pass, or the carrier's feet when defending.
  assistTarget(p) {
    if (this.state !== 'play') return null;
    const o = this.owner;
    if (o && o.team !== p.team) {
      return this.ball.pos.clone().setY(0).addScaledVector(o.vel, 0.35);
    }
    if (o) return null;
    if (this.pass?.to === p && this.pass.kind === 'pass') return this.ball.pos.clone().setY(0);
    const c = this.chasers.get(p);
    return c ? c.point.clone().setY(0) : this.ball.pos.clone().setY(0);
  }

  interceptScore(p) {
    const c = this.chasers.get(p);
    return c ? c.t : p.pos.distanceTo(this.ball.pos) / p.maxSpeed;
  }

  // ---------------------------------------------------------------- players

  updatePlayers(dt, input) {
    const playing = this.state === 'play';
    if (playing || this.state === 'dead' || this.state === 'kickoff') {
      this.pathCache = this.ball.path(3, 0.1);
      this.chasers = chooseChasers(this, this.pathCache);
    }
    for (const t of this.teams) {
      const shape = teamShape(this, t);
      for (const p of t.players) {
        p.kickLock = Math.max(0, p.kickLock - dt);
        p.stun = Math.max(0, p.stun - dt);
        p.touchCd = Math.max(0, p.touchCd - dt);
        if (p.action) { p.action.t += dt; if (p.action.t >= p.action.dur) p.action = null; }
        if (p.celebrate > 0) p.celebrate -= dt;
        p.face = null;
        p.lookAt.copy(this.ball.pos);
        const isHuman = p === this.human && (playing || this.state === 'dead' && this.restart?.taker === p || this.state === 'kickoff' && this.restart?.taker === p);
        if (this.state === 'intro') {
          p.target.copy(p.pos);
          p.targetSpeed = 0;
          p.face = new THREE.Vector3(0, 0, 0);
        } else if (this.state === 'goal') {
          this.celebrationTargets(p);
        } else if (this.state === 'halftime' || this.state === 'fulltime') {
          p.target.set(p.pos.x * 0.98, 0, p.pos.z * 0.98 + 0.02 * (HW + 8));
          p.targetSpeed = 1.3;
        } else if (isHuman && playing) {
          this.humanMove(p, input, dt);
        } else if (this.state === 'kickoff' || this.state === 'dead') {
          this.setPieceTargets(p, shape);
        } else {
          this.aiMove(p, shape, dt);
        }
        this.integrate(p, dt, isHuman && playing ? input : null);
      }
    }
    this.separate();
  }

  celebrationTargets(p) {
    const g = this.goals[this.goals.length - 1];
    if (!g) return;
    const scorer = g.scorer;
    if (p.team === g.team) {
      if (p === scorer) {
        const corner = new THREE.Vector3(Math.sign(g.side) * (HL - 3), 0, Math.sign(scorer.pos.z || 1) * (HW - 3));
        p.target.copy(corner);
        p.targetSpeed = this.stateT < 2.5 ? 7 : 0;
        if (this.stateT > 1.2 && this.stateT < 1.3 && !p.celebrated) {
          p.celebrated = true;
          p.anim('celebrate', { dur: 3.6, dance: this.rnd() < 0.4 });
        }
      } else if (p.role !== 'GK') {
        p.target.copy(scorer.pos).addScaledVector(_v.set(Math.cos(p.index), 0, Math.sin(p.index)), 1.4);
        p.targetSpeed = 6.5;
      } else { p.targetSpeed = 1; p.target.copy(p.pos); }
    } else {
      p.targetSpeed = p.index % 3 === 0 ? 0.8 : 0;
      p.target.copy(p.pos).addScaledVector(p.forward(_v), 0.5);
    }
  }

  setPieceTargets(p, shape) {
    const r = this.restart;
    if (r?.taker === p) { p.targetSpeed = p.pos.distanceTo(p.target) > 6 ? 6.5 : 3.5; return; }
    const s = shape.get(p);
    p.target.copy(s);
    p.targetSpeed = 5;
    if (!r) return;
    const att = r.team === p.team;
    const goal = att ? p.team.attackGoal : p.team.ownGoal;
    if (r.type === 'corner' || r.type === 'freekick' && r.pos.distanceTo(r.team.attackGoal) < 32) {
      // Set piece in the box: attackers crash it, defenders pick men up.
      const inBox = att ? p.role !== 'GK' && p.index > 1 && p.index !== 4 : p.role !== 'GK';
      if (inBox) {
        const i = p.index;
        const spread = ((i * 37) % 11) / 10 - 0.5;
        p.target.set(goal.x - Math.sign(goal.x) * (att ? 7 + (i % 4) * 2.2 : 4 + (i % 3) * 2), 0, spread * 22);
      }
    }
    if (r.type === 'penalty') {
      if (p.role === 'GK' && !att) { p.target.copy(goal); p.face = new THREE.Vector3(0, 0, 0); }
      else if (p.role !== 'GK') {
        const gx = r.pos.x;
        p.target.set(gx - Math.sign(gx) * (5 + (p.index % 5) * 1.3), 0, ((p.index % 6) - 2.5) * 5 + (att ? 1.2 : -1.2));
      }
    }
    if (r.type === 'kickoff' || r.type === 'goalkick' || r.type === 'freekick') {
      if (!att && p.pos.distanceTo(r.pos) < 9.15) p.target.copy(r.pos).addScaledVector(_v.subVectors(p.target, r.pos).setY(0).normalize(), 9.5);
    }
    if (r.type === 'kickoff') {
      p.target.x = p.team.dir > 0 ? Math.min(p.target.x, -0.5) : Math.max(p.target.x, 0.5);
      if (p !== r.taker && r.team === p.team && p.index === 10) p.target.set(-p.team.dir * 0.2, 0, 3);
    }
    if (p.role === 'GK' && r.type !== 'goalkick' && r.type !== 'penalty') p.target.copy(keeperTarget(this, p));
  }

  aiMove(p, shape, dt) {
    const T = p.team;
    const ball = this.ball;
    if (p === this.owner) { this.carrierAI(p, dt); return; }
    // A pass names its receiver. That player (whoever he is) goes to the ball.
    if (this.pass && this.pass.to === p && !this.owner) {
      const dest = this.pass.kind === 'pass' ? ball.pos : (this.receptionPoint(p) || ball.pos);
      p.target.copy(dest).setY(0);
      p.targetSpeed = p.maxSpeed;
      p.face = ball.pos;
      this.tryHeader(p);
      return;
    }
    if (p.role === 'GK') { this.keeperAI(p, dt); return; }
    const chase = this.chasers.get(p);
    const mine = this.owner?.team === T;
    const theirs = this.owner && !mine;
    if (!this.owner && chase?.lead) {
      p.target.copy(chase.point).setY(0);
      p.targetSpeed = p.maxSpeed;
      if (chase.t < 0.35) p.face = ball.pos;
      this.tryHeader(p);
      return;
    }
    if (theirs) {
      const d = defendTargets(this, T, shape);
      const job = d.get(p);
      if (job) {
        p.target.copy(job.point);
        p.targetSpeed = job.speed;
        if (job.press) this.maybeTackle(p, dt);
        return;
      }
    }
    if (mine) {
      const s = supportTargets(this, T, shape);
      const job = s.get(p);
      if (job) { p.target.copy(job.point); p.targetSpeed = job.speed; return; }
    }
    p.target.copy(shape.get(p));
    const dist = p.pos.distanceTo(p.target);
    p.targetSpeed = dist > 12 ? 6.2 : dist > 4 ? 4.8 : 2.6;
  }

  humanMove(p, input, dt) {
    const mv = input?.move || { x: 0, z: 0 };
    const mag = Math.min(1, Math.hypot(mv.x, mv.z));
    const sprint = input?.sprint;
    const top = sprint ? p.maxSpeed : Math.min(p.maxSpeed, 5.6);
    const owner = this.owner === p;
    // Tackle lunge: close the last metres onto the ball, then poke it.
    if (p.lunge) {
      const o = this.owner;
      p.lunge.t -= dt;
      if (!o || o.team === p.team) { p.lunge = null; }
      else {
        p.target.copy(this.ball.pos).setY(0).addScaledVector(o.vel, 0.12);
        p.targetSpeed = p.maxSpeed * 1.05;
        p.face = this.ball.pos;
        if (p.touchPoint(_v).distanceTo(this.ball.pos) < 1.25 || p.lunge.t <= 0) {
          p.lunge = null;
          this.startTackle(p, false);
        }
        return;
      }
    }
    const assist = owner ? null : this.assistTarget(p);
    if (mag > 0.05) {
      let dx = mv.x / mag, dz = mv.z / mag;
      // Stick roughly toward the ball: bend the run onto the meeting point.
      if (assist) {
        const tx = assist.x - p.pos.x, tz = assist.z - p.pos.z;
        const tl = Math.hypot(tx, tz);
        if (tl > 0.3) {
          const cos = (dx * tx + dz * tz) / tl;
          if (cos > 0.35) {
            const k = THREE.MathUtils.clamp((cos - 0.35) / 0.4, 0, 1) * 0.85;
            dx = dx * (1 - k) + tx / tl * k;
            dz = dz * (1 - k) + tz / tl * k;
            const l = Math.hypot(dx, dz);
            dx /= l; dz /= l;
          }
        }
      }
      p.target.set(p.pos.x + dx * 4, 0, p.pos.z + dz * 4);
      p.targetSpeed = top * mag;
      p.intent.set(dx, 0, dz);
    } else if (assist && (this.pass?.to === p || !this.owner && assist.distanceTo(p.pos) < 12)) {
      // No stick: run onto a pass meant for him, or a loose ball nearby.
      p.target.copy(assist).setY(0);
      p.targetSpeed = Math.max(5.2, top);
      p.face = this.ball.pos;
    } else {
      p.target.copy(p.pos);
      p.targetSpeed = 0;
      p.intent.set(0, 0, 0);
      if (!owner) p.face = this.ball.pos;
    }
    if (!input) return;
    if (owner) {
      if (p.pendingKick) return;
      if (input.pass) this.executePlan(p, { kind: 'pass', receiver: this.pickReceiver(p, mv, false) });
      else if (input.through) this.executePlan(p, { kind: 'through', receiver: this.pickReceiver(p, mv, true) });
      else if (input.lob) {
        const wide = Math.abs(p.pos.z) > HW - 18 && p.pos.x * p.team.dir > HL - 36;
        this.executePlan(p, wide ? { kind: 'cross', receiver: null } : { kind: 'lob', receiver: this.pickReceiver(p, mv, false, true) });
      } else if (input.shootRelease) this.executePlan(p, { kind: 'shoot', power: input.shootPower, aim: mv });
    } else {
      const ballNear = p.pos.distanceTo(this.ball.pos) < 2.2;
      if (this.owner && this.owner.team !== p.team) {
        const reach = p.pos.distanceTo(this.ball.pos);
        if (input.tackle) {
          if (reach < 4 && !p.busy) p.lunge = { t: 0.45 };
          else this.startTackle(p, false);
        } else if (input.slide) this.startTackle(p, true);
      } else if (!this.owner) {
        // First-time finish or header on a loose/aerial ball.
        if ((input.shootRelease || input.pass || input.lob) && ballNear) {
          p.buffered = { kind: input.shootRelease ? 'shoot' : input.lob ? 'lob' : 'pass', power: input.shootPower, aim: { ...mv }, t: this.time };
        }
        if (input.slide && ballNear) this.startTackle(p, true);
        if (p.buffered && this.ball.pos.y > 1.2) this.tryHeader(p, true);
      }
    }
  }

  integrate(p, dt, input) {
    const prevYaw = p.yaw;
    if (p.slide) {
      const s = p.slide;
      s.t += dt;
      s.speed = Math.max(0, s.speed - 7.5 * dt);
      p.vel.copy(s.dir).multiplyScalar(s.speed);
      p.pos.addScaledVector(p.vel, dt);
      this.slideContact(p);
      if (s.t > ACTION_DUR.slide) { p.slide = null; p.stun = 0.35; }
    } else if (p.dive) {
      const d = p.dive;
      d.t += dt;
      const k = d.t < d.dur ? 1 : 0;
      p.vel.copy(d.vel).multiplyScalar(k * Math.max(0, 1 - d.t / (d.dur + 0.2)));
      p.pos.addScaledVector(p.vel, dt);
      if (d.t > ACTION_DUR.dive) { p.dive = null; p.stun = 0.4; }
    } else {
      const toT = _v.subVectors(p.target, p.pos).setY(0);
      const dist = toT.length();
      let want = p.busy ? 0 : Math.min(p.targetSpeed, dist * 2.2);
      if (p.pendingKick) want *= 0.35;
      if (p.action?.type === 'throw') want = 0;
      const desired = dist > 1e-3 ? toT.multiplyScalar(want / dist) : toT.set(0, 0, 0);
      const dv = _w.subVectors(desired, p.vel).setY(0);
      const cur = p.speed;
      // Sharp turns at speed cost momentum; accelerating is slower than stopping.
      const turning = cur > 3 && desired.lengthSq() > 0.01 && p.vel.dot(desired) / (cur * desired.length()) < 0.2;
      const acc = (desired.length() < cur || turning ? 11 : 6.2) * (p.role === 'GK' ? 1.3 : 1);
      const dl = dv.length();
      if (dl > acc * dt) dv.multiplyScalar(acc * dt / dl);
      p.vel.add(dv);
      p.pos.addScaledVector(p.vel, dt);
    }
    p.pos.y = 0;
    p.pos.x = THREE.MathUtils.clamp(p.pos.x, -HL - 4.5, HL + 4.5);
    p.pos.z = THREE.MathUtils.clamp(p.pos.z, -HW - 4, HW + 4);

    // Facing: the ball when set, else the way he runs.
    let faceYaw = null;
    if (p.slide || p.dive) faceYaw = null;
    else if (p.face && p.speed < 3.5) {
      _v.subVectors(p.face, p.pos);
      if (_v.x * _v.x + _v.z * _v.z > 0.01) faceYaw = Math.atan2(_v.x, _v.z);
    } else if (p.speed > 0.5) faceYaw = Math.atan2(p.vel.x, p.vel.z);
    if (this.owner === p && p.pendingKick) faceYaw = p.pendingKick.yaw ?? faceYaw;
    if (faceYaw !== null) {
      let d = faceYaw - p.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const rate = (this.owner === p ? 7 : 10) * dt;
      p.yaw += THREE.MathUtils.clamp(d, -rate, rate);
    }
    let dy = p.yaw - prevYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.turnRate = p.turnRate * 0.8 + (dy / Math.max(dt, 1e-3)) * 0.2;
    const fwd = p.forward(_v), left = p.left(_w);
    const sp = p.speed;
    if (sp > 0.05) p.localDir.set(p.vel.dot(left) / sp, 0, p.vel.dot(fwd) / sp);
    else p.localDir.set(0, 0, 1);
  }

  separate() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        const min = 0.72;
        if (d2 < min * min && d2 > 1e-6) {
          if (a.slide || b.slide || a.dive || b.dive) continue;
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  // ---------------------------------------------------------------- ball control

  updateControl(dt) {
    const ball = this.ball;
    const o = this.owner;
    if (o) {
      const d = _v.subVectors(ball.pos, o.pos).setY(0).length();
      // A change of direction keeps the ball; it is only lost once it is gone.
      const limit = o.turning ? 3.2 : 1.9;
      if (!o.holding && (d > limit || o.busy || ball.pos.y > 1.2 && o.role !== 'GK')) this.loseBall(o);
    }
    if (!this.owner) this.tryControl();
    if (this.owner) this.dribble(this.owner, dt);
  }

  loseBall(p) {
    if (this.owner === p) {
      this.owner = null;
      p.holding = false;
    }
  }

  gainBall(p, how = 'control') {
    const prev = this.lastTouch?.player;
    this.owner = p;
    p.plan = null;
    p.localAt = null;
    this.lastTouch = { player: p, t: this.time };
    p.buffered = p.buffered && this.time - p.buffered.t < 0.45 ? p.buffered : null;
    if (this.pass) {
      const T = this.pass.team;
      if (T === p.team) { T.stats.completed++; }
      if (this.pass.to) this.pass.to.incoming = null;
      this.pass = null;
    }
    if (prev && prev.team !== p.team) this.emit({ type: 'turnover', team: p.team, player: p });
    this.emit({ type: 'control', player: p, how });
    this.brain?.onPossession(p);
  }

  tryControl() {
    const ball = this.ball;
    if (ball.pos.y > 2.6) return;
    let best = null, bd = Infinity, bestClean = false;
    for (const p of this.players) {
      if (p.kickLock > 0 || p.busy && !(p.dive && p.role === 'GK')) continue;
      const keeperHands = p.role === 'GK' && this.inOwnBox(p, ball.pos);
      // Feet, thigh or chest: anything up to 1.6 m can be trapped.
      const maxY = keeperHands ? 2.5 : 1.6;
      if (ball.pos.y > maxY) continue;
      const tp = p.touchPoint(_v);
      const dTouch = Math.hypot(ball.pos.x - tp.x, ball.pos.z - tp.z);
      const dBody = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
      const d = Math.min(dTouch, dBody);
      const reach = keeperHands ? 1.15 : ball.pos.y > 0.75 ? 0.55 : 0.62 + Math.min(0.25, p.speed * 0.03) + (p === this.human ? 0.35 : 0);
      if (d < reach && d < bd) { bd = d; best = p; bestClean = dBody < 0.55 || dTouch < 0.45; }
    }
    if (!best) return;
    const rel = _w.subVectors(ball.vel, best.vel);
    const relSpeed = rel.length();
    const keeperHands = best.role === 'GK' && this.inOwnBox(best, ball.pos);
    if (keeperHands) {
      if (relSpeed > 26 * (0.8 + best.def.keeping * 0.3) && ball.pos.y > 0.3) return;
      this.keeperCollect(best);
      return;
    }
    // Stretching to cut out a driven pass takes anticipation: one chance per
    // player. A defender standing in the lane just takes it.
    const pass = this.pass;
    if (pass && pass.team !== best.team && relSpeed > 6 && !bestClean) {
      pass.tried ??= new Set();
      if (pass.tried.has(best)) return;
      pass.tried.add(best);
      const chance = THREE.MathUtils.clamp(0.85 - (relSpeed - 6) * 0.07, 0.15, 0.85) * (0.6 + best.def.tackling * 0.5);
      if (this.rnd() >= chance) return;
    }
    // Only a genuinely hard strike can bounce off a player.
    if (this.shot && relSpeed > 24 && this.rnd() < 0.5) {
      ball.vel.multiplyScalar(-0.25).add(best.vel);
      ball.vel.y = Math.abs(ball.vel.y) * 0.3 + 0.8;
      this.lastTouch = { player: best, t: this.time };
      best.kickLock = 0.25;
      this.emit({ type: 'miscontrol', player: best });
      return;
    }
    ball.vel.lerp(best.vel, 0.82);
    ball.vel.y = Math.min(0, ball.vel.y) * 0.2;
    ball.spin.multiplyScalar(0.2);
    if (ball.pos.y > 0.75) {
      // Chest/thigh trap: kill it and drop it at his feet.
      best.touchPoint(ball.pos);
      ball.vel.copy(best.vel).setY(0);
      best.anim('touch', { foot: 'Right', power: 0.15, style: 'pass' });
    }
    this.gainBall(best);
    if (best.buffered) {
      const b = best.buffered;
      best.buffered = null;
      this.executePlan(best, b.kind === 'shoot' ? { kind: 'shoot', power: b.power, aim: b.aim, firstTime: true }
        : { kind: b.kind, receiver: this.pickReceiver(best, b.aim, false, b.kind === 'lob'), firstTime: true });
    }
  }

  keeperCollect(k) {
    const ball = this.ball;
    const fast = ball.speed;
    this.gainBall(k, 'catch');
    k.holding = true;
    k.holdT = 0;
    ball.vel.set(0, 0, 0);
    ball.spin.set(0, 0, 0);
    this.emit({ type: fast > 12 ? 'save' : 'catch', player: k, speed: fast });
    if (this.shot && this.shot.team !== k.team) { this.shot.team.stats.onTarget++; this.shot = null; }
  }

  inOwnBox(p, at) {
    const x = at.x * -p.team.dir;
    return x > HL - PITCH.penaltyDepth - 0.3 && Math.abs(at.z) < PITCH.penaltyHalfWidth + 0.3;
  }

  // Close control with visible touches: the ball is pushed ahead and the
  // player runs onto it. Sprinting pushes it further (easier to nick).
  dribble(p, dt) {
    const ball = this.ball;
    if (p.holding) {
      p.holdT += dt;
      const f = p.forward(_v);
      ball.pos.copy(p.pos).addScaledVector(f, 0.32).setY(1.05);
      ball.vel.copy(p.vel);
      ball.spin.set(0, 0, 0);
      if (!this.inOwnBox(p, p.pos)) { p.holding = false; ball.pos.y = R; }
      return;
    }
    const f = p.forward(_v);
    if (p.pendingKick) {
      const side = p.left(_w).multiplyScalar(p.pendingKick.foot === 'Left' ? 0.1 : -0.1);
      const spot = new THREE.Vector3().copy(p.pos).addScaledVector(f, 0.5).add(side).setY(R);
      ball.vel.subVectors(spot, ball.pos).multiplyScalar(6).add(p.vel).setY(0);
      return;
    }
    const sp = p.speed;
    const rel = new THREE.Vector3().subVectors(ball.pos, p.pos).setY(0);
    const ahead = rel.dot(f);
    const lat = rel.dot(p.left(_w));
    if (sp < 1.2) {
      const spot = new THREE.Vector3().copy(p.pos).addScaledVector(f, 0.45).setY(R);
      const pull = new THREE.Vector3().subVectors(spot, ball.pos).setY(0).multiplyScalar(3.5);
      ball.vel.x = p.vel.x + pull.x;
      ball.vel.z = p.vel.z + pull.z;
      return;
    }
    const moveDir = new THREE.Vector3().copy(p.vel).setY(0);
    // The direction he means to go (the stick, or where he is actually running).
    const intent = p.intent.lengthSq() > 0.04 ? p.intent : moveDir;
    const dir = intent.lengthSq() > 0.04 ? intent.clone().setY(0).normalize() : p.forward(new THREE.Vector3());
    // He has asked to go a different way but his run has not caught up yet.
    // Keep the ball at his feet, set just ahead in the new direction, until
    // he is actually running that way. The next touch then plays it on.
    const pv = Math.hypot(p.vel.x, p.vel.z);
    p.turning = pv > 1.2 && p.vel.dot(dir) / pv < 0.72;
    if (p.turning) {
      const spot = dir.clone().multiplyScalar(0.5);
      ball.vel.x = p.vel.x + (p.pos.x + spot.x - ball.pos.x) * 8;
      ball.vel.z = p.vel.z + (p.pos.z + spot.z - ball.pos.z) * 8;
      ball.vel.y = Math.min(0, ball.vel.y);
      return;
    }
    const ballSpeedAlong = ball.vel.dot(dir);
    const needTouch = p.touchCd <= 0 && (p.turning || ahead < 0.5 || Math.abs(lat) > 0.32 || ballSpeedAlong < sp * 0.92 && ahead < 1.0);
    if (needTouch) {
      const sprinting = sp > 6.5 && !p.turning;
      const push = p.turning
        ? Math.max(3.4, sp * 1.02)
        : sp * (sprinting ? 1.42 : 1.22) + (sprinting ? 1.4 : 0.55) + (this.rnd() - 0.5) * (sprinting ? 1.2 : 0.3);
      const corr = p.left(_w).multiplyScalar(-lat * 2.2);
      ball.vel.copy(dir).multiplyScalar(push).add(corr).setY(0);
      p.touchCd = sprinting ? 0.34 : 0.24;
      p.touchFoot = p.touchFoot === 'Left' ? 'Right' : 'Left';
      if (!p.action) p.anim('touch', { foot: p.touchFoot, power: 0.2, style: 'pass' });
      this.emit({ type: 'touch', player: p, speed: push });
    }
  }

  // ---------------------------------------------------------------- kicking

  // The teammate the pass is aimed at. With a direction held, the player
  // nearest that aim line is the receiver; everyone else knows it is not theirs.
  pickReceiver(p, aim, through = false, lofted = false) {
    const mates = p.team.players.filter((q) => q !== p && !q.busy && q.role !== 'GK');
    const aimed = !!(aim && Math.hypot(aim.x, aim.z) > 0.2);
    const dir = aimed ? new THREE.Vector3(aim.x, 0, aim.z).normalize() : p.forward(new THREE.Vector3());
    const quarter = HL / 2;
    let best = null, bs = -Infinity;
    for (const q of mates) {
      const rel = _v.subVectors(q.pos, p.pos).setY(0);
      const dist = rel.length();
      if (dist < 4 || dist > 60) continue;
      const along = rel.dot(dir);
      if (along < 1.5) continue;
      const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
      if (aimed && perp > 8 && along / dist < 0.55) continue;
      // Distance off the aim line decides it. Players inside a quarter of
      // the pitch are the ones a ground pass is meant to find.
      let s = -perp * 3 + (along <= quarter ? 2 : 0) - Math.max(0, along - quarter) * 0.12;
      if (through) s += (q.pos.x - p.pos.x) * p.team.dir * 0.06 + (q.run ? 3 : 0);
      if (!aimed) s += this.openness(q) * 4 + (lofted ? 0.5 : laneOpen(this, p.pos, q.pos)) * 3;
      if (s > bs) { bs = s; best = q; }
    }
    if (!best) {
      // Nobody ahead, as at a kick-off: the nearest teammate takes it.
      let bd = Infinity;
      for (const q of mates) {
        const rel = _w.subVectors(q.pos, p.pos).setY(0);
        const d = rel.length();
        if (d < 3 || (aimed && rel.dot(dir) < 0)) continue;
        if (d < bd) { bd = d; best = q; }
      }
    }
    return best;
  }

  // Where a named receiver should meet a ball played into space.
  receptionPoint(p) {
    const path = this.pathCache;
    if (!path) return this.ball.pos.clone();
    for (const s of path) {
      if (s.pos.y > 2) continue;
      const d = Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z);
      if (d / p.maxSpeed <= s.t + 0.2) return s.pos.clone();
    }
    return (path[path.length - 1]?.pos || this.ball.pos).clone();
  }

  // 0 = tightly marked, 1 = nobody within 8 m.
  openness(q) {
    let md = Infinity;
    for (const o of q.team.opp.players) md = Math.min(md, o.pos.distanceTo(q.pos));
    return THREE.MathUtils.clamp((md - 1) / 7, 0, 1);
  }

  pressureOn(p) {
    let md = Infinity, who = null;
    for (const o of p.team.opp.players) {
      const d = o.pos.distanceTo(p.pos);
      if (d < md) { md = d; who = o; }
    }
    return { dist: md, who };
  }

  // Turns a plan ({ kind, receiver, power, aim, dir }) into a kick or a run.
  executePlan(p, plan) {
    if (!plan) return false;
    const ball = this.ball;
    const T = p.team;
    const pr = this.pressureOn(p);
    const pressure = THREE.MathUtils.clamp(1.6 - pr.dist / 2, 0, 1);
    const errScale = this.humanTeam === T ? 0.45 * (1 + pressure * 0.3) : (1 / this.difficultyScale()) * (1 + pressure * 0.8);
    const kind = plan.kind;
    if (kind === 'dribble' || kind === 'shield') {
      p.plan = plan;
      return true;
    }
    const spec = { kind, plan };
    const from = ball.pos;
    if (kind === 'pass' || kind === 'through') {
      const q = plan.receiver;
      if (!q) return this.executePlan(p, { kind: 'dribble', dir: T.attackGoal.clone().sub(p.pos).normalize() });
      let target;
      let arrive;
      if (kind === 'through') {
        const run = q.vel.lengthSq() > 4 ? q.vel.clone().normalize() : T.attackGoal.clone().sub(q.pos).setY(0).normalize();
        target = q.pos.clone().addScaledVector(run, 7 + q.speed * 0.6).setY(R);
        arrive = 2.5;
      } else {
        // A pass is played to that player. Inside a quarter of the pitch it
        // is driven hard enough to reach him with pace.
        const dist = Math.max(1, from.distanceTo(q.pos));
        target = q.pos.clone().addScaledVector(q.vel, dist <= HL / 2 ? 0.18 : 0.3).setY(R);
        arrive = dist <= HL / 2 + 3 ? Math.min(14, 8.5 + dist * 0.18) : Math.min(12, 6 + dist * 0.1);
      }
      target.x = THREE.MathUtils.clamp(target.x, -HL + 1, HL - 1);
      target.z = THREE.MathUtils.clamp(target.z, -HW + 1, HW - 1);
      const err = (0.028 + (1 - p.def.passing) * 0.05) * errScale;
      spec.velocity = () => groundPass(ball.pos, target, { error: err, rnd: this.rnd, arrive });
      spec.receiver = q;
      spec.target = target;
      spec.style = 'pass';
      spec.power = Math.min(1, from.distanceTo(target) / 40);
    } else if (kind === 'lob' || kind === 'cross' || kind === 'clear' || kind === 'throw') {
      let q = plan.receiver;
      let target;
      if (kind === 'cross') {
        const g = T.attackGoal;
        const inBox = T.players.filter((m) => m !== p && Math.abs(m.pos.x - g.x) < 18 && Math.abs(m.pos.z) < 20);
        q = q || inBox.sort((a, b) => this.openness(b) - this.openness(a))[0] || null;
        const far = -Math.sign(p.pos.z || 1);
        target = q ? leadTarget(from, q.pos, q.vel, 0.6) : new THREE.Vector3(g.x - Math.sign(g.x) * 8, R, far * 3);
      } else if (kind === 'clear') {
        target = p.pos.clone().addScaledVector(T.attackGoal.clone().sub(p.pos).setY(0).normalize(), 38);
        target.z = THREE.MathUtils.clamp(target.z + (this.rnd() - 0.5) * 20, -HW + 3, HW - 3);
        target.x = THREE.MathUtils.clamp(target.x, -HL + 5, HL - 5);
      } else {
        if (!q) q = this.pickReceiver(p, null, false, true);
        target = q ? leadTarget(from, q.pos, q.vel, 0.9) : p.pos.clone().addScaledVector(p.forward(_v), 25);
      }
      const dist = from.distanceTo(target);
      const angle = kind === 'throw' ? 0.35 : kind === 'clear' ? 0.62 : kind === 'cross' ? 0.42 : THREE.MathUtils.clamp(0.3 + dist * 0.006, 0.32, 0.62);
      const err = (kind === 'clear' ? 0.08 : 0.035 + (1 - p.def.passing) * 0.05) * errScale;
      spec.velocity = () => {
        const v = loftedPass(ball.pos, target, angle, { error: err, rnd: this.rnd });
        if (kind === 'throw') v.multiplyScalar(Math.min(1, 14 / v.length()));
        return v;
      };
      spec.spin = kind === 'cross' ? new THREE.Vector3(0, -Math.sign(p.pos.z) * T.dir * 12, 0) : null;
      spec.receiver = q;
      spec.target = target;
      spec.style = kind === 'throw' ? 'throw' : 'shot';
      spec.loft = 1;
      spec.power = Math.min(1, dist / 45);
    } else if (kind === 'shoot' || kind === 'header') {
      const g = T.attackGoal;
      const keeper = T.opp.keeper;
      const dist = from.distanceTo(g);
      let aimZ;
      if (plan.aim && Math.abs(plan.aim.z * T.dir) > 0.2 && this.humanTeam === T) aimZ = THREE.MathUtils.clamp(plan.aim.z * 3.6, -3.2, 3.2);
      else {
        const side = keeper.pos.z > from.z * 0.2 ? -1 : 1;
        aimZ = side * (GOAL.halfWidth - 0.55 - this.rnd() * 0.6);
      }
      const power = plan.power ?? THREE.MathUtils.clamp(0.55 + dist / 45, 0.6, 0.95);
      const baseH = kind === 'header' ? 0.4 : 0.25 + power * power * 1.55;
      const target = new THREE.Vector3(g.x, THREE.MathUtils.clamp(baseH + (this.rnd() - 0.4) * 0.5, 0.2, 2.2), aimZ);
      if (power > 0.93) target.y += (power - 0.93) * 18;
      const speed = kind === 'header' ? 11 + power * 5 : 16 + power * 15;
      const err = (0.018 + (1 - p.def.shooting) * 0.05) * errScale * (0.5 + power) * (kind === 'header' ? 1.6 : 1) * (plan.firstTime ? 1.25 : 1) * (1 + dist / 40);
      const curl = kind === 'shoot' && power < 0.75 ? -Math.sign(aimZ - from.z) * T.dir * 10 * (1 - power) : 0;
      spec.velocity = () => {
        const v = shotVelocity(ball.pos, target, speed, new THREE.Vector3(0, curl, 0));
        const yaw = gauss(this.rnd) * err, pitch = gauss(this.rnd) * err * 0.7;
        v.applyAxisAngle(UP, yaw);
        const side = new THREE.Vector3(-v.z, 0, v.x).normalize();
        v.applyAxisAngle(side, pitch);
        return v;
      };
      spec.spin = new THREE.Vector3(0, curl, 0);
      spec.target = target;
      spec.style = 'shot';
      spec.power = power;
      spec.shot = true;
      if (kind === 'header') {
        this.headBall(p, spec);
        return true;
      }
    } else if (kind === 'gkThrow') {
      const q = plan.receiver;
      const target = q ? leadTarget(from, q.pos, q.vel, 0.8) : p.pos.clone().addScaledVector(p.forward(_v), 20);
      spec.velocity = () => groundPass(new THREE.Vector3(ball.pos.x, R, ball.pos.z), target, { error: 0.03, rnd: this.rnd, arrive: 6 });
      spec.receiver = q;
      spec.style = 'throw';
    } else return false;

    // Face the kick, wind up, strike at contact time.
    const aimAt = spec.target || ball.pos.clone().add(p.forward(_v));
    const yaw = Math.atan2(aimAt.x - p.pos.x, aimAt.z - p.pos.z);
    const kickAnim = kind === 'throw' ? 'throw' : kind === 'gkThrow' ? 'throw' : spec.style === 'pass' && spec.power < 0.5 ? 'pass' : 'kick';
    const dur = plan.firstTime ? ACTION_DUR[kickAnim] * 0.75 : ACTION_DUR[kickAnim];
    const contact = kickAnim === 'throw' ? 0.62 : KICK.contact;
    p.pendingKick = { spec, at: this.time + dur * contact, yaw, foot: this.rnd() < 0.82 ? 'Right' : 'Left' };
    p.anim(kickAnim === 'pass' ? 'kick' : kickAnim, { foot: p.pendingKick.foot, power: spec.power ?? 0.5, loft: spec.loft || 0, style: spec.style, dur });
    p.plan = null;
    if (this.state === 'dead' || this.state === 'kickoff') p.restartKick = true;
    return true;
  }

  headBall(p, spec) {
    const ball = this.ball;
    const v = spec.velocity();
    ball.kick(v, new THREE.Vector3());
    p.anim('header');
    this.afterKick(p, spec);
    this.emit({ type: 'header', player: p });
  }

  updateKicks() {
    for (const p of this.players) {
      const k = p.pendingKick;
      if (!k || this.time < k.at) continue;
      p.pendingKick = null;
      const ball = this.ball;
      const reach = _v.subVectors(ball.pos, p.pos).setY(0).length();
      if (reach > 1.35 && !p.restartKick) continue;
      if (this.owner && this.owner !== p) continue;
      if (k.spec.kind === 'throw') ball.pos.copy(p.pos).addScaledVector(p.forward(_w), 0.3).setY(2.0);
      if (k.spec.kind === 'gkThrow') ball.pos.copy(p.pos).addScaledVector(p.forward(_w), 0.6).setY(0.4);
      const v = k.spec.velocity();
      ball.kick(v, k.spec.spin);
      this.afterKick(p, k.spec);
    }
  }

  afterKick(p, spec) {
    if (this.owner === p) this.owner = null;
    p.holding = false;
    p.kickLock = 0.32;
    this.lastTouch = { player: p, t: this.time };
    this.lastKick = { player: p, t: this.time, kind: spec.kind };
    const T = p.team;
    if (spec.receiver) {
      if (this.pass?.to) this.pass.to.incoming = null;
      this.pass = { from: p, to: spec.receiver, team: T, t: this.time, fresh: true, kind: spec.kind, target: spec.target ? spec.target.clone() : null };
      spec.receiver.incoming = this.pass;
      T.stats.passes++;
    } else this.pass = null;
    if (spec.shot) {
      T.stats.shots++;
      this.shot = { team: T, player: p, t: this.time };
      this.emit({ type: 'shot', player: p, power: spec.power });
    }
    this.emit({ type: 'kick', player: p, power: spec.power ?? 0.5, kind: spec.kind });
    if (p.restartKick) {
      p.restartKick = false;
      this.inbound = spec.kind === 'throw';
      if (this.state === 'dead' || this.state === 'kickoff') {
        this.state = 'play';
        this.stateT = 0;
        this.restart = null;
      }
    }
  }

  // ---------------------------------------------------------------- AI hooks

  carrierAI(p, dt) {
    const T = p.team;
    if (p.role === 'GK' && p.holding) {
      p.target.copy(p.pos);
      p.targetSpeed = 0;
      if (p.holdT > 1.4 && !p.pendingKick) {
        const plan = this.brain?.planFor(p) || this.localKeeperPlan(p);
        if (plan && p.holdT > 1.4) this.executePlan(p, plan);
      }
      return;
    }
    if (p.pendingKick) { p.target.copy(p.pos).addScaledVector(p.forward(_v), 1); p.targetSpeed = 1.5; return; }
    const plan = this.brain ? this.brain.planFor(p) : null;
    const use = plan || p.plan || this.localPlan(p);
    if (use.kind === 'dribble' || use.kind === 'shield') {
      const dir = use.dir || T.attackGoal.clone().sub(p.pos).setY(0).normalize();
      const pr = this.pressureOn(p);
      if (use.kind === 'shield') {
        p.target.copy(p.pos).addScaledVector(dir, 1.2);
        p.targetSpeed = 1.6;
      } else {
        const avoid = new THREE.Vector3();
        for (const o of T.opp.players) {
          const d = _v.subVectors(p.pos, o.pos).setY(0);
          const l = d.length();
          if (l < 6 && l > 0.01 && d.dot(dir) < 0.5 * l) avoid.addScaledVector(d, (6 - l) / (l * 6));
        }
        const goDir = dir.clone().addScaledVector(avoid, 1.1).normalize();
        p.intent.copy(goDir);
        p.target.copy(p.pos).addScaledVector(goDir, 5);
        p.target.x = THREE.MathUtils.clamp(p.target.x, -HL + 1, HL - 1);
        p.target.z = THREE.MathUtils.clamp(p.target.z, -HW + 1.5, HW - 1.5);
        p.targetSpeed = pr.dist > 6 ? p.maxSpeed * 0.95 : p.maxSpeed * 0.8;
      }
      if (!plan && !this.brain) {
        p.decideT = (p.decideT || 0) - dt;
        if (p.decideT <= 0) { p.plan = null; p.decideT = 0.6 + this.rnd() * 0.6; }
      }
      return;
    }
    this.executePlan(p, use);
    if (this.brain) this.brain.consume(p);
  }

  // Heuristic plan used when Jev is offline, slow, or unsure.
  localPlan(p) {
    if (p.plan) return p.plan;
    const pr = this.pressureOn(p).dist;
    p.localAt ??= this.time + (pr < 2 ? 0.1 : 0.4 + this.rnd() * 0.5);
    const best = carrierOptions(this, p)[0];
    if (this.time < p.localAt || !best) return { kind: 'dribble' };
    p.localAt = null;
    return best;
  }

  localKeeperPlan(p) {
    const mates = p.team.players.filter((q) => q !== p);
    const open = mates.filter((q) => q.role === 'DEF' && this.openness(q) > 0.5);
    if (open.length && this.rnd() < 0.6) return { kind: 'gkThrow', receiver: open[Math.floor(this.rnd() * open.length)] };
    const fwd = mates.filter((q) => q.role === 'FWD' || q.role === 'MID').sort((a, b) => this.openness(b) - this.openness(a))[0];
    return { kind: 'lob', receiver: fwd };
  }

  keeperAI(p, dt) {
    const ball = this.ball;
    const T = p.team;
    const goal = T.ownGoal;
    p.target.copy(keeperTarget(this, p));
    p.targetSpeed = 5.5;
    p.face = ball.pos;
    // Loose ball in the box that he can reach first: come and claim it.
    const c = this.chasers.get(p);
    if (!this.owner && c && c.lead && this.inOwnBox(p, c.point)) {
      p.target.copy(c.point).setY(0);
      p.targetSpeed = p.maxSpeed;
    }
    // Shot or through ball heading for goal: set, then dive.
    if (!this.owner && !p.dive && ball.speed > 7 && Math.sign(ball.vel.x) === -T.dir) {
      const path = this.pathCache;
      const line = goal.x;
      let cross = null;
      for (const s of path || []) {
        if ((s.pos.x - line) * -T.dir >= -0.4) {
          cross = s;
          break;
        }
      }
      if (cross && Math.abs(cross.pos.z) < GOAL.halfWidth + 1.2 && cross.pos.y < GOAL.height + 0.8) {
        const react = 0.2 + (1 - p.def.keeping) * 0.25 / this.difficultyScale();
        const since = this.time - (this.lastKick?.t ?? -9);
        // Where he meets the ball: his current line in front of goal.
        const meet = path.find((s) => (s.pos.x - p.pos.x) * -T.dir >= -0.2) || cross;
        const lateral = meet.pos.z - p.pos.z;
        const tLeft = meet.t;
        if (Math.abs(lateral) < 0.7 && meet.pos.y < 1.9) {
          p.target.set(p.pos.x, 0, meet.pos.z);
          p.targetSpeed = p.maxSpeed;
        } else if (since > react && tLeft < 1.1 && tLeft > 0.05) {
          const reach = Math.min(Math.abs(lateral), 2.9 * (0.85 + p.def.keeping * 0.25));
          const vel = new THREE.Vector3(0, 0, Math.sign(lateral) * reach / Math.max(0.28, tLeft));
          vel.z = THREE.MathUtils.clamp(vel.z, -7.5, 7.5);
          p.dive = { t: 0, dur: Math.max(0.3, tLeft + 0.1), vel, high: meet.pos.y > 1.3, side: Math.sign(lateral) };
          // Dive direction relative to his facing: left of body is +left vector.
          const leftDot = p.left(_v).z * Math.sign(lateral);
          p.anim('dive', { side: leftDot > 0 ? 1 : -1, high: meet.pos.y > 1.3 });
          this.emit({ type: 'dive', player: p });
        }
      }
    }
  }

  maybeTackle(p, dt) {
    const o = this.owner;
    if (!o || p.busy || p.action || p.kickLock > 0) return;
    const d = p.pos.distanceTo(o.pos);
    if (d > 1.9) return;
    const rate = (0.9 + p.def.tackling) * this.difficultyScale() * (this.inOwnBox(p, o.pos) ? 0.7 : 1);
    if (this.rnd() < rate * dt * 1.4) {
      const behind = o.forward(_v).dot(_w.subVectors(p.pos, o.pos).normalize()) < -0.3;
      this.startTackle(p, d > 1.4 && !behind && this.rnd() < 0.25);
    }
  }

  difficultyScale() { return [0.75, 1, 1.25][this.difficulty] ?? 1; }

  startTackle(p, slide) {
    if (p.busy || p.action && p.action.type !== 'touch' || p.kickLock > 0) return;
    if (slide) {
      let dir = p.speed > 1 ? p.vel.clone().setY(0).normalize() : p.forward(new THREE.Vector3());
      // Assisted slide: aim at where the ball will be when the boot arrives.
      if (p === this.human) {
        const aim = this.ball.predict(0.3, new THREE.Vector3()).sub(p.pos).setY(0);
        if (aim.length() < 7 && aim.length() > 0.2) dir = aim.normalize();
      }
      p.slide = { t: 0, dir, speed: Math.max(p.speed, 5.5) + 1.5, touched: false, fouled: false };
      p.anim('slide');
      this.emit({ type: 'slide', player: p });
      return;
    }
    p.anim('poke', { foot: 'Right', power: 0.5 });
    p.kickLock = 0;
    const o = this.owner;
    const tp = p.touchPoint(new THREE.Vector3());
    const d = tp.distanceTo(this.ball.pos);
    const human = p === this.human;
    if (!o || o.team === p.team || d > (human ? 1.7 : 1.3)) { p.stun = human ? 0.15 : 0.25; return; }
    const behind = o.forward(_v).dot(_w.subVectors(p.pos, o.pos).setY(0).normalize()) < -0.2;
    const chance = human
      ? (0.55 + p.def.tackling * 0.35) * (behind ? 0.7 : 1) / Math.sqrt(this.difficultyScale())
      : (0.28 + p.def.tackling * 0.45) * (behind ? 0.5 : 1) * (o.speed > 5 ? 0.75 : 1) * (this.humanTeam === p.team ? 1.15 : this.difficultyScale());
    if (this.rnd() < chance) {
      this.loseBall(o);
      o.kickLock = 0.45;
      o.stun = 0.25;
      if (this.rnd() < 0.55) {
        this.ball.pos.copy(tp);
        this.ball.vel.copy(p.vel);
        this.gainBall(p, 'tackle');
      } else {
        const away = new THREE.Vector3(this.rnd() - 0.5, 0, this.rnd() - 0.5).normalize();
        this.ball.vel.copy(away.multiplyScalar(3 + this.rnd() * 3));
        this.lastTouch = { player: p, t: this.time };
      }
      this.emit({ type: 'tackle', player: p, victim: o });
    } else {
      p.stun = 0.45;
      if (behind && this.rnd() < 0.3) this.foul(p, o);
    }
  }

  slideContact(p) {
    const s = p.slide;
    if (s.t < 0.08 || s.t > 0.75) return;
    const ball = this.ball;
    const foot = p.pos.clone().addScaledVector(s.dir, 0.85);
    if (!s.touched && ball.pos.y < 0.5 && foot.distanceTo(ball.pos) < 0.75) {
      s.touched = true;
      const o = this.owner;
      if (o) { this.loseBall(o); o.kickLock = 0.5; }
      const side = new THREE.Vector3(-s.dir.z, 0, s.dir.x).multiplyScalar((this.rnd() - 0.5) * 6);
      ball.vel.copy(s.dir).multiplyScalar(5 + this.rnd() * 4).add(side);
      this.lastTouch = { player: p, t: this.time };
      this.emit({ type: 'tackle', player: p, victim: o, slide: true });
    }
    for (const o of p.team.opp.players) {
      if (s.fouled || o.busy) continue;
      if (o.pos.distanceTo(p.pos.clone().addScaledVector(s.dir, 0.5)) < 0.75) {
        s.fouled = true;
        o.anim('fall', { back: this.rnd() < 0.4 });
        o.stun = ACTION_DUR.fall;
        if (this.owner === o) this.loseBall(o);
        if (!s.touched && (o === this.lastTouch?.player || o.pos.distanceTo(ball.pos) < 2.5)) this.foul(p, o);
      }
    }
  }

  foul(offender, victim) {
    if (this.state !== 'play') return;
    const T = victim.team;
    this.emit({ type: 'foul', player: offender, victim });
    victim.anim('fall', { back: false });
    victim.stun = ACTION_DUR.fall;
    const at = victim.pos.clone();
    const inBox = this.inOwnBox(offender, at);
    this.emit({ type: 'whistle', kind: 'foul' });
    this.awardRestart(inBox ? 'penalty' : 'freekick', T, inBox ? T.attackGoal : at);
  }

  tryHeader(p, human = false) {
    const ball = this.ball;
    if (p.kickLock > 0 || p.busy || p.action) return;
    if (ball.pos.y < 1.35 || ball.pos.y > 2.7) return;
    const head = p.pos.clone().setY(1.75);
    if (head.distanceTo(ball.pos) > 0.85) return;
    const T = p.team;
    const g = T.attackGoal;
    const nearGoal = Math.abs(p.pos.x - g.x) < 18 && Math.abs(p.pos.z) < 16;
    let plan;
    if (human && p.buffered) {
      plan = p.buffered.kind === 'shoot' ? { kind: 'header', power: 0.8, aim: p.buffered.aim } : null;
      if (!plan) {
        const q = this.pickReceiver(p, p.buffered.aim, false);
        plan = q ? { kind: 'headPass', receiver: q } : { kind: 'header', power: 0.5 };
      }
      p.buffered = null;
    } else if (nearGoal) plan = { kind: 'header', power: 0.7 };
    else if (Math.abs(p.pos.x - T.ownGoal.x) < 25) plan = { kind: 'headClear' };
    else plan = { kind: 'headPass', receiver: this.pickReceiver(p, null, false) };
    if (plan.kind === 'header') { this.executePlan(p, plan); return; }
    const target = plan.kind === 'headClear' || !plan.receiver
      ? p.pos.clone().addScaledVector(T.attackGoal.clone().sub(p.pos).setY(0).normalize(), 18)
      : plan.receiver.pos.clone();
    const v = loftedPass(ball.pos, target, 0.5, { error: 0.08, rnd: this.rnd });
    v.multiplyScalar(Math.min(1, 15 / v.length()));
    this.headBall(p, { kind: 'headPass', velocity: () => v, receiver: plan.receiver || null, power: 0.4 });
  }

  // ---------------------------------------------------------------- ball + rules

  stepBall(dt) {
    const ball = this.ball;
    const evs = ball.step(dt);
    for (const e of evs) this.emit({ ...e });
    if (this.state !== 'play') return;
    if (this.owner) return;
    this.bodyContacts();
  }

  // Shots and passes that hit a body are blocked; keepers save with hands.
  bodyContacts() {
    const ball = this.ball;
    const sp = ball.speed;
    if (sp < 4) return;
    for (const p of this.players) {
      if (this.lastTouch?.player === p && this.time - this.lastTouch.t < 0.3) continue;
      if (p.role === 'GK') { this.keeperContact(p); continue; }
      if (ball.pos.y > 1.85 || p.slide) continue;
      // Anyone free to take the ball traps it in tryControl; only shots and
      // players caught mid-action deflect it. A missed stretch lets it by.
      const free = !p.busy && p.kickLock <= 0 && !p.pendingKick;
      if (free && !this.shot) continue;
      if (this.pass?.tried?.has(p)) continue;
      const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.36) continue;
      const n = new THREE.Vector3(dx, 0, dz).normalize();
      const vn = ball.vel.dot(n);
      if (vn >= 0) continue;
      ball.vel.addScaledVector(n, -vn * 1.35).multiplyScalar(0.45);
      ball.vel.x += (this.rnd() - 0.5) * 2;
      ball.vel.z += (this.rnd() - 0.5) * 2;
      this.lastTouch = { player: p, t: this.time };
      this.emit({ type: 'block', player: p, speed: sp });
      break;
    }
  }

  keeperContact(k) {
    const ball = this.ball;
    const T = k.team;
    if (!this.inOwnBox(k, ball.pos)) return;
    // Body as a few spheres; during a dive the body lies along the dive.
    const pts = [];
    const d = k.dive;
    if (d) {
      const side = new THREE.Vector3(0, 0, d.side);
      const lift = d.high ? 1.35 : 0.55;
      const u = Math.min(1, d.t / 0.25);
      for (let i = 0; i <= 4; i++) {
        const s = i / 4;
        pts.push(k.pos.clone().addScaledVector(side, (s * 1.7 - 0.2) * u).setY(0.3 + lift * s * u + (1 - u) * s * 1.6));
      }
    } else {
      pts.push(k.pos.clone().setY(0.4), k.pos.clone().setY(1.0), k.pos.clone().setY(1.6), k.pos.clone().setY(2.05));
      for (const s of [-1, 1]) pts.push(k.pos.clone().add(k.left(new THREE.Vector3()).multiplyScalar(0.45 * s)).setY(1.2));
    }
    let hit = null;
    for (const p of pts) if (p.distanceTo(ball.pos) < 0.36 + R) { hit = p; break; }
    if (!hit) return;
    const sp = ball.speed;
    const catchChance = THREE.MathUtils.clamp(1.15 - sp / 26 + k.def.keeping * 0.3 - (d ? 0.25 : 0), 0.1, 0.95);
    if (this.rnd() < catchChance) {
      this.keeperCollect(k);
      if (k.dive) { k.dive.vel.multiplyScalar(0.3); }
      return;
    }
    // Parry: push it wide or over.
    const out = new THREE.Vector3(T.dir, 0, Math.sign(ball.pos.z - k.pos.z || 1) * 1.2).normalize();
    ball.vel.copy(out.multiplyScalar(sp * 0.35 + 2));
    ball.vel.y = 1.5 + this.rnd() * 3;
    this.lastTouch = { player: k, t: this.time };
    k.kickLock = 0.5;
    this.emit({ type: 'save', player: k, speed: sp, parry: true });
    if (this.shot && this.shot.team !== T) { this.shot.team.stats.onTarget++; this.shot = null; }
  }

  checkBounds() {
    const b = this.ball.pos;
    const last = this.lastTouch?.player;
    // A throw-in starts outside the touchline; it's in play once it re-enters.
    if (this.inbound) {
      if (Math.abs(b.z) < HW - R) this.inbound = false;
      else if (b.z * this.ball.vel.z < 0 && this.time - this.lastKick.t < 1.5) return;
      else this.inbound = false;
    }
    if (this.ball.inGoal && Math.abs(b.x) > GOAL_LINE + R) {
      const side = this.ball.inGoal;
      const team = this.teams.find((t) => t.dir === side);
      this.scoreGoal(team, side);
      return;
    }
    if (Math.abs(b.z) > HW + R) {
      const team = last ? last.team.opp : this.teams[0];
      this.emit({ type: 'out', kind: 'throw' });
      this.awardRestart('throw', team, b);
      return;
    }
    if (Math.abs(b.x) > GOAL_LINE + R + 0.06 && !this.ball.inGoal) {
      const side = Math.sign(b.x);
      const attacking = this.teams.find((t) => t.dir === side);
      const lastTeam = last ? last.team : attacking;
      if (this.shot) this.emit({ type: 'miss', team: this.shot.team });
      this.shot = null;
      if (lastTeam === attacking) this.awardRestart('goalkick', attacking.opp, b);
      else this.awardRestart('corner', attacking, b);
    }
  }

  scoreGoal(team, side) {
    const last = this.lastTouch?.player;
    const scorer = last && last.team === team ? last : last || team.players[9];
    team.score++;
    const own = last && last.team !== team;
    const g = { team, scorer, side, minute: Math.ceil(this.gameMinute()), own };
    this.goals.push(g);
    this.lastScorer = scorer;
    this.emit({ type: 'goal', ...g });
    this.emit({ type: 'whistle', kind: 'goal' });
    this.state = 'goal';
    this.stateT = 0;
    this.owner = null;
    this.pass = null;
    this.shot = null;
    this.players.forEach((p) => { p.celebrated = false; });
    this.kickoffTeam = team.opp;
  }

  possessionShare() {
    const [a, b] = this.possessionT;
    const tot = a + b || 1;
    return [Math.round(a / tot * 100), Math.round(b / tot * 100)];
  }
}
