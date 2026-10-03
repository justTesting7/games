// Maps stitched from several city-set exports. The generator lays every district
// out on the same Tel Aviv grid, each around its own origin, so a set only needs
// the offset of its origin in the first set's frame (measured with
// scripts/align-city.mjs, from the skyline towers both far.glb files share).
//
// Where sets overlap they contain the same buildings and streets. Every point is
// owned by the set it lies deepest inside, so the seams run down the middle of the
// overlaps and each building is kept from one file only. The runtime
// loader (loadCity.js) and the nav bake use the same rule.

export const CITY_PARTS = {
  'tel-aviv': {
    far: 'dizengoff-square', // skyline ring; its buildings over the other sets are removed
    // half = half the side of the set's square ground tile (from each export's ground bounds);
    // files = the chunks of a set built over the 25 MiB asset limit (build-city-map.mjs)
    sets: [
      { folder: 'dizengoff-square', offset: [0, 0, 0], half: 180 },
      { folder: 'dizengoff-center', offset: [97.0, -1.01, 275.22], half: 200 },
      { folder: 'haneviim', offset: [334.04, 7.12, 222.35], half: 200 },
      { folder: 'masrik', offset: [419.12, 7.13, -57.9], half: 220 },
      { folder: 'sderot-hen', offset: [567.03, 8.88, 238.47], half: 300, files: ['set.glb', 'set-2.glb'] },
      { folder: 'habima', offset: [516.44, 12.30, 527.47], half: 200 },
      // Frishman: the hole between Dizengoff Square and Masaryk. The overlap is the same
      // streets the other sets already own; this one keeps the part they never exported.
      { folder: 'frishman', offset: [182.09, 1.82, -64.95], half: 200, drop: 0.02 },
    ],
    spill: 35, // buildings reach this far past the tile edge
    // where rounds start (solo deals one at random; multiplayer slots go round them).
    // The nav bake keeps the three parked cars nearest each one drivable.
    plazas: [
      { x: 38.25, z: -2.75, yaw: 5.301 }, // Dizengoff Square
      { x: 106.25, z: 274.47, yaw: 3.731 }, // Dizengoff Center
      { x: 418.3, z: -52.8, yaw: 2.42 }, // Masaryk Square
    ],
  },
};

export const cityPartsOf = (folder) => CITY_PARTS[folder] || null;

/**
 * Index of the set that owns world point (x, z): the one with the most of its own tile
 * left around the point (tile half-size minus square distance to its centre). Seams
 * then sit where two sets are equally far from their edges.
 */
export function ownerOf(def, x, z) {
  let best = 0, bm = -Infinity;
  def.sets.forEach(({ offset: [ox, , oz], half }, i) => {
    const m = half - Math.max(Math.abs(x - ox), Math.abs(z - oz));
    if (m > bm + 1e-6) { bm = m; best = i; }
  });
  return best;
}

/** True when a skyline point lies over the detailed set that owns it (it would double it). */
export function underSets(def, x, z) {
  const owner = def.sets[ownerOf(def, x, z)];
  if (!owner || owner.folder === def.far) return false;
  const [ox, , oz] = owner.offset;
  return Math.abs(x - ox) < owner.half + def.spill && Math.abs(z - oz) < owner.half + def.spill;
}

/** How far a set's streets sit below the one before it, so overlaps don't z-fight. */
export const setDrop = (set, i) => set.drop ?? groundDrop(i);

// Street surfaces are big triangles (whole road strips): cut by centre they would leave
// holes along a seam. Every set keeps all of its own; each later set sits a little
// lower, so in an overlap one copy of the same streets shows on top.
export const GROUND_MESH = /^(asphalt|pavement|ground|lm_grass|kerb|marking|road_marks.*)$/;
export const groundDrop = (i) => i * 0.05;
