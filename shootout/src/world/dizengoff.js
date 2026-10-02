import * as THREE from 'three';
import { loadCity } from './loadCity.js';
import { extractCityCars, removeInBoxes } from './cityCars.js';
import { buildStadium, stadiumSlotSpawns, STADIUM } from './stadium.js';
import { buildShotMesh } from './shotMesh.js';
import { chunkMeshes, cullDetails, hideDetails, CityCuller } from './chunkMeshes.js';
import { findLamps } from './nightLights.js';
import { buildPitchProps } from './pitchProps.js';
import { pickRivalSpots, slotSpawns } from './rivalSpots.js';

const BASE = import.meta.env?.BASE_URL || '/shootout/';
export const navUrl = (folder) => `${BASE}assets/maps/${folder}/nav.json`;
const FAR_DISTANCE = 9000; // far.glb spans 8 km
const NO_CAST = /^(asphalt|pavement|ground|lm_grass|kerb|marking|road_marks.*|lamp_glow|house_numbers|name_plates|lm_glass|glass|carglass)$/;

function decodeInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** Bilinear ground height in metres from the baked 1 m grid (see bake-dizengoff-nav.mjs). */
export function makeNavHeight(nav) {
  const heights = nav.heights instanceof Int16Array ? nav.heights : decodeInt16(nav.heights);
  const { hcell, hw, hh, x0, z0 } = nav;
  const at = (i, j) => heights[Math.max(0, Math.min(hh - 1, j)) * hw + Math.max(0, Math.min(hw - 1, i))] / 100;
  let max = -Infinity;
  for (const h of heights) if (h > max) max = h;
  const fn = (x, z) => {
    const fx = (x - x0) / hcell - 0.5, fz = (z - z0) / hcell - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = at(i, j) * (1 - tx) + at(i + 1, j) * tx;
    const b = at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx;
    return a * (1 - tz) + b * tz;
  };
  fn.max = max / 100; // the highest ground (terrain.raycast skips rays above it)
  return fn;
}

/**
 * Wall and obstacle rectangles for walking. With a shot mesh (noRay) bullets and sight
 * lines trace the real triangles instead; otherwise tall boxes stop bullets at any
 * height and low ones only near the ground.
 */
export function addNavColliders(nav, colliders, heightAt, noRay = false) {
  for (const [x0, z0, x1, z1, tall] of nav.boxes) {
    const g = heightAt((x0 + x1) * 0.5, (z0 + z1) * 0.5);
    colliders.addBox({
      x0, x1, z0, z1,
      y0: g - 4,
      y1: tall ? g + 200 : g + 2.4,
      type: tall ? 'concrete' : 'wood',
      noRay,
    });
  }
  return nav.boxes.length;
}

/**
 * Dizengoff Center: the optimised city set (set.glb) plus its far skyline
 * (far.glb), walked on the baked height/collision grid.
 */
export async function loadDizengoff(renderer, folder = 'dizengoff-center', { stadiumStart = false } = {}) {
  const group = new THREE.Group();
  group.name = `city-${folder}`;
  const [nav, city] = await Promise.all([
    fetch(navUrl(folder)).then((r) => { if (!r.ok) throw new Error('nav.json missing'); return r.json(); }),
    loadCity(group, renderer, folder),
  ]);
  // Streets, kerbs, markings and grass are flat: they receive shadows but casting only
  // adds draw calls to the shadow pass. Glow cards and decals don't cast either.
  city.set.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    o.castShadow = !NO_CAST.test(o.name);
  });
  city.far.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const stadium = nav.stadium ? buildStadium(THREE, city.set, nav.stadium, nav.stadium.floorY) : null;
  if (stadium) group.add(stadium.group);
  const pitchProps = nav.stadium?.pitch ? buildPitchProps(nav.stadium.pitch) : null;
  if (pitchProps) group.add(pitchProps.group);
  const heightAt = makeNavHeight(nav);
  const lamps = findLamps(city.set);
  // Stadium maps: everyone starts inside, one player per stand; the local player takes the first
  const stands = stadiumStart && nav.stadium ? stadiumSlotSpawns(nav.stadium) : null;
  const spawn = stands ? { ...stands[0] } : { ...nav.spawn };
  spawn.y = heightAt(spawn.x, spawn.z);
  let details = null; // the small-detail pieces left as meshes, culled by distance (see chunk)
  let culler = null; // the batched city cells (see chunk)
  return {
    group,
    root: city.set,
    spawn,
    outdoor: true,
    stadium: nav.stadium || null,
    /** Open ground the pigeons can have: the same places fighters may start from. */
    pigeonHomes: () => (nav.spots || []).map(([x, z]) => ({ x, z })),
    rivalSpots: (origin, count) => (stands
      ? Array.from({ length: count }, (_, i) => stands[(i + 1) % stands.length]) // the other stands
      : pickRivalSpots(nav.spots || [], origin, count)),
    /** Where player `slot` starts in a multiplayer room (identical on every client). */
    slotSpawn: (slot) => {
      const all = stadiumStart && nav.stadium ? stadiumSlotSpawns(nav.stadium) : slotSpawns(nav.spots || [], 16);
      return all.length ? all[slot % all.length] : null;
    },
    heightAt,
    lamps,
    cameraFar: FAR_DISTANCE,
    addColliders: (colliders) => {
      for (const c of pitchProps?.colliders || []) colliders.add(c);
      return addNavColliders(nav, colliders, heightAt, true);
    },
    /** Exact bullet / sight-line geometry; call after takeCars and takeScooters. */
    buildShots: () => buildShotMesh([city.set, ...(stadium ? [stadium.group] : [])], {
      doors: stadium?.doors || [], doorMesh: STADIUM.glassMesh,
    }),
    /** Cuts the parked cars out of the map meshes, once, as movable groups. */
    takeCars: () => extractCityCars(city.set, nav.cars || []),
    /** Replaces the parked scooters with rideable ones: removes the originals and returns their spots. */
    takeScooters: () => {
      if (!nav.scooters?.length) return [];
      removeInBoxes(city.set, nav.scooterRemove || []);
      return nav.scooters;
    },
    /** Splits the district-wide meshes into culling cells; call after the cars and scooters are cut out. */
    chunk: () => {
      const res = chunkMeshes(city.set, { batch: true });
      details = res.details;
      culler = res.cells.length ? new CityCuller(res.cells) : null;
      return res;
    },
    /**
     * What of the city to draw for a camera (the view, or a shadow map's light camera):
     * cells in its frustum, small things only near `at`; `range` scales those distances,
     * `details: false` leaves them out altogether (the far shadow cascade).
     */
    cull: (camera, at, range = 1, { details: withDetails = true, frustum = true } = {}) => {
      const f = withDetails ? 150 * range : 0, m = withDetails ? 320 * range : 0;
      culler?.updateFor(frustum ? camera : null, at, f, m);
      if (details?.length) cullDetails(details, at, { fine: f, mid: m });
    },
    cullDetails: (at, range = 1) => details && cullDetails(details, at, { fine: 150 * range, mid: 320 * range }),
    hideDetails: (hide) => details && hideDetails(details, hide),
    /** minutes = 0..1439, night = 0..1 */
    update: city.update,
  };
}
