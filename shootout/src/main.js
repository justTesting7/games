import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { startClock } from './engine/clock.js';
import { Progress, loadImage } from './engine/assets.js';
import { generateHeightmap, loadTerrainTextures, Terrain } from './world/terrain.js';
import { Grass } from './world/grass.js';
import { Vegetation } from './world/vegetation.js';
import { getMap } from './world/maps.js';
import { urbanRivalSpots } from './world/cityLayout.js';
import { City } from './world/city.js';
import { Arena } from './world/arena.js';
import { arenaHeightAt, standSpawn } from './world/arenaLayout.js';
import { studioRivalSpots, blockedAt } from './world/glbMap.js';
import { loadDizengoff } from './world/dizengoff.js';
import { buildLab, LAB } from './world/lab.js';
import { NightLights } from './world/nightLights.js';
import { Weather } from './world/weather.js';
import { setSea, hasSea } from './game/swim.js';
import { Fish } from './world/fish.js';
import { Character } from './game/character.js';
import { Player } from './game/player.js';
import { Props } from './game/props.js';
import { Effects } from './game/fx.js';
import { Weapons, Loadout, WEAPONS } from './game/weapons.js';
import { Audio } from './game/audio.js';
import { Combat, MAX_HEALTH } from './game/combat.js';
import { Rival } from './game/rival.js';
import { byId, loadSelection, persona, resolveLooks } from './game/roster.js';
import { setupRosterMenu } from './game/rosterMenu.js';
import { createRosterAvatarStudio } from './game/rosterAvatarStudio.js';
import { Jev } from './game/jev.js';
import { Net } from './game/net.js';
import { Session } from './game/session.js';
import { modeUrl, persistMode, persistRoom, resolveMode, resolveRoom } from './game/mode.js';
import { isTouchDevice, setupTouch } from './game/touch.js';
import { DRONE } from './game/drone.js';
import { Cars, localOffset, sizeOf, carOverlap, resolveCarBox } from './game/cars.js';
import { CarLights } from './game/carLights.js';
import { createGameRenderer } from './engine/webgl.js';
import { RADAR_RANGE, radarBlips, radarSubjects, drawRadar } from './game/radar.js';

const $ = (id) => document.getElementById(id);
const menu = $('menu');
menu.classList.add('loading');

function fail(e) {
  console.error(e);
  const el = $('error');
  const msg = e?.message || String(e);
  const hint = /WebGL/i.test(msg)
    ? 'Close other 3D tabs, then reload. Some phones only allow one WebGL game at a time.'
    : 'Make sure the assets were downloaded (npm run dev does this automatically).';
  el.textContent = `Failed to start: ${msg}\n\n${hint}`;
  el.classList.remove('hidden');
}

let renderer;
let canvas;
try {
  ({ renderer, canvas } = createGameRenderer($('game')));
  canvas.addEventListener('webglcontextrestored', () => {
    try { pipeline.setQuality(pipeline.qualityName || 'low'); } catch { /* retry on next frame */ }
  });
} catch (e) {
  fail(e);
  throw e;
}

const savedQuality = localStorage.getItem('relic-quality') || (isTouchDevice() ? 'low' : 'medium');
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
  if (hasSea() && y !== undefined && y < 0.02 && world.terrain.heightAt(x, z) < 0) return 'water';
  const b = world.terrain.biomeAt(x, z);
  const best = Object.entries(b).sort((a, c) => c[1] - a[1])[0][0];
  return best;
};

// Closest hit among terrain, water, trees and rocks, props and fighters
// other than `ignore`.
world.raycast = (o, d, maxDist, ignore) => {
  let best = null;
  const tt = world.terrain.raycast(o, d, maxDist);
  if (tt !== null) {
    const p = o.clone().addScaledVector(d, tt);
    best = { t: tt, normal: world.terrain.normalAt(p.x, p.z), surface: surfaceAt(p.x, p.z) };
  }
  if (hasSea() && o.y > 0 && d.y < 0) {
    const tw = -o.y / d.y;
    if (tw < (best ? best.t : maxDist)) best = { t: tw, normal: new THREE.Vector3(0, 1, 0), surface: 'water' };
  }
  const sh = world.shots?.raycast(o, d, best ? best.t : maxDist);
  if (sh) best = sh;
  const c = world.veg.colliders.raycast(o, d, best ? best.t : maxDist);
  if (c && (!best || c.t < best.t)) best = { t: c.t, normal: c.normal, surface: c.surface || c.collider.type, collider: c.collider };
  const pr = world.props.raycast(o, d, best ? best.t : maxDist);
  if (pr && (!best || pr.t < best.t)) best = pr;
  const checkDrone = (drone) => {
    const hit = drone?.raycast(o, d, best ? best.t : maxDist);
    if (hit && (!best || hit.t < best.t)) best = hit;
  };
  checkDrone(world.drone);
  if (world.netDrones) for (const drone of world.netDrones.values()) checkDrone(drone);
  const carHit = world.cars?.raycast(o, d, best ? best.t : maxDist, ignore);
  if (carHit && (!best || carHit.t < best.t)) best = carHit;
  const fh = world.combat.raycast(o, d, best ? best.t : maxDist, ignore);
  if (fh) best = fh;
  return best;
};
const combat = new Combat();
world.combat = combat;
// Ragdolls fall onto the ground and are kept out of walls.
Character.physics = {
  heightAt: (x, z) => world.terrain.heightAt(x, z),
  // the cars within reach of a body this step
  near: (p) => (world.cars?.list || []).filter((c) => Math.abs(c.x - p.x) < 6 && Math.abs(c.z - p.z) < 6 && Math.abs(c.y - p.y) < 3),
  resolve: (p, r, cars) => {
    world.veg?.colliders.resolveXZ(p, r, p.y - r, p.y + r);
    // a body thrown onto a car lies on its roof or bonnet; one against its side slides off
    for (const car of cars || []) {
      const { along } = localOffset(p.x, p.z, car);
      const top = car.spec ? 0.8 : Math.abs(along) < sizeOf(car).halfL * 0.35 ? 1.4 : 0.95;
      const h = p.y - car.y;
      if (h > top + r || h < -r || !carOverlap(p.x, p.z, car.y, car, r)) continue;
      if (h > top - 0.35) p.y = car.y + top + r;
      else resolveCarBox(p, r, car);
    }
  },
};
// Static geometry only (walls, props, parked cars): keeps gun barrels out of walls.
Character.wallProbe = (o, d, len) => {
  let t = world.shots?.raycast(o, d, len)?.t ?? null;
  const c = world.veg?.colliders.raycast(o, d, t ?? len);
  if (c) t = c.t;
  const car = world.cars?.raycast(o, d, t ?? len, null);
  if (car) t = car.t;
  return t;
};
// /shootout/?lab opens the debug range and starts playing without the menu;
// ?play=<map id> does the same for any map. &calm keeps the rivals still as targets.
const bootQuery = new URLSearchParams(location.search);
const bootMap = bootQuery.has('lab') ? 'lab' : bootQuery.get('play');
const labBoot = !!bootMap;
const labCalm = labBoot && bootQuery.has('calm');
const mode = labBoot ? 'solo' : resolveMode();
const roomCode = resolveRoom();
persistMode(mode);
const jev = new Jev();
const net = new Net({ wanted: mode === 'multi', room: roomCode });
net.watchFocus();
let session = null;

