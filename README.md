# VoxelCraft

A playable Minecraft-style voxel sandbox that runs in the browser, rendered
with a custom physically based HDR shader pipeline built on Three.js/WebGL 2.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Space | Jump / swim up (fly up when flying) |
| Shift | Sprint (descend when flying) |
| F or double-tap Space | Toggle flying |
| Left / right click | Break / place block |
| Middle click | Pick block |
| 1-9, mouse wheel | Select hotbar slot |
| T (hold) | Fast-forward time |
| F1 / F3 | Hide HUD / toggle debug info |

## Rendering features

- **Physically based sky**: Rayleigh + Mie single-scattering atmosphere baked
  every frame into an HDR texture that also drives fog, ambient light and
  reflections; sun and moon discs, twinkling stars, and self-shadowed clouds
  with forward scattering (silver lining).
- **Dynamic day/night cycle**: sun colour comes from the same atmosphere
  model (warm sunrises and sunsets), with moonlight at night.
- **Soft shadows**: texel-snapped sun shadow map with rotated Poisson PCF and
  normal-offset biasing; foliage casts alpha-tested shadows.
- **Materials**: generated per-texture normal and smoothness maps,
  energy-conserving Blinn-Phong specular with Fresnel, sky reflections,
  translucency for leaves and plants, emissive glowstone.
- **Water**: procedural wave normals, screen-space reflections with a sky
  fallback, depth-based refraction and absorption, a sun glint, underwater
  caustics, total internal reflection and an underwater fog/distortion pass.
- **Ambient light**: Minecraft-style per-vertex ambient occlusion plus a
  sky-visibility term that darkens caves and overhangs.
- **Wind**: swaying leaves, grass and flowers (the shadows sway too).
- **Post-processing**: physically based bloom (13-tap downsample / tent
  upsample mip chain), screen-space god rays, automatic eye adaptation, ACES
  filmic tonemapping, colour grading, vignette and dithering. MSAA on High and
  Ultra.

## World

Infinite procedurally generated terrain streamed in Web Workers: oceans,
beaches, plains, forests (oak and birch), deserts with cacti, mountains and
snowy peaks, spaghetti and cheese caves, and ores.
