// Custom GLSL for sky and post-processing. Scene geometry uses
// Three.js physically based materials (see patch.js) and writes its view
// depth into the alpha channel of the HDR target, which these passes read.

export const skyCommon = /* glsl */ `
#define PI 3.14159265359
uniform sampler2D uSkyTex;
vec2 dirToUV(vec3 d) {
  return vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
}
vec3 skyRadiance(vec3 d) { return textureLod(uSkyTex, dirToUV(d), 0.0).rgb; }
vec3 skyIrradiance(vec3 n) { return textureLod(uSkyTex, dirToUV(n), 5.0).rgb; }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

export const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Physically based single-scattering atmosphere (Rayleigh + Mie), baked into
// a small equirectangular HDR texture every frame.
export const skyGenFrag = /* glsl */ `
#define PI 3.14159265359
varying vec2 vUv;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;

vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd);
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b * b - 4.0 * a * c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d)) / (2.0 * a), (-b + sqrt(d)) / (2.0 * a));
}

vec3 atmosphere(vec3 r, vec3 r0, vec3 pSun, float iSun) {
  const float rPlanet = 6371e3;
  const float rAtmos = 6471e3;
  const vec3 kRlh = vec3(5.5e-6, 13.0e-6, 22.4e-6);
  const float kMie = 21e-6;
  const float shRlh = 8e3;
  const float shMie = 1.2e3;
  const float g = 0.758;
  const int iSteps = 16;
  const int jSteps = 8;
  vec2 p = rsi(r0, r, rAtmos);
  if (p.x > p.y) return vec3(0.0);
  p.y = min(p.y, rsi(r0, r, rPlanet).x);
  float iStepSize = (p.y - p.x) / float(iSteps);
  float iTime = 0.0;
  vec3 totalRlh = vec3(0.0), totalMie = vec3(0.0);
  float iOdRlh = 0.0, iOdMie = 0.0;
  float mu = dot(r, pSun);
  float mumu = mu * mu;
  float gg = g * g;
  float pRlh = 3.0 / (16.0 * PI) * (1.0 + mumu);
  float pMie = 3.0 / (8.0 * PI) * ((1.0 - gg) * (mumu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * g, 1.5) * (2.0 + gg));
  for (int i = 0; i < iSteps; i++) {
    vec3 iPos = r0 + r * (iTime + iStepSize * 0.5);
    float iHeight = length(iPos) - rPlanet;
    float odStepRlh = exp(-iHeight / shRlh) * iStepSize;
    float odStepMie = exp(-iHeight / shMie) * iStepSize;
    iOdRlh += odStepRlh;
    iOdMie += odStepMie;
    float jStepSize = rsi(iPos, pSun, rAtmos).y / float(jSteps);
    float jTime = 0.0, jOdRlh = 0.0, jOdMie = 0.0;
    for (int j = 0; j < jSteps; j++) {
      vec3 jPos = iPos + pSun * (jTime + jStepSize * 0.5);
      float jHeight = length(jPos) - rPlanet;
      jOdRlh += exp(-jHeight / shRlh) * jStepSize;
      jOdMie += exp(-jHeight / shMie) * jStepSize;
      jTime += jStepSize;
    }
    vec3 attn = exp(-(kMie * (iOdMie + jOdMie) + kRlh * (iOdRlh + jOdRlh)));
    totalRlh += odStepRlh * attn;
    totalMie += odStepMie * attn;
    iTime += iStepSize;
  }
  return iSun * (pRlh * kRlh * totalRlh + pMie * kMie * totalMie);
}

