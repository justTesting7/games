// Custom GLSL for sky, water and post-processing. Scene geometry uses
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

export const indoorSkyFrag = /* glsl */ `
void main() { gl_FragColor = vec4(0.012, 0.013, 0.015, 1.0); }
`;

// Float textures are not guaranteed to be filterable, so heights are
// interpolated by hand.
export const heightSampleGLSL = /* glsl */ `
float sampleHeight(sampler2D tex, vec2 xz, float worldSize) {
  float n = float(textureSize(tex, 0).x);
  vec2 g = clamp((xz / worldSize + 0.5) * (n - 1.0), vec2(0.0), vec2(n - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float a = texelFetch(tex, i, 0).r;
  float b = texelFetch(tex, i + ivec2(1, 0), 0).r;
  float c = texelFetch(tex, i + ivec2(0, 1), 0).r;
  float d = texelFetch(tex, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec2 terrainUV(vec2 xz, float worldSize, float n) {
  return ((xz / worldSize + 0.5) * (n - 1.0) + 0.5) / n;
}
`;

export const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  #ifdef SKY_AT_FAR
  gl_Position = vec4(position.xy, 1.0, 1.0); // on the far plane, behind everything
  #else
  gl_Position = vec4(position.xy, 0.0, 1.0);
  #endif
}
`;

// Physically based single-scattering atmosphere (Rayleigh + Mie), baked into
// a small equirectangular HDR texture every frame.
export const skyGenFrag = /* glsl */ `
#define PI 3.14159265359
varying vec2 vUv;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uBounce; // sunlit ground's radiance (albedo/pi * irradiance), set on the CPU

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
  // below the horizon: light bounced off the sunlit ground (warm), not more blue sky, so
  // shaded walls and undersides pick up the street's colour the way they do outdoors
  if (dir.y < 0.0) col = mix(col, uBounce + col * vec3(0.24, 0.22, 0.19), smoothstep(0.0, 0.12, -dir.y));
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
uniform float uLightning;
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
    // lightning lights the cloud deck from inside, brightest overhead
    col += vec3(0.55, 0.6, 0.78) * uLightning * (0.35 + 1.1 * dens) * smoothstep(0.0, 0.4, dir.y) * 1.4;
  }
  gl_FragColor = vec4(col, 10000.0);
}
`;

export const waterVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const waterFrag = /* glsl */ `
${skyCommon}
uniform sampler2D uSceneTex;
uniform sampler2D uHeightTex;
uniform float uWorldSize;
uniform vec2 uResolution;
uniform mat4 uProj;
uniform int uSSRSteps;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uTime;
varying vec3 vWorld;

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash22(i), f), dot(hash22(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(hash22(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash22(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
}

float waveHeight(vec2 p) {
  float t = uTime;
  float h = 0.0;
  h += sin(dot(p, vec2(0.8, 0.6)) * 0.35 + t * 0.9) * 0.12;
  h += sin(dot(p, vec2(-0.5, 0.86)) * 0.6 + t * 1.25) * 0.07;
  h += sin(dot(p, vec2(0.95, -0.3)) * 1.1 + t * 1.7) * 0.035;
  h += gnoise(p * 0.7 + vec2(t * 0.25, t * 0.15)) * 0.1;
  h += gnoise(p * 1.9 - vec2(t * 0.4, -t * 0.3)) * 0.04;
  h += gnoise(p * 4.5 + vec2(t * 0.7, t * 0.5)) * 0.012;
  return h;
}

// far out only the long swells show (the noise ripples are finer than a pixel there)
float swellHeight(vec2 p) {
  float t = uTime;
  return sin(dot(p, vec2(0.8, 0.6)) * 0.35 + t * 0.9) * 0.12
    + sin(dot(p, vec2(-0.5, 0.86)) * 0.6 + t * 1.25) * 0.07
    + sin(dot(p, vec2(0.95, -0.3)) * 1.1 + t * 1.7) * 0.035;
}

vec3 waterNormal(vec2 p, float dist) {
  float e = 0.08;
  if (dist > 150.0) {
    float h = swellHeight(p);
    return normalize(vec3(-(swellHeight(p + vec2(e, 0.0)) - h) / e, 1.0, -(swellHeight(p + vec2(0.0, e)) - h) / e));
  }
  float h = waveHeight(p);
  float hx = waveHeight(p + vec2(e, 0.0));
  float hz = waveHeight(p + vec2(0.0, e));
  return normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
}

${heightSampleGLSL}
float terrainHeight(vec2 xz) {
  vec2 uv = xz / uWorldSize + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -30.0;
  return sampleHeight(uHeightTex, xz, uWorldSize);
}

vec2 toScreen(vec3 viewPos) {
  vec4 c = uProj * vec4(viewPos, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}

vec4 traceSSR(vec3 worldPos, vec3 R, int steps) {
  vec3 vp = (viewMatrix * vec4(worldPos, 1.0)).xyz;
  vec3 vr = normalize((viewMatrix * vec4(R, 0.0)).xyz);
  if (vr.z > 0.3) return vec4(0.0);
  float stepLen = 0.4 + ign(gl_FragCoord.xy) * 0.4;
  vec3 p = vp, prev = vp;
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    prev = p;
    p += vr * stepLen;
    stepLen *= 1.13;
    vec2 uv = toScreen(p);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || p.z > -0.1) break;
    float sceneD = texture(uSceneTex, uv).a;
    float d = -p.z;
    if (d > sceneD && sceneD < 9000.0) {
      if (d - sceneD > stepLen * 2.5 + 0.5) continue;
      vec3 a = prev, b = p;
      for (int j = 0; j < 6; j++) {
        vec3 m = (a + b) * 0.5;
        if (-m.z > texture(uSceneTex, toScreen(m)).a) b = m; else a = m;
      }
      vec2 huv = toScreen(b);
      vec2 edge = smoothstep(vec2(0.0), vec2(0.1), huv) * (1.0 - smoothstep(vec2(0.9), vec2(1.0), huv));
      float conf = edge.x * edge.y * (1.0 - float(i) / float(steps));
      return vec4(texture(uSceneTex, huv).rgb, clamp(conf * 1.5, 0.0, 1.0));
    }
  }
  return vec4(0.0);
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float surfDist = length(toCam);
  vec3 V = toCam / surfDist;
  float viewZ = 1.0 / gl_FragCoord.w;
  bool below = cameraPosition.y < vWorld.y;

  vec3 N = waterNormal(vWorld.xz, surfDist);
  float detailFade = 1.0 - smoothstep(40.0, 400.0, surfDist);
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.3 + 0.7 * detailFade));
  if (below) N = -N;

  vec2 suv = gl_FragCoord.xy / uResolution;
  float ndv = max(dot(N, V), 0.0);

  float ground = terrainHeight(vWorld.xz);
  float depth = max(vWorld.y - ground, 0.0);

  // Refraction.
  vec2 distort = N.xz * 0.04 * detailFade * min(depth, 2.0) / max(1.0, surfDist * 0.04);
  vec2 ruv = clamp(suv + distort, 0.001, 0.999);
  float sceneD = texture(uSceneTex, ruv).a;
  if (sceneD < viewZ) { ruv = suv; sceneD = texture(uSceneTex, suv).a; }
  vec3 refr = texture(uSceneTex, ruv).rgb;
  float thickness = below ? 0.0 : min(max(sceneD - viewZ, 0.0) * surfDist / viewZ, 400.0);
  vec3 absorb = exp(-thickness * vec3(0.42, 0.085, 0.06));
  vec3 skyAmb = skyIrradiance(vec3(0.0, 1.0, 0.0));
  vec3 scatterCol = vec3(0.008, 0.05, 0.065) * (skyAmb * 1.6 + uLightColor * 0.05);
  vec3 refracted = refr * absorb + scatterCol * (1.0 - exp(-thickness * 0.15));

  // Reflection.
  vec3 R = reflect(-V, N);
  if (R.y < 0.0 && !below) R.y = -R.y * 0.3;
  vec3 skyR = skyRadiance(R);
  // reflections of the scene near by; far out the sky alone (the march would find little
  // on screen to hit, at full cost per pixel), and half the steps in between
  int ssrSteps = surfDist < 60.0 ? uSSRSteps : surfDist < 150.0 ? uSSRSteps / 2 : 0;
  vec4 ssr = ssrSteps > 0 ? traceSSR(vWorld, R, ssrSteps) : vec4(0.0);
  vec3 refl = mix(skyR, ssr.rgb, ssr.a);

  vec3 H = normalize(uLightDir + V);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, 900.0) * 30.0 + pow(nh, 120.0) * 0.6;
  vec3 sunSpec = uLightColor * spec * step(0.0, uLightDir.y) / 3.14159;

  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  if (below) {
    F = ndv < 0.66 ? 1.0 : F;
    refl = scatterCol * 2.0;
  }
  vec3 col = mix(refracted, refl, F) + (below ? vec3(0.0) : sunSpec);

  // Shoreline foam where the water is shallow.
  if (!below) {
    float shore = 1.0 - smoothstep(0.0, 1.2, depth);
    float n = gnoise(vWorld.xz * 1.3 + uTime * 0.25) * 0.5 + gnoise(vWorld.xz * 4.0 - uTime * 0.4) * 0.35 + 0.5;
    float bands = sin(depth * 9.0 - uTime * 1.6 + n * 3.0) * 0.5 + 0.5;
    float foam = smoothstep(0.45, 0.8, n * (0.6 + bands * 0.6)) * shore;
    foam = max(foam, smoothstep(0.12, 0.0, depth) * 0.8);
    vec3 foamLight = uLightColor * max(uLightDir.y, 0.0) / 3.14159 + skyAmb * 1.2;
    col = mix(col, foamLight * 0.85, foam * 0.9);
  }
  gl_FragColor = vec4(col, viewZ);
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
uniform float uUnderwater;
uniform sampler2D tAO;
uniform float uAO;

void main() {
  vec4 s = texture(tScene, vUv);
  float viewZ = s.a;
  if (uAO > 0.0) {
    // Obscurance was taken before water and effects were drawn: skip pixels they cover.
    vec2 ao = texture(tAO, vUv).rg;
    if (abs(ao.y - viewZ) < 0.06 * viewZ + 0.25) s.rgb *= mix(1.0, ao.x, uAO);
  }
  if (viewZ >= 9000.0 || uUnderwater > 0.5) { gl_FragColor = s; return; }
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
uniform vec3 uLightColor;
uniform vec3 uWaterAmbient;
uniform float uBloom;
uniform float uRays;
uniform float uUnderwater;
uniform float uTime;
uniform float uExposureBias;
uniform float uAutoExposure;
uniform float uScotopic;
uniform float uVignette;
uniform float uFlash;
uniform vec2 uSunUV;
uniform float uFlare;
uniform float uAspect;
uniform float uSharpen;
uniform vec2 uTexel;

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

// A camera lens looking toward the sun: soft coloured ghosts strung along the line from the
// sun through the middle of the frame, and a faint ring. Only while the sun itself is in
// clear view (the sky's depth at and around it).
vec3 lensFlare(vec2 uv) {
  float seen = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 o = vec2(float(i == 1) - float(i == 2), float(i == 3) - float(i == 4)) * 0.012;
    seen += step(9000.0, texture(tScene, uSunUV + o).a);
  }
  float k = uFlare * seen / 5.0;
  if (k < 0.001) return vec3(0.0);
  vec2 axis = vec2(0.5) - uSunUV;
  vec3 c = vec3(0.0);
  const vec3 tint[5] = vec3[5](vec3(0.9, 0.6, 0.3), vec3(0.3, 0.8, 0.6), vec3(0.5, 0.5, 1.0), vec3(1.0, 0.75, 0.4), vec3(0.6, 0.9, 1.0));
  const float at[5] = float[5](0.35, 0.7, 1.15, 1.45, 1.9);
  const float rad[5] = float[5](0.035, 0.06, 0.02, 0.09, 0.05);
  for (int i = 0; i < 5; i++) {
    vec2 p = uSunUV + axis * at[i];
    float d = length((uv - p) * vec2(uAspect, 1.0));
    c += tint[i] * smoothstep(rad[i], rad[i] * 0.55, d) * 0.06;
  }
  float r = length((uv - 0.5) * vec2(uAspect, 1.0)) - length(axis * vec2(uAspect, 1.0)) * 0.9;
  c += vec3(0.6, 0.7, 0.9) * exp(-r * r * 4000.0) * 0.02;
  return c * k;
}

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) uv += vec2(sin(uv.y * 24.0 + uTime * 2.0), cos(uv.x * 20.0 + uTime * 1.7)) * 0.0018;
  vec4 s = texture(tScene, uv);
  vec3 col = s.rgb;
  if (uSharpen > 0.0) {
    // TAA leaves the frame a touch soft: an unsharp mask on the four neighbours brings it back
    vec3 nb = texture(tScene, uv + vec2(uTexel.x, 0.0)).rgb + texture(tScene, uv - vec2(uTexel.x, 0.0)).rgb
      + texture(tScene, uv + vec2(0.0, uTexel.y)).rgb + texture(tScene, uv - vec2(0.0, uTexel.y)).rgb;
    col = max(col + (col - nb * 0.25) * uSharpen, 0.0);
  }
  float dist = s.a;
  if (uUnderwater > 0.5) {
    vec3 absorb = exp(-min(dist, 200.0) * vec3(0.30, 0.075, 0.05));
    float fog = 1.0 - exp(-min(dist, 200.0) * 0.06);
    col = col * absorb + uWaterAmbient * fog;
  }
  col = mix(col, texture(tBloom, uv).rgb, uBloom);
  col += uLightColor * texture(tRays, uv).r * uRays / 3.14159;

  float pl = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float scot = 1.0 - smoothstep(0.004, 0.08, pl);
  col = mix(col, vec3(0.55, 0.7, 1.0) * pl * 1.1, scot * 0.6 * uScotopic);

  float avgLum = texture(tLum, vec2(0.5)).r;
  if (!(avgLum > 0.0) || avgLum != avgLum) avgLum = 0.18;
  // HDR auto-exposure on an 8-bit phone target blows the ground to white.
  // The eye adapts only partly: a dim scene is brightened by its luminance to the 0.6, so
  // night stays night (lamps and headlights matter) while full daylight is unchanged.
  if (uAutoExposure > 0.5) col *= uExposureBias * 0.16 / (0.374 * pow(clamp(avgLum, 0.002, 3.0) / 0.374, 0.6));
  else col *= uExposureBias;
  col = aces(col);

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.08);
  col *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.2, 0.8, l));
  vec2 vc = vUv - 0.5;
  col *= 1.0 - dot(vc, vc) * uVignette;
  col += lensFlare(vUv);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Scalable ambient obscurance (McGuire et al.) at half resolution. tDepth.a is the
