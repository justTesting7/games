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
    // half = half the side of the set's square ground tile (from each export's ground bounds)
    sets: [
      { folder: 'dizengoff-square', offset: [0, 0, 0], half: 180 },
      { folder: 'dizengoff-center', offset: [97.0, -1.01, 275.22], half: 200 },
      { folder: 'haneviim', offset: [334.04, 7.12, 222.35], half: 200 },
      { folder: 'masrik', offset: [419.12, 7.13, -57.9], half: 220 },
    ],
    spill: 35, // buildings reach this far past the tile edge
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

/** True when a skyline point lies over one of the detailed sets (it would double it). */
export function underSets(def, x, z) {
  return def.sets.some(({ folder, offset: [ox, , oz], half }) => folder !== def.far
    && Math.abs(x - ox) < half + def.spill && Math.abs(z - oz) < half + def.spill);
}

// Street surfaces are big triangles (whole road strips): cut by centre they would leave
// holes along a seam. Every set keeps all of its own; each later set sits a little
// lower, so in an overlap one copy of the same streets shows on top.
export const GROUND_MESH = /^(asphalt|pavement|ground|lm_grass|kerb|marking|road_marks.*)$/;
export const groundDrop = (i) => i * 0.05;