void main() {
  float phi = (vUv.x - 0.5) * 2.0 * PI;
  float theta = (vUv.y - 0.5) * PI;
  vec3 dir = vec3(cos(theta) * cos(phi), sin(theta), cos(theta) * sin(phi));
  // Lifting grazing rays stands in for multiple scattering, which keeps the
  // horizon bright and bluish instead of muddy brown.
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.94 + 0.06, dir.z));
  vec3 r0 = vec3(0.0, 6372e3, 0.0);
  vec3 col = atmosphere(d, r0, uSunDir, 22.0);
  col += atmosphere(d, r0, uMoonDir, 0.35) * vec3(0.75, 0.9, 1.3);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += vec3(0.55, 0.7, 1.0) * lum * 0.25 * (1.0 - smoothstep(0.0, 0.5, dir.y));
  col += vec3(0.0006, 0.0009, 0.0018);
  if (dir.y < 0.0) col *= mix(1.0, 0.3, smoothstep(0.0, 0.4, -dir.y)) * vec3(0.9, 0.95, 0.85);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const skyFrag = /* glsl */ `
${skyCommon}
varying vec2 vUv;
uniform mat4 uInvViewProj;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uCloudCover;
uniform float uTime;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}
float cloudDensity(vec2 p) {
  vec2 w = vec2(uTime * 0.004, uTime * 0.0015);
  float base = fbm(p * 0.9 + w);
  float detail = fbm(p * 3.1 - w * 2.0);
  float d = base * 0.75 + detail * 0.25;
  return smoothstep(uCloudCover, uCloudCover + 0.28, d);
}

void main() {
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - cameraPosition);
  vec3 col = skyRadiance(normalize(vec3(dir.x, max(dir.y, 0.0), dir.z)));
  float horizon = smoothstep(-0.02, 0.02, dir.y);

  float cs = dot(dir, uSunDir);
  float sunR = 0.99988;
  if (cs > sunR) {
    float x = (cs - sunR) / (1.0 - sunR);
    col += uSunColor * 120.0 * pow(x, 0.35) * horizon;
  }
  col += uSunColor * pow(max(cs, 0.0), 1800.0) * 3.0 * horizon;

  float cm = dot(dir, uMoonDir);
  float moonR = 0.99975;
  if (cm > moonR) {
    vec3 up = abs(uMoonDir.y) > 0.99 ? vec3(1, 0, 0) : vec3(0, 1, 0);
    vec3 mx = normalize(cross(up, uMoonDir));
    vec3 my = cross(uMoonDir, mx);
    vec2 mp = vec2(dot(dir, mx), dot(dir, my)) / sqrt(1.0 - moonR * moonR);
    float crater = vnoise(mp * 6.0) * 0.5 + vnoise(mp * 14.0) * 0.25;
    float edge = smoothstep(1.0, 0.9, length(mp));
    col += vec3(0.9, 0.93, 1.0) * (0.55 + crater * 0.45) * 0.9 * edge * horizon;
  }

  if (uNight > 0.01 && dir.y > -0.05) {
    float a = uTime * 0.002;
    vec3 sd = vec3(dir.x * cos(a) - dir.y * sin(a), dir.x * sin(a) + dir.y * cos(a), dir.z);
    vec3 sp = sd * 220.0;
    vec3 cell = floor(sp);
    float h = hash13(cell);
    if (h > 0.985) {
      vec3 c = cell + 0.5 + (vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 5.1)) - 0.5) * 0.6;
      float d = length(sp - c);
      float tw = 0.6 + 0.4 * sin(uTime * (2.0 + h * 8.0) + h * 100.0);
      float b = smoothstep(0.22, 0.0, d) * tw * (h - 0.985) * 66.0;
      vec3 sc = mix(vec3(1.0, 0.8, 0.6), vec3(0.7, 0.8, 1.0), hash13(cell + 9.0));
      col += sc * b * 1.2 * uNight * horizon;
    }
  }

  if (dir.y > 0.0) {
    vec2 cp = dir.xz / (dir.y + 0.06) * 2.0;
    float dens = cloudDensity(cp);
    if (dens > 0.001) {
      vec2 toL = normalize(uLightDir.xz + 1e-4) * 0.09;
      float sh = 0.0;
      for (int i = 1; i <= 4; i++) sh += cloudDensity(cp + toL * float(i));
      float lightT = exp(-sh * 0.9);
      float mu = dot(dir, uLightDir);
      float phase = 0.6 + 2.2 * pow(max(mu, 0.0), 8.0) + 0.4 * pow(max(mu, 0.0), 2.0);
      vec3 amb = skyIrradiance(vec3(0.0, 1.0, 0.0)) * 1.4;
      vec3 cc = uLightColor * lightT * phase * 0.55 / 3.14159 + amb * (0.55 + 0.45 * (1.0 - dens));
      float fade = smoothstep(0.0, 0.25, dir.y);
      vec3 hazeCol = skyRadiance(normalize(vec3(dir.x, 0.02, dir.z)));
      cc = mix(hazeCol, cc, smoothstep(0.0, 0.35, dir.y));
      col = mix(col, cc, dens * fade * 0.95);
    }
  }
  gl_FragColor = vec4(col, 10000.0);
}
`;

// Height fog and aerial perspective, applied in screen space using the view
// depth stored in alpha. The fog colour is the atmosphere itself, so distant
// terrain melts into the sky naturally.
export const fogFrag = /* glsl */ `
${skyCommon}
varying vec2 vUv;
uniform sampler2D tScene;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uSunDir;
uniform vec3 uLightColor;
uniform float uFogDensity;
uniform float uFogFalloff;
void main() {
  vec4 s = texture(tScene, vUv);
  float viewZ = s.a;
  if (viewZ >= 9000.0) { gl_FragColor = s; return; }
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);
  float dist = viewZ / max(dot(dir, uCamForward), 1e-3);

  float b = uFogFalloff;
  float a = uFogDensity;
  float ry = dir.y;
  float fog = a * exp(-max(uCamPos.y, 0.0) * b) * dist;
  if (abs(ry) > 1e-4) fog = a * exp(-max(uCamPos.y, 0.0) * b) * (1.0 - exp(-ry * dist * b)) / (ry * b);
  fog = 1.0 - exp(-max(fog, 0.0));

  vec3 fogCol = skyRadiance(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.5 + 0.02, dir.z)));
  float mie = pow(max(dot(dir, uSunDir), 0.0), 8.0);
  fogCol += uLightColor * mie * 0.03;
  gl_FragColor = vec4(mix(s.rgb, fogCol, fog), viewZ);
}
`;