// view distance every opaque material writes (see engine/patch.js); normals come
// from the depth itself, picking the flatter neighbour on each axis so edges stay crisp.
export const aoFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform vec2 uProj;
uniform float uRadius;
uniform float uIntensity;
uniform float uMaxDist;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 viewPos(vec2 uv, float d) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x / uProj.x * d, ndc.y / uProj.y * d, -d);
}
float depthAt(vec2 uv) { return texture(tDepth, uv).a; }

void main() {
  float d = depthAt(vUv);
  if (d <= 0.05 || d > uMaxDist) { gl_FragColor = vec4(1.0, d, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv, d);
  vec2 px = 1.0 / uRes;
  vec2 ox = vec2(px.x, 0.0), oy = vec2(0.0, px.y);
  vec3 pr = viewPos(vUv + ox, depthAt(vUv + ox)), pl = viewPos(vUv - ox, depthAt(vUv - ox));
  vec3 pu = viewPos(vUv + oy, depthAt(vUv + oy)), pd = viewPos(vUv - oy, depthAt(vUv - oy));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, -P) < 0.0) N = -N;

  float rPx = min(uRadius * uProj.y * 0.5 * uRes.y / d, 48.0); // capped: wide taps miss the cache
  if (rPx < 1.5) { gl_FragColor = vec4(1.0, d, 0.0, 1.0); return; }
  float r2 = uRadius * uRadius;
  float bias = 0.012 + d * 0.0016;
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float a = (float(i) + 0.5) / float(AO_SAMPLES);
    float th = ang + float(i) * 2.3999632;
    vec2 suv = vUv + vec2(cos(th), sin(th)) * (a * rPx) * px;
    float sd = depthAt(suv);
    if (sd <= 0.05) continue;
    vec3 v = viewPos(suv, sd) - P;
    float vv = dot(v, v);
    float vn = dot(v, N);
    float f = max(r2 - vv, 0.0);
    occ += f * f * f * max((vn - bias) / (0.01 + vv), 0.0);
  }
  float ao = max(0.0, 1.0 - occ * uIntensity / (r2 * r2 * r2) * (5.0 / float(AO_SAMPLES)));
  // fade out with distance, where depth precision can't carry it
  ao = mix(ao, 1.0, smoothstep(uMaxDist * 0.6, uMaxDist, d));
  gl_FragColor = vec4(ao, d, 0.0, 1.0);
}
`;

// Depth-aware separable blur of the obscurance (r = ao, g = depth).
export const aoBlurFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tAO;
uniform vec2 uStep;

void main() {
  vec4 c = texture(tAO, vUv);
  float d = c.g;
  float sum = c.r * 0.2270270, wsum = 0.2270270;
  const float W[4] = float[4](0.1945946, 0.1216216, 0.0540540, 0.0162162);
  for (int i = 1; i <= 4; i++) {
    for (int s = -1; s <= 1; s += 2) {
      vec4 t = texture(tAO, vUv + uStep * float(i * s));
      float w = W[i - 1] * max(0.0, 1.0 - abs(t.g - d) / (0.04 * d + 0.08));
      sum += t.r * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(sum / wsum, d, 0.0, 1.0);
}
`;

