// Downloads third-party assets into public/assets/vendor (not committed).
//  - Poly Haven textures and models: CC0 (https://polyhaven.com/license)
//  - Ready Player Me avatar + animations: Ready Player Me Animation Library
//    license, which permits use with Ready Player Me avatars but not
//    redistribution. That is why these files are fetched instead of committed.
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'assets', 'vendor');

const PH_TEXTURES = {
  grass: 'leafy_grass',
  forest: 'forest_leaves_02',
  rock: 'rock_face_03',
  sand: 'coast_sand_01',
};
const PH_CITY_TEXTURES = {
  sand: 'asphalt_01',
  grass: 'brushed_concrete_2',
  forest: 'burned_ground_01',
  rock: 'broken_brick_wall',
};
const PH_MODELS = [
  'service_pistol', 'rock_moss_set_01', 'rock_moss_set_02', 'boulder_01',
  'namaqualand_boulder_02', 'fern_02', 'shrub_02', 'barrel_03',
  'wooden_crate_01', 'dead_tree_trunk', 'tree_stump_01', 'bolt_action_rifle_7_62',
  'stick_grenade',
  'covered_car', 'concrete_road_barrier', 'street_lamp_01', 'barrel_stove',
  'metal_trash_can', 'fire_hydrant', 'old_tyre', 'modular_chainlink_fence',
  'modular_urban_apartments_facade', 'modular_factory_facade', 'modular_fire_escape',
];
const RPM = 'https://raw.githubusercontent.com/readyplayerme/animation-library/master/feminine/glb';
const RPM_FILES = [
  'Feminine_TPose',
  'idle/F_Standing_Idle_001',
  'locomotion/F_Walk_003',
  'locomotion/F_Walk_Backwards_001',
  'locomotion/F_Walk_Strafe_Left_001',
  'locomotion/F_Walk_Strafe_Right_001',
  'locomotion/F_Jog_001',
  'locomotion/F_Jog_Backwards_001',
  'locomotion/F_Jog_Strafe_Left_002',
  'locomotion/F_Jog_Strafe_Right_002',
  'locomotion/F_Run_001',
  'locomotion/F_Run_Jump_001',
  'locomotion/F_Jog_Jump_Small_001',
  'locomotion/F_Walk_Jump_001',
  'locomotion/F_Falling_Idle_000',
];
const RPM_M = 'https://raw.githubusercontent.com/readyplayerme/animation-library/master/masculine/glb';
// Masculine skeleton: male locomotion, with the jump/fall clips kept on the
// same timing as the feminine set.
const RPM_M_FILES = [
  'Masculine_TPose',
  'idle/M_Standing_Idle_001',
  'locomotion/M_Walk_001',
  'locomotion/M_Walk_Backwards_001',
  'locomotion/M_Walk_Strafe_Left_002',
  'locomotion/M_Walk_Strafe_Right_002',
  'locomotion/M_Jog_001',
  'locomotion/M_Jog_Backwards_001',
  'locomotion/M_Jog_Strafe_Left_001',
  'locomotion/M_Jog_Strafe_Right_001',
  'locomotion/M_Run_001',
  'locomotion/F_Jog_Jump_Small_001',
  'locomotion/F_Run_Jump_001',
  'locomotion/F_Falling_Idle_000',
];

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function download(url, dest, tries = 4) {
  if (await exists(dest)) return false;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(dest + '.part', buf);
      await fs.rename(dest + '.part', dest);
      return true;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function pool(tasks, n = 8) {
  let i = 0, done = 0;
  const total = tasks.length;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      await t();
      done++;
      process.stdout.write(`\r  ${done}/${total}`);
    }
  }));
  process.stdout.write('\n');
}

async function main() {
  const marker = path.join(ROOT, '.complete-v6');
  if (await exists(marker)) {
    console.log('[assets] already downloaded');
    return;
  }
  console.log('[assets] fetching third-party assets into public/assets/vendor ...');
  const tasks = [];

  for (const [key, id] of Object.entries(PH_TEXTURES)) {
    const files = await json(`https://api.polyhaven.com/files/${id}`);
    const pick = (map) => files[map]?.['1k']?.jpg?.url;
    const maps = { diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm') };
    for (const [m, url] of Object.entries(maps)) {
      if (!url) throw new Error(`missing ${m} for ${id}`);
      tasks.push(() => download(url, path.join(ROOT, 'textures', `${key}_${m}.jpg`)));
    }
  }

  for (const [key, id] of Object.entries(PH_CITY_TEXTURES)) {
    const files = await json(`https://api.polyhaven.com/files/${id}`);
    const pick = (map) => files[map]?.['1k']?.jpg?.url;
    const maps = { diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm') };
    for (const [m, url] of Object.entries(maps)) {
      if (!url) throw new Error(`missing city ${m} for ${id}`);
      tasks.push(() => download(url, path.join(ROOT, 'textures', `city_${key}_${m}.jpg`)));
    }
  }

  for (const id of PH_MODELS) {
    const files = await json(`https://api.polyhaven.com/files/${id}`);
    const g = files.gltf['1k'].gltf;
    const dir = path.join(ROOT, 'models', id);
    tasks.push(() => download(g.url, path.join(dir, `${id}.gltf`)));
    for (const [rel, info] of Object.entries(g.include)) {
      tasks.push(() => download(info.url, path.join(dir, rel)));
    }
  }

  for (const f of RPM_FILES) {
    tasks.push(() => download(`${RPM}/${f}.glb`, path.join(ROOT, 'rpm', `${path.basename(f)}.glb`)));
  }
  for (const f of RPM_M_FILES) {
    tasks.push(() => download(`${RPM_M}/${f}.glb`, path.join(ROOT, 'rpm', 'm', `${path.basename(f)}.glb`)));
  }

  await pool(tasks);
  await fs.writeFile(marker, new Date().toISOString());
  console.log('[assets] done');
}

main().catch((e) => {
  console.error('\n[assets] failed:', e.message);
  process.exit(1);
});
