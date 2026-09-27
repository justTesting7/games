import * as THREE from 'three';
import { PITCH, GOAL } from './dims.js';

// Net profile in (depth behind the line, height). The roof runs back from the
// crossbar, then the back panel slopes to the ground.
const PROFILE = [[0, GOAL.height + GOAL.post], [0.95, GOAL.height + 0.02], [GOAL.depth, 0]];

function netGeometry(halfW) {
  const pos = [], uv = [], nrm = [], idx = [];
  const push = (x, y, z, u, v, n) => { pos.push(x, y, z); uv.push(u, v); nrm.push(...n); };
  // Roof and back: a strip swept across the goal width.
  const rows = [];
  let len = 0;
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [d0, h0] = PROFILE[i], [d1, h1] = PROFILE[i + 1];
    const seg = Math.hypot(d1 - d0, h1 - h0);
    const n = Math.max(2, Math.ceil(seg / 0.2));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      rows.push([d0 + (d1 - d0) * t, h0 + (h1 - h0) * t, len + seg * t]);
    }
    len += seg;
  }
  const cols = Math.ceil((halfW * 2) / 0.2);
  const base = 0;
  rows.forEach(([d, h, s]) => {
    for (let c = 0; c <= cols; c++) {
      const z = -halfW + (c / cols) * halfW * 2;
      push(d, h, z, z, s, [1, 0, 0]);
    }
  });
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const a = base + r * (cols + 1) + c;
      idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  }
  // Side panels: fan the profile down to the ground at each post.
  for (const side of [-1, 1]) {
    const z = side * halfW;
    const n = 14;
    const start = pos.length / 3;
    const colsS = 12;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = (GOAL.height + GOAL.post) * t;
      // Depth of the net outline at this height.
      let dMax;
      if (y >= GOAL.height + 0.02) dMax = 0.95 * (1 - (y - GOAL.height - 0.02) / (GOAL.post - 0.02 + 1e-3));
      else dMax = GOAL.depth - (GOAL.depth - 0.95) * (y / (GOAL.height + 0.02));
      dMax = Math.max(0, dMax);
      for (let c = 0; c <= colsS; c++) {
        const d = dMax * (c / colsS);
        push(d, y, z, d, y, [0, 0, side]);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < colsS; c++) {
        const a = start + i * (colsS + 1) + c;
        idx.push(a, a + 1, a + colsS + 1, a + 1, a + colsS + 2, a + colsS + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

const netVert = /* glsl */ `
uniform vec4 uImpact;
uniform float uImpactT;
uniform float uTime;
varying vec2 vNetUv;
`;

const netBegin = /* glsl */ `
vec3 transformed = vec3(position);
vNetUv = uv;
// Slack net: pinned at the frame, bulging in the middle.
float slack = sin(clamp(position.x / ${GOAL.depth.toFixed(2)}, 0.0, 1.0) * 3.14159) * 0.5 + 0.5;
transformed.x += sin(uTime * 0.9 + position.z * 0.7 + position.y) * 0.012 * slack;
float dI = distance(position, uImpact.xyz);
float wave = uImpact.w * exp(-dI * dI * 1.6) * exp(-uImpactT * 3.2) * cos(uImpactT * 16.0 - dI * 4.0);
float pinned = smoothstep(0.0, 0.25, position.x) * smoothstep(0.0, 0.2, position.y);
transformed.x += wave * pinned;
`;

const netFrag = /* glsl */ `
varying vec2 vNetUv;
// Box-filtered grid lines: exact up close, fading to their average cover far
// away instead of shimmering.
float netCoverage(vec2 p) {
  const float cell = 0.12;
  vec2 g = p / cell;
  vec2 target = vec2(0.012 / cell);
  vec2 deriv = vec2(length(vec2(dFdx(g.x), dFdy(g.x))), length(vec2(dFdx(g.y), dFdy(g.y))));
  vec2 draw = clamp(target, deriv, vec2(0.5));
  vec2 aa = max(deriv, vec2(1e-6)) * 1.5;
  vec2 gu = 1.0 - abs(fract(g) * 2.0 - 1.0);
  vec2 grid = smoothstep(draw + aa, draw - aa, gu);
  grid *= clamp(target / draw, 0.0, 1.0);
  grid = mix(grid, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
  return clamp(mix(grid.x, 1.0, grid.y) * 1.6, 0.0, 1.0);
}
`;

export class Goal {
  constructor(side) {
    this.side = side;
    this.group = new THREE.Group();
    this.uniforms = {
      uImpact: { value: new THREE.Vector4(0, 1, 0, 0) },
      uImpactT: { value: 10 },
      uTime: { value: 0 },
    };
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.28, metalness: 0.05, envMapIntensity: 1.1 });
    const r = GOAL.post;
    const hw = GOAL.halfWidth + r;
    const x = side * (PITCH.halfLength - PITCH.line * 0.5);
    const postGeo = new THREE.CylinderGeometry(r, r, GOAL.height + r, 20);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, white);
      p.position.set(x, (GOAL.height + r) / 2, s * hw);
      p.castShadow = true;
      this.group.add(p);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hw * 2 + r * 2, 20), white);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(x, GOAL.height + r, 0);
    bar.castShadow = true;
    this.group.add(bar);

    // Stanchions and the ground frame holding the net out.
    const dark = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.4, metalness: 0.3 });
    const tube = (a, b, rad = 0.02) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, d.length(), 8), dark);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      m.castShadow = true;
      this.group.add(m);
    };
    const back = x + side * GOAL.depth;
    tube(new THREE.Vector3(back, 0.02, -hw), new THREE.Vector3(back, 0.02, hw));
    for (const s of [-1, 1]) {
      tube(new THREE.Vector3(x, 0.02, s * hw), new THREE.Vector3(back, 0.02, s * hw));
      tube(new THREE.Vector3(x + side * 0.95, GOAL.height + 0.02, s * hw), new THREE.Vector3(back, 0.02, s * hw), 0.025);
      tube(new THREE.Vector3(x, GOAL.height + r, s * hw), new THREE.Vector3(x + side * 0.95, GOAL.height + 0.02, s * hw), 0.025);
    }

    const netMat = new THREE.MeshStandardMaterial({
      color: 0xf4f4f0, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, transparent: true,
      depthWrite: false,
    });
    netMat.blending = THREE.CustomBlending;
    netMat.blendSrc = THREE.SrcAlphaFactor;
    netMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    netMat.blendSrcAlpha = THREE.ZeroFactor;
    netMat.blendDstAlpha = THREE.OneFactor;
    netMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = netVert + shader.vertexShader.replace('#include <begin_vertex>', netBegin);
      shader.fragmentShader = netFrag + shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        'diffuseColor.a = netCoverage(vNetUv);\nif (diffuseColor.a < 0.01) discard;',
      );
    };
    netMat.customProgramCacheKey = () => 'net-v1';
    const net = new THREE.Mesh(netGeometry(hw), netMat);
    net.position.set(x, 0, 0);
    net.scale.x = side;
    net.renderOrder = 2;
    net.frustumCulled = false;
    this.net = net;
    this.group.add(net);
  }

  // `point` is world space; the net bulges away from the pitch.
  hit(point, speed) {
    const local = this.net.worldToLocal(point.clone());
    this.uniforms.uImpact.value.set(local.x, local.y, local.z, Math.min(0.45, speed * 0.028));
    this.uniforms.uImpactT.value = 0;
  }

  update(dt, time) {
    this.uniforms.uImpactT.value += dt;
    this.uniforms.uTime.value = time;
  }
}
