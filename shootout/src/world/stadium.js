// Bloomfield's stadium ships as a bare seat ramp on the plaza: no floor, no walls,
// no way in. This builds the missing parts from a polar profile of the ramp that
// bake-dizengoff-nav.mjs measures around the pitch centre:
//   arcade  the plaza-level floor under the raised stands, out to the plaza
//   gates   four openings in the outer wall (N, E, S, W)
//   hall    a ring corridor between the outer wall and the front of the stands
//   tunnels four openings in the inner wall (the diagonals) onto the pitch
// The layout functions are pure so the collision bake and the renderer agree.

export const STADIUM = {
  raise: 1.7,        // the front of the ramp is lifted this much for headroom
  gateHalf: 2.6,     // gate half-width (m)
  gateH: 3.7,
  tunnelHalf: 2.3,
  tunnelH: 3.0,
  hallTopY: 6.4,     // the outer wall stands where the raised ramp reaches this height
  wallThick: 0.45,
  glassOff: 3.05,    // the glass curtain wall sits this far inside the outer edge of the stands
  glassBand: 0.95,   // half-thickness of the blocked band along it (its radius wobbles)
  glassMesh: 'facade_glass_0',
  gates: [45, 135, 225, 315],
  tunnels: [0, 90, 180, 270],
};

const TAU = Math.PI * 2;

/** Seat surface height after the front of the ramp is raised. */
export function raisedSeatY(y) {
  const t = Math.min(1, Math.max(0, (y - 2) / 22.5));
  return y + STADIUM.raise * (1 - t);
}

/** Bake side: measure toe / outer-wall / top radii of the ramp around c, every 360/n degrees. */
export function measureProfile(seatY, c, n = 180) {
  const toe = [], wall = [], top = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    let t0 = null, tw = null, t1 = null;
    for (let r = 15; r < 140; r += 0.25) {
      const y = seatY(c[0] + Math.sin(th) * r, c[1] + Math.cos(th) * r);
      if (y === null) continue;
      if (t0 === null) t0 = r;
      if (tw === null && raisedSeatY(y) >= STADIUM.hallTopY) tw = r;
      t1 = r;
    }
    toe.push(t0); wall.push(tw ?? t0 + 8); top.push(t1);
  }
  const smooth = (a) => a.map((_, i) => {
    let s = 0;
    for (let k = -3; k <= 3; k++) s += a[(i + k + a.length) % a.length];
    return s / 7;
  });
  return { c, n, toe: smooth(toe).map((v) => +v.toFixed(2)), wall: smooth(wall).map((v) => +v.toFixed(2)), top: smooth(top).map((v) => +v.toFixed(2)) };
}

const wrapTh = (th) => ((th % TAU) + TAU) % TAU;
export function radiusAt(arr, th) {
  const n = arr.length, f = (wrapTh(th) / TAU) * n, i = Math.floor(f) % n, t = f - Math.floor(f);
  return arr[i] * (1 - t) + arr[(i + 1) % n] * t;
}
const angDiff = (a, b) => {
  const d = Math.abs(wrapTh(a) - wrapTh(b));
  return Math.min(d, TAU - d);
};
const deg = (d) => (d * Math.PI) / 180;

/** Distance in metres along the wall at radius r from the nearest listed opening angle. */
function arcToOpening(list, th, r) {
  let m = Infinity;
  for (const d of list) m = Math.min(m, angDiff(th, deg(d)) * r);
  return m;
}

/** Bake side: what a plan position is. 'hall', 'pitch', 'arcade', 'wall' or null (outside). */
export function classifyStadium(p, x, z) {
  const dx = x - p.c[0], dz = z - p.c[1];
  const r = Math.hypot(dx, dz), th = Math.atan2(dx, dz);
  const toe = radiusAt(p.toe, th), wall = radiusAt(p.wall, th), top = radiusAt(p.top, th);
  if (r > top + 2.5) return null;
  const half = STADIUM.wallThick * 0.8;
  if (Math.abs(r - toe) < half) return arcToOpening(STADIUM.tunnels, th, r) < STADIUM.tunnelHalf ? 'hall' : 'wall';
  if (Math.abs(r - wall) < half) return arcToOpening(STADIUM.gates, th, r) < STADIUM.gateHalf ? 'hall' : 'wall';
  // the original glass curtain wall around the stands
  if (Math.abs(r - (top - STADIUM.glassOff)) < STADIUM.glassBand) {
    return arcToOpening(STADIUM.gates, th, r) < STADIUM.gateHalf ? 'arcade' : 'wall';
  }
  if (r < toe) return 'pitch';
  if (r < wall) return 'hall';
  return 'arcade';
}

