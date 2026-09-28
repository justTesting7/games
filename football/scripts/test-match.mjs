// Headless AI-vs-AI simulation: checks the match engine plays real football
// (passes, shots, restarts, goals) without NaNs or stuck states.
import assert from 'node:assert/strict';
import { Match } from '../src/game/match.js';
import { Brain } from '../src/game/brain.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function simulate(seed, seconds, { brain = true } = {}) {
  const rnd = seeded(seed);
  const m = new Match({ humanTeam: null, halfSeconds: seconds / 2, rnd });
  if (brain) new Brain(m, null, { rnd, teams: m.teams });
  m.start();
  const counts = {};
  const dt = 1 / 60;
  let stuck = 0, lastX = 0, maxStuck = 0;
  for (let i = 0; i < (seconds * 1.5 + 90) * 60 && m.state !== 'fulltime'; i++) {
    const evs = m.update(dt, null);
    m.brain?.update(dt);
    for (const e of evs) counts[e.type] = (counts[e.type] || 0) + 1;
    for (const e of evs) if (e.type === 'restart') counts[`restart_${e.kind}`] = (counts[`restart_${e.kind}`] || 0) + 1;
    for (const p of m.players) {
      assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z), `player position finite (${p.name})`);
    }
    assert.ok(Number.isFinite(m.ball.pos.x) && Number.isFinite(m.ball.pos.y), 'ball position finite');
    if (Math.abs(m.ball.pos.x - lastX) < 0.01 && m.state === 'play') stuck++; else stuck = 0;
    maxStuck = Math.max(maxStuck, stuck);
    lastX = m.ball.pos.x;
  }
  return { m, counts, maxStuck };
}

const DUR = 360;
let goals = 0, shots = 0, passes = 0, completed = 0;
const agg = {};
for (const seed of [1, 2, 3]) {
  const { m, counts, maxStuck } = simulate(seed, DUR);
  assert.equal(m.state, 'fulltime', `seed ${seed}: match reaches full time (state ${m.state}, clock ${m.clockText()})`);
  assert.ok(maxStuck < 60 * 12, `seed ${seed}: ball never frozen in open play for >12 s (${(maxStuck / 60).toFixed(1)} s)`);
  goals += m.teams[0].score + m.teams[1].score;
  for (const t of m.teams) { shots += t.stats.shots; passes += t.stats.passes; completed += t.stats.completed; }
  for (const [k, v] of Object.entries(counts)) agg[k] = (agg[k] || 0) + v;
  console.log(`seed ${seed}: ${m.teams[0].club.short} ${m.teams[0].score}-${m.teams[1].score} ${m.teams[1].club.short}  shots ${m.teams[0].stats.shots}/${m.teams[1].stats.shots}  passes ${m.teams[0].stats.completed}/${m.teams[0].stats.passes} ${m.teams[1].stats.completed}/${m.teams[1].stats.passes}  possession ${m.possessionShare().join('/')}`);
}
console.log('events', JSON.stringify(agg));
const perMatch = (x) => x / 3;
assert.ok(perMatch(passes) > 40, `teams pass the ball (${perMatch(passes).toFixed(0)} per match)`);
assert.ok(completed / passes > 0.38, `passes find a teammate often enough (${(completed / passes * 100).toFixed(0)}%)`);
assert.ok(perMatch(shots) >= 4, `teams create shots (${perMatch(shots).toFixed(1)} per match)`);
assert.ok(goals >= 1, `goals get scored (${goals} in 3 matches)`);
assert.ok((agg.tackle || 0) > 5, 'players win tackles');
assert.ok((agg.restart_throw || 0) + (agg.restart_goalkick || 0) + (agg.restart_corner || 0) > 0, 'ball goes out of play and restarts');
assert.ok((agg.turnover || 0) > 10, 'possession changes hands');

// Human control: a pass input from the kick-off taker restarts play.
{
  const m = new Match({ humanTeam: 0, halfSeconds: 120, rnd: seeded(9) });
  new Brain(m, null, { rnd: seeded(10) });
  m.start();
  const idle = { move: { x: 0, z: 0 } };
  let t = 0;
  while (m.state === 'kickoff' && t < 6) {
    const ready = m.restart?.ready;
    m.update(1 / 60, ready ? { ...idle, pass: true } : idle);
    t += 1 / 60;
  }
  for (let i = 0; i < 60; i++) m.update(1 / 60, idle);
  assert.equal(m.state, 'play', 'human pass takes the kick-off');
  assert.ok(m.teams[0].stats.passes >= 1, 'kick-off pass is counted');
}

