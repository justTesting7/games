import * as THREE from 'three';
import { heightSampleGLSL } from '../engine/shaders.js';

// A blade is a tapered strip; x in [-0.5, 0.5] across, y in [0, 1] along.
function bladeGeometry(segments) {
  const pos = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const w = 1 - t * 0.85;
    pos.push(-0.5 * w, t, 0, 0.5 * w, t, 0);
  }
  pos.push(0, 1, 0);
  const idx = [];
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

const grassVertexPars = /* glsl */ `
uniform sampler2D tHeight;
uniform sampler2D tBiome;
uniform highp sampler2DArray tAlbedo;
uniform float uWorldSize;
uniform float uTime;
uniform float uSpacing;
uniform float uSide;
uniform vec2 uTile;
uniform float uInner;
uniform float uOuter;
uniform float uWidth;
uniform float uHeight;
uniform float uDensity;
uniform vec3 uCenter;
uniform vec3 uPlayer;
varying vec3 vGrassColor;
varying float vGrassAO;
varying float vGrassT;
${heightSampleGLSL}
float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}
`;

// Blades sit on a grid snapped to the camera so they never swim as it moves. The grid is
// drawn a tile at a time (uTile: the tile's first cell, from the snapped centre), so the
// tiles out of view or out of the ring's reach aren't drawn at all.
const grassBegin = /* glsl */ `
float gid = float(gl_InstanceID);
vec2 cellIdx = vec2(mod(gid, uSide), floor(gid / uSide)) + uTile;
vec2 cell = floor(uCenter.xz / uSpacing) + cellIdx;
float h1 = gHash(cell), h2 = gHash(cell + 17.31), h3 = gHash(cell + 41.7), h4 = gHash(cell + 7.77);
vec2 root = (cell + vec2(h1, h2)) * uSpacing;
float d = length(root - uCenter.xz);
vec2 tuv = terrainUV(root, uWorldSize, float(textureSize(tHeight, 0).x));
vec4 bio = textureLod(tBiome, tuv, 0.0);
float groundY = sampleHeight(tHeight, root, uWorldSize);
float patchN = gNoise(root * 0.15) * 0.6 + gNoise(root * 0.9) * 0.4;
float density = (bio.g * 1.1 + bio.a * 0.18 - bio.b * 0.8) * uDensity * smoothstep(0.08, 0.35, patchN + bio.g * 0.25);
density *= smoothstep(0.35, 1.2, groundY);
float fadeOut = 1.0 - smoothstep(uOuter * 0.7, uOuter, d);
float fadeIn = smoothstep(uInner, uInner + 3.0, d);
float keep = step(h3, density) * fadeOut * fadeIn;
float bladeH = uHeight * mix(0.45, 1.15, h4) * mix(0.55, 1.2, patchN) * keep;
float bladeW = uWidth * mix(0.7, 1.3, h1);

float yaw = h2 * 6.2831;
vec2 fwd = vec2(cos(yaw), sin(yaw));
vec2 side = vec2(-fwd.y, fwd.x);
float t = position.y;
float windPhase = uTime * 1.6 + dot(root, vec2(0.13, 0.09));
float gust = gNoise(root * 0.04 + vec2(uTime * 0.25, uTime * 0.1));
vec2 windDir = normalize(vec2(1.0, 0.35));
float sway = (sin(windPhase + h1 * 3.0) * 0.25 + gust * 0.9) * 0.35;
vec2 bend = fwd * (0.25 + h3 * 0.35) + windDir * sway;
vec2 away = root - uPlayer.xz;
float pd = length(away);
float push = (1.0 - smoothstep(0.2, 0.9, pd)) * step(abs(uPlayer.y - groundY), 1.5);
bend += (pd > 1e-3 ? away / pd : vec2(0.0)) * push * 1.4;
float lean = t * t;
vec3 transformed = vec3(root.x, groundY, root.y)
  + vec3(side.x, 0.0, side.y) * position.x * bladeW
  + vec3(bend.x, 0.0, bend.y) * lean * bladeH
  + vec3(0.0, t * bladeH * (1.0 - 0.25 * lean * length(bend)), 0.0);

vec3 ga = textureLod(tAlbedo, vec3(root * 0.34, 1.0), 3.0).rgb;
vec3 tint = mix(vec3(0.62, 0.78, 0.36), vec3(0.95, 0.88, 0.55), smoothstep(0.3, 0.8, gNoise(root * 0.02 + 9.0)));
vGrassColor = mix(ga * 1.25, tint * 0.42, 0.35) * mix(0.8, 1.15, h4);
vGrassColor = mix(vGrassColor, vGrassColor * vec3(1.15, 1.05, 0.7), h1 * h1 * 0.6);
vGrassAO = mix(0.35, 1.0, smoothstep(0.0, 0.9, t));
vGrassT = t;
`;

