export const isTouchDevice = () =>
  !!window.matchMedia?.('(pointer: coarse)').matches
  || !!window.matchMedia?.('(hover: none) and (max-width: 900px)').matches;

// On-screen stick, look pad, and thumbs for phones. Keyboard/mouse still work.
export function setupTouch(input, { onLook, onMenu, onPlayChange }) {
  const root = document.getElementById('touch');
  if (!root || !isTouchDevice()) {
    return { active: false, show() {}, hide() {}, setDrone() {} };
  }
  document.body.classList.add('touch');
  const stick = $('stick');
  const knob = stick.querySelector('.stick-knob');
  const lookEl = $('touch-look');
  const fire = $('touch-fire');
  const jump = $('touch-jump');
  const aim = $('touch-aim');
  const reload = $('touch-reload');
  const crouch = $('touch-crouch');
  const up = $('touch-up');
  const menuBtn = $('touch-menu');

  const hold = new Map();
  let lookId = 0;
  let lastLook = null;
  let stickId = 0;

  const setStick = (x, y) => {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const max = r.width * 0.34;
    let dx = x - cx;
    let dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / max);
    dx = (dx / len) * k;
    dy = (dy / len) * k;
    input.moveX = dx;
    input.moveY = -dy;
    input.sprint = k > 0.78;
    knob.style.transform = `translate(${dx * max}px, ${dy * max}px)`;
  };

  const clearStick = () => {
    stickId = 0;
    input.moveX = 0;
    input.moveY = 0;
    input.sprint = false;
    knob.style.transform = '';
  };

  const bindHold = (el, down, up) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      hold.set(e.pointerId, el);
      el.classList.add('on');
      down(e);
    });
    const end = (e) => {
      if (hold.get(e.pointerId) !== el) return;
      hold.delete(e.pointerId);
      el.classList.remove('on');
      up?.(e);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  bindHold(fire, () => {
    input.fire = true;
    input.firePressed = true;
  }, () => {
    input.fire = false;
    input.fireReleased = true;
  });
  bindHold(jump, () => {
    input.jump = true;
    input.climb = true;
  }, () => {
    input.jump = false;
    input.climb = false;
  });
  bindHold(aim, () => { input.aim = true; }, () => { input.aim = false; });
  bindHold(reload, () => { input.reload = true; }, () => {});
  bindHold(crouch, () => { input.toggleCrouch = true; input.crouch = !input.crouch; }, () => {});
  bindHold(up, () => { input.climb = true; }, () => { input.climb = false; });

  menuBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onMenu?.();
  });

  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    stick.setPointerCapture(e.pointerId);
    stickId = e.pointerId;
    setStick(e.clientX, e.clientY);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    setStick(e.clientX, e.clientY);
  });
  const endStick = (e) => {
    if (e.pointerId === stickId) clearStick();
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  lookEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.target.closest('#stick')) return;
    e.preventDefault();
    lookEl.setPointerCapture(e.pointerId);
    lookId = e.pointerId;
    lastLook = { x: e.clientX, y: e.clientY };
  });
  lookEl.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId || !lastLook) return;
    const dx = e.clientX - lastLook.x;
    const dy = e.clientY - lastLook.y;
    lastLook = { x: e.clientX, y: e.clientY };
    onLook?.(dx, dy);
  });
  const endLook = (e) => {
    if (e.pointerId !== lookId) return;
    lookId = 0;
    lastLook = null;
  };
  lookEl.addEventListener('pointerup', endLook);
  lookEl.addEventListener('pointercancel', endLook);

  document.querySelectorAll('#slots b').forEach((el, i) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.slot = i + 1;
    });
  });

  addEventListener('touchmove', (e) => {
    if (e.target.closest('#menu .panel')) return;
    e.preventDefault();
  }, { passive: false });
  addEventListener('gesturestart', (e) => e.preventDefault());

  return {
    active: true,
    show() { root.classList.remove('hidden'); },
    hide() {
      root.classList.add('hidden');
      clearStick();
      input.fire = false;
      input.aim = false;
      input.climb = false;
    },
    setDrone(flying) {
      up.classList.toggle('hidden', !flying);
      fire.textContent = flying ? 'Boom' : 'Fire';
    },
  };
}

function $(id) { return document.getElementById(id); }
