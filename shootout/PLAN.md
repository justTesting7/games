# Shootout improvement plan

Working list for the autonomous iteration Noam asked for on 2026-10-01: physics, how objects
interact, shooting accuracy, rendering efficiency. One commit per item; tests before every push.
Status: [ ] todo, [x] done, [~] partly, [-] dropped or deferred (reason given).

Baseline (Tel Aviv, Medium, M-series laptop, 1 camera view): 1684 draw calls and 5.7 M triangles
per frame, 10.4 ms render, 1 GB JS heap. The city is 2.9 M triangles in 424 meshes, each spanning
the whole district, so frustum culling never skips any of it, and the shadow pass draws it again.

## Rendering efficiency
- [x] 1. Split the city meshes into spatial chunks (shared vertex buffers, one index range per
      cell, own bounding sphere) so the camera and the 48 m shadow frustum cull most of the city.
- [x] 2. Parked city cars as a few BatchedMesh draws (one per material) instead of ~9 meshes per
      car x 200 cars; a car being driven or knocked leaves the batch or updates its instance.
- [~] 3. Shadow casters: skip tiny/flat meshes (road marks, kerbs, glass), limit far skyline.
- [~] 4. Per-frame allocations in hot paths (raycasts, colliders, character IK) -> scratch objects.
- [x] 5. Distance fade / LOD for rivals' expensive per-frame work (IK, braid) when far away.

## Shooting accuracy
- [x] 6. Hit boxes per bone (capsules for head, chest, pelvis, upper/lower arms and legs) instead
      of one body cylinder + head sphere: arms held out, crouching and seated targets hit where
      they are; limb shots do less damage.
- [x] 7. Bullet holes / impact decals on walls and cars (pooled, fading).
- [~] 8. Rifle rounds drop (ballistic arc, see 23); travel time not simulated.
- [x] 9. Recoil pattern and first-shot accuracy; crosshair shows the real spread.

## Physics and interactions
- [x] 10. Per-car footprint from the bake (hl/hw) for walking, driving and car-car collision.
- [x] 11. Grenades bounce off the real city geometry (shot BVH) instead of the walking grid.
- [x] 12. Rammed parked cars shove (mass-based impulse, settle), with network sync.
- [x] 13. Ragdoll deaths (verlet on the skeleton, collide with ground and walls).
- [x] 14. Characters step up kerbs smoothly (height smoothing) and feet plant on slopes (foot IK).
- [x] 15. Hit reactions by bone (stagger, limb flinch) and knockback from explosions.

- [x] 16. Sound occlusion: gunshots behind buildings are muffled (shot BVH ray to the listener).
- [~] 17. (CSM judged too invasive: it rewrites the global light chunks and every material.)
      Shadows reach further: Medium 2048 over 64 m, High/Ultra 4096 over 90/110 m (was 40-58 m);
      a real second cascade would still help the far streets.
- [x] 19. Explosions shove nearby cars and scooters and shatter their windows.
- [~] 18. Rival drivers: see 24.

## Phase 2 (2026-10-01): 3x more impressive, visually and physically
- [x] 20. Cars take damage: shots and crashes wear them down; smoke from the bonnet, then fire,
      then the car explodes (blast physics, glass, nearby cars thrown), burnt-out shell; synced.
- [x] 21. Driving physics: grip and slip per axle (bicycle model), handbrake drift (Space),
      weight transfer, speed-sensitive steering, tyre smoke and skid marks on the road.
- [x] 22. Impact debris: chips that bounce off the ground for concrete/wood, sparks for metal,
      glass shards; dust puffs on ground hits.
- [~] 23. Rifle rounds follow a ballistic arc at 820 m/s (0.65 m drop at 300 m); hit resolved at once.
- [~] 24. Rivals drive: a rival far from its target takes an unboxed car within 20 m and drives at
      it with look-ahead avoidance, out and fighting within ~32 m. No road pathfinding yet.
- [x] 25. SMAA on High/Ultra (FXAA stays on Medium).
- [x] 26. Night: streetlamp light pools and headlight beams (additive, no real lights: no shader cost by day).
- [x] 27. Camera feel: speed FOV and shake on impacts, landing dip, damage vignette and
      directional hit indicator.
