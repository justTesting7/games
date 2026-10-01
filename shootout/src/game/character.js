import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLTF, rpmUrl, modelUrl } from '../engine/assets.js';
import { Ragdoll } from './ragdoll.js';

const CLIPS = {
  idle: 'F_Standing_Idle_001',
  walk: 'F_Walk_003',
  walkBack: 'F_Walk_Backwards_001',
  walkLeft: 'F_Walk_Strafe_Left_001',
  walkRight: 'F_Walk_Strafe_Right_001',
  jog: 'F_Jog_001',
  jogBack: 'F_Jog_Backwards_001',
  jogLeft: 'F_Jog_Strafe_Left_002',
  jogRight: 'F_Jog_Strafe_Right_002',
  run: 'F_Run_001',
  jumpJog: 'F_Jog_Jump_Small_001',
  jumpRun: 'F_Run_Jump_001',
  fall: 'F_Falling_Idle_000',
};

const CLIPS_M = {
  idle: 'm/M_Standing_Idle_001',
  walk: 'm/M_Walk_001',
  walkBack: 'm/M_Walk_Backwards_001',
  walkLeft: 'm/M_Walk_Strafe_Left_002',
  walkRight: 'm/M_Walk_Strafe_Right_002',
  jog: 'm/M_Jog_001',
  jogBack: 'm/M_Jog_Backwards_001',
  jogLeft: 'm/M_Jog_Strafe_Left_001',
  jogRight: 'm/M_Jog_Strafe_Right_001',
  run: 'm/M_Run_001',
  jumpJog: 'm/F_Jog_Jump_Small_001',
  jumpRun: 'm/F_Run_Jump_001',
  fall: 'm/F_Falling_Idle_000',
};

// Atlas regions are [x0, y0, x1, y1] in the 1024 texture. `logo` patches
// copy plain cloth over the print: [sx, sy, w, h, dx, dy].
const BODIES = {
  f: {
    avatar: 'Feminine_TPose', clips: CLIPS, braid: true,
    logo: [[150, 790, 90, 60, 150, 715], [340, 790, 120, 70, 340, 705]],
    top: [0, 512, 512, 1024], topGain: 1, topMax: 1,
    trousers: [512, 0, 1024, 512],
    boots: [768, 512, 1024, 768], boot: (l) => 0.35 + l * 0.9,
    rough: [[0, 512, 512, 512, 0.82], [512, 0, 512, 512, 0.9], [768, 512, 256, 256, 0.5], [512, 512, 256, 256, 0.15]],
  },
  m: {
    avatar: 'm/Masculine_TPose', clips: CLIPS_M, braid: false,
    logo: [], logoFill: [[164, 708, 222, 746], [344, 710, 443, 772]],
    top: [0, 512, 512, 1024], topGain: 5, topMax: 0.2,
    trousers: [512, 0, 768, 256],
    boots: [512, 256, 1024, 768], boot: (l) => 0.08 + l * 0.55,
    rough: [[0, 512, 512, 512, 0.85], [512, 0, 256, 256, 0.9], [512, 256, 512, 512, 0.6], [768, 0, 256, 256, 0.15]],
    head: [0, 0, 512, 512], skinSwatch: [768, 768, 896, 896], hairCap: [768, 896, 896, 1024],
  },
};
const ATLAS_SKIN = [209, 145, 112];

// Clip timing for jumps: when the feet leave and touch the ground again.
export const JUMPS = {
  jumpJog: { start: 0.06, takeoff: 0.12, land: 0.5 },
  jumpRun: { start: 0.5, takeoff: 0.58, land: 1.25 },
};

const LOOPING = new Set(['idle', 'walk', 'walkBack', 'walkLeft', 'walkRight', 'jog', 'jogBack', 'jogLeft', 'jogRight', 'run', 'fall']);

// Locomotion loops that blend together. They are kept on one stride phase so
// blending walk into jog, or forward into strafe, never mixes a left step
// with a right one (the legs used to scissor through every transition).
const GAIT = ['walk', 'walkBack', 'walkLeft', 'walkRight', 'jog', 'jogBack', 'jogLeft', 'jogRight', 'run'];
const frac = (x) => x - Math.floor(x);

/**
 * Stride landmarks of a gait clip: how many strides it loops (`cycles`) and the
 * stride phase of its first frame (`offset`), taken where the left thigh swings
 * furthest ahead of the right one.
 */
export function gaitPhase(clip) {
  const L = clip.tracks.find((t) => t.name === 'LeftUpLeg.quaternion');
  const R = clip.tracks.find((t) => t.name === 'RightUpLeg.quaternion');
  if (!L || !R || L.times.length !== R.times.length || L.times.length < 4) return null;
  const q = new THREE.Quaternion(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const sep = [];
  for (let i = 0; i < L.times.length; i++) {
    a.set(0, 1, 0).applyQuaternion(q.fromArray(L.values, i * 4));
    b.set(0, 1, 0).applyQuaternion(q.fromArray(R.values, i * 4));
    sep.push(a.z - b.z);
  }
  const n = sep.length, max = Math.max(...sep);
  // looping clips repeat their first frame at the end: compare neighbours cyclically without it
  const m = Math.abs(sep[n - 1] - sep[0]) < 0.02 ? n - 1 : n;
  const peaks = [];
  for (let i = 0; i < m; i++) {
    const p = sep[(i + m - 1) % m], c = sep[i], x = sep[(i + 1) % m];
    if (c > 0.5 * max && c >= p && c > x) peaks.push(i);
  }
  if (!peaks.length) return null;
  const cycles = peaks.length;
  const i = peaks[0];
  // parabolic refinement between frames
  const p = sep[(i + m - 1) % m], c = sep[i], x = sep[(i + 1) % m];
  const den = p - 2 * c + x;
  const shift = Math.abs(den) > 1e-6 ? THREE.MathUtils.clamp(0.5 * (p - x) / den, -0.5, 0.5) : 0;
  const t = L.times[0] + ((L.times[Math.min(i + 1, n - 1)] - L.times[i]) * shift) + (L.times[i] - L.times[0]);
  return { cycles, offset: frac((t / clip.duration) * cycles) };
}

// Strips horizontal root motion so the controller owns movement, and returns
// the speed the clip was authored at so playback can match real speed.
function processClip(clip, name, boneNames) {
  clip.tracks = clip.tracks.filter((t) => boneNames.has(t.name.split('.')[0]));
  let speed = 0;
  const hips = clip.tracks.find((t) => t.name === 'Hips.position');
  if (hips) {
    const v = hips.values;
    const n = v.length / 3;
    speed = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]) / clip.duration;
    const x0 = v[0], z0 = v[2], y0 = v[1];
    for (let i = 0; i < n; i++) {
      v[i * 3] = x0;
      v[i * 3 + 2] = z0;
      // Physics provides the height of a jump, so the clip must not add its own.
      if (name.startsWith('jump')) v[i * 3 + 1] = Math.min(v[i * 3 + 1], y0 + 0.03);
    }
  }
  clip.name = name;
  return { clip, speed };
}

export const OUTFITS = {
  adventurer: { top: [0.16, 0.42, 0.44], trousers: [0.30, 0.27, 0.17], boots: [0.36, 0.22, 0.12], hair: 0x2a1a10 },
  crimson: { top: [0.46, 0.06, 0.05], trousers: [0.09, 0.09, 0.1], boots: [0.16, 0.11, 0.08], hair: 0x0d0907 },
  ivory: { top: [0.5, 0.49, 0.45], trousers: [0.1, 0.13, 0.23], boots: [0.28, 0.2, 0.13], hair: 0x6b4a2a },
  olive: { top: [0.22, 0.28, 0.14], trousers: [0.14, 0.16, 0.1], boots: [0.2, 0.16, 0.1], hair: 0x1a140e },
};

const hexRgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

