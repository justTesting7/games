export const STEP = 0.05;
export const MAX_CATCHUP = 1;

export function consume(elapsed) {
  let acc = Math.min(MAX_CATCHUP, Math.max(0, elapsed));
  const steps = [];
  while (acc > 1e-6) {
    const dt = Math.min(STEP, acc);
    acc -= dt;
    steps.push(dt);
  }
  return steps;
}

// Drive the game from rAF when the tab is visible, and from a worker
// (plus a timer fallback) when it is not. Large gaps are split into
// 50 ms slices so a background tab still advances in real time.
export function startClock(onStep) {
  let last = performance.now();
  let busy = false;

  const pulse = (draw) => {
    if (busy) return;
    busy = true;
    const now = performance.now();
    const steps = consume((now - last) / 1000);
    last = now;
    const visible = document.visibilityState === 'visible';
    const wantDraw = !!draw && visible;
    for (let i = 0; i < steps.length; i++) {
      onStep(steps[i], wantDraw && i === steps.length - 1);
    }
    busy = false;
  };

  const loop = () => {
    requestAnimationFrame(loop);
    pulse(true);
  };
  loop();

  let worker = null;
  try {
    worker = new Worker(new URL('./tick.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = () => {
      if (document.visibilityState === 'visible') return;
      pulse(false);
    };
  } catch {
    worker = null;
  }

  const fallback = setInterval(() => {
    if (document.visibilityState === 'visible') return;
    pulse(false);
  }, 16);

  document.addEventListener('visibilitychange', () => {
    pulse(document.visibilityState === 'visible');
  });

  return {
    pulse,
    stop() {
      worker?.terminate();
      clearInterval(fallback);
    },
  };
}
