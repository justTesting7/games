import * as THREE from 'three';
import { BulletHoles } from './bulletHoles.js';
import { SkidMarks } from './skidMarks.js';
import { Debris } from './debris.js';

// what a round knocks off each surface
const DEBRIS = {
  concrete: { n: 3, kind: 'chip', size: 0.03, color: [0.55, 0.53, 0.5] },
  cover: { n: 3, kind: 'chip', size: 0.03, color: [0.55, 0.53, 0.5] },
  rock: { n: 3, kind: 'chip', size: 0.035, color: [0.45, 0.43, 0.4] },
  wood: { n: 3, kind: 'splinter', size: 0.025, color: [0.5, 0.36, 0.2] },
  target: { n: 2, kind: 'splinter', size: 0.025, color: [0.6, 0.45, 0.28] },
  glass: { n: 5, kind: 'shard', size: 0.03, color: [0.75, 0.85, 0.9] },
};
import { BloodDecals } from './blood.js';

const particleVert = /* glsl */ `
attribute vec4 iPos;
attribute vec4 iColor;
attribute vec4 iVel;
attribute float iSeed;
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
void main() {
  vUv = position.xy;
  vColor = iColor;
  vSeed = iSeed;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = iPos.xyz;
  float size = iPos.w;
  if (iVel.w > 0.0) {
    // Stretched along the velocity, for sparks and tracers.
    vec3 axis = normalize(iVel.xyz + 1e-5);
    vec3 toCam = normalize(cameraPosition - wp);
    vec3 side = normalize(cross(axis, toCam));
    wp += side * position.x * size + axis * position.y * iVel.w;
  } else {
    wp += (camRight * position.x + camUp * position.y) * size;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const particleFrag = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
uniform vec3 uLight;
uniform vec3 uAmbient;
#ifdef BLOOD
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.13 + 7.1) * 0.3 + vnoise(p * 4.37 + 3.3) * 0.15; }
#endif
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  #ifdef BLOOD
    // Seeds >= 2 are mist puffs; below that, liquid droplets / tissue.
    if (vSeed >= 2.0) {
      float n = fbm(vUv * 1.6 + vSeed * 13.7);
      float a = smoothstep(0.18, 0.7, (1.0 - r) * (0.45 + n)) * vColor.a;
      vec3 lit = vColor.rgb * (uAmbient * 1.1 + uLight * 0.3);
      gl_FragColor = vec4(lit, a);
    } else {
      vec3 nrm = vec3(vUv, sqrt(max(0.0, 1.0 - r * r)));
      float diff = 0.55 + 0.45 * nrm.z;
      float spec = pow(max(0.0, dot(nrm, normalize(vec3(-0.4, 0.5, 0.77)))), 48.0);
      vec3 lit = vColor.rgb * (uAmbient + uLight * 0.25) * diff + spec * (uAmbient * 0.9 + uLight * 0.06);
      gl_FragColor = vec4(lit, smoothstep(1.0, 0.8, r) * vColor.a);
    }
  #elif defined(ADDITIVE)
    float a = pow(1.0 - r, 2.0);
    gl_FragColor = vec4(vColor.rgb * a * vColor.a, 0.0);
  #else
    float a = smoothstep(1.0, 0.2, r) * vColor.a;
    vec3 lit = vColor.rgb * (uAmbient + uLight * 0.25);
    gl_FragColor = vec4(lit, a);
  #endif
}
`;

