import * as THREE from 'three';

// The fireball of an explosion: a sphere pushed out by animated 3D noise, coloured from
// white-hot through orange to soot by noise and age, written as HDR so bloom picks it
// up. It swells in a third of a second, then cools into a dark billow and fades.

const vert = /* glsl */ `
uniform float uT;
uniform float uSeed;
varying vec3 vN;
varying float vNoise;
varying vec3 vView;
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(hash3(i), f), dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}
void main() {
  vec3 p = position;
  float n = fbm(normal * 1.7 + vec3(0.0, -uT * 2.2, uSeed));
  vNoise = n;
  p += normal * n * 0.55;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform float uAge;   // 0..1 over the fireball's life
uniform float uFade;
varying vec3 vN;
varying float vNoise;
varying vec3 vView;
void main() {
  float heat = clamp(1.0 - uAge * 1.6 + vNoise * 0.9, 0.0, 1.0);
  vec3 soot = vec3(0.035, 0.03, 0.028);
  vec3 orange = vec3(9.0, 3.2, 0.6);
  vec3 white = vec3(26.0, 18.0, 9.0);
  vec3 col = heat > 0.55 ? mix(orange, white, (heat - 0.55) / 0.45) : mix(soot, orange, heat / 0.55);
  // rim darker and thinner, like the edge of a billow
  float rim = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
  col *= 0.55 + 0.45 * rim;
  float a = uFade * smoothstep(0.0, 0.35, rim + vNoise * 0.4) * (0.6 + 0.4 * heat);
  gl_FragColor = vec4(col, a);
}`;

export const fireballShaders = { vert, frag };
const LIFE = 1.6;

export class Fireballs {
  constructor(scene, count = 4) {
    const geo = new THREE.IcosahedronGeometry(1, 4);
    this.items = Array.from({ length: count }, () => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
        uniforms: { uT: { value: 0 }, uSeed: { value: 0 }, uAge: { value: 0 }, uFade: { value: 0 } },
      });
      // keep the scene depth the HDR target stores in alpha (engine/patch.js)
      mat.blending = THREE.CustomBlending;
      mat.blendSrcAlpha = THREE.ZeroFactor;
      mat.blendDstAlpha = THREE.OneFactor;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, mat, t: LIFE, size: 1 };
    });
    this.next = 0;
  }

  spawn(pos, size = 2.6) {
    const f = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    f.t = 0;
    f.size = size;
    f.mesh.position.copy(pos);
    f.mat.uniforms.uSeed.value = Math.random() * 100;
    f.mesh.visible = true;
  }

  update(dt) {
    for (const f of this.items) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      const age = f.t / LIFE;
      if (age >= 1) { f.mesh.visible = false; continue; }
      // fast swell, slow rise and spread as it cools
      const grow = 1 - Math.pow(1 - Math.min(1, f.t / 0.35), 3);
      const s = f.size * (0.25 + 0.75 * grow) * (1 + age * 0.6);
      f.mesh.scale.set(s, s * (0.85 + age * 0.3), s);
      f.mesh.position.y += dt * (0.4 + age * 1.6);
      const u = f.mat.uniforms;
      u.uT.value = f.t;
      u.uAge.value = age;
      u.uFade.value = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
    }
  }
}
