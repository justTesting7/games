import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLTF, rpmUrl } from '../engine/assets.js';
import { ACTION_DUR, KICK } from './actions.js';

const CLIPS = {
  idle: 'M_Standing_Idle_001',
  idle2: 'M_Standing_Idle_Variations_002',
  walk: 'M_Walk_001',
  walkBack: 'M_Walk_Backwards_001',
  walkLeft: 'M_Walk_Strafe_Left_002',
  walkRight: 'M_Walk_Strafe_Right_002',
  jog: 'M_Jog_001',
  jogBack: 'M_Jog_Backwards_001',
  jogLeft: 'M_Jog_Strafe_Left_001',
  jogRight: 'M_Jog_Strafe_Right_001',
  run: 'M_Run_001',
  runBack: 'M_Run_Backwards_002',
  runLeft: 'M_Run_Strafe_Left_002',
  runRight: 'M_Run_Strafe_Right_002',
  jump: 'M_Jog_Jump_002',
  dance: 'M_Dances_001',
};
const LOOPING = new Set(Object.keys(CLIPS).filter((k) => k !== 'jump'));
const ATLAS_SKIN = [209, 145, 112];

// Atlas regions (pixels in the 1024 texture) used to find average cloth
// brightness, so recolouring keeps the fabric's folds but not its hue.
const REGIONS = {
  top: [0, 512, 512, 1024],
  trousers: [512, 0, 768, 256],
  shoes: [512, 256, 1024, 768],
};
// The stock shirt's printed logos, filled with the cloth around them.
const LOGO_FILL = [[164, 708, 222, 746], [344, 710, 443, 772]];

function processClip(clip, name, boneNames) {
  clip.tracks = clip.tracks.filter((t) => boneNames.has(t.name.split('.')[0]));
  let speed = 0;
  const hips = clip.tracks.find((t) => t.name === 'Hips.position');
  if (hips) {
    const v = hips.values;
    const n = v.length / 3;
    speed = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]) / clip.duration;
    if (name !== 'dance') {
      const x0 = v[0], z0 = v[2];
      for (let i = 0; i < n; i++) { v[i * 3] = x0; v[i * 3 + 2] = z0; }
    }
  }
  clip.name = name;
  return { clip, speed };
}

function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

function cleanAtlas(image) {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, 1024, 1024);
  const img = g.getImageData(0, 0, 1024, 1024);
  const d = img.data;
  for (const [x0, y0, x1, y1] of LOGO_FILL) {
    for (let x = x0; x < x1; x++) {
      const a = ((y0 - 1) * 1024 + x) * 4, b = (y1 * 1024 + x) * 4;
      for (let y = y0; y < y1; y++) {
        const f = (y - y0 + 1) / (y1 - y0 + 1);
        const k = (y * 1024 + x) * 4;
        for (let ch = 0; ch < 3; ch++) d[k + ch] = d[a + ch] * (1 - f) + d[b + ch] * f;
      }
    }
  }
  const avg = {};
  for (const [name, [x0, y0, x1, y1]] of Object.entries(REGIONS)) {
    let s = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const k = (y * 1024 + x) * 4;
      const l = 0.2126 * srgbToLin(d[k] / 255) + 0.7152 * srgbToLin(d[k + 1] / 255) + 0.0722 * srgbToLin(d[k + 2] / 255);
      if (l > 0.004) { s += l; n++; }
    }
    avg[name] = n ? s / n : 0.05;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, avg };
}

const kitPars = /* glsl */ `
uniform vec3 uShirt;
uniform vec3 uSleeve;
uniform vec3 uShorts;
uniform vec3 uSocks;
uniform vec3 uTrim;
uniform vec3 uBoots;
uniform vec3 uSkinK;
uniform vec3 uHair;
uniform vec3 uGloves;
uniform float uStripes;
uniform float uKeeper;
uniform vec3 uAvg;
uniform sampler2D tDecal;
varying vec3 vBind;
`;

