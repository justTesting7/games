# Handoff: working on the games repo and deploying to Cloudflare

For a new agent picking this repo up locally (`/Users/berman/git/games`). It covers what the repo is, how
to pull, push, test and deploy, how the Tel Aviv maps were built, and where things were left off.
Written 2026-09-30 from a long cloud session with Noam (noam.berman7@gmail.com).

## 1. What this repo is

GitHub: `justTesting7/games`. Everything goes straight to `main`; Noam pulls and deploys from there.

```
/                      games hub (index.html) + root package.json, wrangler.jsonc (deploys the Shootout worker)
shootout/              "Relic Isle" third-person shooter: Three.js, Vite, rivals driven by Jev (TypeSafe LLM)
  src/world/           maps, terrain, the Tel Aviv city-set loader, stadium, cars, rival spawn logic
  src/game/            player, rivals, weapons, cars, drone, session (multiplayer client)
  src/server/          Cloudflare Worker + Durable Object "GameRoom" (multiplayer)
  scripts/             build/bake tools and ~25 node test scripts (test-*.mjs)
  assets-src/<map>/    ORIGINAL map exports (set.glb, far.glb). Not deployed.
  public/assets/maps/<map>/   deployable built files: set.glb, far.glb, nav.json
football/              a separate game ("Jev Football"), own package.json + wrangler.jsonc
```

Live site: https://relic-isle.noam-berman7.workers.dev (hub) and `/shootout/` (the game).
The football worker is `jev-football`; it forwards `/api/jev` to the `relic-isle` worker, which holds `JEV_API_KEY`.

## 2. Day-to-day workflow

- Work on `main`, commit, `git push origin main`. Noam has OK'd direct pushes to `main` throughout.
- Always run the tests before pushing, and make the push conditional on them. One push once went out
  on top of a failing test because the commands were chained with `&&` after a loop that only echoed failures:
  ```
  fails=0; for t in shootout/scripts/test-*.mjs; do node $t >/dev/null 2>&1 || { echo FAIL $t; fails=1; }; done
  [ $fails = 0 ] && git push origin main
  ```
  All tests pass as of `470427c`. Some tests grep the source for an exact line (for example `test-spectate`,
  `test-cars`); if you change behaviour on purpose, update the check to the new intent rather than deleting it.
- Build check: `npx vite build --config shootout/vite.config.js`. No built file may be over 25 MB (see section 4).

## 3. Running and deploying (Cloudflare)

Prerequisites: Node 22+, `npm ci` at the repo root, network access to `api.polyhaven.com`,
`dl.polyhaven.org` and `raw.githubusercontent.com`.

| Command (repo root)                    | What it does |
| -------------------------------------- | ------------ |
| `npm run dev`                          | Vite dev server, single player only. The first run downloads about 100 MB of vendor assets into `shootout/public/assets/vendor` (gitignored). Put `JEV_API_KEY=...` in `.env` so rivals get Jev decisions (the dev proxy adds the key server-side). Without it they use a local heuristic. |
| `npm run build`                        | `fetch-assets`, then `rm -rf dist`, Vite build, hub copy into `dist/`. |
| `npm run cf:dev`                       | Builds and runs the real Worker plus Durable Object on `:8787`. Use this to test multiplayer (`?mode=multi`, `?room=code`). |
| `npm run cf:deploy`                    | Builds and runs `wrangler deploy`. This is the production deploy. |

