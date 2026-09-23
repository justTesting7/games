# Relic Isle

A third-person adventure on a photoreal island, running in the browser with Three.js and WebGL 2.
You play a dual-pistol adventurer, with animated running, jumping and aiming, in a free-for-all deathmatch against two rivals whose tactics are chosen by [Jev](https://docs.typesafe.ai/introduction) (TypeSafe System One).

## Running

```bash
npm install
cp .env.example .env   # then set JEV_API_KEY=...
npm run dev
```

The rivals ask Jev for decisions through the Vite dev server, which proxies `/api/jev` to
`https://api.typesafe.ai/v1/systemone` and adds `JEV_API_KEY` from `.env` on the server side. The key
never reaches the browser, and `.env` is gitignored. Without a key, or in a static `npm run build`,
the rivals fall back to a local heuristic, and the HUD shows "Jev offline".

The first `npm run dev` (or `npm run build`) downloads about 100 MB of third-party assets into
`public/assets/vendor`, which is gitignored. Open the URL Vite prints and click **Fight**.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Look |
| WASD | Move |
| Shift | Sprint |
| C | Toggle walk / jog |
| Space | Jump |
| Right mouse | Aim (over-the-shoulder, both pistols raised) |
| Left mouse | Fire (alternating pistols; also raises the guns from the hip) |
| R | Restart the round |
| T (hold) | Fast-forward the time of day |
| F3 | Performance stats |
| Esc | Menu (graphics quality, time of day, sensitivity, volume) |

## What's inside

- **Rendering:** an HDR pipeline on Three.js PBR materials. It has a physically based sky (Rayleigh and Mie scattering) that also lights the scene, sun shadows, height fog, and water with refraction, screen-space reflections and shoreline foam. Post-processing adds bloom, eye adaptation, god rays and ACES tone mapping.
- **World:** a 1.5 km island generated in a Web Worker. The terrain has levels of detail and blends sand, grass, forest floor and rock with height-based blending, triplanar-mapped cliffs and wet sand at the waterline. It also has instanced, wind-blown grass, procedural ez-tree forests, and Poly Haven rocks, boulders, ferns, shrubs and logs.
- **Character:** a Ready Player Me avatar dressed as an adventurer, with a teal tank top, cargo trousers, boots, a physics braid and thigh holsters. Motion-captured locomotion, strafing and jump clips are driven by the controller's speed. Procedural aiming bends the spine, extends the arms and turns the head.
- **Gameplay:** hitscan dual pistols with muzzle flashes, tracers, and impact dust, sparks and splashes that depend on the surface hit. Brass casings bounce on the ground. Barrels and crates react with rigid-body physics, and the targets fall when hit and reset. All sound is synthesized with WebAudio: gunshots with echo, ricochets, footsteps, wind and surf.

- **Rivals:** Vasquez, a reckless brawler, and Kade, a patient sharpshooter, spawn 18-28 m from you, and everyone fights until one is left. Each rival sends Jev a small, semantic state about once a second. The state covers its own health, nearby cover, and each enemy's visibility, range, health and aim. Jev answers two choice questions, one for the tactic (push, strafe, hold, flank, take cover, retreat or hunt) and one for the target. Low-confidence answers do not override a plan that is still valid. The code handles all movement, cover finding, line of sight and aiming. Aim error grows with range and movement and settles over time, and fire comes in bursts after a reaction delay. Getting shot triggers an immediate rethink.
- **Combat:** 100 health for everyone. Body shots do 9 damage and headshots 30. The HUD has hit reactions, falls on death, a damage vignette and direction indicator, bullet cracks for near misses, rival name tags that show their current Jev decision and confidence, and a kill feed.

## Asset licenses

- Poly Haven textures and models: CC0.
- ez-tree (bark and leaf textures): MIT.
- Ready Player Me avatar and animation library: use is allowed with Ready Player Me avatars, but redistribution is not. The files are therefore downloaded by `scripts/fetch-assets.mjs` instead of being committed.
