import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paneOf } from './cityCars.js';

// Tel Aviv's parked cars. The blender file is hundreds of thousands of triangles per
// body; bake-fleet.mjs reduces each style to a few thousand, and every spot of one
// style shares that geometry. Wheels are baked on, so they don't spin.
const BASE = import.meta.env?.BASE_URL || '/shootout/';
const BAY_HL = 2.30; // nav bays are about 2.34 x 0.89; leave a little air
const BAY_HW = 0.87;

const paint = new THREE.MeshPhysicalMaterial({
  // White, so a parked car's own colour (set on the batch instance) shows through.
  name: 'fleet-paint', color: 0xffffff, roughness: 0.3, metalness: 0.25,
  clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2,
});
const glass = new THREE.MeshPhysicalMaterial({
  name: 'fleet-glass', color: 0x1c262c, roughness: 0.04, metalness: 0, ior: 1.52,
  envMapIntensity: 1.6, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
});
glass.blending = THREE.CustomBlending;
glass.blendSrc = THREE.SrcAlphaFactor;
glass.blendDst = THREE.OneMinusSrcAlphaFactor;
glass.blendSrcAlpha = THREE.ZeroFactor;
glass.blendDstAlpha = THREE.OneFactor;
const tyre = new THREE.MeshStandardMaterial({ name: 'fleet-tyre', color: 0x141414, roughness: 0.92, metalness: 0 });
const metal = new THREE.MeshStandardMaterial({ name: 'fleet-metal', color: 0xc5c8cc, roughness: 0.25, metalness: 0.85, envMapIntensity: 1.1 });
const trim = new THREE.MeshStandardMaterial({ name: 'fleet-trim', color: 0x1a1a1c, roughness: 0.45, metalness: 0.7, envMapIntensity: 1 });
const head = new THREE.MeshStandardMaterial({
  name: 'fleet-head', color: 0xdfe7ee, roughness: 0.15, metalness: 0, emissive: 0xfff2d0, emissiveIntensity: 0.35,
});
const tail = new THREE.MeshStandardMaterial({
  name: 'fleet-tail', color: 0x6a1010, roughness: 0.3, metalness: 0, emissive: 0xff2200, emissiveIntensity: 0.6,
});
const MATERIALS = { paint, glass, tyre, metal, trim, head, tail };

let templates = [];

function kind(name) {
  if (/^Paint/.test(name)) return 'paint';
  if (name === 'Glass') return 'glass';
  if (/Tyre/.test(name)) return 'tyre';
  if (/Headlight|Reverse/.test(name)) return 'head';
  if (/Taillight/.test(name)) return 'tail';
  if (/Chrome|Alloy|Mirror/.test(name)) return 'metal';
  return 'trim';
}

// Street colours. The body in the file is one dark paint; each spot picks one of these,
// the same pick on every client.
const PAINTS = [0xf2f2f0, 0xc5c8cc, 0x8e9399, 0x23262b, 0x8f2d2d, 0xb4532a, 0x1d3f78, 0x2a4a3c, 0xc6a15a, 0xd9d3c3, 0x4a4038, 0x6d3a4a]
  .map((hex) => new THREE.Color(hex));

/** Same colour on every client for a given parking spot. */
export function fleetColor(i) {
  let h = Math.imul(i + 7, 0x27bb2ee7);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return PAINTS[(h >>> 0) % PAINTS.length];
}

/** Same style on every client for a given parking spot. */
export function fleetVariant(i, n) {
  let h = Math.imul(i + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) % n;
}

function strip(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function merge(list) {
  if (!list.length) return null;
  const geo = list.length === 1 ? list[0] : mergeGeometries(list);
  if (!geo) throw new Error('fleet merge failed');
  if (list.length > 1) for (const g of list) g.dispose();
  geo.userData.shared = true;
  geo.computeBoundingSphere();
  return geo;
}

function extent(geos) {
  const e = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  for (const g of geos) {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      e.x0 = Math.min(e.x0, p[i]); e.x1 = Math.max(e.x1, p[i]);
      e.y0 = Math.min(e.y0, p[i + 1]); e.y1 = Math.max(e.y1, p[i + 1]);
      e.z0 = Math.min(e.z0, p[i + 2]); e.z1 = Math.max(e.z1, p[i + 2]);
    }
  }
  return e;
}

