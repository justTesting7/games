import * as THREE from 'three';

const TILE = 512;
const COLS = 4, ROWS = 2;
// Atlas tiles: 0-2 directional ground spatter, 3-4 wall spatter with runs, 5-6 pools, 7 smear.
export const TILES = { spatter: [0, 1, 2], wall: [3, 4], pool: [5, 6], smear: [7] };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  return (rand() + rand() + rand() - 1.5) / 1.5;
}

function blob(ctx, cx, cy, r, jag, rand, stretch = 1, angle = 0) {
  const ph = [rand() * 6.3, rand() * 6.3, rand() * 6.3, rand() * 6.3];
  const ca = Math.cos(angle), sa = Math.sin(angle);
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const k = 1 + jag * (0.45 * Math.sin(a * 3 + ph[0]) + 0.3 * Math.sin(a * 5 + ph[1]) + 0.17 * Math.sin(a * 9 + ph[2]) + 0.08 * Math.sin(a * 17 + ph[3]));
    const x = Math.cos(a) * r * k * stretch, y = Math.sin(a) * r * k;
    const px = cx + x * ca - y * sa, py = cy + x * sa + y * ca;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.fill();
}

function ellipse(ctx, x, y, rx, ry, angle) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), angle, 0, Math.PI * 2);
  ctx.fill();
}

// Tapered spine from the main mass ending in a teardrop, the classic high-velocity spatter shape.
function spine(ctx, x0, y0, ang, len, w0, rand) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const nx = -sa, ny = ca;
  const x1 = x0 + ca * len, y1 = y0 + sa * len;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * w0, y0 + ny * w0);
  ctx.quadraticCurveTo(x0 + ca * len * 0.5 + nx * w0 * 0.35, y0 + sa * len * 0.5 + ny * w0 * 0.35, x1, y1);
  ctx.quadraticCurveTo(x0 + ca * len * 0.5 - nx * w0 * 0.35, y0 + sa * len * 0.5 - ny * w0 * 0.35, x0 - nx * w0, y0 - ny * w0);
  ctx.fill();
  const dr = w0 * (0.5 + rand() * 0.6);
  ellipse(ctx, x1 + ca * dr * 1.2, y1 + sa * dr * 1.2, dr * 1.7, dr, ang);
}

function drawSpatter(ctx, ox, oy, rand, { bias = 0.8, drips = 0 } = {}) {
  const S = TILE;
  const cx = ox + S * (bias > 0.3 ? 0.36 : 0.5), cy = oy + S * (drips ? 0.4 : 0.5);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  blob(ctx, cx, cy, S * (0.08 + rand() * 0.04), 0.35, rand, 1.25, gauss(rand) * 0.2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 5; i++) {
    blob(ctx, cx + S * (0.02 + rand() * 0.1), cy + gauss(rand) * S * 0.06, S * (0.02 + rand() * 0.04), 0.4, rand);
  }
  const dir = () => (bias > 0.3 ? gauss(rand) * (1.9 - bias) : rand() * Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 12 + rand() * 8; i++) {
    const a = dir();
    spine(ctx, cx + Math.cos(a) * S * 0.05, cy + Math.sin(a) * S * 0.05, a, S * (0.08 + rand() * 0.28), 2 + rand() * 5, rand);
  }
  for (let i = 0; i < 160; i++) {
    const a = dir();
    const d = S * (0.1 + Math.pow(rand(), 0.7) * 0.42);
    const r = Math.max(0.6, (1 - d / (S * 0.55)) * (1 + rand() * 5));
    ctx.fillStyle = `rgba(255,255,255,${0.55 + rand() * 0.4})`;
    ellipse(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (1 + d / S * 3), r, a);
  }
  for (let i = 0; i < 400; i++) {
    const a = dir();
    const d = S * (0.05 + rand() * 0.48);
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.35})`;
    ellipse(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.5 + rand() * 1.1, 0.5 + rand() * 0.8, a);
  }
  // Runs: gravity pulls the thicker parts down a vertical surface (canvas +y is down the wall).
  for (let i = 0; i < drips; i++) {
    const x = cx + gauss(rand) * S * 0.09;
    const y = cy + S * (0.02 + rand() * 0.05);
    const len = S * (0.12 + rand() * 0.38);
    let w = 2.5 + rand() * 4;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    let px = x;
    for (let t = 0; t < len; t += 2) {
      px += gauss(rand) * 0.35;
      ellipse(ctx, px, y + t, w, 2, 0);
      w = Math.max(1.3, w * 0.996);
    }
    ellipse(ctx, px, y + len + w * 0.8, w * 1.35, w * 1.8, 0);
  }
}

function drawPool(ctx, ox, oy, rand) {
  const S = TILE;
  const cx = ox + S / 2, cy = oy + S / 2;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  blob(ctx, cx, cy, S * 0.3, 0.22, rand, 1.1, rand() * 3);
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2;
    blob(ctx, cx + Math.cos(a) * S * 0.2, cy + Math.sin(a) * S * 0.2, S * (0.08 + rand() * 0.08), 0.3, rand);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  for (let i = 0; i < 20; i++) {
    const a = rand() * Math.PI * 2, d = S * (0.36 + rand() * 0.08);
    ellipse(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rand() * 4, 1 + rand() * 3, a);
  }
}

function drawSmear(ctx, ox, oy, rand) {
  const S = TILE;
  for (let i = 0; i < 26; i++) {
    const y = oy + S * (0.3 + i / 26 * 0.4);
    ctx.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.5})`;
    ctx.fillRect(ox + S * (0.12 + rand() * 0.05), y, S * (0.55 + rand() * 0.25), 1 + rand() * 5);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  blob(ctx, ox + S * 0.18, oy + S * 0.5, S * 0.1, 0.3, rand, 0.8);
}

