import { makeNoise, hash2, hash3 } from './noise.js';
import { B, CHUNK, HEIGHT, SEA_LEVEL } from './blocks.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, MOUNTAIN: 5, SNOW: 6 };

export function createTerrain(seed) {
  const n = makeNoise(seed);
  const n2 = makeNoise(seed + 1013);

  function column(x, z) {
    const cont = n.fbm2(x * 0.0011, z * 0.0011, 5) + 0.2;
    const detail = n.fbm2(x * 0.011, z * 0.011, 4);
    const hills = n2.fbm2(x * 0.004, z * 0.004, 3);
    const mMask = smoothstep(0.0, 0.5, n2.fbm2(x * 0.0022 + 300, z * 0.0022 - 200, 3));
    const r1 = 1 - Math.abs(n.noise2(x * 0.0045, z * 0.0045));
    const r2 = 1 - Math.abs(n2.noise2(x * 0.011, z * 0.011));
    const ridge = r1 * r1 * 0.75 + r2 * r2 * 0.25;
    const land = smoothstep(-0.25, 0.15, cont);

    let h = SEA_LEVEL - 14 + cont * 22 + land * (16 + hills * 10 + detail * 4 + mMask * ridge * 52);
    h += detail * 2;
    h = Math.max(4, Math.min(HEIGHT - 12, Math.floor(h)));

    const temp = n2.fbm2(x * 0.0016 + 1000, z * 0.0016 + 1000, 3);
    const humid = n.fbm2(x * 0.0021 - 700, z * 0.0021 + 400, 3);

    let biome;
    if (h < SEA_LEVEL - 1) biome = BIOME.OCEAN;
    else if (h <= SEA_LEVEL + 1 && temp < 0.3) biome = BIOME.BEACH;
    else if (h > SEA_LEVEL + 44) biome = BIOME.SNOW;
    else if (h > SEA_LEVEL + 30 && mMask > 0.4) biome = BIOME.MOUNTAIN;
    else if (temp > 0.22) biome = BIOME.DESERT;
    else if (humid > 0.05) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;
    return { h, biome };
  }

  function generate(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const P = CHUNK + 2;
    const hs = new Int32Array(P * P);
    const bs = new Uint8Array(P * P);
    for (let z = -1; z <= CHUNK; z++) {
      for (let x = -1; x <= CHUNK; x++) {
        const c = column(x0 + x, z0 + z);
        hs[(x + 1) + (z + 1) * P] = c.h;
        bs[(x + 1) + (z + 1) * P] = c.biome;
      }
    }
    const idx = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const wx = x0 + x, wz = z0 + z;
        const pi = (x + 1) + (z + 1) * P;
        const h = hs[pi];
        const biome = bs[pi];
        const slope = Math.max(
          Math.abs(hs[pi + 1] - hs[pi - 1]),
          Math.abs(hs[pi + P] - hs[pi - P]),
        );
        const steep = slope >= 4;
        const underwater = h < SEA_LEVEL;
        const allowEntrance = h > SEA_LEVEL + 3;

        let top, filler, fillerDepth = 3;
        if (underwater) {
          const g = n.noise2(wx * 0.05, wz * 0.05);
          top = g > 0.35 ? B.GRAVEL : (h < SEA_LEVEL - 6 && g < -0.3 ? B.DIRT : B.SAND);
          filler = top === B.GRAVEL ? B.GRAVEL : B.SAND;
        } else if (biome === BIOME.BEACH) {
          top = B.SAND; filler = B.SAND;
        } else if (biome === BIOME.DESERT) {
          top = B.SAND; filler = B.SAND; fillerDepth = 4;
        } else if (biome === BIOME.SNOW) {
          top = steep ? B.STONE : B.SNOWY_GRASS; filler = steep ? B.STONE : B.DIRT;
        } else if (biome === BIOME.MOUNTAIN) {
          top = steep ? B.STONE : (h > SEA_LEVEL + 38 ? B.STONE : B.GRASS);
          filler = top === B.STONE ? B.STONE : B.DIRT;
        } else {
          top = steep && slope > 5 ? B.STONE : B.GRASS;
          filler = top === B.STONE ? B.STONE : B.DIRT;
        }

        for (let y = 0; y < HEIGHT; y++) {
          let id = B.AIR;
          if (y === 0) id = B.BEDROCK;
          else if (y <= 3 && hash3(wx, y, wz, seed) < 0.5 - y * 0.12) id = B.BEDROCK;
          else if (y < h - fillerDepth) {
            id = B.STONE;
            if (biome === BIOME.DESERT && y >= h - fillerDepth - 4) id = B.SANDSTONE;
          } else if (y < h) id = filler;
          else if (y === h) id = top;
          else if (y <= SEA_LEVEL) id = B.WATER;

          if (id !== B.AIR && id !== B.WATER && id !== B.BEDROCK && y > 3) {
            const limit = allowEntrance ? h + 1 : h - 5;
            if (y < limit) {
              const a = n.noise3(wx * 0.018, y * 0.028, wz * 0.018);
              const b = n2.noise3(wx * 0.018 + 50, y * 0.028, wz * 0.018 + 50);
              let carve = a * a + b * b < 0.0055 * (1 + (y < 30 ? 0.6 : 0));
              if (!carve && y < 40) {
                const c = n.noise3(wx * 0.011 + 200, y * 0.02, wz * 0.011 - 200);
                carve = c > 0.68;
              }
              if (carve) id = y <= 8 ? B.AIR : B.AIR;
            }
          }

          if (id === B.STONE) {
            const cxh = hash3(wx >> 1, y >> 1, wz >> 1, seed + 7);
            const r = hash3(wx, y, wz, seed + 11);
            if (r < 0.55) {
              if (cxh < 0.022 && y < 100) id = B.COAL;
              else if (cxh < 0.034 && y < 64) id = B.IRON;
              else if (cxh < 0.038 && y < 32) id = B.GOLD;
              else if (cxh < 0.0405 && y < 16) id = B.DIAMOND;
            }
          }
          data[idx(x, y, z)] = id;
        }
      }
    }

    placeFeatures(cx, cz, data, hs, bs);
    return data;
  }

  function setIf(data, x, y, z, id, force) {
    if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || y < 0 || y >= HEIGHT) return;
    const i = x + z * CHUNK + y * CHUNK * CHUNK;
    const cur = data[i];
    if (force || cur === B.AIR || cur === B.TALLGRASS || cur === B.FLOWER_RED || cur === B.FLOWER_YELLOW) {
      data[i] = id;
    }
  }

  function placeFeatures(cx, cz, data, hs, bs) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const CELL = 5;
    const margin = 3;
    const c0x = Math.floor((x0 - margin) / CELL), c1x = Math.floor((x0 + CHUNK + margin) / CELL);
    const c0z = Math.floor((z0 - margin) / CELL), c1z = Math.floor((z0 + CHUNK + margin) / CELL);

    for (let gz = c0z; gz <= c1z; gz++) {
      for (let gx = c0x; gx <= c1x; gx++) {
        const r = hash2(gx, gz, seed + 101);
        const tx = gx * CELL + Math.floor(hash2(gx, gz, seed + 102) * CELL);
        const tz = gz * CELL + Math.floor(hash2(gx, gz, seed + 103) * CELL);
        const { h, biome } = column(tx, tz);
        if (h <= SEA_LEVEL) continue;
        const lx = tx - x0, lz = tz - z0;

        if (biome === BIOME.DESERT) {
          if (r < 0.1) {
            const ch = 1 + Math.floor(hash2(gx, gz, seed + 104) * 3);
            for (let y = 1; y <= ch; y++) setIf(data, lx, h + y, lz, B.CACTUS, true);
          }
          continue;
        }
        let density = 0;
        if (biome === BIOME.FOREST) density = 0.8;
        else if (biome === BIOME.PLAINS) density = 0.07;
        else if (biome === BIOME.MOUNTAIN && h < SEA_LEVEL + 38) density = 0.2;
        if (r >= density) continue;

        const birch = biome === BIOME.FOREST && hash2(gx, gz, seed + 105) < 0.3;
        const logId = birch ? B.BIRCH_LOG : B.LOG;
        const leafId = birch ? B.BIRCH_LEAVES : B.LEAVES;
        const th = (birch ? 5 : 4) + Math.floor(hash2(gx, gz, seed + 106) * 3);
        const topY = h + th;

        for (let ly = topY - 2; ly <= topY + 1; ly++) {
          const rad = ly <= topY - 1 ? 2 : 1;
          for (let dz = -rad; dz <= rad; dz++) {
            for (let dx = -rad; dx <= rad; dx++) {
              const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
              if (corner) {
                if (ly === topY + 1) continue;
                if (hash3(tx + dx, ly, tz + dz, seed + 107) < 0.5) continue;
              }
              setIf(data, lx + dx, ly, lz + dz, leafId, false);
            }
          }
        }
        for (let y = 1; y <= th; y++) setIf(data, lx, h + y, lz, logId, true);
        if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK) {
          const gi = lx + lz * CHUNK + h * CHUNK * CHUNK;
          if (data[gi] === B.GRASS) data[gi] = B.DIRT;
        }
      }
    }

    const P = CHUNK + 2;
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const pi = (x + 1) + (z + 1) * P;
        const h = hs[pi];
        if (h + 1 >= HEIGHT) continue;
        const gi = x + z * CHUNK + h * CHUNK * CHUNK;
        if (data[gi] !== B.GRASS) continue;
        const above = gi + CHUNK * CHUNK;
        if (data[above] !== B.AIR) continue;
        const wx = x0 + x, wz = z0 + z;
        const r = hash2(wx, wz, seed + 201);
        const biome = bs[pi];
        const grassChance = biome === BIOME.PLAINS ? 0.2 : 0.1;
        const flowerPatch = n2.noise2(wx * 0.04, wz * 0.04);
        if (r < grassChance) data[above] = B.TALLGRASS;
        else if (flowerPatch > 0.45 && r < grassChance + 0.08) {
          data[above] = hash2(wx, wz, seed + 202) < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW;
        }
      }
    }
  }

  return { generate, column };
}
