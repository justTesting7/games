export const MAPS = {
  island: {
    id: 'island',
    label: 'Relic Isle',
    subtitle: 'Photoreal island · two Jev rivals',
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
    timeOfDay: 0.09,
    fogDensity: 0.0016,
  },
  city: {
    id: 'city',
    label: 'Dead District',
    subtitle: 'Urban ruins · streets, cover and Jev rivals',
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
  },
};

export function getMap(id) {
  return MAPS[id] || MAPS.island;
}