const grassNormal = /* glsl */ `
float gid0 = float(gl_InstanceID);
vec2 cell0 = floor(uCenter.xz / uSpacing) + vec2(mod(gid0, uSide), floor(gid0 / uSide)) + uTile;
float yaw0 = gHash(cell0 + 17.31) * 6.2831;
vec3 bladeN = vec3(-sin(yaw0), 0.0, cos(yaw0));
// Bias the normal towards the sky so the field shades like a soft volume.
vec3 objectNormal = normalize(mix(bladeN + vec3(cos(yaw0), 0.0, sin(yaw0)) * position.x * 0.8, vec3(0.0, 1.0, 0.0), 0.55));
`;

export class Grass {
  constructor(terrain, albedoArray, quality = 1) {
    this.group = new THREE.Group();
    this.meshes = [];
    const common = {
      tHeight: { value: terrain.heightTex },
      tBiome: { value: terrain.biomeTex },
      tAlbedo: { value: albedoArray },
      uWorldSize: terrain.uniforms.uWorldSize,
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uPlayer: { value: new THREE.Vector3(0, -1000, 0) },
    };
    this.common = common;
    const rings = [
      { spacing: 0.085, outer: 18, inner: 0, width: 0.045, height: 0.55, segments: 5, density: 1.0, tile: 6 },
      { spacing: 0.2, outer: 48, inner: 14, width: 0.1, height: 0.6, segments: 3, density: 0.9, tile: 16 },
    ];
    this.terrain = terrain;
    this.tiles = [];
    for (const r of rings) {
      const spacing = r.spacing / Math.sqrt(quality);
      const m = Math.ceil(r.tile / spacing); // cells along a tile
      const n = Math.ceil((r.outer * 2) / (m * spacing)); // tiles along the ring's square
      const geo = bladeGeometry(r.segments);
      geo.instanceCount = m * m;
      const shared = {
        ...common,
        uSpacing: { value: spacing },
        uSide: { value: m },
        uInner: { value: r.inner },
        uOuter: { value: r.outer },
        uWidth: { value: r.width * Math.sqrt(r.spacing / spacing) },
        uHeight: { value: r.height },
        uDensity: { value: r.density },
      };
      for (let tz = 0; tz < n; tz++) for (let tx = 0; tx < n; tx++) {
        // each tile its own material (one program for all): its first cell is its own uniform
        const uniforms = { ...shared, uTile: { value: new THREE.Vector2(tx * m - (n * m) / 2, tz * m - (n * m) / 2) } };
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
        mat.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = grassVertexPars + shader.vertexShader
            .replace('#include <beginnormal_vertex>', grassNormal)
            .replace('#include <begin_vertex>', grassBegin)
            .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;')
            .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);')
            .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * objectNormal;')
            .replace('#include <normal_vertex>', `
              #ifndef FLAT_SHADED
                vNormal = normalize(mat3(viewMatrix) * objectNormal);
              #endif`);
          shader.fragmentShader = `
            varying vec3 vGrassColor;
            varying float vGrassAO;
            varying float vGrassT;
          ` + shader.fragmentShader
            .replace('#include <map_fragment>', 'diffuseColor.rgb = vGrassColor;')
            .replace('#include <aomap_fragment>', `
              reflectedLight.indirectDiffuse *= vGrassAO;
              reflectedLight.directDiffuse *= mix(0.55, 1.0, vGrassAO);
              reflectedLight.indirectSpecular *= vGrassAO;
              reflectedLight.directDiffuse += reflectedLight.directDiffuse * vGrassT * 0.35;`);
        };
        mat.customProgramCacheKey = () => `grass-${r.segments}`;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false; // culled here, by tile (see update)
        mesh.receiveShadow = true;
        this.meshes.push(mesh);
        this.group.add(mesh);
        this.tiles.push({ mesh, tx, tz, m, n, spacing, inner: r.inner, outer: r.outer });
      }
    }
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._s = new THREE.Sphere();
  }

  /** camera (optional): tiles out of its view, or out of their ring's reach, aren't drawn. */
  update(time, center, player, camera = null) {
    this.common.uTime.value = time;
    this.common.uCenter.value.copy(center);
    if (player) this.common.uPlayer.value.copy(player);
    const F = this._frustum;
    if (camera) F.setFromProjectionMatrix(this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const t of this.tiles) {
      const sp = t.spacing, size = t.m * sp;
      const x0 = (Math.floor(center.x / sp) + t.tx * t.m - (t.n * t.m) / 2) * sp;
      const z0 = (Math.floor(center.z / sp) + t.tz * t.m - (t.n * t.m) / 2) * sp;
      const cx = x0 + size / 2, cz = z0 + size / 2;
      // the nearest and farthest the tile's ground comes to the centre
      const nx = Math.max(x0 - center.x, 0, center.x - (x0 + size)), nz = Math.max(z0 - center.z, 0, center.z - (z0 + size));
      const fx = Math.max(Math.abs(x0 - center.x), Math.abs(x0 + size - center.x)), fz = Math.max(Math.abs(z0 - center.z), Math.abs(z0 + size - center.z));
      let on = Math.hypot(nx, nz) < t.outer && Math.hypot(fx, fz) > t.inner;
      if (on && camera) {
        this._s.center.set(cx, this.terrain.heightAt(cx, cz) + 0.5, cz);
        this._s.radius = size * 0.71 + 3;
        on = F.intersectsSphere(this._s);
      }
      t.mesh.visible = on;
    }
  }
}
