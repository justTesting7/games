import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { Progress, loadImage } from './engine/assets.js';
import { generateHeightmap, loadTerrainTextures, Terrain } from './world/terrain.js';
import { Grass } from './world/grass.js';
import { Vegetation } from './world/vegetation.js';
import { getMap } from './world/maps.js';
import { City } from './world/city.js';
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

// Closest hit among terrain, water, trees and rocks, props and fighters
// other than `ignore`.
world.raycast = (o, d, maxDist, ignore) => {
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
  if (c && (!best || c.t < best.t)) best = { t: c.t, normal: c.normal, surface: c.surface || c.collider.type };
  const pr = world.props.raycast(o, d, best ? best.t : maxDist);
  if (pr && (!best || pr.t < best.t)) best = pr;
  const fh = world.combat.raycast(o, d, best ? best.t : maxDist, ignore);
  if (fh) best = fh;
  return best;
};
const combat = new Combat();
world.combat = combat;
const jev = new Jev();

const NO_INPUT = { forward: false, back: false, left: false, right: false, sprint: false, jump: false, aim: false, fire: false, toggleWalk: false, crouch: false };
const input = { forward: false, back: false, left: false, right: false, sprint: false, jump: false, aim: false, fire: false, toggleWalk: false, crouch: false, fastTime: false };
const keymap = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'sprint', ShiftRight: 'sprint', ControlLeft: 'crouch', ControlRight: 'crouch', KeyT: 'fastTime' };
addEventListener('keydown', (e) => {
  if (keymap[e.code]) input[keymap[e.code]] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    if (document.pointerLockElement === canvas) {
      input.fire = true;
      if (!e.repeat) input.firePressed = true;
    }
  }
  if (e.code === 'KeyF' && !e.repeat) input.jump = true;
  if (e.code === 'KeyC' && !e.repeat) input.toggleCrouch = true;
  if (e.code === 'KeyV' && !e.repeat) input.toggleWalk = true;
  if (e.code === 'KeyR' && !e.repeat) input.reload = true;
  if (e.code === 'Enter' && !e.repeat) input.restart = true;
  if (/^Digit[1-3]$/.test(e.code)) input.slot = Number(e.code.slice(5));
  if (e.code === 'KeyQ' && !e.repeat) input.cycle = 1;
  if (e.code === 'F3') { $('debug').classList.toggle('hidden'); e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  if (keymap[e.code]) input[keymap[e.code]] = false;
  if (e.code === 'Space') { input.fire = false; input.fireReleased = true; }
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

const mapId = localStorage.getItem('relic-map') || 'island';
const mapDef = getMap(mapId);
$('map').value = mapId;
$('maptitle').textContent = mapDef.label;
$('mapsub').textContent = mapDef.subtitle;
$('map').onchange = (e) => {
  localStorage.setItem('relic-map', e.target.value);
  location.reload();
};

let timeOfDay = mapDef.timeOfDay;
$('timeofday').value = Math.round(timeOfDay * 1000);
$('timeofday').oninput = (e) => { timeOfDay = e.target.value / 1000; };
$('quality').onchange = (e) => {
  pipeline.setQuality(e.target.value);
  localStorage.setItem('relic-quality', e.target.value);
  if (world.veg && world.mapDef?.vegetation) { world.veg.scale = pipeline.quality.trees; world.veg.update(0, camera.position, true); }
};
const selection = loadSelection();
const rosterMenu = setupRosterMenu(selection, $('roster'), () => {
  $('play').textContent = rosterMenu.changed() ? 'Apply & reload' : 'Fight';
});
const rosterStudio = createRosterAvatarStudio();

$('volume').oninput = (e) => audio.setVolume(e.target.value / 100);
audio.setVolume($('volume').value / 100);

async function init() {
  pipeline.fogMaterial.uniforms.uFogDensity.value = mapDef.fogDensity;
  const [data, textures] = await Promise.all([
    progress.task(mapDef.loadLabel, 3, () => generateHeightmap(mapDef.id)),
    progress.task('Loading terrain materials', 3, () => loadTerrainTextures(mapDef)),
  ]);
  const terrain = new Terrain(data, textures, { urban: mapDef.id === 'city' });
  world.terrain = terrain;
  pipeline.scene.add(terrain.group);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2));
  water.frustumCulled = false;
  pipeline.setWater(water, terrain.heightTex, terrain.uniforms.uWorldSize.value);

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
  if (mapDef.id === 'city') city = new City(terrain, veg.colliders, pipeline);
  const fighters = [selection.player, ...selection.rivals].map(byId);
  const bodies = [...new Set(['f', 'm', ...fighters.map((e) => e.look.body)])];
  const [, charAssets, looks] = await Promise.all([
    mapDef.vegetation ? veg.load(progress) : Promise.resolve(),
    Character.loadAssets(progress, bodies),
    resolveLooks(fighters),
    mapDef.waterCamp ? props.load(progress) : Promise.resolve(),
    city ? city.load(progress) : Promise.resolve(),
  ]);
  character.load(charAssets, looks[0]);

  const spawn = data.spawn;
  const facing = Math.atan2(data.peak.x - spawn.x, data.peak.z - spawn.z);
  if (mapDef.vegetation) {
    await progress.task(mapDef.plantLabel, 1, async () => veg.scatter(terrain, spawn));
    veg.scale = pipeline.quality.trees;
    pipeline.scene.add(veg.group);
  }
  if (mapDef.waterCamp) {
    props.place(spawn, facing);
    pipeline.scene.add(props.group);
  }
  if (city && data.layout) {
    city.build(data.layout);
    pipeline.scene.add(city.group);
  }
  character.addTo(pipeline.scene);

  const player = new Player(world, character, camera);
  player.fighter = combat.add({ id: 'player', name: 'You', character, pos: player.pos, isPlayer: true, color: fighters[0].color });
  player.spawn(spawn.x, spawn.z, facing);
  const fx = new Effects(pipeline, terrain, audio);
  const weapons = new Weapons(world, player, character, fx, audio, combat);
  weapons.setGrenadeModel(charAssets.grenadeGltf);
  player.fighter.loadout = new Loadout(3);
  player.onScope = () => audio.mech('scope');
  Object.assign(world, { grass, character, player, fx, weapons, data, city, mapDef });

  const rivals = fighters.slice(1).map((entry, i) => {
    const ch = new Character();
    ch.load(charAssets, looks[i + 1]);
    ch.addTo(pipeline.scene);
    return new Rival(world, combat, weapons, jev, persona(entry), ch);
  });
  window.__game = { world, pipeline, camera, input, rivals, combat, jev };

  const rosterChars = new Map([[fighters[0].id, character]]);
  fighters.slice(1).forEach((e, i) => rosterChars.set(e.id, rivals[i].character));
  const lookCache = new Map(fighters.map((e, i) => [e.id, looks[i]]));
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
  // open, dry, walkable ground.
  const spawnRivals = () => {
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
        if (!terrain.inBounds(x, z) || h < (mapDef.id === 'city' ? 1.2 : 0.6)) continue;
        if (terrain.normalAt(x, z).y < (mapDef.id === 'city' ? 0.75 : 0.8)) continue;
        if (veg.colliders.query(x, z, 1.2, tmp).length) continue;
        if (rivals.some((o, j) => j < i && Math.hypot(o.pos.x - x, o.pos.z - z) < 8)) continue;
        at = { x, z };
      }
      at ||= { x: p.x + (i ? -5 : 5), z: p.z + 10 };
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
  const startRound = () => {
    if (!player.fighter.alive) {
      player.spawn(spawn.x, spawn.z, facing);
      player.vel.set(0, 0, 0);
    }
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
    fx.decals.clear();
    spawnRivals();
    $('feed').innerHTML = '';
    round.state = 'countdown';
    round.t = 3;
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
  const pointDamage = (from) => {
    const a = Math.atan2(from.pos.x - player.pos.x, from.pos.z - player.pos.z);
    const rel = Math.atan2(Math.sin(a - player.camYaw), Math.cos(a - player.camYaw));
    dmgDir.style.transform = `rotate(${-rel}rad)`;
    dmgDir.classList.remove('show');
    void dmgDir.offsetWidth;
    dmgDir.classList.add('show');
  };
  combat.onDamage = (victim, attacker, amount) => {
    if (victim === player.fighter) {
      hurt = Math.min(1, hurt + amount / 30);
      player.shake = Math.max(player.shake, 0.25);
      audio.hurt(false);
      if (attacker) pointDamage(attacker);
    }
  };
  combat.onKill = (victim, attacker, info) => {
    if (info.dir) {
      const flat = new THREE.Vector3(info.dir.x, 0, info.dir.z);
      if (flat.lengthSq() > 1e-4) flat.normalize();
      fx.decals.pool(victim.pos.clone().addScaledVector(flat, 0.75), info.head ? 1.9 : 1.5, 1.2);
    }
    const how = `${WEAPONS[info.weapon]?.short || ''}${info.head ? ' · headshot' : ''}`;
    const by = attacker === victim ? '' : attacker ? tagName(attacker) : '';
    feed(`${by} <span class="gun">▸ ${how} ▸</span> ${tagName(victim)}`);
    if (victim === player.fighter) {
      hurt = 1;
      audio.hurt(true);
      if (attacker) pointDamage(attacker);
      round.state = 'over';
      const who = attacker === victim ? 'Your own grenade' : attacker ? attacker.name : 'A rival';
      banner('Eliminated', `${who} got you. Press R to fight again.`, 'show lost');
    } else if (rivals.every((r) => !r.fighter.alive) && player.fighter.alive) {
      round.state = 'over';
      banner('Victory', `You outlasted ${rivals.length > 1 ? `all ${rivals.length} rivals` : 'your rival'}. Press R to fight again.`, 'show won');
    }
  };
  weapons.onNearMiss = (miss) => audio.whiz(miss);
  weapons.onExplosion = (pos, dist) => {
    player.shake = Math.max(player.shake, Math.min(0.9, 6 / Math.max(dist, 1)));
    if (dist < 4 && player.fighter.alive) hurt = Math.max(hurt, 0.4);
  };

  const tags = rivals.map((r) => {
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `<b style="color:${r.persona.color}">${r.persona.name}</b><div class="hp"><i></i></div><small></small>`;
    $('tags').appendChild(el);
    return { r, el, bar: el.querySelector('i'), info: el.querySelector('small'), seen: 0, losT: 0 };
  });
  const tagPos = new THREE.Vector3();
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
      t.info.textContent = !f.alive ? 'eliminated'
        : `${WEAPONS[f.loadout.current].short} · ${t.r.label}${t.r.target ? ` → ${t.r.target.isPlayer ? 'you' : t.r.target.name}` : ''} · ${t.r.source === 'jev' ? `Jev ${Math.round(t.r.confidence * 100)}%` : 'local AI'}`;
    }
  };

  character.onFootstep = (i, speed) => {
    const p = player.pos;
    audio.footstep(p.y < 0.05 ? 'water' : surfaceAt(p.x, p.z), speed);
    if (p.y < 0.05) fx.impact(p.clone().setY(0.02), new THREE.Vector3(0, 1, 0), 'water', new THREE.Vector3(0, -1, 0));
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
  $('play').onclick = () => {
    if (rosterMenu.changed()) { rosterMenu.save(); location.reload(); return; }
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
    if (locked) rosterStudio.hideHover();
    if (!locked) for (const k in input) input[k] = false;
    if (locked && round.state === 'waiting') startRound();
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    const sens = Number($('sens').value) * 0.00022 * (player.scoped ? 0.16 : player.camDist < 2 ? 0.7 : 1);
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

    const locked = document.pointerLockElement === canvas;
    if ((input.restart || (input.reload && round.state === 'over')) && (round.state === 'over' || round.state === 'fight')) {
      startRound();
      input.reload = false;
    }
    input.restart = false;
    if (round.state === 'countdown') {
      round.t -= dt;
      banner(round.t > 0 ? `${Math.ceil(round.t)}` : 'Fight', `${rivals.length > 1 ? `${rivals.length} rivals are` : '1 rival is'} closing in. Last one standing wins.`, 'show countdown');
      if (round.t <= -0.6) { round.state = 'fight'; banner('', '', ''); }
    }

    const alive = player.fighter.alive;
    const state = player.update(dt, alive ? input : NO_INPUT);
    input.jump = false;
    input.toggleWalk = false;
    input.toggleCrouch = false;
    if (alive && round.state !== 'countdown') weapons.update(dt, input);
    else weapons.tick(player.fighter, dt);
    input.slot = 0;
    input.cycle = 0;
    input.reload = false;
    weapons.updateGrenades(dt);
    input.firePressed = false;
    input.fireReleased = false;
    const active = locked && (round.state === 'fight' || round.state === 'over');
    rivals.forEach((r) => r.update(dt, active));
    combat.update(dt);
    props.update(dt);
    fx.update(dt);
    terrain.update(elapsed);
    if (grass) grass.update(elapsed, camera.position, player.pos);
    if (mapDef.vegetation) veg.update(elapsed, camera.position);
    if (city) city.update(dt, fx, camera);
    const coast = THREE.MathUtils.clamp(1 - (terrain.heightAt(player.pos.x, player.pos.z) - 1) / 25, 0, 1);
    audio.updateAmbience(dt, { altitude: player.pos.y, coast, underwater: player.underwater });

    $('crosshair').classList.toggle('idle', !state.aiming);
    $('crosshair').classList.toggle('enemy', !!player.aimHit?.fighter);
    $('crosshair').classList.toggle('hidden', !alive || player.scopeT > 0.35);
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
    $('ammo').textContent = L.current === 'grenade' ? `${L.grenades}` : `${L.mag[L.current]} / ${L.reserve[L.current]}`;
    $('weaponname').textContent = weapons.chargingGrenade ? 'pull back… release to throw'
      : L.reloading ? 'reloading…' : wdef.name;
    $('weapon').classList.toggle('reloading', L.reloading);
    $('weapon').classList.toggle('empty', L.current !== 'grenade' && L.mag[L.current] === 0);
    const gch = $('grenadecharge');
    const charging = alive && L.current === 'grenade' && weapons.chargingGrenade;
    gch.classList.toggle('show', charging);
    gch.classList.toggle('full', charging && weapons.grenadeCharge > 0.98);
    const gbar = gch.querySelector('i');
    if (gbar) gbar.style.setProperty('--pct', charging ? `${(weapons.grenadeCharge * 100).toFixed(0)}%` : '0%');
    $('crosshair').classList.toggle('grenade', charging);
    document.querySelectorAll('#slots b').forEach((el, i) => {
      const key = ['pistols', 'rifle', 'grenade'][i];
      el.classList.toggle('on', key === L.current);
      el.classList.toggle('off', !L.has(key));
    });
    const near = weapons.live.some((g) => g.pos.distanceTo(player.pos) < WEAPONS.grenade.radius && g.owner !== player.fighter);
    $('grenadewarn').classList.toggle('show', alive && near);
    if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) $('hitmarker').classList.remove('show'); }
    const hp = player.fighter.health;
    $('hpbar').style.width = `${(hp / MAX_HEALTH) * 100}%`;
    $('hpbar').classList.toggle('low', hp <= 35);
    $('hpnum').textContent = Math.ceil(hp);
    $('rivalsleft').textContent = rivals.filter((r) => r.fighter.alive).length;
    hurt = Math.max(0, hurt - dt * 1.6);
    $('damage').style.opacity = Math.max(hurt, alive ? Math.max(0, (45 - hp) / 45) * 0.45 : 0.7);
    const js = jev.stats;
    $('jevstat').textContent = js.online === null ? 'Jev · waiting' : js.online ? `Jev online · ${Math.round(js.latency)} ms` : `Jev offline (${js.error}) · local AI`;
    $('jevstat').className = js.online === false ? 'off' : '';
    updateTags(dt);

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
          mapDef.vegetation ? `trees ${veg.stats.trees} · rocks ${veg.stats.rocks} · ferns ${veg.stats.ferns}` : `map ${mapDef.label}`,
          `jev ${jev.stats.requests} requests · ${jev.stats.errors} errors`,
          ...rivals.map((r) => `${r.persona.name} ${Math.ceil(r.fighter.health)} hp · ${r.tactic} (${r.source} ${r.confidence.toFixed(2)}) → ${r.target?.name ?? '-'}`),
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
