import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const VENDOR = `${import.meta.env?.BASE_URL || '/'}assets/vendor`;

// Tracks weighted loading tasks so the loading screen can show real progress.
export class Progress {
  constructor(onChange) {
    this.onChange = onChange;
    this.total = 0;
    this.done = 0;
    this.label = '';
  }
  async task(label, weight, fn) {
    this.total += weight;
    this.label = label;
    this.onChange(this);
    try {
      return await fn();
    } finally {
      this.done += weight;
      this.onChange(this);
    }
  }
  get fraction() { return this.total ? this.done / this.total : 0; }
}

export function loadImage(url) {
  // the game's own images come through fetch, so they're taken from the asset cache (assetCache.js)
  const own = typeof location !== 'undefined' && new URL(url, location.href).origin === location.origin;
  const src = own ? fetch(url).then((r) => { if (!r.ok) throw new Error(`Failed to load ${url}`); return r.blob(); }).then((b) => URL.createObjectURL(b)) : Promise.resolve(url);
  return src.then((s) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (s !== url) URL.revokeObjectURL(s); resolve(img); };
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = s;
  }));
}

// Packs several same-sized images into a single mipmapped 2D array texture.
export async function loadTextureArray(urls, size, { srgb = false } = {}) {
  const images = await Promise.all(urls.map(loadImage));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = new Uint8Array(size * size * 4 * images.length);
  images.forEach((img, i) => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    data.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
  });
  const tex = new THREE.DataArrayTexture(data, size, size, images.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.flipY = false;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const gltfLoader = new GLTFLoader();
export function loadGLTF(url) {
  return new Promise((resolve, reject) => gltfLoader.load(url, resolve, undefined, reject));
}

export function modelUrl(id) { return `${VENDOR}/models/${id}/${id}.gltf`; }
export function rpmUrl(name) { return `${VENDOR}/rpm/${name}.glb`; }