// Colours the stock outfit into a kit by atlas region and bind-pose height:
// shorts above the knee, bare knee, socks to the boot, sleeves, gloves.
const kitFrag = /* glsl */ `
vec2 apx = vMapUv * 1024.0;
vec3 texel = diffuseColor.rgb;
float lum = dot(texel, vec3(0.2126, 0.7152, 0.0722));
vec3 B = vBind;
float ax = abs(B.x);
vec3 skinCol = texel * uSkinK;
vec3 outCol = texel;
bool isTop = apx.x < 512.0 && apx.y > 512.0;
bool isHead = apx.x < 512.0 && apx.y < 512.0;
bool isTrousers = apx.x > 512.0 && apx.x < 768.0 && apx.y < 256.0;
bool isShoes = apx.x > 512.0 && apx.y > 256.0 && apx.y < 768.0;
bool isSkin = apx.x > 768.0 && apx.x < 896.0 && apx.y > 768.0 && apx.y < 896.0;
bool isHair = apx.x > 768.0 && apx.x < 896.0 && apx.y > 896.0;
float sleeveEnd = uKeeper > 0.5 ? 0.43 : 0.335;
if (isTop) {
  float fold = clamp(lum / uAvg.x, 0.45, 1.6);
  vec3 base = uShirt;
  if (uStripes > 0.5 && ax < 0.2) base = fract(B.x * 5.5 + 0.25) < 0.5 ? uShirt : uSleeve;
  if (ax > 0.2) base = uSleeve;
  if (B.y > 1.5 && ax < 0.09) base = uTrim;
  outCol = base * fold;
  vec4 dec = texture2D(tDecal, vec2(apx.x / 512.0, (apx.y - 512.0) / 512.0));
  outCol = mix(outCol, dec.rgb * mix(0.85, 1.1, fold), dec.a);
} else if (isTrousers) {
  float fold = clamp(lum / uAvg.y, 0.45, 1.7);
  if (B.y > 0.67) outCol = uShorts * fold;
  else if (B.y > 0.515) outCol = vec3(0.82, 0.57, 0.44) * uSkinK * 0.55;
  else outCol = (B.y > 0.47 ? uTrim : uSocks) * fold;
} else if (isShoes) {
  float fold = clamp(lum / uAvg.z, 0.4, 1.3);
  outCol = uBoots * fold;
  if (B.y < 0.018) outCol = vec3(0.04);
} else if (isSkin) {
  if (uKeeper > 0.5 && ax > 0.43) outCol = uGloves;
  else if (ax > 0.2 && ax < sleeveEnd && B.y > 0.92) outCol = uSleeve * 0.9;
  else if (B.y < 0.3) outCol = uSocks * 0.9;
  else outCol = skinCol;
} else if (isHead) {
  float hairMask = smoothstep(0.05, 0.015, lum) * step(apx.y, 330.0);
  outCol = mix(skinCol, uHair * (lum / 0.02), hairMask);
} else if (isHair) {
  outCol = uHair * clamp(lum / 0.015, 0.5, 1.6);
}
diffuseColor.rgb = outCol;
`;

// World-space bone rotation that keeps the hierarchy.
function rotateBoneWorld(bone, q, tmp) {
  const wq = bone.getWorldQuaternion(tmp.q2);
  const pq = bone.parent.getWorldQuaternion(tmp.q3);
  wq.premultiply(q);
  bone.quaternion.copy(pq.invert().multiply(wq));
  bone.updateMatrixWorld(true);
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

const V = Array.from({ length: 8 }, () => new THREE.Vector3());
const UP = new THREE.Vector3(0, 1, 0);

// Two-bone IK: wrist on `target`, elbow bending towards `pole`.
function solveArm(B, side, target, pole, w, tmp) {
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
}

const smooth = (k) => { const x = Math.min(1, Math.max(0, k)); return x * x * (3 - 2 * x); };
// Piecewise-smooth keyframes: [[t, value], ...] sampled at t.
function keys(t, k) {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const [t0, v0] = k[i - 1], [t1, v1] = k[i];
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
    }
  }
  return k[k.length - 1][1];
}


