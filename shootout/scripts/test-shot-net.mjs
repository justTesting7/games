import { readFileSync } from 'node:fs';

const weapons = readFileSync(new URL('../src/game/weapons.js', import.meta.url), 'utf8');
const session = readFileSync(new URL('../src/game/session.js', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/server/room.js', import.meta.url), 'utf8');

const report = weapons.indexOf('this.session.reportShot(from, dir, def.key, hit?.fighter?.net');
const earlyOut = weapons.indexOf('if (!hit) return null;');
if (report < 0 || earlyOut < 0 || report > earlyOut) {
  throw new Error('open-air misses must call reportShot before the no-hit return');
}
// (the knife's stab reports its own, see stab())
const guns = weapons.slice(0, weapons.indexOf('  stab(f) {')) + weapons.slice(weapons.indexOf('  ballistic('));
if ((guns.match(/this\.session\.reportShot/g) || []).length !== 2) {
  throw new Error('expected one miss/hit report plus the drone report');
}

if (!session.includes('this.shotSeq')) {
  throw new Error('each networked shot needs a sequence so repeats still send');
}
if (!room.includes('t: \'shot\'')) {
  throw new Error('room must still broadcast shots that hit nothing');
}

function packShot(hit) {
  return {
    hid: hit?.fighter?.net ? hit.fighter.id : undefined,
    head: !!hit?.head,
  };
}

const miss = packShot(null);
if (miss.hid || miss.head) throw new Error('a sky miss is still a shot, just without a victim');
const hit = packShot({ fighter: { net: true, id: 'p2' }, head: true });
if (hit.hid !== 'p2' || !hit.head) throw new Error('a player hit must keep hid/head');

console.log('shot net ok');
