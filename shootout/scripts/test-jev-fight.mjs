import * as THREE from 'three';
import { Rival } from '../src/game/rival.js';

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

const make = (persona) => {
  const r = new Rival(world, combat, { live: [], trigger: () => false }, jev, persona, character);
  r.pos.copy(pos(0, 0));
  r.fighter.pos = r.pos;
  r.reset();
  return r;
};

const regular = make({
  id: 'ben', name: 'Ben', color: '#f00', personality: 'brawler', ruthless: false,
  accuracy: 1, fireInterval: 0.24, reaction: 0.4,
});
if (regular.tactic !== 'push') throw new Error(`regular starts ${regular.tactic}, expected push`);
if (regular.needFirstCover) throw new Error('regular should not wait for first cover');
if (!regular.canFight()) throw new Error('regular should be able to fight immediately');
regular.fighter.health = 100;
if (regular.shouldShelter()) throw new Error('healthy regular should not hide');
regular.fighter.health = 20;
if (!regular.shouldShelter()) throw new Error('badly wounded regular should take cover');
regular.fighter.health = 100;

const foe = { alive: true, pos: pos(12, 0), health: 80, name: 'Nagar' };
regular.setTarget(foe);
regular.seen(foe).visible = true;
const local = regular.localTactic({}, null);
if (local === 'take_cover' || local === 'retreat' || local === 'hold') {
  throw new Error(`healthy regular local tactic too defensive: ${local}`);
}

const nagar = make({
  id: 'greytee', name: 'Nagar', color: '#8ff', personality: 'ruthless', ruthless: true,
  accuracy: 0.95, fireInterval: 0.2, reaction: 0.28,
});
nagar.fighter.health = 15;
if (nagar.shouldShelter()) throw new Error('Nagar should never shelter');
if (nagar.localTactic({}, { spot: pos(1, 1) }) !== 'hunt' && !nagar.target) {
  /* no target yet */
}
nagar.setTarget(foe);
nagar.seen(foe).visible = true;
if (nagar.localTactic({}, {}) !== 'push') throw new Error('Nagar should push a visible enemy');

console.log('jev fight ok');