// Recolours the stock outfit in the look's colours and removes the logo
// print. Masculine bodies also get the photo face, its skin tone and hair.
function recolorAtlas(image, look, body) {
  const outfit = look.outfit;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, 1024, 1024);
  for (const [sx, sy, w, h, dx, dy] of body.logo) g.drawImage(c, sx, sy, w, h, dx, dy, w, h);
  const img = g.getImageData(0, 0, 1024, 1024);
  const d = img.data;
  // Fills each box by blending the cloth just above and below it, per column.
  for (const [x0, y0, x1, y1] of body.logoFill || []) {
    for (let x = x0; x < x1; x++) {
      const a = ((y0 - 1) * 1024 + x) * 4, b = (y1 * 1024 + x) * 4;
      for (let y = y0; y < y1; y++) {
        const f = (y - y0 + 1) / (y1 - y0 + 1);
        const k = (y * 1024 + x) * 4;
        for (let ch = 0; ch < 3; ch++) d[k + ch] = d[a + ch] * (1 - f) + d[b + ch] * f;
      }
    }
  }
  const region = ([x0, y0, x1, y1], fn) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = (y * 1024 + x) * 4;
      const l = (d[k] + d[k + 1] + d[k + 2]) / (3 * 255);
      const [r, gg, b] = fn(l, k);
      d[k] = Math.min(255, r * 255); d[k + 1] = Math.min(255, gg * 255); d[k + 2] = Math.min(255, b * 255);
    }
  };
  const check = outfit.check;
  region(body.top, (l, k) => {
    if (l < 0.03) return [0, 0, 0];
    const t = Math.pow(Math.min(1, Math.min(l, body.topMax) * body.topGain), 1.1);
    let c = outfit.top;
    if (check) {
      const p = k >> 2;
      const bands = (((p & 1023) >> 4) & 1) + (((p >> 10) >> 4) & 1);
      c = bands === 2 ? c : bands === 1 ? c.map((v, i) => (v + check[i]) * 0.5) : check;
    }
    return [c[0] * t + 0.02, c[1] * t + 0.03, c[2] * t + 0.04];
  });
  region(body.trousers, (l) => {
    const t = 0.45 + l * 2.6;
    const c = outfit.trousers;
    return [c[0] * t, c[1] * t, c[2] * t];
  });
  region(body.boots, (l) => {
    const t = body.boot(l);
    const c = outfit.boots;
    return [c[0] * t, c[1] * t, c[2] * t];
  });
  if (body.head && look.face) {
    const skin = look.face.skin;
    const k = skin.map((v, i) => v / ATLAS_SKIN[i]);
    const tint = (kk) => [d[kk] / 255 * k[0], d[kk + 1] / 255 * k[1], d[kk + 2] / 255 * k[2]];
    region(body.head, (l, kk) => tint(kk));
    region(body.skinSwatch, (l, kk) => tint(kk));
    const [hx0, hy0, hx1, hy1] = body.hairCap;
    for (let y = hy0; y < hy1; y++) for (let x = hx0; x < hx1; x++) {
      const k = (y * 1024 + x) * 4;
      d[k + 3] = 0;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const rc = document.createElement('canvas');
  rc.width = rc.height = 256;
  const rg = rc.getContext('2d');
  const rough = (x, y, w, h, v) => { rg.fillStyle = `rgb(0,${Math.round(v * 255)},0)`; rg.fillRect(x / 4, y / 4, w / 4, h / 4); };
  rough(0, 0, 1024, 1024, 0.55);
  for (const r of body.rough) rough(...r);
  const roughTex = new THREE.CanvasTexture(rc);
  roughTex.flipY = false;
  return { map: tex, roughnessMap: roughTex };
}

function rotateBoneToward(bone, child, targetDir, weight, tmp) {
  if (weight <= 0.001) return;
  const p0 = bone.getWorldPosition(tmp.a);
  const p1 = child.getWorldPosition(tmp.b);
  const cur = tmp.c.subVectors(p1, p0).normalize();
  const q = tmp.q.setFromUnitVectors(cur, targetDir);
  if (weight < 1) q.copy(tmp.qi.identity().slerp(q, weight));
  rotateBoneWorld(bone, q, tmp);
}

// Applies a world-space rotation to a bone while keeping its hierarchy.
function rotateBoneWorld(bone, q, tmp) {
  const wq = bone.getWorldQuaternion(tmp.q2);
  const pq = bone.parent.getWorldQuaternion(tmp.q3);
  wq.premultiply(q);
  bone.quaternion.copy(pq.invert().multiply(wq));
  bone.updateMatrixWorld(true);
}

const smooth = (k) => { const x = Math.min(1, Math.max(0, k)); return x * x * (3 - 2 * x); };
const gate = (t, a, b) => {
  const d = b - a;
  if (d <= 0) return 0;
  const u = (t - a) / d;
  if (u <= 0 || u >= 1) return 0;
  return smooth(Math.min(u / 0.28, (1 - u) / 0.28, 1));
};
const V = Array.from({ length: 8 }, () => new THREE.Vector3());
const UP = new THREE.Vector3(0, 1, 0);

// Two-bone IK: puts the wrist on `target` with the elbow bending towards
// `pole`, then points the fingers along `finger` and rolls the hand so the
// pinky-to-index direction follows `lateral`.
function solveArm(B, side, target, pole, finger, lateral, w, tmp) {
  if (w <= 0.001) return;
  const upper = B[`${side}Arm`], fore = B[`${side}ForeArm`], hand = B[`${side}Hand`];
  const a = upper.getWorldPosition(V[0]);
  const b = fore.getWorldPosition(V[1]);
  const c = hand.getWorldPosition(V[2]);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const toT = V[3].subVectors(target, a);
  const len = toT.length() || 1e-4;
  const dir = toT.divideScalar(len);
  const d = THREE.MathUtils.clamp(len, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const pn = V[4].subVectors(pole, a);
  pn.addScaledVector(dir, -pn.dot(dir)).normalize();
  const elbow = V[5].copy(a).addScaledVector(dir, cosA * l1).addScaledVector(pn, sinA * l1);
  rotateBoneToward(upper, fore, V[6].subVectors(elbow, a).normalize(), w, tmp);
  const eb = fore.getWorldPosition(V[1]);
  const reach = V[7].copy(upper.getWorldPosition(V[0])).addScaledVector(dir, d);
  rotateBoneToward(fore, hand, V[6].subVectors(reach, eb).normalize(), w, tmp);
  const mid = B[`${side}HandMiddle1`];
  if (!mid || !finger) return;
  rotateBoneToward(hand, mid, finger, w, tmp);
  const idx = B[`${side}HandIndex1`], pk = B[`${side}HandPinky1`];
  if (!idx || !pk || !lateral) return;
  const cur = V[3].subVectors(idx.getWorldPosition(V[3]), pk.getWorldPosition(V[4]));
  const fd = V[5].copy(finger).normalize();
  cur.addScaledVector(fd, -cur.dot(fd)).normalize();
  const want = V[6].copy(lateral).addScaledVector(fd, -lateral.dot(fd)).normalize();
  const ang = Math.atan2(V[7].crossVectors(cur, want).dot(fd), cur.dot(want));
  rotateBoneWorld(hand, tmp.q.setFromAxisAngle(fd, ang * w), tmp);
}

// Two-bone leg: thigh and shin bend so the foot reaches `target`, knee toward `pole`.
function solveLeg(B, side, target, pole, tmp) {
  const upper = B[`${side}UpLeg`], lower = B[`${side}Leg`], foot = B[`${side}Foot`];
  if (!upper || !lower || !foot) return;
  const a = upper.getWorldPosition(V[0]);
  const b = lower.getWorldPosition(V[1]);
  const c = foot.getWorldPosition(V[2]);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const toT = V[3].subVectors(target, a);
  const len = toT.length() || 1e-4;
  const dir = toT.divideScalar(len);
  const d = THREE.MathUtils.clamp(len, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const pn = V[4].subVectors(pole, a);
  pn.addScaledVector(dir, -pn.dot(dir)).normalize();
  const knee = V[5].copy(a).addScaledVector(dir, cosA * l1).addScaledVector(pn, sinA * l1);
  rotateBoneToward(upper, lower, V[6].subVectors(knee, a).normalize(), 1, tmp);
  const kb = lower.getWorldPosition(V[1]);
  const reach = V[7].copy(upper.getWorldPosition(V[0])).addScaledVector(dir, d);
  rotateBoneToward(lower, foot, V[6].subVectors(reach, kb).normalize(), 1, tmp);
}

function attachSniperScope(rifle) {
  const box = new THREE.Box3().setFromObject(rifle);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const steel = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.28, metalness: 0.88, envMapIntensity: 1.2 });
  const matte = new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.62, metalness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x07140f, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.6,
  });
  const g = new THREE.Group();
  g.name = 'sniperScope';
  const x = mid.x + size.x * 0.04;
  const y = box.max.y + 0.01;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.26, 18), steel);
  tube.rotation.z = Math.PI / 2;
  tube.position.set(x, y, 0);
  g.add(tube);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.045, 16), steel);
  bell.rotation.z = Math.PI / 2;
  bell.position.set(x + 0.14, y, 0);
  g.add(bell);
  const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.022, 0.04, 14), steel);
  eye.rotation.z = Math.PI / 2;
  eye.position.set(x - 0.14, y, 0);
  g.add(eye);
  const lensF = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), glass);
  lensF.rotation.y = Math.PI / 2;
  lensF.position.set(x + 0.163, y, 0);
  g.add(lensF);
  const lensR = new THREE.Mesh(new THREE.CircleGeometry(0.016, 14), glass);
  lensR.rotation.y = -Math.PI / 2;
  lensR.position.set(x - 0.161, y, 0);
  g.add(lensR);
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.018, 10), matte);
  turret.position.set(x - 0.02, y + 0.026, 0);
  g.add(turret);
  const wind = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.016, 10), matte);
  wind.rotation.x = Math.PI / 2;
  wind.position.set(x + 0.02, y + 0.006, 0.02);
  g.add(wind);
  for (const sx of [-0.06, 0.05]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 8, 14), matte);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(x + sx, y - 0.008, 0);
    g.add(ring);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.01), matte);
    post.position.set(x + sx, y - 0.016, 0);
    g.add(post);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  rifle.add(g);
}

// Points on the rifle, in its own space: +X towards the muzzle, +Y up, +Z to
// the shooter's right. Hand points are where the wrist bone goes.
const RIFLE = {
  butt: new THREE.Vector3(-0.64, -0.045, 0),
  grip: new THREE.Vector3(-0.45, -0.035, 0.04),
  fore: new THREE.Vector3(-0.04, -0.045, -0.035),
  bolt: new THREE.Vector3(-0.3, 0.0, 0.1),
  magwell: new THREE.Vector3(-0.27, 0.12, 0.06),
  muzzle: new THREE.Vector3(0.61, 0.058, 0),
};

// Wrist path for a throw, in body space (x right, y up, z forward) relative
// to the right shoulder, keyed by the fraction of the throw.
const THROW = { dur: 0.8, release: 0.42 };
const THROW_PATH = [
  [0, new THREE.Vector3(0.12, -0.25, 0.25)],
  [0.3, new THREE.Vector3(0.14, 0.2, -0.3)],
  [0.42, new THREE.Vector3(0.02, 0.32, 0.45)],
  [0.62, new THREE.Vector3(-0.2, -0.3, 0.38)],
  [0.8, new THREE.Vector3(0.12, -0.25, 0.25)],
];
function throwPoint(t, out) {
  for (let i = 1; i < THROW_PATH.length; i++) {
    const [t1, p1] = THROW_PATH[i];
    const [t0, p0] = THROW_PATH[i - 1];
    if (t <= t1) return out.copy(p0).lerp(p1, smooth((t - t0) / (t1 - t0)));
  }
  return out.copy(THROW_PATH[THROW_PATH.length - 1][1]);
}

// wound stains (Character.stain): one shared soft blotch texture and material
const STAIN = { v: new THREE.Vector3(), p: new THREE.Vector3(), s: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1), q: new THREE.Quaternion(), r: new THREE.Quaternion() };
/** A throwaway stain quad, so the shader compiles with the rest at load and not on the first wound. */
export function stainWarmup() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), stainMaterial());
  m.frustumCulled = false;
  return m;
}

