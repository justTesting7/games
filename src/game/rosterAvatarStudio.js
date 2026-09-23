import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// One off-screen WebGL context for roster chip thumbnails and hover previews.
export function createRosterAvatarStudio() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'roster-avatar-gl';
  document.body.append(renderer.domElement);

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

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  const clock = new THREE.Clock();
  let mixer = null;
  let raf = 0;
  let activeId = null;
  let loadingId = null;

  const bustCamera = (w, h) => {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    camera.position.set(0, 1.54, 1.05);
    camera.lookAt(0, 1.48, 0);
  };

  const mount = (source, t = 0) => {
    rig.clear();
    const model = cloneSkinned(source.model);
    model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    rig.add(model);
    mixer = new THREE.AnimationMixer(model);
    const idle = source.actions.idle.getClip();
    const act = mixer.clipAction(idle);
    act.setEffectiveWeight(1).play();
    act.time = t;
    mixer.update(0);
    rig.rotation.y = 0.1;
    rig.position.y = 0;
  };

  const renderFrame = (w, h, wobble = 0) => {
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    bustCamera(w, h);
    if (wobble) {
      const t = performance.now() * 0.001;
      rig.rotation.y = 0.1 + Math.sin(t * 1.2) * 0.14;
      rig.position.y = Math.sin(t * 1.85) * 0.018;
      mixer?.update(Math.min(0.05, clock.getDelta()));
    }
    renderer.render(scene, camera);
  };

  const paintThumb = (canvas, source) => {
    mount(source, 0.15);
    const w = canvas.clientWidth || 46;
    const h = canvas.clientHeight || 50;
    renderFrame(w * 2, h * 2, 0);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
  };

  const wrap = document.createElement('div');
  wrap.className = 'roster-preview hidden';
  const card = document.createElement('div');
  card.className = 'roster-preview-card';
  const hoverCanvas = document.createElement('canvas');
  const name = document.createElement('b');
  card.append(hoverCanvas, name);
  wrap.append(card);
  document.body.append(wrap);

  const place = (anchor) => {
    const r = anchor.getBoundingClientRect();
    wrap.style.left = `${r.left + r.width / 2}px`;
    wrap.style.top = `${r.top - 6}px`;
  };

  const tick = () => {
    if (wrap.classList.contains('hidden')) return;
    const w = 150, h = 185;
    hoverCanvas.width = w * 2;
    hoverCanvas.height = h * 2;
    renderFrame(w * 2, h * 2, 1);
    hoverCanvas.getContext('2d').drawImage(renderer.domElement, 0, 0, hoverCanvas.width, hoverCanvas.height);
    raf = requestAnimationFrame(tick);
  };

  const clearHover = () => {
    cancelAnimationFrame(raf);
    rig.clear();
    mixer = null;
  };

  return {
    paintThumb,
    async bindChipThumbs(chips, getCharacter, ensureCharacter) {
      for (const { entry, canvas } of chips) {
        let source = getCharacter(entry.id);
        if (!source) source = await ensureCharacter(entry.id);
        paintThumb(canvas, source);
      }
    },
    async showHover(entry, anchor, getCharacter, ensureCharacter) {
      activeId = entry.id;
      loadingId = entry.id;
      name.textContent = entry.name;
      card.style.setProperty('--c', entry.color);
      place(anchor);
      wrap.classList.remove('hidden');
      clearHover();
      clock.getDelta();

      let source = getCharacter(entry.id);
      if (!source) source = await ensureCharacter(entry.id);
      if (activeId !== entry.id || loadingId !== entry.id) return;

      mount(source, 0);
      tick();
    },
    hideHover() {
      activeId = null;
      loadingId = null;
      wrap.classList.add('hidden');
      clearHover();
    },
  };
}
