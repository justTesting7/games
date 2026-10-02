import * as THREE from 'three';

// Every opaque built-in material writes its view-space depth into alpha. The
// HDR target keeps it so fog, water refraction, SSR and god rays can read
// scene depth without a separate depth pass.
let patched = false;
export function patchShaderChunks() {
  if (patched) return;
  patched = true;
  // Far shadow cascade: the second directional light is a shadow caster only (no light of
  // its own, see Pipeline.farSun) whose coarse map covers the city out to a few hundred
  // metres. The sun's shadow fades from its own sharp near map to that one at the near
  // map's edge, so buildings keep shading the streets into the distance.
  const line = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (chunk.includes(line)) {
    THREE.ShaderChunk.lights_fragment_begin = chunk.replace(line, /* glsl */ `
#if UNROLLED_LOOP_INDEX == 0 && NUM_DIR_LIGHT_SHADOWS > 1
		if ( directLight.visible && receiveShadow ) {
			vec4 nc = vDirectionalShadowCoord[ i ];
			vec3 np = nc.xyz / nc.w;
			float edge = max( max( abs( np.x * 2.0 - 1.0 ), abs( np.y * 2.0 - 1.0 ) ), np.z > 1.0 ? 2.0 : 0.0 );
			float far = smoothstep( 0.82, 0.98, edge );
			float sNear = far < 1.0 ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, nc ) : 1.0;
			float sFar = far > 0.0 ? getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] ) : 1.0;
			float sh = mix( sNear, sFar, far );
#if NUM_DIR_LIGHT_SHADOWS > 2
			// the moving things, drawn every frame into their own small map (Pipeline.dynSun)
			sh = min( sh, getShadow( directionalShadowMap[ 2 ], directionalLightShadows[ 2 ].shadowMapSize, directionalLightShadows[ 2 ].shadowIntensity, directionalLightShadows[ 2 ].shadowBias, directionalLightShadows[ 2 ].shadowRadius, vDirectionalShadowCoord[ 2 ] ) );
#endif
			directLight.color *= sh;
		}
#else
		${line}
#endif`);
  }
  THREE.ShaderChunk.opaque_fragment += /* glsl */ `
#ifdef OPAQUE
gl_FragColor.a = 1.0 / gl_FragCoord.w;
#endif
`;
}