// A penalty is awarded for a foul in the box and gets taken.
{
  const m = new Match({ humanTeam: null, halfSeconds: 600, rnd: seeded(4) });
  new Brain(m, null, { rnd: seeded(5), teams: m.teams });
  m.start();
  for (let i = 0; i < 200; i++) m.update(1 / 60);
  m.state = 'play';
  const att = m.teams[0], def = m.teams[1];
  const victim = att.players[9];
  victim.pos.set(att.dir * 45, 0, 2);
  m.foul(def.players[3], victim);
  assert.equal(m.restart.type, 'penalty', 'foul in the box gives a penalty');
  let taken = false;
  for (let i = 0; i < 60 * 8 && !taken; i++) {
    const evs = m.update(1 / 60);
    m.brain.update(1 / 60);
    if (evs.some((e) => e.type === 'shot')) taken = true;
  }
  assert.ok(taken, 'penalty is struck');
}

// A keeper with the ball in his hands cannot be tackled or pickpocketed.
{
  const m = new Match({ humanTeam: null, halfSeconds: 600, rnd: seeded(3) });
  new Brain(m, null, { rnd: seeded(3), teams: m.teams });
  m.start();
  m.state = 'play';
  const gk = m.teams[0].keeper;
  const thief = m.teams[1].players[9];
  const put = () => {
    gk.pos.set(m.teams[0].ownGoal.x + m.teams[0].dir * 4, 0, 1);
    gk.vel.set(0, 0, 0);
    gk.holding = true;
    gk.holdT = 0;
    m.owner = gk;
    m.state = 'play';
    m.ball.pos.copy(gk.pos).setY(1.05);
    m.ball.vel.set(0, 0, 0);
    thief.pos.copy(gk.pos);
    thief.vel.set(0, 0, 0);
    thief.slide = null;
  };
  put();
  for (let i = 0; i < 90; i++) {
    gk.holdT = 0;
    thief.pos.copy(gk.pos);
    m.startTackle(thief, false);
    m.gainBall(thief, 'tackle');
    m.update(1 / 60);
    assert.equal(m.owner, gk, 'a poke does not take the ball out of the keeper\'s hands');
    assert.equal(gk.holding, true, 'keeper keeps hold of the ball');
  }
  put();
  m.startTackle(thief, true);
  for (let i = 0; i < 40; i++) {
    const held = gk.holding && m.owner === gk;
    thief.pos.copy(gk.pos);
    gk.holdT = 0;
    m.update(1 / 60);
    if (held) assert.ok(!m.owner || m.owner.team === gk.team, 'a slide does not give the ball to the attacker');
  }
}

// Ahead of every defender: run at goal, and shoot once he is close. No pass.
{
  const m = new Match({ humanTeam: null, halfSeconds: 600, rnd: seeded(2) });
  const brain = new Brain(m, null, { rnd: seeded(2), teams: m.teams });
  m.start();
  m.state = 'play';
  const att = m.teams[0];
  const carrier = att.players[9];
  const place = (x) => {
    carrier.pos.set(att.dir * x, 0, 1);
    m.owner = carrier;
    m.ball.pos.copy(carrier.pos).setY(0.11);
    m.ball.vel.set(0, 0, 0);
    for (const o of att.opp.players) {
      o.pos.set(o.role === 'GK' ? att.dir * 51 : att.dir * 8, o.role === 'GK' ? 0 : o.def.z * 18, 0);
    }
  };
  place(28);
  const far = brain.options(carrier).best;
  assert.equal(far.kind, 'dribble', 'a breakaway from distance is a run at goal');
  assert.equal(far.alone, true, 'the run is marked as ahead of everyone');
  assert.ok(!brain.options(carrier).list.some((o) => o.kind === 'pass' || o.kind === 'through'), 'no pass is offered on a breakaway');
  place(42);
  const close = brain.options(carrier).best;
  assert.equal(close.kind, 'shoot', 'he shoots once he is in on goal');
  att.opp.players[4].pos.set(att.dir * 46, 0, 0);
  const marked = brain.options(carrier).best;
  assert.ok(!marked.alone && marked.finish !== 'break', 'a defender still in front means he is not through');
  place(28);
  let passed = false;
  let shot = false;
  for (let i = 0; i < 60 * 6 && !shot; i++) {
    const evs = m.update(1 / 60);
    brain.update(1 / 60);
    for (const e of evs) {
      if (e.player !== carrier) continue;
      if (e.type === 'kick' && (e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob' || e.kind === 'cross')) passed = true;
      if (e.type === 'shot') shot = true;
    }
  }
  assert.equal(passed, false, 'he does not pass once he is through');
  assert.equal(shot, true, 'he finishes the breakaway himself');
}

console.log('match tests passed');