function fitIntoBay(geos) {
  const e = extent(geos);
  const hl0 = (e.z1 - e.z0) / 2, hw0 = (e.x1 - e.x0) / 2;
  const s = Math.min(1, BAY_HL / hl0, BAY_HW / hw0);
  const cx = (e.x0 + e.x1) / 2, cz = (e.z0 + e.z1) / 2;
  for (const g of geos) {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      p[i] = (p[i] - cx) * s;
      p[i + 1] = (p[i + 1] - e.y0) * s;
      p[i + 2] = (p[i + 2] - cz) * s;
    }
    g.attributes.position.needsUpdate = true;
    g.computeBoundingSphere();
  }
  return { hl: hl0 * s, hw: hw0 * s };
}

function splitGlass(geo) {
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const tris = [];
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3;
    const cz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;
    tris.push({ i, cx, cz, nx: nor[i] + nor[i + 3] + nor[i + 6], nz: nor[i + 2] + nor[i + 5] + nor[i + 8] });
  }
  if (!tris.length) return {};
  const zs = tris.map((t) => t.cz);
  const midZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const side = tris.filter((t) => Math.abs(t.nx) > Math.abs(t.nz) * 1.2).map((t) => t.cz);
  const sideMidZ = side.length ? (Math.min(...side) + Math.max(...side)) / 2 : midZ;
  const groups = {};
  for (const t of tris) {
    const name = paneOf(t.cx, t.cz, t.nx, t.nz, midZ, sideMidZ);
    (groups[name] || (groups[name] = [])).push(t.i);
  }
  const panes = {};
  for (const [name, starts] of Object.entries(groups)) {
    const p = new Float32Array(starts.length * 9);
    const n = new Float32Array(starts.length * 9);
    let w = 0;
    for (const s of starts) {
      p.set(pos.subarray(s, s + 9), w);
      n.set(nor.subarray(s, s + 9), w);
      w += 9;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.userData.shared = true;
    g.computeBoundingSphere();
    panes[name] = g;
  }
  return panes;
}

function boxOf(array) {
  const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  for (let i = 0; i < array.length; i += 3) {
    b.x0 = Math.min(b.x0, array[i]); b.x1 = Math.max(b.x1, array[i]);
    b.y0 = Math.min(b.y0, array[i + 1]); b.y1 = Math.max(b.y1, array[i + 1]);
    b.z0 = Math.min(b.z0, array[i + 2]); b.z1 = Math.max(b.z1, array[i + 2]);
  }
  b.x0 -= 0.03; b.x1 += 0.03; b.y0 -= 0.03; b.y1 += 0.03; b.z0 -= 0.03; b.z1 += 0.03;
  return b;
}

function metalOf(paneBoxes, hl, hw) {
  const sides = ['leftF', 'rightF', 'leftR', 'rightR'].map((k) => paneBoxes[k]).filter(Boolean);
  const sill = sides.length ? Math.min(...sides.map((b) => b.y0)) : 0.9;
  const top = Math.max(...Object.values(paneBoxes).map((b) => b.y1));
  return [
    { x0: -hw, x1: hw, y0: 0.12, y1: sill, z0: -hl, z1: hl },
    { x0: -hw * 0.85, x1: hw * 0.85, y0: top - 0.04, y1: top + 0.05, z0: -hl * 0.35, z1: hl * 0.3 },
  ];
}

