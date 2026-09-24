// A pose packet has no `alive` field. That must not stand a corpse back up.
const revive = (s, alive) => s.alive === true && !alive;
const flatten = (s, alive) => s.alive === false && alive;

if (revive({}, false)) throw new Error('missing alive on pose revived a corpse');
if (revive({ alive: false }, false)) throw new Error('dead pose revived a corpse');
if (!revive({ alive: true }, false)) throw new Error('explicit alive should revive after rematch');
if (!flatten({ alive: false }, true)) throw new Error('explicit dead should drop a live remote');
if (flatten({}, true)) throw new Error('pose without alive should not kill');

// Server kill amount is often a single pistol tap (9) while this client
// still has 100 HP because remote hits used to skip local damage.
const killDamage = (amt, health) => Math.max(amt || 0, health || 0, 1);
if (killDamage(9, 100) < 100) throw new Error('9-damage kill on full HP would only flinch');
if (killDamage(9, 8) < 8) throw new Error('finishing tap must consume remaining HP');

console.log('kill pose ok');
