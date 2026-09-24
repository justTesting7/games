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

function makeDroneMesh() {
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
  const rotors = [];
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
    rotors.push(blade);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return { group: g, rotors, ledMat: accent, lensMat: lens };
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
    this.trailAcc = 0;
    this.chunks = [];
    this.chunkMats = [
      shade(new THREE.MeshStandardMaterial({ color: 0x2a2e32, metalness: 0.55, roughness: 0.42, emissive: 0x5a1c08, emissiveIntensity: 0.55 })),
      shade(new THREE.MeshStandardMaterial({ color: 0x1c1f22, metalness: 0.65, roughness: 0.32 })),
    ];
  }

  get flying() { return !!this.live; }
  get dying() { return !!this.live?.dying; }
  get fadeOut() {
    const d = this.live;
    return !!(d?.dying && d.phase === 'hold' && d.dieT > (d.holdUntil - 0.32));
  }

  buildMesh() {
    const { group, rotors, ledMat, lensMat } = makeDroneMesh();
    this.rotors = rotors;
    this.ledMat = ledMat;
    this.lensMat = lensMat;
    return group;
  }

  pack() {
    const d = this.live;
    if (!d) return null;
    return {
      p: [+d.pos.x.toFixed(2), +d.pos.y.toFixed(2), +d.pos.z.toFixed(2)],
      yaw: +d.yaw.toFixed(3),
      pitch: +d.pitch.toFixed(3),
    };
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
      roll: 0,
      dying: false,
      phase: 'fly',
      dieT: 0,
    };
    this.mesh.visible = true;
    this.mesh.position.copy(pos);
    this.audio.droneStart();
    return true;
  }

  look(dx, dy) {
    if (!this.live || this.live.dying) return;
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
    if (d.dying) {
      this.updateDying(dt);
      return;
    }
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
    if (d.dying) {
      const kick = 0.045 + Math.min(0.08, d.dieT * 0.04);
      this.cam.position.x += Math.sin(d.dieT * 53.1) * kick;
      this.cam.position.y += Math.cos(d.dieT * 41.7) * kick * 0.85;
      this.cam.position.z += Math.sin(d.dieT * 29.3) * kick * 0.55;
    }
    this.cam.lookAt(this.cam.position.clone().add(look));
    if (d.dying) {
      const roll = d.roll || 0;
      this.cam.up.set(Math.sin(roll), Math.cos(roll), Math.sin(roll * 0.35) * 0.25).normalize();
    } else {
      this.cam.up.set(0, 1, 0);
    }

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
    if (!this.live || this.live.dying) return null;
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
    if (!this.live || this.live.dying) return;
    const d = this.live;
    const pos = d.pos.clone();
    const from = attacker?.pos ? pos.clone().sub(attacker.pos) : this.fwd();
    from.y *= 0.4;
    if (from.lengthSq() < 1e-4) from.copy(this.fwd());
    from.normalize();
    this.fx.droneKill?.(pos, from);
    this.fx.impact(pos, from.clone().negate(), 'metal', from);
    this.audio.impact?.('metal', pos.distanceTo(this.world.player.camera.position));
    this.audio.droneShotDown?.();
    d.dying = true;
    d.phase = 'tumble';
    d.dieT = 0;
    d.roll = (Math.random() < 0.5 ? -1 : 1) * 0.35;
    d.rollVel = (Math.sign(d.roll) || 1) * (5.2 + Math.random() * 2.8);
    d.pitchVel = -1.8 - Math.random() * 1.4;
    d.yawVel = (Math.random() - 0.5) * 4.2;
    d.vel.addScaledVector(from, 7.5).y += 2.4;
    d.holdUntil = 0;
    this.trailAcc = 0;
    this.spawnChunks(pos, from);
    if (this.ledMat) this.ledMat.emissiveIntensity = 2.4;
  }

  updateDying(dt) {
    const d = this.live;
    d.dieT += dt;
    this.updateChunks(dt);
    if (d.phase === 'hold') {
      this.updateCameras(dt);
      this.audio.droneHum?.(0);
      if (d.dieT >= d.holdUntil) this.clear();
      return;
    }

    d.vel.y -= 16.5 * dt;
    const drag = Math.exp(-dt * 0.45);
    d.vel.x *= drag;
    d.vel.z *= drag;
    d.yaw += d.yawVel * dt;
    d.pitch = THREE.MathUtils.clamp(d.pitch + d.pitchVel * dt, -1.45, 1.15);
    d.roll += d.rollVel * dt;
    d.rollVel *= Math.exp(-dt * 0.12);
    d.spin += dt * Math.max(1.5, 24 - d.dieT * 13);

    const next = d.pos.clone().addScaledVector(d.vel, dt);
    const ground = this.world.terrain.heightAt(next.x, next.z);
    const timedOut = d.dieT > 1.65;
    const out = !this.world.terrain.inBounds(next.x, next.z);
    if (!out && next.y < ground + 0.16 && d.dieT < 0.45) {
      next.y = ground + 0.16;
      d.vel.y = Math.abs(d.vel.y) * 0.4 + 3.1;
      d.rollVel *= 1.2;
      d.yawVel += (Math.random() - 0.5) * 3;
    } else if (out || next.y < ground + 0.16 || timedOut) {
      if (!out) next.y = Math.max(next.y, ground + 0.1);
      d.pos.copy(next);
      this.mesh.position.copy(d.pos);
      this.crashOut();
      return;
    }
    d.pos.copy(next);
    this.mesh.position.copy(d.pos);
    this.mesh.rotation.set(d.pitch + d.dieT * 2.8, d.yaw, d.roll);
    for (const r of this.rotors) r.rotation.y = d.spin;
    if (this.ledMat) this.ledMat.emissiveIntensity = Math.random() < 0.42 ? 2.6 : 0.04;
    if (this.lensMat) this.lensMat.emissiveIntensity = Math.random() < 0.25 ? 1.1 : 0.08;

    this.trailAcc += dt;
    if (this.trailAcc > 0.028) {
      this.trailAcc = 0;
      this.fx.droneTrail?.(d.pos, d.vel);
    }
    this.updateCameras(dt);
  }

  crashOut() {
    const d = this.live;
    const pos = d.pos.clone();
    const underwater = pos.y < 0.15;
    this.fx.explosion(pos, underwater ? 'water' : 'ground');
    this.audio.explosion?.(pos.distanceTo(this.world.player.pos), 0, underwater);
    this.world.weapons?.onExplosion?.(pos, pos.distanceTo(this.world.player.pos));
    d.phase = 'hold';
    d.holdUntil = d.dieT + 0.82;
    d.vel.set(0, 0, 0);
    this.mesh.visible = false;
    this.audio.droneHum?.(0);
    this.updateCameras(0);
  }

  spawnChunks(pos, incoming) {
    this.purgeChunks();
    for (let i = 0; i < 8; i++) {
      const geo = i < 5
        ? new THREE.BoxGeometry(0.035 + Math.random() * 0.07, 0.012 + Math.random() * 0.02, 0.03 + Math.random() * 0.055)
        : new THREE.CylinderGeometry(0.01, 0.014, 0.045 + Math.random() * 0.03, 6);
      const mesh = new THREE.Mesh(geo, this.chunkMats[i % this.chunkMats.length]);
      mesh.castShadow = true;
      mesh.position.copy(pos).add(new THREE.Vector3().randomDirection().multiplyScalar(0.06));
      const vel = incoming.clone().multiplyScalar(3 + Math.random() * 7)
        .add(new THREE.Vector3().randomDirection().multiplyScalar(3.5));
      vel.y = Math.abs(vel.y) + 2.2 + Math.random() * 3;
      this.scene.add(mesh);
      this.chunks.push({
        mesh,
        vel,
        spin: new THREE.Vector3().randomDirection().multiplyScalar(9 + Math.random() * 12),
        life: 1.6 + Math.random() * 0.7,
        age: 0,
      });
    }
  }

  updateChunks(dt) {
    for (const c of this.chunks) {
      c.age += dt;
      c.vel.y -= 15 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      const h = this.world.terrain.heightAt(c.mesh.position.x, c.mesh.position.z);
      if (c.mesh.position.y < h + 0.02) {
        c.mesh.position.y = h + 0.02;
        if (c.vel.y < 0) c.vel.y *= -0.28;
        c.vel.x *= 0.55;
        c.vel.z *= 0.55;
        c.spin.multiplyScalar(0.65);
      }
      c.mesh.visible = c.age < c.life;
    }
  }

  purgeChunks() {
    for (const c of this.chunks) {
      c.mesh.removeFromParent();
      c.mesh.geometry.dispose();
    }
    this.chunks = [];
  }

  explode(reason = 'detonate') {
    if (!this.live || this.live.dying) return;
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
      this.combat.explode(this.world, pos, r, DRONE.damage, owner, { weapon: 'drone' });
      this.world.props.blast?.(pos, r, 11);
    }
    this.world.weapons?.onExplosion?.(pos, dist);
    this.world.weapons?.session?.reportDrone('boom', { p: [pos.x, pos.y, pos.z], reason });
  }

  clear() {
    this.live = null;
    this.mesh.visible = false;
    this.mesh.rotation.set(0, 0, 0);
    this.cam.up.set(0, 1, 0);
    if (this.ledMat) this.ledMat.emissiveIntensity = 0.7;
    if (this.lensMat) this.lensMat.emissiveIntensity = 0.35;
    this.audio.droneHum?.(0);
    this.purgeChunks();
  }
}

