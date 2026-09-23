import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { Progress } from './engine/assets.js';
import { generateHeightmap, loadTerrainTextures, Terrain } from './world/terrain.js';
import { Grass } from './world/grass.js';
import { Vegetation } from './world/vegetation.js';
import { Character } from './game/character.js';
import { Player } from './game/player.js';
import { Props } from './game/props.js';
import { Effects } from './game/fx.js';
import { Weapons } from './game/weapons.js';
import { Audio } from './game/audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const menu = $('menu');
menu.classList.add('loading');

function fail(e) {
  console.error(e);
  const el = $('error');
  el.textContent = `Failed to start: ${e?.message || e}\n\nMake sure the assets were downloaded (npm run dev does this automatically).`;
  el.classList.remove('hidden');
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required.');
  renderer.info.autoReset = false;
} catch (e) {
  fail(e);
  throw e;
}

const savedQuality = localStorage.getItem('relic-quality') || 'high';
$('quality').value = savedQuality;
const pipeline = new Pipeline(renderer);
pipeline.setQuality(savedQuality);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.08, 5000);
const audio = new Audio();

const progress = new Progress((p) => {
  $('loadbar').style.width = `${(p.fraction * 100).toFixed(0)}%`;
  $('loadlabel').textContent = p.label;
});

const world = {};
const surfaceAt = (x, z, y) => {
  if (y !== undefined && y < 0.02 && world.terrain.heightAt(x, z) < 0) return 'water';
  const b = world.terrain.biomeAt(x, z);
  const best = Object.entries(b).sort((a, c) => c[1] - a[1])[0][0];
  return best;
};

// Closest hit among terrain, water, trees and rocks, and props.
world.raycast = (o, d, maxDist) => {
  let best = null;
  const tt = world.terrain.raycast(o, d, maxDist);
  if (tt !== null) {
    const p = o.clone().addScaledVector(d, tt);
    best = { t: tt, normal: world.terrain.normalAt(p.x, p.z), surface: surfaceAt(p.x, p.z) };
  }
  if (o.y > 0 && d.y < 0) {
    const tw = -o.y / d.y;
    if (tw < (best ? best.t : maxDist)) best = { t: tw, normal: new THREE.Vector3(0, 1, 0), surface: 'water' };
  }
  const c = world.veg.colliders.raycast(o, d, best ? best.t : maxDist);
  if (c && (!best || c.t < best.t)) best = { t: c.t, normal: c.normal, surface: c.collider.type };
  const pr = world.props.raycast(o, d, best ? best.t : maxDist);
  if (pr && (!best || pr.t < best.t)) best = pr;
  return best;
};

const input = { forward: false, back: false, left: false, right: false, sprint: false, jump: false, aim: false, fire: false, toggleWalk: false, fastTime: false };
const keymap = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyT: 'fastTime' };
addEventListener('keydown', (e) => {
  if (keymap[e.code]) input[keymap[e.code]] = true;
  if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
  if (e.code === 'KeyC' && !e.repeat) input.toggleWalk = true;
  if (e.code === 'F3') { $('debug').classList.toggle('hidden'); e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  if (keymap[e.code]) input[keymap[e.code]] = false;
});
canvas.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) input.fire = true;
  if (e.button === 2) input.aim = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) input.aim = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('blur', () => { for (const k in input) input[k] = false; });

let timeOfDay = 0.09;
$('timeofday').value = Math.round(timeOfDay * 1000);
$('timeofday').oninput = (e) => { timeOfDay = e.target.value / 1000; };
$('quality').onchange = (e) => {
  pipeline.setQuality(e.target.value);
  localStorage.setItem('relic-quality', e.target.value);
  if (world.veg) { world.veg.scale = pipeline.quality.trees; world.veg.update(0, camera.position, true); }
};
$('volume').oninput = (e) => audio.setVolume(e.target.value / 100);
audio.setVolume($('volume').value / 100);

