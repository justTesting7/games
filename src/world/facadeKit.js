import * as THREE from 'three';
import { loadGLTF, modelUrl } from '../engine/assets.js';

function worldMeshes(root, name) {
  const o = root.getObjectByName(name);
  if (!o) return [];
  const out = [];
  o.traverse((m) => {
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    out.push({ geometry: g, material: m.material });
  });
  return out;
}

/**
 * Builds one facade module from kit nodes that share a slot in the source
 * file (e.g. a wall with a window opening plus its window insert). The first
 * node anchors the module: centred on X, floor at y=0, and its front plane
 * (or back plane for trims that should protrude) at z=0.
 */
function extractModule(root, names, { protrude = false } = {}) {
  const pieces = [];
  let anchor = null;
  for (const n of names) {
    const ms = worldMeshes(root, n);
    if (!ms.length) {
      if (!anchor) return null;
      continue;
    }
    if (!anchor) {
      const bb = new THREE.Box3();
      ms.forEach((m) => { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox); });
      anchor = bb;
    }
    pieces.push(...ms);
  }
  const bb = anchor;
  const dx = -(bb.min.x + bb.max.x) * 0.5, dy = -bb.min.y, dz = protrude ? -bb.min.z : -bb.max.z;
  for (const p of pieces) {
    p.geometry.translate(dx, dy, dz);
    p.geometry.computeBoundingBox();
    p.geometry.computeBoundingSphere();
  }
  const size = bb.getSize(new THREE.Vector3());
  return { pieces, width: size.x, height: size.y };
}

const KIT_LAYOUT = {
  modular_urban_apartments_facade: {
    floorWindow: [['wall_window_centered_large_01', 'window_centered_large_01']],
    floorWindowAlt: [['wall_window_centered_double_01', 'window_centered_double_01'], ['wall_window_centered_large_02', 'window_centered_large_02']],
    storefront: [['wall_door_window_small_03', 'door_window_small_03'], ['wall_door_centered_large_01', 'door_centered_large_01']],
    cornice: [['cornice_standard_standard_01']],
    dado: [['dado_standard_standard_01']],
    crown: [['crown_standard_standard_01']],
  },
  modular_factory_facade: {
    floorWindow: [['wall_window_tall_large_02', 'window_tall_large_02']],
    floorWindowAlt: [['wall_window_tall_large_01', 'window_tall_large_01'], ['wall_window_centered_large_01', 'window_centered_large_01']],
    storefront: [['wall_door_centered_large_01', 'door_centered_large_01']],
    cornice: [['cornice01_standard_standard_01'], ['cornice02_standard_standard_01']],
    dado: [['dado_standard_standard_01']],
    crown: [['crown_standard_standard_01']],
  },
};
const TRIMS = new Set(['cornice', 'dado', 'crown']);

export async function loadFacadeKit(id) {
  const gltf = await loadGLTF(modelUrl(id));
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts = {};
  for (const [slot, options] of Object.entries(KIT_LAYOUT[id])) {
    for (const names of options) {
      const m = extractModule(root, names, { protrude: TRIMS.has(slot) });
      if (m) { parts[slot] = m; break; }
    }
  }
  parts.floorWindowAlt ||= parts.floorWindow;
  parts.storefront ||= parts.floorWindow;
  return { id, parts };
}

function bakeTarget(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  rt.texture.anisotropy = 8;
  return rt;
}

/**
 * Renders facade modules front-on, stacked one per floor, into tileable
 * albedo + tangent-space normal textures for the tower impostors.
 */
export function bakeFacadeTile(renderer, modules, { width = 3, floorH = 3, res = 256, glass = 0x141a1f } = {}) {
  const scene = new THREE.Scene();
  const pairs = [];
  modules.forEach((mod, row) => {
    for (const { geometry, material: src } of mod.pieces) {
      const albedo = new THREE.MeshBasicMaterial({
        map: src.map || null,
        color: src.color ? src.color.clone() : new THREE.Color(1, 1, 1),
        alphaTest: src.alphaTest || 0,
        side: src.side,
      });
      const normal = new THREE.MeshNormalMaterial({
        normalMap: src.normalMap || null,
        normalScale: src.normalScale ? src.normalScale.clone() : new THREE.Vector2(1, 1),
        side: src.side,
      });
      const mesh = new THREE.Mesh(geometry, albedo);
      mesh.position.y = row * floorH;
      scene.add(mesh);
      pairs.push({ mesh, albedo, normal });
    }
  });
  const height = floorH * modules.length;
  const cam = new THREE.OrthographicCamera(-width / 2, width / 2, height, 0, 0.01, 20);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);

  const prevRT = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.autoClear = true;
  renderer.shadowMap.autoUpdate = false;

  const w = res, h = res * modules.length;
  const albedoRT = bakeTarget(w, h);
  renderer.setRenderTarget(albedoRT);
  renderer.setClearColor(glass, 1);
  renderer.render(scene, cam);

  const normalRT = bakeTarget(w, h);
  pairs.forEach((p) => { p.mesh.material = p.normal; });
  renderer.setRenderTarget(normalRT);
  renderer.setClearColor(new THREE.Color().setRGB(0.5, 0.5, 1, THREE.LinearSRGBColorSpace), 1);
  renderer.render(scene, cam);

  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.autoClear = prevAuto;
  renderer.shadowMap.autoUpdate = prevShadow;
  pairs.forEach((p) => { p.albedo.dispose(); p.normal.dispose(); });
  return { map: albedoRT.texture, normalMap: normalRT.texture, floors: modules.length };
}

export class FacadeInstancer {
  constructor() {
    this.buckets = new Map();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  add(mod, pos, rotY = 0) {
    if (!mod) return;
    this._q.setFromAxisAngle(this._up, rotY);
    const m = new THREE.Matrix4().compose(pos, this._q, this._s);
    for (const piece of mod.pieces) {
      const k = `${piece.geometry.uuid}:${piece.material.uuid}`;
      let b = this.buckets.get(k);
      if (!b) this.buckets.set(k, (b = { piece, matrices: [] }));
      b.matrices.push(m);
    }
  }

  attach(group, { castShadow = true } = {}) {
    for (const { piece, matrices } of this.buckets.values()) {
      if (!matrices.length) continue;
      const mesh = new THREE.InstancedMesh(piece.geometry, piece.material, matrices.length);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
}
