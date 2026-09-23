import * as THREE from 'three';
import * as S from './shaders.js';
import { SEA_LEVEL } from './blocks.js';

const R0 = 6372e3, R_PLANET = 6371e3, R_ATMOS = 6471e3;
const K_RLH = [5.5e-6, 13.0e-6, 22.4e-6], K_MIE = 21e-6;

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

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hdrTarget(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
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
  low: { label: 'Low', shadow: 1024, ssr: 0, msaa: 0, pixelRatio: 0.75, soft: 1.2, shadowDist: 60 },
  medium: { label: 'Medium', shadow: 2048, ssr: 16, msaa: 0, pixelRatio: 1, soft: 1.5, shadowDist: 80 },
  high: { label: 'High', shadow: 2048, ssr: 32, msaa: 4, pixelRatio: 1.25, soft: 1.8, shadowDist: 90 },
  ultra: { label: 'Ultra', shadow: 4096, ssr: 48, msaa: 4, pixelRatio: 2, soft: 2.4, shadowDist: 110 },
};

export class Pipeline {
  constructor(renderer, textures) {
    this.renderer = renderer;
    this.textures = textures;
    this.quad = new FullscreenQuad();
    this.opaqueScene = new THREE.Scene();
    this.waterScene = new THREE.Scene();
    this.overlayScene = new THREE.Scene();
    this.opaqueScene.matrixWorldAutoUpdate = false;
    this.waterScene.matrixWorldAutoUpdate = false;

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.sunColor = new THREE.Vector3();
    this.lightColor = new THREE.Vector3();
    this.night = 0;
    this.frame = 0;
    this.firstFrame = true;

    this.skyRT = hdrTarget(256, 128, {
      minFilter: THREE.LinearMipmapLinearFilter,
      generateMipmaps: true,
      wrapS: THREE.RepeatWrapping,
    });

    // Uniforms shared by reference between every material.
    this.u = {
      uSkyTex: { value: this.skyRT.texture },
      uLightDir: { value: this.lightDir },
      uLightColor: { value: this.lightColor },
      uSunDir: { value: this.sunDir },
      uTime: { value: 0 },
      uFogStart: { value: 80 },
      uFogEnd: { value: 120 },
      uFogDensity: { value: 0.0022 },
      uRain: { value: 0 },
      uShadowMap: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowTexel: { value: 1 / 2048 },
      uShadowSoft: { value: 1.8 },
      uWind: { value: 1 },
    };

    this.blockMaterial = new THREE.ShaderMaterial({
      vertexShader: S.blockVert,
      fragmentShader: S.blockFrag,
      uniforms: {
        ...this.u,
        uAlbedo: { value: textures.albedo },
        uNormalTex: { value: textures.normal },
        uSeaLevel: { value: SEA_LEVEL + 1 },
        uCaveAmbient: { value: new THREE.Vector3(0.01, 0.0095, 0.009) },
        uHandLight: { value: 0 },
      },
    });

    this.shadowMaterial = new THREE.ShaderMaterial({
      vertexShader: S.shadowVert,
      fragmentShader: S.shadowFrag,
      uniforms: { uTime: this.u.uTime, uWind: this.u.uWind, uAlbedo: { value: textures.albedo } },
      side: THREE.DoubleSide,
    });

    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: S.waterVert,
      fragmentShader: S.waterFrag,
      uniforms: {
        ...this.u,
        uSceneTex: { value: null },
        uResolution: { value: new THREE.Vector2() },
        uProj: { value: new THREE.Matrix4() },
        uSSRSteps: { value: 32 },
        uUnderwater: { value: 0 },
      },
      side: THREE.DoubleSide,
    });

    this.outlineMaterial = new THREE.ShaderMaterial({
      vertexShader: S.outlineVert,
      fragmentShader: S.outlineFrag,
    });

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

    this.copyMaterial = fsMaterial(S.copyFrag, { tDiffuse: { value: null } });
    this.bloomDown = fsMaterial(S.bloomDownFrag, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: false },
    });
    this.bloomUp = fsMaterial(S.bloomUpFrag, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 },
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
      uBloom: { value: 0.045 },
      uRays: { value: 0 },
      uUnderwater: { value: 0 },
      uTime: this.u.uTime,
      uExposureBias: { value: 1.0 },
      uResolution: { value: new THREE.Vector2() },
    });

    this.lumRT = [0, 1].map(() => hdrTarget(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    this.lumIndex = 0;

    this.sunCamera = new THREE.OrthographicCamera(-90, 90, 90, -90, 1, 700);
    this.sunCamera.layers.set(0);

    this.size = new THREE.Vector2(1, 1);
    this.quality = null;
    this.setQuality('high');
  }

  setQuality(name) {
    const q = QUALITY[name];
    this.qualityName = name;
    const changedShadow = !this.quality || this.quality.shadow !== q.shadow;
    const changedMsaa = !this.quality || this.quality.msaa !== q.msaa;
    this.quality = q;
    if (changedShadow) {
      this.shadowRT?.dispose();
      this.shadowRT = new THREE.WebGLRenderTarget(q.shadow, q.shadow, {
        type: THREE.UnsignedByteType,
        format: THREE.RedFormat,
        depthBuffer: true,
      });
      const dt = new THREE.DepthTexture(q.shadow, q.shadow);
      dt.type = THREE.UnsignedIntType;
      dt.compareFunction = THREE.LessEqualCompare;
      dt.minFilter = THREE.LinearFilter;
      dt.magFilter = THREE.LinearFilter;
      this.shadowRT.depthTexture = dt;
      this.u.uShadowMap.value = dt;
      this.u.uShadowTexel.value = 1 / q.shadow;
    }
    this.u.uShadowSoft.value = q.soft;
    const d = q.shadowDist;
    Object.assign(this.sunCamera, { left: -d, right: d, top: d, bottom: -d });
    this.sunCamera.updateProjectionMatrix();
    this.waterMaterial.uniforms.uSSRSteps.value = q.ssr;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    if (changedMsaa && this.sceneRT) { this.sceneRT.dispose(); this.sceneRT = null; }
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w, h) {
    this.renderer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    const W = Math.max(1, Math.floor(w * pr)), H = Math.max(1, Math.floor(h * pr));
    this.size.set(W, H);
    if (!this.sceneRT) {
      this.sceneRT = hdrTarget(W, H, { depthBuffer: true, samples: this.quality.msaa });
    } else this.sceneRT.setSize(W, H);
    if (!this.copyRT) this.copyRT = hdrTarget(W, H); else this.copyRT.setSize(W, H);

    this.bloomRTs?.forEach((r) => r.dispose());
    this.bloomRTs = [];
    let bw = W, bh = H;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.bloomRTs.push(hdrTarget(bw, bh));
    }
    const rw = Math.max(1, W >> 1), rh = Math.max(1, H >> 1);
    if (!this.raysRT) this.raysRT = hdrTarget(rw, rh); else this.raysRT.setSize(rw, rh);

    this.waterMaterial.uniforms.uResolution.value.set(W, H);
    this.compositeMaterial.uniforms.uResolution.value.set(W, H);
  }

  setTimeOfDay(t, elapsed) {
    const a = t * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.38).normalize();
    this.moonDir.copy(this.sunDir).negate();
    const tmp = new THREE.Vector3();
    transmittance(this.sunDir, tmp);
    const sunF = smoothstep(-0.03, 0.04, this.sunDir.y);
    const moonF = smoothstep(-0.03, 0.04, this.moonDir.y);
    this.sunColor.copy(tmp).multiplyScalar(sunF);
    if (this.sunDir.y > 0) {
      this.lightDir.copy(this.sunDir);
      this.lightColor.copy(tmp).multiplyScalar(8.0 * sunF);
    } else {
      this.lightDir.copy(this.moonDir);
      transmittance(this.moonDir, tmp);
      this.lightColor.copy(tmp).multiply(new THREE.Vector3(0.55, 0.7, 1.0)).multiplyScalar(0.12 * moonF);
    }
    this.night = smoothstep(0.08, -0.18, this.sunDir.y);
    this.u.uTime.value = elapsed;
  }

  updateShadowCamera(center) {
    const cam = this.sunCamera;
    const L = this.lightDir;
    cam.position.copy(L).multiplyScalar(300);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const texel = (cam.right - cam.left) / this.quality.shadow;
    const r = Math.round(center.dot(right) / texel) * texel;
    const u = Math.round(center.dot(up) / texel) * texel;
    const f = center.dot(L);
    const snapped = new THREE.Vector3().addScaledVector(right, r).addScaledVector(up, u).addScaledVector(L, f);
    cam.position.copy(snapped).addScaledVector(L, 300);
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    this.u.uShadowMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  render(camera, dt, opts) {
    const r = this.renderer;
    const W = this.size.x, H = this.size.y;
    this.frame++;
    r.autoClear = false;

    // 1. Atmosphere -> small HDR equirect texture (also used for ambient + fog).
    this.quad.render(r, this.skyGenMaterial, this.skyRT);

    // 2. Shadow map.
    this.updateShadowCamera(camera.position);
    if (this.lightColor.lengthSq() > 1e-6) {
      r.setRenderTarget(this.shadowRT);
      r.setClearColor(0xffffff, 1);
      r.clear(true, true, false);
      this.opaqueScene.overrideMaterial = this.shadowMaterial;
      r.render(this.opaqueScene, this.sunCamera);
      this.opaqueScene.overrideMaterial = null;
    }

    // 3. Sky + opaque geometry into the HDR target. Alpha stores view distance.
    camera.updateMatrixWorld();
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.skyMaterial.uniforms.uInvViewProj.value.copy(vp).invert();
    this.skyMaterial.uniforms.uNight.value = this.night;
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.skyMesh, camera);
    r.render(this.opaqueScene, camera);
    r.render(this.overlayScene, camera);

    // 4. Water, which refracts/reflects a copy of the opaque scene.
    this.copyMaterial.uniforms.tDiffuse.value = this.sceneRT.texture;
    this.quad.render(r, this.copyMaterial, this.copyRT);
    this.waterMaterial.uniforms.uSceneTex.value = this.copyRT.texture;
    this.waterMaterial.uniforms.uProj.value.copy(camera.projectionMatrix);
    r.setRenderTarget(this.sceneRT);
    r.render(this.waterScene, camera);

    // 5. Bloom mip chain.
    let src = this.sceneRT.texture;
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

    // 6. Eye adaptation (reads a downsampled level before upsampling pollutes it).
    const prev = this.lumRT[this.lumIndex];
    const next = this.lumRT[1 - this.lumIndex];
    const lu = this.lumMaterial.uniforms;
    lu.tScene.value = this.bloomRTs[2].texture;
    lu.tPrev.value = prev.texture;
    lu.uDt.value = Math.min(dt, 0.1);
    lu.uReset.value = this.firstFrame;
    this.quad.render(r, this.lumMaterial, next);
    this.lumIndex = 1 - this.lumIndex;
    this.firstFrame = false;

    for (let i = this.bloomRTs.length - 2; i >= 0; i--) {
      const u = this.bloomUp.uniforms;
      const s = this.bloomRTs[i + 1];
      u.tSrc.value = s.texture;
      u.uTexel.value.set(1 / s.width, 1 / s.height);
      this.quad.render(r, this.bloomUp, this.bloomRTs[i]);
    }

    // 7. Screen-space god rays towards the sun (or moon).
    const lightPos = camera.position.clone().addScaledVector(this.lightDir, 1000).project(camera);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).dot(this.lightDir);
    let rays = 0;
    if (facing > 0 && lightPos.z < 1) {
      const onScreen = 1 - smoothstep(0.9, 1.6, Math.max(Math.abs(lightPos.x), Math.abs(lightPos.y)));
      rays = onScreen * smoothstep(0.0, 0.35, facing) * (opts.underwater ? 0.3 : 1);
      const ru = this.raysMaterial.uniforms;
      ru.tScene.value = this.sceneRT.texture;
      ru.uSunUV.value.set(lightPos.x * 0.5 + 0.5, lightPos.y * 0.5 + 0.5);
      ru.uAspect.value = W / H;
      ru.uFrame.value = this.frame % 64;
      this.quad.render(r, this.raysMaterial, this.raysRT);
    }

    // 8. Composite, tonemap, grade.
    const cu = this.compositeMaterial.uniforms;
    cu.tScene.value = this.sceneRT.texture;
    cu.tBloom.value = this.bloomRTs[0].texture;
    cu.tLum.value = next.texture;
    cu.tRays.value = this.raysRT.texture;
    cu.uRays.value = rays * 1.4;
    cu.uUnderwater.value = opts.underwater ? 1 : 0;
    const amb = new THREE.Vector3(0.02, 0.1, 0.13).multiplyScalar(0.4 + this.lightColor.y * 0.25 + (1 - this.night) * 0.4);
    cu.uWaterAmbient.value.copy(amb);
    this.waterMaterial.uniforms.uUnderwater.value = opts.underwater ? 1 : 0;
    this.quad.render(r, this.compositeMaterial, null);
  }
}