function prepare(root) {
  // Blender faces +X; the game faces +Z, and the wheel (negative Z in the file) is the left side.
  root.rotation.y = -Math.PI / 2;
  root.position.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const buckets = { paint: [], glass: [], tyre: [], metal: [], trim: [], head: [], tail: [] };
  root.traverse((o) => {
    if (!o.isMesh) return;
    // Root position was zeroed, so this frame is the car's, turned to face +Z.
    const g = strip(o.geometry.clone());
    g.applyMatrix4(o.matrixWorld);
    buckets[kind(o.material?.name || '')].push(g);
  });
  const all = Object.values(buckets).flat();
  const { hl, hw } = fitIntoBay(all);
  const group = new THREE.Group();
  group.name = root.name;
  const glassGeo = merge(buckets.glass);
  const paneGeos = glassGeo ? splitGlass(glassGeo) : {};
  glassGeo?.dispose();
  const paneBoxes = {};
  for (const [name, geo] of Object.entries(paneGeos)) paneBoxes[name] = boxOf(geo.attributes.position.array);
  // the driver's door (the left, +x side: left-hand drive), cut out of the body along the
  // front side window, hinged at its front edge so it can swing open
  const win = paneBoxes.leftF;
  const door = win ? { x0: hw * 0.45, z0: win.z0 - 0.04, z1: win.z1 + 0.06, y0: 0.18, y1: win.y1 + 0.02 } : null;
  const doorGroup = door ? new THREE.Group() : null;
  if (doorGroup) {
    doorGroup.name = 'door';
    doorGroup.position.set(hw, 0, door.z1);
    group.add(doorGroup);
  }
  const add = (geo, material, name, shadow) => {
    let parent = group;
    if (door) {
      const [inside, rest] = splitBox(geo, door);
      if (inside) {
        inside.translate(-hw, 0, -door.z1);
        const m = new THREE.Mesh(inside, material);
        m.name = name; m.castShadow = shadow; m.receiveShadow = true;
        doorGroup.add(m);
      }
      geo = rest;
      if (!geo) return;
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
  };
  for (const key of ['paint', 'trim', 'metal', 'tyre', 'head', 'tail']) {
    const geo = merge(buckets[key]);
    if (geo) add(geo, MATERIALS[key], key, true);
  }
  for (const [name, geo] of Object.entries(paneGeos)) {
    if (name === 'leftF' && doorGroup) { // the window goes with the door, whole
      geo.translate(-hw, 0, -door.z1);
      const m = new THREE.Mesh(geo, glass);
      m.name = `pane-${name}`; m.castShadow = false; m.receiveShadow = true;
      doorGroup.add(m);
      continue;
    }
    const mesh = new THREE.Mesh(geo, glass);
    mesh.name = `pane-${name}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { name: root.name, group, hl, hw, paneBoxes, metalBoxes: metalOf(paneBoxes, hl, hw) };
}

// Splits a non-indexed geometry by triangle centre: inside the box, and the rest.
function splitBox(geo, b) {
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  const inIdx = [], outIdx = [];
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const x = (pos[i] + pos[i + 3] + pos[i + 6]) / 3, y = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3, z = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;
    (x > b.x0 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1 ? inIdx : outIdx).push(i);
  }
  if (!inIdx.length) return [null, geo];
  const make = (idx) => {
    if (!idx.length) return null;
    const p = new Float32Array(idx.length * 9), n = new Float32Array(idx.length * 9);
    idx.forEach((s, k) => { p.set(pos.subarray(s, s + 9), k * 9); n.set(nor.subarray(s, s + 9), k * 9); });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.userData.shared = true;
    g.computeBoundingSphere();
    return g;
  };
  const res = [make(inIdx), make(outIdx)];
  geo.dispose();
  return res;
}

/** Styles from an already-parsed scene (the bake test uses this). */
export function buildTemplates(scene) {
  templates = scene.children.filter((c) => c.name.startsWith('Car')).map(prepare);
  return templates;
}

export async function loadFleet() {
  const res = await fetch(`${BASE}assets/cars/fleet.glb`);
  if (!res.ok) throw new Error(`fleet.glb missing (${res.status})`);
  const gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), '');
  return buildTemplates(gltf.scene);
}

/** One mesh group per spot. Geometry stays shared across spots of the same style. */
export function placeFleet(spots) {
  return spots.map((spot, i) => {
    const tpl = templates[fleetVariant(i, templates.length)];
    const mesh = tpl.group.clone(true);
    const color = fleetColor(i);
    const panes = {};
    mesh.traverse((o) => {
      if (o.name.startsWith('pane-')) panes[o.name.slice(5)] = o;
      if (o.material?.name === 'fleet-paint') o.userData.fleetColor = color;
    });
    return {
      x: spot.x, z: spot.z, y: spot.y, yaw: spot.yaw,
      hl: tpl.hl, hw: tpl.hw, mesh, panes, paneBoxes: tpl.paneBoxes, metalBoxes: tpl.metalBoxes,
      door: mesh.getObjectByName('door') || null,
    };
  });
}