class ParticlePool {
  constructor(max, additive, uniforms, defines = {}) {
    this.max = max;
    this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.vel = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.pos);
    g.setAttribute('iColor', this.col);
    g.setAttribute('iVel', this.vel);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iSeed', this.seed);
    g.instanceCount = 0;
    /** Optional ground height function; particles spawned with `land` die on contact and call `onLand`. */
    this.ground = null;
    this.onLand = null;
    const mat = new THREE.ShaderMaterial({
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms,
      defines: additive ? { ADDITIVE: 1, ...defines } : defines,
      transparent: true,
      depthWrite: false,
      // Alpha is left untouched because it holds scene depth.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: additive ? THREE.OneFactor : THREE.SrcAlphaFactor,
      blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.geo = g;
    this.p = [];
  }

  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.pos.x, y: o.pos.y, z: o.pos.z,
      vx: o.vel?.x || 0, vy: o.vel?.y || 0, vz: o.vel?.z || 0,
      size: o.size, grow: o.grow || 0, life: o.life, age: 0,
      r: o.color[0], g: o.color[1], b: o.color[2], a: o.alpha ?? 1,
      gravity: o.gravity ?? 0, drag: o.drag ?? 0, stretch: o.stretch || 0, fade: o.fade ?? 1,
      seed: o.seed ?? Math.random(), vstretch: o.vstretch || 0, land: o.land || 0,
    });
  }

  update(dt) {
    const P = this.pos.array, C = this.col.array, V = this.vel.array, S = this.seed.array;
    let n = 0;
    const alive = [];
    for (const p of this.p) {
      // Newly spawned particles are drawn where they were emitted first.
      const first = p.age === 0;
      p.age += first ? 1e-4 : dt;
      if (p.age >= p.life) continue;
      alive.push(p);
      if (!first) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy = p.vy * k - p.gravity * dt; p.vz *= k;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.size += p.grow * dt;
        if (p.land && this.ground && p.vy < 0) {
          const h = this.ground(p.x, p.z);
          if (p.y < h) {
            alive.pop();
            this.onLand?.(p, h);
            continue;
          }
        }
      }
      const t = p.age / p.life;
      const a = p.a * (p.fade ? 1 - t : 1) * (p.grow > 0 ? Math.min(1, 0.3 + p.age * 20) : 1);
      P.set([p.x, p.y, p.z, p.size], n * 4);
      C.set([p.r, p.g, p.b, a], n * 4);
      const st = p.vstretch ? Math.min(0.3, Math.max(p.size, Math.hypot(p.vx, p.vy, p.vz) * p.vstretch)) : p.stretch;
      V.set([p.vx, p.vy, p.vz, st], n * 4);
      S[n] = p.seed;
      n++;
    }
    this.p = alive;
    this.geo.instanceCount = n;
    for (const at of [this.pos, this.col, this.vel, this.seed]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * at.itemSize);
      at.needsUpdate = true;
    }
  }
}

