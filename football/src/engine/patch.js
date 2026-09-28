import * as THREE from 'three';

// Every opaque built-in material writes its view-space depth into alpha. The
// HDR target keeps it so fog, water refraction, SSR and god rays can read
// scene depth without a separate depth pass.
let patched = false;
export function patchShaderChunks() {
  if (patched) return;
  patched = true;
  THREE.ShaderChunk.opaque_fragment += /* glsl */ `
#ifdef OPAQUE
gl_FragColor.a = 1.0 / gl_FragCoord.w;
#endif
`;
}
