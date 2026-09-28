import * as THREE from 'three';

const SCHOOLS = 16;
const FISH_EACH = 28;
const COUNT = SCHOOLS * FISH_EACH;

const PALETTE = [
  [0.95, 0.72, 0.18],
  [0.22, 0.55, 0.82],
  [0.92, 0.38, 0.16],
  [0.78, 0.86, 0.9],
  [0.18, 0.7, 0.55],
  [0.96, 0.55, 0.62],
];

function fishGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.2, 0);
  shape.quadraticCurveTo(0.06, 0.07, -0.1, 0.034);
  shape.lineTo(-0.22, 0.09);
  shape.lineTo(-0.14, 0);
  shape.lineTo(-0.22, -0.09);
  shape.lineTo(-0.1, -0.034);
  shape.quadraticCurveTo(0.06, -0.07, 0.2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.042, bevelEnabled: false, curveSegments: 4 });
  g.rotateY(Math.PI / 2);
  g.center();
  return g;
}

function waterOk(terrain, x, z) {
  return terrain.heightAt(x, z) < -1.6;
}

export class Fish {
  constructor(terrain) {
    this.terrain = terrain;
    this.schools = [];
    this.t = 0;
    const geo = fishGeometry();
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.38,
      metalness: 0.28,
      vertexColors: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.dummy = new THREE.Object3D();
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.seedSchools();
    this.writeAll();
  }

  seedSchools() {
    let placed = 0;
    for (let i = 0; i < 80 && this.schools.length < SCHOOLS; i++) {
      const ang = i * 2.17 + 0.4;
      const dist = 640 + (i % 7) * 48 + (i % 3) * 18;
      const x = Math.sin(ang) * dist;
      const z = Math.cos(ang) * dist;
      if (!waterOk(this.terrain, x, z)) continue;
      const floor = this.terrain.heightAt(x, z);
      const y = Math.min(-1.4, Math.max(floor + 2.2, -14 + (i % 5)));
      const pal = PALETTE[placed % PALETTE.length];
      this.schools.push({
        x, y, z,
        heading: ang + Math.PI * 0.5,
        turn: 0.18 + (i % 5) * 0.04,
        radius: 6 + (i % 4) * 2.2,
        speed: 1.6 + (i % 4) * 0.25,
        color: pal,
        scale: 0.7 + (i % 5) * 0.12,
      });
      placed++;
    }
    while (this.schools.length < SCHOOLS) {
      const s = this.schools[0] || { x: 700, y: -6, z: 0, heading: 0, turn: 0.2, radius: 7, speed: 1.8, color: PALETTE[0], scale: 0.8 };
      this.schools.push({ ...s, heading: s.heading + this.schools.length * 0.4, x: s.x + 12, z: s.z - 10 });
    }
  }

  writeAll(dt = 0) {
    const dummy = this.dummy;
    const col = this.mesh.instanceColor.array;
    let i = 0;
    for (const s of this.schools) {
      for (let k = 0; k < FISH_EACH; k++, i++) {
        const u = k / FISH_EACH;
        const orbit = u * Math.PI * 2 + this.t * 0.35 + s.heading;
        const wobble = Math.sin(this.t * 7.5 + k * 1.7);
        const px = s.x + Math.cos(orbit) * s.radius * (0.45 + (k % 5) * 0.12);
        const pz = s.z + Math.sin(orbit) * s.radius * (0.45 + (k % 3) * 0.16);
        const floor = this.terrain.heightAt(px, pz);
        const py = Math.max(floor + 0.45, Math.min(-0.55, s.y + Math.sin(orbit * 2 + k) * 0.8 + wobble * 0.12));
        const yaw = orbit + Math.PI * 0.5 + wobble * 0.25;
        dummy.position.set(px, py, pz);
        dummy.rotation.set(0, -yaw, wobble * 0.18);
        dummy.scale.setScalar(s.scale * (0.75 + (k % 4) * 0.08));
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        col[i * 3] = s.color[0] * (0.85 + (k % 3) * 0.08);
        col[i * 3 + 1] = s.color[1];
        col[i * 3 + 2] = s.color[2];
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = COUNT;
  }

  update(dt, camera) {
    this.t += dt;
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (const s of this.schools) {
      const near = Math.hypot(s.x - cx, s.z - cz) < 240;
      if (!near) continue;
      s.heading += Math.sin(this.t * s.turn + s.x * 0.01) * dt * 0.55;
      s.x += Math.sin(s.heading) * s.speed * dt;
      s.z += Math.cos(s.heading) * s.speed * dt;
      if (!waterOk(this.terrain, s.x, s.z)) {
        s.heading += Math.PI * 0.65;
        s.x += Math.sin(s.heading) * 2;
        s.z += Math.cos(s.heading) * 2;
      }
      const floor = this.terrain.heightAt(s.x, s.z);
      s.y = Math.max(floor + 1.6, Math.min(-1.3, s.y + Math.sin(this.t * 0.4 + s.x) * dt * 0.3));
    }
    this.writeAll(dt);
  }
}
