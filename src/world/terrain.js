import * as THREE from 'three';
import { GRID_N, GRID_SPACING, WORLD_SIZE, HALF_WORLD, CHUNK_SIZE, CHUNKS, WORLD_SEED } from './constants.js';
import { heightSampleGLSL } from '../engine/shaders.js';
import { loadTextureArray, VENDOR } from '../engine/assets.js';
import { CITY } from './cityLayout.js';

export const LAYERS = ['sand', 'grass', 'forest', 'rock'];

export function generateHeightmap(mapId = 'island') {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./heightmap.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { worker.terminate(); resolve(e.data); };
    worker.onerror = (e) => { worker.terminate(); reject(e); };
    worker.postMessage({ seed: WORLD_SEED, map: mapId });
  });
}

export async function loadTerrainTextures(map) {
  const pre = map?.id === 'city' ? 'city_' : '';
  const url = (k, t) => `${VENDOR}/textures/${pre}${k}_${t}.jpg`;
  const [albedo, normal, arm] = await Promise.all([
    loadTextureArray(LAYERS.map((k) => url(k, 'diff')), 1024, { srgb: true }),
    loadTextureArray(LAYERS.map((k) => url(k, 'nor')), 1024),
    loadTextureArray(LAYERS.map((k) => url(k, 'arm')), 1024),
  ]);
  return { albedo, normal, arm };
}

// Grid with a downward skirt around its border, which hides cracks between
// neighbouring chunks at different levels of detail.
function chunkGeometry(seg) {
  const n = seg + 1;
  const step = CHUNK_SIZE / seg;
  const pos = [], skirt = [], idx = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      pos.push(-CHUNK_SIZE / 2 + i * step, 0, -CHUNK_SIZE / 2 + j * step);
      skirt.push(0);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const border = [];
  for (let i = 0; i < seg; i++) border.push(i);
  for (let j = 0; j < seg; j++) border.push(j * n + seg);
  for (let i = seg; i > 0; i--) border.push(seg * n + i);
  for (let j = seg; j > 0; j--) border.push(j * n);
  const base = pos.length / 3;
  border.forEach((v) => {
    pos.push(pos[v * 3], 0, pos[v * 3 + 2]);
    skirt.push(1);
  });
  for (let k = 0; k < border.length; k++) {
    const a = border[k], b = border[(k + 1) % border.length];
    const sa = base + k, sb = base + ((k + 1) % border.length);
    idx.push(a, b, sa, b, sb, sa);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1));
  g.setIndex(idx);
  return g;
}

const terrainVertexPars = /* glsl */ `
uniform sampler2D tHeight;
uniform sampler2D tTerrainNormal;
uniform float uWorldSize;
attribute float aSkirt;
varying vec3 vWPos;
${heightSampleGLSL}
`;

const displaceVertex = /* glsl */ `
#include <begin_vertex>
vec3 tWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
transformed.y = sampleHeight(tHeight, tWorld.xz, uWorldSize) - aSkirt * 4.0;
vWPos = vec3(tWorld.x, transformed.y, tWorld.z);
`;

const normalVertex = /* glsl */ `
vec2 tXZ = (modelMatrix * vec4(position, 1.0)).xz;
vec3 objectNormal = textureLod(tTerrainNormal, terrainUV(tXZ, uWorldSize, float(textureSize(tHeight, 0).x)), 0.0).xyz * 2.0 - 1.0;
#ifdef USE_TANGENT
vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;

const terrainFragmentPars = /* glsl */ `
uniform sampler2D tHeight;
uniform sampler2D tTerrainNormal;
uniform sampler2D tBiome;
uniform highp sampler2DArray tAlbedo;
uniform highp sampler2DArray tNormalArr;
uniform highp sampler2DArray tArm;
uniform float uWorldSize;
uniform float uTime;
uniform float uUrban;
uniform float uStreetPitch;
uniform float uBlockW;
uniform float uStreetW;
uniform float uPlazaLawn;
uniform float uPlazaRoad;
varying vec3 vWPos;
${heightSampleGLSL}

float tHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
}
vec3 flatNormal(vec3 tn, vec3 nW, float k) {
  return normalize(vec3(tn.x * k, 0.0, -tn.y * k) + nW);
}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// Splat shading: per-pixel biome weights pick between sand, grass, forest
// floor and rock, with height-based blending, triplanar rock on cliffs,
// macro variation to hide tiling and wet sand at the waterline.
const terrainFragment = /* glsl */ `
float tN = float(textureSize(tHeight, 0).x);
vec2 tuv = terrainUV(vWPos.xz, uWorldSize, tN);
vec4 bio = texture(tBiome, tuv);
vec3 nW = normalize(texture(tTerrainNormal, tuv).xyz * 2.0 - 1.0);
vec2 wuv = vec2(vWPos.x, -vWPos.z);
float macro = tNoise(vWPos.xz * 0.013) * 0.55 + tNoise(vWPos.xz * 0.07) * 0.3 + tNoise(vWPos.xz * 0.31) * 0.15;
float dist = length(vWPos - cameraPosition);

vec2 uvS = wuv * 0.25, uvG = wuv * 0.34 + vec2(macro * 0.15), uvF = wuv * 0.3;
vec3 aS = texture(tAlbedo, vec3(uvS, 0.0)).rgb;
vec3 aG = texture(tAlbedo, vec3(uvG, 1.0)).rgb;
vec3 aF = texture(tAlbedo, vec3(uvF, 2.0)).rgb;
vec3 rS = texture(tArm, vec3(uvS, 0.0)).rgb;
vec3 rG = texture(tArm, vec3(uvG, 1.0)).rgb;
vec3 rF = texture(tArm, vec3(uvF, 2.0)).rgb;
vec3 nS = flatNormal(texture(tNormalArr, vec3(uvS, 0.0)).xyz * 2.0 - 1.0, nW, 1.0);
vec3 nG = flatNormal(texture(tNormalArr, vec3(uvG, 1.0)).xyz * 2.0 - 1.0, nW, 1.0);
vec3 nF = flatNormal(texture(tNormalArr, vec3(uvF, 2.0)).xyz * 2.0 - 1.0, nW, 1.0);
// A second, larger scale sample of the grass breaks up visible repetition.
vec3 aG2 = texture(tAlbedo, vec3(uvG * 0.23 + 0.37, 1.0)).rgb;
aG = mix(aG, aG2, smoothstep(0.35, 0.65, tNoise(vWPos.xz * 0.05)) * 0.6);

vec3 bw = pow(abs(nW), vec3(4.0));
bw /= bw.x + bw.y + bw.z;
vec3 rp = vWPos * 0.16;
vec3 aRx = texture(tAlbedo, vec3(rp.zy, 3.0)).rgb, aRy = texture(tAlbedo, vec3(rp.xz, 3.0)).rgb, aRz = texture(tAlbedo, vec3(rp.xy, 3.0)).rgb;
vec3 rRx = texture(tArm, vec3(rp.zy, 3.0)).rgb, rRy = texture(tArm, vec3(rp.xz, 3.0)).rgb, rRz = texture(tArm, vec3(rp.xy, 3.0)).rgb;
vec3 tnX = texture(tNormalArr, vec3(rp.zy, 3.0)).xyz * 2.0 - 1.0;
vec3 tnY = texture(tNormalArr, vec3(rp.xz, 3.0)).xyz * 2.0 - 1.0;
vec3 tnZ = texture(tNormalArr, vec3(rp.xy, 3.0)).xyz * 2.0 - 1.0;
vec3 wnX = vec3(tnX.xy + nW.zy, abs(nW.x)).zyx; wnX.x *= sign(nW.x);
vec3 wnY = vec3(tnY.xy + nW.xz, abs(nW.y)).xzy; wnY.y *= sign(nW.y);
vec3 wnZ = vec3(tnZ.xy + nW.xy, abs(nW.z)); wnZ.z *= sign(nW.z);
vec3 aR = aRx * bw.x + aRy * bw.y + aRz * bw.z;
vec3 rR = rRx * bw.x + rRy * bw.y + rRz * bw.z;
vec3 nR = normalize(wnX * bw.x + wnY * bw.y + wnZ * bw.z);
aR *= mix(vec3(0.85, 0.82, 0.78), vec3(1.05, 1.0, 0.95), macro);

vec4 wv = vec4(bio.r, bio.g, bio.a, bio.b);
vec4 hv = vec4(lum(aS) + rS.r * 0.3, lum(aG) * 1.5 + rG.r * 0.3, lum(aF) + rF.r * 0.3, lum(aR) * 1.2 + rR.r * 0.5);
vec4 hb = wv * (0.35 + hv);
float hm = max(max(hb.x, hb.y), max(hb.z, hb.w));
vec4 wf = max(hb - hm + 0.15, 0.0) * step(0.004, wv);
wf /= max(wf.x + wf.y + wf.z + wf.w, 1e-4);

vec3 tAlb = aS * wf.x + aG * wf.y + aF * wf.z + aR * wf.w;
vec3 tArmS = rS * wf.x + rG * wf.y + rF * wf.z + rR * wf.w;
vec3 tNrmW = normalize(nS * wf.x + nG * wf.y + nF * wf.z + nR * wf.w);

vec3 grassTint = mix(vec3(0.78, 0.86, 0.55), vec3(1.08, 1.02, 0.78), smoothstep(0.3, 0.75, tNoise(vWPos.xz * 0.02 + 9.0)));
float vegTint = (wf.y + wf.z * 0.5) * (1.0 - uUrban);
tAlb *= mix(vec3(1.0), grassTint, vegTint);
tAlb *= mix(0.82, 1.12, macro);

float wet = (1.0 - uUrban) * (1.0 - smoothstep(0.15, 1.3, vWPos.y + sin(uTime * 0.7 + vWPos.x * 0.1) * 0.15)) * (wf.x + wf.w * 0.5);
tAlb *= mix(1.0, 0.55, wet);
float tRough = mix(tArmS.g, 0.22, wet);
float tAO = mix(tArmS.r, 1.0, 0.3);
tNrmW = normalize(mix(tNrmW, nW, wet * 0.6 + smoothstep(60.0, 300.0, dist) * 0.5));

if (uUrban > 0.5) {
  float pr = length(vWPos.xz);
  if (pr < uPlazaLawn) {
    float gN = tNoise(vWPos.xz * 1.1) * 0.55 + tNoise(vWPos.xz * 3.4 + 4.0) * 0.45;
    tAlb = mix(vec3(0.16, 0.3, 0.1), vec3(0.4, 0.54, 0.16), gN);
    float path = 1.0 - smoothstep(0.12, 0.52, abs(pr - 5.35));
    tAlb = mix(tAlb, vec3(0.34, 0.3, 0.2), path * 0.62);
    float worn = smoothstep(0.64, 0.88, tNoise(vWPos.xz * 0.32 + 2.0));
    tAlb = mix(tAlb, vec3(0.3, 0.28, 0.16), worn * 0.32);
    float wetRing = 1.0 - smoothstep(3.2, 4.4, pr);
    tAlb = mix(tAlb, tAlb * vec3(0.55, 0.62, 0.58), wetRing * 0.55);
    tAlb *= mix(0.88, 1.14, macro);
    tRough = mix(0.9, 0.55, max(path, wetRing * 0.7));
    tNrmW = normalize(mix(tNrmW, nW, 0.35));
  } else if (pr < uPlazaRoad) {
    tAlb *= 0.78;
    float ring = 1.0 - smoothstep(0.08, 0.16, abs(pr - (uPlazaLawn + uPlazaRoad) * 0.5));
    float dash = step(0.4, fract(atan(vWPos.z, vWPos.x) * 12.0));
    tAlb = mix(tAlb, vec3(0.82, 0.7, 0.18), ring * dash * 0.7);
    tRough = mix(tRough, 0.5, ring * dash);
  } else {
  float pitch = uStreetPitch;
  float halfStreet = uStreetW * 0.5;
  float wx = vWPos.x, wz = vWPos.z;
  float rx = abs(mod(wx, pitch)); rx = min(rx, pitch - rx);
  float rz = abs(mod(wz, pitch)); rz = min(rz, pitch - rz);
  float dNS = pitch * 0.5 - rx;
  float dEW = pitch * 0.5 - rz;
  float onNS = 1.0 - smoothstep(halfStreet - 0.2, halfStreet + 0.2, dNS);
  float onEW = 1.0 - smoothstep(halfStreet - 0.2, halfStreet + 0.2, dEW);
  float onRoad = max(onNS, onEW);
  float inter = onNS * onEW;
  tAlb *= mix(1.0, 0.78, onRoad * 0.9);
  float midNS = 1.0 - smoothstep(0.05, 0.13, dNS);
  float midEW = 1.0 - smoothstep(0.05, 0.13, dEW);
  float dashZ = step(0.38, fract(wz * 0.2));
  float dashX = step(0.38, fract(wx * 0.2));
  float paintNS = midNS * (1.0 - inter) * dashZ * onNS;
  float paintEW = midEW * (1.0 - inter) * dashX * onEW;
  float edgeNS = (1.0 - smoothstep(0.07, 0.16, abs(dNS - (halfStreet - 0.55)))) * onNS * (1.0 - inter);
  float edgeEW = (1.0 - smoothstep(0.07, 0.16, abs(dEW - (halfStreet - 0.55)))) * onEW * (1.0 - inter);
  float zebraNS = onNS * (1.0 - inter) * (1.0 - smoothstep(halfStreet + 0.15, halfStreet + 3.4, dEW)) * step(0.42, fract(wx * 0.65));
  float zebraEW = onEW * (1.0 - inter) * (1.0 - smoothstep(halfStreet + 0.15, halfStreet + 3.4, dNS)) * step(0.42, fract(wz * 0.65));
  float yellow = max(paintNS, paintEW);
  float white = max(max(zebraNS, zebraEW), max(edgeNS, edgeEW) * 0.65);
  float paint = max(yellow, white) * 0.82;
  tAlb = mix(tAlb, mix(vec3(0.84, 0.82, 0.74), vec3(0.82, 0.7, 0.18), yellow / max(paint, 1e-4)), paint);
  tRough = mix(tRough, 0.5, paint);
  }
}

diffuseColor.rgb *= tAlb;
`;

