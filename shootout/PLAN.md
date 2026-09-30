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
- [ ] 5. Distance fade / LOD for rivals' expensive per-frame work (IK, braid) when far away.

## Shooting accuracy
- [x] 6. Hit boxes per bone (capsules for head, chest, pelvis, upper/lower arms and legs) instead
      of one body cylinder + head sphere: arms held out, crouching and seated targets hit where
      they are; limb shots do less damage.
- [ ] 7. Bullet holes / impact decals on walls and cars (pooled, fading).
- [ ] 8. Rifle rounds travel (fast projectile with drop) so long shots lead the target a little.
- [ ] 9. Recoil pattern and first-shot accuracy; crosshair shows the real spread.

## Physics and interactions
- [x] 10. Per-car footprint from the bake (hl/hw) for walking, driving and car-car collision.
- [x] 11. Grenades bounce off the real city geometry (shot BVH) instead of the walking grid.
- [ ] 12. Rammed parked cars shove (mass-based impulse, settle), with network sync.
- [ ] 13. Ragdoll deaths (verlet on the skeleton, collide with ground and walls).
- [ ] 14. Characters step up kerbs smoothly (height smoothing) and feet plant on slopes (foot IK).
- [ ] 15. Hit reactions by bone (stagger, limb flinch) and knockback from explosions.

## Log
- Tel Aviv frame, same view: 10.4 ms / 1684 calls (baseline) -> 6.0 ms / 1078 calls after
  chunking (256 m cells), car batching and no shadows from flat ground.