- [x] 28. Dropped weapons: the dead fighter's guns fall and bounce instead of staying on the body.
- [x] 29. Muzzle smoke and heat haze after sustained fire; explosion smoke columns that drift. (Columns + scorch done; muzzle puffs existed; haze not done.)
- [x] 30. Footstep dust at a run and splashes in the rain (scuffs not done).
- [x] 31. Explosion fireball: noise-displaced HDR sphere that swells, cools to soot and rises.
- [x] 32. Shop and office windows shatter when shot (city glass panes cut out of the mesh + shards).
- [x] 33. Weather: rain with wet, reflective streets and puddle splashes (optional per map).
- [x] 34. Engine sound: synthesised, RPM through four gears, throttle-opened filter; nearest other
      car under power gets its own distance-attenuated voice; scooters whine.
- [x] 35. Tracers that read: brighter, longer streaks for rifles and every third pistol round.
- [x] 36. Bullet penetration: rifle through wood, glass and car bodies (60% damage per layer, up
      to two), pistols through glass; concrete and stone stop everything.
- [x] 37. Every blast shakes the camera by distance and sends a dust shockwave along the ground.
- [x] 38. Getting in and out of a car glides the body between the door and the seat.
- [x] 39. Vault low walls, railings and bollard lines: jump at one 0.4-1.35 m high (measured on
      the real geometry) carries you up and over to clear ground beyond.
- [x] 40. Slide: crouch at a sprint to slide low on your momentum for ~0.8 s.
- [x] 41. Bodies stay physical: rounds hit corpses (the ragdoll jerks, blood, no damage) and blasts
      throw them.
- [x] 42. Speed blur at the wheel: reprojection motion blur from the depth in alpha, ramping in
      from ~8 m/s, off on foot so aiming stays crisp.
- [x] 43. Blasts blow in the shop and office windows around them (BVH shapecast for glass).
- [x] 44. Rain: wet streets mirror the city (screen-space reflection marched through the depth
      in alpha, Fresnel-weighted, edge-faded; Medium and up).

## Phase 3 (2026-10-01, cont.): push further
- [x] 45. Ground bounce: the sky env's lower half is the sunlit street's warm bounce, not more
      blue sky, so shaded walls and car flanks stop looking teal.
- [x] 46. Night exposure: auto exposure adapts night back to overcast day; cap the adaptation so
      night reads as night and the lamp pools and headlights matter.
- [x] 47. Brake and tail lights glow (HDR, bloom) on driven cars; reversing lights.
- [x] 48. Shell casings: brass ejected from the gun, tumbling and bouncing (existed); now they tink.
- [x] 49. Blood: spatter decals on the walls and ground behind a hit, pools under bodies (existed).
- [x] 50. Rain puddles: noise-masked mirror patches in the wet streets with raindrop ripples.
- [x] 51. Crash dents: cars deform around the point of impact (vertex dents on the car's own mesh).
- [-] 52. Knock-over props: dropped. The city's bollards are steel posts that should stop a car (Noam
      asked for cars not to pass through poles); the props are baked into per-material meshes.
- [-] 53. Bullet flight time: deferred. Hits resolve at the shot and the room is told then; delaying
      them needs the multiplayer shot report reworked. Rounds already drop over range.
- [x] 54. Heat haze over fires and burning wrecks (screen-space refraction).
- [x] 55. Ragdolls collide with walls and cars, not just the ground.
- [x] 56. Rivals drive along roads (nav graph from the street mesh) instead of straight at targets.

- [x] 57. Flash lighting: muzzle flashes and blasts (existed), now car and blast fires flicker on the street around them
      (a small pool of real point lights kept in the scene at zero, so no shader recompiles).
- [x] 58. Storms: lightning flashes the sky and the city in heavy rain, thunder rolls in after.
- [x] 59. Lamp light cones: at night (and in rain) a soft visible cone under each streetlamp.
- [x] 60. Wet fighters: clothes and skin darken and gloss in the rain.

- [x] 61. Blast shockwave: a ring of refraction races out from every explosion.
- [x] 62. Pigeons: flocks peck about the squares by day and burst into the air at gunfire, blasts
      or anyone running through them, wheel round and settle again.
