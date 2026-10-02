import * as THREE from 'three';
import { Haze, Shockwaves } from './haze.js';
import * as S from './shaders.js';
import { patchShaderChunks } from './patch.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

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

export const QUALITY = {
  low: { label: 'Low', shadow: 512, shadowDist: 28, ssr: 0, msaa: 0, ao: 0, fxaa: false, pixelRatio: 0.7, grass: 0.3, trees: 0.45 },
  medium: { label: 'Medium', shadow: 2048, shadowDist: 64, farShadow: 2048, farDist: 260, ssr: 8, msaa: 0, ao: 8, fxaa: true, taa: true, pixelRatio: 1, grass: 0.55, trees: 0.7 },
  high: { label: 'High', shadow: 4096, shadowDist: 90, farShadow: 2048, farDist: 320, ssr: 16, msaa: 0, ao: 12, fxaa: true, smaa: true, taa: true, pixelRatio: 1, grass: 0.85, trees: 0.9 },
  ultra: { label: 'Ultra', shadow: 4096, shadowDist: 110, farShadow: 4096, farDist: 400, ssr: 24, msaa: 2, ao: 16, fxaa: true, smaa: true, taa: true, pixelRatio: 1.25, grass: 1.1, trees: 1.05 },
};

export class Pipeline {
  constructor(renderer) {
    patchShaderChunks();
    this.renderer = renderer;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x05080b, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.mobile = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
      || /iPhone|iPad|iPod|Android/i.test(globalThis.navigator?.userAgent || '');
    // Phones often report half-float as complete, then sample Inf/NaN and
    // the tonemap goes solid white. 8-bit targets stay visible.
    this.hdrType = this.mobile ? THREE.UnsignedByteType : pickHdrType(renderer);

    this.quad = new FullscreenQuad();
    this.scene = new THREE.Scene();
    this.waterScene = new THREE.Scene();
    this.haze = new Haze(this.waterScene); // drawn with the water: both read the opaque copy
    // shared with the effect particles (game/fx.js): scene depth for soft edges, the sun for lighting
    this.fxUniforms = { tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uSunView: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 } };
    this.waves = new Shockwaves(this.waterScene);
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

