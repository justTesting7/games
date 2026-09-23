import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLTF, rpmUrl, modelUrl } from '../engine/assets.js';

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

// Clip timing for jumps: when the feet leave and touch the ground again.
export const JUMPS = {
  jumpJog: { start: 0.06, takeoff: 0.12, land: 0.5 },
  jumpRun: { start: 0.5, takeoff: 0.58, land: 1.25 },
};

const LOOPING = new Set(['idle', 'walk', 'walkBack', 'walkLeft', 'walkRight', 'jog', 'jogBack', 'jogLeft', 'jogRight', 'run', 'fall']);

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
};

// Turns the stock outfit into a tank top, cargo trousers and leather boots
// in the outfit's colours, and removes the logo print.
function recolorAtlas(image, outfit) {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, 1024, 1024);
  g.drawImage(c, 150, 790, 90, 60, 150, 715, 90, 60);
  g.drawImage(c, 340, 790, 120, 70, 340, 705, 120, 70);
  const img = g.getImageData(0, 0, 1024, 1024);
  const d = img.data;
  const region = (x0, y0, x1, y1, fn) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = (y * 1024 + x) * 4;
      const l = (d[k] + d[k + 1] + d[k + 2]) / (3 * 255);
      const [r, gg, b] = fn(l, x, y);
      d[k] = Math.min(255, r * 255); d[k + 1] = Math.min(255, gg * 255); d[k + 2] = Math.min(255, b * 255);
    }
  };
  region(0, 512, 512, 1024, (l) => {
    if (l < 0.03) return [0, 0, 0];
    const t = Math.pow(l, 1.1);
    const c = outfit.top;
    return [c[0] * t + 0.02, c[1] * t + 0.03, c[2] * t + 0.04];
  });
  region(512, 0, 1024, 512, (l) => {
    const t = 0.45 + l * 2.6;
    const c = outfit.trousers;
    return [c[0] * t, c[1] * t, c[2] * t];
  });
  region(768, 512, 1024, 768, (l) => {
    const t = 0.35 + l * 0.9;
    const c = outfit.boots;
    return [c[0] * t, c[1] * t, c[2] * t];
  });
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
  rough(0, 512, 512, 512, 0.82);
  rough(512, 0, 512, 512, 0.9);
  rough(768, 512, 256, 256, 0.5);
  rough(512, 512, 256, 256, 0.15);
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