const NO_INPUT = { forward: false, back: false, left: false, right: false, sprint: false, jump: false, aim: false, fire: false, toggleWalk: false, crouch: false, moveX: 0, moveY: 0, interact: false };
const input = { forward: false, back: false, left: false, right: false, sprint: false, jump: false, climb: false, aim: false, fire: false, toggleWalk: false, crouch: false, fastTime: false, moveX: 0, moveY: 0, interact: false };
let inPlay = false;
const keymap = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'sprint', ShiftRight: 'sprint', ControlLeft: 'crouch', ControlRight: 'crouch', KeyT: 'fastTime' };
addEventListener('keydown', (e) => {
  if (keymap[e.code]) input[keymap[e.code]] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    if (inPlay || document.pointerLockElement === canvas) {
      input.fire = true;
      if (!e.repeat) input.firePressed = true;
    }
  }
  if (e.code === 'KeyF') { input.climb = true; if (!e.repeat) input.jump = true; }
  if (e.code === 'KeyC' && !e.repeat) input.toggleCrouch = true;
  if (e.code === 'KeyV' && !e.repeat) input.toggleWalk = true;
  if (e.code === 'KeyE' && !e.repeat) input.interact = true;
  if (e.code === 'KeyR' && !e.repeat) input.reload = true;
  if (e.code === 'Enter' && !e.repeat) input.restart = true;
  if (/^Digit[1-4]$/.test(e.code)) input.slot = Number(e.code.slice(5));
  if (e.code === 'KeyQ' && !e.repeat) input.cycle = 1;
  if (e.code === 'F3') { $('debug').classList.toggle('hidden'); e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  if (keymap[e.code]) input[keymap[e.code]] = false;
  if (e.code === 'Space') { input.fire = false; input.fireReleased = true; }
  if (e.code === 'KeyF') { input.jump = false; input.climb = false; }
});
canvas.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 2) input.aim = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) input.aim = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (document.pointerLockElement !== canvas || Math.abs(e.deltaY) < 1) return;
  input.cycle = e.deltaY > 0 ? 1 : -1;
}, { passive: true });
addEventListener('blur', () => { for (const k in input) input[k] = false; });

const mapId = bootMap || localStorage.getItem('relic-map') || 'island';
const mapDef = getMap(mapId);
setSea(!mapDef.cityFolder && !mapDef.lab);
$('map').value = mapId;
$('maptitle').textContent = mapDef.label;
$('mapsub').textContent = mapDef.subtitle;
$('map').onchange = (e) => {
  localStorage.setItem('relic-map', e.target.value);
  if (mode === 'multi' && net.status === 'online') {
    net.send({ t: 'settings', map: e.target.value, time: timeOfDay, min: Number($('minplayers').value) });
  }
  location.reload();
};

const paintMode = () => {
  $('mode-solo').classList.toggle('on', mode === 'solo');
  $('mode-multi').classList.toggle('on', mode === 'multi');
  $('roomrow').classList.toggle('hidden', mode !== 'multi');
  $('minrow').classList.toggle('hidden', mode !== 'multi');
  $('jevstat').classList.toggle('hidden', mode === 'multi');
  $('netstat').classList.toggle('hidden', mode !== 'multi');
  const hosted = net.hosted;
  if (mode === 'multi') {
    if (!hosted) $('modehint').textContent = 'Multiplayer needs the hosted game or npm run cf:dev.';
    else if (session && !session.isHost) $('modehint').textContent = `Host chose ${mapDef.label}. Pick a fighter and join.`;
    else if (mapDef.fixedTime) $('modehint').textContent = 'You are the host. Map and min players apply to everyone who joins.';
    else $('modehint').textContent = 'You are the host. Map, time, and min players apply to everyone who joins.';
  } else {
    $('modehint').textContent = 'You against Jev-driven rivals. Last one standing wins.';
  }
  const play = $('play');
  if (!rosterMenu) return;
  if (mode === 'solo' && rosterMenu.changed()) play.textContent = 'Apply & reload';
  else if (mode === 'multi' && !hosted) play.textContent = 'Needs host';
  else play.textContent = mode === 'multi' ? 'Join fight' : 'Fight';
};
let applyLocalFighter = async () => {};
const switchMode = (next) => {
  if (next === mode) return;
  persistMode(next);
  location.assign(modeUrl(next, $('roomcode')?.value || roomCode));
};
$('mode-solo').onclick = () => switchMode('solo');
$('mode-multi').onclick = () => switchMode('multi');
$('roomcode').value = roomCode;
$('roomcode').onchange = () => {
  const next = persistRoom($('roomcode').value);
  if (mode === 'multi') location.assign(modeUrl('multi', next));
};
$('roomcode').oninput = () => {
  const share = $('roomshare');
  const next = ($('roomcode').value || 'lobby').trim() || 'lobby';
  const url = modeUrl('multi', next);
  share.textContent = `Share ${url.origin}${url.search || '?mode=multi'}`;
};

let timeOfDay = mapDef.timeOfDay;
$('timeofday').value = Math.round(timeOfDay * 1000);
$('todrow').classList.toggle('hidden', !!mapDef.fixedTime);
let timeSend = 0;
$('timeofday').oninput = (e) => {
  timeOfDay = e.target.value / 1000;
  if (mode !== 'multi' || !session?.isHost || net.status !== 'online') return;
  clearTimeout(timeSend);
  timeSend = setTimeout(() => {
    net.send({ t: 'settings', time: timeOfDay, min: Number($('minplayers').value) });
  }, 250);
};

const minPlayers = () => Math.max(2, Math.min(12, Number($('minplayers').value) || 2));
$('minplayers').value = localStorage.getItem('relic-min-players') || '2';
$('minplayers').onchange = () => {
  const n = minPlayers();
  localStorage.setItem('relic-min-players', String(n));
  if (session) session.minPlayers = n;
  if (mode === 'multi' && session?.isHost && net.status === 'online') {
    net.send({ t: 'settings', map: mapDef.id, time: timeOfDay, min: n });
  }
};

const applyHostUi = (host) => {
  const lock = mode === 'multi' && host === false;
  $('map').disabled = lock;
  $('timeofday').disabled = lock || !!mapDef.fixedTime;
  $('minplayers').disabled = lock;
  $('map').parentElement?.classList.toggle('locked', lock);
  $('timeofday').parentElement?.classList.toggle('locked', lock);
  $('todrow').classList.toggle('hidden', !!mapDef.fixedTime);
  $('minrow').classList.toggle('locked', lock);
  paintMode();
};
$('quality').onchange = (e) => {
  pipeline.setQuality(e.target.value);
  localStorage.setItem('relic-quality', e.target.value);
  if (world.veg && world.mapDef?.vegetation) { world.veg.scale = pipeline.quality.trees; world.veg.update(0, camera.position, true); }
};
const selection = loadSelection();
const rosterMenu = setupRosterMenu(selection, $('roster'), () => {
  paintMode();
  if (mode === 'multi') applyLocalFighter();
}, { opponents: mode === 'solo' });
paintMode();
$('roomcode').dispatchEvent(new Event('input'));
const rosterStudio = createRosterAvatarStudio({ webgl: !isTouchDevice() });

