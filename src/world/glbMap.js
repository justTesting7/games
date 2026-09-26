import * as THREE from 'three';
import { loadGLTF } from '../engine/assets.js';
import {
  STUDIO_GLB, STUDIO_TARGET_SPAN, SPAWN_NAME, colliderKind, fitScale, isOffstage,
  studioRivalSpots, studioSlotSpawn,
} from './studioLayout.js';

export {
  STUDIO_GLB, STUDIO_TARGET_SPAN, SPAWN_NAME, colliderKind, fitScale, isOffstage,
  studioRivalSpots, studioSlotSpawn,
};

const _box = new THREE.Box3();
const _size = new THREE.Vector3();

export function hideOffstage(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.name && !o.position) return;
    if (isOffstage(o.name, o.position.x, o.position.z)) {
      o.visible = false;
      n += 1;
    }
  });
  return n;
}

export function isOutdoorStudio(root) {
  let ground = false;
  let street = false;
  root.traverse((o) => {
    const n = o.name || '';
    if (/ground|lawn/i.test(n)) ground = true;
    if (/road|street|promenade/i.test(n)) street = true;
  });
  return ground && street;
}

export function findSpawn(root) {
  let found = null;
  root.traverse((o) => {
    if (found || !o.name || !o.visible) return;
    if (SPAWN_NAME.test(o.name.trim())) found = o;
  });
  if (!found) return null;
  const p = new THREE.Vector3();
  found.getWorldPosition(p);
  const e = new THREE.Euler().setFromRotationMatrix(found.matrixWorld);
  return { x: p.x, y: p.y, z: p.z, yaw: e.y, node: found };
}

function unionVisible(root, { skipPads = false } = {}) {
  const box = new THREE.Box3();
  let any = false;
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    _box.setFromObject(o);
    if (!Number.isFinite(_box.min.x)) return;
    if (skipPads) {
      _box.getSize(_size);
      if (_size.y < 1.2 && _size.x > 40 && _size.z > 40) return;
    }
    if (!any) box.copy(_box);
    else box.union(_box);
    any = true;
  });
  return any ? box : null;
}

export function fitStudio(root, target = STUDIO_TARGET_SPAN) {
  hideOffstage(root);
  root.updateMatrixWorld(true);
  const full = unionVisible(root) || new THREE.Box3().setFromObject(root);
  const content = unionVisible(root, { skipPads: true }) || full;
  const size = content.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z);
  const scale = fitScale(span, target);
  const cx = (full.min.x + full.max.x) * 0.5;
  const cz = (full.min.z + full.max.z) * 0.5;
  root.scale.multiplyScalar(scale);
  root.position.x += -cx * scale;
  root.position.z += -cz * scale;
  root.position.y += -full.min.y * scale;
  root.updateMatrixWorld(true);
  const fitted = unionVisible(root) || new THREE.Box3().setFromObject(root);
  const fittedSize = fitted.getSize(new THREE.Vector3());
  return {
    scale,
    box: fitted,
    span: Math.max(fittedSize.x, fittedSize.z),
    height: fittedSize.y,
  };
}

export function makeHeightAt(root, box) {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const cache = new Map();
  const top = (box?.max.y ?? 8) + 12;
  const far = (box ? box.max.y - box.min.y : 8) + 24;
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  return (x, z) => {
    const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
    if (cache.has(key)) return cache.get(key);
    origin.set(x, top, z);
    ray.set(origin, down);
    ray.far = far;
    const hits = ray.intersectObjects(meshes, false);
    let h = 0;
    for (const hit of hits) {
      const n = hit.face?.normal;
      if (n) {
        const worldN = n.clone().transformDirection(hit.object.matrixWorld);
        if (worldN.y < 0.25) continue;
      }
      h = hit.point.y;
      break;
    }
    cache.set(key, h);
    return h;
  };
}

export function addStudioColliders(root, colliders, span) {
  const added = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const box = new THREE.Box3().setFromObject(o);
    const kind = colliderKind(o.name, box, span);
    if (kind === 'skip') return;
    const rec = {
      x0: box.min.x, x1: box.max.x,
      z0: box.min.z, z1: box.max.z,
      y0: box.min.y, y1: box.max.y,
      type: kind,
    };
    colliders.addBox(rec);
    added.push({ name: o.name, ...rec });
  });
  return added;
}

