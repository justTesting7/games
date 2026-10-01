import * as THREE from 'three';

// Heat haze: the air over a fire shimmers. Each source is an upright quad turned to the
// camera that redraws the scene behind it (the opaque copy the water pass also reads)
// through rising, flowing noise, strongest low down and fading to the edges. Sources are
// added each frame by the game; the colour blend leaves the depth in alpha alone.

const POOL = 8;

const vert = /* glsl */ `
uniform vec2 uSize; // width, height in metres
varying vec2 vUv;
varying float vDepth;
void main() {
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 to = vec3(cameraPosition.x - c.x, 0.0, cameraPosition.z - c.z);
  to = length(to) > 1e-4 ? normalize(to) : vec3(0.0, 0.0, 1.0);
  vec3 right = vec3(to.z, 0.0, -to.x);
  vec3 p = c + right * position.x * uSize.x + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * uSize.y;
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uTime;
uniform float uK;
varying vec2 vUv;
varying float vDepth;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  // the hot column: widest and strongest just above the fire, gone by the top
  float mask = sin(3.14159 * vUv.x) * pow(1.0 - vUv.y, 0.8) * smoothstep(0.0, 0.12, vUv.y);
  vec2 q = vec2(vUv.x * 5.0, vUv.y * 4.0 - uTime * 2.6);
  vec2 n = vec2(vn(q) + 0.5 * vn(q * 2.1 + 5.0), vn(q + 11.3) + 0.5 * vn(q * 2.3 + 17.0)) / 1.5 - 0.5;
  vec2 suv = gl_FragCoord.xy / uRes + n * mask * uK * 0.09 / max(vDepth, 2.0);
  gl_FragColor = vec4(texture(uScene, suv).rgb, 1.0);
}`;

export const hazeShaders = { vert, frag };

export class Haze {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.items = Array.from({ length: POOL }, () => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, depthWrite: false, transparent: true,
        uniforms: { uScene: { value: null }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uK: { value: 0 }, uSize: { value: new THREE.Vector2(1, 1) } },
      });
      // replace the colour behind, keep the scene depth stored in alpha (engine/patch.js)
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.ZeroFactor;
      mat.blendSrcAlpha = THREE.ZeroFactor;
      mat.blendDstAlpha = THREE.OneFactor;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      return { mesh, mat };
    });
    this.n = 0;
  }

  /** One frame's source: the base of the hot air at pos, w x h metres, strength k 0..1. */
  add(pos, w, h, k) {
    if (this.n >= POOL || k <= 0.01) return;
    const it = this.items[this.n++];
    it.mesh.position.copy(pos);
    it.mat.uniforms.uSize.value.set(w, h);
    it.mat.uniforms.uK.value = Math.min(1.5, k);
  }

  /** Before the pass that draws them: show this frame's sources, then start a new list. */
  flush(sceneTex, w, h, time) {
    this.items.forEach((it, i) => {
      it.mesh.visible = i < this.n;
      if (!it.mesh.visible) return;
      const u = it.mat.uniforms;
      u.uScene.value = sceneTex;
      u.uRes.value.set(w, h);
      u.uTime.value = time;
    });
    this.n = 0;
  }
}

// A blast's shockwave: a ring of compressed air racing out from the centre, bending the
// scene behind it outward as it passes. A camera-facing quad per blast, drawn like the haze.
const waveVert = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
varying float vDepth;
void main() {
  vec4 c = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 mv = c + vec4(position.xy * uSize, 0.0, 0.0);
  vUv = position.xy * 2.0; // -1..1 across the quad
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const waveFrag = /* glsl */ `
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uR;   // ring radius, 0..1 of the quad
uniform float uK;   // strength
varying vec2 vUv;
varying float vDepth;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float band = (r - uR) / 0.07;
  float ring = exp(-band * band) * sign(band + 0.0001) * -1.0; // pushes out ahead of the front, in behind it
  vec2 dir = r > 1e-4 ? vUv / r : vec2(0.0);
  vec2 suv = gl_FragCoord.xy / uRes + dir * ring * uK * 0.6 / max(vDepth, 3.0);
  gl_FragColor = vec4(texture(uScene, suv).rgb, 1.0);
}`;

export const waveShaders = { vert: waveVert, frag: waveFrag };

export class Shockwaves {
  constructor(scene, count = 4) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.items = Array.from({ length: count }, () => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: waveVert, fragmentShader: waveFrag, depthWrite: false, transparent: true,
        uniforms: { uScene: { value: null }, uRes: { value: new THREE.Vector2() }, uR: { value: 0 }, uK: { value: 0 }, uSize: { value: 1 } },
      });
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.ZeroFactor;
      mat.blendSrcAlpha = THREE.ZeroFactor;
      mat.blendDstAlpha = THREE.OneFactor;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      return { mesh, mat, t: 1, max: 14 };
    });
    this.next = 0;
  }

  spawn(pos, max = 14) {
    const w = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    w.mesh.position.copy(pos);
    w.t = 0;
    w.max = max;
  }

  /** Before the pass that draws them. */
  flush(dt, sceneTex, w, h) {
    for (const it of this.items) {
      it.t += dt;
      const life = 0.45, a = it.t / life;
      it.mesh.visible = a < 1;
      if (!it.mesh.visible) continue;
      const u = it.mat.uniforms;
      u.uSize.value = it.max * 2;
      u.uR.value = 1 - Math.pow(1 - a, 2.2); // fast out, slowing
      u.uK.value = (1 - a) * 1.6;
      u.uScene.value = sceneTex;
      u.uRes.value.set(w, h);
    }
  }
}
