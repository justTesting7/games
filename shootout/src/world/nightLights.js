import * as THREE from 'three';

// Light at night without real lights: every streetlamp throws a soft warm pool on the
// ground under it, and a driven car's headlights a pair of beams and a bright patch on
// the road ahead. All additive quads (one InstancedMesh for the lamps) whose strength
// follows the darkness, with the blend leaving the depth in alpha alone.

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowMaterial(color, map) {
  const m = new THREE.MeshBasicMaterial({
    color, map, transparent: true, depthWrite: false, opacity: 0, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}

/** Lamp heads from the city's glow meshes: triangles clustered by 2 m cells. */
export function findLamps(root) {
  const cells = new Map();
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.name !== 'lamp_glow') return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      const key = `${Math.floor(v.x / 2)},${Math.floor(v.z / 2)}`;
      const c = cells.get(key) || { x: 0, y: 0, z: 0, n: 0 };
      c.x += v.x; c.y += v.y; c.z += v.z; c.n++;
      cells.set(key, c);
    }
  });
  return [...cells.values()].map((c) => ({ x: c.x / c.n, y: c.y / c.n, z: c.z / c.n }));
}

export class NightLights {
  constructor(scene, lamps, heightAt) {
    this.map = poolTexture();
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.lampMat = glowMaterial(0xffc58a, this.map);
    this.lamps = new THREE.InstancedMesh(quad, this.lampMat, Math.max(1, lamps.length));
    this.lamps.count = lamps.length;
    this.lamps.frustumCulled = false;
    this.lamps.renderOrder = 2;
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => {
      const ground = heightAt(l.x, l.z);
      const r = THREE.MathUtils.clamp((l.y - ground) * 1.1, 4, 9); // a taller lamp lights a wider pool
      m.compose(new THREE.Vector3(l.x, ground + 0.05, l.z), new THREE.Quaternion(), new THREE.Vector3(r * 2, 1, r * 2));
      this.lamps.setMatrixAt(i, m);
    });
    scene.add(this.lamps);
    // headlights: two long faint beams and a bright patch ahead, for one car
    this.beamMat = glowMaterial(0xfff1d6, this.map);
    this.patchMat = glowMaterial(0xfff4e0, this.map);
    const beamGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.head = new THREE.Group();
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(beamGeo, this.beamMat);
      b.scale.set(2.6, 1, 16);
      b.position.set(side * 0.55, 0.06, 2.3);
      b.rotation.y = side * 0.04;
      this.head.add(b);
    }
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.patchMat);
    patch.scale.set(5.5, 1, 7);
    patch.position.set(0, 0.07, 7.5);
    this.head.add(patch);
    this.head.visible = false;
    this.head.renderOrder = 2;
    scene.add(this.head);
  }

  /** night 0..1; car = the car whose headlights shine (or null). */
  update(night, car, heightAt) {
    const k = THREE.MathUtils.smoothstep(night, 0.15, 0.7);
    this.lampMat.opacity = 0.55 * k;
    this.lamps.visible = k > 0.01;
    const on = !!car && k > 0.01 && !car.wrecked;
    this.head.visible = on;
    if (!on) return;
    this.beamMat.opacity = 0.22 * k;
    this.patchMat.opacity = 0.5 * k;
    this.head.position.set(car.x, heightAt(car.x, car.z), car.z);
    this.head.rotation.set(0, car.yaw, 0);
  }
}
