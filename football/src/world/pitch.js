import * as THREE from 'three';
import { PITCH, SURROUND } from './dims.js';

// Markings are signed-distance fields evaluated per pixel, so the 12 cm lines
// stay crisp and alias-free from the broadcast gantry 60 m away.
const markingsGLSL = /* glsl */ `
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float pitchLines(vec2 p) {
  const float HL = ${PITCH.halfLength.toFixed(3)};
  const float HW = ${PITCH.halfWidth.toFixed(3)};
  const float LW = ${(PITCH.line * 0.5).toFixed(3)};
  float d = abs(sdBox(p, vec2(HL - LW, HW - LW)));
  if (abs(p.y) < HW) d = min(d, abs(p.x));
  d = min(d, abs(length(p) - ${PITCH.centerCircle.toFixed(3)}));
  d = min(d, length(p) - 0.1);
  float s = p.x > 0.0 ? 1.0 : -1.0;
  vec2 q = vec2(p.x * s, p.y);
  float pd = ${PITCH.penaltyDepth.toFixed(3)};
  float pw = ${PITCH.penaltyHalfWidth.toFixed(3)};
  float gd = ${PITCH.goalAreaDepth.toFixed(3)};
  float gw = ${PITCH.goalAreaHalfWidth.toFixed(3)};
  d = min(d, abs(sdBox(q - vec2(HL - pd * 0.5 - LW * 0.5, 0.0), vec2(pd * 0.5 - LW * 0.5, pw))));
  d = min(d, abs(sdBox(q - vec2(HL - gd * 0.5 - LW * 0.5, 0.0), vec2(gd * 0.5 - LW * 0.5, gw))));
  vec2 spot = vec2(HL - ${PITCH.penaltySpot.toFixed(3)}, 0.0);
  d = min(d, length(q - spot) - 0.1);
  if (q.x < HL - pd) d = min(d, abs(length(q - spot) - ${PITCH.centerCircle.toFixed(3)}));
  vec2 c = vec2(HL - LW, (HW - LW) * (p.y > 0.0 ? 1.0 : -1.0));
  vec2 cq = vec2(q.x, p.y);
  if (cq.x < c.x && abs(cq.y) < abs(c.y)) d = min(d, abs(length(cq - c) - ${PITCH.cornerArc.toFixed(3)}));
  return d - LW;
}
`;

const pitchPars = /* glsl */ `
uniform sampler2D tGrass;
uniform sampler2D tGrassNor;
uniform float uStripeW;
varying vec2 vPitch;
varying vec3 vPitchWorld;
float pHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float pNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1, 0)), u.x), mix(pHash(i + vec2(0, 1)), pHash(i + vec2(1, 1)), u.x), u.y);
}
float pFbm(vec2 p) { return pNoise(p) * 0.5 + pNoise(p * 2.1 + 3.7) * 0.3 + pNoise(p * 4.3 + 9.1) * 0.2; }
${markingsGLSL}
`;

