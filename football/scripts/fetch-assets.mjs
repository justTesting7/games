// Downloads third-party assets into public/assets/vendor (not committed).
//  - Poly Haven textures: CC0 (https://polyhaven.com/license)
//  - Ready Player Me avatar + animations: Ready Player Me Animation Library
//    license, which permits use with Ready Player Me avatars but not
//    redistribution. That is why these files are fetched instead of committed.
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'assets', 'vendor');

const PH_TEXTURES = {
  grass: 'leafy_grass',
  concrete: 'concrete_floor_02',
  roof: 'box_profile_metal_sheet',
};
const RPM = 'https://raw.githubusercontent.com/readyplayerme/animation-library/master/masculine/glb';
const RPM_FILES = [
  'Masculine_TPose',
  'idle/M_Standing_Idle_001',
  'idle/M_Standing_Idle_Variations_002',
  'locomotion/M_Walk_001',
  'locomotion/M_Walk_Backwards_001',
  'locomotion/M_Walk_Strafe_Left_002',
  'locomotion/M_Walk_Strafe_Right_002',
  'locomotion/M_Jog_001',
  'locomotion/M_Jog_Backwards_001',
  'locomotion/M_Jog_Strafe_Left_001',
  'locomotion/M_Jog_Strafe_Right_001',
  'locomotion/M_Run_001',
  'locomotion/M_Run_Backwards_002',
  'locomotion/M_Run_Strafe_Left_002',
  'locomotion/M_Run_Strafe_Right_002',
  'locomotion/M_Jog_Jump_002',
  'dance/M_Dances_001',
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
  const res = await fetch(url, { headers: { 'User-Agent': 'jev-football-asset-fetch' } });
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
  const marker = path.join(ROOT, '.complete-v1');
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

  for (const f of RPM_FILES) {
    tasks.push(() => download(`${RPM}/${f}.glb`, path.join(ROOT, 'rpm', `${path.basename(f)}.glb`)));
  }

  await pool(tasks);
  await fs.writeFile(marker, new Date().toISOString());
  console.log('[assets] done');
}

main().catch((e) => {
  console.error('\n[assets] failed:', e.message);
  process.exit(1);
});
