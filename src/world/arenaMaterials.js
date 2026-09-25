import * as THREE from 'three';

const noiseGLSL = /* glsl */ `
float aHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.37, 0.71));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float aNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(aHash(i), aHash(i + vec3(1, 0, 0)), f.x),
        mix(aHash(i + vec3(0, 1, 0)), aHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(aHash(i + vec3(0, 0, 1)), aHash(i + vec3(1, 0, 1)), f.x),
        mix(aHash(i + vec3(0, 1, 1)), aHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float aFbm(vec3 p) {
  float a = 0.0, w = 0.5;
  for (int i = 0; i < 5; i++) { a += w * aNoise(p); p *= 2.07; w *= 0.5; }
  return a;
}
`;

function injectWorld(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', 'varying vec3 vWorldPos;\nvarying vec3 vLocalPos;\n#include <common>')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = transformed;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `varying vec3 vWorldPos;\nvarying vec3 vLocalPos;\n${noiseGLSL}\n#include <common>`);
}

function patch(material, key, apply) {
  material.onBeforeCompile = (shader) => {
    injectWorld(shader);
    apply(shader);
  };
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return material;
}

export function makeHardwood() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc4a06a, roughness: 0.42, metalness: 0.04, envMapIntensity: 0.55,
    emissive: 0x2a1c0c, emissiveIntensity: 0.12,
  });
  return patch(mat, 'msg-hardwood', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  vec2 p = vWorldPos.xz;
  float plank = floor(p.y * 8.2 + aFbm(vec3(p.x * 0.02, 0.0, p.y)) * 0.4);
  float tone = aHash(vec3(plank, 2.7, 1.1));
  float grain = aFbm(vec3(p.x * 3.4, plank * 0.15, p.y * 0.35));
  float seam = 1.0 - smoothstep(0.0, 0.018, abs(fract(p.y * 8.2) - 0.5) - 0.46);
  vec3 light = vec3(0.86, 0.72, 0.48);
  vec3 dark = vec3(0.58, 0.44, 0.26);
  vec3 wood = mix(dark, light, tone * 0.65 + grain * 0.35);
  wood *= mix(0.9, 1.12, grain);
  wood = mix(wood, wood * vec3(0.55, 0.4, 0.22), seam * 0.7);
  diffuseColor.rgb = wood;
}
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = clamp(0.28 + aFbm(vWorldPos * 4.0) * 0.22, 0.22, 0.62);
`);
  });
}

const courtMarkGLSL = /* glsl */ `
float sdBox2(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float stroke(float d, float w) { return 1.0 - smoothstep(0.0, 0.028, abs(d) - w * 0.5); }
float fill(float d) { return 1.0 - smoothstep(0.0, 0.03, d); }

float courtPaint(vec2 p, out float keyMask, out float logo) {
  const float HX = 14.325;
  const float HZ = 7.62;
  const float HOOP = 12.75;
  const float KEYW = 2.44;
  const float KEYD = 5.79;
  const float FT = 1.83;
  const float R3 = 7.24;
  const float CORNER = 6.70;
  float paint = 0.0;
  keyMask = 0.0;
  logo = 0.0;
  float inCourt = fill(sdBox2(p, vec2(HX, HZ)));
  paint = max(paint, stroke(sdBox2(p, vec2(HX, HZ)), 0.05) * inCourt);
  paint = max(paint, stroke(p.x, 0.05) * step(abs(p.y), HZ) * inCourt);
  paint = max(paint, stroke(length(p) - 1.83, 0.05) * inCourt);
  for (int s = -1; s <= 1; s += 2) {
    float hx = float(s) * HOOP;
    vec2 keyC = vec2(float(s) * (HX - KEYD * 0.5), 0.0);
    float key = sdBox2(p - keyC, vec2(KEYD * 0.5, KEYW));
    keyMask = max(keyMask, fill(key) * inCourt);
    paint = max(paint, stroke(key, 0.05) * inCourt);
    vec2 ftC = vec2(float(s) * (HX - KEYD), 0.0);
    float ft = length(p - ftC) - FT;
    float outerHalf = step(float(s) * p.x, float(s) * ftC.x);
    paint = max(paint, stroke(ft, 0.05) * mix(0.35, 1.0, outerHalf) * inCourt);
    paint = max(paint, stroke(length(p - vec2(hx, 0.0)) - 1.22, 0.045) * inCourt);
    float arc = abs(length(p - vec2(hx, 0.0)) - R3);
    float onArc = (1.0 - smoothstep(0.0, 0.03, arc - 0.025))
      * step(abs(p.y), CORNER) * step(abs(p.x), HOOP) * inCourt;
    paint = max(paint, onArc);
    float cLine = (1.0 - smoothstep(0.0, 0.03, abs(abs(p.y) - CORNER) - 0.025))
      * step(10.02, abs(p.x)) * step(abs(p.x), HX) * inCourt;
    paint = max(paint, cLine);
    paint = max(paint, stroke(sdBox2(p - vec2(hx, 0.0), vec2(0.08, 0.08)), 0.04) * inCourt);
  }
  for (int i = 0; i < 8; i++) {
    float t = (float(i) + 1.0) / 9.0;
    float x = mix(-HX + 1.2, HX - 1.2, t);
    paint = max(paint, stroke(sdSeg(p, vec2(x, HZ), vec2(x, HZ - 0.3)), 0.04) * inCourt);
    paint = max(paint, stroke(sdSeg(p, vec2(x, -HZ), vec2(x, -HZ + 0.3)), 0.04) * inCourt);
  }
  float ring = stroke(length(p) - 1.83, 0.18);
  vec2 q = p * 1.2;
  float nStem = min(sdBox2(q - vec2(-0.4, 0.0), vec2(0.08, 0.46)), sdBox2(q - vec2(-0.04, 0.0), vec2(0.08, 0.46)));
  nStem = min(nStem, sdSeg(q, vec2(-0.4, 0.44), vec2(-0.04, -0.44)) - 0.075);
  float yStem = min(sdBox2(q - vec2(0.44, -0.2), vec2(0.08, 0.26)), sdSeg(q, vec2(0.22, 0.44), vec2(0.44, 0.04)) - 0.075);
  yStem = min(yStem, sdSeg(q, vec2(0.66, 0.44), vec2(0.44, 0.04)) - 0.075);
  logo = max(fill(nStem), fill(yStem)) * fill(length(p) - 1.5);
  paint = max(paint, ring * 0.9);
  return paint;
}
`;

function makeCourtDecal() {
  if (typeof document === 'undefined') return null;
  const ppm = 96;
  const HX = 14.325;
  const HZ = 7.62;
  const W = Math.round(HX * 2 * ppm);
  const H = Math.round(HZ * 2 * ppm);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const X = (x) => (x + HX) * ppm;
  const Y = (z) => (z + HZ) * ppm;
  const m = (v) => v * ppm;

  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0a3478';
  g.fillRect(0, 0, m(3.05), H);
  g.fillRect(W - m(3.05), 0, m(3.05), H);

  const paintWord = (word, cx, cy, rot) => {
    g.save();
    g.translate(X(cx), Y(cy));
    g.rotate(rot);
    g.fillStyle = '#f4f2ec';
    g.font = `800 ${Math.round(m(1.02))}px Arial, "Segoe UI", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const letters = word.split('');
    const gap = m(0.08);
    const widths = letters.map((ch) => g.measureText(ch).width);
    let total = widths.reduce((a, b) => a + b, 0) + gap * (letters.length - 1);
    let x = -total * 0.5;
    for (let i = 0; i < letters.length; i++) {
      g.fillText(letters[i], x + widths[i] * 0.5, 0);
      x += widths[i] + gap;
    }
    g.restore();
  };
  paintWord('NEW YORK', -12.8, 0, -Math.PI / 2);
  paintWord('KNICKS', 12.8, 0, Math.PI / 2);

  g.save();
  g.translate(X(0), Y(0));
  g.beginPath();
  g.arc(0, 0, m(1.52), 0, Math.PI * 2);
  g.fillStyle = '#f58426';
  g.fill();
  g.beginPath();
  g.arc(0, 0, m(1.28), 0, Math.PI * 2);
  g.fillStyle = '#0a3478';
  g.fill();
  g.fillStyle = '#f58426';
  g.font = `900 ${Math.round(m(1.18))}px Arial, "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('NY', 0, m(0.05));
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeCourtPaint(wood) {
  const mat = wood.clone();
  mat.emissive = new THREE.Color(0x100c06);
  mat.emissiveIntensity = 0.03;
  const decal = makeCourtDecal();
  mat.userData.courtDecal = decal;
  return patch(mat, 'msg-court-v3', (shader) => {
    shader.uniforms.uDecal = { value: decal || new THREE.Texture() };
    shader.uniforms.uHasDecal = { value: decal ? 1 : 0 };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uDecal;\nuniform float uHasDecal;\n${courtMarkGLSL}`)
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  vec2 p = vWorldPos.xz;
  float plank = floor(p.y * 8.2);
  float tone = aHash(vec3(plank, 2.7, 1.1));
  float grain = aFbm(vec3(p.x * 3.4, plank * 0.15, p.y * 0.35));
  float seam = 1.0 - smoothstep(0.0, 0.018, abs(fract(p.y * 8.2) - 0.5) - 0.46);
  vec3 light = vec3(0.94, 0.86, 0.66);
  vec3 dark = vec3(0.78, 0.68, 0.46);
  vec3 wood = mix(dark, light, tone * 0.55 + grain * 0.45);
  wood = mix(wood, wood * vec3(0.72, 0.62, 0.4), seam * 0.42);
  float keyMask, logo;
  float paint = courtPaint(p, keyMask, logo);
  float endBlue = 0.0;
  for (int s = -1; s <= 1; s += 2) {
    endBlue = max(endBlue, fill(sdBox2(p - vec2(float(s) * 12.8, 0.0), vec2(1.52, 7.62))));
  }
  vec3 knicksBlue = vec3(0.04, 0.20, 0.47);
  wood = mix(wood, knicksBlue, endBlue * 0.96);
  if (uHasDecal < 0.5) {
    vec3 orange = vec3(0.96, 0.52, 0.15);
    vec3 blue = vec3(0.04, 0.20, 0.47);
    float disc = fill(length(p) - 1.5);
    wood = mix(wood, blue, disc);
    wood = mix(wood, mix(blue, orange, step(0.0, p.x)), logo);
  } else {
    vec2 uv = (p + vec2(14.325, 7.62)) / vec2(28.65, 15.24);
    vec4 dec = texture(uDecal, uv);
    wood = mix(wood, dec.rgb, dec.a);
  }
  vec3 line = vec3(0.96, 0.96, 0.94);
  wood = mix(wood, line, paint);
  vec3 orangeRing = vec3(0.96, 0.52, 0.15);
  wood = mix(wood, orangeRing, stroke(length(p) - 1.83, 0.16) * 0.95);
  diffuseColor.rgb = wood;
}
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(0.16, 0.34, aFbm(vWorldPos * 3.5));
`);
  });
}

export function makeConcrete(tint = 0x8a8680) {
  const mat = new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.78, metalness: 0.03, envMapIntensity: 0.28,
  });
  return patch(mat, `msg-concrete-${tint.toString(16)}`, (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  float grain = aFbm(vWorldPos * 3.8);
  float pit = smoothstep(0.72, 0.92, aFbm(vWorldPos * 9.0));
  float stain = aFbm(vWorldPos * 0.45 + vec3(4.0, 0.0, 2.0));
  diffuseColor.rgb *= mix(0.78, 1.14, grain);
  diffuseColor.rgb *= 1.0 - pit * 0.22;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 0.68, 0.62), stain * 0.2);
}
`);
  });
}

