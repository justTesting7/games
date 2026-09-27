import * as THREE from 'three';
import * as S from './shaders.js';
import { patchShaderChunks } from './patch.js';

const R0 = 6372e3, R_PLANET = 6371e3, R_ATMOS = 6471e3;
const K_RLH = [5.5e-6, 13.0e-6, 22.4e-6], K_MIE = 21e-6;
export const SUN_INTENSITY = 25;

// CPU version of the optical depth integral, used for the direct sun colour.
function transmittance(dir, out) {
  if (dir.y < -0.12) return out.set(0, 0, 0);
  const b = 2 * R0 * dir.y;
  const c = R0 * R0 - R_ATMOS * R_ATMOS;
  const t = (-b + Math.sqrt(b * b - 4 * c)) / 2;
  const steps = 32;
  const ds = t / steps;
  let odR = 0, odM = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) * ds;
    const px = dir.x * s, py = R0 + dir.y * s, pz = dir.z * s;
    const h = Math.sqrt(px * px + py * py + pz * pz) - R_PLANET;
    if (h < 0) return out.set(0, 0, 0);
    odR += Math.exp(-h / 8e3) * ds;
    odM += Math.exp(-h / 1.2e3) * ds;
  }
  return out.set(
    Math.exp(-(K_RLH[0] * odR + K_MIE * 1.1 * odM)),
    Math.exp(-(K_RLH[1] * odR + K_MIE * 1.1 * odM)),
    Math.exp(-(K_RLH[2] * odR + K_MIE * 1.1 * odM)),
  );
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function canColorBuffer(renderer, type) {
  const gl = renderer.getContext();
  const rt = new THREE.WebGLRenderTarget(4, 4, {
    type, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false,
  });
  try {
    renderer.setRenderTarget(rt);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    renderer.setRenderTarget(null);
    rt.dispose();
    return ok;
  } catch {
    rt.dispose();
    return false;
  }
}

function pickHdrType(renderer) {
  if (canColorBuffer(renderer, THREE.HalfFloatType)) return THREE.HalfFloatType;
  if (canColorBuffer(renderer, THREE.FloatType)) return THREE.FloatType;
  return THREE.UnsignedByteType;
}

function hdrTarget(w, h, type, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
    ...opts,
  });
}

class FullscreenQuad {
  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.mesh.frustumCulled = false;
  }
  render(renderer, material, target) {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, this.camera);
  }
}

function fsMaterial(frag, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: S.fullscreenVert,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });
}

// The stadium is small next to the island, so one shadow map covers the whole
// bowl: the roof's shade falls across the pitch as it does on match day.
export const QUALITY = {
  low: { label: 'Low', shadow: 2048, msaa: 0, pixelRatio: 0.75, crowd: 0.45, sharpen: 0.1 },
  medium: { label: 'Medium', shadow: 4096, msaa: 2, pixelRatio: 1, crowd: 0.75, sharpen: 0.18 },
  high: { label: 'High', shadow: 4096, msaa: 4, pixelRatio: 1, crowd: 1, sharpen: 0.22 },
  ultra: { label: 'Ultra', shadow: 8192, msaa: 4, pixelRatio: 1.5, crowd: 1, sharpen: 0.15 },
};

