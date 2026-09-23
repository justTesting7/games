import * as THREE from 'three';
import { B, BLOCKS, TEX_NAMES, SEA_LEVEL } from './blocks.js';
import { createTextures } from './textures.js';
import { Pipeline } from './pipeline.js';
import { World, raycast } from './world.js';
import { Player } from './player.js';
import { createTerrain, BIOME } from './terrain.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
} catch (e) {
  $('error').textContent = 'WebGL 2 is required to run VoxelCraft.';
  $('error').classList.remove('hidden');
  throw e;
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const textures = createTextures(renderer);
const pipeline = new Pipeline(renderer, textures);

const seed = Number(params.get('seed')) || 1337;
const terrain = createTerrain(seed);
let world = new World(pipeline, seed, Number(params.get('rd')) || 8);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 1200);
const player = new Player(camera);

// ---------------------------------------------------------------- settings
const settings = {
  quality: params.get('quality') || 'high',
  renderDist: world.radius,
  sensitivity: 0.0022,
  time: params.has('t') ? Number(params.get('t')) : 0.08,
};
$('quality').value = settings.quality;
$('renderdist').value = settings.renderDist;
$('rdval').textContent = settings.renderDist;
$('timeofday').value = Math.round(settings.time * 1000);
pipeline.setQuality(settings.quality);

function applyRenderDistance() {
  world.radius = settings.renderDist;
  world.lastCenter = null;
  const end = settings.renderDist * 16 - 6;
  pipeline.u.uFogEnd.value = end;
  pipeline.u.uFogStart.value = end * 0.5;
  pipeline.u.uFogDensity.value = 0.25 / end;
  camera.far = Math.max(400, end * 3);
  camera.updateProjectionMatrix();
}
applyRenderDistance();

$('quality').addEventListener('change', (e) => { settings.quality = e.target.value; pipeline.setQuality(settings.quality); });
$('renderdist').addEventListener('input', (e) => {
  settings.renderDist = Number(e.target.value);
  $('rdval').textContent = settings.renderDist;
  applyRenderDistance();
});
$('timeofday').addEventListener('input', (e) => { settings.time = Number(e.target.value) / 1000; });
$('sens').addEventListener('input', (e) => { settings.sensitivity = Number(e.target.value) * 0.000275; });

// ---------------------------------------------------------------- hotbar
const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.GLASS, B.BRICKS, B.GLOWSTONE];
let selected = 0;

function drawIcon(id) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 48;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const b = BLOCKS[id];
  const tex = (layer) => textures.canvases[TEX_NAMES[layer]];
  if (b.cross) {
    ctx.drawImage(tex(b.side), 4, 4, 40, 40);
    return cv;
  }
  const k = 22 / 16;
  const face = (img, m, shadeAmt) => {
    ctx.setTransform(...m);
    ctx.drawImage(img, 0, 0);
    if (shadeAmt > 0) {
      ctx.fillStyle = `rgba(0,0,0,${shadeAmt})`;
      ctx.fillRect(0, 0, 16, 16);
    }
  };
  face(tex(b.top), [k, k / 2, -k, k / 2, 24, 2], 0);
  face(tex(b.side), [k, k / 2, 0, 1.5, 2, 13], 0.22);
  face(tex(b.side), [k, -k / 2, 0, 1.5, 24, 24], 0.42);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}

function renderHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  HOTBAR.forEach((id, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === selected ? ' active' : '');
    slot.appendChild(drawIcon(id));
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i + 1;
    slot.appendChild(num);
    bar.appendChild(slot);
  });
}
let nameTimer = 0;
function select(i) {
  selected = (i + HOTBAR.length) % HOTBAR.length;
  renderHotbar();
  const el = $('blockname');
  el.textContent = BLOCKS[HOTBAR[selected]].name;
  el.style.opacity = 1;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => { el.style.opacity = 0; }, 1500);
}
renderHotbar();

