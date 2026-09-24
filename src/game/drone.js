import * as THREE from 'three';

export const DRONE = {
  key: 'drone',
  name: 'Suicide drone',
  short: 'drone',
  slot: 4,
  count: 10,
  speed: 16,
  boost: 24,
  climb: 9,
  radius: 9.5,
  damage: 150,
  hitR: 0.42,
  maxRange: 92,
};

const UP = new THREE.Vector3(0, 1, 0);

function shade(mat) {
  mat.roughness = mat.roughness ?? 0.45;
  mat.metalness = mat.metalness ?? 0.35;
  return mat;
}

export class SuicideDrone {
  constructor(world, fx, audio, combat, scene) {
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.combat = combat;
    this.scene = scene;
    this.live = null;
    this.cam = new THREE.PerspectiveCamera(72, 1, 0.06, 2400);
    this.opCam = new THREE.PerspectiveCamera(46, 1, 0.15, 2400);
    this.mesh = this.buildMesh();
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.opOrbit = 0;
    this.buzzT = 0;
  }

  get flying() { return !!this.live; }

  buildMesh() {
    const g = new THREE.Group();
    g.name = 'suicide-drone';
    const body = shade(new THREE.MeshStandardMaterial({ color: 0x1c1f22, metalness: 0.55, roughness: 0.38 }));
    const arm = shade(new THREE.MeshStandardMaterial({ color: 0x2a2e32, metalness: 0.4, roughness: 0.5 }));
    const accent = shade(new THREE.MeshStandardMaterial({ color: 0xc45a1a, emissive: 0x6a2208, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.4 }));
    const lens = new THREE.MeshStandardMaterial({ color: 0x111318, metalness: 0.8, roughness: 0.15, emissive: 0x143018, emissiveIntensity: 0.35 });
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.28), body);
    hub.castShadow = true;
    g.add(hub);
    const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.06, 10), lens);
    cam.rotation.x = Math.PI / 2;
    cam.position.set(0, -0.01, 0.16);
    g.add(cam);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), accent);
    led.position.set(0, 0.05, -0.1);
    g.add(led);
    this.rotors = [];
    const armLen = 0.2;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, armLen), arm);
      a.position.set(sx * 0.12, 0.01, sz * 0.12);
      a.lookAt(sx * 0.4, 0.01, sz * 0.4);
      g.add(a);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 8), body);
      motor.position.set(sx * 0.2, 0.03, sz * 0.2);
      g.add(motor);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.006, 0.028), new THREE.MeshStandardMaterial({
        color: 0x3a3a3a, metalness: 0.1, roughness: 0.7, transparent: true, opacity: 0.55,
      }));
      blade.position.copy(motor.position).setY(0.05);
      g.add(blade);
      this.rotors.push(blade);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    return g;
  }

  launch(owner) {
    if (this.live) return false;
    const fwd = new THREE.Vector3(Math.sin(owner.isPlayer ? this.world.player.yaw : 0), 0, Math.cos(owner.isPlayer ? this.world.player.yaw : 0));
    const pos = owner.pos.clone().add(new THREE.Vector3(0, 1.85, 0)).addScaledVector(fwd, 0.55);
    this.live = {
      owner,
      pos,
      vel: fwd.clone().multiplyScalar(4).setY(2.2),
      yaw: owner.isPlayer ? this.world.player.camYaw : 0,
      pitch: -0.12,
      spin: 0,
    };
    this.mesh.visible = true;
    this.mesh.position.copy(pos);
    this.audio.droneStart();
    return true;
  }

  look(dx, dy) {
    if (!this.live) return;
    this.live.yaw -= dx;
    this.live.pitch = THREE.MathUtils.clamp(this.live.pitch - dy, -1.15, 0.85);
  }

  fwd() {
    const { yaw, pitch } = this.live;
    return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  }

  update(dt, input) {
    if (!this.live) {
      this.mesh.visible = false;
      this.audio.droneHum?.(0);
      return;
    }
    const d = this.live;
    const fwd = this.fwd();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    const flatFwd = new THREE.Vector3(fwd.x, 0, fwd.z);
    if (flatFwd.lengthSq() > 1e-4) flatFwd.normalize();
    else flatFwd.set(Math.sin(d.yaw), 0, Math.cos(d.yaw));

    const boost = input.sprint ? DRONE.boost : DRONE.speed;
    const wish = new THREE.Vector3();
    if (input.forward) wish.add(flatFwd);
    if (input.back) wish.sub(flatFwd);
    if (input.right) wish.add(right);
    if (input.left) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(boost);
    const climb = ((input.climb || input.jump ? 1 : 0) - (input.crouch ? 1 : 0)) * DRONE.climb;
    wish.y += climb + fwd.y * (input.forward || input.back ? boost * 0.35 : 0);

    d.vel.lerp(wish, 1 - Math.exp(-dt * 4.5));
    const next = d.pos.clone().addScaledVector(d.vel, dt);
    const ground = this.world.terrain.heightAt(next.x, next.z);
    if (!this.world.terrain.inBounds(next.x, next.z) || next.y < ground + 0.18) {
      this.explode('crash');
      return;
    }
    const dir = d.vel.lengthSq() > 1e-4 ? d.vel.clone().normalize() : fwd;
    const hit = this.world.raycast(d.pos, dir, Math.max(0.35, d.vel.length() * dt + 0.25), d.owner);
    if (hit && !hit.drone && hit.t < 0.35) {
      this.explode('crash');
      return;
    }
    d.pos.copy(next);
    d.spin += dt * (18 + d.vel.length() * 0.8);
    this.mesh.position.copy(d.pos);
    this.mesh.rotation.set(d.pitch * 0.35, d.yaw, -right.dot(d.vel) * 0.015);
    for (const r of this.rotors) r.rotation.y = d.spin;

    const range = d.pos.distanceTo(d.owner.pos);
    if (range > DRONE.maxRange) {
      this.explode('range');
      return;
    }
    this.updateCameras(dt);
    this.audio.droneHum?.(0.35 + Math.min(0.45, d.vel.length() * 0.02));
  }

  updateCameras(dt) {
    const d = this.live;
    const look = this.fwd();
    this.cam.position.copy(d.pos).addScaledVector(look, 0.12).setY(d.pos.y - 0.02);
    this.cam.lookAt(this.cam.position.clone().add(look));
    this.cam.up.set(0, 1, 0);

    this.opOrbit += dt * 0.22;
    const owner = d.owner;
    const ox = owner.pos.x + Math.sin(this.opOrbit) * 7.4;
    const oz = owner.pos.z + Math.cos(this.opOrbit) * 7.4;
    const oy = owner.pos.y + 3.6;
    this.opCam.position.set(ox, oy, oz);
    this.opCam.lookAt(owner.pos.x, owner.pos.y + 1.15, owner.pos.z);
    if (owner.character?.root) owner.character.root.visible = true;
  }

  setAspect(w, h) {
    const hw = Math.max(1, w * 0.5);
    this.cam.aspect = hw / h;
    this.opCam.aspect = hw / h;
    this.cam.updateProjectionMatrix();
    this.opCam.updateProjectionMatrix();
  }

  raycast(o, d, maxDist) {
    if (!this.live) return null;
    const c = this.live.pos;
    const oc = new THREE.Vector3().subVectors(o, c);
    const b = oc.dot(d);
    const disc = b * b - (oc.lengthSq() - DRONE.hitR * DRONE.hitR);
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t <= 0 || t >= maxDist) return null;
    const p = o.clone().addScaledVector(d, t);
    return { t, normal: p.sub(c).normalize(), surface: 'metal', drone: this };
  }

  kill(attacker) {
    if (!this.live) return;
    const pos = this.live.pos.clone();
    this.fx.impact(pos, new THREE.Vector3(0, 1, 0), 'metal', new THREE.Vector3(0, 1, 0));
    this.audio.impact?.('metal', pos.distanceTo(this.world.player.camera.position));
    this.clear();
    this.fx.explosion(pos, 'ground');
    this.audio.explosion?.(pos.distanceTo(this.world.player.pos), 0, false);
  }

  explode(reason = 'detonate') {
    if (!this.live) return;
    const pos = this.live.pos.clone();
    const owner = this.live.owner;
    const shotDown = reason === 'shot';
    this.clear();
    const underwater = pos.y < 0.15;
    this.fx.explosion(pos, underwater ? 'water' : 'ground');
    const dist = pos.distanceTo(this.world.player.pos);
    this.audio.explosion?.(dist, 0, underwater);
    if (!shotDown) {
      const r = underwater ? DRONE.radius * 0.5 : DRONE.radius;
      this.combat.explode(this.world, pos, r, DRONE.damage, owner);
      this.world.props.blast?.(pos, r, 11);
    }
    this.world.weapons?.onExplosion?.(pos, dist);
  }

  clear() {
    this.live = null;
    this.mesh.visible = false;
    this.audio.droneHum?.(0);
  }
}