const SURFACE = {
  grass: { dust: [0.32, 0.3, 0.22], chunks: [0.2, 0.28, 0.1] },
  sand: { dust: [0.75, 0.66, 0.5], chunks: [0.7, 0.62, 0.48] },
  forest: { dust: [0.3, 0.25, 0.18], chunks: [0.25, 0.2, 0.12] },
  rock: { dust: [0.55, 0.53, 0.5], chunks: [0.45, 0.43, 0.4], sparks: true },
  wood: { dust: [0.5, 0.4, 0.28], chunks: [0.55, 0.4, 0.22] },
  target: { dust: [0.8, 0.75, 0.65], chunks: [0.8, 0.7, 0.5] },
  metal: { dust: [0.4, 0.4, 0.4], chunks: [0.3, 0.3, 0.3], sparks: true },
  water: { dust: [0.85, 0.9, 0.95], chunks: [0.85, 0.9, 0.95] },
  flesh: { dust: [0.32, 0.03, 0.03], chunks: [0.25, 0.01, 0.01] },
  concrete: { dust: [0.45, 0.42, 0.38], chunks: [0.38, 0.35, 0.32], sparks: true },
  cover: { dust: [0.45, 0.42, 0.38], chunks: [0.38, 0.35, 0.32], sparks: true },
};

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const BLOOD_DARK = [0.14, 0.004, 0.004];
const BLOOD_FRESH = [0.24, 0.012, 0.01];
const TISSUE = [0.26, 0.05, 0.045];
const TISSUE_PALE = [0.46, 0.28, 0.24];
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export class Effects {
  constructor(pipeline, terrain, audio) {
    this.pipeline = pipeline;
    this.terrain = terrain;
    this.audio = audio;
    const uniforms = { uLight: { value: pipeline.lightColor }, uAmbient: { value: new THREE.Vector3(0.3, 0.33, 0.38) } };
    this.uniforms = uniforms;
    this.add = new ParticlePool(800, true, uniforms);
    this.alpha = new ParticlePool(1200, false, uniforms);
    this.blood = new ParticlePool(1500, false, uniforms, { BLOOD: 1 });
    pipeline.fxScene.add(this.add.mesh, this.alpha.mesh, this.blood.mesh);
    this.decals = new BloodDecals(pipeline.scene, terrain);
    this.holes = new BulletHoles(pipeline.scene);
    this.skids = new SkidMarks(pipeline.scene);
    this.debris = new Debris(pipeline.scene, (x, z) => terrain.heightAt(x, z));
    this.blood.ground = (x, z) => terrain.heightAt(x, z);
    this.blood.onLand = (p, h) => {
      if (h > 0.02 && Math.random() < 0.5) this.decals.drop(p.x, h, p.z, Math.min(0.22, Math.max(0.035, p.size * 9)));
    };

    const casingGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.019, 8).rotateZ(Math.PI / 2);
    const brass = new THREE.MeshStandardMaterial({ color: 0xd4a246, metalness: 1, roughness: 0.3 });
    this.casingMax = 60;
    this.casingMesh = new THREE.InstancedMesh(casingGeo, brass, this.casingMax);
    this.casingMesh.castShadow = true;
    this.casingMesh.frustumCulled = false;
    this.casingMesh.count = 0;
    pipeline.scene.add(this.casingMesh);
    this.casings = [];
    this.flash = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  muzzle(pos, dir, scale = 1) {
    const add = this.add;
    const k = scale;
    const tip = pos.clone().addScaledVector(dir, 0.02);
    add.spawn({ pos: tip, size: (0.09 + Math.random() * 0.03) * k, life: 0.05, color: [70, 42, 15], fade: 1 });
    add.spawn({ pos: tip.clone().addScaledVector(dir, 0.08 * k), vel: dir.clone().multiplyScalar(0.01), size: 0.03 * k, stretch: 0.1 * k, life: 0.04, color: [90, 55, 20] });
    for (let i = 0; i < 2; i++) {
      const d = dir.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.45)).normalize();
      add.spawn({ pos: tip.clone().addScaledVector(d, 0.04 * k), vel: d.multiplyScalar(0.01), size: 0.016 * k, stretch: 0.05 * k, life: 0.04, color: [60, 34, 12] });
    }
    const puffs = k > 1.2 ? 3 : 2;
    for (let i = 0; i < puffs; i++) {
      this.alpha.spawn({
        pos: tip.clone().addScaledVector(dir, 0.025 * i),
        vel: dir.clone().multiplyScalar((1 + Math.random() * 0.8) * k).add(new THREE.Vector3(0, 0.18, 0)).add(new THREE.Vector3().randomDirection().multiplyScalar(0.15 * k)),
        size: 0.024 * k, grow: 0.22 * k, life: 0.28 + Math.random() * 0.22, color: [0.58, 0.58, 0.6], alpha: 0.12, drag: 5,
      });
    }
    const fl = this.pipeline.flashLight;
    fl.position.copy(tip);
    fl.intensity = 110 * k * k;
    this.flash = 0.045;
  }

  explosion(pos, surface) {
    const fl = this.pipeline.flashLight;
    fl.position.copy(pos).y += 0.6;
    fl.intensity = 9000;
    this.flash = 0.12;
    const up = new THREE.Vector3(0, 1, 0);
    if (surface === 'water') {
      for (let i = 0; i < 70; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 4, 6 + Math.random() * 9, (Math.random() - 0.5) * 4);
        this.alpha.spawn({ pos: pos.clone().setY(0.05), vel: v, size: 0.08 + Math.random() * 0.12, grow: 0.4, life: 1.2 + Math.random() * 0.8, color: [0.85, 0.9, 0.95], alpha: 0.85, gravity: 9.8, drag: 0.4 });
      }
      for (let i = 0; i < 12; i++) {
        this.alpha.spawn({ pos: pos.clone().setY(0.3 + Math.random()), vel: new THREE.Vector3().randomDirection().multiplyScalar(2).setY(1.5), size: 0.6, grow: 1.5, life: 1.5 + Math.random(), color: [0.9, 0.93, 0.97], alpha: 0.5, drag: 2 });
      }
      return;
    }
    // chunks of whatever it went off on, thrown out and up
    for (let i = 0; i < 18; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 6);
      v.y = Math.abs(v.y) * 1.2 + 2.5;
      const g = 0.18 + Math.random() * 0.2;
      this.debris.spawn(pos.clone().setY(pos.y + 0.2), v, { kind: 'chip', size: 0.05 + Math.random() * 0.08, color: [g, g * 0.95, g * 0.9] });
    }
    const s = SURFACE[this.terrain.heightAt(pos.x, pos.z) < 0.6 ? 'sand' : 'grass'];
    for (let i = 0; i < 26; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 6);
      v.y = Math.abs(v.y) * 0.8 + 1;
      this.add.spawn({ pos: pos.clone().addScaledVector(up, 0.3), vel: v, size: 0.35 + Math.random() * 0.5, grow: 2.2, life: 0.18 + Math.random() * 0.25, color: [90, 38, 9], drag: 6 });
    }
    this.add.spawn({ pos: pos.clone().addScaledVector(up, 0.4), size: 2.2, life: 0.08, color: [160, 90, 30], fade: 1 });
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(10 + Math.random() * 18);
      v.y = Math.abs(v.y) + 2;
      this.add.spawn({ pos: pos.clone().addScaledVector(up, 0.2), vel: v, size: 0.012, stretch: 0.3, life: 0.2 + Math.random() * 0.4, color: [60, 28, 7], gravity: 9.8 });
    }
    for (let i = 0; i < 30; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(1 + Math.random() * 3.5);
      v.y = Math.abs(v.y) * 1.2 + 1.2;
      this.alpha.spawn({ pos: pos.clone().addScaledVector(up, 0.4 + Math.random() * 0.5), vel: v, size: 0.7 + Math.random() * 0.8, grow: 1.4, life: 3.5 + Math.random() * 3, color: [0.16, 0.15, 0.14], alpha: 0.7, drag: 1.3, gravity: -0.25 });
    }
    for (let i = 0; i < 60; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 8);
      v.y = Math.abs(v.y) * 1.5 + 2;
      this.alpha.spawn({ pos: pos.clone().addScaledVector(up, 0.1), vel: v, size: 0.02 + Math.random() * 0.05, life: 1 + Math.random(), color: s.chunks, alpha: 1, gravity: 9.8, fade: 0 });
    }
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(4).setY(0.4);
      this.alpha.spawn({ pos: pos.clone().addScaledVector(up, 0.15), vel: v, size: 0.4, grow: 2.5, life: 2 + Math.random() * 1.5, color: s.dust, alpha: 0.55, drag: 2 });
    }
  }

  droneKill(pos, incoming) {
    const dir = incoming.clone().normalize();
    const fl = this.pipeline.flashLight;
    fl.position.copy(pos);
    fl.intensity = 2800;
    this.flash = 0.1;
    this.add.spawn({ pos, size: 0.7, life: 0.07, color: [90, 48, 16], fade: 1 });
    this.add.spawn({ pos: pos.clone().addScaledVector(dir, 0.08), size: 0.28, life: 0.09, color: [70, 28, 6], fade: 1 });
    for (let i = 0; i < 52; i++) {
      const v = dir.clone().multiplyScalar(5 + Math.random() * 12)
        .add(new THREE.Vector3().randomDirection().multiplyScalar(7));
      this.add.spawn({
        pos, vel: v, size: 0.007, stretch: 0.16,
        life: 0.22 + Math.random() * 0.4, color: [72, 30, 6], gravity: 12,
      });
    }
    for (let i = 0; i < 10; i++) {
      this.add.spawn({
        pos: pos.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.07)),
        vel: new THREE.Vector3().randomDirection().multiplyScalar(1.4).setY(1.6 + Math.random()),
        size: 0.1 + Math.random() * 0.08, grow: 0.85, life: 0.32 + Math.random() * 0.22,
        color: [42, 12, 2], drag: 3.2,
      });
    }
    for (let i = 0; i < 12; i++) {
      this.alpha.spawn({
        pos, vel: new THREE.Vector3().randomDirection().multiplyScalar(0.7).setY(0.9 + Math.random() * 0.6),
        size: 0.18 + Math.random() * 0.16, grow: 1.05, life: 1.5 + Math.random(),
        color: [0.13, 0.12, 0.11], alpha: 0.72, drag: 1.15,
      });
    }
    for (let i = 0; i < 18; i++) {
      const v = dir.clone().multiplyScalar(2 + Math.random() * 6)
        .add(new THREE.Vector3().randomDirection().multiplyScalar(3.2));
      v.y = Math.abs(v.y) + 1.8;
      this.alpha.spawn({
        pos, vel: v, size: 0.01 + Math.random() * 0.022, life: 0.85 + Math.random() * 0.6,
        color: [0.38, 0.32, 0.26], alpha: 1, gravity: 9.8, fade: 0,
      });
    }
  }

  droneTrail(pos, vel) {
    this.alpha.spawn({
      pos: pos.clone(),
      vel: vel.clone().multiplyScalar(-0.1).add(new THREE.Vector3((Math.random() - 0.5) * 0.45, 0.55, (Math.random() - 0.5) * 0.45)),
      size: 0.14 + Math.random() * 0.14, grow: 0.75, life: 0.65 + Math.random() * 0.5,
      color: [0.15, 0.13, 0.12], alpha: 0.58, drag: 1.5,
    });
    if (Math.random() < 0.6) {
      this.add.spawn({
        pos: pos.clone(),
        vel: new THREE.Vector3().randomDirection().multiplyScalar(2.2 + Math.random() * 4.5),
        size: 0.006, stretch: 0.055, life: 0.12 + Math.random() * 0.2,
        color: [55, 20, 4], gravity: 8,
      });
    }
    if (Math.random() < 0.4) {
      this.add.spawn({
        pos: pos.clone(),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.35, 0.45, (Math.random() - 0.5) * 0.35),
        size: 0.07, grow: 0.45, life: 0.2, color: [38, 11, 2], drag: 3.8,
      });
    }
  }

  tracer(from, to) {
    const d = new THREE.Vector3().subVectors(to, from);
    const len = d.length();
    if (len < 0.3) return;
    d.divideScalar(len);
    const speed = 380;
    const skip = Math.min(0.35, len * 0.12);
    this.add.spawn({
      pos: from.clone().addScaledVector(d, skip), vel: d.clone().multiplyScalar(speed), size: 0.012, stretch: 1.2,
      life: Math.max(0.02, (len - skip) / speed), color: [30, 20, 9], fade: 0,
    });
  }

  headshot(pos, dir, normal, scale = 1) {
    this.bloodBurst(pos, dir, normal, scale, true);
  }

  bloodHit(pos, dir, normal, scale = 1) {
    this.bloodBurst(pos, dir, normal, scale, false);
  }

  // Wound ballistics, roughly: a little fine back-spatter at the entry, a
  // fast cone of droplets at the exit, plus tissue for head wounds.
  // Liquid is dark and glossy, not bright red (no fullscreen mist haze).
  bloodBurst(pos, dir, normal, k, head) {
    const B = this.blood;
    const fwd = dir.clone().normalize();
    const back = fwd.clone().negate();
    const side = new THREE.Vector3().crossVectors(fwd, Math.abs(fwd.y) < 0.9 ? UP : RIGHT).normalize();
    const up = new THREE.Vector3().crossVectors(side, fwd).normalize();
    const entry = pos.clone().addScaledVector(normal, 0.01);
    const exit = pos.clone().addScaledVector(fwd, head ? 0.2 : 0.38);
    const cone = (axis, spread) => axis.clone()
      .addScaledVector(side, gauss() * spread)
      .addScaledVector(up, gauss() * spread)
      .normalize();
    const liquid = () => (Math.random() < 0.7 ? BLOOD_DARK : BLOOD_FRESH);

    for (let i = 0; i < (head ? 14 : 8) * k; i++) {
      B.spawn({
        pos: entry, vel: cone(back, 0.55).multiplyScalar(1.5 + Math.random() * 3.5),
        size: 0.003 + Math.random() * 0.006, vstretch: 0.01, life: 1.4,
        color: liquid(), gravity: 9.8, drag: 1.2, fade: 0, land: 1,
      });
    }
    for (let i = 0; i < (head ? 70 : 30) * k; i++) {
      const fast = Math.random();
      B.spawn({
        pos: exit.clone().addScaledVector(fwd, -0.05 + Math.random() * 0.08),
        vel: cone(fwd, 0.18 + (1 - fast) * 0.35).multiplyScalar((3 + fast * 13) * (0.75 + k * 0.25)),
        size: 0.003 + Math.random() * 0.011, vstretch: 0.012, life: 1.8,
        color: liquid(), gravity: 9.8, drag: 0.9, fade: 0, land: 1,
      });
    }
    for (let i = 0; i < (head ? 14 : 6) * k; i++) {
      B.spawn({
        pos: exit, vel: cone(fwd, 0.5).multiplyScalar(1.2 + Math.random() * 4).addScaledVector(UP, Math.random()),
        size: 0.01 + Math.random() * 0.018, vstretch: 0.008, life: 2,
        color: BLOOD_DARK, gravity: 9.8, drag: 0.4, fade: 0, land: 1,
      });
    }
    if (head) {
      for (let i = 0; i < 10 * k; i++) {
        B.spawn({
          pos: exit, vel: cone(fwd, 0.6).multiplyScalar(2.5 + Math.random() * 7),
          size: 0.007 + Math.random() * 0.016, vstretch: 0.004, life: 2,
          color: Math.random() < 0.75 ? TISSUE : TISSUE_PALE, gravity: 9.8, drag: 0.5, fade: 0, land: 1,
        });
      }
    }
  }

  impact(pos, normal, surface, incoming) {
    const s = SURFACE[surface] || SURFACE.grass;
    const refl = incoming.clone().reflect(normal).normalize();
    if (surface === 'water') {
      for (let i = 0; i < 18; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 2.5 + Math.random() * 3.5, (Math.random() - 0.5) * 1.2);
        this.alpha.spawn({ pos, vel: v, size: 0.03 + Math.random() * 0.04, life: 0.6 + Math.random() * 0.4, color: s.dust, alpha: 0.8, gravity: 9.8 });
      }
      this.alpha.spawn({ pos, size: 0.15, grow: 1.2, life: 0.5, color: [0.9, 0.95, 1], alpha: 0.5 });
      return;
    }
    for (let i = 0; i < 6; i++) {
      const v = normal.clone().multiplyScalar(0.8 + Math.random() * 1.5).add(new THREE.Vector3().randomDirection().multiplyScalar(0.6));
      this.alpha.spawn({ pos, vel: v, size: 0.05 + Math.random() * 0.05, grow: 0.7, life: 0.9 + Math.random() * 0.9, color: s.dust, alpha: 0.55, drag: 2.5, gravity: 0.3 });
    }
    for (let i = 0; i < 10; i++) {
      const v = refl.clone().lerp(normal, 0.5).multiplyScalar(2 + Math.random() * 4).add(new THREE.Vector3().randomDirection().multiplyScalar(1.8));
      this.alpha.spawn({ pos, vel: v, size: 0.008 + Math.random() * 0.012, life: 0.5 + Math.random() * 0.5, color: s.chunks, alpha: 1, gravity: 9.8, fade: 0 });
    }
    // solid bits that fly, bounce and settle
    const bits = DEBRIS[surface];
    if (bits) {
      for (let i = 0; i < bits.n; i++) {
        const v = refl.clone().lerp(normal, 0.6).multiplyScalar(1.5 + Math.random() * 3).add(new THREE.Vector3().randomDirection().multiplyScalar(1.2));
        const c = bits.color;
        const tint = 0.8 + Math.random() * 0.35;
        this.debris.spawn(pos.clone().addScaledVector(normal, 0.03), v, { kind: bits.kind, size: bits.size * (0.6 + Math.random() * 0.8), color: [c[0] * tint, c[1] * tint, c[2] * tint] });
      }
    }
    if (s.sparks) {
      for (let i = 0; i < 9; i++) {
        const v = refl.clone().multiplyScalar(4 + Math.random() * 8).add(new THREE.Vector3().randomDirection().multiplyScalar(3));
        this.add.spawn({ pos, vel: v, size: 0.006, stretch: 0.06, life: 0.15 + Math.random() * 0.3, color: [40, 18, 5], gravity: 9.8 });
      }
      this.add.spawn({ pos: pos.clone().addScaledVector(normal, 0.02), size: 0.06, life: 0.05, color: [25, 15, 6] });
    }
  }

  ejectCasing(pos, right, up) {
    if (this.casings.length >= this.casingMax) this.casings.shift();
    const v = right.clone().multiplyScalar(1.8 + Math.random()).addScaledVector(up, 2 + Math.random()).add(new THREE.Vector3().randomDirection().multiplyScalar(0.4));
    this.casings.push({
      p: pos.clone(), v, rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      w: new THREE.Vector3().randomDirection().multiplyScalar(25), age: 0, rest: false, bounces: 0,
    });
  }

  /** A hole where a round struck a wall, the ground or a prop (not a moving car or a body). */
  bulletHole(at, normal, surface) {
    this.holes.add(at, normal, surface);
  }

  update(dt) {
    this.skids.update(dt);
    this.debris.update(dt);
    this.add.update(dt);
    this.alpha.update(dt);
    this.blood.update(dt);
    this.decals.update(dt);
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.flash <= 0) this.pipeline.flashLight.intensity = 0;
    }
    const sky = this.pipeline.night;
    this.uniforms.uAmbient.value.set(0.3, 0.33, 0.38).multiplyScalar(1 - sky * 0.95);

    let n = 0;
    this.casings = this.casings.filter((c) => (c.age += dt) < 12);
    for (const c of this.casings) {
      if (!c.rest) {
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        c.rot.addScaledVector(c.w, dt);
        const h = this.terrain.heightAt(c.p.x, c.p.z) + 0.004;
        if (c.p.y < h) {
          c.p.y = h;
          if (c.p.y < 0) { c.rest = true; c.age = 11.5; }
          c.bounces++;
          c.v.y = Math.abs(c.v.y) * 0.35;
          c.v.x *= 0.5; c.v.z *= 0.5;
          c.w.multiplyScalar(0.5);
          if (c.v.lengthSq() < 0.1) { c.rest = true; c.rot.x = Math.PI / 2 * Math.round(c.rot.x / (Math.PI / 2)); c.rot.z = 0; }
        }
      }
      this._e.set(c.rot.x, c.rot.y, c.rot.z);
      this._m.compose(c.p, this._q.setFromEuler(this._e), this._s);
      this.casingMesh.setMatrixAt(n++, this._m);
    }
    this.casingMesh.count = n;
    this.casingMesh.instanceMatrix.needsUpdate = true;
  }
}
