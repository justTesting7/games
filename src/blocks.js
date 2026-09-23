// Texture layer names. Order defines the layer index in the texture array.
export const TEX_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'log_side', 'log_top',
  'leaves', 'planks', 'cobblestone', 'glass', 'bricks', 'snow', 'snow_side',
  'gravel', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'tallgrass',
  'flower_red', 'flower_yellow', 'glowstone', 'bedrock', 'sandstone_side',
  'sandstone_top', 'birch_side', 'birch_leaves', 'cactus_side', 'cactus_top',
];

export const TEX = Object.fromEntries(TEX_NAMES.map((n, i) => [n, i]));

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG: 6, LEAVES: 7,
  PLANKS: 8, COBBLE: 9, GLASS: 10, BRICKS: 11, SNOWY_GRASS: 12, GRAVEL: 13,
  COAL: 14, IRON: 15, GOLD: 16, DIAMOND: 17, TALLGRASS: 18, FLOWER_RED: 19,
  FLOWER_YELLOW: 20, GLOWSTONE: 21, BEDROCK: 22, SANDSTONE: 23, BIRCH_LOG: 24,
  BIRCH_LEAVES: 25, CACTUS: 26, SNOW: 27,
};

function def(name, tex, opts = {}) {
  const t = typeof tex === 'string' ? { top: tex, bottom: tex, side: tex } : tex;
  return {
    name,
    top: TEX[t.top], bottom: TEX[t.bottom], side: TEX[t.side],
    solid: opts.solid ?? true,
    opaque: opts.opaque ?? true,
    occludes: opts.occludes ?? (opts.opaque ?? true),
    cutout: opts.cutout ?? false,
    cross: opts.cross ?? false,
    liquid: opts.liquid ?? false,
    cullSelf: opts.cullSelf ?? false,
    wave: opts.wave ?? 0,
    emissive: opts.emissive ?? false,
    breakable: opts.breakable ?? true,
  };
}

const leaves = { opaque: false, occludes: true, cutout: true, wave: 1 };
const plant = { solid: false, opaque: false, occludes: false, cutout: true, cross: true, wave: 2 };

export const BLOCKS = [];
BLOCKS[B.AIR] = def('Air', 'stone', { solid: false, opaque: false, occludes: false });
BLOCKS[B.GRASS] = def('Grass', { top: 'grass_top', bottom: 'dirt', side: 'grass_side' });
BLOCKS[B.DIRT] = def('Dirt', 'dirt');
BLOCKS[B.STONE] = def('Stone', 'stone');
BLOCKS[B.SAND] = def('Sand', 'sand');
BLOCKS[B.WATER] = def('Water', 'stone', { solid: false, opaque: false, occludes: false, liquid: true, breakable: false });
BLOCKS[B.LOG] = def('Oak Log', { top: 'log_top', bottom: 'log_top', side: 'log_side' });
BLOCKS[B.LEAVES] = def('Oak Leaves', 'leaves', leaves);
BLOCKS[B.PLANKS] = def('Planks', 'planks');
BLOCKS[B.COBBLE] = def('Cobblestone', 'cobblestone');
BLOCKS[B.GLASS] = def('Glass', 'glass', { opaque: false, occludes: false, cutout: true, cullSelf: true });
BLOCKS[B.BRICKS] = def('Bricks', 'bricks');
BLOCKS[B.SNOWY_GRASS] = def('Snowy Grass', { top: 'snow', bottom: 'dirt', side: 'snow_side' });
BLOCKS[B.GRAVEL] = def('Gravel', 'gravel');
BLOCKS[B.COAL] = def('Coal Ore', 'coal_ore');
BLOCKS[B.IRON] = def('Iron Ore', 'iron_ore');
BLOCKS[B.GOLD] = def('Gold Ore', 'gold_ore');
BLOCKS[B.DIAMOND] = def('Diamond Ore', 'diamond_ore');
BLOCKS[B.TALLGRASS] = def('Tall Grass', 'tallgrass', plant);
BLOCKS[B.FLOWER_RED] = def('Poppy', 'flower_red', plant);
BLOCKS[B.FLOWER_YELLOW] = def('Dandelion', 'flower_yellow', plant);
BLOCKS[B.GLOWSTONE] = def('Glowstone', 'glowstone', { emissive: true });
BLOCKS[B.BEDROCK] = def('Bedrock', 'bedrock', { breakable: false });
BLOCKS[B.SANDSTONE] = def('Sandstone', { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' });
BLOCKS[B.BIRCH_LOG] = def('Birch Log', { top: 'log_top', bottom: 'log_top', side: 'birch_side' });
BLOCKS[B.BIRCH_LEAVES] = def('Birch Leaves', 'birch_leaves', leaves);
BLOCKS[B.CACTUS] = def('Cactus', { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' });
BLOCKS[B.SNOW] = def('Snow', 'snow');

export const CHUNK = 16;
export const HEIGHT = 128;
export const SEA_LEVEL = 48;