export class Pipeline {
  constructor(renderer) {
    patchShaderChunks();
    this.renderer = renderer;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x05080b, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.hdrType = pickHdrType(renderer);
    const gl = renderer.getContext();
    this.maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;

    this.quad = new FullscreenQuad();
    this.scene = new THREE.Scene();
    this.fxScene = new THREE.Scene();

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.sunColor = new THREE.Vector3();
    this.lightColor = new THREE.Vector3();
    this.night = 0;
    this.frame = 0;
    this.firstFrame = true;
    this.envAge = Infinity;
    this.shadowCenter = new THREE.Vector3();
    this.shadowRadius = 150;

    this.skyRT = hdrTarget(256, 128, this.hdrType, {
      minFilter: THREE.LinearMipmapLinearFilter,
      generateMipmaps: true,
      wrapS: THREE.RepeatWrapping,
    });
    this.skyRT.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.u = {
      uSkyTex: { value: this.skyRT.texture },
      uLightDir: { value: this.lightDir },
      uLightColor: { value: this.lightColor },
      uSunDir: { value: this.sunDir },
      uTime: { value: 0 },
    };

    this.skyGenMaterial = fsMaterial(S.skyGenFrag, {
      uSunDir: this.u.uSunDir,
      uMoonDir: { value: this.moonDir },
    });

    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: S.fullscreenVert,
      fragmentShader: S.skyFrag,
      uniforms: {
        ...this.u,
        uInvViewProj: { value: new THREE.Matrix4() },
        uMoonDir: { value: this.moonDir },
        uSunColor: { value: this.sunColor },
        uNight: { value: 0 },
        uCloudCover: { value: 0.52 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.skyMaterial);
    this.skyMesh.frustumCulled = false;

    this.fogMaterial = fsMaterial(S.fogFrag, {
      uSkyTex: this.u.uSkyTex,
      tScene: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uCamForward: { value: new THREE.Vector3() },
      uSunDir: this.u.uLightDir,
      uLightColor: this.u.uLightColor,
      uFogDensity: { value: 0.0009 },
      uFogFalloff: { value: 0.02 },
    });
    this.bloomDown = fsMaterial(S.bloomDownFrag, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: false },
    });
    this.bloomUp = fsMaterial(S.bloomUpFrag, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    }, { blending: THREE.AdditiveBlending, transparent: true });
    this.lumMaterial = fsMaterial(S.lumFrag, {
      tScene: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uReset: { value: true },
    });
    this.raysMaterial = fsMaterial(S.godraysFrag, {
      tScene: { value: null }, uSunUV: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uFrame: { value: 0 },
    });
    this.compositeMaterial = fsMaterial(S.compositeFrag, {
      tScene: { value: null },
      tBloom: { value: null },
      tLum: { value: null },
      tRays: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uLightColor: { value: this.lightColor },
      uBloom: { value: 0.035 },
      uRays: { value: 0 },
      uSharpen: { value: 0.2 },
      uExposureBias: { value: 1.0 },
      uAutoExposure: { value: 1 },
      uVignette: { value: 0.35 },
      uFlash: { value: 0 },
    });

    this.lumRT = [0, 1].map(() => hdrTarget(1, 1, this.hdrType, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    this.lumIndex = 0;

    this.size = new THREE.Vector2(1, 1);
    this.quality = null;
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  setQuality(name) {
    const q = { ...QUALITY[name] };
    q.msaa = Math.min(q.msaa, this.maxSamples);
    this.qualityName = name;
    const changedMsaa = !this.quality || this.quality.msaa !== q.msaa;
    this.quality = q;
    const sh = this.sun.shadow;
    const maxTex = this.renderer.capabilities.maxTextureSize || 4096;
    const size = Math.min(q.shadow, maxTex);
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      sh.map?.dispose();
      sh.map = null;
    }
    this.compositeMaterial.uniforms.uSharpen.value = q.sharpen;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * q.pixelRatio);
    if (changedMsaa && this.sceneRT) { this.sceneRT.dispose(); this.sceneRT = null; }
    this.resize(Math.max(2, window.innerWidth || 360), Math.max(2, window.innerHeight || 640));
  }

  setShadowBounds(center, radius) {
    this.shadowCenter.copy(center);
    this.shadowRadius = radius;
  }

  resize(w, h) {
    w = Math.max(2, Math.round(w) || 2);
    h = Math.max(2, Math.round(h) || 2);
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    const W = Math.max(2, Math.min(4096, Math.floor(w * pr))), H = Math.max(2, Math.min(4096, Math.floor(h * pr)));
    this.size.set(W, H);
    if (!this.sceneRT) {
      this.sceneRT = hdrTarget(W, H, this.hdrType, { depthBuffer: true, samples: this.quality.msaa });
    } else this.sceneRT.setSize(W, H);
    if (!this.fogRT) this.fogRT = hdrTarget(W, H, this.hdrType); else this.fogRT.setSize(W, H);

    this.bloomRTs?.forEach((r) => r.dispose());
    this.bloomRTs = [];
    let bw = W, bh = H;
    for (let i = 0; i < 5; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.bloomRTs.push(hdrTarget(bw, bh, this.hdrType));
    }
    const rw = Math.max(1, W >> 1), rh = Math.max(1, H >> 1);
    if (!this.raysRT) this.raysRT = hdrTarget(rw, rh, this.hdrType); else this.raysRT.setSize(rw, rh);
    if (!this.blackRT) this.blackRT = hdrTarget(2, 2, this.hdrType);
    this.compositeMaterial.uniforms.uTexel.value.set(1 / W, 1 / H);
  }

  // t in [0, 1) is the fraction of a day; 0.25 is noon-ish in this model.
  setTimeOfDay(t, elapsed) {
    this.u.uTime.value = elapsed;
    const a = t * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.55).normalize();
    this.moonDir.copy(this.sunDir).negate();
    const tmp = this._v;
    transmittance(this.sunDir, tmp);
    const sunF = smoothstep(-0.03, 0.04, this.sunDir.y);
    const moonF = smoothstep(-0.03, 0.04, this.moonDir.y);
    this.sunColor.copy(tmp).multiplyScalar(sunF);
    if (this.sunDir.y > 0) {
      this.lightDir.copy(this.sunDir);
      this.lightColor.copy(tmp).multiplyScalar(SUN_INTENSITY * sunF);
    } else {
      this.lightDir.copy(this.moonDir);
      transmittance(this.moonDir, tmp);
      this.lightColor.copy(tmp).multiply(new THREE.Vector3(0.55, 0.7, 1.0)).multiplyScalar(0.12 * Math.PI * moonF);
    }
    const lc = this.lightColor;
    const li = Math.max(lc.x, lc.y, lc.z);
    this.sun.intensity = li;
    if (li > 0) this.sun.color.setRGB(lc.x / li, lc.y / li, lc.z / li, THREE.LinearSRGBColorSpace);
    this.sun.castShadow = li > 1e-3;
    this.night = smoothstep(0.08, -0.18, this.sunDir.y);
  }

  updateShadowCamera() {
    const L = this.lightDir;
    const cam = this.sun.shadow.camera;
    const d = this.shadowRadius;
    if (cam.right !== d) {
      Object.assign(cam, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 900 });
      cam.updateProjectionMatrix();
    }
    const up = Math.abs(L.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, L).normalize();
    const upL = new THREE.Vector3().crossVectors(L, right);
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const center = this.shadowCenter;
    const r = Math.round(center.dot(right) / texel) * texel;
    const u = Math.round(center.dot(upL) / texel) * texel;
    const f = center.dot(L);
    const snapped = new THREE.Vector3().addScaledVector(right, r).addScaledVector(upL, u).addScaledVector(L, f);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(L, 450);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  render(camera, dt, opts = {}) {
    const r = this.renderer;
    const W = this.size.x, H = this.size.y;
    this.frame++;
    r.autoClear = false;

    if (this.firstFrame || this.frame % 6 === 1) this.quad.render(r, this.skyGenMaterial, this.skyRT);
    this.envAge += dt;
    if (this.envAge > 2 || !this.envRT) {
      this.envAge = 0;
      try {
        this.envRT = this.pmrem.fromEquirectangular(this.skyRT.texture, this.envRT);
        this.scene.environment = this.envRT.texture;
      } catch {
        this.scene.environment = null;
      }
    }

    this.updateShadowCamera();

    camera.updateMatrixWorld();
    const vp = this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const invVP = vp.clone().invert();
    this.skyMaterial.uniforms.uInvViewProj.value.copy(invVP);
    this.skyMaterial.uniforms.uNight.value = this.night;
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.skyMesh, camera);
    r.render(this.scene, camera);
    r.render(this.fxScene, camera);

    const fu = this.fogMaterial.uniforms;
    fu.tScene.value = this.sceneRT.texture;
    fu.uInvViewProj.value.copy(invVP);
    fu.uCamPos.value.copy(camera.position);
    camera.getWorldDirection(fu.uCamForward.value);
    this.quad.render(r, this.fogMaterial, this.fogRT);
    const sceneTex = this.fogRT.texture;

    let src = sceneTex;
    let sw = W, sh = H;
    for (let i = 0; i < this.bloomRTs.length; i++) {
      const u = this.bloomDown.uniforms;
      u.tSrc.value = src;
      u.uTexel.value.set(1 / sw, 1 / sh);
      u.uFirst.value = i === 0;
      this.quad.render(r, this.bloomDown, this.bloomRTs[i]);
      src = this.bloomRTs[i].texture;
      sw = this.bloomRTs[i].width; sh = this.bloomRTs[i].height;
    }

    const prev = this.lumRT[this.lumIndex];
    const next = this.lumRT[1 - this.lumIndex];
    const lu = this.lumMaterial.uniforms;
    lu.tScene.value = this.bloomRTs[2].texture;
    lu.tPrev.value = prev.texture;
    lu.uDt.value = Math.min(dt, 0.1);
    lu.uReset.value = this.firstFrame;
    this.quad.render(r, this.lumMaterial, next);
    this.lumIndex = 1 - this.lumIndex;
    const lumTex = next.texture;

    for (let i = this.bloomRTs.length - 2; i >= 0; i--) {
      const u = this.bloomUp.uniforms;
      const s = this.bloomRTs[i + 1];
      u.tSrc.value = s.texture;
      u.uTexel.value.set(1 / s.width, 1 / s.height);
      this.quad.render(r, this.bloomUp, this.bloomRTs[i]);
    }
    const bloomTex = this.bloomRTs[0].texture;

    let rays = 0;
    let raysTex = this.blackRT.texture;
    const lightPos = camera.position.clone().addScaledVector(this.lightDir, 1000).project(camera);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).dot(this.lightDir);
    if (facing > 0 && lightPos.z < 1) {
      const onScreen = 1 - smoothstep(0.9, 1.6, Math.max(Math.abs(lightPos.x), Math.abs(lightPos.y)));
      rays = onScreen * smoothstep(0.0, 0.35, facing);
      const ru = this.raysMaterial.uniforms;
      ru.tScene.value = sceneTex;
      ru.uSunUV.value.set(lightPos.x * 0.5 + 0.5, lightPos.y * 0.5 + 0.5);
      ru.uAspect.value = W / H;
      ru.uFrame.value = this.frame % 64;
      this.quad.render(r, this.raysMaterial, this.raysRT);
      raysTex = this.raysRT.texture;
    }
    this.firstFrame = false;

    const cu = this.compositeMaterial.uniforms;
    cu.tScene.value = sceneTex;
    cu.tBloom.value = bloomTex;
    cu.tLum.value = lumTex;
    cu.tRays.value = raysTex;
    cu.uRays.value = rays * 1.2;
    cu.uFlash.value = opts.flash || 0;
    this.quad.render(r, this.compositeMaterial, null);
  }
}
