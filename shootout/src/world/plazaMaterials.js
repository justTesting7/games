import * as THREE from 'three';
import { skyCommon } from '../engine/shaders.js';

const TRANSPARENT = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};

const noiseGLSL = /* glsl */ `
float pHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.37, 0.71));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float pNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(pHash(i), pHash(i + vec3(1, 0, 0)), f.x),
        mix(pHash(i + vec3(0, 1, 0)), pHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(pHash(i + vec3(0, 0, 1)), pHash(i + vec3(1, 0, 1)), f.x),
        mix(pHash(i + vec3(0, 1, 1)), pHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float pFbm(vec3 p) {
  float a = 0.0, w = 0.5;
  for (int i = 0; i < 5; i++) { a += w * pNoise(p); p *= 2.07; w *= 0.5; }
  return a;
}
vec2 pHash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
`;

function injectSpace(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', 'varying vec3 vWorldPos;\nvarying vec3 vLocalPos;\n#include <common>')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = transformed;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `varying vec3 vWorldPos;\nvarying vec3 vLocalPos;\n${noiseGLSL}\n#include <common>`);
}

function pipeUniforms(pipeline) {
  return pipeline?.u || {
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uLightColor: { value: new THREE.Vector3(1, 0.95, 0.85) },
    uSkyTex: { value: null },
  };
}

function patchStandard(material, key, apply) {
  material.onBeforeCompile = (shader) => {
    injectSpace(shader);
    apply(shader);
  };
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return material;
}

export function makeMarble(tint = 0xd8d2c6) {
  const mat = new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.32, metalness: 0.04, envMapIntensity: 0.85,
  });
  return patchStandard(mat, 'plaza-marble', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  vec3 p = vWorldPos * 1.35 + vLocalPos * 0.25;
  float n = pFbm(p * vec3(1.1, 2.4, 1.0));
  float warp = pFbm(p * 0.55 + n);
  float vein = abs(sin(p.x * 1.7 + p.y * 0.35 + p.z * 0.9 + warp * 6.5));
  vein = smoothstep(0.12, 0.72, pow(vein, 7.0));
  float dust = pFbm(p * 4.2);
  vec3 cream = diffuseColor.rgb;
  vec3 grey = cream * vec3(0.55, 0.52, 0.5);
  diffuseColor.rgb = mix(cream * mix(0.92, 1.08, dust), grey, vein * 0.85);
}
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + pFbm(vWorldPos * 3.0) * 0.18 - 0.04, 0.14, 0.7);
`);
  });
}

export function makeBronze(tint = 0x6a4320, patina = 0.55) {
  const mat = new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.38, metalness: 0.82, envMapIntensity: 1.15,
  });
  return patchStandard(mat, `plaza-bronze-${patina.toFixed(2)}`, (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  float wear = pFbm(vWorldPos * 2.6);
  float crease = pFbm(vLocalPos * 5.5);
  float heightBias = clamp(0.55 - vLocalPos.y * 0.12, 0.0, 1.0);
  float pat = smoothstep(0.28, 0.78, wear * 0.7 + heightBias * 0.45 + crease * 0.2);
  pat *= ${patina.toFixed(3)};
  vec3 oxide = vec3(0.16, 0.38, 0.32);
  vec3 polish = diffuseColor.rgb * vec3(1.15, 1.05, 0.85);
  diffuseColor.rgb = mix(polish, mix(diffuseColor.rgb, oxide, 0.72), pat);
}
`)
      .replace('#include <metalnessmap_fragment>', /* glsl */ `
#include <metalnessmap_fragment>
float pWear = pFbm(vWorldPos * 2.6);
metalnessFactor = mix(metalnessFactor, 0.22, smoothstep(0.4, 0.8, pWear) * ${patina.toFixed(3)});
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(0.22, 0.62, pFbm(vWorldPos * 3.1));
`);
  });
}