export class Footballer {
  constructor() {
    this.root = new THREE.Group();
    this.actions = {};
    this.speeds = {};
    this.weights = {};
    this.action = null;
    this.lookAt = new THREE.Vector3();
    this.lean = 0;
    this.tmp = {
      a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(),
      q: new THREE.Quaternion(), qi: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(),
    };
    this.onFootstep = null;
    this.footDown = [true, true];
  }

  static async loadAssets() {
    const names = Object.keys(CLIPS);
    const [avatar, ...anims] = await Promise.all([
      loadGLTF(rpmUrl('Masculine_TPose')),
      ...names.map((n) => loadGLTF(rpmUrl(CLIPS[n]))),
    ]);
    const boneNames = new Set();
    let baseImage = null;
    avatar.scene.traverse((o) => {
      if (o.isBone) boneNames.add(o.name);
      if (o.isSkinnedMesh) baseImage = o.material.map.image;
    });
    const clips = {}, speeds = {};
    names.forEach((name, i) => {
      const { clip, speed } = processClip(anims[i].animations[0], name, boneNames);
      clips[name] = clip;
      speeds[name] = speed;
    });
    const normalMap = await avatar.parser.getDependency('texture', 0);
    normalMap.flipY = false;
    const atlas = cleanAtlas(baseImage);
    return { scene: avatar.scene, clips, speeds, atlas, normalMap };
  }

