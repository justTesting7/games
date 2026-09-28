import * as THREE from 'three';

// A football and two goals for a pitch, adapted from the Jev Football game's ball and goal.
export const BALL_RADIUS = 0.11;
export const GOAL = { halfWidth: 3.66, height: 2.44, post: 0.06, depth: 2.2 };

// --- ball -------------------------------------------------------------------------------
function panelCentres() {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((a) => new THREE.Vector3(...a).normalize());
  const f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ].map(([a, b, c]) => new THREE.Vector3().add(v[a]).add(v[b]).add(v[c]).normalize());
  return { pent: v, hex: f };
}

export function createBall() {
  const { pent, hex } = panelCentres();
  const vec = (a) => a.map((p) => `vec3(${p.x.toFixed(5)}, ${p.y.toFixed(5)}, ${p.z.toFixed(5)})`).join(', ');
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vBallN;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBallN = normalize(position);');
    shader.fragmentShader = `
varying vec3 vBallN;
const vec3 PENT[12] = vec3[12](${vec(pent)});
const vec3 HEX[20] = vec3[20](${vec(hex)});
float ballSeam;
vec3 ballColour(vec3 n) {
  float b1 = -2.0, b2 = -2.0; int kind = 0; int idx = 0;
  for (int i = 0; i < 12; i++) {
    float d = dot(n, PENT[i]) + 0.035;
    if (d > b1) { b2 = b1; b1 = d; kind = 0; idx = i; } else if (d > b2) b2 = d;
  }
  for (int i = 0; i < 20; i++) {
    float d = dot(n, HEX[i]);
    if (d > b1) { b2 = b1; b1 = d; kind = 1; idx = i; } else if (d > b2) b2 = d;
  }
  float gap = b1 - b2;
  float aa = fwidth(gap) + 1e-4;
  ballSeam = 1.0 - smoothstep(0.004, 0.004 + aa * 1.5, gap);
  vec3 c = vec3(0.86, 0.86, 0.84);
  if (kind == 0) {
    float ring = smoothstep(0.012, 0.012 + aa, gap) * (1.0 - smoothstep(0.03, 0.03 + aa, gap));
    c = mix(vec3(0.02, 0.035, 0.12), vec3(0.75, 0.42, 0.05), ring);
  } else {
    float band = abs(dot(n, normalize(HEX[idx] + PENT[(idx * 7) % 12] * 0.4)) - 0.97);
    if (idx % 3 == 0) c = mix(c, vec3(0.7, 0.05, 0.04), 1.0 - smoothstep(0.006, 0.006 + aa, band));
  }
  return c;
}
` + shader.fragmentShader
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= ballColour(normalize(vBallN));\ndiffuseColor.rgb *= 1.0 - ballSeam * 0.55;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.8, ballSeam);');
  };
  mat.customProgramCacheKey = () => 'pitch-ball-v1';
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 32), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// --- goal -------------------------------------------------------------------------------
// Net profile in (depth behind the line, height): the roof runs back from the crossbar,
// then the back panel slopes to the ground.
const PROFILE = [[0, GOAL.height + GOAL.post], [0.95, GOAL.height + 0.02], [GOAL.depth, 0]];