/**
 * Turns a "thickness" canvas (alpha = amount of blood) into a colour map and a
 * normal map, so thin films read bright red and thick pools dark and glossy.
 */
function finishTextures(src, strength = 3) {
  const w = src.width, h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    H[i] = a * a * (3 - 2 * a);
  }
  const col = document.createElement('canvas');
  col.width = w; col.height = h;
  const nrm = document.createElement('canvas');
  nrm.width = w; nrm.height = h;
  const cImg = col.getContext('2d').createImageData(w, h);
  const nImg = nrm.getContext('2d').createImageData(w, h);
  const at = (x, y) => H[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = H[i];
      const a = data[i * 4 + 3] / 255;
      cImg.data[i * 4] = 118 - 80 * t;
      cImg.data[i * 4 + 1] = 7 - 5 * t;
      cImg.data[i * 4 + 2] = 6 - 4 * t;
      cImg.data[i * 4 + 3] = Math.min(255, a * 2.4 * 255);
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      nImg.data[i * 4] = (-dx / l * 0.5 + 0.5) * 255;
      nImg.data[i * 4 + 1] = (dy / l * 0.5 + 0.5) * 255;
      nImg.data[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
      nImg.data[i * 4 + 3] = 255;
    }
  }
  col.getContext('2d').putImageData(cImg, 0, 0);
  nrm.getContext('2d').putImageData(nImg, 0, 0);
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.anisotropy = 8;
  return { map, normalMap };
}

