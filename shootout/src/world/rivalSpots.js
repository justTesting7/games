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
