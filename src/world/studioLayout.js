import { GRID_N } from './constants.js';

/** Drop a Blender glTF Binary on top of this path to replace the default room. */
export const STUDIO_GLB = '/assets/maps/custom.glb';
export const STUDIO_TARGET_SPAN = 32;

/**
 * Scale a Blender export into playable metres. Tiny (cm) and huge scenes
 * snap to TARGET_SPAN; metre-scale rooms stay as-authored.
 */
export function fitScale(span, target = STUDIO_TARGET_SPAN) {
  if (!(span > 0)) return 1;
  if (span < 4) return target / span;
  if (span > 250) return target / span;
  return 1;
}

export const OFFSTAGE = /proto$|fir_sapling|island_tree_02|tree_small_02_lod1/i;
export const SPAWN_NAME = /^(spawn|playerstart|start|spawn_point|camtarget)$/i;

export function isOffstage(name, x = 0, z = 0) {
  if (OFFSTAGE.test(String(name || ''))) return true;
  return Math.hypot(x, z) > 180;
}

export function colliderKind(name, box, span) {
  const n = String(name || '').toLowerCase();
  if (/spawn|playerstart|camera|camtarget|light|empty|person|head/.test(n)) return 'skip';
  if (/cypress|young|tree|leaf|sapling/.test(n)) return 'skip';
  const hy = box.max.y - box.min.y;
  const hx = box.max.x - box.min.x;
  const hz = box.max.z - box.min.z;
  if (hy < 0.18) return 'skip';
  if (hy < 1.15 && hx > span * 0.35 && hz > span * 0.35) return 'skip';
  if (/floor|ground|ceiling|roof|slab|road|street|sidewalk|promenade|lawn|pave|crosswalk|curb|water|pool|apron|star|mulch|grass|soil/.test(n) && hy < 2.4) {
    return 'skip';
  }
  if (/crate|box|wood|cover|bench/.test(n)) return 'wood';
  return 'concrete';
}

export function studioSlotSpawn(origin, slot = 0, radius = 3.2) {
  const ang = slot * 2.15;
  return {
    x: origin.x + Math.sin(ang) * radius,
    z: origin.z + Math.cos(ang) * radius,
    yaw: ang + Math.PI,
  };
}

export function studioRivalSpots(origin, count, blocked) {
  const spots = [];
  for (let i = 0; i < count; i++) {
    let at = null;
    for (let k = 0; k < 36 && !at; k++) {
      const ang = (i + 0.5) * (Math.PI * 2 / Math.max(count, 1)) + k * 0.19;
      const dist = 8.4 + (k % 4) * 1.4;
      const x = origin.x + Math.sin(ang) * dist;
      const z = origin.z + Math.cos(ang) * dist;
      if (blocked?.(x, z)) continue;
      at = { x, z, yaw: Math.atan2(origin.x - x, origin.z - z) };
    }
    const fallback = (i + 1) * 2.1;
    at ||= {
      x: origin.x + Math.sin(fallback) * 5.2,
      z: origin.z + Math.cos(fallback) * 5.2,
      yaw: fallback + Math.PI,
    };
    spots.push(at);
  }
  return spots;
}

export function buildStudioHeightmap(seed = 0) {
  const N = GRID_N;
  const heights = new Float32Array(N * N);
  const normals = new Uint8Array(N * N * 4);
  const biome = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    normals[k * 4] = 128;
    normals[k * 4 + 1] = 255;
    normals[k * 4 + 2] = 128;
    normals[k * 4 + 3] = 255;
    biome[k * 4] = 220;
    biome[k * 4 + 1] = 20;
    biome[k * 4 + 2] = 16;
    biome[k * 4 + 3] = 0;
  }
  return {
    heights,
    normals,
    biome,
    spawn: { x: 0, z: 5 },
    peak: { x: 0, z: 0, h: 3 },
    layout: { seed, kind: 'studio' },
  };
}