function bloodMaterial(tex) {
  return new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.16,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    // Scene alpha stores depth for fog / SSR, so decals must leave it untouched.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

export class BloodDecals {
  constructor(scene, terrain, { maxSplats = 56, maxDrops = 700 } = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.maxSplats = maxSplats;
    this.splats = [];
    this.pools = [];

    const atlas = document.createElement('canvas');
    atlas.width = TILE * COLS; atlas.height = TILE * ROWS;
    const ctx = atlas.getContext('2d');
    const rand = rng(1917);
    for (let i = 0; i < COLS * ROWS; i++) {
      const ox = (i % COLS) * TILE, oy = Math.floor(i / COLS) * TILE;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox + 6, oy + 6, TILE - 12, TILE - 12);
      ctx.clip();
      if (TILES.spatter.includes(i)) drawSpatter(ctx, ox, oy, rand, { bias: 0.9 });
      else if (TILES.wall.includes(i)) drawSpatter(ctx, ox, oy, rand, { bias: 0.2, drips: 4 + Math.floor(rand() * 4) });
      else if (TILES.pool.includes(i)) drawPool(ctx, ox, oy, rand);
      else drawSmear(ctx, ox, oy, rand);
      ctx.restore();
    }
    this.material = bloodMaterial(finishTextures(atlas));

    const dropCanvas = document.createElement('canvas');
    dropCanvas.width = dropCanvas.height = 128;
    const dctx = dropCanvas.getContext('2d');
    dctx.fillStyle = 'rgba(255,255,255,0.95)';
    blob(dctx, 64, 64, 22, 0.2, rand);
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2, d = 26 + rand() * 30;
      dctx.fillStyle = `rgba(255,255,255,${0.5 + rand() * 0.4})`;
      ellipse(dctx, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + rand() * 3, 1 + rand() * 2, a);
    }
    this.dropMaterial = bloodMaterial(finishTextures(dropCanvas, 2));
    this.maxDrops = maxDrops;
    this.drops = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.dropMaterial, maxDrops);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.drops.receiveShadow = true;
    this.drops.renderOrder = 2;
    this.dropNext = 0;
    scene.add(this.drops);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  // Grid that follows the terrain when it lies on the ground, flat quad otherwise.
  geometry(center, n, t, size, tile, onGround) {
    const N = onGround ? 6 : 1;
    const b = new THREE.Vector3().crossVectors(n, t);
    const u0 = (tile % COLS) / COLS, v0 = 1 - (Math.floor(tile / COLS) + 1) / ROWS;
    const pos = [], uv = [], nrm = [], idx = [];
    const p = new THREE.Vector3();
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const su = (i / N - 0.5) * size, sv = (j / N - 0.5) * size;
        p.copy(center).addScaledVector(t, su).addScaledVector(b, sv);
        let ny = n;
        if (onGround) {
          p.y = this.terrain.heightAt(p.x, p.z) + 0.018;
          ny = this.terrain.normalAt(p.x, p.z);
        } else p.addScaledVector(n, 0.012);
        pos.push(p.x - center.x, p.y - center.y, p.z - center.z);
        nrm.push(ny.x, ny.y, ny.z);
        uv.push(u0 + (i / N) / COLS, v0 + (j / N) / ROWS);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, c = a + N + 1;
        idx.push(a, a + 1, c + 1, a, c + 1, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  /**
   * Places a splatter decal at `point` on a surface with normal `n`, with the
   * spatter streaks pointing along `travel` (projected into the surface).
   */
  splat(point, n, travel, size, kind = 'spatter') {
    const nn = n.clone().normalize();
    const vertical = Math.abs(nn.y) < 0.55;
    let t;
    if (vertical) {
      t = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), nn).normalize();
      if (kind === 'spatter') kind = 'wall';
    } else {
      t = travel.clone().addScaledVector(nn, -travel.dot(nn));
      if (t.lengthSq() < 1e-4) t.set(1, 0, 0).addScaledVector(nn, -nn.x);
      t.normalize();
    }
    const tiles = TILES[kind] || TILES.spatter;
    const tile = tiles[Math.floor(Math.random() * tiles.length)];
    const onGround = !vertical && Math.abs(this.terrain.heightAt(point.x, point.z) - point.y) < 0.25;
    const tt = vertical ? t : t.clone().applyAxisAngle(nn, (Math.random() - 0.5) * 0.25);
    const mesh = new THREE.Mesh(this.geometry(point, nn, tt, size, tile, onGround), this.material);
    mesh.position.copy(point);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.splats.push(mesh);
    while (this.splats.length > this.maxSplats) {
      const old = this.splats.shift();
      old.removeFromParent();
      old.geometry.dispose();
      this.pools = this.pools.filter((p) => p.mesh !== old);
    }
    return mesh;
  }

  /** A pool that seeps out from under a body over several seconds. */
  pool(point, size = 1.6, delay = 0.8) {
    const p = point.clone();
    p.y = this.terrain.heightAt(p.x, p.z);
    const mesh = this.splat(p, this.terrain.normalAt(p.x, p.z), new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5), size, 'pool');
    mesh.scale.set(0.001, 1, 0.001);
    this.pools.push({ mesh, t: -delay, dur: 7 + Math.random() * 4 });
  }

  drop(x, y, z, size) {
    const i = this.dropNext;
    this.dropNext = (i + 1) % this.maxDrops;
    this._q.setFromAxisAngle(this._v.set(0, 1, 0), Math.random() * Math.PI * 2);
    this._m.compose(this._v.set(x, y + 0.016, z), this._q, this._s.set(size, 1, size * (0.8 + Math.random() * 0.4)));
    this.drops.setMatrixAt(i, this._m);
    this.drops.count = Math.max(this.drops.count, i + 1);
    this.drops.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const m of this.splats) { m.removeFromParent(); m.geometry.dispose(); }
    this.splats = [];
    this.pools = [];
    this.drops.count = 0;
    this.dropNext = 0;
  }

  update(dt) {
    for (const p of this.pools) {
      p.t += dt;
      if (p.t <= 0) continue;
      const k = Math.min(1, p.t / p.dur);
      const s = Math.max(0.001, 1 - Math.pow(1 - k, 2.2));
      p.mesh.scale.set(s, 1, s);
    }
    this.pools = this.pools.filter((p) => p.t < p.dur);
  }
}