// Other players' drones: same hit box and wreck, driven by the room instead of input.
export class RemoteDrone {
  constructor(scene, fx, audio, ownerId) {
    this.remote = true;
    this.ownerId = ownerId;
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.mesh = this.buildMesh();
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.spin = 0;
    this.vel = new THREE.Vector3();
    this.live = false;
    this.dying = false;
    this.dieT = 0;
  }

  get flying() { return this.live && !this.dying; }

  buildMesh() {
    const { group, rotors, ledMat, lensMat } = makeDroneMesh();
    this.rotors = rotors;
    this.ledMat = ledMat;
    this.lensMat = lensMat;
    return group;
  }

  apply(p, yaw, pitch) {
    if (this.dying) return;
    this.target.set(p[0], p[1], p[2]);
    this.yaw = yaw || 0;
    this.pitch = pitch || 0;
    if (!this.live) {
      this.pos.copy(this.target);
      this.live = true;
    }
    this.mesh.visible = true;
  }

  tick(dt, terrain) {
    if (!this.live) {
      this.mesh.visible = false;
      return;
    }
    if (this.dying) {
      this.dieT += dt;
      this.vel.y -= 16 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.x += dt * 3.2;
      this.mesh.rotation.z += dt * 4.1;
      for (const r of this.rotors || []) r.rotation.y += dt * 18;
      const ground = terrain?.heightAt?.(this.pos.x, this.pos.z) ?? 0;
      if (this.dieT > 1.2 || this.pos.y < ground + 0.12) this.crash();
      return;
    }
    this.pos.lerp(this.target, 1 - Math.exp(-dt * 16));
    this.spin += dt * 22;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch * 0.35, this.yaw, 0);
    this.mesh.visible = true;
    for (const r of this.rotors || []) r.rotation.y = this.spin;
  }

  raycast(o, d, maxDist) {
    if (!this.live || this.dying) return null;
    const c = this.pos;
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
    if (!this.live || this.dying) return;
    const from = attacker?.pos ? this.pos.clone().sub(attacker.pos) : new THREE.Vector3(0, 1, 0);
    from.y *= 0.4;
    if (from.lengthSq() < 1e-4) from.set(0, 1, 0);
    from.normalize();
    this.fx.droneKill?.(this.pos, from);
    this.fx.impact(this.pos, from.clone().negate(), 'metal', from);
    this.audio.droneShotDown?.();
    this.dying = true;
    this.dieT = 0;
    this.vel.copy(from).multiplyScalar(7).setY(2.4);
  }

  explode() {
    if (!this.live) return;
    const pos = this.pos.clone();
    this.fx.explosion(pos, pos.y < 0.15 ? 'water' : 'ground');
    this.audio.explosion?.(pos.length(), 0, pos.y < 0.15);
    this.dispose();
  }

  crash() {
    if (!this.live) return;
    const pos = this.pos.clone();
    this.fx.explosion(pos, pos.y < 0.15 ? 'water' : 'ground');
    this.audio.explosion?.(8, 0, pos.y < 0.15);
    this.dispose();
  }

  dispose() {
    this.live = false;
    this.dying = false;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
  }
}