- First time on a machine: `npx wrangler login` (Noam's Cloudflare login is noam.berman7@gmail.com), then `npm run cf:deploy`.
- Optional secret for the rivals: `npx wrangler secret put JEV_API_KEY`.
- Root `wrangler.jsonc`: worker `relic-isle`, entry `shootout/src/server/index.js`, assets `./dist`, Durable Object
  binding `ROOM` with class `GameRoom`, migration `v1` (SQLite). `/ws`, `/ws/*` and `/api/*` run the Worker first.
- Football: `cd football && npm ci && npm run cf:deploy` (worker `jev-football`).
- After a deploy, hard-reload the browser (Cmd+Shift+R). Noam tests on the live URL.
- Multiplayer needs the Worker deployed: `room.js` has a whitelist of map ids, and a stale deploy rejects new maps.
- Pitfall from earlier: Noam once deployed a build that lacked the new commits (he hadn't `git pull`ed).
  Check `git log -1` before `cf:deploy`.

A Cloudflare skills/MCP plugin was installed in the cloud session (`claude plugin marketplace add cloudflare/skills`,
`claude plugin install cloudflare@cloudflare`, then `/reload-plugins`). Do the same locally if you want the Cloudflare
docs/skills. That sandbox blocked `dash.cloudflare.com`, so the cloud agent could never log in or deploy; a local agent can.

## 4. The Tel Aviv maps (the main work of this session)

Three "city set" maps, exported from Noam's generator (`asset.generator` = `cityset set` / `cityset far`):
**Dizengoff Center** (`dizengoff`, folder `dizengoff-center`), **Dizengoff Square** (`square`, `dizengoff-square`),
**Bloomfield** (`bloomfield`). Each is a ~400 m district: one batched mesh per material
(so per-mesh colliders are useless), plus a `far.glb` skyline ring. They are declared in
`shootout/src/world/maps.js` with `cityFolder`, listed in `shootout/index.html`, and whitelisted in `shootout/src/server/room.js`.
All three work in single player and multiplayer.

### Adding or updating a map

1. Put the ORIGINAL exports in `shootout/assets-src/<folder>/set.glb` (+ `far.glb`). Not in `public/`: Cloudflare
   Workers reject assets over 25 MiB, and everything under `public/` is deployed.
2. `node shootout/scripts/build-city-map.mjs <folder>` shrinks textures to 1024 px, encodes KTX2 (ETC1S,
   `ktx2-encoder` + `sharp`) and meshopt-compresses (`meshoptimizer`) into `public/assets/maps/<folder>/`. It takes a few minutes.
3. `node shootout/scripts/bake-dizengoff-nav.mjs <folder>` writes `nav.json`: 1 m height grid, blocking rectangles,
   spawn, drivable cars, scooters, rival spawn spots, and (Bloomfield) the stadium profile and pitch. Re-run it
   whenever `set.glb` or the bake logic changes (run it for all three maps after editing the bake).
4. Add the `maps.js` entry (+ `<option>` in `index.html`, + id in `room.js`'s `MAPS`). See the README section "Adding a city-set map".

### Critical gotcha: never re-quantise the exports

The first optimised files (glTF-Transform v4.5.1, re-quantising positions ushort to short) silently collapsed the lower
half of every vertex coordinate, so floors, tree trunks and ground vanished. Triangle counts matched, which hid it.
`build-city-map.mjs` keeps positions exactly as exported and only compresses textures and buffers.
Do not run `gltf-transform optimize` or `quantize` on these. Originals are in `assets-src/`.

### How the runtime uses a city set (`shootout/src/world/`)

- `loadCity.js` loads set + far (GLTFLoader with meshopt + KTX2; transcoder in `public/assets/basis/`) and handles
  night-emissive materials and shop shutters by clock. `dizengoff.js` wraps it (`loadDizengoff(renderer, folder, {stadiumStart})`),
  builds the height function from `nav.json`, adds collision boxes, and exposes `takeCars`, `takeScooters`,
  `rivalSpots`, `slotSpawn`, `update(minutes, night)`. The camera far plane is raised to 9000 for the skyline.
- `cityCars.js`: the parked cars are baked into the shared meshes. The bake finds each street-level car, clusters
  it from the `carpaint` mesh, and orients it with the nose away from the windows. At load, `extractCityCars` cuts each car's
  triangles into its own group and removes them from the shared meshes, so the existing driving code (`game/cars.js`,
  E to enter) works on the map's own cars (~90-110 per map). `removeInBoxes` does the same for scooters.
- Scooters (Dizengoff Square only, 7 of them; none found in the other maps): original parts are removed and replaced by a
  procedural rideable model. `cars.js` now takes a per-vehicle spec (`SCOOTER`); the rider stays visible on the deck
  with the third-person camera.
- `rivalSpots.js`: baked open-spot lattice. Solo rivals start 70-140 m from the player and 55 m apart.
  `slotSpawns` gives deterministic, identical-on-every-client multiplayer starts about 110 m apart.
- Server: `room.js` car `FLEET` is 160 (the maps park about 115 cars and scooters, numbered identically on all clients).

### Bloomfield stadium (`stadium.js`, `pitchProps.js`)

The source had only a bare seat ramp, no floor, no walls and no way in. Runtime additions:
raise the front of the ramp about 1.7 m for headroom and make its underside visible; a hall ring under the stands between
an inner wall and an outer wall; four gates cut through the stadium's glass curtain wall (done by **discarding pixels in
a shader** inside door boxes, because rewriting the glass geometry changed its lighting); four tunnels onto the pitch;
strip lights; a floor. The bake measures the ramp in polar coordinates and stamps walkable/blocked nav cells to match
(`classifyStadium`, `inGateDoor`); the glass wall is made double-sided so it is visible from inside. Two goals and a
football come from the football game's code, placed from the pitch mesh. **Everyone starts inside the stadium, one per
stand** (solo and multiplayer): `stadiumSlotSpawns` (`mapDef.stadiumStart`).

## 5. Other changes made this session

- Merged four cursor PRs (Garden ad fix, Studio GLB map, `/shootout` restructure, football game) into `main`.
- Drone: the 92 m range limit is removed (`DRONE.maxRange = Infinity`).
- The old Blender "Dizengoff Square" map (`studio`, `custom.glb`) was replaced by the new city-set Square and deleted.
- `Colliders.resolveXZ` now queries the spatial hash instead of scanning every box (needed for thousands of boxes).

## 6. How changes were verified, and the limits

- The cloud sandbox could not download Poly Haven assets, so the full game never ran there. Visual checks used the
  map loader in a temporary test page under Vite (`npx vite --config shootout/vite.config.js --port 5199`) with Playwright
  Chromium on SwiftShader (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) and screenshots. Logic
  checks are the node `test-*.mjs` scripts. Gameplay feel, frame rate on real GPUs and mobile, and multiplayer with 2+
  real clients were NOT tested. That is the first thing to check locally.
- A useful trick: traverse `nav.json` blocking boxes plus a BFS to prove a walking route exists (this caught closed gates).

## 7. Open items and ideas

- **Drone shot-down feedback**: Noam said the cinematic (tumble, debris, static, "SHOT DOWN" overlay) used to look great and
  is now missing. The code (`drone.js` kill/updateDying, `fx.droneKill`, CSS `#dronesplit.shotdown`) is unchanged since it was
  added and ran correctly in a node simulation, so the cause is unknown. He later said "forget the drone". Worth a real
  playtest if he raises it again.
- **Dizengoff Center mall interior** (multi-level atrium like the photos he sent): shelved. It needs a level-aware height
  function (`terrain.heightAt(x, z, y)`, about ten call sites in `player.js` and `rival.js`) and a footprint for the mall
  (the low building between the two round towers; not yet confirmed).
- Ideas not done: kickable ball (reuse football ball physics), reactive goal nets, see-through glass, scooters in more maps.
- Older maps (Relic Isle, Dead District, Midtown, Madison Square Garden) keep their old spawn behaviour.
- `README.md` was updated for the city-set maps but is otherwise partly dated.

## 8. Working with Noam

He gives short, direct requests, tests on the live site after deploys, and sends screenshots. He prefers honest reports
(what was and was not checked), and small, pushed-to-`main` increments. He decides naming and design; ask when the
choice is his (for example which building is the mall).