$('volume').oninput = (e) => audio.setVolume(e.target.value / 100);
audio.setVolume($('volume').value / 100);

async function init() {
  if (mode === 'multi' && net.hosted) {
    try {
      const info = await fetch(`/ws?room=${encodeURIComponent(roomCode)}`).then((r) => r.json());
      if (info.settings?.map && info.settings.map !== mapDef.id) {
        localStorage.setItem('relic-map', info.settings.map);
        location.reload();
        return;
      }
      if (Number.isFinite(info.settings?.time) && !mapDef.fixedTime) {
        timeOfDay = info.settings.time;
        $('timeofday').value = Math.round(timeOfDay * 1000);
      }
      if (Number.isFinite(+info.settings?.min)) {
        $('minplayers').value = String(Math.max(2, Math.min(12, Math.round(+info.settings.min))));
      }
    } catch { /* empty room or offline */ }
  }
  pipeline.fogMaterial.uniforms.uFogDensity.value = mapDef.fogDensity;
  const [data, textures] = await Promise.all([
    progress.task(mapDef.loadLabel, 3, () => generateHeightmap(mapDef.id)),
    progress.task('Loading terrain materials', 3, () => loadTerrainTextures(mapDef)),
  ]);
  const garden = mapDef.id === 'garden';
  const studioMap = !!mapDef.cityFolder || !!mapDef.lab;
  const urban = mapDef.id === 'city' || mapDef.id === 'manhattan' || garden;
  pipeline.indoor = garden;
  let studioHeight = (x, z) => 0;
  const terrain = new Terrain(data, textures, {
    urban, arena: garden, heightFn: studioMap ? (x, z) => studioHeight(x, z) : garden ? arenaHeightAt : null,
  });
  world.terrain = terrain;
  pipeline.scene.add(terrain.group);

  if (!studioMap) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2));
    water.frustumCulled = false;
    pipeline.setWater(water, terrain.heightTex, terrain.uniforms.uWorldSize.value);
  }

  let grass = null;
  if (mapDef.grass) {
    grass = new Grass(terrain, textures.albedo, pipeline.quality.grass);
    pipeline.scene.add(grass.group);
  }

  const veg = new Vegetation();
  const character = new Character();
  const props = new Props(terrain, veg.colliders);
  world.veg = veg;
  world.props = props;
  let city = null;
  let arena = null;
  let fish = null;
  if (mapDef.id === 'city' || mapDef.id === 'manhattan') city = new City(terrain, veg.colliders, pipeline);
  if (garden) arena = new Arena(terrain, veg.colliders, pipeline);
  let studio = null;
  const fighters = mode === 'solo'
    ? [selection.player, ...selection.rivals].map(byId)
    : [byId(selection.player)];
  const bodies = [...new Set(['f', 'm', ...fighters.map((e) => e.look.body)])];
  const [, charAssets, looks] = await Promise.all([
    mapDef.vegetation ? veg.load(progress) : Promise.resolve(),
    Character.loadAssets(progress, bodies),
    resolveLooks(fighters),
    mapDef.waterCamp ? props.load(progress) : Promise.resolve(),
    city ? city.load(progress) : Promise.resolve(),
    arena ? arena.load(progress) : Promise.resolve(),
    studioMap ? progress.task(mapDef.plantLabel, 2, async () => {
      studio = mapDef.lab ? await buildLab()
        : await loadDizengoff(pipeline.renderer, mapDef.cityFolder, { stadiumStart: !!mapDef.stadiumStart });
      if (studio.cameraFar) { camera.far = studio.cameraFar; camera.updateProjectionMatrix(); }
      studioHeight = studio.heightAt;
      studio.addColliders(veg.colliders);
      pipeline.scene.add(studio.group);
      terrain.group.visible = false;
      pipeline.indoor = !studio.outdoor;
    }) : Promise.resolve(),
  ]);
  character.load(charAssets, looks[0]);
  character.lookId = fighters[0].id;

  const gardenSpot = garden ? standSpawn(0) : null;
  const spawn = studio ? { x: studio.spawn.x, z: studio.spawn.z }
    : gardenSpot ? { x: gardenSpot.x, z: gardenSpot.z } : data.spawn;
  const facing = studio ? (studio.spawn.yaw ?? Math.PI)
    : gardenSpot ? gardenSpot.yaw : Math.atan2(data.peak.x - spawn.x, data.peak.z - spawn.z);
  if (mapDef.vegetation) {
    await progress.task(mapDef.plantLabel, 1, async () => veg.scatter(terrain, spawn));
    veg.scale = pipeline.quality.trees;
    pipeline.scene.add(veg.group);
  }
  if (mapDef.waterCamp) {
    props.place(spawn, facing);
    pipeline.scene.add(props.group);
  }
  const cars = new Cars(world, pipeline.scene);
  const carLights = new CarLights();
  world.carLights = carLights;
  world.haze = pipeline.haze;
  world.cars = cars;
  if (city && data.layout) {
    city.build(data.layout);
    pipeline.scene.add(city.group);
    cars.spawnMap(mapDef.id);
  }
  if (studio?.takeCars) cars.spawnCustom(studio.takeCars());
  if (studio?.takeScooters) cars.addScooters(studio.takeScooters());
  if (studio?.buildShots) world.shots = studio.buildShots();
  if (studio?.chunk) studio.chunk();
  const weather = new Weather(pipeline.scene);
  world.weather = weather;
  weather.onThunder = (dist) => { if (!pipeline.indoor) audio.thunder(dist); };
  let weatherGoal = Weather.fromSaved() === 'rain' ? 1 : 0;
  $('weather').value = weatherGoal ? 'rain' : 'clear';
  $('weather').onchange = (e) => {
    try { localStorage.setItem('relic-weather', e.target.value); } catch { /* private window */ }
    weatherGoal = e.target.value === 'rain' ? 1 : 0;
  };
  const baseFog = pipeline.fogMaterial.uniforms.uFogDensity.value;
  const stepWeather = (dt) => {
    const before = weather.amount;
    weather.amount += Math.sign(weatherGoal - weather.amount) * Math.min(Math.abs(weatherGoal - weather.amount), dt / 4);
    pipeline.weather = weather.amount;
    pipeline.wet = weather.amount;
    pipeline.fogMaterial.uniforms.uFogDensity.value = baseFog * (1 + 2.2 * weather.amount);
    if (Math.abs(before - weather.amount) > 1e-4 || weather.wetMats === null) weather.wet(studio?.root || arena?.group || city?.group, weather.amount);
    weather.update(dt, camera, pipeline.lightColor, { fx, heightAt: (x, z) => terrain.heightAt(x, z), at: player.pos });
    pipeline.lightning = pipeline.indoor ? 0 : weather.lightning(dt);
    pipeline.lightningDir = weather.bolt?.dir || 0;
  };
  world.stepWeather = stepWeather;
  if (studio?.lamps?.length) world.nightLights = new NightLights(pipeline.scene, studio.lamps, (x, z) => terrain.heightAt(x, z));
  if (arena && data.layout) {
    arena.build(data.layout);
    pipeline.scene.add(arena.group);
  }
  if (mapDef.fish) {
    fish = new Fish(terrain);
    pipeline.scene.add(fish.group);
  }
  character.addTo(pipeline.scene);

  const player = new Player(world, character, camera);
  player.fighter = combat.add({ id: 'player', name: fighters[0].name, character, pos: player.pos, isPlayer: true, color: fighters[0].color });
  player.spawn(spawn.x, spawn.z, facing);
  const fx = new Effects(pipeline, terrain, audio);
  fx.haze = pipeline.haze;
  const weapons = new Weapons(world, player, character, fx, audio, combat);
  weapons.setGrenadeModel(charAssets.grenadeGltf);
  player.fighter.loadout = new Loadout(3);
  player.onScope = () => audio.mech('scope');
  Object.assign(world, { grass, character, player, fx, weapons, data, city, arena, studio, mapDef, cars, audio });

  const rivals = fighters.slice(1).map((entry, i) => {
    const ch = new Character();
    ch.load(charAssets, looks[i + 1]);
    ch.addTo(pipeline.scene);
    return new Rival(world, combat, weapons, jev, persona(entry), ch);
  });
  const you = byId(selection.player);
  session = new Session({
    net, world, combat, weapons, player, rivals, charAssets,
    scene: pipeline.scene, spawn, facing, mapId: mapDef.id, slotSpawn: studio?.slotSpawn,
    onRoster: () => rebuildTags(),
    onRound: (msg) => applyNetRound(msg),
    onSettings: (s) => {
      if (Number.isFinite(s?.time) && !mapDef.fixedTime) {
        timeOfDay = s.time;
        $('timeofday').value = Math.round(timeOfDay * 1000);
      }
      if (Number.isFinite(+s?.min)) {
        session.minPlayers = Math.max(2, Math.min(12, Math.round(+s.min)));
        $('minplayers').value = String(session.minPlayers);
      }
    },
    onHost: (host) => applyHostUi(host),
  });
  session.minPlayers = minPlayers();
  const lookCache = new Map(fighters.map((e, i) => [e.id, looks[i]]));
  const rosterChars = new Map([[fighters[0].id, character]]);
  fighters.slice(1).forEach((e, i) => rosterChars.set(e.id, rivals[i].character));
  const syncIdentity = (entry) => {
    if (mode !== 'multi') return;
    const identity = { name: entry.name, color: entry.color, roster: entry.id, time: timeOfDay, min: minPlayers() };
    if (net.identity) Object.assign(net.identity, identity);
    if (net.status === 'online') net.send({ t: 'hello', ...identity, map: mapDef.id });
    else if (session) session.connect(identity);
  };
  applyLocalFighter = async (id = rosterMenu.player()) => {
    const entry = byId(id);
    if (!entry) return;
    rosterMenu.save();
    if (character.lookId !== entry.id) {
      let look = lookCache.get(entry.id);
      if (!look) {
        [look] = await resolveLooks([entry]);
        lookCache.set(entry.id, look);
      }
      character.relight(charAssets, look);
      character.lookId = entry.id;
      character.setWeapon(player.fighter.loadout?.current || 'pistols');
      character.equipT = 1;
      for (const [rid, ch] of [...rosterChars]) {
        if (ch === character && rid !== entry.id) rosterChars.delete(rid);
      }
      rosterChars.set(entry.id, character);
    }
    player.fighter.name = entry.name;
    player.fighter.color = entry.color;
    syncIdentity(entry);
    paintMode();
  };
  const youNow = byId(rosterMenu.player()) || you;
  if (mode === 'multi') session.connect({ name: youNow.name, color: youNow.color, roster: youNow.id, time: timeOfDay, min: minPlayers() });
  if (mode === 'multi' && youNow.id !== character.lookId) await applyLocalFighter(youNow.id);
  window.__game = { world, pipeline, camera, input, rivals, combat, jev, net, session };

  rosterMenu.bindAvatars(
    rosterStudio,
    (id) => rosterChars.get(id),
    async (id) => {
      if (rosterChars.has(id)) return rosterChars.get(id);
      const entry = byId(id);
      let look = lookCache.get(id);
      if (!look) {
        [look] = await resolveLooks([entry]);
        lookCache.set(id, look);
      }
      const ch = new Character();
      ch.load(charAssets, look);
      rosterChars.set(id, ch);
      return ch;
    },
  );

  // Rivals appear 18-28 m away, ahead of the player on either side, on
  // open, dry, walkable ground. In the Garden each fighter starts on a
  // different 18th-row stand.
  const spawnRivals = () => {
    if (garden) {
      rivals.forEach((r, i) => {
        const s = standSpawn(i + 1);
        r.spawn(s.x, s.z, s.yaw);
      });
      return;
    }
    if (studio) {
      const spots = studio.rivalSpots?.(spawn, rivals.length)
        || studioRivalSpots(spawn, rivals.length, (x, z) => blockedAt(veg.colliders, x, z));
      rivals.forEach((r, i) => r.spawn(spots[i].x, spots[i].z, spots[i].yaw));
      if (mapDef.lab && rivals[0]) rivals[0].sitIn(cars.list[LAB.driverCar]);
      return;
    }
    if (mapDef.id === 'city' || mapDef.id === 'manhattan') {
      const taken = (world.cars?.list || []).map((c) => ({ x: c.x, z: c.z }));
      const spots = urbanRivalSpots(player.pos.x, player.pos.z, rivals.length, { taken });
      rivals.forEach((r, i) => r.spawn(spots[i].x, spots[i].z, spots[i].yaw));
      return;
    }
    const p = player.pos;
    const tmp = [];
    rivals.forEach((r, i) => {
      let at = null;
      for (let k = 0; k < 80 && !at; k++) {
        const spreadAll = k > 30 ? (Math.random() - 0.5) * Math.PI * 2 : 0;
        const ang = player.yaw + (i - (rivals.length - 1) / 2) * 0.55 + (Math.random() - 0.5) * 0.35 + spreadAll;
        const dist = 18 + Math.random() * 10;
        const x = p.x + Math.sin(ang) * dist, z = p.z + Math.cos(ang) * dist;
        const h = terrain.heightAt(x, z);
        if (!terrain.inBounds(x, z) || h < 0.6) continue;
        if (terrain.normalAt(x, z).y < 0.8) continue;
        if (veg.colliders.query(x, z, 1.2, tmp).length) continue;
        if (rivals.some((o, j) => j < i && Math.hypot(o.pos.x - x, o.pos.z - z) < 8)) continue;
        at = { x, z };
      }
      const ang = (i + 1) * 2.1;
      at ||= { x: p.x + Math.sin(ang) * (12 + i * 3), z: p.z + Math.cos(ang) * (12 + i * 3) };
      r.spawn(at.x, at.z, Math.atan2(p.x - at.x, p.z - at.z));
    });
  };
  spawnRivals();

  const round = { state: 'waiting', t: 0 };
  const banner = (title, sub, cls = '') => {
    $('banner').className = cls;
    $('bannertitle').textContent = title;
    $('bannersub').textContent = sub;
  };
  let spectate = null;
  const othersLive = () => {
    const list = mode === 'multi' ? [...session.remotes.values()] : rivals;
    return list.filter((r) => r.fighter?.alive);
  };
  const attachSpectate = (sub) => {
    if (!sub) { spectate = null; return null; }
    if (spectate !== sub) {
      spectate = sub;
      player.smoothPivot = undefined;
      player.smoothDist = undefined;
    }
    return spectate;
  };
  const refreshSpectate = () => {
    if (player.fighter.alive) { spectate = null; return null; }
    if (spectate?.fighter?.alive) return spectate;
    const live = othersLive();
    if (!live.length) { spectate = null; return null; }
    const from = spectate?.pos || player.pos;
    live.sort((a, b) => a.pos.distanceToSquared(from) - b.pos.distanceToSquared(from));
    return attachSpectate(live[0]);
  };

  const resetLocalKit = () => {
    spectate = null;
    combat.reset(player.fighter);
    player.fighter.loadout.reset();
    character.setWeapon('pistols');
    character.weapon = 'pistols';
    character.equipT = 1;
    weapons.live.forEach((g) => g.mesh.removeFromParent());
    weapons.live = [];
    weapons.queued = 0;
    weapons.sniperHeld = false;
    weapons.sniperWasScoped = false;
    player.sniperPending = false;
    weapons.drone.clear();
    fx.decals.clear();
    cars.reset();
  };

  const startRound = () => {
    resetLocalKit();
    $('feed').innerHTML = '';
    if (mode === 'multi') {
      session.placeLocal();
      session.ready();
      const need = session.minPlayers || minPlayers();
      const have = session.peerCount + 1;
      const wait = net.status === 'online'
        ? (have >= need
          ? `${have} in the room. Waiting for the fight to start.`
          : `${have} / ${need} players. Share the room link.`)
        : net.error === 'host'
          ? 'Open the hosted game or run npm run cf:dev to play multiplayer.'
          : 'Connecting to the room…';
      banner('Waiting', wait, 'show countdown');
      round.state = 'waiting';
      return;
    }
    if (garden) {
      const s = standSpawn(0);
      player.spawn(s.x, s.z, s.yaw);
      player.vel.set(0, 0, 0);
    } else if (studio) {
      player.spawn(spawn.x, spawn.z, facing);
      player.vel.set(0, 0, 0);
    } else if (!player.fighter.alive) {
      player.spawn(spawn.x, spawn.z, facing);
      player.vel.set(0, 0, 0);
    }
    spawnRivals();
    round.state = 'countdown';
    round.t = 3;
    round.ends = 0;
  };

  const applyNetRound = (msg) => {
    if (msg.state === 'countdown') {
      resetLocalKit();
      session.beginRound(msg);
      const slot = msg.slots?.[net.id] ?? session.slot;
      session.placeLocal(slot);
      round.state = 'countdown';
      round.ends = msg.ends || (Date.now() + 3000);
      round.t = Math.max(0, (round.ends - Date.now()) / 1000);
    } else if (msg.state === 'fight') {
      round.state = 'fight';
      banner('', '', '');
    } else if (msg.state === 'over') {
      round.state = 'over';
      round.rematchAt = msg.rematchAt || (Date.now() + 4000);
      const won = msg.winner === net.id;
      banner(
        won ? 'Victory' : 'Eliminated',
        won ? 'You outlasted the other players.' : 'The next round starts in a moment.',
        won ? 'show won' : 'show lost',
      );
    } else if (msg.state === 'waiting') {
      round.state = 'waiting';
    }
  };

  const feed = (html) => {
    const el = document.createElement('div');
    el.innerHTML = html;
    $('feed').prepend(el);
    setTimeout(() => el.classList.add('fade'), 6000);
    setTimeout(() => el.remove(), 7000);
    while ($('feed').children.length > 5) $('feed').lastChild.remove();
  };
  const tagName = (f) => `<b style="color:${f.color}">${f.name}</b>`;

  let hurt = 0;
  const dmgDir = $('dmgdir');
  let dmgFrom = null, dmgT = 0;
  // the arrow keeps pointing at whoever shot you while it fades, as you turn
  const aimDamage = () => {
    if (!dmgFrom) return;
    const a = Math.atan2(dmgFrom.x - player.pos.x, dmgFrom.z - player.pos.z);
    const rel = Math.atan2(Math.sin(a - player.camYaw), Math.cos(a - player.camYaw));
    dmgDir.style.transform = `rotate(${-rel}rad)`;
  };
  const pointDamage = (from) => {
    dmgFrom = from.pos.clone();
    dmgT = 1.1;
    aimDamage();
    dmgDir.classList.remove('show');
    void dmgDir.offsetWidth;
    dmgDir.classList.add('show');
  };
  combat.onDamage = (victim, attacker, amount, dir, info = {}) => {
    fx.decals.bleed(info.at || victim.pos, dir, amount);
    if (victim === player.fighter) {
      hurt = Math.min(1, hurt + amount / 30);
      player.shake = Math.max(player.shake, Math.min(0.6, 0.15 + amount / 60));
      player.recoilPitch += (Math.random() - 0.3) * Math.min(0.04, amount / 1500); // the hit jolts your aim
      audio.hurt(false);
      if (attacker) pointDamage(attacker);
    }
  };
  combat.onKill = (victim, attacker, info) => {
    fx.decals.bleed(info.at || victim.pos, info.dir, info.head ? 50 : 30);
    if (info.dir) {
      const flat = new THREE.Vector3(info.dir.x, 0, info.dir.z);
      if (flat.lengthSq() > 1e-4) flat.normalize();
      fx.decals.pool(victim.pos.clone().addScaledVector(flat, 0.75), info.head ? 1.9 : 1.5, 1.2);
    }
    const how = `${WEAPONS[info.weapon]?.short || ''}${info.head ? ' · headshot' : ''}`;
    const by = attacker === victim ? '' : attacker ? tagName(attacker) : '';
    feed(`${by} <span class="gun">▸ ${how} ▸</span> ${tagName(victim)}`);
    if (victim === player.fighter) {
      if (player.vehicle) cars.leave(player);
      weapons.drone.clear();
      hurt = 1;
      audio.hurt(true);
      if (attacker) pointDamage(attacker);
      if (mode === 'solo') {
        round.state = 'over';
        const who = attacker === victim ? 'Your own grenade' : attacker ? attacker.name : 'A rival';
        banner('Eliminated', `${who} got you. Press R to fight again.`, 'show lost');
      }
    } else if (mode === 'solo' && rivals.every((r) => !r.fighter.alive) && player.fighter.alive) {
      round.state = 'over';
      banner('Victory', `You outlasted ${rivals.length > 1 ? `all ${rivals.length} rivals` : 'your rival'}. Press R to fight again.`, 'show won');
    }
  };
  weapons.onNearMiss = (miss) => audio.whiz(miss);
  // any blast (grenade, drone, a car going up) shakes the camera by how close it is
  fx.onBlast = (pos) => {
    const dist = camera.position.distanceTo(pos);
    if (dist < 35) player.shake = Math.max(player.shake, Math.min(0.9, 6 / Math.max(dist, 1)));
  };
  weapons.onExplosion = (pos, dist) => {
    player.shake = Math.max(player.shake, Math.min(0.9, 6 / Math.max(dist, 1)));
    if (dist < 4 && player.fighter.alive) hurt = Math.max(hurt, 0.4);
  };

  let tags = [];
  const tagPos = new THREE.Vector3();
  const rebuildTags = () => {
    $('tags').innerHTML = '';
    const sources = mode === 'multi' ? [...session.remotes.values()] : rivals;
    tags = sources.map((r) => {
      const el = document.createElement('div');
      el.className = 'tag';
      const name = r.persona?.name || r.fighter.name;
      const color = r.persona?.color || r.fighter.color;
      el.innerHTML = `<b style="color:${color}">${name}</b><div class="hp"><i></i></div><small></small>`;
      $('tags').appendChild(el);
      return { r, el, bar: el.querySelector('i'), info: el.querySelector('small'), seen: 0, losT: 0 };
    });
  };
  rebuildTags();
  const updateTags = (dt) => {
    for (const t of tags) {
      const f = t.r.fighter;
      t.losT -= dt;
      if (t.losT <= 0) {
        t.losT = 0.2;
        const o = camera.position;
        const d = combat.chest(f).sub(o);
        const len = d.length();
        const hit = len < 110 ? world.raycast(o, d.divideScalar(len), len + 0.5, player.fighter) : null;
        t.visible = len < 110 && (!hit || hit.fighter === f || hit.t > len - 0.4);
      }
      t.seen = t.visible ? 1 : Math.max(0, t.seen - dt * 2);
      tagPos.copy(f.alive ? f.head : f.pos).y += f.alive ? 0.42 : 0.6;
      tagPos.project(camera);
      if (t.seen <= 0 || tagPos.z > 1) { t.el.style.opacity = 0; continue; }
      t.el.style.opacity = (f.alive ? 1 : 0.55) * t.seen;
      t.el.style.transform = `translate(${((tagPos.x + 1) / 2) * innerWidth}px, ${((1 - tagPos.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
      t.bar.style.width = `${(f.health / MAX_HEALTH) * 100}%`;
      if (!f.alive) t.info.textContent = 'eliminated';
      else if (mode === 'multi') t.info.textContent = `${WEAPONS[f.loadout.current]?.short || ''} · ${t.r.away ? 'away' : 'human'}`;
      else {
        t.info.textContent = `${WEAPONS[f.loadout.current].short} · ${t.r.label}${t.r.target ? ` → ${t.r.target.isPlayer ? 'you' : t.r.target.name}` : ''} · ${t.r.source === 'jev' ? `Jev ${Math.round(t.r.confidence * 100)}%` : 'local AI'}`;
      }
    }
  };

  character.onFootstep = (i, speed) => {
    const p = player.pos;
    const wet = hasSea() && p.y < 0.05;
    audio.footstep(wet ? 'water' : surfaceAt(p.x, p.z), speed);
    // a footfall kicks up a little: splashes in the rain, dust at a run
    const foot = character.bones[i ? 'RightFoot' : 'LeftFoot']?.getWorldPosition(new THREE.Vector3());
    if (foot && !wet) {
      const rain = world.weather?.amount || 0;
      foot.y = terrain.heightAt(foot.x, foot.z) + 0.03;
      if (rain > 0.3) {
        for (let k = 0; k < 5; k++) fx.alpha.spawn({ pos: foot.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2), size: 0.014, life: 0.35, color: [0.75, 0.8, 0.85], alpha: 0.7, gravity: 9.8 });
      } else if (speed > 4.5) {
        fx.alpha.spawn({ pos: foot.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.25, (Math.random() - 0.5) * 0.4), size: 0.12, grow: 1.4, life: 0.7, color: [0.55, 0.52, 0.48], alpha: 0.16, drag: 2 });
      }
    }
    if (wet) fx.impact(p.clone().setY(0.02), new THREE.Vector3(0, 1, 0), 'water', new THREE.Vector3(0, -1, 0));
  };
  player.onLand = (v) => audio.land(v);

  let hitTimer = 0;
  weapons.onHit = (kind) => {
    hitTimer = kind === 'kill' ? 0.5 : 0.25;
    const hm = $('hitmarker');
    hm.className = `show ${kind}`;
  };

  await progress.task('Compiling shaders', 1, async () => {
    if (mapDef.vegetation) veg.update(0, player.pos, true);
    if (grass) grass.update(0, player.pos, player.pos);
    pipeline.setTimeOfDay(timeOfDay, 0);
    player.update(0.016, input);
    rivals.forEach((r) => r.update(0.016, false));
    combat.update(0);
    renderer.compile(pipeline.scene, camera);
    pipeline.render(camera, 0.016, {});
  });

  $('loading').classList.add('hidden');
  $('play').classList.remove('hidden');
  menu.classList.remove('loading');
  paintMode();
  const applyLook = (dx, dy, touch) => {
    const flying = weapons.drone.flying;
    const base = touch ? 0.0026 : 0.00022;
    const sens = Number($('sens').value) * base * (flying ? 0.85 : player.scoped ? 0.16 : player.camDist < 2 ? 0.7 : 1);
    if (flying) weapons.drone.look(dx * sens, dy * sens);
    else if (player.fighter.alive) player.look(dx * sens, dy * sens);
  };
  const setPlay = (on) => {
    inPlay = !!on;
    menu.classList.toggle('hidden', inPlay);
    $('hud').classList.toggle('hidden', !inPlay);
    if (inPlay) {
      rosterStudio.hideHover();
      touchPad.show();
      if (round.state === 'waiting') startRound();
    } else {
      touchPad.hide();
      for (const k in input) input[k] = false;
      input.moveX = 0;
      input.moveY = 0;
      if (document.pointerLockElement) document.exitPointerLock();
      if (document.fullscreenElement) document.exitFullscreen?.();
    }
  };
  const touchPad = setupTouch(input, {
    onLook: (dx, dy) => { if (inPlay) applyLook(dx, dy, true); },
    onMenu: () => setPlay(false),
  });
  if (labBoot && mode === 'solo') setPlay(true);
  $('play').onclick = async () => {
    if (mode === 'solo' && rosterMenu.changed()) { rosterMenu.save(); location.reload(); return; }
    if (mode === 'multi') {
      if (!net.hosted) return;
      rosterMenu.save();
      await applyLocalFighter();
    }
    audio.holdFocus();
    if (touchPad.active) {
      setPlay(true);
    } else {
      canvas.requestPointerLock();
    }
  };
  canvas.addEventListener('click', () => {
    if (touchPad.active) return;
    if (document.pointerLockElement !== canvas && menu.classList.contains('hidden')) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (touchPad.active) return;
    setPlay(document.pointerLockElement === canvas);
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    applyLook(e.movementX, e.movementY, false);
  });

  let elapsed = 0;
  let fpsT = 0, frames = 0, fps = 0;
  const clock = startClock((dt, draw) => {
    elapsed += dt;
    if (input.fastTime && !mapDef.fixedTime && (mode !== 'multi' || session?.isHost)) {
      timeOfDay = (timeOfDay + dt * 0.03) % 1;
      $('timeofday').value = Math.round(timeOfDay * 1000);
    }
    pipeline.setTimeOfDay(timeOfDay, elapsed);
    studio?.update?.(((timeOfDay * 1440) + 360) % 1440, pipeline.night);
    world.stepWeather?.(dt);
    { // speed blur at the wheel only, growing past ~8 m/s
      const v = player.vehicle ? Math.abs(player.vehicle.speed) : 0;
      const goal = THREE.MathUtils.clamp((v - 8) / 22, 0, 1);
      pipeline.motion += (goal - pipeline.motion) * Math.min(1, dt * 3);
    }
    carLights.update(dt, cars.list, camera, pipeline.night);
    world.nightLights?.update(pipeline.night, player.vehicle && player.vehicle.kind !== 'scooter' ? player.vehicle : null, (x, z) => terrain.heightAt(x, z), weather.amount);

    const locked = inPlay;
    if (mode === 'solo' && (input.restart || (input.reload && round.state === 'over')) && (round.state === 'over' || round.state === 'fight')) {
      startRound();
      input.reload = false;
    }
    input.restart = false;
    if (mode === 'multi' && round.state === 'over' && round.rematchAt) {
      const left = Math.max(0, (round.rematchAt - Date.now()) / 1000);
      banner($('bannertitle').textContent || 'Round over', left > 0.15 ? `Next round in ${Math.ceil(left)}` : 'Starting…', $('banner').className);
    }
    if (round.state === 'countdown') {
      if (round.ends) round.t = (round.ends - Date.now()) / 1000;
      else round.t -= dt;
      const crowd = mode === 'multi'
        ? `${session.peerCount + 1} players. Last one standing wins.`
        : `${rivals.length > 1 ? `${rivals.length} rivals are` : '1 rival is'} closing in. Last one standing wins.`;
      banner(round.t > 0 ? `${Math.ceil(round.t)}` : 'Fight', crowd, 'show countdown');
      if (round.t <= -0.6) { round.state = 'fight'; banner('', '', ''); }
    }

    const alive = player.fighter.alive;
    const flying = weapons.drone.flying;
    const dying = weapons.drone.dying;
    const spec = refreshSpectate();
    touchPad.setDrone(flying);
    if (alive && !flying && (input.interact || input.jump) && cars.canToggle(player)) {
      cars.toggle(player);
      input.jump = false;
    }
    input.interact = false;
    const driving = !!player.vehicle;
    cars.update(dt, alive && !flying ? input : NO_INPUT, player, {
      active: alive && !flying && !spec,
      squash: round.state === 'fight' ? combat : null,
    });
    const state = player.update(dt, alive && !flying ? input : NO_INPUT, spec);
    const canShoot = alive && round.state !== 'countdown' && !(mode === 'multi' && round.state === 'waiting');
    if (canShoot) weapons.update(dt, input);
    else weapons.tick(player.fighter, dt);
    input.jump = false;
    input.toggleWalk = false;
    input.toggleCrouch = false;
    input.slot = 0;
    input.cycle = 0;
    input.reload = false;
    weapons.updateGrenades(dt);
    input.firePressed = false;
    input.fireReleased = false;
    const hidden = document.visibilityState === 'hidden';
    const active = (locked || hidden) && (round.state === 'fight' || round.state === 'over');
    session.update(dt);
    if (mode === 'multi' && round.state === 'waiting') {
      const need = session.minPlayers || minPlayers();
      const have = session.peerCount + 1;
      const wait = net.status === 'online'
        ? (have >= need
          ? `${have} in the room. Waiting for the fight to start.`
          : `${have} / ${need} players. Share the room link.`)
        : net.error === 'host'
          ? 'Open the hosted game or run npm run cf:dev to play multiplayer.'
          : 'Connecting to the room…';
      banner('Waiting', wait, 'show countdown');
    }
    if (mode === 'solo') rivals.forEach((r) => r.update(dt, active && !labCalm));
    combat.update(dt);
    props.update(dt);
    fx.update(dt);
    if (draw) {
      terrain.update(elapsed);
      const viewPos = spec?.pos || player.pos;
      if (grass) grass.update(elapsed, camera.position, viewPos);
      if (mapDef.vegetation) veg.update(elapsed, camera.position);
      if (city) city.update(dt, fx, camera);
      if (arena) arena.update(dt, fx, camera);
      if (fish) fish.update(dt, camera);
      const coast = THREE.MathUtils.clamp(1 - (terrain.heightAt(viewPos.x, viewPos.z) - 1) / 25, 0, 1);
      audio.updateAmbience(dt, { altitude: player.pos.y, coast, underwater: player.underwater, rain: world.weather?.amount || 0 });
    }

    if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) $('hitmarker').classList.remove('show'); }
    hurt = Math.max(0, hurt - dt * 1.6);
    if (dmgT > 0) { dmgT -= dt; aimDamage(); }
    if (!draw) return;

    $('crosshair').classList.toggle('idle', !state.aiming && !flying);
    { // the gap shows how far shots can stray right now
      const L = player.fighter.loadout;
      const def = L && WEAPONS[L.current];
      const base = def ? (L.current === 'rifle' ? def.hipSpread : def.spread) || 0 : 0;
      const rad = base * weapons.spreadScale();
      const px = rad / Math.tan((camera.fov * Math.PI) / 360) * (innerHeight / 2);
      $('crosshair').style.setProperty('--gap', `${Math.min(60, 5 + px).toFixed(1)}px`);
    }
    $('crosshair').classList.toggle('enemy', !!player.aimHit?.fighter);
    $('crosshair').classList.toggle('hidden', !alive || player.scopeT > 0.35 || dying || driving);
    $('crosshair').classList.toggle('drone', flying && !dying);
    const scoped = alive && player.scopeT > 0.45;
    $('scope').classList.toggle('show', scoped);
    $('scope').classList.toggle('steady', scoped && player.holdingBreath);
    if (scoped) {
      $('scopedist').textContent = `${Math.round(player.aimPoint.distanceTo(player.pos))} m`;
      $('scopehint').textContent = player.holdingBreath ? 'steady' : player.breath < 0.08 ? 'out of breath' : 'release to fire · shift steadies';
      $('breathbar').style.setProperty('--pct', `${(player.breath * 100).toFixed(0)}%`);
    }
    const L = player.fighter.loadout;
    const wdef = WEAPONS[L.current];
    $('ammo').textContent = L.current === 'grenade' ? `${L.grenades}`
      : L.current === 'drone' ? `${L.drones}` : `${L.mag[L.current]} / ${L.reserve[L.current]}`;
    $('weaponname').textContent = spec
      ? `Spectating ${spec.persona?.name || spec.fighter.name}`
      : driving ? 'driving · E to leave'
      : dying ? 'drone shot down — returning'
      : flying ? 'space to explode · you are exposed'
      : weapons.chargingGrenade ? 'pull back… release to throw'
      : L.reloading ? 'reloading…' : wdef.name;
    $('weapon').classList.toggle('reloading', L.reloading);
    $('weapon').classList.toggle('empty', L.current !== 'grenade' && L.current !== 'drone' && L.mag[L.current] === 0);
    const gch = $('grenadecharge');
    const charging = alive && L.current === 'grenade' && weapons.chargingGrenade;
    gch.classList.toggle('show', charging);
    gch.classList.toggle('full', charging && weapons.grenadeCharge > 0.98);
    const gbar = gch.querySelector('i');
    if (gbar) gbar.style.setProperty('--pct', charging ? `${(weapons.grenadeCharge * 100).toFixed(0)}%` : '0%');
    $('crosshair').classList.toggle('grenade', charging);
    document.querySelectorAll('#slots b').forEach((el, i) => {
      const key = ['pistols', 'rifle', 'grenade', 'drone'][i];
      el.classList.toggle('on', key === L.current);
      el.classList.toggle('off', key === 'drone' ? L.drones <= 0 && !flying : !L.has(key));
    });
    $('dronesplit').classList.toggle('show', flying);
    $('dronesplit').classList.toggle('shotdown', dying);
    $('dronesplit').classList.toggle('leaving', weapons.drone.fadeOut);
    const leftHint = document.querySelector('#dronesplit .pane.left b');
    const leftTag = document.querySelector('#dronesplit .pane.left small');
    const range = weapons.drone.range();
    const far = Number.isFinite(DRONE.maxRange) && range > DRONE.maxRange * 0.78;
    if (leftHint) {
      leftHint.textContent = dying ? 'shot down'
        : far ? `range ${range.toFixed(0)} / ${DRONE.maxRange} m · turn back`
        : Number.isFinite(DRONE.maxRange) ? `range ${range.toFixed(0)} / ${DRONE.maxRange} m · space explode`
        : `${range.toFixed(0)} m out · space explode`;
    }
    if (leftTag) leftTag.textContent = dying ? 'signal lost' : far ? 'link fading' : 'drone';
    $('dronesplit').classList.toggle('far', flying && !dying && far);
    const near = weapons.live.some((g) => g.pos.distanceTo(player.pos) < WEAPONS.grenade.radius && g.owner !== player.fighter);
    $('grenadewarn').classList.toggle('show', alive && near);
    const swimEl = $('swimhint');
    if (swimEl) {
      swimEl.classList.toggle('show', alive && player.swimming && !driving);
      swimEl.textContent = player.diving ? 'F swim up · surface to breathe' : 'F swim up / exit · Ctrl dive';
    }
    const carEl = $('carhint');
    if (carEl) {
      const prompt = cars.prompt;
      carEl.classList.toggle('show', alive && !!prompt && !player.swimming);
      carEl.textContent = prompt?.mode === 'drive'
        ? `E ${prompt.kind === 'scooter' ? 'hop off' : 'leave'} · WASD ${prompt.kind === 'scooter' ? 'ride' : 'drive'} · ${Math.abs(prompt.speed).toFixed(0)} m/s`
        : `E ${prompt?.car?.kind === 'scooter' ? 'ride scooter' : 'enter car'}`;
    }
    const hp = spec ? spec.fighter.health : player.fighter.health;
    $('hpbar').style.width = `${(hp / MAX_HEALTH) * 100}%`;
    $('hpbar').classList.toggle('low', hp <= 35);
    $('hpnum').textContent = Math.ceil(hp);
    $('rivalsleft').textContent = mode === 'multi'
      ? Math.max(0, session.humansAlive() - (player.fighter.alive ? 1 : 0))
      : rivals.filter((r) => r.fighter.alive).length;
    const leftLabel = document.querySelector('#round small');
    if (leftLabel) leftLabel.textContent = mode === 'multi' ? 'players left' : 'rivals left';
    const radarSelf = spec || player;
    const radarYaw = player.camYaw;
    const radarOthers = radarSubjects(mode === 'multi' ? [...session.remotes.values()] : rivals)
      .filter((o) => o.id !== radarSelf.fighter?.id);
    drawRadar($('radarcanvas'), {
      blips: radarBlips({ x: radarSelf.pos.x, z: radarSelf.pos.z }, radarYaw, radarOthers, mapDef.radarRange || RADAR_RANGE),
      range: mapDef.radarRange || RADAR_RANGE,
      time: elapsed,
    });
    $('radar').classList.toggle('scoped', scoped);
    $('damage').style.opacity = spec ? 0 : Math.max(hurt, alive ? Math.max(0, (45 - hp) / 45) * 0.45 : 0.7);
    if (spec && (round.state === 'fight' || (mode === 'solo' && round.state === 'over'))) {
      const who = spec.persona?.name || spec.fighter.name;
      banner('Spectating', mode === 'solo' ? `${who} · Press R to fight again` : who, 'show lost');
    }
    const js = jev.stats;
    if (mode === 'solo') {
      $('jevstat').textContent = js.online === null ? 'Jev · waiting' : js.online ? `Jev online · ${Math.round(js.latency)} ms` : `Jev offline (${js.error}) · local AI`;
      $('jevstat').className = js.online === false ? 'off' : '';
    }
    const ns = $('netstat');
    if (ns && mode === 'multi') {
      ns.textContent = !net.hosted ? 'net · needs host'
        : net.status === 'online' ? `net · ${session.peerCount} other`
        : net.status === 'connecting' ? 'net · connecting'
        : net.status === 'error' ? `net · ${net.error || 'error'}`
        : 'net · offline';
      ns.className = net.status === 'online' ? 'on' : net.status === 'error' ? 'off' : '';
    }
    updateTags(dt);

    if (draw) {
      renderer.info.reset();
      if (flying) {
        weapons.drone.setAspect(innerWidth, innerHeight);
        if (character.root) character.root.visible = true;
        pipeline.renderSplit(weapons.drone.cam, weapons.drone.opCam, dt, { underwater: false, shadowCenter: player.pos });
      } else {
        pipeline.render(camera, dt, { underwater: player.underwater, shadowCenter: spec?.pos || player.pos });
      }

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
            mapDef.vegetation ? `trees ${veg.stats.trees} · rocks ${veg.stats.rocks} · ferns ${veg.stats.ferns}` : `map ${mapDef.label}`,
            `jev ${jev.stats.requests} requests · ${jev.stats.errors} errors`,
            ...rivals.map((r) => `${r.persona.name} ${Math.ceil(r.fighter.health)} hp · ${r.tactic} (${r.source} ${r.confidence.toFixed(2)}) → ${r.target?.name ?? '-'}`),
          ].join('\n');
        }
      }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    for (const k in input) input[k] = false;
    audio.holdFocus();
  });
  net.onMessage = () => {
    if (document.visibilityState === 'hidden') clock.pulse(false);
  };
  setInterval(() => {
    if (mode !== 'multi' || !session) return;
    if (document.visibilityState === 'visible') return;
    if (net.status === 'online') session.sendPose(1);
    else if (net.identity && net.status !== 'connecting') net.connect(net.identity);
  }, 1000);
}

init().catch(fail);

const fitView = () => {
  const vw = visualViewport?.width || 0;
  const vh = visualViewport?.height || 0;
  const w = Math.max(2, Math.round(vw || innerWidth || 360));
  const h = Math.max(2, Math.round(vh || innerHeight || 640));
  pipeline.resize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
addEventListener('resize', fitView);
visualViewport?.addEventListener('resize', fitView);
fitView();
