import * as THREE from 'three';

// Bullet holes left on walls, ground and props: a pool of small quads per surface kind
// (chipped concrete, bright scratched metal, starred glass, splintered wood), laid flat
// on the hit surface with a random twist. The oldest hole is reused when a pool is full.

const KINDS = { concrete: 0, rock: 0, cover: 0, sand: 0, grass: 0, metal: 1, glass: 2, wood: 3, target: 3 };
const SIZE = [0.09, 0.07, 0.16, 0.08];
const PER_KIND = 64;

function texture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  const rnd = (() => { let s = 1234 + kind * 77; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  if (kind === 2) {
    // glass: a white star of cracks around a small hole
    g.strokeStyle = 'rgba(230,240,245,0.85)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + rnd() * 0.4, r = 18 + rnd() * 12;
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * r * 0.5 + rnd() * 3, Math.sin(a) * r * 0.5 + rnd() * 3);
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      g.stroke();
    }
    g.strokeStyle = 'rgba(230,240,245,0.5)';
    for (const r of [7, 13]) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(20,24,28,0.9)';
    g.beginPath(); g.arc(0, 0, 3, 0, Math.PI * 2); g.fill();
  } else {
    // a chipped ring (paler concrete, bright metal, pale splinters) around a dark hole
    const ring = ['rgba(150,145,138,0.9)', 'rgba(215,220,225,0.95)', '', 'rgba(205,170,120,0.9)'][kind];
    g.fillStyle = ring;
    g.beginPath();
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI * 2, r = (kind === 3 ? 10 : 12) + rnd() * (kind === 3 ? 12 : 7);
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r * (kind === 3 ? 0.55 : 1));
    }
    g.fill();
    const grad = g.createRadialGradient(0, 0, 1, 0, 0, 7);
    grad.addColorStop(0, 'rgba(8,8,8,1)');
    grad.addColorStop(1, 'rgba(25,23,21,0.85)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, kind === 1 ? 5 : 6.5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BulletHoles {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.pools = [0, 1, 2, 3].map((kind) => {
      const mat = new THREE.MeshStandardMaterial({
        map: texture(kind), transparent: true, depthWrite: false, roughness: kind === 1 ? 0.35 : 0.9,
        metalness: kind === 1 ? 0.6 : 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      // leave the scene depth the HDR target keeps in alpha (engine/patch.js)
      mat.blending = THREE.CustomBlending;
      mat.blendSrcAlpha = THREE.ZeroFactor;
      mat.blendDstAlpha = THREE.OneFactor;
      const mesh = new THREE.InstancedMesh(geo, mat, PER_KIND);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      return { mesh, next: 0 };
    });
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._r = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._z = new THREE.Vector3(0, 0, 1);
  }

  add(point, normal, surface) {
    const kind = KINDS[surface];
    if (kind === undefined || !normal) return;
    const pool = this.pools[kind];
    const n = this._p.set(normal.x, normal.y, normal.z);
    if (n.lengthSq() < 1e-6) return;
    n.normalize();
    this._q.setFromUnitVectors(this._z, n).multiply(this._r.setFromAxisAngle(this._z, Math.random() * Math.PI * 2));
    const size = SIZE[kind] * (0.8 + Math.random() * 0.4);
    const at = this._s.copy(point).addScaledVector(n, 0.004);
    this._m.compose(at, this._q, new THREE.Vector3(size, size, size));
    const i = pool.next;
    pool.mesh.setMatrixAt(i, this._m);
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.next = (i + 1) % PER_KIND;
    pool.mesh.count = Math.max(pool.mesh.count, i + 1);
  }

  clear() {
    for (const p of this.pools) { p.mesh.count = 0; p.next = 0; }
  }
}