// ---------------------------------------------------------------- input
const input = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, descend: false, fastTime: false };
let locked = false;
let showDebug = true;
let hudHidden = false;

const keymap = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyT: 'fastTime' };

document.addEventListener('keydown', (e) => {
  if (!locked) return;
  if (keymap[e.code]) {
    if (e.code === 'Space' && !e.repeat) {
      const now = performance.now();
      if (now - player.lastSpace < 300) { player.flying = !player.flying; player.vel.y = 0; }
      player.lastSpace = now;
    }
    input[keymap[e.code]] = true;
    e.preventDefault();
  }
  if (e.code === 'KeyF') { player.flying = !player.flying; player.vel.y = 0; }
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= 9) select(n - 1);
  }
  if (e.code === 'F3') { showDebug = !showDebug; $('debug').classList.toggle('hidden', !showDebug); e.preventDefault(); }
  if (e.code === 'F1') { hudHidden = !hudHidden; $('hud').style.opacity = hudHidden ? 0 : 1; e.preventDefault(); }
});
document.addEventListener('keyup', (e) => {
  if (keymap[e.code]) input[keymap[e.code]] = false;
});

let ready = false;
$('play').addEventListener('click', () => { if (ready) canvas.requestPointerLock(); });
canvas.addEventListener('click', () => { if (ready && !locked) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  $('menu').classList.toggle('hidden', locked);
  $('hud').classList.toggle('hidden', !locked && !params.has('hud'));
  if (!locked) for (const k in input) input[k] = false;
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  player.look(e.movementX, e.movementY, settings.sensitivity);
});

let target = null;
let breakCooldown = 0;
let placeCooldown = 0;
const mouse = { left: false, right: false };
document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) { mouse.left = true; breakCooldown = 0; }
  if (e.button === 2) { mouse.right = true; placeCooldown = 0; }
  if (e.button === 1 && target) {
    const id = target.id;
    const idx = HOTBAR.indexOf(id);
    if (idx >= 0) select(idx); else { HOTBAR[selected] = id; select(selected); }
    e.preventDefault();
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  if (!locked) return;
  select(selected + Math.sign(e.deltaY));
}, { passive: true });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  pipeline.resize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- block editing
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  pipeline.outlineMaterial,
);
outline.visible = false;
pipeline.overlayScene.add(outline);

function breakBlock() {
  if (!target || !BLOCKS[target.id].breakable) return;
  const { x, y, z } = target;
  world.setBlock(x, y, z, adjacentWater(x, y, z) ? B.WATER : B.AIR);
  const above = world.getBlock(x, y + 1, z);
  if (above > 0 && BLOCKS[above].cross) world.setBlock(x, y + 1, z, B.AIR);
}

function adjacentWater(x, y, z) {
  const n = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
  return n.some(([dx, dy, dz]) => world.getBlock(x + dx, y + dy, z + dz) === B.WATER) && y <= SEA_LEVEL;
}

function placeBlock() {
  if (!target) return;
  let { x, y, z } = target;
  const tb = BLOCKS[target.id];
  if (!tb.cross) { x += target.nx; y += target.ny; z += target.nz; }
  const cur = world.getBlock(x, y, z);
  if (cur < 0) return;
  if (cur !== B.AIR && !BLOCKS[cur].liquid && !BLOCKS[cur].cross) return;
  const id = HOTBAR[selected];
  if (BLOCKS[id].solid && player.intersectsBlock(x, y, z)) return;
  world.setBlock(x, y, z, id);
}

// ---------------------------------------------------------------- spawn
function findSpawn() {
  for (let r = 0; r < 2000; r += 8) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      const c = terrain.column(x, z);
      if (c.h > SEA_LEVEL + 2 && (c.biome === BIOME.PLAINS || c.biome === BIOME.FOREST)) return { x: x + 0.5, z: z + 0.5, h: c.h };
    }
  }
  return { x: 0.5, z: 0.5, h: 80 };
}
const spawn = findSpawn();
player.pos.set(
  params.has('x') ? Number(params.get('x')) : spawn.x,
  spawn.h + 1.01,
  params.has('z') ? Number(params.get('z')) : spawn.z,
);
if (params.has('yaw')) player.yaw = Number(params.get('yaw'));
if (params.has('pitch')) player.pitch = Number(params.get('pitch'));
let spawned = false;

