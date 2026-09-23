// All GLSL used by the renderer. Everything is rendered in linear HDR and
// tonemapped at the very end.

export const common = /* glsl */ `
precision highp sampler2DArray;
precision highp sampler2DShadow;
#define PI 3.14159265359

uniform sampler2D uSkyTex;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uFogDensity;
uniform float uRain;

vec2 dirToUV(vec3 d) {
  return vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
}
vec3 skyRadiance(vec3 d) { return textureLod(uSkyTex, dirToUV(d), 0.0).rgb; }
vec3 skyIrradiance(vec3 n) { return textureLod(uSkyTex, dirToUV(n), 5.0).rgb; }

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 d = worldPos - cameraPosition;
  float dist = length(d);
  vec3 v = d / dist;
  vec3 fogCol = skyRadiance(normalize(vec3(v.x, max(v.y, 0.0), v.z)));
  float sunAmt = pow(max(dot(v, uSunDir), 0.0), 6.0);
  vec3 scatter = fogCol + uLightColor * sunAmt * 0.12;
  float heightF = exp(-max(worldPos.y - 50.0, 0.0) * 0.025);
  float fogAmt = 1.0 - exp(-dist * uFogDensity * (0.35 + heightF));
  float border = smoothstep(uFogStart, uFogEnd, dist);
  col = mix(col, scatter, fogAmt);
  return mix(col, fogCol, border);
}

uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform float uShadowSoft;

const vec2 POISSON[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457),
  vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480),
  vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064),
  vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

float sampleShadow(vec3 worldPos, vec3 n) {
  float ndl = dot(n, uLightDir);
  vec3 p = worldPos + n * (0.03 + 0.06 * (1.0 - clamp(ndl, 0.0, 1.0)));
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  sc.xyz = sc.xyz / sc.w * 0.5 + 0.5;
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  float a = ign(gl_FragCoord.xy) * 6.2831853;
  mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
  float s = 0.0;
  float r = uShadowTexel * uShadowSoft;
  for (int i = 0; i < 12; i++) {
    s += texture(uShadowMap, vec3(sc.xy + rot * POISSON[i] * r, sc.z - 0.00015));
  }
  s /= 12.0;
  vec2 e = abs(sc.xy - 0.5) * 2.0;
  float fade = smoothstep(0.8, 1.0, max(e.x, e.y));
  return mix(s, 1.0, fade);
}

// Animated caustics: a cheap interference pattern of rotated sine fields.
float caustics(vec2 p, float t) {
  float c = 0.0;
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    q = mat2(0.8, -0.6, 0.6, 0.8) * q * 1.3;
    c += abs(sin(q.x + t * (1.0 + float(i) * 0.3)) + sin(q.y - t * 0.8));
  }
  return pow(max(0.0, 1.0 - c * 0.28), 5.0) * 3.0;
}
`;

export const blockVert = /* glsl */ `
attribute vec4 aData;   // face index, ao, skylight, flags
attribute vec4 aUVL;    // u, v, layer, -
uniform float uTime;
uniform float uWind;

varying vec3 vWorld;
varying vec2 vUV;
varying float vAO;
varying float vSky;
flat varying float vLayer;
flat varying int vFlags;
flat varying vec3 vN;
flat varying vec3 vT;
flat varying vec3 vB;

void faceBasis(int i, out vec3 N, out vec3 T, out vec3 B) {
  if (i == 0) { N = vec3(1,0,0); T = vec3(0,0,-1); B = vec3(0,1,0); }
  else if (i == 1) { N = vec3(-1,0,0); T = vec3(0,0,1); B = vec3(0,1,0); }
  else if (i == 2) { N = vec3(0,1,0); T = vec3(1,0,0); B = vec3(0,0,-1); }
  else if (i == 3) { N = vec3(0,-1,0); T = vec3(1,0,0); B = vec3(0,0,1); }
  else if (i == 4) { N = vec3(0,0,1); T = vec3(1,0,0); B = vec3(0,1,0); }
  else if (i == 5) { N = vec3(0,0,-1); T = vec3(-1,0,0); B = vec3(0,1,0); }
  else { N = vec3(0,1,0); T = vec3(1,0,0); B = vec3(0,0,1); }
}

vec3 windOffset(vec3 p, int flags) {
  vec3 o = vec3(0.0);
  float t = uTime;
  if ((flags & 1) != 0) {
    o.x += sin(t * 1.7 + p.x * 0.7 + p.y * 0.5) * 0.035 + sin(t * 3.3 + p.z * 1.3) * 0.015;
    o.z += cos(t * 1.4 + p.z * 0.6 + p.y * 0.4) * 0.035;
    o.y += sin(t * 2.1 + p.x + p.z) * 0.02;
  }
  if ((flags & 2) != 0) {
    float g = sin(t * 1.3 + p.x * 0.15 + p.z * 0.1) * 0.5 + 0.5;
    o.x += (sin(t * 2.2 + p.x * 0.9 + p.z * 0.4) * 0.09 + 0.05) * (0.6 + g);
    o.z += sin(t * 1.9 + p.z * 0.8) * 0.07 * (0.6 + g);
  }
  return o * uWind;
}

void main() {
  int face = int(aData.x + 0.5);
  vFlags = int(aData.w + 0.5);
  faceBasis(face, vN, vT, vB);
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.xyz += windOffset(world.xyz, vFlags);
  vWorld = world.xyz;
  vUV = aUVL.xy;
  vLayer = aUVL.z;
  vAO = aData.y / 3.0;
  vSky = aData.z / 15.0;
  if (face == 6) vFlags |= 8;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const blockFrag = /* glsl */ `