export function makeLimestone(tint = 0x9a9284) {
  const mat = new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.78, metalness: 0.03, envMapIntensity: 0.35,
  });
  return patchStandard(mat, 'plaza-limestone', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  float grain = pFbm(vWorldPos * 4.8);
  float pit = smoothstep(0.7, 0.9, pFbm(vWorldPos * 9.0));
  float stain = pFbm(vWorldPos * 0.55 + vec3(2.0, 0.0, 7.0));
  diffuseColor.rgb *= mix(0.78, 1.12, grain);
  diffuseColor.rgb *= 1.0 - pit * 0.28;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.78, 0.7), stain * 0.22);
}
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(0.62, 0.95, pFbm(vWorldPos * 5.0)), 0.4, 1.0);
`);
  });
}

export function makeGranite(tint = 0x5a5550) {
  const mat = new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.55, metalness: 0.08, envMapIntensity: 0.45,
  });
  return patchStandard(mat, 'plaza-granite', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  float speckle = pNoise(vWorldPos * 18.0);
  float band = abs(sin(vLocalPos.y * 9.0 + pFbm(vWorldPos * 1.4) * 3.0));
  band = smoothstep(0.75, 0.95, band);
  float flake = step(0.82, pNoise(vWorldPos * 28.0));
  diffuseColor.rgb = mix(diffuseColor.rgb * mix(0.7, 1.15, speckle), vec3(0.22, 0.2, 0.18), band * 0.55);
  diffuseColor.rgb += vec3(0.08, 0.07, 0.05) * flake;
}
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(0.4, 0.78, pFbm(vWorldPos * 6.0));
`);
  });
}

export function makeCobble() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7a7368, roughness: 0.82, metalness: 0.04, envMapIntensity: 0.25,
  });
  return patchStandard(mat, 'plaza-cobble', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  vec2 uv = vWorldPos.xz * 2.15;
  vec2 n = floor(uv), f = fract(uv);
  float md = 8.0;
  vec2 winner = n;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = pHash2(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; winner = n + g; }
  }
  float grout = 1.0 - smoothstep(0.035, 0.11, sqrt(md));
  float tone = pHash(vec3(winner, 3.7));
  vec3 stone = mix(vec3(0.38, 0.34, 0.28), vec3(0.62, 0.58, 0.5), tone);
  stone = mix(stone, vec3(0.48, 0.4, 0.3), pHash(vec3(winner, 9.1)) * 0.35);
  vec3 mud = vec3(0.22, 0.2, 0.16);
  diffuseColor.rgb = mix(stone, mud, grout);
}
`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 uv = vWorldPos.xz * 2.15;
  vec2 n = floor(uv), f = fract(uv);
  float md = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = pHash2(n + g);
    md = min(md, dot(g + o - f, g + o - f));
  }
  float grout = 1.0 - smoothstep(0.03, 0.12, sqrt(md));
  normal = normalize(normal + vec3((f.x - 0.5) * grout, 0.0, (f.y - 0.5) * grout) * 1.8);
}
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(0.7, 0.95, pFbm(vWorldPos * 4.0));
`);
  });
}

const waveGLSL = /* glsl */ `
float fountainWave(vec2 p, float t) {
  float h = 0.0;
  h += sin(dot(p, vec2(3.1, 1.7)) + t * 2.3) * 0.011;
  h += sin(dot(p, vec2(-2.4, 2.8)) - t * 1.7) * 0.008;
  h += sin(dot(p, vec2(5.4, -3.2)) + t * 3.4) * 0.004;
  h += sin(length(p) * 9.0 - t * 2.8) * 0.006;
  return h;
}
vec3 fountainNormal(vec2 p, float t) {
  float e = 0.035;
  float h = fountainWave(p, t);
  return normalize(vec3(
    -(fountainWave(p + vec2(e, 0.0), t) - h) / e,
    1.0,
    -(fountainWave(p + vec2(0.0, e), t) - h) / e
  ));
}
`;