function trySpawn() {
  const x = Math.floor(player.pos.x), z = Math.floor(player.pos.z);
  if (world.getBlock(x, 0, z) < 0) return false;
  let y = 126;
  while (y > 0 && !BLOCKS[world.getBlock(x, y, z)].solid) y--;
  player.pos.y = y + 1.01 + (params.has('y') ? Number(params.get('y')) : 0);
  if (params.has('y')) player.flying = true;
  return true;
}

// ---------------------------------------------------------------- loop
let lastNow = performance.now();
let elapsed = 0;
let fpsAcc = 0, fpsFrames = 0, fps = 0;
const DAY_LENGTH = 1200;
const tmpDir = new THREE.Vector3();

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 0.1);
  lastNow = now;
  elapsed += dt;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }

  world.update(player.pos.x, player.pos.z);

  if (!spawned) {
    spawned = trySpawn();
    if (spawned) {
      ready = true;
      $('play').disabled = false;
      $('play').textContent = 'Click to Play';
    }
  }

  if (spawned && (locked || params.has('walk'))) {
    player.update(dt, locked ? input : {}, world);
  } else {
    player.update(0, {}, world);
  }

  if (!params.has('freeze')) settings.time = (settings.time + dt * (input.fastTime ? 60 : 1) / DAY_LENGTH) % 1;
  if (!locked) $('timeofday').value = Math.round(settings.time * 1000);
  pipeline.setTimeOfDay(settings.time, elapsed);

  // Targeting & editing
  camera.getWorldDirection(tmpDir);
  target = spawned ? raycast(world, camera.position, tmpDir, 6) : null;
  if (target) {
    outline.visible = true;
    const b = BLOCKS[target.id];
    if (b.cross) { outline.scale.set(0.7, 1, 0.7); } else outline.scale.set(1, 1, 1);
    outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    outline.updateMatrixWorld();
  } else outline.visible = false;

  breakCooldown -= dt; placeCooldown -= dt;
  if (locked && mouse.left && breakCooldown <= 0) { breakBlock(); breakCooldown = 0.25; }
  if (locked && mouse.right && placeCooldown <= 0) { placeBlock(); placeCooldown = 0.25; }

  const handTarget = HOTBAR[selected] === B.GLOWSTONE ? 1 : 0;
  const hl = pipeline.blockMaterial.uniforms.uHandLight;
  hl.value += (handTarget - hl.value) * (1 - Math.exp(-dt * 10));

  const underwater = player.headInWater;
  $('underwater').style.opacity = underwater ? 1 : 0;
  pipeline.render(camera, dt, { underwater });

  if (showDebug) {
    const hours = Math.floor(((settings.time * 24 + 6) % 24));
    const mins = Math.floor((settings.time * 24 * 60) % 60);
    const c = terrain.column(Math.floor(player.pos.x), Math.floor(player.pos.z));
    const biome = Object.keys(BIOME).find((k) => BIOME[k] === c.biome);
    $('debug').textContent =
      `VoxelCraft  ${fps} fps  [${pipeline.quality.label}]\n` +
      `XYZ ${player.pos.x.toFixed(1)} ${player.pos.y.toFixed(1)} ${player.pos.z.toFixed(1)}\n` +
      `Biome ${biome.toLowerCase()}  Time ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}\n` +
      `Chunks ${world.chunks.size} (${world.loadingCount} loading)${player.flying ? '  Flying' : ''}`;
  }
}

if (params.has('hud')) $('hud').classList.remove('hidden');
if (params.has('nomenu')) $('menu').classList.add('hidden');
window.__game = { player, world, pipeline, camera, settings, renderer };
loop();
