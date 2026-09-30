// Tel Aviv is stitched from three exports: every point belongs to exactly one set,
// always one whose ground tile covers it, and the seams sit well inside both tiles.
import { CITY_PARTS, ownerOf, underSets } from '../src/world/cityParts.js';
import { getMap } from '../src/world/maps.js';

const def = CITY_PARTS['tel-aviv'];
if (getMap('telaviv').cityFolder !== 'tel-aviv') throw new Error('the Tel Aviv map must load the stitched folder');
const inTile = (i, x, z, pad = 0) => {
  const [ox, , oz] = def.sets[i].offset;
  return Math.abs(x - ox) <= def.half - pad && Math.abs(z - oz) <= def.half - pad;
};
let covered = 0;
for (let x = -200; x <= 560; x += 2) for (let z = -200; z <= 480; z += 2) {
  const inAny = def.sets.some((_, i) => inTile(i, x, z));
  if (!inAny) continue;
  covered++;
  const o = ownerOf(def, x, z);
  if (!inTile(o, x, z)) throw new Error(`(${x}, ${z}) is owned by ${def.sets[o].folder}, which does not cover it`);
}
// seams (where a neighbour starts owning) must run inside both tiles by at least half a
// building: an export holds every building centred on its tile, so a building cut by
// the seam is whole in both files (Square and HaNevi'im only overlap by 26 m)
let seam = 0, tight = 0;
for (let x = -200; x <= 560; x += 2) for (let z = -200; z <= 480; z += 2) {
  const o = ownerOf(def, x, z), n = ownerOf(def, x + 2, z), m = ownerOf(def, x, z + 2);
  if (o === n && o === m) continue;
  const other = o !== n ? n : m;
  if (!inTile(o, x, z) || !inTile(other, x, z)) continue;
  // every seam has to end somewhere on the city's outer edge: judge the inner ones
  const outskirts = [[40, 0], [-40, 0], [0, 40], [0, -40], [28, 28], [-28, 28], [28, -28], [-28, -28]]
    .some(([dx, dz]) => !def.sets.some((_, i) => inTile(i, x + dx, z + dz)));
  if (outskirts) continue;
  seam++;
  if (!inTile(o, x, z, 10) || !inTile(other, x, z, 10)) tight++;
}
if (tight) throw new Error(`${tight} of ${seam} seam points are within 10 m of a tile edge`);
if (covered < 50000) throw new Error('the stitched map should cover the three tiles');
if (underSets(def, 0, 0)) throw new Error('the skyline stays over its own set');
if (!underSets(def, 334, 222)) throw new Error('skyline buildings over HaNevi\'im are removed');
console.log('ok city parts', covered * 4, 'm2, seam points', seam, 'near an edge', tight);
