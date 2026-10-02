import * as THREE from 'three';

// The city exports give every facade, shop front and street sign its own material, so even
// batched (one draw per material) the city takes a couple of hundred draws a frame, and a
// draw call is what the frame runs short of. Materials that differ only in their textures
// (same shader, same values, textures of one size and format) can share a draw: their
// textures are stacked into array textures, each instance knows its layer, and the shader
// reads its layer instead of a 2D texture.

// the maps that can come from an array (a bump map is sampled in a helper, an alpha map
// also drives the shadow pass: those materials are left as they are)
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

/**
 * What lets a mesh's material share an array draw with others: null when it can't (no
 * stackable textures, see-through, alpha-tested, bump-mapped). Rain and night change these
 * materials' values at run time, so which of those apply is part of the key.
 */
export function arrayKey(o) {
  const m = o.material;
  if (!m?.isMeshStandardMaterial || m.transparent || m.alphaTest > 0 || m.alphaMap || m.bumpMap || m.lightMap || m.envMap) return null;
  const sigs = ARRAY_MAPS.map((k) => texSig(m[k]));
  if (sigs.includes(null) || sigs.every((s) => s === '-')) return null;
  return ['A', m.type, m.vertexColors, m.side, m.flatShading, m.customProgramCacheKey?.(), m.color.getHex(), m.emissive.getHex(),
    m.emissiveIntensity, m.roughness, m.metalness, m.normalScale.x, m.normalScale.y, m.normalMapType, m.envMapIntensity, m.aoMapIntensity,
    o.userData?.night_emissive ? 1 : 0, STREET.test(m.name || o.name) ? 1 : 0, ...sigs].join('|');
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
    for (const k in arrays) {
      decl += `\nuniform highp sampler2DArray city_${k};`;
      const chunk = THREE.ShaderChunk[CHUNK[k]].split(`texture2D( ${k}, ${UV[k]} )`).join(`texture( city_${k}, vec3( ${UV[k]}, vCityLayer ) )`);
      frag = frag.replace(`#include <${CHUNK[k]}>`, chunk);
    }
    sh.fragmentShader = frag.replace('#include <common>', `#include <common>${decl}`);
  };
  const key = m.customProgramCacheKey?.bind(m);
  const slots = Object.keys(arrays).join(',');
  m.customProgramCacheKey = () => `${key ? key() : ''}city-array:${slots}`;
  m.needsUpdate = true;
  return m;
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