function netGeometry(halfW) {
  const pos = [], uv = [], nrm = [], idx = [];
  const push = (x, y, z, u, v, n) => { pos.push(x, y, z); uv.push(u, v); nrm.push(...n); };
  const rows = [];
  let len = 0;
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [d0, h0] = PROFILE[i], [d1, h1] = PROFILE[i + 1];
    const seg = Math.hypot(d1 - d0, h1 - h0), n = Math.max(2, Math.ceil(seg / 0.2));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) { const t = k / n; rows.push([d0 + (d1 - d0) * t, h0 + (h1 - h0) * t, len + seg * t]); }
    len += seg;
  }
  const cols = Math.ceil((halfW * 2) / 0.2);
  rows.forEach(([d, h, s]) => { for (let c = 0; c <= cols; c++) { const z = -halfW + (c / cols) * halfW * 2; push(d, h, z, z, s, [1, 0, 0]); } });
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c; idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2); }
  for (const side of [-1, 1]) {
    const z = side * halfW, n = 14, start = pos.length / 3, colsS = 12;
    for (let i = 0; i <= n; i++) {
      const y = ((GOAL.height + GOAL.post) * i) / n;
      let dMax;
      if (y >= GOAL.height + 0.02) dMax = 0.95 * (1 - (y - GOAL.height - 0.02) / (GOAL.post - 0.02 + 1e-3));
      else dMax = GOAL.depth - (GOAL.depth - 0.95) * (y / (GOAL.height + 0.02));
      dMax = Math.max(0, dMax);
      for (let c = 0; c <= colsS; c++) { const d = dMax * (c / colsS); push(d, y, z, d, y, [0, 0, side]); }
    }
    for (let i = 0; i < n; i++) for (let c = 0; c < colsS; c++) { const a = start + i * (colsS + 1) + c; idx.push(a, a + 1, a + colsS + 1, a + 1, a + colsS + 2, a + colsS + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

const netFrag = `
varying vec2 vNetUv;
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

/** A goal in its own frame: the goal line is x = 0 facing -x (the pitch), the net runs back along +x. */
export function createGoal() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.28, metalness: 0.05, envMapIntensity: 1.1 });
  const r = GOAL.post, hw = GOAL.halfWidth + r;
  const postGeo = new THREE.CylinderGeometry(r, r, GOAL.height + r, 20);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, white);
    p.position.set(0, (GOAL.height + r) / 2, s * hw);
    p.castShadow = true;
    group.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hw * 2 + r * 2, 20), white);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, GOAL.height + r, 0);
  bar.castShadow = true;
  group.add(bar);

  const dark = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.4, metalness: 0.3 });
  const tube = (a, b, rad = 0.02) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, d.length(), 8), dark);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true;
    group.add(m);
  };
  const back = GOAL.depth;
  tube(new THREE.Vector3(back, 0.02, -hw), new THREE.Vector3(back, 0.02, hw));
  for (const s of [-1, 1]) {
    tube(new THREE.Vector3(0, 0.02, s * hw), new THREE.Vector3(back, 0.02, s * hw));
    tube(new THREE.Vector3(0.95, GOAL.height + 0.02, s * hw), new THREE.Vector3(back, 0.02, s * hw), 0.025);
    tube(new THREE.Vector3(0, GOAL.height + r, s * hw), new THREE.Vector3(0.95, GOAL.height + 0.02, s * hw), 0.025);
  }

  const netMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  netMat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec2 vNetUv;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvNetUv = uv;');
    shader.fragmentShader = netFrag + shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a = netCoverage(vNetUv);\nif (diffuseColor.a < 0.01) discard;');
  };
  netMat.customProgramCacheKey = () => 'pitch-net-v1';
  const net = new THREE.Mesh(netGeometry(hw), netMat);
  net.renderOrder = 2;
  net.frustumCulled = false;
  group.add(net);
  return group;
}

/**
 * Two goals and a ball on a pitch: { y, center: [x, z], goals: [[x, z], [x, z]] }, each goal
 * given as the middle of its goal line. Returns the group and the goalposts as colliders.
 */
export function buildPitchProps(pitch) {
  const group = new THREE.Group();
  group.name = 'pitch-props';
  const [cx, cz] = pitch.center;
  const colliders = [];
  for (const [gx, gz] of pitch.goals) {
    const goal = createGoal();
    // local +x (the net) points away from the middle of the pitch
    const dx = gx - cx, dz = gz - cz, l = Math.hypot(dx, dz);
    goal.position.set(gx, pitch.y, gz);
    goal.rotation.y = Math.atan2(-dz / l, dx / l);
    group.add(goal);
    const hw = GOAL.halfWidth + GOAL.post;
    const tx = -dz / l, tz = dx / l; // along the goal line
    for (const s of [-1, 1]) colliders.push({ x: gx + tx * hw * s, z: gz + tz * hw * s, r: GOAL.post + 0.02, y0: pitch.y, y1: pitch.y + GOAL.height + 0.12, type: 'metal' });
  }
  const ball = createBall();
  ball.position.set(cx, pitch.y + BALL_RADIUS, cz);
  group.add(ball);
  return { group, colliders, ball };
}
