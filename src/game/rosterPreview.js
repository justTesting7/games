import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Small WebGL preview shown above a "Play as" chip on hover.
export function createRosterPreview() {
  const wrap = document.createElement('div');
  wrap.className = 'roster-preview hidden';
  const card = document.createElement('div');
  card.className = 'roster-preview-card';
  const canvas = document.createElement('canvas');
  const name = document.createElement('b');
  card.append(canvas, name);
  wrap.append(card);
  document.body.append(wrap);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  const W = 150, H = 185;
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));

  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  scene.add(rig);
  scene.add(new THREE.HemisphereLight(0xfff4e8, 0x3a4550, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(1.2, 2.4, 2.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8c8ff, 0.35);
  fill.position.set(-1.5, 0.5, -1);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(32, W / H, 0.05, 20);
  camera.position.set(0, 1.42, 2.35);
  camera.lookAt(0, 1.28, 0);

  const clock = new THREE.Clock();
  let mixer = null;
  let raf = 0;
  let activeId = null;
  let loadingId = null;

  const place = (anchor) => {
    const r = anchor.getBoundingClientRect();
    wrap.style.left = `${r.left + r.width / 2}px`;
    wrap.style.top = `${r.top - 6}px`;
  };

  const tick = () => {
    if (wrap.classList.contains('hidden')) return;
    const t = performance.now() * 0.001;
    mixer?.update(Math.min(0.05, clock.getDelta()));
    rig.rotation.y = Math.sin(t * 1.2) * 0.14;
    rig.position.y = Math.sin(t * 1.85) * 0.018;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };

  const clearRig = () => {
    cancelAnimationFrame(raf);
    rig.clear();
    mixer = null;
  };

  return {
    async show(entry, anchor, getCharacter, ensureCharacter) {
      activeId = entry.id;
      loadingId = entry.id;
      name.textContent = entry.name;
      card.style.setProperty('--c', entry.color);
      place(anchor);
      wrap.classList.remove('hidden');
      clearRig();
      clock.getDelta();

      let source = getCharacter(entry.id);
      if (!source) source = await ensureCharacter(entry.id);
      if (activeId !== entry.id || loadingId !== entry.id) return;

      const model = cloneSkinned(source.model);
      model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      rig.add(model);
      mixer = new THREE.AnimationMixer(model);
      const idle = source.actions.idle.getClip();
      mixer.clipAction(idle).setEffectiveWeight(1).play();
      tick();
    },
    hide() {
      activeId = null;
      loadingId = null;
      wrap.classList.add('hidden');
      clearRig();
    },
  };
}
