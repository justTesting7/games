import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Rival } from '../src/game/rival.js';

const src = readFileSync(new URL('../src/game/rival.js', import.meta.url), 'utf8');

for (const needle of [
  'const THINK_HOLD = 2.8',
  'const HIT_RETHINK = 0.7',
  'const STRAFE_HOLD = 2.8',
  'const TARGET_STICK = 8',
  'Pick your tactic for the next few seconds and commit to it',
  'this.thinkT = THINK_HOLD + Math.random() * THINK_SPREAD',
  'this.thinkT = Math.min(this.thinkT, HIT_RETHINK)',
  'Keep a still-valid plan instead of rolling a new one every think',
]) {
  if (!src.includes(needle)) throw new Error(`rival.js missing ${needle}`);
}
if (src.includes('Pick your tactic for the next second')) {
  throw new Error('Jev still plans one second at a time');
}
if (src.includes('this.thinkT = Math.min(this.thinkT, 0.12)')) {
  throw new Error('getting shot still forces a robot-speed rethink');
}

const pos = (x, z) => new THREE.Vector3(x, 2, z);
const combat = {
  time: 10,
  fighters: [],
  add(o) {
    const f = {
      ...o, health: 100, alive: true, lastHitT: -99, lastShotT: -99, lastAttacker: null, pos: o.pos,
    };
    this.fighters.push(f);
    return f;
  },
  reset() {},
  chest(f) { return f.pos.clone().setY(f.pos.y + 1.3); },
};
const world = {
  terrain: { heightAt: () => 2, inBounds: () => true },
  veg: { colliders: { query: () => [] } },
  raycast: () => null,
};
const character = {
  setWeapon() {}, weapon: 'pistols', equipT: 1, aimWeight: 1,
  root: { position: { copy() {} }, rotation: { set() {} }, visible: true },
};
const jev = { ask: async () => null };

const make = () => {
  const r = new Rival(world, combat, { live: [], trigger: () => false }, jev, {
    id: 'ben', name: 'Ben', color: '#f00', personality: 'brawler', ruthless: false,
    accuracy: 1, fireInterval: 0.24, reaction: 0.4,
  }, character);
  r.pos.copy(pos(0, 0));
  r.fighter.pos = r.pos;
  r.reset();
  return r;
};

const ben = make();
if (ben.thinkT < 0.7) throw new Error(`spawn thinkT too short: ${ben.thinkT}`);
if (ben.strafeT < 2.5) throw new Error(`spawn strafeT too short: ${ben.strafeT}`);

const foe = { alive: true, pos: pos(12, 0), health: 80, name: 'Nagar' };
const other = { alive: true, pos: pos(16, 0), health: 80, name: 'Idan' };
const closer = { alive: true, pos: pos(10, 0), health: 80, name: 'Dror' };
combat.fighters.push(foe, other, closer);
for (const e of [foe, other, closer]) ben.seen(e).visible = true;

ben.setTarget(foe);
ben.tactic = 'push';
if (ben.localTactic({}, null) !== 'push') throw new Error('should keep pushing instead of rolling a new plan');

ben.tactic = 'flank';
if (ben.localTactic({}, null) !== 'flank') throw new Error('should keep flanking');

ben.pickTarget();
if (ben.target !== foe) throw new Error('a slightly closer body should not steal the mark');

closer.pos = pos(2, 0);
ben.pickTarget();
if (ben.target !== closer) throw new Error('a much closer body should take the mark');

console.log('jev pace ok');