${common}
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormalTex;
uniform float uSeaLevel;
uniform vec3 uCaveAmbient;

varying vec3 vWorld;
varying vec2 vUV;
varying float vAO;
varying float vSky;
flat varying float vLayer;
flat varying int vFlags;
flat varying vec3 vN;
flat varying vec3 vT;
flat varying vec3 vB;

void main() {
  vec3 uvl = vec3(vUV, vLayer);
  float alpha = textureLod(uAlbedo, uvl, 0.0).a;
  if (alpha < 0.5) discard;
  vec3 albedo = pow(texture(uAlbedo, uvl).rgb, vec3(2.2));
  vec4 nt = texture(uNormalTex, uvl);
  bool plant = (vFlags & 8) != 0;
  bool foliage = plant || (vFlags & 1) != 0;
  bool emissive = (vFlags & 4) != 0;

  vec3 Ng = vN;
  if (!gl_FrontFacing) Ng = -Ng;
  vec3 tn = nt.xyz * 2.0 - 1.0;
  vec3 N = plant ? vec3(0.0, 1.0, 0.0) : normalize(vT * tn.x + vB * tn.y + vN * tn.z);
  float smoothness = nt.a;

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = uLightDir;
  float ndlGeom = dot(plant ? vec3(0.0, 1.0, 0.0) : Ng, L);
  float ndl = plant ? 0.75 : max(dot(N, L), 0.0);

  float shadow = 0.0;
  if (plant || ndlGeom > 0.0) shadow = sampleShadow(vWorld, plant ? L : Ng);
  shadow *= smoothstep(0.0, 0.3, vSky + 0.25);

  vec3 direct = uLightColor * ndl * shadow;
  if (foliage) {
    float back = pow(max(dot(-V, L), 0.0), 4.0);
    direct += uLightColor * shadow * (0.25 + back * 1.2) * 0.5;
  }

  float ao = mix(0.25, 1.0, vAO * vAO);
  float sky = vSky * vSky;
  vec3 ambient = skyIrradiance(N) * 1.0 * sky * ao;
  ambient += skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.12 * ao * sky;
  ambient += uCaveAmbient * ao;

  // Underwater caustics for surfaces below sea level that see the sky.
  if (vWorld.y < uSeaLevel + 0.9 && vSky > 0.2 && vSky < 0.999) {
    float depth = uSeaLevel + 0.9 - vWorld.y;
    float c = caustics(vWorld.xz * 1.6 + L.xz * vWorld.y, uTime * 1.3);
    direct *= exp(-depth * vec3(0.35, 0.09, 0.06));
    direct *= 0.6 + c;
  }

  vec3 H = normalize(L + V);
  float power = exp2(2.0 + smoothness * 9.0);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float spec = pow(max(dot(N, H), 0.0), power) * (power + 2.0) / 8.0 * fres * smoothness;
  vec3 specular = uLightColor * spec * shadow * step(0.0, ndlGeom);

  // Sky reflection on smooth surfaces.
  vec3 R = reflect(-V, N);
  float envF = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 env = skyRadiance(R) * envF * smoothness * smoothness * sky * 0.35;

  vec3 col = albedo * (direct + ambient) + specular + env;
  if (emissive) col = albedo * 5.0 + col * 0.2;

  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, length(vWorld - cameraPosition));
}
`;

export const shadowVert = /* glsl */ `
attribute vec4 aData;
attribute vec4 aUVL;
uniform float uTime;
uniform float uWind;
varying vec2 vUV;
flat varying float vLayer;
${blockVert.match(/vec3 windOffset[\s\S]*?\n}\n/)[0]}
void main() {
  int flags = int(aData.w + 0.5);
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.xyz += windOffset(world.xyz, flags);
  vUV = aUVL.xy;
  vLayer = aUVL.z;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const shadowFrag = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAlbedo;
varying vec2 vUV;
flat varying float vLayer;
void main() {
  if (textureLod(uAlbedo, vec3(vUV, vLayer), 0.0).a < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`;

export const waterVert = /* glsl */ `
attribute vec4 aData;
varying vec3 vWorld;
varying float vSky;
flat varying vec3 vN;
void main() {
  int face = int(aData.x + 0.5);
  vN = face == 0 ? vec3(1,0,0) : face == 1 ? vec3(-1,0,0) : face == 2 ? vec3(0,1,0) :
       face == 3 ? vec3(0,-1,0) : face == 4 ? vec3(0,0,1) : vec3(0,0,-1);
  vSky = aData.z / 15.0;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const waterFrag = /* glsl */ `
${common}
uniform sampler2D uSceneTex;
uniform vec2 uResolution;
uniform mat4 uProj;
uniform int uSSRSteps;
uniform float uUnderwater;

varying vec3 vWorld;
varying float vSky;
flat varying vec3 vN;

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
  h += sin(dot(p, vec2(0.8, 0.6)) * 0.9 + t * 1.3) * 0.05;
  h += sin(dot(p, vec2(-0.5, 0.86)) * 1.6 + t * 1.9) * 0.03;
  h += sin(dot(p, vec2(0.95, -0.3)) * 2.7 + t * 2.4) * 0.015;
  h += gnoise(p * 1.5 + vec2(t * 0.35, t * 0.2)) * 0.05;
  h += gnoise(p * 3.7 - vec2(t * 0.5, -t * 0.3)) * 0.025;
  h += gnoise(p * 8.0 + vec2(t * 0.9, t * 0.6)) * 0.008;
  return h;
}

vec3 waterNormal(vec2 p) {
  float e = 0.05;
  float h = waveHeight(p);
  float hx = waveHeight(p + vec2(e, 0.0));
  float hz = waveHeight(p + vec2(0.0, e));
  return normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
}

vec2 toScreen(vec3 viewPos) {
  vec4 c = uProj * vec4(viewPos, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}

vec4 traceSSR(vec3 worldPos, vec3 R) {
  vec3 vp = (viewMatrix * vec4(worldPos, 1.0)).xyz;
  vec3 vr = normalize((viewMatrix * vec4(R, 0.0)).xyz);
  if (vr.z > 0.2) return vec4(0.0);
  float stepLen = 0.3 + ign(gl_FragCoord.xy) * 0.3;
  vec3 p = vp;
  vec3 prev = vp;
  for (int i = 0; i < 64; i++) {
    if (i >= uSSRSteps) break;
    prev = p;
    p += vr * stepLen;
    stepLen *= 1.12;
    vec2 uv = toScreen(p);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || p.z > -0.1) break;
    float sceneD = texture(uSceneTex, uv).a;
    float d = length(p);
    if (d > sceneD && sceneD < 9000.0) {
      if (d - sceneD > stepLen * 2.5 + 0.5) continue;
      vec3 a = prev, b = p;
      for (int j = 0; j < 6; j++) {
        vec3 m = (a + b) * 0.5;
        vec2 muv = toScreen(m);
        if (length(m) > texture(uSceneTex, muv).a) b = m; else a = m;
      }
      vec2 huv = toScreen(b);
      vec2 edge = smoothstep(vec2(0.0), vec2(0.12), huv) * (1.0 - smoothstep(vec2(0.88), vec2(1.0), huv));
      float conf = edge.x * edge.y * (1.0 - float(i) / float(uSSRSteps));
      return vec4(texture(uSceneTex, huv).rgb, clamp(conf * 1.5, 0.0, 1.0));
    }
  }
  return vec4(0.0);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float surfDist = length(vWorld - cameraPosition);
  bool top = vN.y > 0.5;
  vec3 N = top ? waterNormal(vWorld.xz) : normalize(vN + waterNormal(vWorld.xz + vWorld.y) * 0.15 - vec3(0.0, 1.0, 0.0) * 0.15);
  float detailFade = 1.0 - smoothstep(20.0, 120.0, surfDist);
  N = normalize(mix(top ? vec3(0.0, 1.0, 0.0) : vN, N, 0.35 + 0.65 * detailFade));
  bool below = dot(V, top ? vec3(0.0, 1.0, 0.0) : vN) < 0.0;
  if (below) N = -N;

  vec2 suv = gl_FragCoord.xy / uResolution;
  float ndv = max(dot(N, V), 0.0);

  // Refraction
  vec2 distort = N.xz * 0.05 * detailFade / max(1.0, surfDist * 0.05);
  vec2 ruv = clamp(suv + distort, 0.001, 0.999);
  float sceneD = texture(uSceneTex, ruv).a;
  if (sceneD < surfDist) { ruv = suv; sceneD = texture(uSceneTex, suv).a; }
  vec3 refr = texture(uSceneTex, ruv).rgb;
  float thickness = max(sceneD - surfDist, 0.0);
  if (below) thickness = 0.0;
  vec3 absorb = exp(-thickness * vec3(0.46, 0.11, 0.075));
  vec3 skyAmb = skyIrradiance(vec3(0.0, 1.0, 0.0));
  vec3 scatterCol = vec3(0.01, 0.055, 0.075) * (skyAmb * 1.5 + uLightColor * 0.15) * max(vSky, 0.2);
  vec3 refracted = refr * absorb + scatterCol * (1.0 - exp(-thickness * 0.2));

  // Reflection
  vec3 R = reflect(-V, N);
  if (R.y < 0.0 && !below) R.y = -R.y * 0.3;
  vec3 skyR = skyRadiance(R) * mix(0.25, 1.0, vSky);
  vec4 ssr = uSSRSteps > 0 ? traceSSR(vWorld, R) : vec4(0.0);
  vec3 refl = mix(skyR, ssr.rgb, ssr.a);

  float shadow = sampleShadow(vWorld, vec3(0.0, 1.0, 0.0));
  vec3 H = normalize(uLightDir + V);
  float spec = pow(max(dot(N, H), 0.0), 720.0) * 60.0 + pow(max(dot(N, H), 0.0), 90.0) * 0.8;
  vec3 sunSpec = uLightColor * spec * shadow * step(0.0, uLightDir.y);

  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  if (below) {
    // Seen from below: total internal reflection beyond the critical angle.
    F = ndv < 0.66 ? 1.0 : 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    refl = scatterCol * 2.0;
  }
  vec3 col = mix(refracted, refl, F) + sunSpec * (below ? 0.0 : 1.0);

  if (!below) col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, surfDist);
}
`;

export const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Physically based single-scattering atmosphere (Rayleigh + Mie), baked into
// a small equirectangular HDR texture every frame. Everything else (sky dome,
// fog, ambient light, reflections) samples this texture.
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
  // Lifting grazing rays a little stands in for multiple scattering, which
  // keeps the horizon bright and bluish instead of the muddy brown that
  // single scattering produces.
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.94 + 0.06, dir.z));
  vec3 r0 = vec3(0.0, 6372e3, 0.0);
  vec3 col = atmosphere(d, r0, uSunDir, 22.0);
  col += atmosphere(d, r0, uMoonDir, 0.35) * vec3(0.75, 0.9, 1.3);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += vec3(0.55, 0.7, 1.0) * lum * 0.25 * (1.0 - smoothstep(0.0, 0.5, dir.y));
  col += vec3(0.0006, 0.0009, 0.0018);
  // Below the horizon: fade towards a darker "ground bounce" colour.
  if (dir.y < 0.0) col *= mix(1.0, 0.35, smoothstep(0.0, 0.4, -dir.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const skyFrag = /* glsl */ `
${common}
varying vec2 vUv;
uniform mat4 uInvViewProj;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uCloudCover;

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

  // Sun disc with limb darkening.
  float cs = dot(dir, uSunDir);
  float sunR = 0.99985;
  if (cs > sunR) {
    float x = (cs - sunR) / (1.0 - sunR);
    float limb = pow(x, 0.35);
    col += uSunColor * 90.0 * limb * horizon;
  }
  col += uSunColor * pow(max(cs, 0.0), 1800.0) * 3.0 * horizon;

  // Moon.
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

  // Stars, rotating with the sky.
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

  // Clouds: a 2D layer with self-shadowing and forward scattering.
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
      vec3 cc = uLightColor * lightT * phase * 0.55 + amb * (0.55 + 0.45 * (1.0 - dens));
      float fade = smoothstep(0.0, 0.25, dir.y);
      vec3 hazeCol = skyRadiance(normalize(vec3(dir.x, 0.02, dir.z)));
      cc = mix(hazeCol, cc, smoothstep(0.0, 0.35, dir.y));
      col = mix(col, cc, dens * fade * 0.95);
    }
  }

  gl_FragColor = vec4(col, 10000.0);
}
`;

export const copyFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
void main() { gl_FragColor = texture(tDiffuse, vUv); }
`;

// Call of Duty style 13-tap downsample with Karis average on the first pass.
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
    col = min(col, vec3(200.0));
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
uniform float uRadius;
void main() {
  vec2 r = uTexel * uRadius;
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += (texture(tSrc, vUv + vec2(-r.x, 0)).rgb + texture(tSrc, vUv + vec2(r.x, 0)).rgb +
        texture(tSrc, vUv + vec2(0, -r.y)).rgb + texture(tSrc, vUv + vec2(0, r.y)).rgb) * 2.0;
  c += texture(tSrc, vUv + vec2(-r.x, -r.y)).rgb + texture(tSrc, vUv + vec2(r.x, -r.y)).rgb +
       texture(tSrc, vUv + vec2(-r.x, r.y)).rgb + texture(tSrc, vUv + vec2(r.x, r.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}
`;

// Log-average luminance with temporal eye adaptation.
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
      float w = 1.0 - smoothstep(0.1, 0.75, length(uv - 0.5));
      w = 0.25 + w;
      sum += log(max(l, 1e-4)) * w;
      wsum += w;
    }
  }
  float target = exp(sum / wsum);
  float prev = texture(tPrev, vec2(0.5)).r;
  float speed = target > prev ? 2.2 : 1.1;
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
  float jitter = ign(gl_FragCoord.xy + uFrame * 5.588);
  vec2 uv = vUv + delta * jitter;
  float acc = 0.0;
  float decay = 1.0;
  for (int i = 0; i < N; i++) {
    uv += delta;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sky = step(9000.0, texture(tScene, uv).a);
    vec2 d = (uv - uSunUV) * vec2(uAspect, 1.0);
    float w = exp(-dot(d, d) * 6.0);
    acc += sky * w * decay;
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
uniform vec2 uResolution;

// ACES fitted (Stephen Hill).
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = inM * c;
  c = RRTAndODTFit(c);
  return clamp(outM * c, 0.0, 1.0);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) {
    uv += vec2(sin(uv.y * 24.0 + uTime * 2.0), cos(uv.x * 20.0 + uTime * 1.7)) * 0.0018;
  }
  vec4 s = texture(tScene, uv);
  vec3 col = s.rgb;
  float dist = s.a;

  if (uUnderwater > 0.5) {
    vec3 absorb = exp(-min(dist, 200.0) * vec3(0.30, 0.075, 0.05));
    float fog = 1.0 - exp(-min(dist, 200.0) * 0.06);
    col = col * absorb + uWaterAmbient * fog;
  }

  vec3 bloom = texture(tBloom, uv).rgb;
  col = mix(col, bloom, uBloom);

  float rays = texture(tRays, uv).r;
  col += uLightColor * rays * uRays;

  float avgLum = texture(tLum, vec2(0.5)).r;
  float exposure = uExposureBias * 0.16 / clamp(avgLum, 0.012, 3.0);
  col *= exposure;

  col = aces(col);

  // Gentle grading: a touch of saturation and warm highlights / cool shadows.
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.1);
  col *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.2, 0.8, l));

  vec2 vc = vUv - 0.5;
  col *= 1.0 - dot(vc, vc) * 0.55;

  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const outlineVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const outlineFrag = /* glsl */ `
varying vec3 vWorld;
void main() { gl_FragColor = vec4(vec3(0.004), length(vWorld - cameraPosition)); }
`;