function stainMaterial() {
  if (STAIN.mat) return STAIN.mat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * 6.3, r = Math.random() * 14;
    const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r, rr = 6 + Math.random() * 12;
    const grad = g.createRadialGradient(x, y, 0, x, y, rr);
    grad.addColorStop(0, 'rgba(120,8,6,0.85)');
    grad.addColorStop(1, 'rgba(120,8,6,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  g.fillStyle = 'rgba(25,1,1,0.9)';
  g.beginPath(); g.arc(32, 32, 3.5, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  STAIN.mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  // keep the scene depth the HDR target stores in alpha (engine/patch.js)
  STAIN.mat.blending = THREE.CustomBlending;
  STAIN.mat.blendSrcAlpha = THREE.ZeroFactor;
  STAIN.mat.blendDstAlpha = THREE.OneFactor;
  return STAIN.mat;
}

// scratch for applyAim, which runs for every fighter every frame (UP is below)
const AIM = {
  fwd: new THREE.Vector3(), flat: new THREE.Vector3(), right: new THREE.Vector3(), hd: new THREE.Vector3(),
  headFwd: new THREE.Vector3(), clamp: new THREE.Vector3(), pitch: new THREE.Vector3(),
  qa: new THREE.Quaternion(), qb: new THREE.Quaternion(),
};

export class Character {
  constructor() {
    this.root = new THREE.Group();
    this.actions = {};
    this.speeds = {};
    this.weights = {};
    this.state = 'idle';
    this.aimWeight = 0;
    this.grenadeWindup = 0;
    this.aimTarget = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, 1);
    this.lookDir = new THREE.Vector3(0, 0, 1);
    this.recoil = [0, 0];
    this.drawn = 0;
    this.dead = null;
    this.flinch = 0;
    this.flinchAxis = new THREE.Vector3(1, 0, 0);
    this.jump = null;
    this.onFootstep = null;
    this.footDown = [true, true];
    this.weapon = 'pistols';
    this.nextWeapon = 'pistols';
    this.equipT = 1;
    this.action = null;
    this.rifleKick = 0;
    this.boltOpen = 0;
    this.showGrenade = true;
    this.released = false;
    this.tmp = {
      a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(),
      q: new THREE.Quaternion(), qi: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(),
      m: new THREE.Matrix4(),
    };
  }

  // Loads the model, clips and pistol once; every character clones them.
  static async loadBody(id) {
    const def = BODIES[id];
    const [avatar, ...anims] = await Promise.all([
      loadGLTF(rpmUrl(def.avatar)),
      ...Object.values(def.clips).map((f) => loadGLTF(rpmUrl(f))),
    ]);
    const boneNames = new Set();
    let baseImage = null;
    avatar.scene.traverse((o) => {
      if (o.isBone) boneNames.add(o.name);
      if (o.isSkinnedMesh) baseImage = o.material.map.image;
    });
    const clips = {}, speeds = {}, gait = {};
    Object.keys(def.clips).forEach((name, i) => {
      const { clip, speed } = processClip(anims[i].animations[0], name, boneNames);
      clips[name] = clip;
      speeds[name] = speed;
      if (GAIT.includes(name)) gait[name] = gaitPhase(clip);
    });
    const normalMap = await avatar.parser.getDependency('texture', 0);
    normalMap.flipY = false;
    return { scene: avatar.scene, clips, speeds, gait, baseImage, normalMap };
  }

  static async loadAssets(progress, bodyIds = ['f']) {
    const [pistolGltf, rifleGltf, grenadeGltf, ...list] = await progress.task('Loading the fighters', 6, () => Promise.all([
      loadGLTF(modelUrl('service_pistol')),
      loadGLTF(modelUrl('bolt_action_rifle_7_62')),
      loadGLTF(modelUrl('stick_grenade')),
      ...bodyIds.map((id) => Character.loadBody(id)),
    ]));
    const bodies = {};
    bodyIds.forEach((id, i) => { bodies[id] = list[i]; });
    return { bodies, pistolGltf, rifleGltf, grenadeGltf };
  }

  // `look` is { body: 'f' | 'm', outfit, hair, bald, face: { image, skin } }.
  load(assets, look) {
    const def = BODIES[look.body || 'f'];
    const body = assets.bodies[look.body || 'f'];
    this.model = cloneSkinned(body.scene);
    this.root.add(this.model);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) this.mesh = o;
    });

    const normalMap = body.normalMap;
    const { map, roughnessMap } = recolorAtlas(body.baseImage, look, def);
    this.mesh.material = new THREE.MeshStandardMaterial({
      map, normalMap, roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8),
      ...(look.face ? { alphaTest: 0.55, depthWrite: true } : {}),
    });
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    this.mixer = new THREE.AnimationMixer(this.model);
    Object.keys(def.clips).forEach((name) => {
      const action = this.mixer.clipAction(body.clips[name]);
      if (!LOOPING.has(name)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions[name] = action;
      this.speeds[name] = body.speeds[name];
      this.weights[name] = 0;
    });
    this.gait = body.gait || {};
    this.weights.idle = 1;
    this.actions.idle.setEffectiveWeight(1);

    if (def.braid) this.buildBraid(look.hair ?? look.outfit.hair);
    this.buildPistols(assets.pistolGltf);
    this.buildRifle(assets.rifleGltf);
    this.grenade = Character.grenadeModel(assets.grenadeGltf);
    this.grenade.matrixAutoUpdate = false;
  }

  // A copy of the grenade with the handle's grip point at the origin.
  static grenadeModel(gltf) {
    const g = gltf.scene.clone(true);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const wrap = new THREE.Group();
    g.position.y = 0.05;
    wrap.add(g);
    return wrap;
  }

  buildRifle(gltf) {
    const rifle = gltf.scene.clone(true);
    rifle.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.bolts = ['bolt_action_rifle_7_62_bolt_a', 'bolt_action_rifle_7_62_bolt_b']
      .map((n) => rifle.getObjectByName(n)).filter(Boolean)
      .map((o) => ({ o, rest: o.position.clone() }));
    attachSniperScope(rifle);
    rifle.matrixAutoUpdate = false;
    this.rifle = rifle;
    // Slung diagonally across the back, measured in the bind pose.
    this.model.updateMatrixWorld(true);
    const spine = this.bones.Spine2;
    const sp = spine.getWorldPosition(new THREE.Vector3());
    const f = new THREE.Vector3(-0.55, 0.83, 0).normalize();
    const z = new THREE.Vector3(0, 0, -1);
    const y = new THREE.Vector3().crossVectors(z, f).normalize();
    const world = new THREE.Matrix4().makeBasis(f, y, z).setPosition(sp.x, sp.y - 0.05, sp.z - 0.17);
    this.rifleBack = spine.matrixWorld.clone().invert().multiply(world);
  }

  /** Rain soaks them: clothes, skin and hair darken and gloss over (k 0..1). */
  setWet(k) {
    if (Math.abs((this.wetK ?? 0) - k) < 0.005) return;
    this.wetK = k;
    for (const [m, dry, dark] of [[this.mesh?.material, 1, 0.22], [this.braid?.material, 0.55, 0.3]]) {
      if (!m) continue;
      if (!m.userData.dryColor) m.userData.dryColor = m.color.clone();
      m.roughness = dry * (1 - 0.5 * k); // scales the roughness map: wet cloth and skin shine
      m.color.copy(m.userData.dryColor).multiplyScalar(1 - dark * k);
    }
  }

  buildBraid(color) {
    const hair = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
    const lobe = new THREE.SphereGeometry(1, 10, 8);
    this.braidN = 11;
    this.braid = new THREE.InstancedMesh(lobe, hair, this.braidN * 2);
    this.braid.castShadow = true;
    this.braid.frustumCulled = false;
    this.braidPts = [];
    for (let i = 0; i <= this.braidN; i++) this.braidPts.push({ p: new THREE.Vector3(), o: new THREE.Vector3() });
    this.braidInit = false;
    this.braidSeg = 0.05;
  }

  buildPistols(gltf) {
    const keep = ['service_pistol_pistol_a', 'service_pistol_slide_a', 'service_pistol_magazine_loaded', 'service_pistol_hammer_a', 'service_pistol_trigger_a'];
    const src = new THREE.Group();
    gltf.scene.updateMatrixWorld(true);
    let slide = null;
    gltf.scene.traverse((o) => {
      if (o.isMesh && keep.includes(o.name)) {
        const m = o.clone();
        m.matrix.copy(o.matrixWorld);
        m.matrix.decompose(m.position, m.quaternion, m.scale);
        m.castShadow = true;
        src.add(m);
        if (o.name.includes('slide')) slide = m.name;
      }
    });
    const box = new THREE.Box3().setFromObject(src);
    const grip = new THREE.Vector3(-0.09, 0.03, 0);
    src.children.forEach((c) => c.position.sub(grip));
    this.muzzleLocal = new THREE.Vector3(box.max.x - grip.x, box.max.y - grip.y - 0.015, 0);
    const leather = new THREE.MeshStandardMaterial({ color: 0x2b1a10, roughness: 0.7 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x1c130c, roughness: 0.8 });

    this.pistols = [0, 1].map((side) => {
      const g = src.clone(true);
      g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.castShadow = true; } });
      const slideMesh = g.children.find((c) => c.name === slide);
      g.userData.slide = slideMesh;
      g.userData.slideRest = slideMesh ? slideMesh.position.clone() : null;
      g.userData.mag = g.children.find((c) => c.name.includes('magazine'));
      g.matrixAutoUpdate = false;
      return g;
    });

    // Holsters and pistols are posed relative to the thigh bones, measured
    // from the bind pose so the result does not depend on bone axes.
    this.model.updateMatrixWorld(true);
    const make = (boneName, side) => {
      const bone = this.bones[boneName];
      const bp = bone.getWorldPosition(new THREE.Vector3());
      const pos = new THREE.Vector3(bp.x + side * 0.14, bp.y - 0.2, bp.z - 0.01);
      const xAxis = new THREE.Vector3(0, -1, 0.08).normalize();
      const yAxis = new THREE.Vector3(0, 0, -1);
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
      const world = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(pos);
      const local = bone.matrixWorld.clone().invert().multiply(world);
      const holster = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.045), leather);
      holster.position.set(0.06, 0, 0);
      const hg = new THREE.Group();
      hg.add(holster);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.035, 16, 1, true), strap);
      band.material.side = THREE.DoubleSide;
      const bandLocal = bone.matrixWorld.clone().invert().multiply(new THREE.Matrix4().setPosition(bp.x, bp.y - 0.2, bp.z));
      hg.castShadow = true;
      holster.castShadow = true;
      return { bone, local, holster: hg, band, bandLocal };
    };
    this.holsters = [make('RightUpLeg', -1), make('LeftUpLeg', 1)];
    this.holsters.forEach((h) => {
      h.holster.matrixAutoUpdate = false;
      h.band.matrixAutoUpdate = false;
    });
  }

  // Swap clothes/face on this instance so a roster pick does not reload the page.
  relight(assets, look) {
    const scene = this.root.parent;
    this.mixer?.stopAllAction();
    this.root.clear();
    this.rifle?.removeFromParent();
    this.grenade?.removeFromParent();
    this.braid?.removeFromParent();
    this.pistols?.forEach((p) => p.removeFromParent());
    this.holsters?.forEach((h) => {
      h.holster.removeFromParent();
      h.band.removeFromParent();
    });
    this.actions = {};
    this.weights = {};
    this.braid = null;
    this.pistols = null;
    this.holsters = null;
    this.rifle = null;
    this.grenade = null;
    this.model = null;
    this.mixer = null;
    this.load(assets, look);
    if (scene) {
      scene.add(this.rifle, this.grenade);
      if (this.braid) scene.add(this.braid);
      this.pistols.forEach((p) => scene.add(p));
      this.holsters.forEach((h) => scene.add(h.holster, h.band));
    }
  }

  addTo(scene) {
    scene.add(this.root, this.rifle, this.grenade);
    if (this.braid) scene.add(this.braid);
    this.pistols.forEach((p) => scene.add(p));
    this.holsters.forEach((h) => scene.add(h.holster, h.band));
  }

  setWeights(target, fade, dt) {
    const k = fade <= 0 ? 1 : Math.min(1, dt / fade);
    for (const name in this.actions) {
      const w = this.weights[name] + ((target[name] || 0) - this.weights[name]) * k;
      this.weights[name] = w;
      this.actions[name].setEffectiveWeight(w);
    }
  }

  // A bullet from direction `dir` knocks the upper body back.
  // `part` is the bone the round hit (see Combat hit capsules): an arm is knocked back,
  // a leg buckles (stagger slows the controller for a moment), the torso flinches.
  hitReact(dir, part) {
    this.flinchAxis.set(dir.z, 0, -dir.x).normalize();
    const limb = part && part !== 'Hips' && part !== 'Spine2';
    this.flinch = Math.min(1, this.flinch + (limb ? 0.25 : 0.7));
    if (limb && this.bones[part]) this.limbHit = { bone: this.bones[part], axis: this.flinchAxis.clone(), k: 1 };
    if (part && /Leg/.test(part)) this.stagger = 0.45;
  }

  // Goes limp: a ragdoll carries the body's own momentum and the killing blow into
  // the ground and walls (Character.physics is set by the game). A driver killed in the
  // seat slumps where they sit. `push` is the blow's speed in m/s.
  die(dir, push = 2.5) {
    if (Character.physics && this.bones.Hips && !this.seated) {
      const flat = new THREE.Vector3(dir.x, 0, dir.z);
      if (flat.lengthSq() > 1e-6) flat.normalize();
      const blow = flat.multiplyScalar(push).setY(Math.min(push * 0.25, 1.5));
      const vel = this.motion?.vel?.clone() || new THREE.Vector3();
      // guns in hand fly out of them
      if (this.weapon === 'rifle' && this.equipT > 0.5) this.dropGun(this.rifle, vel, blow);
      if (this.weapon === 'pistols' && this.drawn) this.pistols.forEach((p) => this.dropGun(p, vel, blow));
      this.ragdoll = new Ragdoll(this, vel, blow, Character.physics);
      this.dead = { t: 0, ragdoll: true };
      this.jump = null;
      return;
    }
    if (this.seated) { this.dead = { t: 0, seated: true }; return; }
    this.oldDie(dir);
  }

  // Without physics hooks: topples away from the killing shot, pivoting on the feet.
  oldDie(dir) {
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-6) flat.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)).negate();
    flat.normalize();
    this.dead = { t: 0, yaw: this.root.rotation.y, axis: new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), flat).normalize() };
    this.jump = null;
  }

  // A copy of a held gun falls from the dead hand, tumbles and settles; the real one hides
  // until the fighter is back.
  dropGun(gun, vel, blow) {
    if (!gun?.parent) return;
    gun.updateMatrixWorld(true);
    const copy = gun.clone(true);
    copy.matrixAutoUpdate = false;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    gun.matrixWorld.decompose(p, q, s);
    gun.parent.add(copy);
    gun.userData.dropHidden = true;
    gun.visible = false;
    (this.dropped || (this.dropped = [])).push({
      obj: copy, gun, p, q, s,
      v: vel.clone().multiplyScalar(0.6).add(blow.clone().multiplyScalar(0.5)).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.5 + Math.random(), (Math.random() - 0.5) * 1.5)),
      w: new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 6), rest: false,
    });
  }

  updateDropped(dt) {
    if (!this.dropped?.length) return;
    const P = Character.physics;
    const dq = this.tmp.q;
    for (const d of this.dropped) {
      if (!d.rest) {
        d.v.y -= 9.8 * dt;
        d.p.addScaledVector(d.v, dt);
        const w = d.w.length();
        if (w > 1e-4) d.q.premultiply(dq.setFromAxisAngle(V[0].copy(d.w).divideScalar(w), w * dt));
        const g = (P?.heightAt(d.p.x, d.p.z) ?? 0) + 0.04;
        if (d.p.y < g) {
          d.p.y = g;
          d.v.y = -d.v.y * 0.25;
          d.v.x *= 0.5; d.v.z *= 0.5;
          d.w.multiplyScalar(0.45);
          if (Math.abs(d.v.y) < 0.5 && Math.hypot(d.v.x, d.v.z) < 0.3) d.rest = true;
        }
      }
      d.obj.matrix.compose(d.p, d.q, d.s);
      d.obj.matrixWorld.copy(d.obj.matrix);
      d.obj.children.forEach((c) => c.updateMatrixWorld(true));
    }
  }

  /**
   * A wound shows: a dark-red stain where the round went in (and a bigger one where a
   * rifle round came out), soaked into the clothes on the bone it hit, moving with it.
   */
  stain(at, dir, part, exit = false) {
    const bone = this.bones[part] || this.bones.Spine2;
    if (!bone || !at) return;
    const mesh = new THREE.Mesh(STAIN.geo || (STAIN.geo = new THREE.PlaneGeometry(1, 1)), stainMaterial());
    bone.updateWorldMatrix(true, false);
    const facing = STAIN.v.copy(dir).multiplyScalar(exit ? 1 : -1).normalize(); // toward the shooter (or away, out the back)
    const p = STAIN.p.copy(at).addScaledVector(facing, 0.012);
    mesh.position.copy(bone.worldToLocal(p));
    const wq = bone.getWorldQuaternion(STAIN.q).invert();
    mesh.quaternion.setFromUnitVectors(STAIN.z, facing.applyQuaternion(wq)).multiply(STAIN.r.setFromAxisAngle(STAIN.z, Math.random() * 6.3));
    const k = (exit ? 0.2 : 0.12) * (0.8 + Math.random() * 0.4);
    mesh.scale.setScalar(k / bone.getWorldScale(STAIN.s).x);
    mesh.renderOrder = 2;
    bone.add(mesh);
    const list = this.stains || (this.stains = []);
    list.push(mesh);
    if (list.length > 12) list.shift().removeFromParent();
  }

  revive() {
    for (const m of this.stains || []) m.removeFromParent();
    this.stains = [];
    for (const d of this.dropped || []) { d.obj.removeFromParent(); d.gun.visible = true; d.gun.userData.dropHidden = false; }
    this.dropped = [];
    this.dead = null;
    this.ragdoll = null;
    this.flinch = 0;
    this.action = null;
    this.rifleKick = 0;
    this.boltOpen = 0;
    this.aimT = 0;
    this.aimWeight = 0;
    this.grenadeWindup = 0;
    this.drawn = 0;
    this.root.rotation.set(0, this.root.rotation.y, 0);
    this.actions.fall.timeScale = 1;
    this.pistols?.forEach((p) => { if (p.userData.mag) p.userData.mag.visible = true; });
  }

  updateDead(dt) {
    const d = this.dead;
    d.t += dt;
    if (d.ragdoll || d.seated) {
      this.updateDropped(dt);
      if (d.ragdoll && this.ragdoll) {
        this.ragdoll.step(dt); // sleeps once still; the pose is re-applied every frame regardless
        this.ragdoll.apply(rotateBoneWorld, rotateBoneToward, this.tmp);
      }
      if (d.seated && d.t < 0.6) { // slump forward over the wheel
        const k = Math.min(1, dt / 0.6);
        const { right } = this.bodyAxes();
        rotateBoneWorld(this.bones.Spine1, this.tmp.q.setFromAxisAngle(right, -0.55 * k), this.tmp);
        if (this.bones.Neck) rotateBoneWorld(this.bones.Neck, this.tmp.q.setFromAxisAngle(right, -0.5 * k), this.tmp);
      }
      this.aimT = 0; this.aimWeight = 0; this.grenadeWindup = 0; this.drawn = 0;
      this.root.updateMatrixWorld(true);
      this.updateBraid(dt);
      this.updatePistols(dt);
      this.placeRifle();
      this.placeGrenade();
      return;
    }
    const k = Math.min(1, d.t / 0.75);
    const tip = 1.5 * k * k;
    this.root.quaternion.setFromAxisAngle(d.axis, tip).multiply(this.tmp.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw));
    this.root.position.y += 0.13 * k;
    this.setWeights({ fall: 1 }, 0.25, dt);
    if (d.t > 0.7) this.actions.fall.timeScale = Math.max(0, this.actions.fall.timeScale - dt * 3);
    this.aimT = 0;
    this.aimWeight = 0;
    this.grenadeWindup = 0;
    this.drawn = 0;
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    this.updateBraid(dt);
    this.updatePistols(dt);
    this.placeRifle();
    this.placeGrenade();
  }

  // Called by the controller every frame with the movement state.
  update(dt, s) {
    if (this.dead) { this.updateDead(dt); return; }
    const motion = this.updateMotion(dt);
    const target = {};
    const locomotion = () => {
      const sp = s.speed;
      if ((s.crouch || 0) > 0.45) { target.idle = 1; return; }
      if (sp < 0.15) {
        // Turning on the spot shuffles the feet round instead of spinning on planted soles.
        const yr = motion.yawRate;
        if (Math.abs(yr) > 0.9 && s.onGround !== false && Math.hypot(motion.vel.x, motion.vel.z) < 0.6) { // not while riding
          const w = Math.min(0.6, 0.2 + (Math.abs(yr) - 0.9) * 0.3);
          const step = yr > 0 ? 'walkLeft' : 'walkRight';
          target[step] = w;
          target.idle = 1 - w;
          this.actions[step].timeScale = THREE.MathUtils.clamp(Math.abs(yr) * 0.45, 0.7, 1.4);
          return;
        }
        target.idle = 1;
        return;
      }
      if (s.strafe) {
        const lf = s.localDir;
        const fast = sp > 2.4;
        const ax = Math.abs(lf.x), az = Math.abs(lf.z);
        const tot = ax + az || 1;
        const fwd = lf.z >= 0 ? (fast ? 'jog' : 'walk') : (fast ? 'jogBack' : 'walkBack');
        const side = lf.x > 0 ? (fast ? 'jogLeft' : 'walkLeft') : (fast ? 'jogRight' : 'walkRight');
        target[fwd] = az / tot;
        target[side] = (target[side] || 0) + ax / tot;
        this.setRate(fwd, sp);
        this.setRate(side, sp);
        const idleW = 1 - Math.min(1, sp / 0.8);
        if (idleW > 0) { for (const k in target) target[k] *= 1 - idleW; target.idle = idleW; }
        return;
      }
      let a, b, t;
      if (sp < 1.7) { a = 'idle'; b = 'walk'; t = sp / 1.7; }
      else if (sp < 3.8) { a = 'walk'; b = 'jog'; t = (sp - 1.7) / 2.1; }
      else { a = 'jog'; b = 'run'; t = Math.min(1, (sp - 3.8) / 2.0); }
      target[a] = 1 - t;
      target[b] = t;
      this.setRate(a, sp);
      this.setRate(b, sp);
    };

    let fade = 0.18;
    if (s.swimming) {
      this.jump = null;
      target.fall = s.diving ? 0.85 : 0.35;
      target.idle = s.diving ? 0.15 : 0.65;
      fade = 0.22;
    } else if (s.jumpStarted) {
      const kind = s.speed > 4.6 ? 'jumpRun' : 'jumpJog';
      const info = JUMPS[kind];
      const a = this.actions[kind];
      a.reset();
      a.time = info.start;
      a.timeScale = 1;
      a.play();
      this.jump = { kind, info, t: 0, landed: false, airTime: s.predictedAir };
    }
    if (!s.swimming && this.jump) {
      const j = this.jump;
      const a = this.actions[j.kind];
      j.t += dt;
      if (!j.landed) {
        if (a.time >= j.info.takeoff) a.timeScale = (j.info.land - j.info.takeoff) / Math.max(0.2, j.airTime);
        if (a.time >= j.info.land - 0.04) a.timeScale = 0;
        if (s.onGround && j.t > 0.08) { j.landed = true; j.landT = 0; a.time = Math.max(a.time, j.info.land - 0.05); a.timeScale = 1.2; }
        const falling = j.t > j.airTime + 0.25;
        if (falling) target.fall = 1; else target[j.kind] = 1;
        fade = falling ? 0.35 : 0.08;
      } else {
        j.landT += dt;
        const blend = Math.min(1, j.landT / 0.3);
        locomotion();
        for (const k in target) target[k] *= blend;
        target[j.kind] = 1 - blend;
        fade = 0.05;
        if (blend >= 1) this.jump = null;
      }
    } else if (s.swimming) {
      // Swim weights already set.
    } else if (!s.onGround && s.airTime > 0.35) {
      target.fall = 1;
      fade = 0.3;
    } else {
      locomotion();
    }
    this.setWeights(target, fade, dt);
    this.syncGait();
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    this.seated = !!s.seat;
    // far away (detail 0): skip the touches nobody can see at that range
    const near = this.detail !== 0;
    if (s.seat) this.applySeated(s.seat);
    else if (near) this.applyLean(dt, s);
    this.applyCrouch(s.crouch || 0);
    if (near) this.applyFootIK(dt, s);

    this.updateEquip(dt);
    const act = this.action;
    const busy = act && (act.type === 'reload' || act.type === 'pistolReload');
    const aimGoal = s.aiming && this.weapon === this.nextWeapon && !busy ? 1 : 0;
    // Drawing takes about a fifth of a second with an eased arm swing; the
    // guns leave the holsters while the hands are still at the hips.
    this.aimT = THREE.MathUtils.clamp((this.aimT || 0) + (aimGoal ? dt / 0.2 : -dt / 0.35), 0, 1);
    const e = this.aimT;
    this.aimWeight = e * e * (3 - 2 * e);
    this.drawn = this.weapon === 'pistols' && (this.aimT > 0.12 || act?.type === 'pistolReload') ? 1 : 0;
    this.aimTarget.copy(s.aimPoint);
    if (s.lookDir) this.lookDir.copy(s.lookDir);
    else {
      this.lookDir.subVectors(s.aimPoint, this.root.position);
      this.lookDir.y -= 1.45;
      if (this.lookDir.lengthSq() < 1e-6) this.lookDir.set(0, 0, 1);
      else this.lookDir.normalize();
    }
    this.recoil[0] *= Math.exp(-dt * 13);
    this.recoil[1] *= Math.exp(-dt * 13);
    this.rifleKick *= Math.exp(-dt * 11);
    if (this.flinch > 0.01) {
      rotateBoneWorld(this.bones.Spine1, this.tmp.q.setFromAxisAngle(this.flinchAxis, this.flinch * 0.32), this.tmp);
      this.flinch *= Math.exp(-dt * 9);
    }
    if (near) this.updateGunBlock(dt); else this.gunBlock = 0;
    this.applyAim(s);
    if (this.limbHit && this.limbHit.k > 0.02) {
      rotateBoneWorld(this.limbHit.bone, this.tmp.q.setFromAxisAngle(this.limbHit.axis, this.limbHit.k * 0.6), this.tmp);
      this.limbHit.k *= Math.exp(-dt * 7);
    }
    if (this.stagger > 0) this.stagger = Math.max(0, this.stagger - dt);
    if (s.swimming) this.applySwim(s, dt);
    if (this.weapon === 'grenade') this.applyThrow(dt);
    this.placeRifle(dt);
    this.placeGrenade();
    this.updateFeet(dt, s);
    if (near) this.updateBraid(dt);
    this.updatePistols(dt);
  }

  // Switching puts the current weapon away before bringing out the next.
  setWeapon(name) { this.nextWeapon = name; }

  get ready() { return this.weapon === this.nextWeapon && this.equipT >= 1 && !this.action; }

  startAction(type, dur) {
    this.action = { type, t: 0, dur };
    this.released = false;
  }

  updateEquip(dt) {
    if (this.weapon !== this.nextWeapon) {
      this.equipT -= dt / (this.weapon === 'pistols' ? 0.15 : 0.3);
      if (this.weapon === 'pistols') this.aimT = Math.min(this.aimT || 0, this.equipT);
      if (this.equipT <= 0) { this.weapon = this.nextWeapon; this.equipT = 0; this.action = null; }
    } else {
      this.equipT = Math.min(1, this.equipT + dt / (this.weapon === 'rifle' ? 0.45 : 0.25));
    }
    const a = this.action;
    if (a) {
      const before = a.t;
      a.t += dt;
      if (a.type === 'throw' && before < THROW.release * (a.dur / THROW.dur) && a.t >= THROW.release * (a.dur / THROW.dur)) this.released = true;
      if (a.t >= a.dur) this.action = null;
    }
  }

  bodyAxes() {
    const fwd = V[0].set(0, 0, 1).applyQuaternion(this.root.quaternion).setY(0).normalize().clone();
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    return { fwd, left, right: left.clone().negate() };
  }

  // Rifle pose: slung on the back, carried at low ready, or shouldered and
  // aimed, with both hands placed on it by IK.
  placeRifle() {
    const rifle = this.rifle;
    const B = this.bones;
    const back = this.tmp.m.multiplyMatrices(B.Spine2.matrixWorld, this.rifleBack);
    const active = this.weapon === 'rifle' && !this.dead;
    const e = active ? smooth(this.equipT) : 0;
    if (e <= 0) {
      rifle.matrix.copy(back);
    } else {
      const { fwd, left, right } = this.bodyAxes();
      const sh = B.RightArm.getWorldPosition(new THREE.Vector3());
      const a = this.action;
      const w = this.aimWeight;
      const butt1 = sh.clone().addScaledVector(left, 0.07).addScaledVector(UP, -0.06).addScaledVector(fwd, 0.04);
      const f1 = this.gunFrom(butt1);
      const butt0 = sh.clone().addScaledVector(UP, -0.3).addScaledVector(fwd, 0.14).addScaledVector(left, 0.04);
      const f0 = fwd.clone().multiplyScalar(0.82).addScaledVector(UP, -0.45).addScaledVector(left, 0.35).normalize();
      const butt = butt0.lerp(butt1, w);
      const f = f0.lerp(f1, w).normalize();
      const kick = this.rifleKick;
      if (kick > 1e-3) {
        butt.addScaledVector(f, -kick * 0.08);
        f.applyAxisAngle(new THREE.Vector3().crossVectors(f, UP).normalize(), kick * 0.16).normalize();
      }
      let roll = 0;
      if (a?.type === 'reload') {
        const rk = smooth(Math.min(a.t / 0.22, (a.dur - a.t) / 0.28, 1));
        butt.copy(sh).addScaledVector(left, 0.16).addScaledVector(UP, -0.16).addScaledVector(fwd, 0.18);
        f.copy(fwd).multiplyScalar(0.22).addScaledVector(left, 0.92).addScaledVector(UP, 0.22).normalize();
        roll = 1.05 * rk;
      }
      if (a?.type === 'bolt') roll = 0.18 * smooth(Math.min(a.t / 0.15, (a.dur - a.t) / 0.2, 1));
      const u = UP.clone().addScaledVector(f, -UP.dot(f)).normalize().applyAxisAngle(f, -roll);
      const r = new THREE.Vector3().crossVectors(f, u);
      const pos = butt.clone()
        .addScaledVector(f, -RIFLE.butt.x).addScaledVector(u, -RIFLE.butt.y).addScaledVector(r, -RIFLE.butt.z);
      const held = new THREE.Matrix4().makeBasis(f, u, r).setPosition(pos);
      if (e < 1) {
        const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion(), p1 = new THREE.Vector3(), q1 = new THREE.Quaternion(), s = new THREE.Vector3();
        back.decompose(p0, q0, s);
        held.decompose(p1, q1, s);
        rifle.matrix.compose(p0.lerp(p1, e), q0.slerp(q1, e), s.set(1, 1, 1));
      } else {
        rifle.matrix.copy(held);
      }

      // Bolt cycling and reloading move the right hand off the grip.
      let hand = RIFLE.grip;
      let open = 0;
      let off = 0;
      if (a?.type === 'bolt') {
        const t = a.t / a.dur;
        const reachK = smooth((t - 0.12) / 0.15) * (1 - smooth((t - 0.72) / 0.2));
        off = reachK;
        hand = RIFLE.grip.clone().lerp(RIFLE.bolt, reachK);
        open = smooth((t - 0.3) / 0.14) * (1 - smooth((t - 0.5) / 0.14));
        hand.x -= open * 0.085;
        hand.y += open * 0.02;
      } else if (a?.type === 'reload') {
        const t = a.t;
        const bolt1 = gate(t, 0.26, 0.7);
        const bolt2 = gate(t, 2.12, 2.62);
        open = smooth((t - 0.36) / 0.18) * (1 - smooth((t - 2.28) / 0.16));
        hand = RIFLE.grip.clone();
        const boltPull = Math.max(bolt1, bolt2);
        if (boltPull > 0.01) {
          hand.lerp(new THREE.Vector3(RIFLE.bolt.x - open * 0.09, RIFLE.bolt.y + 0.02, RIFLE.bolt.z), boltPull);
        }
        const pouch = new THREE.Vector3(-0.16, -0.42, 0.2);
        const port = RIFLE.magwell.clone();
        for (const s of [0.74, 1.04, 1.34, 1.64, 1.94]) {
          if (t < s || t >= s + 0.28) continue;
          const u = (t - s) / 0.28;
          if (u < 0.42) hand.copy(RIFLE.grip).lerp(pouch, smooth(u / 0.42));
          else hand.copy(pouch).lerp(port, smooth((u - 0.42) / 0.58));
        }
        off = Math.max(boltPull, t > 0.72 && t < 2.22 ? 1 : 0);
      }
      this.boltOpen = open;
      const M = rifle.matrix;
      const rt = hand.clone().applyMatrix4(M);
      const lt = RIFLE.fore.clone().applyMatrix4(M);
      const ax = (x, y, z) => new THREE.Vector3().addScaledVector(f, x).addScaledVector(u, y).addScaledVector(r, z).normalize();
      const iw = Math.min(1, e * 2.5);
      const finger = ax(0.55, -0.65, -0.5).lerp(ax(0.6, 0.1, -0.4), off).normalize();
      const lateral = ax(0.2, 0.8, 0).lerp(ax(0, 0.3, 0.9), off).normalize();
      solveArm(B, 'Right', rt,
        sh.clone().addScaledVector(UP, -0.6).addScaledVector(right, 0.45).addScaledVector(fwd, -0.15),
        finger, lateral, iw, this.tmp);
      const shL = B.LeftArm.getWorldPosition(new THREE.Vector3());
      solveArm(B, 'Left', lt,
        shL.clone().addScaledVector(UP, -0.7).addScaledVector(left, 0.15),
        ax(0.45, 0.6, 0.65), f, iw, this.tmp);
    }
    rifle.matrixWorld.copy(rifle.matrix);
    this.bolts.forEach((b) => { b.o.position.copy(b.rest); b.o.position.x -= this.boltOpen * 0.085; });
    rifle.children.forEach((c) => c.updateMatrixWorld(true));
  }

  // Throwing swings the right arm back over the shoulder and through.
  applyThrow() {
    const a = this.action;
    const B = this.bones;
    const aimK = this.aimWeight;
    let t = -1;
    if (a?.type === 'throw') t = (a.t / a.dur) * THROW.dur;
    else if (this.grenadeWindup > 0) t = 0.04 + this.grenadeWindup * 0.26;
    else if (aimK > 0.01) t = 0.3 * aimK;
    if (t < 0) return;
    const { fwd, left, right } = this.bodyAxes();
    const twist = t < 0.3 ? -0.45 * smooth(t / 0.3) : t < 0.62 ? -0.45 + 0.85 * smooth((t - 0.3) / 0.32) : 0.4 * (1 - smooth((t - 0.62) / 0.18));
    rotateBoneWorld(B.Spine1, this.tmp.q.setFromAxisAngle(UP, twist * 0.6), this.tmp);
    rotateBoneWorld(B.Spine2, this.tmp.q.setFromAxisAngle(UP, twist * 0.4), this.tmp);
    const sh = B.RightArm.getWorldPosition(new THREE.Vector3());
    const p = throwPoint(t, new THREE.Vector3());
    const target = sh.clone().addScaledVector(right, p.x).addScaledVector(UP, p.y).addScaledVector(fwd, p.z);
    const w = a?.type === 'throw' ? Math.min(1, (a.dur - a.t) / 0.15) : aimK;
    solveArm(B, 'Right', target, sh.clone().addScaledVector(UP, -0.5).addScaledVector(right, 0.5), null, null, w, this.tmp);
    // The free arm points at the target for balance.
    const shL = B.LeftArm.getWorldPosition(new THREE.Vector3());
    const reach = new THREE.Vector3().subVectors(this.aimTarget, shL).normalize().multiplyScalar(0.5).add(shL);
    solveArm(B, 'Left', reach, shL.clone().addScaledVector(UP, -0.6).addScaledVector(left, 0.4), null, null, w * 0.8, this.tmp);
  }

  placeGrenade() {
    const g = this.grenade;
    const a = this.action;
    const thrown = a?.type === 'throw' && a.t >= THROW.release * (a.dur / THROW.dur);
    const show = this.weapon === 'grenade' && this.showGrenade && !this.dead && this.equipT > 0.3 && !thrown;
    g.visible = show;
    if (!show) return;
    const B = this.bones;
    if (!B.RightHandMiddle1 || !B.RightHandIndex1 || !B.RightHandPinky1) { g.visible = false; return; }
    const hp = B.RightHand.getWorldPosition(new THREE.Vector3());
    const fp = B.RightHandMiddle1.getWorldPosition(new THREE.Vector3());
    const x = fp.clone().sub(hp).normalize();
    const lat = B.RightHandIndex1.getWorldPosition(new THREE.Vector3()).sub(B.RightHandPinky1.getWorldPosition(new THREE.Vector3()));
    const y = lat.addScaledVector(x, -lat.dot(x)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    const palm = hp.clone().lerp(fp, 0.75);
    g.matrix.makeBasis(x, y, z).setPosition(palm);
    g.matrixWorld.copy(g.matrix);
    g.children.forEach((c) => c.updateMatrixWorld(true));
  }

  // Direction the guns and arms should take. Follow the mouse look so the
  // pose matches the reticle; a nearby floor hit would yank the barrels down.
  // Where the guns point: the aim, tipped up to a high ready when a wall is
  // closer than the barrel so it never pokes through (see updateGunBlock).
  gunFrom(from, out = new THREE.Vector3()) {
    this.aimFrom(from, out);
    const b = this.gunBlock || 0;
    if (b < 1e-3) return out;
    const up = V[7].set(0, 1, 0).addScaledVector(out, 0.35).normalize();
    return out.lerp(up, b * 0.85).normalize();
  }

  // Probe along the aim from the chest; Character.wallProbe(o, d, len) -> distance | null
  // is set by the game to trace static geometry only.
  updateGunBlock(dt) {
    let goal = 0;
    const probe = Character.wallProbe;
    if (probe && this.aimWeight > 0.05 && (this.weapon === 'rifle' || this.weapon === 'pistols') && this.bones.Spine2) {
      const chest = this.bones.Spine2.getWorldPosition(V[5]);
      const dir = this.aimFrom(chest, V[6]);
      const reach = this.weapon === 'rifle' ? 1.05 : 0.7;
      const t = probe(chest, dir, reach);
      if (t !== null && t !== undefined) goal = THREE.MathUtils.clamp((reach - t) / (reach * 0.55), 0, 1);
    }
    const k = 1 - Math.exp(-dt * (goal > (this.gunBlock || 0) ? 18 : 8));
    this.gunBlock = (this.gunBlock || 0) + (goal - (this.gunBlock || 0)) * k;
  }

  aimFrom(_from, out = new THREE.Vector3()) {
    if (this.lookDir.lengthSq() > 1e-6) return out.copy(this.lookDir).normalize();
    out.subVectors(this.aimTarget, this.root.position);
    out.y -= 1.45;
    if (out.lengthSq() < 1e-8) return out.set(0, 0, 1);
    return out.normalize();
  }

  handPosition(out = new THREE.Vector3()) {
    const mid = this.bones.RightHandMiddle1 || this.bones.RightHand;
    return this.bones.RightHand.getWorldPosition(out).lerp(mid.getWorldPosition(V[1]), 0.75);
  }

  consumeRelease() {
    if (!this.released) return false;
    this.released = false;
    return true;
  }

  // Velocity, acceleration and turn rate of the body, measured from where the
  // controller put the root (player, rival and network bodies alike).
  updateMotion(dt) {
    const p = this.root.position;
    let m = this.motion;
    if (!m) {
      m = this.motion = {
        last: p.clone(), lastYaw: this.root.rotation.y, vel: new THREE.Vector3(), acc: new THREE.Vector3(),
        yawRate: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0,
      };
    }
    if (!(dt > 1e-4)) return m;
    const vx = (p.x - m.last.x) / dt, vz = (p.z - m.last.z) / dt;
    m.last.copy(p);
    const yaw = this.root.rotation.y;
    const dy = Math.atan2(Math.sin(yaw - m.lastYaw), Math.cos(yaw - m.lastYaw));
    m.lastYaw = yaw;
    if (vx * vx + vz * vz > 900 || Math.abs(dy) > 1.5) { // a respawn or a teleport, not motion
      m.vel.set(0, 0, 0); m.acc.set(0, 0, 0); m.yawRate = 0;
      return m;
    }
    const kv = 1 - Math.exp(-dt * 12), ka = 1 - Math.exp(-dt * 7);
    const px = m.vel.x, pz = m.vel.z;
    m.vel.x += (vx - m.vel.x) * kv;
    m.vel.z += (vz - m.vel.z) * kv;
    m.acc.x += ((m.vel.x - px) / dt - m.acc.x) * ka;
    m.acc.z += ((m.vel.z - pz) / dt - m.acc.z) * ka;
    m.yawRate += (dy / dt - m.yawRate) * (1 - Math.exp(-dt * 9));
    return m;
  }

  // Weight shift: the chest leads into acceleration and sits back when braking,
  // and the body banks into turns at speed. Critically damped springs keep it
  // soft; aiming keeps most of it out of the gun.
  applyLean(dt, s) {
    const m = this.motion, B = this.bones;
    if (!m || !B.Spine || !B.Hips || !(dt > 0)) return;
    const { fwd, left, right } = this.bodyAxes();
    const sp = Math.hypot(m.vel.x, m.vel.z);
    const aF = m.acc.x * fwd.x + m.acc.z * fwd.z;
    const aL = m.acc.x * left.x + m.acc.z * left.z;
    const grounded = s.onGround !== false && !s.swimming;
    const clamp = THREE.MathUtils.clamp;
    const pitchGoal = grounded ? clamp(aF * 0.02, -0.14, 0.17) + clamp((sp - 3.6) * 0.035, 0, 0.09) : 0;
    const rollGoal = grounded ? clamp(m.yawRate * sp * 0.014, -0.11, 0.11) + clamp(aL * 0.01, -0.05, 0.05) : 0;
    const w = 9, step = Math.min(dt, 0.05);
    m.pitchV += (w * w * (pitchGoal - m.pitch) - 2 * w * m.pitchV) * step;
    m.pitch += m.pitchV * step;
    m.rollV += (w * w * (rollGoal - m.roll) - 2 * w * m.rollV) * step;
    m.roll += m.rollV * step;
    const keep = 1 - 0.75 * this.aimWeight;
    const turn = (bone, axis, ang) => {
      if (bone && Math.abs(ang) > 1e-4) rotateBoneWorld(bone, this.tmp.q.setFromAxisAngle(axis, ang), this.tmp);
    };
    // +angle about `right` tips the chest back; +angle about `fwd` leans to the right
    turn(B.Spine, right, -m.pitch * 0.55 * keep);
    turn(B.Spine1, right, -m.pitch * 0.45 * keep);
    turn(B.Hips, fwd, -m.roll * keep);
  }

  // Feet on uneven ground: the animation assumes flat ground at the root, so on a kerb
  // or a slope one foot floats and the other sinks. Measure the ground under each foot,
  // drop the pelvis by what the lower foot needs, and bend each leg onto its own ground.
  applyFootIK(dt, s) {
    const P = Character.physics, B = this.bones;
    const off = this.footOff || (this.footOff = [0, 0]);
    const goal = [0, 0];
    if (P && B.LeftFoot && !s.seat && !s.swimming && s.onGround !== false && (s.crouch || 0) < 0.3) {
      const rootY = this.root.position.y;
      ['Left', 'Right'].forEach((side, i) => {
        const f = B[`${side}Foot`].getWorldPosition(V[0]);
        goal[i] = THREE.MathUtils.clamp(P.heightAt(f.x, f.z) - rootY, -0.3, 0.3);
      });
    }
    const k = 1 - Math.exp(-dt * 14);
    off[0] += (goal[0] - off[0]) * k;
    off[1] += (goal[1] - off[1]) * k;
    if (Math.abs(off[0]) < 0.004 && Math.abs(off[1]) < 0.004) return;
    const drop = Math.min(0, off[0], off[1]);
    if (drop < 0) { B.Hips.position.y += drop; B.Hips.updateMatrixWorld(true); }
    const { fwd } = this.bodyAxes();
    ['Left', 'Right'].forEach((side, i) => {
      const lift = off[i] - drop;
      if (lift < 0.004) return;
      const foot = B[`${side}Foot`].getWorldPosition(new THREE.Vector3());
      const knee = B[`${side}Leg`].getWorldPosition(new THREE.Vector3());
      solveLeg(B, side, foot.addScaledVector(UP, lift), knee.addScaledVector(fwd, 0.6), this.tmp);
    });
  }

  // Every weighted gait loop plays at one blended stride rate, on the stride phase of
  // the heaviest one: feet stay planted through walk / jog / run / strafe blends.
  syncGait() {
    let tot = 0, rate = 0, lead = null, leadW = 0;
    for (const name of GAIT) {
      const w = this.weights[name], g = this.gait[name];
      if (!g || !(w > 1e-3)) continue;
      const a = this.actions[name];
      rate += w * a.timeScale * g.cycles / a.getClip().duration;
      tot += w;
      if (w > leadW) { leadW = w; lead = name; }
    }
    if (!lead) return;
    rate /= tot; // strides per second
    const la = this.actions[lead], lg = this.gait[lead], ld = la.getClip().duration;
    const phase = frac((la.time / ld) * lg.cycles - lg.offset);
    for (const name of GAIT) {
      const w = this.weights[name], g = this.gait[name];
      if (!g || !(w > 1e-3)) continue;
      const a = this.actions[name], d = a.getClip().duration;
      a.timeScale = (rate * d) / g.cycles;
      if (name === lead) continue;
      const k = Math.floor((a.time / d) * g.cycles);
      a.time = (((k + phase + g.offset) / g.cycles) % 1) * d;
    }
  }

  setRate(name, speed) {
    const cs = this.speeds[name];
    if (cs > 0.1) this.actions[name].timeScale = THREE.MathUtils.clamp(speed / cs, 0.55, 1.6);
  }

  // Behind the wheel: hips on the seat, thighs forward, shins down to the pedals, a
  // slight recline and both hands on the wheel. seat = { hipY, wheel } in world space.
  applySeated(seat) {
    const B = this.bones;
    if (!B.Hips || !B.LeftUpLeg) return;
    const { fwd, left, right } = this.bodyAxes();
    const turn = (bone, axis, ang) => {
      if (bone && Math.abs(ang) > 1e-4) rotateBoneWorld(bone, this.tmp.q.setFromAxisAngle(axis, ang), this.tmp);
    };
    const hips = B.Hips.getWorldPosition(new THREE.Vector3());
    B.Hips.position.y -= hips.y - seat.hipY;
    B.Hips.updateMatrixWorld(true);
    const thigh = seat.thigh ?? 1.45, knee = seat.knee ?? -1.3;
    turn(B.LeftUpLeg, right, thigh); turn(B.LeftUpLeg, fwd, -0.07);
    turn(B.RightUpLeg, right, thigh); turn(B.RightUpLeg, fwd, 0.07);
    turn(B.LeftLeg, right, knee); turn(B.RightLeg, right, knee);
    turn(B.LeftFoot, right, 0.25); turn(B.RightFoot, right, 0.25);
    turn(B.Spine, right, 0.1);
    if (!seat.wheel || !B.LeftArm || !B.RightArm) return;
    const steer = this.steer || 0;
    for (const [side, out, sign] of [['Left', left, 1], ['Right', right, -1]]) {
      const sh = B[`${side}Arm`].getWorldPosition(new THREE.Vector3());
      // hands at ten to two, turning with the wheel
      const grip = seat.wheel.clone().addScaledVector(out, 0.17).addScaledVector(UP, 0.05 + sign * steer * 0.06);
      solveArm(B, side, grip, sh.clone().addScaledVector(UP, -0.4).addScaledVector(out, 0.3),
        fwd.clone().addScaledVector(UP, 0.2).normalize(), out, 1, this.tmp);
    }
  }

  // Take a knee: planted left foot, right knee on the ground, chest up,
  // both hands stacked on the raised left knee — not a collapsed sit.
  applyCrouch(k) {
    if (k < 0.01) return;
    const B = this.bones;
    if (!B.Hips) return;
    const { fwd, left, right } = this.bodyAxes();
    const turn = (bone, axis, ang) => {
      if (!bone || Math.abs(ang) < 1e-4) return;
      rotateBoneWorld(bone, this.tmp.q.setFromAxisAngle(axis, ang), this.tmp);
    };

    B.Hips.position.y -= 0.45 * k;
    B.Hips.updateMatrixWorld(true);
    turn(B.Hips, right, 0.02 * k);

    // Raised left leg: thigh near horizontal, shin upright, foot planted.
    turn(B.LeftUpLeg, right, 1.50 * k);
    turn(B.LeftUpLeg, fwd, -0.08 * k);
    turn(B.LeftLeg, right, -1.38 * k);
    turn(B.LeftFoot, right, 0.16 * k);

    // Right knee on the floor, shin and foot trailing behind.
    turn(B.RightUpLeg, right, 0.20 * k);
    turn(B.RightUpLeg, fwd, 0.18 * k);
    turn(B.RightLeg, right, -1.75 * k);
    turn(B.RightFoot, right, 0.90 * k);

    turn(B.Spine, right, -0.08 * k);
    turn(B.Spine1, right, 0.03 * k);

    if (this.aimWeight > 0.2) return;
    if (!B.LeftLeg || !B.LeftArm || !B.RightArm) return;
    const knee = B.LeftLeg.getWorldPosition(new THREE.Vector3());
    const rest = knee.clone().addScaledVector(UP, 0.05).addScaledVector(fwd, 0.03);
    const shL = B.LeftArm.getWorldPosition(new THREE.Vector3());
    const shR = B.RightArm.getWorldPosition(new THREE.Vector3());
    solveArm(B, 'Left', rest.clone().addScaledVector(left, 0.03),
      shL.clone().addScaledVector(UP, -0.32).addScaledVector(left, 0.26),
      fwd.clone().addScaledVector(UP, -0.2).normalize(), left, k, this.tmp);
    solveArm(B, 'Right', rest.clone().addScaledVector(right, 0.02).addScaledVector(UP, 0.04),
      shR.clone().addScaledVector(UP, -0.26).addScaledVector(right, 0.2).addScaledVector(fwd, 0.1),
      fwd.clone().addScaledVector(UP, -0.28).normalize(), right, k, this.tmp);
  }

  applySwim(s, dt) {
    const B = this.bones;
    if (!B.RightArm || !B.LeftArm) return;
    this.swimT = (this.swimT || 0) + dt * (0.9 + Math.min(2.2, s.speed));
    const t = this.swimT;
    const { fwd, left, right } = this.bodyAxes();
    const stroke = (side, sign) => {
      const phase = Math.sin(t * 5.2 + (sign > 0 ? 0 : Math.PI));
      const sh = B[`${side}Arm`].getWorldPosition(new THREE.Vector3());
      const reach = sh.clone()
        .addScaledVector(fwd, 0.22 + phase * 0.28)
        .addScaledVector(sign > 0 ? right : left, 0.22)
        .addScaledVector(UP, -0.08 + phase * 0.16);
      solveArm(B, side, reach,
        sh.clone().addScaledVector(UP, -0.35).addScaledVector(sign > 0 ? right : left, 0.4),
        fwd.clone().addScaledVector(UP, -0.2).normalize(),
        sign > 0 ? right : left, 0.85, this.tmp);
    };
    stroke('Right', 1);
    stroke('Left', -1);
  }

  applyAim(s) {
    const w = this.aimWeight;
    const t = this.tmp;
    const B = this.bones;
    if (this.action?.type === 'reload' || this.action?.type === 'pistolReload') {
      const { fwd } = this.bodyAxes();
      this.aimTarget.copy(this.root.position).addScaledVector(fwd, 0.45);
      this.aimTarget.y += 1.05;
    }
    const chest = B.Spine2.getWorldPosition(t.d);
    const dir = this.aimFrom(chest);
    this.aimDir.copy(dir);

    // Twist and bend the spine towards the aim direction.
    const fwd = AIM.fwd.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    const flat = AIM.flat.set(dir.x, 0, dir.z).normalize();
    const yawErr = Math.atan2(fwd.x * flat.z - fwd.z * flat.x, fwd.dot(flat));
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    const lookingGun = this.action?.type === 'reload' || this.action?.type === 'pistolReload';
    const lookW = lookingGun ? 0.82 : Math.max(w, 0.7);
    const right = AIM.right.crossVectors(UP, flat).normalize();
    for (const [name, share] of [['Spine', 0.2], ['Spine1', 0.3], ['Spine2', 0.3]]) {
      const qy = AIM.qa.setFromAxisAngle(UP, -yawErr * share * w);
      const qp = AIM.qb.setFromAxisAngle(right, -pitch * share * w * 0.9);
      rotateBoneWorld(B[name], qy.multiply(qp), t);
    }
    // Head follows the mouse look even when the guns are down.
    const head = B.Head;
    const hd = this.lookDir.lengthSq() > 1e-6
      ? AIM.hd.copy(this.lookDir).normalize()
      : AIM.hd.subVectors(this.aimTarget, head.getWorldPosition(t.a)).normalize();
    const headFwd = AIM.headFwd.set(0, 0, 1).applyQuaternion(head.getWorldQuaternion(t.q));
    const clampDir = AIM.clamp.copy(headFwd).lerp(hd, 0.75).normalize();
    const angle = headFwd.angleTo(hd);
    if (angle < 1.6) {
      const q = AIM.qa.setFromUnitVectors(headFwd, clampDir);
      q.copy(AIM.qb.identity().slerp(q, lookW));
      rotateBoneWorld(head, q, t);
    }

    if (this.action?.type === 'pistolReload') { this.applyPistolReload(); return; }
    if (w < 0.01 || this.weapon !== 'pistols') return;
    // Recoil pushes the firing shoulder back and twists the chest slightly.
    const kick = this.recoil[0] - this.recoil[1];
    const kickAll = this.recoil[0] + this.recoil[1];
    if (kickAll > 1e-3) {
      const qk = AIM.qa.setFromAxisAngle(UP, -kick * 0.25 * w);
      qk.multiply(AIM.qb.setFromAxisAngle(right, -kickAll * 0.12 * w));
      rotateBoneWorld(B.Spine2, qk, t);
    }
    // Both arms extend towards the same aim point the shots use.
    const pitchAxis = AIM.pitch.crossVectors(dir, UP).normalize();
    const sides = ['Right', 'Left'];
    sides.forEach((side, i) => {
      const upper = B[`${side}Arm`], fore = B[`${side}ForeArm`], hand = B[`${side}Hand`];
      const finger = B[`${side}HandMiddle1`];
      const sh = upper.getWorldPosition(t.a);
      const d = this.gunFrom(sh);
      rotateBoneToward(upper, fore, d, w, t);
      const fp = fore.getWorldPosition(t.a);
      const d2 = this.gunFrom(fp);
      rotateBoneToward(fore, hand, d2, w, t);
      if (finger) rotateBoneToward(hand, finger, d2, w, t);
      const r = this.recoil[i] * w;
      if (r > 1e-3) {
        rotateBoneWorld(upper, AIM.qa.setFromAxisAngle(pitchAxis, r * 0.35), t);
        rotateBoneWorld(fore, AIM.qa.setFromAxisAngle(pitchAxis, r * 0.45), t);
        rotateBoneWorld(hand, AIM.qa.setFromAxisAngle(pitchAxis, r * 0.6), t);
      }
    });
  }

  applyPistolReload() {
    const a = this.action;
    const t = a.t;
    const B = this.bones;
    const { fwd, left, right } = this.bodyAxes();
    const dip = gate(t, 0.12, 0.88);
    const rack = gate(t, 1.18, 1.52);
    [['Right', right], ['Left', left]].forEach(([side, out]) => {
      const sh = B[`${side}Arm`].getWorldPosition(new THREE.Vector3());
      const ready = sh.clone().addScaledVector(fwd, 0.32).addScaledVector(UP, -0.06).addScaledVector(out, 0.08);
      const hip = sh.clone().addScaledVector(UP, -0.48).addScaledVector(out, 0.1).addScaledVector(fwd, 0.06);
      const target = ready.clone().lerp(hip, dip);
      solveArm(B, side, target,
        sh.clone().addScaledVector(UP, -0.55).addScaledVector(out, 0.25),
        fwd.clone().addScaledVector(UP, -0.35).normalize(), out, 1, this.tmp);
    });
    this.pistols.forEach((p) => {
      const mag = p.userData.mag;
      if (mag) mag.visible = t < 0.18 || t > 0.92;
    });
    this.reloadRack = rack;
  }

  updateFeet(dt, s) {
    if (!this.onFootstep || !s.onGround || s.speed < 0.3) return;
    const baseY = this.root.position.y;
    ['LeftFoot', 'RightFoot'].forEach((name, i) => {
      const y = this.bones[name].getWorldPosition(this.tmp.a).y - baseY;
      if (!this.footDown[i] && y < 0.11) { this.footDown[i] = true; this.onFootstep(i, s.speed); }
      else if (this.footDown[i] && y > 0.16) this.footDown[i] = false;
    });
  }

  updateBraid(dt) {
    if (!this.braid) return;
    const t = this.tmp;
    const head = this.bones.Head;
    head.updateMatrixWorld(true);
    const anchor = new THREE.Vector3(0, 0.1, -0.085).applyMatrix4(head.matrixWorld);
    const headC = new THREE.Vector3(0, 0.08, 0).applyMatrix4(head.matrixWorld);
    const back = this.bones.Spine2.getWorldPosition(new THREE.Vector3());
    const backDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion);
    back.addScaledVector(backDir, -0.02);
    const pts = this.braidPts;
    if (!this.braidInit) {
      pts.forEach((p, i) => { p.p.copy(anchor).y -= i * this.braidSeg; p.o.copy(p.p); });
      this.braidInit = true;
    }
    const h = Math.min(dt, 1 / 30);
    pts[0].p.copy(anchor);
    pts[0].o.copy(anchor);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const v = t.a.subVectors(p.p, p.o).multiplyScalar(0.96);
      p.o.copy(p.p);
      p.p.add(v).add(t.b.set(0, -9.8 * h * h, 0));
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1].p, b = pts[i].p;
        const d = t.a.subVectors(b, a);
        const l = d.length() || 1e-5;
        const corr = (l - this.braidSeg) / l;
        if (i === 1) b.addScaledVector(d, -corr);
        else { a.addScaledVector(d, corr * 0.5); b.addScaledVector(d, -corr * 0.5); }
      }
      for (let i = 1; i < pts.length; i++) {
        for (const [c, r] of [[headC, 0.115], [back, 0.15]]) {
          const d = t.a.subVectors(pts[i].p, c);
          const l = d.length();
          if (l < r) pts[i].p.addScaledVector(d, (r - l) / (l || 1));
        }
      }
    }
    const m = t.m;
    const q = t.q, sc = t.b, pos = t.c;
    let k = 0;
    for (let i = 0; i < this.braidN; i++) {
      const a = pts[i].p, b = pts[i + 1].p;
      const dir = t.d.subVectors(b, a).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const taper = 1 - (i / this.braidN) * 0.45;
      for (let j = 0; j < 2; j++) {
        pos.copy(a).lerp(b, j * 0.5 + 0.25);
        const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2 + j) * 1.3);
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5 * (j ? 1 : -1));
        const qq = q.clone().multiply(twist).multiply(tilt);
        sc.set(0.024 * taper, 0.03, 0.02 * taper);
        m.compose(pos, qq, sc);
        this.braid.setMatrixAt(k++, m);
      }
    }
    this.braid.instanceMatrix.needsUpdate = true;
  }

  updatePistols(dt) {
    const t = this.tmp;
    const sides = ['RightHand', 'LeftHand'];
    this.holsters.forEach((h, i) => {
      h.holster.matrix.multiplyMatrices(h.bone.matrixWorld, h.local);
      h.holster.matrixWorld.copy(h.holster.matrix);
      h.holster.children.forEach((c) => c.updateMatrixWorld(true));
      h.band.matrix.multiplyMatrices(h.bone.matrixWorld, h.bandLocal);
      h.band.matrixWorld.copy(h.band.matrix);
      const p = this.pistols[i];
      if (this.drawn) {
        const hand = this.bones[sides[i]];
        const hp = hand.getWorldPosition(t.a);
        const finger = this.bones[sides[i].replace('Hand', 'HandMiddle1')] || this.bones[sides[i].replace('Hand', 'ForeArm')];
        const fp = finger.getWorldPosition(t.b);
        const alongHand = finger === this.bones[sides[i].replace('Hand', 'HandMiddle1')]
          ? t.c.subVectors(fp, hp).normalize()
          : t.c.subVectors(hp, fp).normalize();
        const x = this.aimWeight > 0.15 ? this.aimFrom(hp) : alongHand;
        const upW = new THREE.Vector3(0, 1, 0);
        const z = new THREE.Vector3().crossVectors(x, upW).normalize();
        if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
        const y = new THREE.Vector3().crossVectors(z, x).normalize();
        const tilt = (i === 0 ? 1 : -1) * 0.12 * (1 - this.aimWeight);
        y.applyAxisAngle(x, tilt);
        z.crossVectors(x, y);
        const pos = hp.clone().addScaledVector(x, 0.07).addScaledVector(y, -0.015);
        p.matrix.makeBasis(x, y, z).setPosition(pos);
      } else {
        p.matrix.multiplyMatrices(h.bone.matrixWorld, h.local);
      }
      p.matrixWorld.copy(p.matrix);
      const sl = p.userData.slide;
      const mag = p.userData.mag;
      const pistolReload = this.action?.type === 'pistolReload';
      if (mag && !pistolReload) mag.visible = true;
      if (sl && p.userData.slideRest) {
        if (pistolReload) {
          sl.position.copy(p.userData.slideRest).x -= (this.reloadRack || 0) * 0.038;
        } else {
          sl.userData.kick = Math.max(0, (sl.userData.kick || 0) - dt * 12);
          sl.position.copy(p.userData.slideRest).x -= Math.min(1, sl.userData.kick) * 0.03;
        }
      }
      p.children.forEach((c) => c.updateMatrixWorld(true));
    });
  }

  muzzleWorld(i, out = new THREE.Vector3()) {
    return out.copy(this.muzzleLocal).applyMatrix4(this.pistols[i].matrixWorld);
  }

  pistolAxis(i, out = new THREE.Vector3()) {
    return out.setFromMatrixColumn(this.pistols[i].matrixWorld, 0).normalize();
  }

  rifleMuzzle(out = new THREE.Vector3()) {
    return out.copy(RIFLE.muzzle).applyMatrix4(this.rifle.matrixWorld);
  }

  rifleAxis(out = new THREE.Vector3()) {
    return out.setFromMatrixColumn(this.rifle.matrixWorld, 0).normalize();
  }

  firedRifle() {
    this.rifleKick = 1;
  }

  fired(i) {
    this.recoil[i] = Math.min(0.55, this.recoil[i] + 0.38);
    const sl = this.pistols[i].userData.slide;
    if (sl) sl.userData.kick = 1;
  }
}
