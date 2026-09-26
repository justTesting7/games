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
    for (int k = 0; k < 4; k++) {
      float hy = mix(-KEYW + 0.35, KEYW - 0.35, (float(k) + 0.5) / 4.0);
      vec2 ha = vec2(float(s) * (HX - 0.18), hy);
      vec2 hb = vec2(float(s) * (HX - 0.55), hy);
      paint = max(paint, stroke(sdSeg(p, ha, hb), 0.035) * inCourt);
    }
  }
  for (int i = 0; i < 8; i++) {
    float t = (float(i) + 1.0) / 9.0;
    float x = mix(-HX + 1.2, HX - 1.2, t);
    paint = max(paint, stroke(sdSeg(p, vec2(x, HZ), vec2(x, HZ - 0.3)), 0.04) * inCourt);
    paint = max(paint, stroke(sdSeg(p, vec2(x, -HZ), vec2(x, -HZ + 0.3)), 0.04) * inCourt);
  }
  vec2 q = p * 1.2;
  float nStem = min(sdBox2(q - vec2(-0.4, 0.0), vec2(0.08, 0.46)), sdBox2(q - vec2(-0.04, 0.0), vec2(0.08, 0.46)));
  nStem = min(nStem, sdSeg(q, vec2(-0.4, 0.44), vec2(-0.04, -0.44)) - 0.075);
  float yStem = min(sdBox2(q - vec2(0.44, -0.2), vec2(0.08, 0.26)), sdSeg(q, vec2(0.22, 0.44), vec2(0.44, 0.04)) - 0.075);
  yStem = min(yStem, sdSeg(q, vec2(0.66, 0.44), vec2(0.44, 0.04)) - 0.075);
  logo = max(fill(nStem), fill(yStem)) * fill(length(p) - 1.5);
  return paint;
}
`;

/** Blue out-of-bounds border around the lines, in metres beyond baseline and sideline. */
export const COURT_BORDER = [2.0, 1.8];

function makeCourtDecal() {
  if (typeof document === 'undefined') return null;
  const ppm = 64;
  const EX = 14.325 + COURT_BORDER[0];
  const EZ = 7.62 + COURT_BORDER[1];
  const W = Math.round(EX * 2 * ppm);
  const H = Math.round(EZ * 2 * ppm);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const X = (x) => (x + EX) * ppm;
  const Y = (z) => (z + EZ) * ppm;
  const m = (v) => v * ppm;
  g.clearRect(0, 0, W, H);

  const word = (text, cx, cz, rot, size, color = '#f4f2ec', track = 0.16) => {
    g.save();
    g.translate(X(cx), Y(cz));
    g.rotate(rot);
    g.fillStyle = color;
    g.font = `800 ${Math.round(m(size))}px "Arial Black", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const letters = text.split('');
    const gap = m(size * track);
    const widths = letters.map((ch) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (letters.length - 1);
    let x = -total * 0.5;
    for (let i = 0; i < letters.length; i++) {
      g.fillText(letters[i], x + widths[i] * 0.5, 0);
      x += widths[i] + gap;
    }
    g.restore();
  };
  const bx = 14.325 + COURT_BORDER[0] * 0.5;
  const bz = 7.62 + COURT_BORDER[1] * 0.5;
  word('NEW YORK KNICKS', bx, 0, -Math.PI / 2, 1.05);
  word('NEW YORK KNICKS', -bx, 0, Math.PI / 2, 1.05);
  word('MADISON SQUARE GARDEN', -7.2, bz, 0, 0.62);
  word('MADISON SQUARE GARDEN', 7.2, -bz, Math.PI, 0.62);

  g.save();
  g.translate(X(0), Y(0));
  const R = m(1.62);
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fillStyle = '#f08a1c';
  g.fill();
  g.strokeStyle = '#123a7c';
  g.lineWidth = m(0.07);
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(-R, 0); g.lineTo(R, 0);
  g.moveTo(0, -R); g.lineTo(0, R);
  g.stroke();
  g.beginPath();
  g.ellipse(-R * 0.95, 0, R * 0.55, R * 0.9, 0, -Math.PI / 2, Math.PI / 2);
  g.stroke();
  g.beginPath();
  g.ellipse(R * 0.95, 0, R * 0.55, R * 0.9, 0, Math.PI / 2, Math.PI * 1.5);
  g.stroke();
  g.fillStyle = '#123a7c';
  g.fillRect(-R * 1.25, -m(0.42), R * 2.5, m(0.84));
  g.strokeStyle = '#f4f2ec';
  g.lineWidth = m(0.05);
  g.strokeRect(-R * 1.25, -m(0.42), R * 2.5, m(0.84));
  g.restore();
  word('KNICKS', 0, 0.04, 0, 0.62, '#f4f2ec', 0.06);
  word('NEW YORK', 0, -0.78, 0, 0.3, '#123a7c', 0.1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeCourtPaint(wood) {
  const mat = wood.clone();
  mat.emissive = new THREE.Color(0x000000);
  mat.emissiveIntensity = 0;
  const decal = makeCourtDecal();
  mat.userData.courtDecal = decal;
  const ext = new THREE.Vector2(14.325 + COURT_BORDER[0], 7.62 + COURT_BORDER[1]);
  return patch(mat, 'msg-court-v5', (shader) => {
    shader.uniforms.uDecal = { value: decal || new THREE.Texture() };
    shader.uniforms.uHasDecal = { value: decal ? 1 : 0 };
    shader.uniforms.uExt = { value: ext };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uDecal;\nuniform float uHasDecal;\nuniform vec2 uExt;\n${courtMarkGLSL}`)
      .replace('#include <color_fragment>', /* glsl */ `
#include <color_fragment>
{
  vec2 p = vWorldPos.xz;
  float plank = floor(p.y * 8.2);
  float tone = aHash(vec3(plank, 2.7, 1.1));
  float grain = aFbm(vec3(p.x * 3.4, plank * 0.15, p.y * 0.35));
  float seam = 1.0 - smoothstep(0.0, 0.018, abs(fract(p.y * 8.2) - 0.5) - 0.46);
  vec3 light = vec3(0.90, 0.74, 0.44);
  vec3 dark = vec3(0.74, 0.58, 0.30);
  vec3 wood = mix(dark, light, tone * 0.55 + grain * 0.45);
  wood = mix(wood, wood * vec3(0.82, 0.74, 0.52), seam * 0.28);
  float keyMask, logo;
  float paint = courtPaint(p, keyMask, logo);
  float outside = 1.0 - fill(sdBox2(p, vec2(14.325, 7.62)));
  vec3 knicksBlue = vec3(0.02, 0.16, 0.62) * mix(0.94, 1.04, grain);
  wood = mix(wood, knicksBlue, max(outside, keyMask));
  if (uHasDecal < 0.5) {
    vec3 orange = vec3(0.87, 0.26, 0.02);
    float disc = fill(length(p) - 1.6);
    wood = mix(wood, orange, disc);
    wood = mix(wood, knicksBlue, logo);
  } else {
    vec2 uv = (p + uExt) / (uExt * 2.0);
    vec4 dec = texture(uDecal, uv);
    wood = mix(wood, dec.rgb, dec.a);
  }
  vec3 line = vec3(0.92, 0.92, 0.9);
  wood = mix(wood, line, paint);
  diffuseColor.rgb = wood;
}
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(0.22, 0.4, aFbm(vWorldPos * 3.5));
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

/** White base so each seat's instance colour is the fabric colour. */
export function makeSeatFabric() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.8, metalness: 0.02, envMapIntensity: 0.12,
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

/** Live LED cube: warm/cool video blotches so the board reads from the court. */
export function makeJumbotron() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
varying vec3 vLocalPos;
void main() {
  vUv = uv;
  vLocalPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vLocalPos;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.0, w = 0.5;
  for (int i = 0; i < 5; i++) { a += w * vnoise(p); p *= 2.07; w *= 0.5; }
  return a;
}
void main() {
  vec2 uv = vUv;
  float t = uTime * 0.12;
  float n = fbm(uv * vec2(3.2, 2.4) + vec2(t * 0.35, t * 0.08));
  float n2 = fbm(uv * 7.0 - t);
  vec3 warm = vec3(0.95, 0.74, 0.52);
  vec3 cool = vec3(0.10, 0.22, 0.55);
  vec3 orange = vec3(0.95, 0.42, 0.08);
  vec3 col = mix(cool, warm, smoothstep(0.32, 0.72, n));
  col = mix(col, orange, smoothstep(0.62, 0.9, n2) * 0.35);
  float bolt = abs(uv.y - 0.52 - 0.08 * sin(uv.x * 18.0 + t * 4.0));
  col = mix(col, vec3(1.0, 0.92, 0.55), 1.0 - smoothstep(0.0, 0.045, bolt));
  vec2 g = fract(vec2(vLocalPos.x, vLocalPos.y) * 11.0);
  float pix = step(0.82, max(g.x, g.y));
  col *= mix(1.0, 0.55, pix);
  float vign = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x)
    * smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.9, uv.y);
  col *= 0.55 + 0.45 * vign;
  col *= 1.15;
  gl_FragColor = vec4(col, 1.0);
}
`,
    toneMapped: false,
  });
}

export function makeGardenSign() {
  if (typeof document === 'undefined') {
    return new THREE.MeshStandardMaterial({
      color: 0xc9a227, emissive: 0x6a4a10, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.35,
    });
  }
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d4b24a';
  g.fillRect(0, 0, 2048, 256);
  g.fillStyle = '#c49a2e';
  g.fillRect(0, 0, 2048, 18);
  g.fillRect(0, 238, 2048, 18);
  g.fillStyle = '#1a1408';
  g.font = '700 132px Arial, "Helvetica Neue", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = 'MADISON SQUARE GARDEN';
  const scale = Math.min(1, 1480 / g.measureText(text).width);
  g.save();
  g.translate(1024, 128);
  g.scale(scale, 1);
  g.fillText(text, 0, 0);
  g.restore();
  g.fillStyle = '#1a1408';
  g.font = '800 52px Arial, sans-serif';
  g.fillText('CHASE', 128, 128);
  g.fillText('CHASE', 1920, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35,
    roughness: 0.38, metalness: 0.22,
  });
}

export const AD_COUNT = 8;
export const AD_MOVE = 2.8;
export const AD_HOLD = 3.2;
/** Brands wrap the bowl at 60% of the original tile width. */
export const AD_SIZE = 0.6;
export const AD_WRAP = 1 / AD_SIZE;

/** Shared ticker: slide one ad, hold, slide the next. Units are atlas-widths. */
export function adScroll(t) {
  const period = AD_MOVE + AD_HOLD;
  const idx = Math.floor(t / period);
  const phase = t - idx * period;
  const u = Math.min(1, Math.max(0, phase / AD_MOVE));
  const k = phase < AD_MOVE ? u * u * (3 - 2 * u) : 1;
  return (idx + k) / AD_COUNT;
}

const AD_SPOTS = [
  { bg: [0.78, 0.06, 0.18], fg: [1, 0.97, 0.94] },
  { bg: [0.00, 0.19, 0.53], fg: [0.91, 0.93, 1] },
  { bg: [1.00, 0.42, 0.00], fg: [0.12, 0.05, 0] },
  { bg: [0.96, 0.82, 0.00], fg: [0.12, 0.09, 0] },
  { bg: [0.00, 0.42, 0.71], fg: [0.96, 0.52, 0.15] },
  { bg: [0.07, 0.54, 0.24], fg: [0.96, 1, 0.94] },
  { bg: [0.07, 0.07, 0.08], fg: [0.95, 0.76, 0.31] },
  { bg: [0.48, 0.06, 0.19], fg: [1, 0.91, 0.78] },
];

function paintAds(ctx, W, H) {
  const spots = [
    { bg: '#c8102e', fg: '#fff8f0', name: 'RED RUSH', sub: 'CLASSIC COLA' },
    { bg: '#003087', fg: '#e8eeff', name: 'NEXUS 2', sub: 'PLAY THE WORLD' },
    { bg: '#ff6a00', fg: '#1a0800', name: 'BOLT-ADE', sub: 'GO THE DISTANCE' },
    { bg: '#f5d000', fg: '#1a1400', name: 'BIG CRUNCH', sub: 'SNACK ATTACK' },
    { bg: '#006bb6', fg: '#f58426', name: 'THE GARDEN', sub: 'NEW YORK' },
    { bg: '#128a3c', fg: '#f4fff0', name: 'VOLT', sub: 'CHARGE UP' },
    { bg: '#111111', fg: '#f2c14e', name: 'AERO', sub: 'FLY NIGHTS' },
    { bg: '#7a1030', fg: '#ffe8c8', name: 'SLICE CO', sub: 'HOT & READY' },
  ];
  const slot = W / spots.length;
  spots.forEach((ad, i) => {
    const x = i * slot;
    ctx.fillStyle = ad.bg;
    ctx.fillRect(x, 0, slot, H);
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, 0, 10, H);
    ctx.fillRect(x + slot - 10, 0, 10, H);
    ctx.fillStyle = ad.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(H * 0.38)}px Arial, "Helvetica Neue", sans-serif`;
    ctx.fillText(ad.name, x + slot * 0.5, H * 0.42);
    ctx.font = `800 ${Math.round(H * 0.14)}px Arial, sans-serif`;
    ctx.globalAlpha = 0.88;
    ctx.fillText(ad.sub, x + slot * 0.5, H * 0.72);
    ctx.globalAlpha = 1;
  });
}