- [x] 63. Rain on the windscreen in the cockpit view (cars with an interior): drops bead and run, a wiper sweeps them.

- [x] 64. Shots mark cars: holes in the bodywork that ride with the car; the laminated windscreen
      stars with cracks for three rounds and only gives way on the fourth (side and rear windows
      still burst at once). Fix: car glass no longer breaks behind a wall the round already hit.

- [x] 65. The last kill of a solo round plays out in slow motion (30%), easing back to speed.

- [x] 66. Lens flare: soft coloured ghosts and a faint ring when the sun is in clear view.

- [x] 67. Wounds show: blood soaks into the clothes where a round went in (and out, for a rifle), on the bone it hit.

- [x] 68. Wind in the city trees: leaves and fronds sway on slow gusts and flutter, harder in a storm.

- [x] 69. Tyre spray: on wet roads every moving car throws mist and droplets off its rear wheels.

- [x] 70. Wet grip: in the rain cars brake longer (-35% brake force) and slide wider in turns (-45% lateral hold).

- [x] 71. At night the nearest cars driven by rivals and other players light the road ahead too (up to four sets of beams).

## Phase 4 (2026-10-02): twice as far again
Ordered by how much they lift the whole game; one commit each.
- [x] 72. Temporal anti-aliasing: jittered frames reprojected through the depth and blended with
      clamped history, then sharpened; stable edges, wires, railings and foliage instead of
      crawling pixels (replaces FXAA/SMAA where it runs).
- [x] 73. Far shadow cascade: a second, coarse shadow map over ~600 m refreshed every few frames,
      sampled past the near map, so buildings shade the streets into the distance.
- [x] 74. City surfaces with life: per-building tint, damp blotches, rain streaks down the walls (no ground band: the
      ground height is not known per pixel; AO covers it), varied roughness and a fine plaster bump.
- [x] 75. Ambient traffic: a few cars drive the streets on planned routes (lights at night,
      spray in the rain), stop for people in the road and floor it away from gunfire.
- [x] 76. Street acoustics: the reverb follows the place (narrow street, open square, inside),
      measured by rays around the listener; distant shots echo off the buildings.
- [x] 77. Depth of field while aiming down the scope: what is far from the focus softens.
- [ ] 78. Car explosions tear it apart: bonnet, doors and boot fly off as tumbling panels.
- [ ] 79. Gun feel: weapon sway with movement, procedural recoil that kicks and settles, a
      camera punch per shot, and a breathing drift on the scope.
- [ ] 80. Film touches: faint grain and chromatic fringing at the screen edges.
- [ ] 81. Shop windows and glass facades reflect the street (screen-space, always on).

- [x] 82. Jevs walk like people: routes around walls on a 1 m walking grid when the way ahead is blocked, a human turn rate, slowing into corners, no random hops when held up.

## Log
- Tel Aviv load (local, cached): ready in ~8 s; main-thread stages: decode 1.6 s, seam clip 1.0,
  cars 0.4, shot BVH 1.5, chunking 1.3.
- Tel Aviv frame, same view: 10.4 ms / 1684 calls (baseline) -> 6.0 ms / 1078 calls after
  chunking (256 m cells), car batching and no shadows from flat ground.
- CPU per step (Tel Aviv): parked cars 2.9 -> 0.1 ms (sleep when settled); rival characters
  skip lean / foot IK / gun probe / braid beyond 35 m.
- 2026-10-01 (phase 3): Lab frame at 1024x768 Medium: 2.7 ms clear, 3.5 ms in rain (puddles, SSR),
  3.8 ms with four haze sources and a shockwave. Night exposure: night now renders at about a
  third of day brightness (was ~2/3), with lamps, cones, lit windows and car lamps carrying it.
- Verified in the Lab by render capture: car lamps, dents, heat haze, fire light, lamp cones,
  pigeons, windscreen rain, lens flare, car bullet holes / windscreen cracks, wound stains,
  ragdoll on a car roof (trace). Ground bounce, night exposure, puddles and lightning were
  checked on Dizengoff Square before the Lab-only rule was remembered; the tree wind only in
  the Lab (on a stand-in mesh): worth a look on the real maps.