// Camera motion blur by reprojection: rebuild each pixel's world point from its view
// distance (alpha), project it with last frame's camera, and blur along the difference.
export const motionBlurFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform float uStrength;

void main() {
  vec4 c = texture(tScene, vUv);
  float viewZ = c.a;
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);
  float dist = min(viewZ, 400.0) / max(dot(dir, uCamForward), 1e-3);
  vec3 world = uCamPos + dir * dist;
  vec4 prev = uPrevViewProj * vec4(world, 1.0);
  vec2 prevUv = prev.xy / prev.w * 0.5 + 0.5;
  vec2 vel = (vUv - prevUv) * uStrength;
  float len = length(vel);
  if (len > 0.04) vel *= 0.04 / len; // cap the smear
  vec3 sum = c.rgb;
  for (int i = 1; i < 8; i++) {
    float t = float(i) / 7.0 - 0.5;
    sum += texture(tScene, vUv + vel * t).rgb;
  }
  gl_FragColor = vec4(sum / 8.0, viewZ);
}
`;

// Wet streets mirror the city: for upward-facing pixels, march the reflected ray through
// the depth the scene keeps in alpha and add what it finds, weighted by Fresnel and
// wetness. Additive into the scene target (the alpha, i.e. depth, is left alone).
export const wetReflectFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;   // the opaque scene (rgb) with view distance in alpha
uniform mat4 uInvViewProj;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec2 uTexel;
uniform float uWet;
uniform float uTime;
uniform float uFrame;
uniform int uSteps;   // the march (by quality), each step uGrow times the last: it reaches ~34 m
uniform float uGrow;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
// where the water pools: low-frequency blotches with ragged edges, fixed in the world
float puddle(vec2 xz) {
  float n = vnoise(xz * 0.22) * 0.6 + vnoise(xz * 0.61 + 7.3) * 0.3 + vnoise(xz * 2.3 + 3.1) * 0.1;
  return smoothstep(0.6, 0.66, n);
}
// raindrops landing: an expanding ring per 0.5 m cell, each on its own clock (two layers)
vec2 ripples(vec2 xz, float t) {
  vec2 g = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 p = xz * 2.0 + float(k) * 17.31;
    vec2 c = floor(p);
    vec2 o = vec2(h21(c), h21(c + 3.7)) * 0.6 + 0.2;
    float ph = fract(t * 1.3 + h21(c + 9.1));
    vec2 d = fract(p) - o;
    float r = length(d);
    float ring = r - ph * 0.45;
    float w = sin(ring * 60.0) * exp(-ring * ring * 900.0) * (1.0 - ph);
    g += d / max(r, 1e-3) * w;
  }
  return g * 0.12;
}

vec3 worldAt(vec2 uv, float viewZ) {
  vec4 far = uInvViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);
  return uCamPos + dir * (viewZ / max(dot(dir, uCamForward), 1e-3));
}

void main() {
  float d = texture(tColor, vUv).a;
  if (d <= 0.05 || d > 120.0) { gl_FragColor = vec4(0.0); return; }
  vec3 P = worldAt(vUv, d);
  vec3 Px = worldAt(vUv + vec2(uTexel.x, 0.0), texture(tColor, vUv + vec2(uTexel.x, 0.0)).a);
  vec3 Py = worldAt(vUv + vec2(0.0, uTexel.y), texture(tColor, vUv + vec2(0.0, uTexel.y)).a);
  vec3 N = normalize(cross(Py - P, Px - P));
  if (N.y < 0.0) N = -N;
  if (N.y < 0.9) { gl_FragColor = vec4(0.0); return; }
  // streets are flat enough: a clean mirror, except where raindrops ring the puddles
  // puddles lie on grey ground (asphalt, paving), not on grass, leaves or car roofs
  vec3 base = texture(tColor, vUv).rgb;
  float sat = (max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b))) / max(max(base.r, max(base.g, base.b)), 1e-4);
  float pud = puddle(P.xz) * smoothstep(0.3, 0.8, uWet) * (1.0 - smoothstep(0.2, 0.35, sat)) * step(P.y, uCamPos.y - 1.0);
  vec2 rip = ripples(P.xz, uTime) * pud * smoothstep(25.0, 6.0, d);
  N = normalize(vec3(rip.x, 1.0, rip.y));
  vec3 V = normalize(P - uCamPos);
  vec3 R = reflect(V, N);
  // march the reflected ray in growing steps; a hit is the ray just passing behind the
  // depth there (within a thin shell, so it doesn't snag on the far side of a pole or a
  // leg and smear it), then pinned down by bisection. Passing well behind something keeps
  // going: what's reflected may be further back.
  vec3 hitCol = vec3(0.0);
  float found = 0.0;
  // each pixel starts its march a little differently (TAA averages away the banding)
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 7.31, vec2(0.06711056, 0.00583715))));
  float t = 0.12 * (1.0 + jit * 0.15), prevT = 0.0;
  for (int i = 0; i < 40; i++) {
    if (i >= uSteps) break;
    vec3 q = P + R * t;
    vec4 clip = uViewProj * vec4(q, 1.0);
    if (clip.w <= 0.0) break;
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sceneZ = texture(tColor, uv).a;
    float diff = dot(q - uCamPos, uCamForward) - sceneZ;
    float shell = 0.12 + t * 0.03;
    if (diff > 0.0 && t > 0.3) {
      float lo = prevT, hi = t;
      for (int k = 0; k < 6; k++) {
        float mid = 0.5 * (lo + hi);
        vec3 qm = P + R * mid;
        vec4 cm = uViewProj * vec4(qm, 1.0);
        vec2 um = cm.xy / cm.w * 0.5 + 0.5;
        if (dot(qm - uCamPos, uCamForward) > texture(tColor, um).a) hi = mid; else lo = mid;
      }
      vec3 qh = P + R * hi;
      vec4 ch = uViewProj * vec4(qh, 1.0);
      vec2 uh = ch.xy / ch.w * 0.5 + 0.5;
      vec4 sh = texture(tColor, uh);
      diff = dot(qh - uCamPos, uCamForward) - sh.a;
      // the crossing was behind something thin (a pole, a leg): not what's reflected here
      if (diff > shell) { prevT = t; t *= uGrow; continue; }
      hitCol = sh.rgb;
      vec2 e = min(uh, 1.0 - uh);
      found = clamp(min(e.x, e.y) * 10.0, 0.0, 1.0) * (1.0 - smoothstep(20.0, 34.0, hi)) * (1.0 - diff / shell * 0.5);
      break;
    }
    prevT = t;
    t *= uGrow;
  }
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 5.0);
  // a puddle is a near-perfect mirror and darkens the street under its film of water
  float k = uWet * mix(0.15 + 0.55 * fres, 0.6 + 0.4 * fres, pud);
  float fade = smoothstep(120.0, 80.0, d);
  gl_FragColor = vec4(hitCol * found * k * (1.0 + pud * 0.6), pud * 0.45 * fade);
}
`;