export function blockedAt(colliders, x, z, r = 0.75) {
  if (!colliders) return false;
  const hits = colliders.query(x, z, r);
  return hits.some((c) => {
    if (!c.box) return Math.hypot(x - c.x, z - c.z) < (c.r || 0) + r;
    return x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
  });
}

function dressMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.transparent || m.alphaTest > 0) m.side = THREE.DoubleSide;
      m.envMapIntensity = m.envMapIntensity ?? 0.45;
    }
  });
}

function addFillLights(group, box) {
  const y = Math.min((box.max.y || 5) - 0.6, 5.4);
  const key = new THREE.PointLight(0xfff1dc, 28, 36, 1.4);
  key.position.set(0, y, 0);
  key.castShadow = true;
  const fill = new THREE.PointLight(0xc8d8ff, 12, 30, 1.6);
  fill.position.set(-7, y * 0.7, 5);
  const rim = new THREE.PointLight(0xffd8b0, 10, 26, 1.6);
  rim.position.set(8, y * 0.65, -4);
  group.add(key, fill, rim);
}

export function prepareStudio(root) {
  const group = new THREE.Group();
  group.name = 'studio-glb';
  group.add(root);
  const outdoor = isOutdoorStudio(root);
  const fit = fitStudio(root);
  dressMaterials(root);
  if (!outdoor) addFillLights(group, fit.box);
  const heightAt = makeHeightAt(root, fit.box);
  const marked = findSpawn(root);
  const spawn = marked
    ? { x: marked.x, z: marked.z, y: marked.y, yaw: marked.yaw }
    : { x: 0, z: outdoor ? -4 : 5, y: heightAt(0, outdoor ? -4 : 5), yaw: outdoor ? 0 : Math.PI };
  if (spawn.y == null) spawn.y = heightAt(spawn.x, spawn.z);
  return {
    group,
    root,
    spawn,
    outdoor,
    heightAt,
    fit,
    addColliders(colliders) {
      return addStudioColliders(root, colliders, fit.span);
    },
  };
}

function fallbackStudio() {
  const root = new THREE.Group();
  root.name = 'StudioFallback';
  const mk = (name, w, h, d, x, y, z, color, metal = 0, rough = 0.86) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }),
    );
    mesh.name = name;
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  mk('Floor', 28, 0.24, 20, 0, 0.12, 0, 0x2c2c2a);
  mk('Wall_N', 28.7, 5.6, 0.35, 0, 2.8, 10, 0x1c2226);
  mk('Wall_S', 28.7, 5.6, 0.35, 0, 2.8, -10, 0x1c2226);
  mk('Wall_E', 0.35, 5.6, 20, 14, 2.8, 0, 0x14383c);
  mk('Wall_W', 0.35, 5.6, 20, -14, 2.8, 0, 0x1c2226);
  mk('Ceiling', 28, 0.2, 20, 0, 5.7, 0, 0x141416);
  mk('Crate_A', 1.4, 1.4, 1.4, 5.2, 0.7, -3.2, 0x6b4724);
  mk('Crate_B', 1.8, 1.1, 1.2, -4.4, 0.55, 2.4, 0x6b4724);
  mk('Crate_C', 1.2, 1.8, 1.2, 3.6, 0.9, 4.1, 0x6b4724);
  mk('Pillar_A', 0.7, 5.4, 0.7, -8.5, 2.7, -6, 0x595a5c, 0.55, 0.4);
  mk('Pillar_B', 0.7, 5.4, 0.7, 8.5, 2.7, 6, 0x595a5c, 0.55, 0.4);
  mk('Cover', 3.4, 1.15, 0.4, 0, 0.58, -1.2, 0x3a3834);
  mk('Platform', 4.2, 0.7, 3.2, -7.2, 0.35, -5.2, 0x383430);
  const spawn = new THREE.Object3D();
  spawn.name = 'Spawn';
  spawn.position.set(0, 0.24, 5);
  spawn.rotation.y = Math.PI;
  root.add(spawn);
  return root;
}

export async function loadStudioMap(url = STUDIO_GLB) {
  try {
    const gltf = await loadGLTF(url);
    return prepareStudio(gltf.scene);
  } catch {
    return prepareStudio(fallbackStudio());
  }
}