const pitchMap = /* glsl */ `
vec2 P = vPitch;
float HL = ${PITCH.halfLength.toFixed(2)};
float HW = ${PITCH.halfWidth.toFixed(2)};

// Grass: hue from a curated palette, texture only supplies blade-scale detail.
vec3 gA = textureLod(tGrass, P * 0.55, 0.0).rgb;
vec3 gB = texture(tGrass, P * 0.13 + 0.37).rgb;
float det = dot(gA, vec3(0.3, 0.55, 0.15)) / 0.22;
float det2 = dot(gB, vec3(0.3, 0.55, 0.15)) / 0.22;
det = mix(1.0, clamp(det, 0.55, 1.5), 0.45) * mix(1.0, clamp(det2, 0.6, 1.4), 0.25);
vec3 grass = vec3(0.052, 0.155, 0.026);
float big = pFbm(P * 0.045);
grass *= mix(0.86, 1.12, big);
grass = mix(grass, grass * vec3(1.12, 1.0, 0.8), smoothstep(0.55, 0.8, pFbm(P * 0.11 + 5.0)) * 0.5);

// Mowing stripes: blades lean alternately along +X/-X, so how bright a band
// looks depends on whether the camera sees it with or against the grain.
float inside = 1.0 - smoothstep(HL + 3.0, HL + 3.6, abs(P.x)) * 1.0;
inside *= 1.0 - smoothstep(HW + 3.0, HW + 3.6, abs(P.y));
float sx = (P.x + HL) / uStripeW;
float fx = fract(sx);
float aaS = fwidth(sx) * 1.5 + 1e-4;
float lean = fx < 0.5 ? -1.0 : 1.0;
float edgeBlend = min(min(fx, 1.0 - fx), abs(fx - 0.5));
lean *= smoothstep(0.0, max(aaS, 0.004), edgeBlend);
vec3 V = normalize(cameraPosition - vPitchWorld);
float grain = 0.075 * lean + 0.12 * lean * V.x;
float sz = (P.y + HW) / 6.8;
float leanZ = fract(sz) < 0.5 ? -1.0 : 1.0;
grain += 0.025 * leanZ + 0.035 * leanZ * V.z;
grass *= 1.0 + grain * inside;

// Wear in the goalmouths and centre circle.
float wear = 0.0;
wear += (1.0 - smoothstep(0.0, 6.0, length((vec2(abs(P.x), P.y) - vec2(HL - 2.5, 0.0)) * vec2(1.0, 0.6))));
wear += (1.0 - smoothstep(0.0, 3.0, length(vec2(abs(P.x), P.y) - vec2(HL - 11.0, 0.0)))) * 0.6;
wear += (1.0 - smoothstep(0.0, 5.0, length(P))) * 0.35;
wear *= smoothstep(0.35, 0.75, pFbm(P * 0.9) + wear * 0.25);
grass = mix(grass, vec3(0.11, 0.12, 0.045), clamp(wear, 0.0, 0.7));

// Beyond the boards: tired, unstriped turf.
float outer = smoothstep(HL + 5.0, HL + 6.0, abs(P.x)) + smoothstep(HW + 5.0, HW + 5.6, abs(P.y));
grass = mix(grass, vec3(0.045, 0.095, 0.03) * mix(0.8, 1.1, big), clamp(outer, 0.0, 1.0));
grass *= det;

float dl = pitchLines(P);
float aa = max(fwidth(P.x), fwidth(P.y)) * 0.8 + 1e-4;
// Box-filtered coverage: far away a line covers only part of a pixel.
float lw = ${(PITCH.line * 0.5).toFixed(3)};
float cl = max(dl + lw, 0.0);
float paint = clamp((min(cl + lw, aa) - max(cl - lw, -aa)) / (2.0 * aa), 0.0, 1.0);
vec3 lineCol = vec3(0.68, 0.72, 0.66) * mix(0.85, 1.0, det);
diffuseColor.rgb = mix(grass, lineCol, paint);
vPaint = paint;
`;

export function buildPitch(textures) {
  const size = { x: (PITCH.halfLength + SURROUND.standEnd + 2) * 2, z: (PITCH.halfWidth + SURROUND.standSide + 2) * 2 };
  const geo = new THREE.PlaneGeometry(size.x, size.z, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size.x / 1.7, uv.getY(i) * size.z / 1.7);
  const nor = textures.grassNor;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0,
    normalMap: nor,
    normalScale: new THREE.Vector2(0.35, 0.35),
    envMapIntensity: 0.6,
  });
  const uniforms = {
    tGrass: { value: textures.grassDiff },
    tGrassNor: { value: nor },
    uStripeW: { value: (PITCH.halfLength * 2) / 20 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec2 vPitch;\nvarying vec3 vPitchWorld;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvec4 pw = modelMatrix * vec4(transformed, 1.0);\nvPitch = pw.xz;\nvPitchWorld = pw.xyz;',
    );
    shader.fragmentShader = pitchPars + 'float vPaint = 0.0;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', pitchMap)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.9, vPaint);');
  };
  mat.customProgramCacheKey = () => 'pitch-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'pitch';
  return mesh;
}
