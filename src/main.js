import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { Progress } from './engine/assets.js';
import { generateHeightmap, loadTerrainTextures, Terrain } from './world/terrain.js';
import { Grass } from './world/grass.js';
import { Vegetation } from './world/vegetation.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const pipeline = new Pipeline(renderer);
pipeline.setQuality('high');
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);

const progress = new Progress((p) => {
  document.getElementById('loadbar').style.width = `${(p.fraction * 100).toFixed(0)}%`;
  document.getElementById('loadlabel').textContent = p.label;
});

const game = { pipeline, camera, time: 0.3 };
window.__game = game;

async function init() {
  const [data, textures] = await Promise.all([
    progress.task('Shaping the island', 3, generateHeightmap),
    progress.task('Loading terrain materials', 3, loadTerrainTextures),
  ]);
  const terrain = new Terrain(data, textures);
  pipeline.scene.add(terrain.group);
  const grass = new Grass(terrain, textures.albedo, pipeline.quality.grass);
  pipeline.scene.add(grass.group);
  const veg = new Vegetation();
  await veg.load(progress);
  veg.scatter(terrain, data.spawn);
  pipeline.scene.add(veg.group);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2));
  water.frustumCulled = false;
  pipeline.setWater(water, terrain.heightTex, terrain.uniforms.uWorldSize.value);
  Object.assign(game, { terrain, grass, veg, data });

  const s = data.spawn;
  camera.position.set(s.x, terrain.heightAt(s.x, s.z) + 1.7, s.z);
  camera.lookAt(data.peak.x, data.peak.h * 0.5, data.peak.z);
  document.getElementById('loading').classList.add('hidden');
  const play = document.getElementById('play');
  play.classList.remove('hidden');
  play.onclick = () => canvas.requestPointerLock();
  document.addEventListener('pointerlockchange', () => {
    document.getElementById('menu').classList.toggle('hidden', document.pointerLockElement === canvas);
  });
  const keys = new Set();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  const euler = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(camera.quaternion);
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    const sens = Number(document.getElementById('sens').value) * 0.00025;
    euler.y -= e.movementX * sens;
    euler.x = Math.max(-1.5, Math.min(1.5, euler.x - e.movementY * sens));
    camera.quaternion.setFromEuler(euler);
  });
  document.getElementById('timeofday').oninput = (e) => { game.time = e.target.value / 1000; };
  document.getElementById('quality').onchange = (e) => pipeline.setQuality(e.target.value);
  document.getElementById('menu').classList.remove('loading');
  let last = performance.now();
  let elapsed = 0;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += dt;
    const speed = (keys.has('ShiftLeft') ? 40 : 8) * dt;
    const mv = new THREE.Vector3(
      (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0),
      (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0),
    ).applyQuaternion(camera.quaternion).multiplyScalar(speed);
    camera.position.add(mv);
    camera.position.y = Math.max(camera.position.y, terrain.heightAt(camera.position.x, camera.position.z) + 0.4);
    if (keys.has('KeyT')) game.time = (game.time + dt * 0.02) % 1;
    pipeline.setTimeOfDay(game.time, elapsed);
    terrain.update(elapsed);
    grass.update(elapsed, camera.position, null);
    veg.update(elapsed, camera.position);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    pipeline.render(camera, dt, {});
    requestAnimationFrame(loop);
  };
  loop();
  const dbg = document.getElementById('debug');
  dbg.classList.remove('hidden');
  document.getElementById('hud').classList.remove('hidden');
  dbg.textContent = JSON.stringify({ spawn: s, peak: data.peak, ms: data.ms, ...veg.stats }, null, 1);
}

init().catch((e) => {
  console.error(e);
  const el = document.getElementById('error');
  el.textContent = `Failed to start: ${e.message}`;
  el.classList.remove('hidden');
});
addEventListener('resize', () => pipeline.resize(innerWidth, innerHeight));
