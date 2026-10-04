# Add King George (and maybe Rothschild) to Tel Aviv

State: raw exports sit untracked at `public/assets/maps/king george/` (set 134 MB, far 1 MB) and `public/assets/maps/rotschild/` (set 150 MB). Cloudflare rejects files over 25 MiB, so they must not be deployed raw.
Do the same as for Habima/Frishman (commits 1653e7f, 32e92bc). Commit to main each step, restart the dev server (`.claude/launch.json`).

1. **(Done) raw files** are now in `assets-src/king-george/` and `assets-src/rothschild/` on this Mac only: git-ignored, because GitHub rejects files over 100 MB (the other districts' raw exports are smaller). Originals removed from `public/assets/maps/`. Step 1 was: rename + move raw: folder names without spaces/typos: `git mv`-style move to `assets-src/king-george/{set,far}.glb` (and `assets-src/rothschild/` if wanted). Delete the originals from `public/assets/maps/` so the raw files never deploy. Remove `.DS_Store`.
2. **Build**: `node shootout/scripts/build-city-map.mjs king-george` (KTX2 + meshopt, textures <=1024). Output `public/assets/maps/king-george/`. Check `set.glb` < 25 MiB; if more, the script/`files: ['set.glb','set-2.glb']` chunking in `cityParts.js` (see sderot-hen) is needed.
3. **Align**: `node shootout/scripts/align-city.mjs dizengoff-square king-george` gives the `offset` [x,y,z] (far skylines are identical, only shifted).
4. **Register** in `src/world/cityParts.js` `CITY_PARTS['tel-aviv'].sets`: `{ folder: 'king-george', offset: [...], half: <half of its ground tile>, drop: <small, as frishman 0.02> }`. Seam check: `node shootout/scripts/ground-seams.mjs`.
5. **Nav**: `node shootout/scripts/bake-dizengoff-nav.mjs tel-aviv` (re-bake the stitched map: boxes, cars, spots, rides). It keeps up to 200 drivable cars and the 3 nearest each plaza.
6. **Verify**: `?play=telaviv&calm` in the Lab/pane: streets line up, no height step at the seam, cars/colours ok, fps (F3). Run `scripts/test-city-parts.mjs`. Close test tabs after (they steal the user's fps).
7. **Deploy**: `npm run cf:deploy` from `/Users/berman/git/games`; the output must end with "Deployed" and a Version ID.

Gotchas: do not browse the real maps long (user playtests them); fleet cars/KTX2 use BC on desktop; city texture arrays are off on Apple GPUs (`textureArrays.js`).
