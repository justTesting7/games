import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { startClock } from './engine/clock.js';
import { Progress, VENDOR } from './engine/assets.js';
import { createGameRenderer } from './engine/webgl.js';
import { buildPitch } from './world/pitch.js';
import { Stadium } from './world/stadium.js';
import { Goal } from './world/goal.js';
import { createBallMesh } from './game/ballView.js';
import { Footballer } from './game/footballer.js';
import { Match, MENTALITY } from './game/match.js';
import { Brain } from './game/brain.js';
import { Jev } from './game/jev.js';
import { BroadcastCamera, VIEWS } from './game/camera.js';

const $ = (id) => document.getElementById(id);
const HOME = 'kingsbridge', AWAY = 'redmoor';

function fail(e) {
  console.error(e);
  const el = $('error');
  el.textContent = `Failed to start: ${e?.message || e}`;
  el.classList.remove('hidden');
}
window.addEventListener('error', (e) => fail(e.error || e.message));

let renderer, pipeline;
try {
  ({ renderer } = createGameRenderer($('game')));
  pipeline = new Pipeline(renderer);
  const q = localStorage.getItem('football-quality') || 'medium';
  $('quality').value = q;
  pipeline.setQuality(q);
} catch (e) {
  fail(e);
  throw e;
}
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.3, 1500);
const broadcast = new BroadcastCamera(camera);
pipeline.setShadowBounds(new THREE.Vector3(0, 0, 0), 105);
addEventListener('resize', () => {
  pipeline.resize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
$('quality').addEventListener('change', (e) => {
  pipeline.setQuality(e.target.value);
  localStorage.setItem('football-quality', e.target.value);
});

const progress = new Progress((p) => {
  $('loadbar').style.width = `${(p.fraction * 100).toFixed(0)}%`;
  $('loadlabel').textContent = p.label;
});

const texLoader = new THREE.TextureLoader();
function tex(name, srgb) {
  return new Promise((res, rej) => texLoader.load(`${VENDOR}/textures/${name}.jpg`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    res(t);
  }, undefined, rej));
}

const world = { views: [] };
let match = null, brain = null;
const jev = new Jev();

async function load() {
  const textures = await progress.task('Textures', 2, async () => {
    const [grassDiff, grassNor, concreteDiff, concreteNor, concreteArm, roofDiff, roofNor, roofArm] = await Promise.all([
      tex('grass_diff', true), tex('grass_nor'), tex('concrete_diff', true), tex('concrete_nor'), tex('concrete_arm'),
      tex('roof_diff', true), tex('roof_nor'), tex('roof_arm'),
    ]);
    return { grassDiff, grassNor, concreteDiff, concreteNor, concreteArm, roofDiff, roofNor, roofArm };
  });
  const scene = pipeline.scene;
  await progress.task('Stadium', 2, async () => {
    scene.add(buildPitch(textures));
    const m0 = new Match({ home: HOME, away: AWAY });
    world.stadium = new Stadium(textures, {
      crowdScale: pipeline.quality.crowd, home: m0.teams[0].club.crowd, away: m0.teams[1].club.crowd,
    });
    scene.add(world.stadium.group);
    world.goals = { [-1]: new Goal(-1), [1]: new Goal(1) };
    scene.add(world.goals[-1].group, world.goals[1].group);
    world.ball = createBallMesh();
    scene.add(world.ball);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 16), new THREE.MeshBasicMaterial({ color: 0xffe14a }));
    cone.rotation.x = Math.PI;
    world.marker = cone;
    scene.add(cone);
  });
  world.avatar = await progress.task('Players', 5, () => Footballer.loadAssets());
  newMatch();
  $('loading').classList.add('hidden');
  $('play').disabled = false;
}