function makeAdAtlas() {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 4096;
    c.height = 256;
    paintAds(c.getContext('2d'), c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  }
  const data = new Uint8Array(AD_COUNT * 4);
  AD_SPOTS.forEach((ad, i) => {
    data[i * 4] = Math.round(ad.bg[0] * 255);
    data[i * 4 + 1] = Math.round(ad.bg[1] * 255);
    data[i * 4 + 2] = Math.round(ad.bg[2] * 255);
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, AD_COUNT, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** One stadium-wide LED ticker. Every ring shares this so ads move together. */
export function makeRibbon() {
  const atlas = makeAdAtlas();
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAtlas: { value: atlas },
    },
    vertexShader: /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform sampler2D uAtlas;
varying vec3 vWorldPos;
varying vec2 vUv;
float ticker(float t) {
  const float MOVE = 2.8;
  const float HOLD = 3.2;
  const float ADS = 8.0;
  float period = MOVE + HOLD;
  float idx = floor(t / period);
  float phase = t - idx * period;
  float u = clamp(phase / MOVE, 0.0, 1.0);
  float k = phase < MOVE ? u * u * (3.0 - 2.0 * u) : 1.0;
  return (idx + k) / ADS;
}
void main() {
  float ang = atan(vWorldPos.z, vWorldPos.x) / 6.2831853;
  const float WRAP = 1.6666667;
  // +ang so letters read left-to-right from the stands (looking in at the bowl).
  float u = fract(ang * WRAP + ticker(uTime));
  float v = clamp(vUv.y, 0.02, 0.98);
  vec3 col = texture2D(uAtlas, vec2(u, v)).rgb;
  vec2 g = fract(vec2(u * 220.0, v * 18.0));
  float pix = step(0.82, max(g.x, g.y));
  col *= mix(1.0, 0.62, pix);
  float edge = smoothstep(0.0, 0.08, v) * smoothstep(1.0, 0.92, v);
  col *= 0.55 + 0.45 * edge;
  col *= 1.25;
  gl_FragColor = vec4(col, 1.0);
}
`,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
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
