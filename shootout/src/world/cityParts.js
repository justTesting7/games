// Maps stitched from several city-set exports. The generator lays every district
// out on the same Tel Aviv grid, each around its own origin, so a set only needs
// the offset of its origin in the first set's frame (measured with
// scripts/align-city.mjs, from the skyline towers both far.glb files share).
//
// Where sets overlap they contain the same buildings and streets. Every point is
// owned by the set whose ground tile centre is nearest, so the seams run down the
// middle of the overlaps and each building is kept from one file only. The runtime
// loader (loadCity.js) and the nav bake use the same rule.

export const CITY_PARTS = {
  'tel-aviv': {
    far: 'dizengoff-square', // skyline ring; its buildings over the other sets are removed
    sets: [
      { folder: 'dizengoff-square', offset: [0, 0, 0] },
      { folder: 'dizengoff-center', offset: [97.0, -1.01, 275.22] },
      { folder: 'haneviim', offset: [334.04, 7.12, 222.35] },
    ],
    half: 180, // every export's ground tile is 360 m square around its origin
    spill: 35, // buildings reach this far past the tile edge
  },
};

export const cityPartsOf = (folder) => CITY_PARTS[folder] || null;

/** Index of the set that owns world point (x, z): nearest tile centre, square distance. */
export function ownerOf(def, x, z) {
  let best = 0, bd = Infinity;
  def.sets.forEach(({ offset: [ox, , oz] }, i) => {
    const d = Math.max(Math.abs(x - ox), Math.abs(z - oz));
    if (d < bd - 1e-6) { bd = d; best = i; }
  });
  return best;
}

/** True when a skyline point lies over one of the detailed sets (it would double it). */
export function underSets(def, x, z) {
  const r = def.half + def.spill;
  return def.sets.some(({ folder, offset: [ox, , oz] }) => folder !== def.far
    && Math.abs(x - ox) < r && Math.abs(z - oz) < r);
}

// Street surfaces are big triangles (whole road strips): cut by centre they would leave
// holes along a seam. Every set keeps all of its own; each later set sits a little
// lower, so in an overlap one copy of the same streets shows on top.
export const GROUND_MESH = /^(asphalt|pavement|ground|lm_grass|kerb|marking|road_marks.*)$/;
export const groundDrop = (i) => i * 0.05;