export class Character {
  constructor() {
    this.root = new THREE.Group();
    this.actions = {};
    this.speeds = {};
    this.weights = {};
    this.state = 'idle';
    this.aimWeight = 0;
    this.aimTarget = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, 1);
    this.recoil = [0, 0];
    this.drawn = 0;
    this.dead = null;
    this.flinch = 0;
    this.flinchAxis = new THREE.Vector3(1, 0, 0);
    this.jump = null;
    this.onFootstep = null;
    this.footDown = [true, true];
    this.tmp = {
      a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(),
      q: new THREE.Quaternion(), qi: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(),
      m: new THREE.Matrix4(),
    };
  }

  // Loads the model, clips and pistol once; every character clones them.
  static async loadAssets(progress) {
    const [avatar, pistolGltf, ...anims] = await progress.task('Loading the adventurers', 5, () => Promise.all([
      loadGLTF(rpmUrl('Feminine_TPose')),
      loadGLTF(modelUrl('service_pistol')),
      ...Object.values(CLIPS).map((f) => loadGLTF(rpmUrl(f))),
    ]));
    const boneNames = new Set();
    let baseImage = null;
    avatar.scene.traverse((o) => {
      if (o.isBone) boneNames.add(o.name);
      if (o.isSkinnedMesh) baseImage = o.material.map.image;
    });
    const clips = {}, speeds = {};
    Object.keys(CLIPS).forEach((name, i) => {
      const { clip, speed } = processClip(anims[i].animations[0], name, boneNames);
      clips[name] = clip;
      speeds[name] = speed;
    });
    const normalMap = await avatar.parser.getDependency('texture', 0);
    normalMap.flipY = false;
    return { scene: avatar.scene, pistolGltf, clips, speeds, baseImage, normalMap };
  }

  load(assets, outfit = OUTFITS.adventurer) {
    this.model = cloneSkinned(assets.scene);
    this.root.add(this.model);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) this.mesh = o;
    });

    const normalMap = assets.normalMap;
    const { map, roughnessMap } = recolorAtlas(assets.baseImage, outfit);
    this.mesh.material = new THREE.MeshStandardMaterial({
      map, normalMap, roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8),
    });
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    this.mixer = new THREE.AnimationMixer(this.model);
    Object.keys(CLIPS).forEach((name) => {
      const action = this.mixer.clipAction(assets.clips[name]);
      if (!LOOPING.has(name)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions[name] = action;
      this.speeds[name] = assets.speeds[name];
      this.weights[name] = 0;
    });
    this.weights.idle = 1;
    this.actions.idle.setEffectiveWeight(1);

    this.buildBraid(outfit.hair);
    this.buildPistols(assets.pistolGltf);
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

  addTo(scene) {
    scene.add(this.root, this.braid);
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
  hitReact(dir) {
    this.flinchAxis.set(dir.z, 0, -dir.x).normalize();
    this.flinch = Math.min(1, this.flinch + 0.7);
  }

  // Topples away from the killing shot, pivoting on the feet.
  die(dir) {
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-6) flat.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)).negate();
    flat.normalize();
    this.dead = { t: 0, yaw: this.root.rotation.y, axis: new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), flat).normalize() };
    this.jump = null;
  }

  revive() {
    this.dead = null;
    this.flinch = 0;
    this.aimT = 0;
    this.aimWeight = 0;
    this.drawn = 0;
    this.root.rotation.set(0, this.root.rotation.y, 0);
    this.actions.fall.timeScale = 1;
  }

  updateDead(dt) {
    const d = this.dead;
    d.t += dt;
    const k = Math.min(1, d.t / 0.75);
    const tip = 1.5 * k * k;
    this.root.quaternion.setFromAxisAngle(d.axis, tip).multiply(this.tmp.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw));
    this.root.position.y += 0.13 * k;
    this.setWeights({ fall: 1 }, 0.25, dt);
    if (d.t > 0.7) this.actions.fall.timeScale = Math.max(0, this.actions.fall.timeScale - dt * 3);
    this.aimT = 0;
    this.aimWeight = 0;
    this.drawn = 0;
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    this.updateBraid(dt);
    this.updatePistols(dt);
  }

  // Called by the controller every frame with the movement state.
  update(dt, s) {
    if (this.dead) { this.updateDead(dt); return; }
    const target = {};
    const locomotion = () => {
      const sp = s.speed;
      if (sp < 0.15) { target.idle = 1; return; }
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
    if (s.jumpStarted) {
      const kind = s.speed > 4.6 ? 'jumpRun' : 'jumpJog';
      const info = JUMPS[kind];
      const a = this.actions[kind];
      a.reset();
      a.time = info.start;
      a.timeScale = 1;
      a.play();
      this.jump = { kind, info, t: 0, landed: false, airTime: s.predictedAir };
    }
    if (this.jump) {
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
    } else if (!s.onGround && s.airTime > 0.35) {
      target.fall = 1;
      fade = 0.3;
    } else {
      locomotion();
    }
    this.setWeights(target, fade, dt);
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    const aimGoal = s.aiming ? 1 : 0;
    // Drawing takes about a fifth of a second with an eased arm swing; the
    // guns leave the holsters while the hands are still at the hips.
    this.aimT = THREE.MathUtils.clamp((this.aimT || 0) + (aimGoal ? dt / 0.2 : -dt / 0.35), 0, 1);
    const e = this.aimT;
    this.aimWeight = e * e * (3 - 2 * e);
    this.drawn = this.aimT > 0.12 ? 1 : 0;
    this.aimTarget.copy(s.aimPoint);
    this.recoil[0] *= Math.exp(-dt * 13);
    this.recoil[1] *= Math.exp(-dt * 13);
    this.applyAim(s);
    if (this.flinch > 0.01) {
      rotateBoneWorld(this.bones.Spine1, this.tmp.q.setFromAxisAngle(this.flinchAxis, this.flinch * 0.32), this.tmp);
      this.flinch *= Math.exp(-dt * 9);
    }
    this.updateFeet(dt, s);
    this.updateBraid(dt);
    this.updatePistols(dt);
  }

  setRate(name, speed) {
    const cs = this.speeds[name];
    if (cs > 0.1) this.actions[name].timeScale = THREE.MathUtils.clamp(speed / cs, 0.55, 1.6);
  }

  applyAim(s) {
    const w = this.aimWeight;
    const t = this.tmp;
    const B = this.bones;
    const chest = B.Spine2.getWorldPosition(t.d);
    const dir = new THREE.Vector3().subVectors(this.aimTarget, chest).normalize();
    this.aimDir.copy(dir);

    // Twist and bend the spine towards the aim direction.
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const yawErr = Math.atan2(fwd.x * flat.z - fwd.z * flat.x, fwd.dot(flat));
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    const lookW = Math.max(w, 0.35);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), flat).normalize();
    for (const [name, share] of [['Spine', 0.2], ['Spine1', 0.3], ['Spine2', 0.3]]) {
      const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yawErr * share * w);
      const qp = new THREE.Quaternion().setFromAxisAngle(right, -pitch * share * w * 0.9);
      rotateBoneWorld(B[name], qy.multiply(qp), t);
    }
    // Head follows the camera even when not aiming.
    const head = B.Head;
    const hp = head.getWorldPosition(t.a);
    const hd = new THREE.Vector3().subVectors(this.aimTarget, hp).normalize();
    const headFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(t.q));
    const clampDir = headFwd.clone().lerp(hd, 0.6).normalize();
    const angle = headFwd.angleTo(hd);
    if (angle < 1.4) {
      const q = new THREE.Quaternion().setFromUnitVectors(headFwd, clampDir);
      q.copy(new THREE.Quaternion().slerp(q, lookW));
      rotateBoneWorld(head, q, t);
    }

    if (w < 0.01) return;
    // Recoil pushes the firing shoulder back and twists the chest slightly.
    const kick = this.recoil[0] - this.recoil[1];
    const kickAll = this.recoil[0] + this.recoil[1];
    if (kickAll > 1e-3) {
      const qk = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -kick * 0.25 * w);
      qk.multiply(new THREE.Quaternion().setFromAxisAngle(right, -kickAll * 0.12 * w));
      rotateBoneWorld(B.Spine2, qk, t);
    }
    // Both arms extend towards the target, like a two-gun stance.
    const pitchAxis = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const sides = [['Right', -1], ['Left', 1]];
    sides.forEach(([side, sgn], i) => {
      const upper = B[`${side}Arm`], fore = B[`${side}ForeArm`], hand = B[`${side}Hand`];
      const finger = B[`${side}HandMiddle1`];
      const sh = upper.getWorldPosition(t.a);
      const aim = this.aimTarget.clone();
      aim.addScaledVector(right, sgn * 0.12);
      const d = aim.sub(sh).normalize();
      d.addScaledVector(right, sgn * 0.06).normalize();
      rotateBoneToward(upper, fore, d, w, t);
      const fp = fore.getWorldPosition(t.a);
      const d2 = new THREE.Vector3().subVectors(this.aimTarget, fp).normalize();
      rotateBoneToward(fore, hand, d2, w, t);
      // Straight wrist, so the pistol lines up with the forearm.
      if (finger) rotateBoneToward(hand, finger, d2, w, t);
      const r = this.recoil[i] * w;
      if (r > 1e-3) {
        rotateBoneWorld(upper, new THREE.Quaternion().setFromAxisAngle(pitchAxis, r * 0.35), t);
        rotateBoneWorld(fore, new THREE.Quaternion().setFromAxisAngle(pitchAxis, r * 0.45), t);
        rotateBoneWorld(hand, new THREE.Quaternion().setFromAxisAngle(pitchAxis, r * 0.6), t);
      }
    });
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
        const x = finger === this.bones[sides[i].replace('Hand', 'HandMiddle1')] ? t.c.subVectors(fp, hp).normalize() : t.c.subVectors(hp, fp).normalize();
        const upW = new THREE.Vector3(0, 1, 0);
        const z = new THREE.Vector3().crossVectors(x, upW).normalize();
        const y = new THREE.Vector3().crossVectors(z, x).normalize();
        const tilt = (i === 0 ? 1 : -1) * 0.25;
        y.applyAxisAngle(x, tilt);
        z.crossVectors(x, y);
        const pos = hp.clone().addScaledVector(x, 0.07).addScaledVector(y, -0.015);
        p.matrix.makeBasis(x, y, z).setPosition(pos);
      } else {
        p.matrix.multiplyMatrices(h.bone.matrixWorld, h.local);
      }
      p.matrixWorld.copy(p.matrix);
      const sl = p.userData.slide;
      if (sl && p.userData.slideRest) {
        sl.userData.kick = Math.max(0, (sl.userData.kick || 0) - dt * 12);
        sl.position.copy(p.userData.slideRest).x -= Math.min(1, sl.userData.kick) * 0.03;
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

  fired(i) {
    this.recoil[i] = Math.min(0.55, this.recoil[i] + 0.38);
    const sl = this.pistols[i].userData.slide;
    if (sl) sl.userData.kick = 1;
  }
}