export const copyFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
void main() { gl_FragColor = texture(tDiffuse, vUv); }
`;

export const bloomDownFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform bool uFirst;
vec3 s(vec2 o) { return texture(tSrc, vUv + o * uTexel).rgb; }
float karis(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 col;
  if (uFirst) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) /
          (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
    col = min(col, vec3(500.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export const bloomUpFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main() {
  vec2 r = uTexel;
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += (texture(tSrc, vUv + vec2(-r.x, 0)).rgb + texture(tSrc, vUv + vec2(r.x, 0)).rgb +
        texture(tSrc, vUv + vec2(0, -r.y)).rgb + texture(tSrc, vUv + vec2(0, r.y)).rgb) * 2.0;
  c += texture(tSrc, vUv + vec2(-r.x, -r.y)).rgb + texture(tSrc, vUv + vec2(r.x, -r.y)).rgb +
       texture(tSrc, vUv + vec2(-r.x, r.y)).rgb + texture(tSrc, vUv + vec2(r.x, r.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}
`;

export const lumFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform float uDt;
uniform bool uReset;
void main() {
  float sum = 0.0, wsum = 0.0;
  for (int y = 0; y < 12; y++) {
    for (int x = 0; x < 12; x++) {
      vec2 uv = (vec2(x, y) + 0.5) / 12.0;
      vec3 c = texture(tScene, uv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float w = 0.25 + 1.0 - smoothstep(0.1, 0.75, length(uv - 0.5));
      sum += log(max(l, 1e-4)) * w;
      wsum += w;
    }
  }
  float target = exp(sum / wsum);
  float prev = texture(tPrev, vec2(0.5)).r;
  float speed = target > prev ? 2.0 : 1.2;
  float l = uReset ? target : prev + (target - prev) * (1.0 - exp(-uDt * speed));
  gl_FragColor = vec4(l, 0.0, 0.0, 1.0);
}
`;

export const godraysFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform vec2 uSunUV;
uniform float uAspect;
uniform float uFrame;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  const int N = 40;
  vec2 delta = (uSunUV - vUv) / float(N) * 0.9;
  vec2 uv = vUv + delta * ign(gl_FragCoord.xy + uFrame * 5.588);
  float acc = 0.0, decay = 1.0;
  for (int i = 0; i < N; i++) {
    uv += delta;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sky = step(9000.0, texture(tScene, uv).a);
    vec2 d = (uv - uSunUV) * vec2(uAspect, 1.0);
    acc += sky * exp(-dot(d, d) * 6.0) * decay;
    decay *= 0.965;
  }
  gl_FragColor = vec4(acc / float(N), 0.0, 0.0, 1.0);
}
`;

export const compositeFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tLum;
uniform sampler2D tRays;
uniform vec2 uTexel;
uniform vec3 uLightColor;
uniform float uBloom;
uniform float uRays;
uniform float uSharpen;
uniform float uExposureBias;
uniform float uAutoExposure;
uniform float uVignette;
uniform float uFlash;

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(outM * RRTAndODTFit(inM * c), 0.0, 1.0);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 uv = vUv;
  vec3 col = texture(tScene, uv).rgb;
  // Broadcast cameras sharpen in-camera; a light unsharp mask gives the same crisp read.
  if (uSharpen > 0.0) {
    vec3 n = texture(tScene, uv + vec2(uTexel.x, 0.0)).rgb + texture(tScene, uv - vec2(uTexel.x, 0.0)).rgb
           + texture(tScene, uv + vec2(0.0, uTexel.y)).rgb + texture(tScene, uv - vec2(0.0, uTexel.y)).rgb;
    col = max(col + (col - n * 0.25) * uSharpen, vec3(0.0));
  }
  col = mix(col, texture(tBloom, uv).rgb, uBloom);
  col += uLightColor * texture(tRays, uv).r * uRays / 3.14159;

  float avgLum = texture(tLum, vec2(0.5)).r;
  if (!(avgLum > 0.0) || avgLum != avgLum) avgLum = 0.18;
  if (uAutoExposure > 0.5) col *= uExposureBias * 0.16 / clamp(avgLum, 0.04, 3.0);
  else col *= uExposureBias;
  col *= 1.0 + uFlash;
  col = aces(col);

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.1);
  col *= mix(vec3(0.98, 0.99, 1.03), vec3(1.02, 1.0, 0.97), smoothstep(0.2, 0.8, l));
  vec2 vc = vUv - 0.5;
  col *= 1.0 - dot(vc, vc) * uVignette;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;