export function makeTerrazzo() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9a958c, roughness: 0.35, metalness: 0.06, envMapIntensity: 0.45,
  });
  return patch(mat, 'msg-terrazzo', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  vec2 uv = vWorldPos.xz * 1.8;
  float tile = step(0.03, min(fract(uv.x), fract(uv.y))) * step(0.03, min(1.0 - fract(uv.x), 1.0 - fract(uv.y)));
  float chip = aNoise(vec3(vWorldPos.xz * 14.0, 2.0));
  vec3 base = vec3(0.42, 0.4, 0.37);
  vec3 chipA = vec3(0.62, 0.38, 0.16);
  vec3 chipB = vec3(0.12, 0.22, 0.4);
  vec3 grout = vec3(0.28, 0.27, 0.25);
  vec3 col = mix(base, mix(chipA, chipB, step(0.72, chip)), step(0.58, chip) * 0.55);
  diffuseColor.rgb = mix(grout, col, tile);
}
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(0.28, 0.5, aFbm(vWorldPos * 5.0));
`);
  });
}

export function makeSeatFabric() {
  return new THREE.MeshStandardMaterial({
    color: 0x12151c, roughness: 0.88, metalness: 0.02, envMapIntensity: 0.12,
  });
}

export function makeMetal(tint = 0x6a6e74, rough = 0.38) {
  return new THREE.MeshStandardMaterial({
    color: tint, roughness: rough, metalness: 0.78, envMapIntensity: 0.9,
  });
}

export function makeGlass() {
  return new THREE.MeshStandardMaterial({
    color: 0x9ec4d8, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.32,
    envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide,
  });
}

export function makeEmissive(color, intensity = 1.4) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.35, metalness: 0.1,
  });
}

export function makeJumbotron() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  float pix = step(0.82, fract(uv.x * 170.0)) * step(0.82, fract(uv.y * 96.0));
  vec3 col = vec3(0.012, 0.013, 0.016) + vec3(0.018, 0.02, 0.024) * pix;
  float glow = 0.012 + 0.006 * sin(uTime * 0.7 + uv.y * 6.0);
  col += vec3(glow);
  float frame = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  col *= smoothstep(0.0, 0.03, frame);
  gl_FragColor = vec4(col, 1.0);
}
`,
    toneMapped: false,
  });
}

