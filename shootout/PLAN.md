# Shootout improvement plan

Working list for the autonomous iteration Noam asked for on 2026-10-01: physics, how objects
interact, shooting accuracy, rendering efficiency. One commit per item; tests before every push.
Status: [ ] todo, [x] done, [~] partly.

Baseline (Tel Aviv, Medium, M-series laptop, 1 camera view): 1684 draw calls and 5.7 M triangles
per frame, 10.4 ms render, 1 GB JS heap. The city is 2.9 M triangles in 424 meshes, each spanning
the whole district, so frustum culling never skips any of it, and the shadow pass draws it again.

## Rendering efficiency
- [x] 1. Split the city meshes into spatial chunks (shared vertex buffers, one index range per
      cell, own bounding sphere) so the camera and the 48 m shadow frustum cull most of the city.
- [x] 2. Parked city cars as a few BatchedMesh draws (one per material) instead of ~9 meshes per
      car x 200 cars; a car being driven or knocked leaves the batch or updates its instance.
- [~] 3. Shadow casters: skip tiny/flat meshes (road marks, kerbs, glass), limit far skyline.
- [ ] 4. Per-frame allocations in hot paths (raycasts, colliders, character IK) -> scratch objects.
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

## Log
- Tel Aviv load (local, cached): ready in ~8 s; main-thread stages: decode 1.6 s, seam clip 1.0,
  cars 0.4, shot BVH 1.5, chunking 1.3.
- Tel Aviv frame, same view: 10.4 ms / 1684 calls (baseline) -> 6.0 ms / 1078 calls after
  chunking (256 m cells), car batching and no shadows from flat ground.
- CPU per step (Tel Aviv): parked cars 2.9 -> 0.1 ms (sleep when settled); rival characters
  skip lean / foot IK / gun probe / braid beyond 35 m.