async function init() {
  const [data, textures] = await Promise.all([
    progress.task('Shaping the island', 3, generateHeightmap),
    progress.task('Loading terrain materials', 3, loadTerrainTextures),
  ]);
  const terrain = new Terrain(data, textures);
  world.terrain = terrain;
  pipeline.scene.add(terrain.group);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2));
  water.frustumCulled = false;
  pipeline.setWater(water, terrain.heightTex, terrain.uniforms.uWorldSize.value);

  const grass = new Grass(terrain, textures.albedo, pipeline.quality.grass);
  pipeline.scene.add(grass.group);

  const veg = new Vegetation();
  const character = new Character();
  const props = new Props(terrain, veg.colliders);
  world.veg = veg;
  world.props = props;
  await Promise.all([veg.load(progress), character.load(progress), props.load(progress)]);

  const spawn = data.spawn;
  const facing = Math.atan2(data.peak.x - spawn.x, data.peak.z - spawn.z);
  await progress.task('Planting the forest', 1, async () => veg.scatter(terrain, spawn));
  veg.scale = pipeline.quality.trees;
  pipeline.scene.add(veg.group);
  props.place(spawn, facing);
  pipeline.scene.add(props.group);
  character.addTo(pipeline.scene);

  const player = new Player(world, character, camera);
  player.spawn(spawn.x, spawn.z, facing);
  const fx = new Effects(pipeline, terrain, audio);
  const weapons = new Weapons(world, player, character, fx, audio);
  Object.assign(world, { grass, character, player, fx, weapons, data });
  window.__game = { world, pipeline, camera, input };

  character.onFootstep = (i, speed) => {
    const p = player.pos;
    audio.footstep(p.y < 0.05 ? 'water' : surfaceAt(p.x, p.z), speed);
    if (p.y < 0.05) fx.impact(p.clone().setY(0.02), new THREE.Vector3(0, 1, 0), 'water', new THREE.Vector3(0, -1, 0));
  };
  player.onLand = (v) => audio.land(v);

  let hitTimer = 0;
  weapons.onHit = (scored) => {
    hitTimer = 0.25;
    $('hitmarker').classList.add('show');
    if (scored) $('targets').textContent = props.hits;
  };

  await progress.task('Compiling shaders', 1, async () => {
    veg.update(0, player.pos, true);
    grass.update(0, player.pos, player.pos);
    pipeline.setTimeOfDay(timeOfDay, 0);
    player.update(0.016, input);
    renderer.compile(pipeline.scene, camera);
    pipeline.render(camera, 0.016, {});
  });

  $('loading').classList.add('hidden');
  $('play').classList.remove('hidden');
  menu.classList.remove('loading');
  $('play').onclick = () => {
    audio.start();
    canvas.requestPointerLock();
  };
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas && menu.classList.contains('hidden')) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    menu.classList.toggle('hidden', locked);
    $('hud').classList.toggle('hidden', !locked);
    if (!locked) for (const k in input) input[k] = false;
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    const sens = Number($('sens').value) * 0.00022 * (player.camDist < 2 ? 0.7 : 1);
    player.look(e.movementX * sens, e.movementY * sens);
  });

  let last = performance.now();
  let elapsed = 0;
  let fpsT = 0, frames = 0, fps = 0;
  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;
    if (input.fastTime) {
      timeOfDay = (timeOfDay + dt * 0.03) % 1;
      $('timeofday').value = Math.round(timeOfDay * 1000);
    }
    pipeline.setTimeOfDay(timeOfDay, elapsed);

    const state = player.update(dt, input);
    input.jump = false;
    input.toggleWalk = false;
    weapons.update(dt, input.fire);
    props.update(dt);
    fx.update(dt);
    terrain.update(elapsed);
    grass.update(elapsed, camera.position, player.pos);
    veg.update(elapsed, camera.position);
    const coast = THREE.MathUtils.clamp(1 - (terrain.heightAt(player.pos.x, player.pos.z) - 1) / 25, 0, 1);
    audio.updateAmbience(dt, { altitude: player.pos.y, coast, underwater: player.underwater });

    $('crosshair').classList.toggle('idle', !state.aiming);
    if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) $('hitmarker').classList.remove('show'); }

    renderer.info.reset();
    pipeline.render(camera, dt, { underwater: player.underwater, shadowCenter: player.pos });

    frames++;
    fpsT += dt;
    if (fpsT > 0.5) {
      fps = frames / fpsT;
      frames = 0;
      fpsT = 0;
      if (!$('debug').classList.contains('hidden')) {
        const info = renderer.info.render;
        $('debug').textContent = [
          `${fps.toFixed(0)} fps · ${pipeline.qualityName}`,
          `pos ${player.pos.x.toFixed(1)} ${player.pos.y.toFixed(1)} ${player.pos.z.toFixed(1)}`,
          `speed ${state.speed.toFixed(2)} m/s · ${player.onGround ? 'ground' : 'air'}`,
          `draw calls ${info.calls} · tris ${(info.triangles / 1e6).toFixed(2)}M`,
          `trees ${veg.stats.trees} · rocks ${veg.stats.rocks} · ferns ${veg.stats.ferns}`,
        ].join('\n');
      }
    }
  };
  loop();
}

init().catch(fail);

addEventListener('resize', () => {
  pipeline.resize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
camera.aspect = innerWidth / innerHeight;
camera.updateProjectionMatrix();