export function makeGardenSign() {
  if (typeof document === 'undefined') {
    return new THREE.MeshStandardMaterial({
      color: 0x101214, emissive: 0xe8e0d0, emissiveIntensity: 0.28, roughness: 0.55,
    });
  }
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0b0e';
  g.fillRect(0, 0, 2048, 160);
  g.fillStyle = '#f3eee4';
  g.font = '700 74px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('MADISON   SQUARE   GARDEN', 1024, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
}

export function makeMarquee() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  float t = uTime;
  vec3 bg = vec3(0.04, 0.05, 0.07);
  vec3 amber = vec3(1.0, 0.62, 0.14);
  float chase = step(0.55, fract(uv.x * 42.0 - t * 1.8));
  float edge = step(uv.y, 0.12) + step(0.88, uv.y);
  vec3 col = mix(bg, amber * 1.3, edge * chase);
  float mid = step(0.32, uv.y) * step(uv.y, 0.7);
  float dash = step(0.22, fract(uv.x * 18.0));
  col = mix(col, amber, mid * dash * 0.95);
  float pulse = 0.75 + 0.25 * sin(t * 2.4);
  col *= pulse;
  gl_FragColor = vec4(col, 1.0);
}
`,
    toneMapped: false,
  });
}

export function makeBanner(tint) {
  return new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.62, metalness: 0.05,
    emissive: tint, emissiveIntensity: 0.08,
  });
}
