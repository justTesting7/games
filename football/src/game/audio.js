// Stadium sound, all synthesised. No samples: a crowd bed, and the ball,
// boot, whistle and net made from noise and a few tones.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class MatchAudio {
  constructor() {
    this.ctx = null;
    this.muted = readMute();
    this.roar = 0;
    this.clapT = 0.8;
    this.shoutT = 0.6;
    this.touchAt = 0;
    this.bounceAt = 0;
    this.netAt = 0;
    this.cutUntil = 0;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    // Boot sounds skip the compressor, or the crowd bed flattens them.
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(ctx.destination);

    this.noise = noiseBuffer(ctx, 2);

    // Crowd sits on its own bus so a pause can duck it without killing the whistle.
    this.crowdBus = ctx.createGain();
    this.crowdBus.gain.value = 0;
    this.crowdBus.connect(this.master);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();

    // Low murmur, split a little left and right so the stand has width.
    this.murmur = ctx.createGain();
    this.murmur.gain.value = 0.14;
    for (const pan of [-0.45, 0.45]) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = pan < 0 ? 420 : 520;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(f).connect(p).connect(this.murmur);
    }
    this.murmur.connect(this.crowdBus);

    // The louder mid layer that swells when the move gets dangerous.
    this.bed = ctx.createGain();
    this.bed.gain.value = 0.02;
    const bedF = ctx.createBiquadFilter();
    bedF.type = 'bandpass';
    bedF.frequency.value = 1400;
    bedF.Q.value = 0.45;
    src.connect(bedF).connect(this.bed).connect(this.crowdBus);

    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    const roarF = ctx.createBiquadFilter();
    roarF.type = 'lowpass';
    roarF.frequency.value = 900;
    src.connect(roarF).connect(this.roarGain).connect(this.crowdBus);

    this.crowdBus.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
  }

  toggle() {
    this.muted = !this.muted;
    writeMute(this.muted);
    if (!this.ctx) this.start();
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, t, 0.05);
    return this.muted;
  }

  update(dt, { excite = 0, paused = false } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const cutting = t < this.cutUntil;
    const duck = paused ? 0.15 : cutting ? 0.18 : 1;
    this.crowdBus.gain.setTargetAtTime(duck, t, cutting ? 0.02 : 0.15);
    const bed = (0.05 + excite * 0.14 + this.roar * 0.28) * duck;
    this.bed.gain.setTargetAtTime(bed, t, 0.12);
    this.roarGain.gain.setTargetAtTime(this.roar * 0.42 * duck, t, 0.18);
    this.roar = Math.max(0, this.roar - dt * (this.roar > 0.45 ? 0.18 : 0.4));
    if (paused || this.muted) return;
    this.clapT -= dt;
    if (excite > 0.42 && this.clapT <= 0) {
      this.clap();
      if (excite > 0.7 && Math.random() < 0.55) this.clap(0.13);
      this.clapT = 0.46 + Math.random() * 0.12;
    }
    this.shoutT -= dt;
    if (this.shoutT <= 0) {
      this.shout(0.055 + excite * 0.06);
      this.shoutT = 0.28 + Math.random() * (1.5 - excite * 0.9);
    }
  }

  play(e, ball) {
    if (!this.ctx) return;
    const pos = e.player?.pos || e.point || ball?.pos;
    const pan = panOf(pos);
    switch (e.type) {
      case 'kick':
        if (e.kind === 'header') break;
        this.kick(e.kind, e.power ?? 0.5, pan);
        break;
      case 'header':
        this.thud(180, 0.16, 0.22, pan);
        break;
      case 'touch':
        this.touch(e.speed || 4, pan);
        break;
      case 'bounce':
        this.bounce(e.speed || 3, pan);
        break;
      case 'net':
      case 'sidenet':
        this.net(e.speed || 6, e.type === 'sidenet', pan);
        break;
      case 'post':
      case 'bar':
        this.ping(e.type === 'bar', pan);
        this.roar = Math.max(this.roar, 0.55);
        this.ooh(0.5);
        break;
      case 'board':
        this.thud(90, 0.05, 0.12, pan);
        break;
      case 'whistle':
        this.whistle(e.kind);
        if (e.kind === 'goal' || e.kind === 'half' || e.kind === 'full') this.roar = Math.max(this.roar, e.kind === 'goal' ? 1 : 0.45);
        break;
      case 'goal':
        this.roar = 1;
        for (let i = 0; i < 6; i++) this.shout(0.07, 0.05 * i);
        break;
      case 'shot':
        this.roar = Math.max(this.roar, 0.5);
        break;
      case 'save':
      case 'catch':
        this.glove(!!e.parry || e.type === 'save', pan);
        this.roar = Math.max(this.roar, 0.4);
        this.ooh(0.35);
        break;
      case 'miss':
        this.ooh(0.4);
        this.roar = Math.max(this.roar, 0.28);
        break;
      case 'out':
        this.ooh(0.16);
        break;
      case 'tackle':
      case 'slide':
        this.scuff(e.slide || e.type === 'slide', pan);
        break;
      case 'dive':
        this.whoosh(pan);
        break;
      case 'block':
        this.thud(140, 0.1, 0.16, pan);
        break;
      case 'miscontrol':
        this.scuff(false, pan);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- pitch

  kick(kind, power, pan) {
    const p = clamp(power, 0.15, 1);
    const shot = kind === 'shoot' || kind === 'clear';
    const loft = kind === 'lob' || kind === 'cross' || kind === 'throw' || kind === 'gkThrow';
    const pass = kind === 'pass' || kind === 'through' || kind === 'lob' || kind === 'gkThrow';
    // A pass has to cut the crowd. The old thud sat under the murmur.
    this.cutUntil = this.ctx.currentTime + (pass ? 0.22 : 0.1);
    if (pass) {
      const dry = this.dry || this.master;
      this.thud(340, 0.07, 0.9, pan, dry);
      this.thud(140, 0.09, 0.55, pan, dry);
      this.noiseHit({ freq: 3600, q: 2.2, type: 'bandpass', gain: 0.85, attack: 0.001, release: 0.04, pan, dest: dry });
      this.noiseHit({ freq: 680, q: 0.7, type: 'bandpass', gain: 0.4, attack: 0.001, release: 0.05, pan, dest: dry });
      return;
    }
    const gain = (shot ? 0.62 : 0.28) * (0.7 + p * 0.45);
    this.thud(shot ? 78 : 150, shot ? 0.24 : 0.14, gain, pan);
    this.noiseHit({
      freq: loft ? 1800 : shot ? 700 : 1200,
      q: loft ? 0.5 : 0.8,
      type: loft ? 'highpass' : 'bandpass',
      gain: gain * (loft ? 0.7 : 0.85),
      attack: 0.002,
      release: shot ? 0.1 : 0.06,
      pan,
    });
  }

  touch(speed, pan) {
    const now = this.ctx.currentTime;
    if (now < this.touchAt || speed < 2) return;
    this.touchAt = now + 0.07;
    this.thud(200, 0.035, 0.05 + Math.min(speed, 8) * 0.008, pan);
  }

  bounce(speed, pan) {
    const now = this.ctx.currentTime;
    if (now < this.bounceAt || speed < 1.6) return;
    this.bounceAt = now + 0.05;
    const g = clamp(speed / 14, 0.08, 0.4);
    this.thud(150 + Math.min(speed, 10) * 6, 0.05, g, pan);
  }

  net(speed, side, pan) {
    const now = this.ctx.currentTime;
    if (now < this.netAt) return;
    this.netAt = now + 0.08;
    const g = clamp(speed / 18, 0.08, 0.4) * (side ? 0.45 : 1);
    for (let i = 0; i < (side ? 2 : 4); i++) {
      this.noiseHit({
        freq: 2200 + Math.random() * 1800,
        q: 0.7,
        type: 'highpass',
        gain: g * (1 - i * 0.2),
        attack: 0.002,
        release: 0.05 + Math.random() * 0.04,
        pan: clamp(pan + (Math.random() - 0.5) * 0.2, -1, 1),
        when: i * 0.035,
      });
    }
  }

  ping(bar, pan) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (const [freq, gain] of [[bar ? 880 : 1040, 0.22], [bar ? 1760 : 2470, 0.08]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      o.connect(g).connect(p).connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.5);
    }
    this.noiseHit({ freq: 3000, q: 1.2, type: 'highpass', gain: 0.12, attack: 0.001, release: 0.03, pan });
  }

  whistle(kind) {
    const long = kind === 'long' || kind === 'foul' || kind === 'half' || kind === 'full';
    const goal = kind === 'goal';
    this.blast(long ? 0.62 : goal ? 0.42 : 0.32, 0);
    if (goal) this.blast(0.38, 0.55);
    if (kind === 'half' || kind === 'full') this.blast(0.7, 0.85);
    if (kind === 'full') this.blast(0.9, 1.7);
  }

  blast(dur, delay) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(3180, t);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.16, t + Math.max(0.04, dur - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    this.noiseHit({ freq: 4000, q: 0.8, type: 'highpass', gain: 0.04, attack: 0.01, release: dur, when: delay });
    lfo.start(t);
    o.start(t);
    o.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
  }

  glove(hard, pan) {
    this.thud(hard ? 100 : 220, hard ? 0.12 : 0.06, hard ? 0.32 : 0.16, pan);
    this.noiseHit({
      freq: hard ? 900 : 1600,
      q: 0.6,
      type: 'bandpass',
      gain: hard ? 0.2 : 0.1,
      attack: 0.002,
      release: hard ? 0.07 : 0.04,
      pan,
    });
  }

  scuff(slide, pan) {
    this.noiseHit({
      freq: slide ? 600 : 900,
      q: 0.5,
      type: 'lowpass',
      gain: slide ? 0.22 : 0.12,
      attack: 0.01,
      release: slide ? 0.22 : 0.08,
      pan,
    });
  }

  whoosh(pan) {
    const f = this.noiseHit({
      freq: 1800,
      q: 0.6,
      type: 'bandpass',
      gain: 0.1,
      attack: 0.02,
      release: 0.22,
      pan,
    });
    if (f) {
      const t = this.ctx.currentTime;
      f.frequency.setValueAtTime(2000, t);
      f.frequency.exponentialRampToValueAtTime(380, t + 0.24);
    }
  }

  ooh(gain) {
    const f = this.noiseHit({
      freq: 700,
      q: 1.4,
      type: 'bandpass',
      gain,
      attack: 0.05,
      release: 0.45,
      dest: this.crowdBus,
    });
    if (!f) return;
    const t = this.ctx.currentTime;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(280, t + 0.5);
  }

  thud(freq, release, gain, pan, dest) {
    if (!this.ctx || gain < 0.01) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + release);
    const p = ctx.createStereoPanner();
    p.pan.value = pan || 0;
    o.connect(g).connect(p).connect(dest || this.master);
    o.start(t);
    o.stop(t + release + 0.02);
  }

  noiseHit({ freq, q, type, gain, attack, release, pan = 0, when = 0, dest }) {
    if (!this.ctx || gain <= 0) return null;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(dest || this.master);
    src.start(t, Math.random() * 1.4);
    src.stop(t + attack + release + 0.03);
    return f;
  }

  // ---------------------------------------------------------------- crowd

  clap(delay = 0) {
    this.noiseHit({
      freq: 1700,
      q: 0.6,
      type: 'bandpass',
      gain: 0.09 + Math.random() * 0.04,
      attack: 0.001,
      release: 0.045,
      pan: (Math.random() - 0.5) * 0.8,
      when: delay,
      dest: this.crowdBus,
    });
  }

  shout(gain, delay = 0) {
    const f0 = 380 + Math.random() * 1100;
    const f = this.noiseHit({
      freq: f0,
      q: 7,
      type: 'bandpass',
      gain,
      attack: 0.02,
      release: 0.1 + Math.random() * 0.16,
      pan: (Math.random() - 0.5) * 1.2,
      when: delay,
      dest: this.crowdBus,
    });
    if (!f) return;
    const t = this.ctx.currentTime + delay;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f0 * (0.75 + Math.random() * 0.4), t + 0.16);
  }
}

function panOf(pos) {
  if (!pos) return 0;
  return clamp(pos.x / 48, -0.75, 0.75);
}

function noiseBuffer(ctx, seconds) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let y = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    y = y * 0.98 + w * 0.02;
    d[i] = y * 7;
  }
  return b;
}

function readMute() {
  try { return localStorage.getItem('football-mute') === '1'; } catch { return false; }
}
function writeMute(muted) {
  try { localStorage.setItem('football-mute', muted ? '1' : '0'); } catch { /* private mode */ }
}
