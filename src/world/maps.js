export const MAPS = {
  island: {
    id: 'island',
    label: 'Relic Isle',
    subtitle: 'Photoreal island · swim the coast, fish in the water',
    loadLabel: 'Shaping the island',
    plantLabel: 'Planting the forest',
    textures: {
      sand: 'coast_sand_01',
      grass: 'leafy_grass',
      forest: 'forest_leaves_02',
      rock: 'rock_face_03',
    },
    grass: true,
    vegetation: true,
    waterCamp: true,
    fish: true,
    timeOfDay: 0.09,
    fogDensity: 0.0016,
    radarRange: 120,
  },
  city: {
    id: 'city',
    label: 'Dead District',
    subtitle: 'Urban ruins · plaza shootout and Jev rivals',
    loadLabel: 'Raising the dead district',
    plantLabel: 'Scattering wreckage',
    textures: {
      sand: 'asphalt_01',
      grass: 'brushed_concrete_2',
      forest: 'burned_ground_01',
      rock: 'broken_brick_wall',
    },
    grass: false,
    vegetation: false,
    waterCamp: false,
    timeOfDay: 0.22,
    fogDensity: 0.0028,
    radarRange: 100,
  },
  garden: {
    id: 'garden',
    label: 'Madison Square Garden',
    subtitle: 'The Garden · court, stands and outer halls',
    loadLabel: 'Raising the Garden',
    plantLabel: 'Dressing the concourse',
    textures: {
      sand: 'asphalt_01',
      grass: 'brushed_concrete_2',
      forest: 'burned_ground_01',
      rock: 'broken_brick_wall',
    },
    grass: false,
    vegetation: false,
    waterCamp: false,
    timeOfDay: 0.78,
    fogDensity: 0.0048,
    radarRange: 80,
  },
};

export function getMap(id) {
  return MAPS[id] || MAPS.island;
}
