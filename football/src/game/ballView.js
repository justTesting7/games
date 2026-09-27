import * as THREE from 'three';
import { BALL_RADIUS } from '../world/dims.js';

// Truncated-icosahedron panels: 12 pentagon centres (icosahedron vertices)
// and 20 hexagon centres (face centres), resolved per pixel.
function panelCentres() {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((a) => new THREE.Vector3(...a).normalize());
  const f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ].map(([a, b, c]) => new THREE.Vector3().add(v[a]).add(v[b]).add(v[c]).normalize());
  return { pent: v, hex: f };
}

export function createBallMesh() {
  const { pent, hex } = panelCentres();
  const vec = (a) => a.map((p) => `vec3(${p.x.toFixed(5)}, ${p.y.toFixed(5)}, ${p.z.toFixed(5)})`).join(', ');
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.38, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vBallN;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvBallN = normalize(position);');
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
  vec3 white = vec3(0.86, 0.86, 0.84);
  vec3 navy = vec3(0.02, 0.035, 0.12);
  vec3 gold = vec3(0.75, 0.42, 0.05);
  vec3 c = white;
  if (kind == 0) {
    float ring = smoothstep(0.012, 0.012 + aa, gap) * (1.0 - smoothstep(0.03, 0.03 + aa, gap));
    c = mix(navy, gold, ring);
  } else {
    // Swooshes on alternate hexagons.
    float band = abs(dot(n, normalize(HEX[idx] + PENT[(idx * 7) % 12] * 0.4)) - 0.97);
    if (idx % 3 == 0) c = mix(c, vec3(0.7, 0.05, 0.04), 1.0 - smoothstep(0.006, 0.006 + aa, band));
  }
  return c;
}
` + shader.fragmentShader
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= ballColour(normalize(vBallN));\ndiffuseColor.rgb *= 1.0 - ballSeam * 0.55;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.8, ballSeam);');
  };
  mat.customProgramCacheKey = () => 'ball-v1';
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 32), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Soft contact shadow under the ball and players: sells ground contact under
// overcast light where the shadow map alone looks detached.
export function createBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
