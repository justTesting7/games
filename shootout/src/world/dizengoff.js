import * as THREE from 'three';
import { loadCity } from './loadCity.js';
import { extractCityCars } from './cityCars.js';

const BASE = import.meta.env?.BASE_URL || '/shootout/';
export const navUrl = (folder) => `${BASE}assets/maps/${folder}/nav.json`;
const FAR_DISTANCE = 9000; // far.glb spans 8 km

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
  return (x, z) => {
    const fx = (x - x0) / hcell - 0.5, fz = (z - z0) / hcell - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = at(i, j) * (1 - tx) + at(i + 1, j) * tx;
    const b = at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx;
    return a * (1 - tz) + b * tz;
  };
}

/** Wall and obstacle rectangles: tall ones stop bullets at any height, low ones only near the ground. */
export function addNavColliders(nav, colliders, heightAt) {
  for (const [x0, z0, x1, z1, tall] of nav.boxes) {
    const g = heightAt((x0 + x1) * 0.5, (z0 + z1) * 0.5);
    colliders.addBox({
      x0, x1, z0, z1,
      y0: g - 4,
      y1: tall ? g + 200 : g + 2.4,
      type: tall ? 'concrete' : 'wood',
    });
  }
  return nav.boxes.length;
}

/**
 * Dizengoff Center: the optimised city set (set.glb) plus its far skyline
 * (far.glb), walked on the baked height/collision grid.
 */
export async function loadDizengoff(renderer, folder = 'dizengoff-center') {
  const group = new THREE.Group();
  group.name = `city-${folder}`;
  const [nav, city] = await Promise.all([
    fetch(navUrl(folder)).then((r) => { if (!r.ok) throw new Error('nav.json missing'); return r.json(); }),
    loadCity(group, renderer, folder),
  ]);
  city.set.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  city.far.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const heightAt = makeNavHeight(nav);
  const spawn = { ...nav.spawn };
  spawn.y = heightAt(spawn.x, spawn.z);
  return {
    group,
    root: city.set,
    spawn,
    outdoor: true,
    heightAt,
    cameraFar: FAR_DISTANCE,
    addColliders: (colliders) => addNavColliders(nav, colliders, heightAt),
    /** Cuts the parked cars out of the map meshes, once, as movable groups. */
    takeCars: () => extractCityCars(city.set, nav.cars || []),
    /** minutes = 0..1439, night = 0..1 */
    update: city.update,
  };
}