/** Bake side: is this plan position inside a gate's doorway through the glass wall? */
export function inGateDoor(p, x, z) {
  const dx = x - p.c[0], dz = z - p.c[1];
  const r = Math.hypot(dx, dz), th = Math.atan2(dx, dz);
  return Math.abs(r - (radiusAt(p.top, th) - STADIUM.glassOff)) < 5 && arcToOpening(STADIUM.gates, th, r) < STADIUM.gateHalf + 0.3;
}

// ---- runtime meshes ---------------------------------------------------------

/** Ring wall from the floor up to topFn(r), with lintel-only gaps at the opening angles. */
function wallGeometry(THREE, p, radiusArr, offset, openings, half, openH, floorY, topFn) {
  const pos = [];
  const steps = 720;
  const quad = (a, b, y0a, y1a, y0b, y1b) => {
    pos.push(a[0], y0a, a[1], b[0], y0b, b[1], b[0], y1b, b[1]);
    pos.push(a[0], y0a, a[1], b[0], y1b, b[1], a[0], y1a, a[1]);
  };
  for (let i = 0; i < steps; i++) {
    const t0 = (i / steps) * TAU, t1 = ((i + 1) / steps) * TAU;
    const r0 = radiusAt(radiusArr, t0) + offset, r1 = radiusAt(radiusArr, t1) + offset;
    const a = [p.c[0] + Math.sin(t0) * r0, p.c[1] + Math.cos(t0) * r0];
    const b = [p.c[0] + Math.sin(t1) * r1, p.c[1] + Math.cos(t1) * r1];
    const tm = (t0 + t1) / 2, rm = (r0 + r1) / 2;
    const open = arcToOpening(openings, tm, rm) < half;
    const topA = topFn(r0), topB = topFn(r1);
    quad(a, b, open ? floorY + openH : floorY, topA, open ? floorY + openH : floorY, topB);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function ringGeometry(THREE, p, innerFn, outerFn, y) {
  const pos = [];
  const steps = 360;
  for (let i = 0; i < steps; i++) {
    const t0 = (i / steps) * TAU, t1 = ((i + 1) / steps) * TAU;
    const pt = (t, r) => [p.c[0] + Math.sin(t) * r, p.c[1] + Math.cos(t) * r];
    const a0 = pt(t0, innerFn(t0)), a1 = pt(t1, innerFn(t1)), b0 = pt(t0, outerFn(t0)), b1 = pt(t1, outerFn(t1));
    pos.push(a0[0], y, a0[1], b0[0], y, b0[1], b1[0], y, b1[1]);
    pos.push(a0[0], y, a0[1], b1[0], y, b1[1], a1[0], y, a1[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}


// ---- cutting the gates through the glass wall ---------------------------------

/**
 * Makes doorways in a mesh by discarding the pixels inside boxes, leaving its geometry as
 * exported (rewriting it changes how the glass is lit). A door is
 * { x, z, rx, rz, w, depth, h }: centre on the wall, radial direction, half-width along the
 * wall, half-depth across it, and height above the world floor.
 */
export function cutDoorways(THREE, mesh, doors) {
  const n = doors.length;
  const A = doors.map((d) => new THREE.Vector4(d.x, d.z, d.rx, d.rz));
  const B = doors.map((d) => new THREE.Vector4(d.w, d.depth, d.h, 0));
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uDoorA = { value: A };
      sh.uniforms.uDoorB = { value: B };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDoorPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvDoorPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vDoorPos;
uniform vec4 uDoorA[${n}];
uniform vec4 uDoorB[${n}];`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
for (int i = 0; i < ${n}; i++) {
  vec2 d = vDoorPos.xz - uDoorA[i].xy;
  float s = d.x * uDoorA[i].w - d.y * uDoorA[i].z;
  float a = d.x * uDoorA[i].z + d.y * uDoorA[i].w;
  if (abs(s) < uDoorB[i].x && abs(a) < uDoorB[i].y && vDoorPos.y < uDoorB[i].z) discard;
}`);
    };
    m.customProgramCacheKey = () => `doorways-${n}`;
    m.needsUpdate = true;
  }
  mesh.castShadow = false; // the closed-glass shadow would still fill the doorway
}

/**
 * Adds the floor, walls, gates and tunnels, and lifts the seat ramp so there is room to
 * walk under it. root is the loaded set; floorY is the plaza-level walking height.
 */
export function buildStadium(THREE, root, p, floorY) {
  const group = new THREE.Group();
  group.name = 'stadium-interior';

  root.traverse((o) => {
    if (!o.isMesh || o.name !== 'st_seats') return;
    o.updateMatrixWorld(true);
    const src = o.geometry, pos = src.attributes.position;
    const arr = new Float32Array(pos.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      arr[i * 3] = v.x; arr[i * 3 + 1] = raisedSeatY(v.y); arr[i * 3 + 2] = v.z;
    }
    const g = src.clone();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.computeBoundingSphere();
    o.geometry = g;
    o.position.set(0, 0, 0); o.scale.set(1, 1, 1); o.rotation.set(0, 0, 0);
    o.updateMatrix();
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    ms.forEach((m) => { m.side = THREE.DoubleSide; });
  });

  // the gates: doorways through the original glass curtain wall
  const doors = STADIUM.gates.map((deg_) => {
    const th = deg(deg_), r = radiusAt(p.top, th) - STADIUM.glassOff;
    return {
      x: p.c[0] + Math.sin(th) * r, z: p.c[1] + Math.cos(th) * r,
      rx: Math.sin(th), rz: Math.cos(th),
      w: STADIUM.gateHalf + 0.3, depth: 5, h: floorY + STADIUM.gateH + 0.6,
    };
  });
  root.traverse((o) => { if (o.isMesh && o.name === STADIUM.glassMesh) cutDoorways(THREE, o, doors); });

  const concrete = new THREE.MeshStandardMaterial({ color: 0xcfcfca, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const floor = new THREE.MeshStandardMaterial({ color: 0x8c8c88, roughness: 0.95, metalness: 0 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffe6b0, emissiveIntensity: 1.4 });
  const add = (geo, mat, shadows = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows; m.receiveShadow = true;
    group.add(m);
    return m;
  };

  const toe = (t) => radiusAt(p.toe, t), wall = (t) => radiusAt(p.wall, t), top = (t) => radiusAt(p.top, t);
  // floors: the surround of the pitch, then the hall and arcade in one ring out to the plaza
  add(ringGeometry(THREE, p, () => 0.01, (t) => toe(t) + 0.2, floorY - 0.06), floor, false);
  add(ringGeometry(THREE, p, (t) => toe(t) - 0.2, (t) => top(t) + 2.6, floorY), floor, false);
  // inner wall at the front of the stands, tunnels onto the pitch
  add(wallGeometry(THREE, p, p.toe, 0.1, STADIUM.tunnels, STADIUM.tunnelHalf, STADIUM.tunnelH, floorY,
    () => raisedSeatY(2.0) + 0.05), concrete);
  // outer wall under the stands, gates at the cardinal points
  add(wallGeometry(THREE, p, p.wall, 0, STADIUM.gates, STADIUM.gateHalf, STADIUM.gateH, floorY,
    () => STADIUM.hallTopY + 0.15), concrete);

  // strip lights along the hall ceiling
  const strip = [];
  for (let i = 0; i < 180; i++) {
    const t = ((i + 0.5) / 180) * TAU, r = (toe(t) + wall(t)) / 2;
    strip.push(p.c[0] + Math.sin(t) * r, p.c[1] + Math.cos(t) * r);
  }
  const box = new THREE.BoxGeometry(2.4, 0.08, 0.3);
  const lights = new THREE.InstancedMesh(box, trim, 180);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 180; i++) {
    const t = ((i + 0.5) / 180) * TAU, r = (toe(t) + wall(t)) / 2;
    const ceil = raisedSeatY(2 + Math.max(0, r - toe(t)) * 0.4) - 0.2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t + Math.PI / 2);
    m4.compose(new THREE.Vector3(strip[i * 2], Math.min(ceil, floorY + 3.4), strip[i * 2 + 1]), q, s);
    lights.setMatrixAt(i, m4);
  }
  lights.instanceMatrix.needsUpdate = true;
  group.add(lights);
  return { group };
}