export class Terrain {
  constructor(data, textures, { urban = false } = {}) {
    this.urban = urban;
    this.heights = data.heights;
    this.normalsData = data.normals;
    this.biomeData = data.biome;
    this.spawn = data.spawn;
    this.peak = data.peak;
    this.group = new THREE.Group();

    const N = GRID_N;
    this.heightTex = new THREE.DataTexture(this.heights, N, N, THREE.RedFormat, THREE.FloatType);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.needsUpdate = true;
    const rgba = (arr) => {
      const t = new THREE.DataTexture(arr, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      return t;
    };
    this.normalTex = rgba(this.normalsData);
    this.biomeTex = rgba(this.biomeData);

    this.uniforms = {
      tHeight: { value: this.heightTex },
      tTerrainNormal: { value: this.normalTex },
      tBiome: { value: this.biomeTex },
      tAlbedo: { value: textures.albedo },
      tNormalArr: { value: textures.normal },
      tArm: { value: textures.arm },
      uWorldSize: { value: WORLD_SIZE },
      uTime: { value: 0 },
      uUrban: { value: urban ? 1 : 0 },
      uStreetPitch: { value: CITY.pitch },
      uBlockW: { value: CITY.blockW },
      uStreetW: { value: CITY.streetW },
      uPlazaLawn: { value: CITY.plazaLawn },
      uPlazaRoad: { value: CITY.plazaRoad },
    };

    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = terrainVertexPars + shader.vertexShader
        .replace('#include <begin_vertex>', displaceVertex)
        .replace('#include <beginnormal_vertex>', normalVertex);
      shader.fragmentShader = terrainFragmentPars + shader.fragmentShader
        .replace('#include <map_fragment>', terrainFragment)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNrmW, 0.0)).xyz);')
        .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= tAO; reflectedLight.indirectSpecular *= tAO;');
    };
    this.material.customProgramCacheKey = () => (urban ? 'terrain-splat-urban' : 'terrain-splat');

    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = terrainVertexPars + shader.vertexShader.replace('#include <begin_vertex>', displaceVertex);
    };
    this.depthMaterial.customProgramCacheKey = () => 'terrain-depth';

    const levels = [[64, 0], [32, 120], [16, 280], [8, 600]];
    const baseGeos = levels.map(([seg]) => chunkGeometry(seg));
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const x0 = -HALF_WORLD + cx * CHUNK_SIZE, z0 = -HALF_WORLD + cz * CHUNK_SIZE;
        let minH = Infinity, maxH = -Infinity;
        const i0 = Math.round((x0 + HALF_WORLD) / GRID_SPACING), j0 = Math.round((z0 + HALF_WORLD) / GRID_SPACING);
        const span = CHUNK_SIZE / GRID_SPACING;
        for (let j = j0; j <= j0 + span; j++) for (let i = i0; i <= i0 + span; i++) {
          const h = this.heights[j * N + i];
          if (h < minH) minH = h;
          if (h > maxH) maxH = h;
        }
        minH -= 4;
        const lod = new THREE.LOD();
        lod.position.set(x0 + CHUNK_SIZE / 2, 0, z0 + CHUNK_SIZE / 2);
        const sphere = new THREE.Sphere(new THREE.Vector3(0, (minH + maxH) / 2, 0),
          Math.hypot(CHUNK_SIZE / 2, CHUNK_SIZE / 2, (maxH - minH) / 2));
        levels.forEach(([, d], li) => {
          const base = baseGeos[li];
          const g = new THREE.BufferGeometry();
          for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
          g.setIndex(base.index);
          g.boundingSphere = sphere;
          g.boundingBox = new THREE.Box3(new THREE.Vector3(-CHUNK_SIZE / 2, minH, -CHUNK_SIZE / 2), new THREE.Vector3(CHUNK_SIZE / 2, maxH, CHUNK_SIZE / 2));
          const m = new THREE.Mesh(g, this.material);
          m.customDepthMaterial = this.depthMaterial;
          m.receiveShadow = true;
          m.castShadow = li < 2;
          lod.addLevel(m, d);
        });
        this.group.add(lod);
      }
    }
  }

  inBounds(x, z) {
    return Math.abs(x) < HALF_WORLD - 1 && Math.abs(z) < HALF_WORLD - 1;
  }

  heightAt(x, z) {
    const N = GRID_N;
    const gx = Math.min(N - 1.001, Math.max(0, (x + HALF_WORLD) / GRID_SPACING));
    const gz = Math.min(N - 1.001, Math.max(0, (z + HALF_WORLD) / GRID_SPACING));
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h = this.heights;
    const a = h[j * N + i], b = h[j * N + i + 1], c = h[(j + 1) * N + i], d = h[(j + 1) * N + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = GRID_SPACING;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  // Returns sand, grass, rock and forest weights in [0, 1].
  biomeAt(x, z) {
    const N = GRID_N;
    const i = Math.min(N - 1, Math.max(0, Math.round((x + HALF_WORLD) / GRID_SPACING)));
    const j = Math.min(N - 1, Math.max(0, Math.round((z + HALF_WORLD) / GRID_SPACING)));
    const k = (j * N + i) * 4;
    const b = this.biomeData;
    return { sand: b[k] / 255, grass: b[k + 1] / 255, rock: b[k + 2] / 255, forest: b[k + 3] / 255 };
  }

  // Ray march against the heightfield with bisection refinement.
  raycast(origin, dir, maxDist) {
    let step = 0.5;
    let tPrev = 0;
    let t = 0.05;
    while (t < maxDist) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (!this.inBounds(x, z)) return null;
      if (y < this.heightAt(x, z)) {
        let a = tPrev, b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          const px = origin.x + dir.x * m, pz = origin.z + dir.z * m;
          if (origin.y + dir.y * m < this.heightAt(px, pz)) b = m; else a = m;
        }
        return b;
      }
      tPrev = t;
      t += step;
      step = Math.min(step * 1.02, 2.0);
    }
    return null;
  }

  update(time) {
    this.uniforms.uTime.value = time;
  }
}
