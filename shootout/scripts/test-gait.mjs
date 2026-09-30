// Locomotion clips blend on one stride phase: gaitPhase must find how many strides
// each real clip loops and where its left-leg-forward landmark is, so that a synced
// walk + jog blend has both left thighs forward at the same moment.
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { gaitPhase } from '../src/game/character.js';

const V = new URL('../public/assets/vendor/rpm/', import.meta.url).pathname;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function clipOf(file) {
  const doc = await io.read(V + file);
  const anim = doc.getRoot().listAnimations()[0];
  const tracks = [];
  let duration = 0;
  for (const ch of anim.listChannels()) {
    if (ch.getTargetPath() !== 'rotation') continue;
    const s = ch.getSampler();
    const times = Array.from(s.getInput().getArray()), values = Array.from(s.getOutput().getArray());
    tracks.push(new THREE.QuaternionKeyframeTrack(`${ch.getTargetNode().getName()}.quaternion`, times, values));
    duration = Math.max(duration, times.at(-1));
  }
  return new THREE.AnimationClip(file, duration, tracks);
}
// left-minus-right thigh swing at a time, from the clip itself
function swing(clip, t) {
  const at = (name) => {
    const tr = clip.tracks.find((x) => x.name === name);
    const i = tr.createInterpolant(); const v = i.evaluate(t);
    return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().fromArray(v)).z;
  };
  return at('LeftUpLeg.quaternion') - at('RightUpLeg.quaternion');
}
const expect = {
  'F_Walk_003.glb': 3, 'F_Jog_001.glb': 1, 'F_Run_001.glb': 1, 'F_Walk_Backwards_001.glb': 3,
  'F_Jog_Strafe_Left_002.glb': 1, 'm/M_Walk_001.glb': 2, 'm/M_Jog_001.glb': 1, 'm/M_Jog_Backwards_001.glb': 1,
};
const phases = {};
for (const [file, cycles] of Object.entries(expect)) {
  const clip = await clipOf(file);
  const g = gaitPhase(clip);
  if (!g) throw new Error(`${file}: no gait phase`);
  if (g.cycles !== cycles) throw new Error(`${file}: ${g.cycles} strides, expected ${cycles}`);
  // at every stride's landmark the left thigh is well ahead of the right
  for (let k = 0; k < g.cycles; k++) {
    const t = (((k + g.offset) / g.cycles) % 1) * clip.duration;
    const s = swing(clip, t);
    if (s < 0.6) throw new Error(`${file}: stride ${k} landmark at ${t.toFixed(2)} s has swing ${s.toFixed(2)}`);
  }
  phases[file] = { clip, g };
}
// a walk and a jog placed on the same phase swing the same way at every point of the stride
for (const [a, b] of [['F_Walk_003.glb', 'F_Jog_001.glb'], ['m/M_Walk_001.glb', 'm/M_Jog_001.glb']]) {
  const A = phases[a], B = phases[b];
  let agree = 0;
  for (let i = 0; i < 20; i++) {
    const p = i / 20;
    const sa = swing(A.clip, (((p + A.g.offset) / A.g.cycles) % 1) * A.clip.duration);
    const sb = swing(B.clip, (((p + B.g.offset) / B.g.cycles) % 1) * B.clip.duration);
    if (Math.sign(sa) === Math.sign(sb) || Math.abs(sa) < 0.2 || Math.abs(sb) < 0.2) agree++;
  }
  if (agree < 17) throw new Error(`${a} and ${b} disagree on the stride at the same phase (${agree}/20)`);
}
console.log('ok gait phases');
