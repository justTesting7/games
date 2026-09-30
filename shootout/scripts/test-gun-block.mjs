// A wall closer than the barrel tips the guns up to a high ready instead of
// letting them poke through; clear air leaves the aim alone. Rival rounds start
// at the chest so a barrel against a wall can't fire from its far side.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Character } from '../src/game/character.js';

const ch = new Character();
const spine2 = new THREE.Bone();
spine2.position.y = 1.3;
ch.root.add(spine2);
ch.bones = { Spine2: spine2 };
ch.root.updateMatrixWorld(true);
ch.weapon = 'rifle';
ch.aimWeight = 1;
ch.lookDir.set(0, 0, 1);

let wall = 0.35;
Character.wallProbe = (o, d, len) => (wall < len ? wall : null);
for (let i = 0; i < 30; i++) ch.updateGunBlock(1 / 60);
const up = ch.gunFrom(new THREE.Vector3());
if (!(ch.gunBlock > 0.9)) throw new Error(`a wall 35 cm ahead should fully block the rifle (${ch.gunBlock.toFixed(2)})`);
if (!(up.y > 0.6)) throw new Error(`blocked rifle should point up (y ${up.y.toFixed(2)})`);

wall = 5;
for (let i = 0; i < 60; i++) ch.updateGunBlock(1 / 60);
const clear = ch.gunFrom(new THREE.Vector3());
if (clear.z < 0.99) throw new Error('with clear air the rifle follows the aim');
Character.wallProbe = null;

const weapons = readFileSync(new URL('../src/game/weapons.js', import.meta.url), 'utf8');
if (!weapons.includes('from = this.combat.chest(shooter);')) throw new Error('rival rounds must start at the chest');
console.log('ok gun block');