  // `look`: { kit, number, name, skin: [r,g,b], hair: '#hex', keeper, height }
  load(assets, look) {
    this.model = cloneSkinned(assets.scene);
    this.root.add(this.model);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) this.mesh = o;
    });
    const kit = look.keeper ? look.kit.keeper : look.kit;
    const col = (h) => new THREE.Color(h).convertSRGBToLinear();
    const skinK = look.skin.map((v, i) => v / ATLAS_SKIN[i]);
    this.decal = this.makeDecal(look, kit);
    const uniforms = {
      uShirt: { value: col(kit.shirt) },
      uSleeve: { value: col(kit.sleeve || kit.shirt) },
      uShorts: { value: col(kit.shorts) },
      uSocks: { value: col(kit.socks) },
      uTrim: { value: col(kit.trim || kit.shirt) },
      uBoots: { value: col(look.boots || '#111111') },
      uSkinK: { value: new THREE.Vector3(...skinK) },
      uHair: { value: col(look.hair) },
      uGloves: { value: col(kit.gloves || '#e6ff3a') },
      uStripes: { value: kit.stripes ? 1 : 0 },
      uKeeper: { value: look.keeper ? 1 : 0 },
      uAvg: { value: new THREE.Vector3(assets.atlas.avg.top, assets.atlas.avg.trousers, assets.atlas.avg.shoes) },
      tDecal: { value: this.decal },
    };
    this.uniforms = uniforms;
    const mat = new THREE.MeshStandardMaterial({
      map: assets.atlas.tex, normalMap: assets.normalMap, roughness: 0.78, metalness: 0,
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec3 vBind;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
      shader.fragmentShader = kitPars + shader.fragmentShader.replace(
        '#include <map_fragment>', `#include <map_fragment>\n${kitFrag}`);
    };
    mat.customProgramCacheKey = () => 'footballer-kit-v1';
    this.mesh.material = mat;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const h = look.height || 1;
    this.model.scale.setScalar(h);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const name of Object.keys(CLIPS)) {
      const action = this.mixer.clipAction(assets.clips[name]);
      if (!LOOPING.has(name)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      action.time = Math.random() * action.getClip().duration;
      this.actions[name] = action;
      this.speeds[name] = assets.speeds[name];
      this.weights[name] = 0;
    }
    this.weights.idle = 1;
    this.actions.idle.setEffectiveWeight(1);
    this.idleAlt = Math.random() < 0.5;
  }

  // Name and number on the back, crest and sponsor on the chest.
  makeDecal(look, kit) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 512);
    const ink = kit.number || '#ffffff';
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Back panel: atlas x 265..512, centre at 383; rows are atlas y - 512.
    g.font = '900 118px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    g.save();
    g.translate(383, 292);
    g.scale(0.82, 1);
    g.fillText(String(look.number), 0, 0);
    g.restore();
    g.font = '800 24px "Arial Black", Arial, sans-serif';
    g.save();
    g.translate(383, 212);
    g.scale(0.9, 1);
    g.fillText(look.name.toUpperCase(), 0, 0);
    g.restore();
    // Front panel: centre at atlas x 140.
    g.font = '900 34px "Arial Black", Arial, sans-serif';
    g.fillStyle = kit.sponsor || ink;
    g.fillText(kit.sponsorText || 'JEV', 140, 290);
    g.fillStyle = kit.crest || ink;
    g.beginPath();
    g.moveTo(178, 190); g.lineTo(192, 196); g.lineTo(190, 214); g.lineTo(178, 222); g.lineTo(166, 214); g.lineTo(164, 196);
    g.closePath();
    g.fill();
    g.fillStyle = ink;
    g.font = '900 30px "Arial Black", Arial, sans-serif';
    g.fillText(String(look.number), 102, 212);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  setWeights(target, fade, dt) {
    const k = fade <= 0 ? 1 : Math.min(1, dt / fade);
    for (const name in this.actions) {
      const w = this.weights[name] + ((target[name] || 0) - this.weights[name]) * k;
      this.weights[name] = w;
      this.actions[name].setEffectiveWeight(w);
    }
  }

  setRate(name, speed) {
    const cs = this.speeds[name];
    if (cs > 0.1) this.actions[name].timeScale = THREE.MathUtils.clamp(speed / cs, 0.55, 1.7);
  }

  // Starts a procedural action: kick, poke, slide, dive, header, throw, fall, celebrate.
  play(type, opts = {}) {
    this.action = { type, t: 0, dur: opts.dur || ACTION_DUR[type] || 0.5, ...opts };
    if (type === 'celebrate') {
      const a = this.actions.dance;
      a.reset(); a.play();
    }
    if (type === 'header' || type === 'jumpCatch') {
      const a = this.actions.jump;
      a.reset(); a.time = 0.25; a.timeScale = 1.3; a.play();
    }
  }

  bodyAxes() {
    const fwd = V[0].set(0, 0, 1).applyQuaternion(this.root.quaternion).setY(0).normalize().clone();
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    return { fwd, left, right: left.clone().negate() };
  }

  // `s`: { speed, localDir (x = left, z = forward), lookAt, turnRate, holding }
  update(dt, s) {
    const target = {};
    const a = this.action;
    if (a) {
      a.t += dt;
      if (a.t >= a.dur) this.action = null;
    }
    const sp = s.speed;
    const busy = a && (a.type === 'slide' || a.type === 'dive' || a.type === 'fall' || a.type === 'celebrate' && a.dance);
    if (a?.type === 'celebrate' && a.dance) {
      target.dance = 1;
    } else if (a && (a.type === 'header' || a.type === 'jumpCatch')) {
      target.jump = 1;
    } else if (busy) {
      target.run = 0.2;
      target.idle = 0.8;
    } else if (sp < 0.15) {
      if (this.idleAlt) target.idle2 = 1; else target.idle = 1;
    } else {
      const lf = s.localDir;
      const ax = Math.abs(lf.x), az = Math.abs(lf.z);
      const tot = ax + az || 1;
      const band = sp < 2.2 ? 'walk' : sp < 5.2 ? 'jog' : 'run';
      const sideMix = ax / tot;
      if (lf.z >= -0.2 || sideMix > 0.6) {
        // Forward or sideways: blend speed tiers, then strafe by direction.
        let fa, fb, ft;
        if (sp < 1.7) { fa = 'idle'; fb = 'walk'; ft = sp / 1.7; }
        else if (sp < 4.2) { fa = 'walk'; fb = 'jog'; ft = (sp - 1.7) / 2.5; }
        else { fa = 'jog'; fb = 'run'; ft = Math.min(1, (sp - 4.2) / 2.4); }
        const fw = lf.z >= 0 ? az / tot : 0;
        const sideName = lf.x > 0 ? `${band}Left` : `${band}Right`;
        target[fa] = (1 - ft) * fw;
        target[fb] = (target[fb] || 0) + ft * fw;
        target[sideName] = (target[sideName] || 0) + (1 - fw);
        this.setRate(fa, sp); this.setRate(fb, sp); this.setRate(sideName, sp);
      } else {
        const back = `${band}Back`;
        const sideName = lf.x > 0 ? `${band}Left` : `${band}Right`;
        target[back] = az / tot;
        target[sideName] = ax / tot;
        this.setRate(back, sp); this.setRate(sideName, sp);
      }
    }
    this.setWeights(target, busy ? 0.1 : 0.2, dt);
    this.model.position.y = this.action ? this.dropFor(this.action) : 0;
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    const { fwd, left, right } = this.bodyAxes();
    const B = this.bones;
    const turn = (bone, axis, ang) => {
      if (!bone || Math.abs(ang) < 1e-4) return;
      rotateBoneWorld(bone, this.tmp.q.setFromAxisAngle(axis, ang), this.tmp);
    };

    // Lean into sprints and turns.
    const leanTarget = THREE.MathUtils.clamp((s.turnRate || 0) * sp * 0.035, -0.3, 0.3);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 6);
    if (!busy && sp > 1) {
      turn(B.Hips, fwd, -this.lean);
      turn(B.Spine1, right, Math.min(0.14, sp * 0.018));
    }

    if (this.action) this.applyAction(this.action, { fwd, left, right, turn });
    if (s.holding && !this.action) this.applyHold(fwd, left);
    this.applyLook(s.lookAt, busy ? 0 : 0.8);
    this.updateFeet(s);
  }

  applyAction(a, ax) {
    const B = this.bones;
    const { fwd, left, right, turn } = ax;
    const u = a.t / a.dur;
    const tmp = this.tmp;
    if (a.type === 'kick' || a.type === 'poke' || a.type === 'touch') {
      const side = a.foot === 'Left' ? 'Left' : 'Right';
      const other = side === 'Left' ? 'Right' : 'Left';
      const p = a.type === 'touch' ? 0.22 : a.type === 'poke' ? 0.45 : 0.55 + 0.45 * (a.power ?? 0.6);
      const c = KICK.contact;
      const hip = keys(u, [[0, 0], [c * 0.62, -0.75 * p], [c, 0.55 + 0.5 * p + (a.loft || 0) * 0.35], [c + 0.22, 1.05 * p + 0.3], [1, 0]]);
      const knee = keys(u, [[0, 0], [c * 0.62, -1.5 * p], [c, -0.18], [c + 0.22, -0.35], [1, 0]]);
      // Inside-foot passes open the hip; shots strike with the laces.
      const open = (a.style === 'pass' ? 0.45 : 0.08) * (side === 'Right' ? 1 : -1);
      turn(B[`${side}UpLeg`], UP, keys(u, [[0, 0], [c, open], [1, 0]]));
      turn(B[`${side}UpLeg`], right, hip);
      turn(B[`${side}Leg`], right, knee);
      turn(B[`${side}Foot`], right, keys(u, [[0, 0], [c, a.style === 'pass' ? 0.1 : -0.45], [1, 0]]));
      turn(B[`${other}Leg`], right, keys(u, [[0, 0], [c, -0.35], [1, 0]]));
      turn(B[`${other}UpLeg`], right, keys(u, [[0, 0], [c, 0.18], [1, 0]]));
      turn(B.Spine, right, keys(u, [[0, 0], [c, (a.loft || 0) * -0.25 + 0.05], [1, 0]]));
      turn(B.Spine1, UP, keys(u, [[0, 0], [c * 0.62, (side === 'Right' ? 0.25 : -0.25) * p], [c + 0.2, (side === 'Right' ? -0.3 : 0.3) * p], [1, 0]]));
      // Arms out for balance.
      const armOut = keys(u, [[0, 0], [c, 0.9], [1, 0]]);
      turn(B.LeftArm, fwd, -armOut * 0.6);
      turn(B.RightArm, fwd, armOut * 0.6);
      if (side === 'Right') turn(B.LeftArm, right, armOut * 0.5); else turn(B.RightArm, right, armOut * 0.5);
    } else if (a.type === 'slide') {
      const k = keys(u, [[0, 0], [0.15, 1], [0.75, 1], [1, 0]]);
      turn(B.Hips, right, -1.15 * k);
      turn(B.Spine1, right, 0.55 * k);
      turn(B.RightUpLeg, right, 1.25 * k);
      turn(B.RightLeg, right, -0.1 * k);
      turn(B.LeftUpLeg, right, 0.7 * k);
      turn(B.LeftLeg, right, -1.6 * k);
      turn(B.LeftArm, fwd, -0.9 * k);
      turn(B.RightArm, fwd, 0.9 * k);
    } else if (a.type === 'dive') {
      const dir = a.side || 1;
      const k = keys(u, [[0, 0], [0.18, 1], [0.7, 1], [1, 0.2]]);
      turn(B.Hips, fwd, -dir * 1.25 * k);
      turn(B.Spine1, fwd, -dir * 0.25 * k);
      const reach = a.high ? 0.6 : 0.2;
      for (const s of ['Left', 'Right']) {
        const sh = B[`${s}Arm`].getWorldPosition(new THREE.Vector3());
        const side = dir > 0 ? left : right;
        const target = sh.clone().addScaledVector(side, 0.55 * k).addScaledVector(UP, (0.15 + reach) * k).addScaledVector(fwd, 0.2);
        solveArm(B, s, target, sh.clone().addScaledVector(UP, -0.4).addScaledVector(fwd, -0.2), k, tmp);
      }
      turn(B.LeftUpLeg, fwd, -dir * 0.3 * k);
      turn(B.RightUpLeg, fwd, -dir * 0.3 * k);
    } else if (a.type === 'header' || a.type === 'jumpCatch') {
      const nod = keys(u, [[0, 0], [0.45, -0.35], [0.6, 0.45], [1, 0]]);
      if (a.type === 'header') {
        turn(B.Neck, right, nod);
        turn(B.Spine1, right, nod * 0.4);
      } else {
        const k = keys(u, [[0, 0], [0.3, 1], [0.8, 1], [1, 0]]);
        for (const s of ['Left', 'Right']) {
          const sh = B[`${s}Arm`].getWorldPosition(new THREE.Vector3());
          solveArm(B, s, sh.clone().addScaledVector(UP, 0.5).addScaledVector(fwd, 0.25), sh.clone().addScaledVector(fwd, -0.3), k, tmp);
        }
      }
    } else if (a.type === 'throw') {
      // Throw-in: ball behind the head, then over.
      const k = keys(u, [[0, 1], [0.6, 1], [1, 0]]);
      const back = keys(u, [[0, -0.25], [0.45, -0.45], [0.62, 0.35], [1, 0]]);
      turn(B.Spine, right, back * 0.6);
      turn(B.Spine1, right, back * 0.5);
      for (const s of ['Left', 'Right']) {
        const sh = B[`${s}Arm`].getWorldPosition(new THREE.Vector3());
        const tgt = sh.clone().addScaledVector(UP, 0.45).addScaledVector(fwd, back * 0.6).addScaledVector(s === 'Left' ? right : left, 0.12);
        solveArm(B, s, tgt, sh.clone().addScaledVector(fwd, -0.5), k, tmp);
      }
    } else if (a.type === 'fall') {
      const k = keys(u, [[0, 0], [0.25, 1], [0.7, 1], [1, 0]]);
      turn(B.Hips, right, (a.back ? -1.3 : 1.2) * k);
      turn(B.Spine1, right, (a.back ? 0.3 : -0.2) * k);
      turn(B.LeftUpLeg, right, 0.4 * k);
      turn(B.RightLeg, right, -0.8 * k);
    } else if (a.type === 'celebrate' && !a.dance) {
      // Arms spread, chest out: the classic aeroplane.
      const k = keys(u, [[0, 0], [0.12, 1], [0.9, 1], [1, 0]]);
      for (const s of ['Left', 'Right']) {
        const sh = B[`${s}Arm`].getWorldPosition(new THREE.Vector3());
        const out = s === 'Left' ? left : right;
        solveArm(B, s, sh.clone().addScaledVector(out, 0.62).addScaledVector(UP, 0.08 + 0.05 * Math.sin(a.t * 3)), sh.clone().addScaledVector(UP, -0.4), k, tmp);
      }
      turn(B.Spine1, right, -0.2 * k);
    } else if (a.type === 'gkReady') {
      this.applyHold(fwd, left, true);
    }
  }

  // How far the body sinks towards the grass during an action.
  dropFor(a) {
    const u = a.t / a.dur;
    if (a.type === 'slide') return -0.62 * keys(u, [[0, 0], [0.15, 1], [0.75, 1], [1, 0]]);
    if (a.type === 'fall') return -0.7 * keys(u, [[0, 0], [0.25, 1], [0.7, 1], [1, 0]]);
    if (a.type === 'dive') return (a.high ? -0.15 : -0.55) * keys(u, [[0, 0], [0.18, 1], [0.7, 1], [1, 0.3]]);
    return 0;
  }

  // Keeper holding the ball at the chest, or set with hands out.
  applyHold(fwd, left, ready = false) {
    const B = this.bones;
    const chest = B.Spine2.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.28);
    if (ready) chest.addScaledVector(UP, -0.2).addScaledVector(fwd, 0.1);
    for (const s of ['Left', 'Right']) {
      const side = s === 'Left' ? left : left.clone().negate();
      const sh = B[`${s}Arm`].getWorldPosition(new THREE.Vector3());
      const t = chest.clone().addScaledVector(side, ready ? 0.28 : 0.1);
      solveArm(B, s, t, sh.clone().addScaledVector(UP, -0.5).addScaledVector(side, 0.3), 1, this.tmp);
    }
  }

  applyLook(point, w) {
    if (!point || w <= 0) return;
    const B = this.bones;
    const head = B.Head;
    const hp = head.getWorldPosition(this.tmp.a);
    const want = this.tmp.b.subVectors(point, hp);
    if (want.lengthSq() < 1e-4) return;
    want.normalize();
    const cur = new THREE.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(this.tmp.q));
    const ang = cur.angleTo(want);
    if (ang > 1.7) return;
    const q = new THREE.Quaternion().setFromUnitVectors(cur, cur.clone().lerp(want, 0.7).normalize());
    rotateBoneWorld(B.Neck, new THREE.Quaternion().slerp(q, w * 0.4), this.tmp);
    rotateBoneWorld(head, new THREE.Quaternion().slerp(q, w * 0.5), this.tmp);
  }

  updateFeet(s) {
    if (!this.onFootstep || s.speed < 0.8) return;
    const baseY = this.root.position.y;
    ['LeftFoot', 'RightFoot'].forEach((name, i) => {
      const y = this.bones[name].getWorldPosition(this.tmp.a).y - baseY;
      if (!this.footDown[i] && y < 0.11) { this.footDown[i] = true; this.onFootstep(i, s.speed); }
      else if (this.footDown[i] && y > 0.16) this.footDown[i] = false;
    });
  }

  footPosition(side, out = new THREE.Vector3()) {
    return this.bones[`${side}Foot`].getWorldPosition(out);
  }

  handsPosition(out = new THREE.Vector3()) {
    this.bones.LeftHand.getWorldPosition(out);
    return out.lerp(this.bones.RightHand.getWorldPosition(this.tmp.c), 0.5);
  }

  headPosition(out = new THREE.Vector3()) {
    return this.bones.Head.getWorldPosition(out);
  }
}