function newMatch() {
  for (const v of world.views) pipeline.scene.remove(v.root);
  world.views = [];
  match = new Match({
    home: HOME, away: AWAY, humanTeam: 0,
    halfSeconds: +$('halfLen').value, difficulty: +$('difficulty').value,
  });
  brain = new Brain(match, jev);
  for (const p of match.players) {
    const f = new Footballer();
    f.load(world.avatar, {
      kit: p.team.club.kit, number: p.number, name: p.name, skin: p.def.skin, hair: p.def.hair,
      boots: p.def.boots, height: p.def.height, keeper: p.role === 'GK',
    });
    f.player = p;
    pipeline.scene.add(f.root);
    world.views.push(f);
  }
  const [h, a] = match.teams;
  $('homeName').textContent = h.club.short;
  $('awayName').textContent = a.club.short;
  $('homeBar').style.background = h.club.color;
  $('awayBar').style.background = a.club.color;
  syncViews(0);
}

// ---------------------------------------------------------------- input

const keys = new Set();
const pressed = new Set();
let charge = null;
let paused = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.code;
  keys.add(k);
  pressed.add(k);
  if (k === 'KeyD' && match && !(match.owner && match.owner.team !== match.humanTeam)) charge = performance.now();
  if (k === 'KeyC') {
    const v = Object.keys(VIEWS);
    broadcast.setView(v[(v.indexOf(broadcast.view) + 1) % v.length]);
    banner(VIEWS[broadcast.view].label, '', 1.2);
  }
  if (k === 'Escape' && started) paused = !paused;
  if (k.startsWith('Arrow') || k === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyD' && charge !== null) {
    pressed.add('shootRelease');
    releasedPower = Math.min(1, (performance.now() - charge) / 900);
    charge = null;
  }
});
addEventListener('blur', () => keys.clear());
let releasedPower = 0;

function readInput() {
  const k = (c) => keys.has(c);
  const x = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
  const z = (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0);
  const pro = broadcast.view === 'pro';
  const dir = match.humanTeam?.dir ?? 1;
  // Broadcast views: screen right is +X and screen up is -Z.
  const move = pro ? { x: -z * dir, z: -x * dir } : { x, z };
  const defending = match.owner && match.owner.team !== match.humanTeam;
  const p = (c) => pressed.has(c);
  // With a loose ball S is a first-time pass when close, otherwise a switch.
  const h = match.human;
  const nearLoose = !match.owner && h && h.pos.distanceTo(match.ball.pos) < 2.5;
  const input = {
    move,
    sprint: k('ShiftLeft') || k('ShiftRight'),
    pass: p('KeyS') && !defending && (match.owner?.team === match.humanTeam || nearLoose || match.state !== 'play'),
    through: p('KeyQ') && !defending,
    lob: p('KeyA') && !defending,
    shootRelease: p('shootRelease'),
    shootPower: releasedPower,
    tackle: defending && p('KeyD'),
    slide: defending && p('KeyA'),
    switch: p('KeyS') && (defending || !match.owner && !nearLoose && match.state === 'play'),
  };
  pressed.clear();
  return input;
}

// ---------------------------------------------------------------- views

function syncViews(dt) {
  for (const f of world.views) {
    const p = f.player;
    f.root.position.copy(p.pos);
    f.root.rotation.y = p.yaw;
    for (const a of p.anims) f.play(a.type, a.opts);
    p.anims.length = 0;
    f.update(dt, { speed: p.speed, localDir: p.localDir, lookAt: p.lookAt, turnRate: p.turnRate, holding: p.holding });
  }
  world.ball.position.copy(match.ball.pos);
  world.ball.quaternion.copy(match.ball.quat);
  const h = match.human;
  world.marker.visible = !!h && (match.state === 'play' || match.state === 'dead' || match.state === 'kickoff');
  if (h) world.marker.position.set(h.pos.x, 2.35 + Math.sin(performance.now() / 180) * 0.05, h.pos.z);
}

// ---------------------------------------------------------------- HUD

let bannerT = 0;
function banner(title, sub = '', dur = 2.5) {
  const el = $('banner');
  el.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  el.classList.remove('hidden');
  bannerT = dur;
}

