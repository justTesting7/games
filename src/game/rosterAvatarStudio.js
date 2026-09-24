import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// One off-screen WebGL context for roster chip thumbnails and hover previews.
export function createRosterAvatarStudio() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.className = 'roster-avatar-gl';
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  scene.add(rig);
  scene.add(new THREE.HemisphereLight(0xe8eef4, 0x3a4550, 0.55));
  const key = new THREE.DirectionalLight(0xfff8f0, 0.48);
  key.position.set(0.8, 2.2, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8c8ff, 0.18);
  fill.position.set(-1.2, 0.8, -0.8);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 20);
  const clock = new THREE.Clock();
  let mixer = null;
  let raf = 0;
  let activeId = null;
  let loadingId = null;

  let framed = null;

  const frameModel = (model, w, h) => {
    model.updateMatrixWorld(true);
    const head = model.getObjectByName('Head');
    const neck = model.getObjectByName('Neck');
    const hp = new THREE.Vector3();
    const np = new THREE.Vector3();
    let top, bottom, cx, cz;
    if (head) {
      head.getWorldPosition(hp);
      if (neck) neck.getWorldPosition(np);
      else np.copy(hp).add(new THREE.Vector3(0, -0.12, 0));
      top = hp.y + 0.17;
      bottom = np.y - 0.1;
      cx = hp.x;
      cz = hp.z;
    } else {
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      cx = (box.min.x + box.max.x) * 0.5;
      cz = (box.min.z + box.max.z) * 0.5;
      top = box.max.y;
      bottom = box.min.y + size.y * 0.55;
    }
    const midY = (top + bottom) * 0.5;
    const spanY = top - bottom;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const pad = 1.18;
    const dist = Math.max(
      (spanY * pad * 0.5) / Math.tan(vFov / 2),
      (spanY * pad * 0.45) / Math.tan(hFov / 2),
    );
    camera.position.set(cx, midY, cz + dist);
    camera.lookAt(cx, midY, cz);
  };

  const mount = (source, t = 0) => {
    rig.clear();
    framed = null;
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
    framed = model;
  };

  const renderFrame = (w, h, wobble = 0) => {
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    if (framed) frameModel(framed, w, h);
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
