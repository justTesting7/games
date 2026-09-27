import * as THREE from 'three';
import { PITCH, SURROUND } from '../world/dims.js';

const HL = PITCH.halfLength, HW = PITCH.halfWidth;
const STAND = HW + SURROUND.standSide;

// Rigs on the main (+Z) stand. `tele` is the high gantry used for the
// reference broadcast look; `broadcast` is the lower halfway camera.
export const VIEWS = {
  tele: { label: 'Tele broadcast', z: STAND + 7, y: 30, fov: 30, rail: 0.72, zoom: 0.14 },
  broadcast: { label: 'Broadcast', z: STAND + 15, y: 22, fov: 22, rail: 0.55, zoom: 0.12 },
  wide: { label: 'Wide', z: STAND + 5, y: 31, fov: 44, rail: 0.35, zoom: 0 },
  pro: { label: 'Player', z: 0, y: 0, fov: 50, rail: 0, zoom: 0 },
};

// Critically damped spring toward a moving target.
class Spring {
  constructor(v = new THREE.Vector3(), omega = 2) {
    this.x = v.clone();
    this.v = new THREE.Vector3();
    this.omega = omega;
  }
  update(target, dt) {
    const w = this.omega;
    const f = 1 + 2 * dt * w;
    const oo = w * w, hoo = dt * oo, hhoo = dt * hoo;
    const det = 1 / (f + hhoo);
    const dx = this.x.clone().sub(target);
    const detX = dx.clone().multiplyScalar(f).addScaledVector(this.v, dt).multiplyScalar(det);
    const detV = this.v.clone().addScaledVector(dx, -hoo).multiplyScalar(det);
    this.x.copy(target).add(detX);
    this.v.copy(detV);
    return this.x;
  }
  snap(v) { this.x.copy(v); this.v.set(0, 0, 0); }
}

export class BroadcastCamera {
  constructor(camera) {
    this.camera = camera;
    this.view = 'tele';
    this.mode = 'intro';
    this.modeT = 0;
    this.focus = new Spring(new THREE.Vector3(), 1.6);
    this.rig = new Spring(new THREE.Vector3(0, 30, STAND + 7), 1.1);
    this.fov = VIEWS.tele.fov;
    this.shot = null;
    this.focusPoint = new THREE.Vector3();
  }

  setView(v) {
    if (!VIEWS[v]) return;
    this.view = v;
    this.cut = true;
  }

  // Scripted cuts: 'intro', 'play', 'goal' (close on the scorer), 'fulltime'.
  setMode(mode, subject = null) {
    this.mode = mode;
    this.modeT = 0;
    this.subject = subject;
    this.cut = true;
  }

  update(dt, match) {
    this.modeT += dt;
    const cam = this.camera;
    const ball = match.ball.pos;
    if (this.mode === 'intro') return this.intro(dt);
    if (this.mode === 'goal' && this.subject && this.modeT < 4.6) return this.closeUp(dt, this.subject, match);
    if (this.mode === 'fulltime') return this.intro(dt, true);

    const V = VIEWS[this.view];
    const owner = match.owner;
    // Focus leads the ball in the direction of play, and in dead-ball
    // situations frames the taker and the target area.
    const f = this.focusPoint.copy(ball).setY(0);
    const vel = match.ball.vel;
    f.x += THREE.MathUtils.clamp(vel.x * 0.35, -9, 9);
    f.z += THREE.MathUtils.clamp(vel.z * 0.25, -5, 5);
    if (owner) f.x += owner.team.dir * 5;
    if (match.state === 'dead' && match.restart) {
      const r = match.restart;
      if (r.type === 'corner' || r.type === 'penalty' || r.type === 'freekick') f.lerp(r.team.attackGoal, r.type === 'penalty' ? 0.55 : 0.35);
    }
    f.x = THREE.MathUtils.clamp(f.x, -HL + 6, HL - 6);
    f.z = THREE.MathUtils.clamp(f.z, -HW + 4, HW - 2);

    if (this.view === 'pro') return this.behindPlayer(dt, match);

    const rigPos = new THREE.Vector3(f.x * V.rail, V.y, V.z);
    if (this.cut) {
      this.focus.snap(f);
      this.rig.snap(rigPos);
      this.cut = false;
    }
    const fp = this.focus.update(f, dt);
    const rp = this.rig.update(rigPos, dt);
    cam.position.copy(rp);
    // Aim a little beyond the ball so the far side stays in shot.
    const aim = new THREE.Vector3(fp.x, 0, fp.z - 2 - (1 - (fp.z + HW) / (2 * HW)) * 2);
    cam.lookAt(aim);
    // Zoom: tighter when play is on the far side, looser near goal.
    const dist = rp.distanceTo(aim);
    const baseDist = Math.hypot(V.y, V.z);
    let fov = V.fov * (baseDist / dist) ** (V.zoom * 3);
    const nearGoal = Math.abs(fp.x) > HL - 22;
    if (nearGoal) fov *= 1 + V.zoom * 0.8;
    this.fov += (fov - this.fov) * Math.min(1, dt * 1.5);
    cam.fov = THREE.MathUtils.clamp(this.fov, 12, 60);
    cam.updateProjectionMatrix();
  }

  behindPlayer(dt, match) {
    const cam = this.camera;
    const p = match.human || match.owner || match.players[9];
    const ball = match.ball.pos;
    const dir = p ? p.team.dir : 1;
    const target = new THREE.Vector3(p.pos.x - dir * 11, 6.5, p.pos.z * 0.85 + 0.1);
    if (this.cut) { this.rig.snap(target); this.focus.snap(ball); this.cut = false; }
    cam.position.copy(this.rig.update(target, dt));
    const look = this.focus.update(new THREE.Vector3().lerpVectors(p.pos, ball, 0.5).setY(1), dt);
    look.x += dir * 6;
    cam.lookAt(look);
    cam.fov = 50;
    cam.updateProjectionMatrix();
  }

  closeUp(dt, p, match) {
    const cam = this.camera;
    const fwd = p.forward(new THREE.Vector3());
    const target = p.pos.clone().addScaledVector(fwd, 5.5).add(new THREE.Vector3(0, 1.7, 0));
    // Keep the camera on the pitch side of the scorer.
    target.x = THREE.MathUtils.clamp(target.x, -HL - 3, HL + 3);
    target.z = THREE.MathUtils.clamp(target.z, -HW - 3, HW + 3);
    if (this.cut) { this.rig.snap(target); this.focus.snap(p.pos); this.cut = false; }
    cam.position.copy(this.rig.update(target, dt * 1.6));
    const look = this.focus.update(p.pos.clone().setY(1.35), dt * 2);
    cam.lookAt(look);
    cam.fov = 34;
    cam.updateProjectionMatrix();
    if (this.modeT > 4.5) { this.mode = 'play'; this.cut = true; }
  }

  // Slow crane around the bowl before kick-off / after the final whistle.
  intro(dt, outro = false) {
    const cam = this.camera;
    const t = this.modeT;
    const a = (outro ? 1.2 : 0.35) + t * 0.06;
    // Stay inside the bowl, in front of the lower tier.
    const k = 1 - Math.min(t, 14) * 0.012;
    cam.position.set(Math.cos(a) * 56 * k, 15 + Math.sin(t * 0.17) * 3, Math.sin(a) * 40 * k);
    cam.lookAt(Math.cos(a + 2.6) * 8, 1.5, Math.sin(a + 2.6) * 5);
    cam.fov = 46;
    cam.updateProjectionMatrix();
  }
}