// Rain on the windscreen, seen from the driver's seat: beads that refract the street behind
// them, a few that run down the glass, and a wiper sweeping it clear every so often (the
// beads come back in the time since it passed). Only on what lies beyond the glass (depth),
// so the dashboard stays dry.
export const windscreenFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform float uAmount;
uniform float uTime;
uniform float uAspect;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
const float PERIOD = 1.7;
const float SWEEP = 1.15; // radians either side of straight up
// seconds since the wiper last crossed the angle a (it sweeps as a sine)
float sinceWipe(float a) {
  float s = asin(clamp(a / SWEEP, -1.0, 1.0)) / 6.2831853 * PERIOD;
  float t1 = mod(uTime - s, PERIOD), t2 = mod(uTime - (PERIOD * 0.5 - s), PERIOD);
  return min(t1, t2);
}
void main() {
  vec4 base = texture(tScene, vUv);
  if (base.a < 1.2 || uAmount < 0.01) { gl_FragColor = base; return; } // the cabin: dry
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 pivot = vec2(0.5 * uAspect, -0.15);
  vec2 off = vec2(0.0);
  float wet = 0.0, rim = 0.0, glint = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float scale = layer == 0 ? 9.0 : 17.0;
    vec2 q = p * scale + float(layer) * 7.3;
    vec2 cell = floor(q);
    float rnd = h21(cell);
    // a few of the bigger beads run down the glass
    float run = layer == 0 && rnd > 0.8 ? fract(uTime * (0.15 + rnd * 0.2) + rnd * 9.0) : 0.0;
    vec2 c = vec2(h21(cell + 1.7), h21(cell + 4.1)) * 0.6 + 0.2;
    c.y -= run * 0.9;
    vec2 d = fract(q) - c;
    d.y *= 1.0 + run * 0.6;
    float r = (layer == 0 ? 0.2 : 0.14) * (0.5 + rnd);
    float drop = smoothstep(r, r * 0.6, length(d));
    // gone where the wiper passed a moment ago, back as fresh rain lands
    vec2 cw = (cell + c) / scale - pivot;
    float since = sinceWipe(atan(cw.x, cw.y));
    float there = step(h21(cell + floor(uTime / PERIOD) * 0.13 + 3.0), smoothstep(0.0, PERIOD, since) * uAmount * 0.9);
    drop *= there;
    off += d / max(r, 1e-3) * drop * (layer == 0 ? 0.045 : 0.025);
    wet = max(wet, drop);
    // a darker rim and a glint up on the side the sky lights
    rim = max(rim, drop * (1.0 - smoothstep(r * 0.55, r * 0.85, length(d))) * smoothstep(r * 0.3, r * 0.75, length(d)));
    glint = max(glint, drop * smoothstep(r * 0.35, 0.0, length(d - vec2(-0.3, 0.35) * r)));
  }
  vec4 col = texture(tScene, vUv - off * vec2(1.0 / uAspect, 1.0));
  col.rgb = mix(base.rgb, col.rgb, wet) * (1.0 - rim * 0.35) + glint * 0.6 * (0.3 + dot(base.rgb, vec3(0.3)));
  // the wiper blade itself
  float w = sin(uTime / PERIOD * 6.2831853) * SWEEP;
  vec2 rel = p - pivot;
  float along = dot(rel, vec2(sin(w), cos(w)));
  float across = abs(dot(rel, vec2(cos(w), -sin(w))));
  float blade = (1.0 - smoothstep(0.004, 0.008, across)) * step(0.0, along) * step(along, 0.72) * step(0.05, uAmount);
  col.rgb = mix(col.rgb, vec3(0.015), blade);
  gl_FragColor = vec4(col.rgb, base.a);
}
`;

// Temporal anti-aliasing: every frame is rendered a sub-pixel off (a Halton pattern), and
// blended with last frame's result, found through the depth (view distance in alpha) and
// last frame's camera. The history is clamped to the colours around the pixel now, so
// anything that moved or appeared doesn't smear; the blend is luminance-weighted so bright
// sparks don't flicker. History is sampled with a Catmull-Rom filter to stay sharp.
export const taaFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tCur;
uniform sampler2D tHist;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec2 uTexel;
uniform float uReset;

vec3 worldAt(vec2 uv, float viewZ) {
  vec4 far = uInvViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);
  return uCamPos + dir * (viewZ / max(dot(dir, uCamForward), 1e-3));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// tonemapped space for the clamp and blend: HDR highlights would otherwise dominate
vec3 tm(vec3 c) { return c / (1.0 + luma(c)); }
vec3 itm(vec3 c) { return c / max(1.0 - luma(c), 1e-4); }

vec3 historyCR(vec2 uv) {
  vec2 sp = uv / uTexel;
  vec2 tc = floor(sp - 0.5) + 0.5;
  vec2 f = sp - tc;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 tc0 = (tc - 1.0) * uTexel, tc3 = (tc + 2.0) * uTexel, tc12 = (tc + w2 / w12) * uTexel;
  vec3 c = texture(tHist, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
    + texture(tHist, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
    + texture(tHist, vec2(tc12.x, tc12.y)).rgb * (w12.x * w12.y)
    + texture(tHist, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
    + texture(tHist, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
  float w = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(c / w, 0.0);
}

void main() {
  vec4 cur = texture(tCur, vUv);
  vec3 c = tm(cur.rgb);
  // the neighbourhood now: its colour box, and the nearest depth (edges reproject by the
  // foreground, so a moving object's silhouette doesn't drag the background with it)
  vec3 mn = c, mx = c, m1 = c, m2 = c * c;
  float dNear = cur.a;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    vec4 s = texture(tCur, vUv + vec2(float(x), float(y)) * uTexel);
    vec3 t = tm(s.rgb);
    mn = min(mn, t); mx = max(mx, t);
    m1 += t; m2 += t * t;
    dNear = min(dNear, s.a);
  }
  // variance clipping tightens the box around the real spread of colours
  m1 /= 9.0; m2 /= 9.0;
  vec3 sd = sqrt(max(m2 - m1 * m1, 0.0));
  mn = max(mn, m1 - sd * 1.25); mx = min(mx, m1 + sd * 1.25);

  vec3 P = worldAt(vUv, min(dNear, 9000.0));
  vec4 prev = uPrevViewProj * vec4(P, 1.0);
  vec2 puv = prev.xy / prev.w * 0.5 + 0.5;
  bool inside = prev.w > 0.0 && puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0;
  if (uReset > 0.5 || !inside) { gl_FragColor = cur; return; }
  vec3 h = clamp(tm(historyCR(puv)), mn, mx);
  // trust the history less the further it moved (fast pans blur less)
  float moved = length((puv - vUv) / uTexel);
  float k = mix(0.92, 0.75, clamp(moved / 24.0, 0.0, 1.0));
  vec3 o = mix(c, h, k);
  gl_FragColor = vec4(itm(o), cur.a);
}
`;

// Depth of field through the scope: what's well in front of or behind the point aimed at
// softens with a disc blur sized by how far out of focus it is (view depth in alpha).
// Samples that are themselves in focus don't bleed into a blurred neighbour.
export const dofFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform float uFocus;
uniform float uAmount;
uniform vec2 uTexel;
float coc(float d) {
  d = min(d, 3000.0);
  return clamp(abs(d - uFocus) / max(uFocus, 1.0) * 1.6, 0.0, 1.0) * uAmount;
}
void main() {
  vec4 c = texture(tScene, vUv);
  float r = coc(c.a);
  if (r < 0.02) { gl_FragColor = c; return; }
  vec3 sum = c.rgb;
  float wsum = 1.0;
  const float GOLD = 2.39996;
  for (int i = 1; i < 20; i++) {
    float fi = float(i);
    float rr = sqrt(fi / 20.0) * r * 7.0;
    vec2 o = vec2(cos(fi * GOLD), sin(fi * GOLD)) * rr * uTexel;
    vec4 s = texture(tScene, vUv + o);
    float w = smoothstep(0.0, 0.3, coc(s.a)) + 0.05;
    sum += s.rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, c.a);
}
`;
