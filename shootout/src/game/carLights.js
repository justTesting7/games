import * as THREE from 'three';

// Lamps for the city cars, whose baked bodies have no light meshes of their own: a pair of
// small HDR quads at the tail and at the nose of every car with someone at the wheel. The
// tails glow red, flare when the car brakes (bloom picks them up) and turn white in
// reverse; the heads are pale by day and blaze at night. Each car's lamp positions are
// measured once from its own body so the quads sit on the bodywork, not in the air.

const POOL = 8;
const quad = new THREE.PlaneGeometry(1, 1);

let haloTex = null;
function haloMaterial() {
  if (!haloTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.12, 'rgba(255,255,255,0.4)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.08)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    haloTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.SpriteMaterial({ map: haloTex, color: 0x000000, depthWrite: false, toneMapped: false });
  // added on top, leaving the scene depth the HDR target keeps in alpha (engine/patch.js)
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}

function lampMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
}

/**
 * Where a car's lamps go, in its own frame (+z forward, +x left): the body's surface at
 * the rear and front in the band where lamps sit, from the vertices of its meshes.
 */
export function lampSpots(car) {
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  const pts = [];
  car.mesh.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(car.mesh.matrixWorld).invert();
  car.mesh.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position || /glass/i.test(o.material?.name || '')) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      pts.push(v.x, v.y, v.z);
      box.expandByPoint(v);
    }
  });
  if (box.isEmpty()) return null;
  const h = box.max.y - box.min.y, halfW = (box.max.x - box.min.x) / 2, cx = (box.max.x + box.min.x) / 2;
  // the outermost body surface within a height band, over the outer part of the width
  const face = (y0, y1, sign) => {
    let best = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const y = pts[i + 1];
      if (y < box.min.y + y0 * h || y > box.min.y + y1 * h || Math.abs(pts[i] - cx) < halfW * 0.35) continue;
      best = Math.max(best, pts[i + 2] * sign);
    }
    return Number.isFinite(best) ? best * sign : (sign > 0 ? box.max.z : box.min.z);
  };
  const tailY = box.min.y + h * 0.58, headY = box.min.y + h * 0.45;
  return {
    tail: { y: tailY, z: face(0.5, 0.66, -1) - 0.015 },
    head: { y: headY, z: face(0.38, 0.52, 1) + 0.015 },
    x: cx, side: Math.max(0.3, halfW - 0.22), w: THREE.MathUtils.clamp(halfW * 0.24, 0.16, 0.3),
  };
}

export class CarLights {
  constructor() {
    this.sets = Array.from({ length: POOL }, () => {
      const tail = lampMaterial(), head = lampMaterial();
      const tailHalo = haloMaterial(), headHalo = haloMaterial();
      const group = new THREE.Group();
      const quads = [], halos = [];
      for (const [mat, halo, back] of [[tail, tailHalo, true], [head, headHalo, false]]) {
        for (const s of [-1, 1]) {
          const q = new THREE.Mesh(quad, mat);
          q.rotation.y = back ? Math.PI : 0; // face out of the body
          q.userData = { back, s };
          q.castShadow = false;
          group.add(q);
          quads.push(q);
          // the glow around a lit lamp, seen from any side
          const h = new THREE.Sprite(halo);
          h.userData = { back, s };
          h.renderOrder = 3;
          group.add(h);
          halos.push(h);
        }
      }
      return { group, tail, head, tailHalo, headHalo, quads, halos, car: null };
    });
  }

  place(set, car) {
    const spots = car.lampSpots || (car.lampSpots = lampSpots(car));
    if (!spots) return false;
    for (const q of set.quads) {
      const { back, s } = q.userData;
      const at = back ? spots.tail : spots.head;
      q.position.set(spots.x + s * spots.side, at.y, at.z);
      q.scale.set(spots.w, back ? spots.w * 0.45 : spots.w * 0.4, 1);
    }
    for (const h of set.halos) {
      const { back, s } = h.userData;
      const at = back ? spots.tail : spots.head;
      h.position.set(spots.x + s * spots.side, at.y, at.z + (back ? -0.06 : 0.06));
      h.scale.setScalar(back ? 0.45 : 0.6);
    }
    car.mesh.add(set.group);
    set.car = car;
    return true;
  }

  /** Each frame: lamps on the cars that are being driven, nearest the camera first. */
  update(dt, cars, camera, night) {
    const driven = cars.filter((c) => c.driver && !c.wrecked && !c.spec && !c.lights?.isMaterial);
    if (driven.length > POOL) {
      const p = camera.position;
      driven.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
      driven.length = POOL;
    }
    for (const set of this.sets) {
      if (set.car && !driven.includes(set.car)) { set.group.removeFromParent(); set.car = null; }
    }
    for (const car of driven) {
      let set = this.sets.find((s) => s.car === car);
      if (!set) {
        set = this.sets.find((s) => !s.car);
        if (!set || !this.place(set, car)) continue;
      }
      // braking: slowing harder than the car coasts, or held still at the wheel
      const prev = car.lampSpeed ?? car.speed;
      car.lampSpeed = car.speed;
      const decel = dt > 0 ? (Math.abs(prev) - Math.abs(car.speed)) / dt : 0;
      car.brakeGlow = THREE.MathUtils.damp(car.brakeGlow || 0, decel > 2.5 || Math.abs(car.speed) < 0.2 ? 1 : 0, 14, dt);
      const reversing = car.speed < -0.3;
      const run = 0.5 + 1.6 * night;
      const t = run + car.brakeGlow * 7;
      if (reversing) set.tail.color.setRGB(5, 5, 4.6);
      else set.tail.color.setRGB(t, t * 0.04, t * 0.03);
      const h = 1.1 + 14 * night;
      set.head.color.setRGB(h, h * 0.96, h * 0.86);
      // halos: the brake lights by day too, the head lamps only once it is dark
      // and only towards where the lamps point: none from the side, where the body hides them
      const dx = camera.position.x - car.x, dz = camera.position.z - car.z, d = Math.hypot(dx, dz) || 1;
      const ahead = (Math.sin(car.yaw) * dx + Math.cos(car.yaw) * dz) / d;
      const face = (k) => THREE.MathUtils.smoothstep(k, 0.15, 0.6);
      set.tailHalo.color.copy(set.tail.color).multiplyScalar((0.05 + 0.05 * night) * face(-ahead));
      set.headHalo.color.copy(set.head.color).multiplyScalar(0.07 * night * face(ahead));
    }
  }
}
