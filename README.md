# Relic Isle

A third-person adventure on a photoreal island, running in the browser with Three.js and WebGL 2.
You explore as a dual-pistol adventurer, with animated running, jumping and aiming, plus targets and props to shoot.

## Running

```bash
npm install
npm run dev
```

The first `npm run dev` (or `npm run build`) downloads about 100 MB of third-party assets into
`public/assets/vendor`, which is gitignored. Open the URL Vite prints and click **Explore**.

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
| T (hold) | Fast-forward the time of day |
| F3 | Performance stats |
| Esc | Menu (graphics quality, time of day, sensitivity, volume) |

## What's inside

- **Rendering:** an HDR pipeline on Three.js PBR materials. It has a physically based sky (Rayleigh and Mie scattering) that also lights the scene, sun shadows, height fog, and water with refraction, screen-space reflections and shoreline foam. Post-processing adds bloom, eye adaptation, god rays and ACES tone mapping.
- **World:** a 1.5 km island generated in a Web Worker. The terrain has levels of detail and blends sand, grass, forest floor and rock with height-based blending, triplanar-mapped cliffs and wet sand at the waterline. It also has instanced, wind-blown grass, procedural ez-tree forests, and Poly Haven rocks, boulders, ferns, shrubs and logs.
- **Character:** a Ready Player Me avatar dressed as an adventurer, with a teal tank top, cargo trousers, boots, a physics braid and thigh holsters. Motion-captured locomotion, strafing and jump clips are driven by the controller's speed. Procedural aiming bends the spine, extends the arms and turns the head.
- **Gameplay:** hitscan dual pistols with muzzle flashes, tracers, and impact dust, sparks and splashes that depend on the surface hit. Brass casings bounce on the ground. Barrels and crates react with rigid-body physics, and the targets fall when hit and reset. All sound is synthesized with WebAudio: gunshots with echo, ricochets, footsteps, wind and surf.

## Asset licenses

- Poly Haven textures and models: CC0.
- ez-tree (bark and leaf textures): MIT.
- Ready Player Me avatar and animation library: use is allowed with Ready Player Me avatars, but redistribution is not. The files are therefore downloaded by `scripts/fetch-assets.mjs` instead of being committed.
