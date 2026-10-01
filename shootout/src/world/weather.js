import * as THREE from 'three';

// Rain: streaks that fall through a box that follows the camera (positions animated in the
// vertex shader, so it costs nothing on the CPU), splashes on the ground around the
// player, streets turned dark and glossy so they reflect the sky, an overcast sky and a
// dimmer sun (see Pipeline.weather), and the hiss of rain in the audio.

const DROPS = 4500;
const BOX = 36; // metres around the camera
const FALL = 11; // m/s

const vert = /* glsl */ `
attribute vec3 offset;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uWind;
varying float vFade;
void main() {
  // each drop loops through the box; the box is anchored to the camera
  vec3 p = offset + vec3(uWind.x, -${FALL.toFixed(1)}, uWind.z) * uTime;
  p = mod(p - uCam + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) + uCam - ${(BOX / 2).toFixed(1)};
  // a thin streak along the fall direction
  vec3 fall = normalize(vec3(uWind.x, -${FALL.toFixed(1)}, uWind.z));
  vec3 side = normalize(cross(fall, normalize(cameraPosition - p)));
  p += fall * position.y * 0.55 + side * position.x * 0.012;
  vFade = 1.0 - smoothstep(${(BOX * 0.25).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, distance(p, uCam));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const frag = /* glsl */ `
uniform float uAmount;
uniform vec3 uLight;
varying float vFade;
void main() {
  gl_FragColor = vec4(uLight, 0.28 * uAmount * vFade);
}`;

export const rainShaders = { vert, frag };

export class Weather {
  constructor(scene) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const offsets = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) {
      offsets[i * 3] = Math.random() * BOX;
      offsets[i * 3 + 1] = Math.random() * BOX;
      offsets[i * 3 + 2] = Math.random() * BOX;
    }
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.instanceCount = DROPS;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3(1.2, 0, 0.5) },
        uAmount: { value: 0 }, uLight: { value: new THREE.Vector3(0.8, 0.85, 0.9) },
      },
    });
    this.material.blending = THREE.CustomBlending; // keep the depth stored in alpha
    this.material.blendSrcAlpha = THREE.ZeroFactor;
    this.material.blendDstAlpha = THREE.OneFactor;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.amount = 0;
    this.wetMats = null;
  }

  static fromSaved() {
    try { return localStorage.getItem('relic-weather') === 'rain' ? 'rain' : 'clear'; } catch { return 'clear'; }
  }

  /**
   * Darkens and glosses the street surfaces (and wets the rest a little) so they mirror
   * the sky; k 0..1.
   */
  wet(root, k) {
    if (!root) return;
    if (!this.wetMats) {
      this.wetMats = new Map();
      root.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || this.wetMats.has(m) || m.roughness === undefined) continue;
          const street = /^(asphalt|pavement|ground|kerb|marking|road_marks.*|ground_.*)$/.test(m.name || o.name);
          this.wetMats.set(m, { r: m.roughness, c: m.color?.clone(), street });
        }
      });
    }
    for (const [m, o] of this.wetMats) {
      const w = o.street ? k : k * 0.45;
      m.roughness = THREE.MathUtils.lerp(o.r, o.street ? 0.12 : 0.45, w);
      if (o.c) m.color.copy(o.c).multiplyScalar(1 - 0.35 * w);
    }
  }

  /**
   * Storms: in heavy rain a bolt every 10-30 s flashes the sky and the city (a quick double
   * or triple strobe); returns the flash 0..1 for the lighting, and calls onThunder(dist).
   */
  lightning(dt) {
    if (this.amount < 0.6) { this.bolt = null; this.flashK = 0; return 0; }
    this.nextBolt = (this.nextBolt ?? 6 + Math.random() * 10) - dt;
    if (this.nextBolt <= 0 && !this.bolt) {
      this.nextBolt = 10 + Math.random() * 20;
      const strobes = [0];
      for (let i = 1, n = 1 + Math.floor(Math.random() * 3); i <= n; i++) strobes.push(strobes[i - 1] + 0.06 + Math.random() * 0.12);
      const dist = 300 + Math.random() * 2200;
      this.bolt = { t: 0, strobes, k: Math.min(1, 900 / dist + 0.35), dir: Math.random() * Math.PI * 2 };
      this.onThunder?.(dist);
    }
    let k = 0;
    if (this.bolt) {
      const b = this.bolt;
      b.t += dt;
      for (const s of b.strobes) {
        const a = b.t - s;
        if (a >= 0 && a < 0.25) k = Math.max(k, Math.exp(-a * 22) * (s === 0 ? 1 : 0.7));
      }
      k *= b.k * this.amount;
      if (b.t > b.strobes[b.strobes.length - 1] + 0.3) this.bolt = null;
    }
    this.flashK = k;
    return k;
  }

  update(dt, camera, light, { fx, heightAt, at } = {}) {
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
    u.uAmount.value = this.amount;
    if (light) u.uLight.value.set(0.04 + light.x * 0.045, 0.045 + light.y * 0.045, 0.05 + light.z * 0.045); // dim at night
    this.mesh.visible = this.amount > 0.01;
    // splashes on the ground around the player
    if (this.amount > 0.01 && fx?.alpha && heightAt && at) {
      this.splashAcc = (this.splashAcc || 0) + dt * 70 * this.amount;
      while (this.splashAcc > 1) {
        this.splashAcc -= 1;
        const x = at.x + (Math.random() - 0.5) * 24, z = at.z + (Math.random() - 0.5) * 24;
        fx.alpha.spawn({
          pos: new THREE.Vector3(x, heightAt(x, z) + 0.02, z),
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4),
          size: 0.012, life: 0.25, color: [0.8, 0.85, 0.9], alpha: 0.6, gravity: 9.8,
        });
      }
    }
  }
}