export function makeFountainWater(pipeline, { radius, deep, shallow }) {
  const u = pipeUniforms(pipeline);
  return new THREE.ShaderMaterial({
    uniforms: {
      uSkyTex: u.uSkyTex,
      uTime: u.uTime,
      uLightDir: u.uLightDir,
      uLightColor: u.uLightColor,
      uRadius: { value: radius },
      uDeep: { value: new THREE.Color(deep) },
      uShallow: { value: new THREE.Color(shallow) },
    },
    vertexShader: /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vRad;
${waveGLSL}
void main() {
  vec3 pos = position;
  pos.y += fountainWave(pos.xz, uTime);
  vRad = length(pos.xz);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`,
    fragmentShader: /* glsl */ `
${skyCommon}
${waveGLSL}
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uTime;
uniform float uRadius;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec3 vWorld;
varying float vRad;

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = fountainNormal(vWorld.xz, uTime);
  float ndv = max(dot(N, V), 0.0);
  float F = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);

  vec3 R = reflect(-V, N);
  if (R.y < 0.0) R.y = -R.y * 0.35;
  vec3 skyR = skyRadiance(R);
  vec3 skyA = skyIrradiance(N);

  float rim = smoothstep(uRadius * 0.62, uRadius * 0.98, vRad);
  vec3 body = mix(uDeep, uShallow, rim * 0.85 + ndv * 0.15);
  body *= skyA * 0.55 + 0.18;

  float cau = abs(sin(vWorld.x * 14.0 + uTime * 1.7) * sin(vWorld.z * 12.5 - uTime * 1.35));
  cau *= abs(sin((vWorld.x + vWorld.z) * 7.0 - uTime * 0.9));
  body += vec3(0.22, 0.32, 0.3) * cau * (1.0 - rim) * 0.45;

  vec3 H = normalize(uLightDir + V);
  float spec = pow(max(dot(N, H), 0.0), 420.0) * 14.0 + pow(max(dot(N, H), 0.0), 80.0) * 0.55;
  vec3 col = mix(body, skyR, F) + uLightColor * spec * step(0.0, uLightDir.y);

  float n = 0.5 + 0.5 * sin(vRad * 28.0 - uTime * 4.0 + fountainWave(vWorld.xz * 3.0, uTime) * 40.0);
  float foam = rim * smoothstep(0.35, 0.9, n);
  foam = max(foam, smoothstep(uRadius * 0.96, uRadius, vRad));
  vec3 foamCol = (skyA * 1.1 + uLightColor * 0.25) * 0.92;
  col = mix(col, foamCol, foam * 0.88);

  gl_FragColor = vec4(col, mix(0.72, 0.94, F + foam * 0.2));
}
`,
    ...TRANSPARENT,
    side: THREE.DoubleSide,
  });
}

export function makeFallingWater(pipeline) {
  const u = pipeUniforms(pipeline);
  return new THREE.ShaderMaterial({
    uniforms: {
      uSkyTex: u.uSkyTex,
      uTime: u.uTime,
      uLightDir: u.uLightDir,
      uLightColor: u.uLightColor,
    },
    vertexShader: /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`,
    fragmentShader: /* glsl */ `
${skyCommon}
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uTime;
varying vec3 vWorld;
varying vec2 vUv;

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vec3(vWorld.x, 0.15, vWorld.z));
  float ndv = max(dot(abs(N), V), 0.0);
  float F = 0.08 + 0.75 * pow(1.0 - ndv, 3.0);

  float flow = fract(vUv.y * 7.0 - uTime * 2.6);
  float streak = smoothstep(0.0, 0.18, flow) * smoothstep(1.0, 0.55, flow);
  float bands = 0.45 + 0.55 * pow(abs(sin(vUv.x * 28.0 + uTime * 1.4)), 1.4);
  float spray = 0.6 + 0.4 * sin(vUv.y * 40.0 + uTime * 8.0 + vUv.x * 18.0);
  float a = mix(0.16, 0.62, streak) * bands * spray;
  a *= smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.82, vUv.y);

  vec3 skyR = skyRadiance(reflect(-V, vec3(0.0, 1.0, 0.0)));
  vec3 col = mix(vec3(0.42, 0.62, 0.72), vec3(0.82, 0.9, 0.96), F);
  col = mix(col, skyR, F * 0.45);
  col += uLightColor * pow(max(dot(normalize(uLightDir + V), vec3(0.0, 1.0, 0.0)), 0.0), 80.0) * 0.6;
  gl_FragColor = vec4(col, a);
}
`,
    ...TRANSPARENT,
    side: THREE.DoubleSide,
  });
}

export function makeCaustics(pipeline) {
  const u = pipeUniforms(pipeline);
  return new THREE.ShaderMaterial({
    uniforms: { uTime: u.uTime, uLightDir: u.uLightDir, uLightColor: u.uLightColor },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 0.98) discard;
  float t = uTime;
  float c = 0.0;
  c += abs(sin(p.x * 11.0 + t * 1.6) * sin(p.y * 9.0 - t * 1.3));
  c *= abs(sin((p.x + p.y) * 8.0 + t * 0.8) * sin((p.x - p.y) * 7.0 - t));
  c = pow(c, 1.35);
  float fade = 1.0 - smoothstep(0.55, 0.98, r);
  float sun = max(uLightDir.y, 0.0);
  vec3 col = uLightColor * vec3(0.55, 0.75, 0.85) * c * fade * sun;
  gl_FragColor = vec4(col, c * fade * 0.45 * sun);
}
`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

export function makeWetStone(tint = 0x4a463e) {
  return new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.22, metalness: 0.18, envMapIntensity: 1.1,
  });
}

export { TRANSPARENT };
