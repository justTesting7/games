import * as THREE from 'three';

// The city exports give every facade, shop front and street sign its own material, so even
// batched (one draw per material) the city takes a couple of hundred draws a frame, and a
// draw call is what the frame runs short of. Materials that differ only in their textures
// (same shader, same values, textures of one size and format) can share a draw: their
// textures are stacked into array textures, each instance knows its layer, and the shader
// reads its layer instead of a 2D texture.

// the maps that can come from an array (a bump map is sampled in a helper, and an alpha
// map isn't stacked: those materials are left as they are). Alpha-tested ones are stacked
// too; their shadows are cut out by a depth material that reads the same layers.
export const ARRAY_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];
const UV = { map: 'vMapUv', normalMap: 'vNormalMapUv', roughnessMap: 'vRoughnessMapUv', metalnessMap: 'vMetalnessMapUv', emissiveMap: 'vEmissiveMapUv', aoMap: 'vAoMapUv' };
const CHUNK = { map: 'map_fragment', normalMap: 'normal_fragment_maps', roughnessMap: 'roughnessmap_fragment', metalnessMap: 'metalnessmap_fragment', emissiveMap: 'emissivemap_fragment', aoMap: 'aomap_fragment' };
const STREET = /^(asphalt|pavement|ground|kerb|marking|road_marks.*|ground_.*)$/; // wet streets (weather.js)

function texSig(t) {
  if (!t) return '-';
  const mm = t.mipmaps;
  if (!t.isCompressedTexture || !mm?.length || !mm[0]?.data) return null; // only compressed textures are stacked
  return [t.image.width, t.image.height, t.format, t.type, mm.length, t.colorSpace, t.wrapS, t.wrapT, t.minFilter, t.magFilter,
    t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, t.rotation, t.center.x, t.center.y, t.flipY, t.channel].join(':');
}

// Off on Apple GPUs (Chrome and Safari draw WebGL through ANGLE over Metal): there, drawing
// from big compressed texture arrays is pathologically slow, and while the GPU falls behind
// its memory piles up (Tel Aviv from above: tens of gigabytes, a few frames a second).
let enabled = true;
/** Whether the city may stack its textures into arrays on this GPU (call before chunking). */
export function useArraysFor(renderer) {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  enabled = q?.has('arrays') ? q.get('arrays') !== '0' : !/Apple|Metal/i.test(name); // ?arrays / ?arrays=0 to compare
  return enabled;
}

/**
 * What lets a mesh's material share an array draw with others: null when it can't (no
 * stackable textures, see-through, alpha-tested, bump-mapped). Rain and night change these
 * materials' values at run time, so which of those apply is part of the key.
 */
export function arrayKey(o) {
  if (!enabled) return null;
  const m = o.material;
  if (!m?.isMeshStandardMaterial || m.transparent || m.alphaMap || m.bumpMap || m.lightMap || m.envMap) return null;
  const sigs = ARRAY_MAPS.map((k) => texSig(m[k]));
  if (sigs.includes(null) || sigs.every((s) => s === '-')) return null;
  return ['A', m.type, m.vertexColors, m.side, m.flatShading, m.customProgramCacheKey?.(), m.color.getHex(), m.emissive.getHex(),
    m.emissiveIntensity, m.roughness, m.metalness, m.normalScale.x, m.normalScale.y, m.normalMapType, m.envMapIntensity, m.aoMapIntensity,
    o.userData?.night_emissive ? 1 : 0, STREET.test(m.name || o.name) ? 1 : 0, m.alphaTest, m.shadowSide, ...sigs].join('|');
}

/**
 * Stacks the textures of `layers` (materials of one arrayKey, one per layer) into array
 * textures and turns the first into the shared material: it samples its layer, set per
 * instance in a small texture (setLayers). Returns that material.
 */
export function arrayMaterial(layers) {
  const m = layers[0];
  const arrays = {};
  for (const k of ARRAY_MAPS) {
    const t0 = m[k];
    if (!t0) continue;
    const mipmaps = t0.mipmaps.map((lv, i) => {
      const size = lv.data.length;
      const data = new lv.data.constructor(size * layers.length);
      layers.forEach((mat, j) => data.set(mat[k].mipmaps[i].data, j * size));
      return { data, width: lv.width, height: lv.height };
    });
    const arr = new THREE.CompressedArrayTexture(mipmaps, t0.image.width, t0.image.height, layers.length, t0.format, t0.type);
    for (const p of ['colorSpace', 'wrapS', 'wrapT', 'minFilter', 'magFilter', 'anisotropy', 'generateMipmaps', 'flipY']) arr[p] = t0[p];
    arr.needsUpdate = true;
    arrays[k] = arr;
  }
  const uniforms = { cityLayers: { value: null } };
  for (const k in arrays) uniforms[`city_${k}`] = { value: arrays[k] };
  m.userData.cityArrays = { arrays, uniforms };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    patchShader(sh, uniforms, Object.keys(arrays));
  };
  const key = m.customProgramCacheKey?.bind(m);
  const slots = Object.keys(arrays).join(',');
  m.customProgramCacheKey = () => `${key ? key() : ''}city-array:${slots}`;
  m.needsUpdate = true;
  if (m.alphaTest > 0 && arrays.map) {
    // the shadow of a cut-out (leaves, sign plates): the depth pass reads the same layer's alpha
    const depth = new THREE.MeshDepthMaterial();
    depth.onBeforeCompile = (sh) => patchShader(sh, uniforms, ['map']);
    depth.customProgramCacheKey = () => 'city-array-depth';
    m.userData.cityArrays.depth = depth;
  }
  return m;
}

// The shader reads its instance's layer (vertex: from the layer texture, by draw id) and
// samples the arrays in place of the 2D maps.
function patchShader(sh, uniforms, slots) {
  Object.assign(sh.uniforms, uniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nuniform highp sampler2D cityLayers;\nflat varying float vCityLayer;')
    .replace('#include <batching_vertex>', `#include <batching_vertex>
  {
    int cityId = int(getIndirectIndex(gl_DrawID));
    int cityW = textureSize(cityLayers, 0).x;
    vCityLayer = texelFetch(cityLayers, ivec2(cityId % cityW, cityId / cityW), 0).r;
  }`);
  let decl = '\nflat varying float vCityLayer;';
  let frag = sh.fragmentShader;
  for (const k of slots) {
    decl += `\nuniform highp sampler2DArray city_${k};`;
    const chunk = THREE.ShaderChunk[CHUNK[k]].split(`texture2D( ${k}, ${UV[k]} )`).join(`texture( city_${k}, vec3( ${UV[k]}, vCityLayer ) )`);
    frag = frag.replace(`#include <${CHUNK[k]}>`, chunk);
  }
  sh.fragmentShader = frag.replace('#include <common>', `#include <common>${decl}`);
}

/** The layer of each instance of `mesh` (ids from addInstance) for its array material. */
export function setLayers(mesh, layerOf) {
  const W = 256, n = Math.max(1, layerOf.length), H = Math.ceil(n / W);
  const data = new Float32Array(W * H);
  layerOf.forEach((l, id) => { data[id] = l; });
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  mesh.material.userData.cityArrays.uniforms.cityLayers.value = tex;
}
