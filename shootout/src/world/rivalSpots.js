/**
 * Rival start positions: baked open spots, about 70-140 m from the player and 55 m from each other, so the
 * fight starts with a hunt instead of a scrum. Tightens the spacing only if the map runs short.
 */
export function pickRivalSpots(spots, origin, count, rand = Math.random) {
  const pool = spots.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let minPlayer = 70, maxPlayer = 140, minRival = 55;
  for (let attempt = 0; attempt < 8; attempt++, minPlayer *= 0.85, maxPlayer *= 1.3, minRival *= 0.85) {
    const out = [];
    for (const [x, z] of pool) {
      const dp = Math.hypot(x - origin.x, z - origin.z);
      if (dp < minPlayer || dp > maxPlayer) continue;
      if (out.some((o) => Math.hypot(x - o.x, z - o.z) < minRival)) continue;
      out.push({ x, z, yaw: Math.atan2(origin.x - x, origin.z - z) });
      if (out.length === count) return out;
    }
  }
  return null;
}

/**
 * Multiplayer start positions, the same on every client: the open spot nearest the middle
 * of the baked spots first, then each next one the nearest spot that is 110 m or more from all
 * chosen so far (the farthest one once the map is crowded). Players
 * take them by slot, so a full room starts spread across the whole map.
 */
export function slotSpawns(spots, count = 16) {
  if (!spots.length) return [];
  const sorted = spots.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cx = 0, cz = 0;
  for (const [x, z] of sorted) { cx += x; cz += z; }
  cx /= sorted.length; cz /= sorted.length;
  let first = sorted[0], bd = Infinity;
  for (const p of sorted) { const d = Math.hypot(p[0] - cx, p[1] - cz); if (d < bd) { bd = d; first = p; } }
  const chosen = [first];
  const minD = sorted.map((p) => Math.hypot(p[0] - first[0], p[1] - first[1]));
  const TARGET = 110; // far enough to start with a hunt, not so far that two players never meet
  while (chosen.length < Math.min(count, sorted.length)) {
    let bi = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (minD[i] >= TARGET && (bi < 0 || minD[i] < minD[bi])) bi = i; // the nearest spot that is far enough
    }
    if (bi < 0) { bi = 0; for (let i = 1; i < sorted.length; i++) if (minD[i] > minD[bi]) bi = i; } // crowded: farthest
    const p = sorted[bi];
    chosen.push(p);
    for (let i = 0; i < sorted.length; i++) minD[i] = Math.min(minD[i], Math.hypot(sorted[i][0] - p[0], sorted[i][1] - p[1]));
  }
  return chosen.map(([x, z]) => ({ x, z, yaw: Math.atan2(cx - x, cz - z) }));
}

/**
 * Solo starts anywhere in a big city: the player at a random open spot, each rival 70-300 m
 * from them and 55 m or more from the others (looser, a step at a time, when the spots
 * can't fit them all). The player faces roughly toward the rivals, each rival roughly
 * toward the player. spots: [[x, z], ...]. Returns [{ x, z, yaw }] (the player first) or null.
 */
export function scatterStarts(spots, count, rand = Math.random, { near = 70, far = 300, apart = 55 } = {}) {
  if (!spots?.length || spots.length < count) return null;
  const pick = () => spots[Math.floor(rand() * spots.length)];
  const [px, pz] = pick();
  const out = [{ x: px, z: pz }];
  for (let tries = 0; out.length < count && tries < 4000; tries++) {
    const k = Math.max(0.3, 1 - Math.floor(tries / 500) * 0.12);
    const [x, z] = pick();
    const d = Math.hypot(x - px, z - pz);
    if (d < near * k || d > far / k) continue;
    if (out.some((o) => Math.hypot(x - o.x, z - o.z) < apart * k)) continue;
    out.push({ x, z });
  }
  if (out.length < count) return null;
  let cx = 0, cz = 0;
  for (let i = 1; i < out.length; i++) { cx += out[i].x; cz += out[i].z; }
  if (out.length > 1) { cx /= out.length - 1; cz /= out.length - 1; } else { cx = px + 1; cz = pz; }
  out[0].yaw = Math.atan2(cx - px, cz - pz) + (rand() - 0.5) * 1.2;
  for (let i = 1; i < out.length; i++) out[i].yaw = Math.atan2(px - out[i].x, pz - out[i].z) + (rand() - 0.5) * 1.5;
  return out;
}