    this.skyRT = hdrTarget(256, 128, this.hdrType, {
      minFilter: THREE.LinearMipmapLinearFilter,
      generateMipmaps: true,
      wrapS: THREE.RepeatWrapping,
    });
    this.skyRT.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    if (this.mobile) {
      this.hemi = new THREE.HemisphereLight(0xb8c8dc, 0x3d4034, 0.45);
      this.scene.add(this.hemi);
    }
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);
    // the far shadow cascade: casts a coarse shadow far out and adds no light (patch.js)
    if (!this.mobile) {
      this.farSun = new THREE.DirectionalLight(0xffffff, 0);
      this.farSun.castShadow = true;
      this.farSun.shadow.bias = -0.0005; // depth units: ~0.8 m over the 1600 m range
      this.farSun.shadow.normalBias = 0.12;
      this.farSun.shadow.radius = 1;
      this.farSun.shadow.autoUpdate = false;
      this.scene.add(this.farSun, this.farSun.target);
    }

    // Muzzle flashes reuse a single light that is always present, so toggling
    // it never changes the light count and never triggers shader recompiles.
    this.flashLight = new THREE.PointLight(0xffb060, 0, 14, 2);
    this.scene.add(this.flashLight);
    // the strongest fire nearby (a burning car, a blast site) flickers on its surroundings;
    // always in the scene so lighting a fire never recompiles the materials
    this.fireLight = new THREE.PointLight(0xff7a2a, 0, 18, 2);
    this.scene.add(this.fireLight);

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
      uBounce: { value: new THREE.Vector3() },
    });
    this.indoorSkyMaterial = fsMaterial(S.indoorSkyFrag, {});

    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: S.fullscreenVert,
      fragmentShader: S.skyFrag,
      uniforms: {
        ...this.u,
        uInvViewProj: { value: new THREE.Matrix4() },
        uMoonDir: { value: this.moonDir },
        uSunColor: { value: this.sunColor },
        uNight: { value: 0 },
        uCloudCover: { value: 0.5 },
        uLightning: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.skyMaterial);
    this.skyMesh.frustumCulled = false;

    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: S.waterVert,
      fragmentShader: S.waterFrag,
      uniforms: {
        ...this.u,
        uSceneTex: { value: null },
        uHeightTex: { value: null },
        uWorldSize: { value: 1 },
        uResolution: { value: new THREE.Vector2() },
        uProj: { value: new THREE.Matrix4() },
        uSSRSteps: { value: 32 },
      },
      side: THREE.DoubleSide,
    });

    this.copyMaterial = fsMaterial(S.copyFrag, { tDiffuse: { value: null } });
    this.fogMaterial = fsMaterial(S.fogFrag, {
      uSkyTex: this.u.uSkyTex,
      tScene: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uCamForward: { value: new THREE.Vector3() },
      uSunDir: this.u.uLightDir,
      uLightColor: this.u.uLightColor,
      uFogDensity: { value: 0.0016 },
      uFogFalloff: { value: 0.012 },
      uUnderwater: { value: 0 },
      tAO: { value: null },
      uAO: { value: 0 },
    });
    this.aoMaterial = fsMaterial(S.aoFrag, {
      tDepth: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uProj: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 1.3 },
      uIntensity: { value: 0.6 },
      uMaxDist: { value: 140 },
    }, { defines: { AO_SAMPLES: 8 } });
    this.fxaaMaterial = fsMaterial(FXAAShader.fragmentShader, {
      tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) },
    });
    this.aoBlurMaterial = fsMaterial(S.aoBlurFrag, { tAO: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.taaMaterial = fsMaterial(S.taaFrag, {
      tCur: { value: null }, tHist: { value: null }, uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uCamForward: { value: new THREE.Vector3() }, uTexel: { value: new THREE.Vector2() }, uReset: { value: 1 },
    });
    this.taaIndex = 0;
    this.taaPrevVP = new THREE.Matrix4();
    this._unjP = new THREE.Matrix4();
    this.dofMaterial = fsMaterial(S.dofFrag, {
      tScene: { value: null }, uFocus: { value: 10 }, uAmount: { value: 0 }, uTexel: { value: new THREE.Vector2() },
    });
    this.windMaterial = fsMaterial(S.windscreenFrag, {
      tScene: { value: null }, uAmount: { value: 0 }, uTime: this.u.uTime, uAspect: { value: 1 },
    });
    this.motionMaterial = fsMaterial(S.motionBlurFrag, {
      tScene: { value: null }, uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uCamForward: { value: new THREE.Vector3() }, uStrength: { value: 0 },
    });
    this.prevViewProj = new THREE.Matrix4();
    this.wetMaterial = fsMaterial(S.wetReflectFrag, {
      tColor: { value: null }, uInvViewProj: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uCamForward: { value: new THREE.Vector3() },
      uTexel: { value: new THREE.Vector2() }, uWet: { value: 0 }, uTime: this.u.uTime, uFrame: { value: 0 },
    }, { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    this.wet = 0; // 0..1, set by the game (rain)
    this.motion = 0; // 0..1, set by the game (fast driving)
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
      uLightColor: { value: this.lightColor },
      uWaterAmbient: { value: new THREE.Vector3() },
      uBloom: { value: 0.04 },
      uRays: { value: 0 },
      uUnderwater: { value: 0 },
      uTime: this.u.uTime,
      uExposureBias: { value: 1.0 },
      uSunUV: { value: new THREE.Vector2() }, uFlare: { value: 0 }, uAspect: { value: 1 },
      uSharpen: { value: 0 }, uTexel: { value: new THREE.Vector2() },
      uAutoExposure: { value: 1 },
      uScotopic: { value: 1 },
      uVignette: { value: 0.55 },
      uFlash: { value: 0 },
    });
    if (this.mobile) {
      this.compositeMaterial.uniforms.uAutoExposure.value = 0;
      this.compositeMaterial.uniforms.uExposureBias.value = 0.72;
      this.compositeMaterial.uniforms.uBloom.value = 0;
      this.compositeMaterial.uniforms.uVignette.value = 0.4;
    }

    this.lumRT = [0, 1].map(() => hdrTarget(1, 1, this.hdrType, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    this.lumIndex = 0;

    this.size = new THREE.Vector2(1, 1);
    this.quality = null;
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  setWater(mesh, heightTex, worldSize) {
    mesh.material = this.waterMaterial;
    this.waterMaterial.uniforms.uHeightTex.value = heightTex;
    this.waterMaterial.uniforms.uWorldSize.value = worldSize;
    this.waterScene.add(mesh);
  }

  setQuality(name) {
    const q = { ...QUALITY[name] };
    if (this.mobile) {
      q.shadow = Math.min(q.shadow, 512);
      q.ssr = 0;
      q.msaa = 0;
      q.pixelRatio = Math.min(q.pixelRatio, 0.7);
      q.ao = 0; // 8-bit targets carry no depth in alpha
    }
    if (this.hdrType === THREE.UnsignedByteType) q.ao = 0;
    if (q.ao && this.aoMaterial.defines.AO_SAMPLES !== q.ao) {
      this.aoMaterial.defines.AO_SAMPLES = q.ao;
      this.aoMaterial.needsUpdate = true;
    }
    this.qualityName = name;
    const changedMsaa = !this.quality || this.quality.msaa !== q.msaa;
    this.quality = q;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== q.shadow) {
      sh.mapSize.set(q.shadow, q.shadow);
      sh.map?.dispose();
      sh.map = null;
    }
    const d = q.shadowDist;
    Object.assign(sh.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 800 });
    sh.camera.updateProjectionMatrix();
    if (this.farSun) {
      const fs = this.farSun.shadow, fd = q.farDist || 0;
      if (fs.mapSize.x !== (q.farShadow || 1024)) { fs.mapSize.set(q.farShadow || 1024, q.farShadow || 1024); fs.map?.dispose(); fs.map = null; }
      Object.assign(fs.camera, { left: -fd, right: fd, top: fd, bottom: -fd, near: 1, far: 1600 });
      fs.camera.updateProjectionMatrix();
      fs.needsUpdate = true;
    }
    this.waterMaterial.uniforms.uSSRSteps.value = q.ssr;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? Math.min(q.pixelRatio, 1) : q.pixelRatio));
    if (changedMsaa && this.sceneRT) { this.sceneRT.dispose(); this.sceneRT = null; }
    this.resize(Math.max(2, window.innerWidth || 360), Math.max(2, window.innerHeight || 640));
  }

  resize(w, h) {
    w = Math.max(2, Math.round(w) || 2);
    h = Math.max(2, Math.round(h) || 2);
    const cap = this.mobile ? 960 : 3840;
    if (w > cap) { h = Math.max(2, Math.round(h * cap / w)); w = cap; }
    if (h > cap) { w = Math.max(2, Math.round(w * cap / h)); h = cap; }
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    const W = Math.max(2, Math.floor(w * pr)), H = Math.max(2, Math.floor(h * pr));
    this.size.set(W, H);
    if (!this.sceneRT) {
      this.sceneRT = hdrTarget(W, H, this.hdrType, { depthBuffer: true, samples: this.quality.msaa });
    } else this.sceneRT.setSize(W, H);
    if (!this.copyRT) this.copyRT = hdrTarget(W, H, this.hdrType); else this.copyRT.setSize(W, H);
    if (!this.fogRT) this.fogRT = hdrTarget(W, H, this.hdrType); else this.fogRT.setSize(W, H);
    if (!this.motionRT) this.motionRT = hdrTarget(W, H, this.hdrType); else this.motionRT.setSize(W, H);
    if (!this.windRT) this.windRT = hdrTarget(W, H, this.hdrType); else this.windRT.setSize(W, H);
    if (!this.dofRT) this.dofRT = hdrTarget(W, H, this.hdrType); else this.dofRT.setSize(W, H);
    if (!this.taaRT) this.taaRT = [0, 1].map(() => hdrTarget(W, H, this.hdrType, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    else this.taaRT.forEach((t) => t.setSize(W, H));
    this.taaReset = true;

    this.bloomRTs?.forEach((r) => r.dispose());
    this.bloomRTs = [];
    if (!this.mobile) {
      let bw = W, bh = H;
      for (let i = 0; i < 4; i++) {
        bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
        this.bloomRTs.push(hdrTarget(bw, bh, this.hdrType));
      }
      const rw = Math.max(1, W >> 1), rh = Math.max(1, H >> 1);
      if (!this.raysRT) this.raysRT = hdrTarget(rw, rh, this.hdrType); else this.raysRT.setSize(rw, rh);
    } else if (!this.blackRT) {
      this.blackRT = hdrTarget(2, 2, this.hdrType);
    }
    this.waterMaterial.uniforms.uResolution.value.set(W, H);
    // tonemapped frame for the FXAA pass (the composite already writes display values)
    if (!this.ldrRT) this.ldrRT = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    else this.ldrRT.setSize(W, H);
    this.fxaaMaterial.uniforms.resolution.value.set(1 / W, 1 / H);
    if (!this.smaa) { this.smaa = new SMAAPass(); this.smaa.clear = true; this.smaa.renderToScreen = true; }
    this.smaa.setSize(W, H);
    const aw = Math.max(1, W >> 1), ah = Math.max(1, H >> 1);
    for (const k of ['aoRT', 'aoBlurRT']) {
      if (!this[k]) this[k] = hdrTarget(aw, ah, this.hdrType, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      else this[k].setSize(aw, ah);
    }
  }

  // Half-resolution obscurance from the opaque scene's depth, blurred across and down.
  renderAO(camera) {
    const r = this.renderer;
    const au = this.aoMaterial.uniforms;
    au.tDepth.value = this.copyRT.texture;
    au.uRes.value.set(this.aoRT.width, this.aoRT.height);
    au.uProj.value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]);
    this.quad.render(r, this.aoMaterial, this.aoRT);
    const bu = this.aoBlurMaterial.uniforms;
    bu.tAO.value = this.aoRT.texture;
    bu.uStep.value.set(1 / this.aoRT.width, 0);
    this.quad.render(r, this.aoBlurMaterial, this.aoBlurRT);
    bu.tAO.value = this.aoBlurRT.texture;
    bu.uStep.value.set(0, 1 / this.aoRT.height);
    this.quad.render(r, this.aoBlurMaterial, this.aoRT);
    return this.aoRT.texture;
  }

  setTimeOfDay(t, elapsed) {
    this.u.uTime.value = elapsed;
    const cu = this.compositeMaterial.uniforms;
    if (this.indoor) {
      this.sunDir.set(0.16, 1, 0.1).normalize();
      this.moonDir.copy(this.sunDir).negate();
      this.lightDir.copy(this.sunDir);
      this.sunColor.set(0, 0, 0);
      this.lightColor.set(0.3, 0.29, 0.27);
      this.sun.color.setRGB(1, 0.96, 0.9, THREE.LinearSRGBColorSpace);
      this.sun.intensity = this.indoorKey ?? 2.4;
      this.sun.castShadow = true;
      this.syncFarShadow();
      this.night = 0;
      if (this.hemi) this.hemi.visible = false;
      cu.uAutoExposure.value = 0;
      cu.uExposureBias.value = this.indoorExposure ?? 1.5;
      cu.uScotopic.value = 0;
      return;
    }
    if (this.hemi) this.hemi.visible = true;
    cu.uAutoExposure.value = this.mobile ? 0 : 1;
    cu.uExposureBias.value = this.mobile ? 0.72 : 1.0;
    cu.uScotopic.value = 1;
    const a = t * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.38).normalize();
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
    if (this.mobile) this.lightColor.multiplyScalar(0.085);
    // overcast: the sun is veiled and the sky clouds over (weather 0..1)
    const w = this.weather || 0;
    if (w > 0) this.lightColor.multiplyScalar(1 - 0.62 * w);
    this.skyMaterial.uniforms.uCloudCover.value = 0.5 - 0.44 * w; // the shader's threshold: lower = more cloud
    // a lightning flash: cold white light from high up, for a few hundredths of a second
    const L = this.lightning || 0;
    if (L > 0.002) {
      this.lightColor.lerp(this._v.set(7.5, 8, 9.5).multiplyScalar(this.mobile ? 0.085 : 1), L);
      const d = this.lightningDir || 0;
      this.lightDir.lerp(this._v.set(Math.cos(d) * 0.45, 0.9, Math.sin(d) * 0.45).normalize(), L).normalize();
    }
    this.skyMaterial.uniforms.uLightning.value = L;
    const lc = this.lightColor;
    const li = Math.max(lc.x, lc.y, lc.z);
    this.sun.intensity = this.mobile ? Math.min(li, 1.6) : li;
    if (li > 0) this.sun.color.setRGB(lc.x / li, lc.y / li, lc.z / li, THREE.LinearSRGBColorSpace);
    this.sun.castShadow = li > 1e-3;
    this.syncFarShadow();
    this.night = smoothstep(0.08, -0.18, this.sunDir.y);
    // the ground's bounce: a warm grey street lit by the sun (or moon) from above
    const cosL = Math.max(0, this.lightDir.y) / Math.PI;
    this.skyGenMaterial.uniforms.uBounce.value.set(0.26, 0.23, 0.19).multiply(lc).multiplyScalar(cosL * (this.mobile ? 1 / 0.085 : 1));
  }

  // the far cascade casts while the sun does (outdoors, with a quality that has one); the
  // shadow count changing recompiles the materials, so it only flips with the sun
  syncFarShadow() {
    if (!this.farSun) return;
    const on = this.sun.castShadow && !this.indoor && !!this.quality?.farDist;
    if (this.farSun.castShadow !== on) this.farSun.castShadow = on;
  }

  updateShadowCamera(center) {
    this.updateFarShadow(center);
    const L = this.lightDir;
    const cam = this.sun.shadow.camera;
    // Snap the shadow frustum to whole texels in light space to stop shimmering.
    const up = Math.abs(L.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, L).normalize();
    const upL = new THREE.Vector3().crossVectors(L, right);
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const r = Math.round(center.dot(right) / texel) * texel;
    const u = Math.round(center.dot(upL) / texel) * texel;
    const f = center.dot(L);
    const snapped = new THREE.Vector3().addScaledVector(right, r).addScaledVector(upL, u).addScaledVector(L, f);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(L, 400);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  // The far map is re-rendered every 8 frames (or when the camera has moved 20 m), aimed like
  // the near one and snapped to its texels.
  updateFarShadow(center) {
    const F = this.farSun;
    if (!F?.castShadow) return;
    this._farAt = this._farAt || new THREE.Vector3(1e9, 0, 0);
    if (this.frame % 8 !== 0 && this._farAt.distanceToSquared(center) < 400) return;
    this._farAt.copy(center);
    const L = this.lightDir, cam = F.shadow.camera;
    const up = Math.abs(L.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, L).normalize();
    const upL = new THREE.Vector3().crossVectors(L, right);
    const texel = (cam.right - cam.left) / F.shadow.mapSize.x;
    const snapped = new THREE.Vector3().addScaledVector(right, Math.round(center.dot(right) / texel) * texel)
      .addScaledVector(upL, Math.round(center.dot(upL) / texel) * texel).addScaledVector(L, center.dot(L));
    F.target.position.copy(snapped);
    F.position.copy(snapped).addScaledVector(L, 800);
    F.target.updateMatrixWorld();
    F.updateMatrixWorld();
    F.shadow.needsUpdate = true;
  }

  render(camera, dt, opts = {}) {
    const r = this.renderer;
    const W = this.size.x, H = this.size.y;
    this.frame++;
    r.autoClear = false;

    if (this.firstFrame || this.frame % 6 === 1) {
      this.quad.render(r, this.indoor ? this.indoorSkyMaterial : this.skyGenMaterial, this.skyRT);
    }
    this.envAge += dt;
    if (this.mobile) {
      this.scene.environment = null;
    } else if (this.envAge > 1.5 || !this.envRT) {
      this.envAge = 0;
      try {
        this.envRT = this.pmrem.fromEquirectangular(this.skyRT.texture, this.envRT);
        this.scene.environment = this.envRT.texture;
      } catch {
        this.scene.environment = null;
      }
    }

    this.updateShadowCamera(opts.shadowCenter || camera.position);

    camera.updateMatrixWorld();
    // TAA: this frame is drawn a sub-pixel off along a Halton sequence (undone at the end)
    const taa = !!this.quality.taa && !this.mobile && !opts.outViewport && !Pipeline.noTAA;
    const unjVP = this._unjVP || (this._unjVP = new THREE.Matrix4());
    unjVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (taa) {
      this._unjP.copy(camera.projectionMatrix);
      const i = (this.frame % 8) + 1;
      const halton = (n, b) => { let f = 1, r = 0; while (n > 0) { f /= b; r += f * (n % b); n = Math.floor(n / b); } return r; };
      const jx = halton(i, 2) - 0.5, jy = halton(i, 3) - 0.5;
      camera.projectionMatrix.elements[8] += (jx * 2) / W;
      camera.projectionMatrix.elements[9] += (jy * 2) / H;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }
    const vp = this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const invVP = vp.clone().invert();
    this.skyMaterial.uniforms.uInvViewProj.value.copy(invVP);
    this.skyMaterial.uniforms.uNight.value = this.night;
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(this.indoor ? 0x0c0d10 : 0x000000, 0);
    r.clear(true, true, false);
    if (!this.indoor) r.render(this.skyMesh, camera);
    r.render(this.scene, camera);

    this.copyMaterial.uniforms.tDiffuse.value = this.sceneRT.texture;
    this.quad.render(r, this.copyMaterial, this.copyRT);
    const aoTex = this.quality.ao ? this.renderAO(camera) : null;
    // rain: the streets mirror the city (screen-space, added onto the scene)
    if (this.wet > 0.05 && this.quality.ssr > 0 && !this.mobile) {
      const wu = this.wetMaterial.uniforms;
      wu.tColor.value = this.copyRT.texture;
      wu.uInvViewProj.value.copy(invVP);
      wu.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      wu.uCamPos.value.copy(camera.position);
      camera.getWorldDirection(wu.uCamForward.value);
      wu.uTexel.value.set(1 / W, 1 / H);
      wu.uWet.value = this.wet;
      wu.uFrame.value = this.frame % 64;
      this.quad.render(r, this.wetMaterial, this.sceneRT);
      // the haze redraws the scene behind it: give it the reflections too
      if (this.haze.n > 0 || this.waves.items.some((w) => w.t < 0.45)) this.quad.render(r, this.copyMaterial, this.copyRT);
    }
    this.waterMaterial.uniforms.uSceneTex.value = this.copyRT.texture;
    this.waterMaterial.uniforms.uProj.value.copy(camera.projectionMatrix);
    r.setRenderTarget(this.sceneRT);
    this.haze.flush(this.copyRT.texture, W, H, this.u.uTime.value);
    this.waves.flush(dt, this.copyRT.texture, W, H);
    r.render(this.waterScene, camera);
    const xu = this.fxUniforms;
    xu.tDepth.value = this.copyRT.texture;
    xu.uRes.value.set(W, H);
    xu.uTime.value = this.u.uTime.value;
    xu.uSunView.value.copy(this.lightDir).transformDirection(camera.matrixWorldInverse);
    r.render(this.fxScene, camera);

    const fu = this.fogMaterial.uniforms;
    fu.tScene.value = this.sceneRT.texture;
    fu.uInvViewProj.value.copy(invVP);
    fu.uCamPos.value.copy(camera.position);
    camera.getWorldDirection(fu.uCamForward.value);
    fu.uUnderwater.value = opts.underwater ? 1 : 0;
    fu.tAO.value = aoTex;
    fu.uAO.value = aoTex ? 0.85 : 0;
    this.quad.render(r, this.fogMaterial, this.fogRT);
    let sceneTex = this.fogRT.texture;
    if (taa) {
      const tu = this.taaMaterial.uniforms;
      const out = this.taaRT[this.taaIndex], hist = this.taaRT[1 - this.taaIndex];
      tu.tCur.value = sceneTex;
      tu.tHist.value = hist.texture;
      tu.uInvViewProj.value.copy(invVP);
      tu.uPrevViewProj.value.copy(this.taaPrevVP);
      tu.uCamPos.value.copy(camera.position);
      camera.getWorldDirection(tu.uCamForward.value);
      tu.uTexel.value.set(1 / W, 1 / H);
      tu.uReset.value = this.taaReset ? 1 : 0;
      this.quad.render(r, this.taaMaterial, out);
      this.taaIndex = 1 - this.taaIndex;
      this.taaReset = false;
      sceneTex = out.texture;
    } else this.taaReset = true;
    this.taaPrevVP.copy(unjVP);
    // depth of field through the scope (focused where the crosshair lands)
    if ((opts.dof?.amount || 0) > 0.02 && !this.mobile && !opts.outViewport) {
      const du = this.dofMaterial.uniforms;
      du.tScene.value = sceneTex;
      du.uFocus.value = opts.dof.focus;
      du.uAmount.value = opts.dof.amount;
      du.uTexel.value.set(1 / W, 1 / H);
      this.quad.render(r, this.dofMaterial, this.dofRT);
      sceneTex = this.dofRT.texture;
    }
    // speed blur when driving fast (reprojected against last frame's camera)
    if (this.motion > 0.02 && !this.mobile && !opts.outViewport) {
      const mu = this.motionMaterial.uniforms;
      mu.tScene.value = sceneTex;
      mu.uInvViewProj.value.copy(invVP);
      mu.uPrevViewProj.value.copy(this.prevViewProj);
      mu.uCamPos.value.copy(camera.position);
      camera.getWorldDirection(mu.uCamForward.value);
      mu.uStrength.value = this.motion * 0.9;
      this.quad.render(r, this.motionMaterial, this.motionRT);
      sceneTex = this.motionRT.texture;
    }
    // rain on the windscreen from the driver's seat
    if ((opts.windscreen || 0) > 0.01 && !opts.outViewport) {
      const wu = this.windMaterial.uniforms;
      wu.tScene.value = sceneTex;
      wu.uAmount.value = opts.windscreen;
      wu.uAspect.value = W / H;
      this.quad.render(r, this.windMaterial, this.windRT);
      sceneTex = this.windRT.texture;
    }
    this.prevViewProj.copy(unjVP);

    let bloomTex = this.blackRT?.texture || sceneTex;
    let lumTex = this.lumRT[0].texture;
    let raysTex = this.blackRT?.texture || sceneTex;
    let flare = 0;
    let rays = 0;

    if (this.bloomRTs.length) {
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
      lumTex = next.texture;

      for (let i = this.bloomRTs.length - 2; i >= 0; i--) {
        const u = this.bloomUp.uniforms;
        const s = this.bloomRTs[i + 1];
        u.tSrc.value = s.texture;
        u.uTexel.value.set(1 / s.width, 1 / s.height);
        this.quad.render(r, this.bloomUp, this.bloomRTs[i]);
      }
      bloomTex = this.bloomRTs[0].texture;

      const lightPos = camera.position.clone().addScaledVector(this.lightDir, 1000).project(camera);
      const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).dot(this.lightDir);
      if (facing > 0 && lightPos.z < 1 && this.raysRT) {
        const onScreen = 1 - smoothstep(0.9, 1.6, Math.max(Math.abs(lightPos.x), Math.abs(lightPos.y)));
        rays = onScreen * smoothstep(0.0, 0.35, facing) * (opts.underwater ? 0.3 : 1);
        // the lens catches the sun (not the moon), less through cloud
        const cf = this.compositeMaterial.uniforms;
        cf.uSunUV.value.set(lightPos.x * 0.5 + 0.5, lightPos.y * 0.5 + 0.5);
        cf.uAspect.value = W / H;
        flare = rays * (this.sunDir.y > 0 ? 1 : 0) * (1 - (this.weather || 0)) * (opts.underwater ? 0 : 1);
        const ru = this.raysMaterial.uniforms;
        ru.tScene.value = sceneTex;
        ru.uSunUV.value.set(lightPos.x * 0.5 + 0.5, lightPos.y * 0.5 + 0.5);
        ru.uAspect.value = W / H;
        ru.uFrame.value = this.frame % 64;
        this.quad.render(r, this.raysMaterial, this.raysRT);
        raysTex = this.raysRT.texture;
      }
    }
    this.firstFrame = false;

    const cu = this.compositeMaterial.uniforms;
    cu.tScene.value = sceneTex;
    cu.tBloom.value = bloomTex;
    cu.tLum.value = lumTex;
    cu.tRays.value = raysTex;
    cu.uRays.value = rays * 1.2;
    cu.uFlare.value = flare;
    cu.uTexel.value.set(1 / W, 1 / H);
    cu.uUnderwater.value = opts.underwater ? 1 : 0;
    cu.uFlash.value = opts.flash || 0;
    const amb = new THREE.Vector3(0.02, 0.1, 0.13).multiplyScalar(0.4 + this.lightColor.y * 0.08 + (1 - this.night) * 0.4);
    cu.uWaterAmbient.value.copy(amb);
    const splitVp = opts.outViewport;
    const fxaa = this.quality.fxaa && !taa; // TAA already smooths the edges
    this.compositeMaterial.uniforms.uSharpen.value = taa ? 0.35 : 0;
    if (fxaa) this.quad.render(r, this.compositeMaterial, this.ldrRT);
    if (splitVp) {
      r.setViewport(splitVp[0], splitVp[1], splitVp[2], splitVp[3]);
      r.setScissor(splitVp[0], splitVp[1], splitVp[2], splitVp[3]);
      r.setScissorTest(true);
    }
    if (fxaa && this.quality.smaa && this.smaa) {
      // SMAA: crisper, steadier edges than FXAA on rails, wires and foliage
      this.smaa.render(r, null, this.ldrRT);
    } else if (fxaa) {
      this.fxaaMaterial.uniforms.tDiffuse.value = this.ldrRT.texture;
      this.quad.render(r, this.fxaaMaterial, null);
    } else this.quad.render(r, this.compositeMaterial, null);
    if (splitVp) {
      r.setViewport(0, 0, r.domElement.clientWidth, r.domElement.clientHeight);
      r.setScissorTest(false);
    }
    if (taa) { // the game aims and projects with the true camera
      camera.projectionMatrix.copy(this._unjP);
      camera.projectionMatrixInverse.copy(this._unjP).invert();
    }
  }

  renderSplit(leftCam, rightCam, dt, opts = {}) {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const hw = Math.max(1, Math.floor(w / 2));
    this.render(leftCam, dt, { ...opts, outViewport: [0, 0, hw, h] });
    this.render(rightCam, 0, { ...opts, outViewport: [hw, 0, w - hw, h] });
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
  }
}
