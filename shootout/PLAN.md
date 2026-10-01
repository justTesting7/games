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
- [ ] 8. Rifle rounds travel (fast projectile with drop) so long shots lead the target a little.
- [x] 9. Recoil pattern and first-shot accuracy; crosshair shows the real spread.

## Physics and interactions
- [x] 10. Per-car footprint from the bake (hl/hw) for walking, driving and car-car collision.
- [x] 11. Grenades bounce off the real city geometry (shot BVH) instead of the walking grid.
- [x] 12. Rammed parked cars shove (mass-based impulse, settle), with network sync.
- [x] 13. Ragdoll deaths (verlet on the skeleton, collide with ground and walls).
- [x] 14. Characters step up kerbs smoothly (height smoothing) and feet plant on slopes (foot IK).
- [x] 15. Hit reactions by bone (stagger, limb flinch) and knockback from explosions.

- [x] 16. Sound occlusion: gunshots behind buildings are muffled (shot BVH ray to the listener).
- [~] 17. Shadows reach further: Medium 2048 over 64 m, High/Ultra 4096 over 90/110 m (was 40-58 m);
      a real second cascade would still help the far streets.
- [x] 19. Explosions shove nearby cars and scooters and shatter their windows.
- [ ] 18. Rival drivers: rivals take cars to close distance / flee.

## Phase 2 (2026-10-01): 3x more impressive, visually and physically
- [x] 20. Cars take damage: shots and crashes wear them down; smoke from the bonnet, then fire,
      then the car explodes (blast physics, glass, nearby cars thrown), burnt-out shell; synced.
- [x] 21. Driving physics: grip and slip per axle (bicycle model), handbrake drift (Space),
      weight transfer, speed-sensitive steering, tyre smoke and skid marks on the road.
- [ ] 22. Impact debris: chips that bounce off the ground for concrete/wood, sparks for metal,
      glass shards; dust puffs on ground hits.
- [ ] 23. Rifle rounds travel (~800 m/s) with drop and a visible tracer; long shots lead.
- [ ] 24. Rivals drive: a rival far from the fight takes a nearby car to close distance.
- [ ] 25. Temporal anti-aliasing (or SMAA) instead of FXAA for stable edges on foliage and rails.
- [ ] 26. Night: streetlights and car headlights as real light (a few nearest lights live).
- [ ] 27. Camera feel: speed FOV and shake on impacts, landing dip, damage vignette and
      directional hit indicator.
- [ ] 28. Dropped weapons: the dead fighter's guns fall and bounce instead of staying on the body.
- [ ] 29. Muzzle smoke and heat haze after sustained fire; explosion smoke columns that drift.
- [ ] 30. Footstep dust and splashes by surface; bodies and cars leave scuffs.

## Log
- Tel Aviv frame, same view: 10.4 ms / 1684 calls (baseline) -> 6.0 ms / 1078 calls after
  chunking (256 m cells), car batching and no shadows from flat ground.
- CPU per step (Tel Aviv): parked cars 2.9 -> 0.1 ms (sleep when settled); rival characters
  skip lean / foot IK / gun probe / braid beyond 35 m.
