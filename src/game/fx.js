import * as THREE from 'three';

const particleVert = /* glsl */ `
attribute vec4 iPos;
attribute vec4 iColor;
attribute vec4 iVel;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = position.xy;
  vColor = iColor;
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
uniform vec3 uLight;
uniform vec3 uAmbient;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  #ifdef ADDITIVE
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
  constructor(max, additive, uniforms) {
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
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms,
      defines: additive ? { ADDITIVE: 1 } : {},
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
    });
  }

  update(dt) {
    const P = this.pos.array, C = this.col.array, V = this.vel.array;
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
      }
      const t = p.age / p.life;
      const a = p.a * (p.fade ? 1 - t : 1) * (p.grow > 0 ? Math.min(1, 0.3 + p.age * 20) : 1);
      P.set([p.x, p.y, p.z, p.size], n * 4);
      C.set([p.r, p.g, p.b, a], n * 4);
      V.set([p.vx, p.vy, p.vz, p.stretch], n * 4);
      n++;
    }
    this.p = alive;
    this.geo.instanceCount = n;
    for (const at of [this.pos, this.col, this.vel]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * 4);
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
};

export class Effects {
  constructor(pipeline, terrain, audio) {
    this.pipeline = pipeline;
    this.terrain = terrain;
    this.audio = audio;
    const uniforms = { uLight: { value: pipeline.lightColor }, uAmbient: { value: new THREE.Vector3(0.3, 0.33, 0.38) } };
    this.uniforms = uniforms;
    this.add = new ParticlePool(800, true, uniforms);
    this.alpha = new ParticlePool(1200, false, uniforms);
    pipeline.fxScene.add(this.add.mesh, this.alpha.mesh);

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

  muzzle(pos, dir) {
    const add = this.add;
    const tip = pos.clone().addScaledVector(dir, 0.02);
    add.spawn({ pos: tip, size: 0.16 + Math.random() * 0.06, life: 0.07, color: [70, 42, 15], fade: 1 });
    add.spawn({ pos: tip.clone().addScaledVector(dir, 0.14), vel: dir.clone().multiplyScalar(0.01), size: 0.05, stretch: 0.16, life: 0.06, color: [90, 55, 20] });
    for (let i = 0; i < 4; i++) {
      const d = dir.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.6)).normalize();
      add.spawn({ pos: tip.clone().addScaledVector(d, 0.06), vel: d.multiplyScalar(0.01), size: 0.025, stretch: 0.07, life: 0.05, color: [60, 34, 12] });
    }
    for (let i = 0; i < 6; i++) {
      this.alpha.spawn({
        pos: tip.clone().addScaledVector(dir, 0.04 * i),
        vel: dir.clone().multiplyScalar(1.5 + Math.random() * 1.5).add(new THREE.Vector3(0, 0.35, 0)).add(new THREE.Vector3().randomDirection().multiplyScalar(0.3)),
        size: 0.05, grow: 0.6, life: 0.8 + Math.random() * 0.6, color: [0.62, 0.62, 0.64], alpha: 0.3, drag: 3,
      });
    }
    const fl = this.pipeline.flashLight;
    fl.position.copy(tip);
    fl.intensity = 160;
    this.flash = 0.06;
  }

  tracer(from, to) {
    const d = new THREE.Vector3().subVectors(to, from);
    const len = d.length();
    if (len < 2) return;
    d.divideScalar(len);
    const speed = 380;
    this.add.spawn({
      pos: from.clone().addScaledVector(d, 1.25), vel: d.clone().multiplyScalar(speed), size: 0.012, stretch: 1.2,
      life: Math.max(0.02, (len - 2) / speed), color: [30, 20, 9], fade: 0,
    });
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

  update(dt) {
    this.add.update(dt);
    this.alpha.update(dt);
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
          if (c.v.y < -0.6 && c.bounces < 4) this.audio.casing();
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
