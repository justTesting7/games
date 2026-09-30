// Compiles every post-process shader in engine/shaders.js as GLSL ES 3.00, the way
// three.js wraps a ShaderMaterial on WebGL2. Needs glslangValidator (brew install
// glslang); skipped when it is not installed.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S0 from '../src/engine/shaders.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
const S = { ...S0, fxaaFrag: FXAAShader.fragmentShader };

try { execFileSync('glslangValidator', ['--version'], { stdio: 'ignore' }); } catch {
  console.log('skip: glslangValidator not installed');
  process.exit(0);
}
const DEFINES = { aoFrag: '#define AO_SAMPLES 8\n' };
const fragHead = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define varying in
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define texture2D texture
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
`;
const vertHead = `#version 300 es
precision highp float;
precision highp int;
#define attribute in
#define varying out
#define texture2D texture
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix, viewMatrix;
uniform vec3 cameraPosition;
in vec3 position;
in vec3 normal;
in vec2 uv;
`;
const dir = mkdtempSync(join(tmpdir(), 'shaders-'));
let n = 0;
const fails = [];
for (const [name, src] of Object.entries(S)) {
  if (typeof src !== 'string') continue;
  const isFrag = /Frag$/.test(name), isVert = /Vert$/.test(name);
  if (!isFrag && !isVert) continue;
  const file = join(dir, `${name}.${isFrag ? 'frag' : 'vert'}`);
  writeFileSync(file, (isFrag ? fragHead : vertHead) + (DEFINES[name] || '') + src);
  try {
    execFileSync('glslangValidator', [file], { encoding: 'utf8' });
    n++;
  } catch (e) {
    fails.push(`${name}:\n${(e.stdout || e.message).split('\n').filter((l) => /ERROR/.test(l)).slice(0, 6).join('\n')}`);
  }
}
if (fails.length) throw new Error(`shaders failed to compile:\n${fails.join('\n')}`);
console.log('ok', n, 'shaders compile');