const RESTART = { corner: 'Corner', freekick: 'Free kick', penalty: 'PENALTY', goalkick: 'Goal kick', throw: '' };
function onEvents(evs) {
  for (const e of evs) {
    if (e.type === 'net') world.goals[e.side]?.hit(e.point, e.speed);
    if (e.type === 'goal') {
      banner('GOAL!', `${e.scorer.name}${e.own ? ' (og)' : ''} ${e.minute}'`, 4.5);
      broadcast.setMode('goal', e.scorer);
      excite = 1;
    }
    if (e.type === 'restart' && RESTART[e.kind]) banner(RESTART[e.kind], e.team.club.name, 1.8);
    if (e.type === 'whistle' && e.kind === 'half') banner('HALF TIME', score(), 3.4);
    if (e.type === 'whistle' && e.kind === 'full') {
      banner('FULL TIME', score(), 6);
      setTimeout(() => showMenu('Play again'), 5000);
    }
    if (e.type === 'shot' || e.type === 'save' || e.type === 'post' || e.type === 'bar') excite = Math.max(excite, 0.7);
    if (e.type === 'reset') broadcast.setMode('play');
  }
}
const score = () => `${match.teams[0].club.name} ${match.teams[0].score} - ${match.teams[1].score} ${match.teams[1].club.name}`;

let hudT = 0;
function updateHud(dt) {
  bannerT -= dt;
  if (bannerT <= 0) $('banner').classList.add('hidden');
  const pw = $('power');
  if (charge !== null) {
    pw.classList.remove('hidden');
    pw.firstElementChild.style.width = `${Math.min(1, (performance.now() - charge) / 900) * 100}%`;
  } else pw.classList.add('hidden');
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.25;
  $('homeScore').textContent = match.teams[0].score;
  $('awayScore').textContent = match.teams[1].score;
  $('clock').textContent = paused ? 'PAUSED' : match.clockText();
  const rival = match.teams[1];
  const s = jev.stats;
  const status = s.online === null ? 'connecting…' : s.online ? `online · ${Math.round(s.latency)} ms` : `offline (${s.error}) · local AI`;
  const last = brain.lastDecision(rival);
  $('jev').innerHTML = `<b>Jev</b> ${status}<br><b>${rival.club.name}</b> ${MENTALITY[rival.mentality].label} <span style="opacity:.6">(${rival.mentalitySource})</span>`
    + (last ? `<br><b>${last.player.name}</b>: ${last.text} <span style="opacity:.6">(${last.source}${last.source === 'jev' ? ` ${Math.round(last.confidence * 100)}%` : ''})</span>` : '');
  world.stadium.drawScreen({
    home: match.teams[0].club.short, away: rival.club.short, hs: match.teams[0].score, as: rival.score,
    homeColor: match.teams[0].club.color, awayColor: rival.club.color, clock: match.clockText(),
  });
}

// ---------------------------------------------------------------- loop

let started = false;
let excite = 0;
let time = 0;
function showMenu(label) {
  $('play').textContent = label;
  $('menu').classList.remove('hidden');
  started = false;
}
$('play').addEventListener('click', () => {
  if (match.state !== 'intro') newMatch();
  $('menu').classList.add('hidden');
  for (const id of ['scorebug', 'jev', 'help']) $(id).classList.remove('hidden');
  started = true;
  paused = false;
  match.start();
  broadcast.setMode('play');
  banner('KICK OFF', score(), 2);
});

const SUB = 1 / 60;
function step(dt, draw) {
  if (!match) {
    if (draw) { pipeline.setTimeOfDay(0.11, time); pipeline.render(camera, dt); }
    return;
  }
  time += dt;
  if (started && !paused) {
    let left = dt;
    let input = readInput();
    while (left > 1e-6) {
      const h = Math.min(SUB, left);
      left -= h;
      onEvents(match.update(h, input));
      brain.update(h);
      input = { ...input, pass: false, through: false, lob: false, shootRelease: false, tackle: false, slide: false, switch: false };
    }
  }
  excite = Math.max(0, excite - dt * 0.15);
  if (!draw) return;
  syncViews(paused ? 0 : dt);
  for (const s of [-1, 1]) world.goals[s].update(dt, time);
  world.stadium.update(dt, time, { excite, homeBias: 1, awayBias: 0.4, stir: excite });
  broadcast.update(dt, match);
  pipeline.setTimeOfDay(0.11, time);
  pipeline.render(camera, dt);
  if (started) updateHud(dt);
}

load().catch(fail);
startClock(step);
