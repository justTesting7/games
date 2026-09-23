// Every sound is synthesised with WebAudio, so no audio files are needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.noise = this.noiseBuffer(2);
    this.startAmbience();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  noiseBuffer(seconds) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // Outdoor slap-back: a few discrete echoes followed by a diffuse tail.
  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (t < 0.03 ? t / 0.03 : 1) * 0.5;
      }
      for (const [t, g] of [[0.11 + c * 0.02, 0.5], [0.23 + c * 0.03, 0.3], [0.41, 0.18]]) {
        const k = Math.floor(t * ctx.sampleRate);
        for (let i = 0; i < 400; i++) d[k + i] += (Math.random() * 2 - 1) * g * (1 - i / 400);
      }
    }
    return b;
  }

  env(param, t, attack, peak, release) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  noiseBurst({ freq = 1000, q = 0.7, type = 'bandpass', gain = 0.5, attack = 0.002, release = 0.2, rate = 1, dest, pan = 0, send = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g.gain, t, attack, gain, release);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(dest || this.master);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      p.connect(s).connect(this.reverbSend);
    }
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + release + 0.05);
    return f;
  }

  // `distance` is 0 for the player's own guns; others are delayed by the
  // speed of sound, quieter, duller and panned to where they came from.
  gunshot(side, distance = 0, panDir = null) {
    if (!this.ctx) return;
    if (distance > 1) {
      setTimeout(() => this.gunshotNow(side, distance, panDir), (distance / 343) * 1000);
      return;
    }
    this.gunshotNow(side, 0, null);
  }

  gunshotNow(side, distance, panDir) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const far = distance > 1;
    const att = far ? Math.min(1, 6 / distance) : 1;
    const pan = far ? Math.max(-0.9, Math.min(0.9, panDir * 0.9)) : side ? -0.15 : 0.15;
    const pitch = 0.92 + Math.random() * 0.16;
    const dull = far ? Math.max(0.25, 1 - distance / 120) : 1;
    this.noiseBurst({ freq: 2400 * pitch * dull, q: 0.5, gain: 0.9 * att, attack: 0.001, release: 0.09, pan, send: far ? 1.6 : 1 });
    const body = this.noiseBurst({ freq: 900 * pitch, q: 0.8, type: 'lowpass', gain: 0.8 * Math.sqrt(att), attack: 0.001, release: 0.32, pan, send: far ? 1.8 : 1.2 });
    body.frequency.setValueAtTime(3000 * dull, t);
    body.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const g = ctx.createGain();
    this.env(g.gain, t, 0.002, 0.9 * att, 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
    if (far) return;
    const c = ctx.createOscillator();
    c.type = 'square';
    c.frequency.value = 3200;
    const cg = ctx.createGain();
    this.env(cg.gain, t + 0.035, 0.001, 0.05, 0.03);
    c.connect(cg).connect(this.master);
    c.start(t + 0.03);
    c.stop(t + 0.1);
  }

  impact(surface, distance) {
    if (!this.ctx) return;
    const att = Math.min(1, 12 / Math.max(distance, 1));
    const delay = distance / 343;
    setTimeout(() => {
      if (surface === 'water') {
        this.noiseBurst({ freq: 1400, q: 0.6, gain: 0.25 * att, attack: 0.005, release: 0.25, send: 0.3 });
      } else if (surface === 'rock' || surface === 'metal') {
        this.noiseBurst({ freq: 3500, q: 2, gain: 0.3 * att, attack: 0.001, release: 0.06, send: 0.4 });
        if (Math.random() < 0.35) this.ricochet(att);
      } else if (surface === 'flesh') {
        this.noiseBurst({ freq: 380, q: 0.9, type: 'lowpass', gain: 0.6 * att, attack: 0.001, release: 0.09, send: 0.15 });
        this.tone(95 + Math.random() * 20, 0.08, 0.25 * att, 'sine');
      } else if (surface === 'wood' || surface === 'target') {
        this.noiseBurst({ freq: 700, q: 1.5, gain: 0.45 * att, attack: 0.001, release: 0.08, send: 0.3 });
        this.tone(220 + Math.random() * 60, 0.12, 0.2 * att, 'triangle');
      } else {
        this.noiseBurst({ freq: 500, q: 0.8, type: 'lowpass', gain: 0.35 * att, attack: 0.002, release: 0.12, send: 0.3 });
      }
    }, delay * 1000);
  }

  ricochet(att) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 2600 + Math.random() * 1400;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.45);
    const g = ctx.createGain();
    this.env(g.gain, t, 0.01, 0.07 * att, 0.45);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g).connect(p).connect(this.master);
    p.connect(this.reverbSend);
    o.start(t);
    o.stop(t + 0.5);
  }

  // Supersonic crack of a bullet passing close by.
  whiz(miss) {
    if (!this.ctx) return;
    const g = 0.35 * (1 - miss / 1.8);
    this.noiseBurst({ freq: 4200, q: 1.2, gain: g, attack: 0.001, release: 0.035, pan: Math.random() * 1.2 - 0.6, send: 0.3 });
    this.noiseBurst({ freq: 1800, q: 3, gain: g * 0.5, attack: 0.004, release: 0.12, pan: Math.random() * 1.2 - 0.6 });
  }

  hurt(fatal) {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 220, q: 0.7, type: 'lowpass', gain: 0.7, attack: 0.002, release: fatal ? 0.5 : 0.16 });
    this.tone(fatal ? 70 : 110, fatal ? 0.6 : 0.14, 0.35);
  }

  tone(freq, dur, gain, type = 'sine') {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g.gain, t, 0.002, gain, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  casing() {
    if (!this.ctx) return;
    const f = 3800 + Math.random() * 1800;
    this.tone(f, 0.08, 0.03);
    this.tone(f * 1.52, 0.05, 0.015);
  }

  footstep(surface, speed) {
    if (!this.ctx) return;
    const g = 0.12 + Math.min(speed, 6) * 0.03;
    const pan = (Math.random() - 0.5) * 0.2;
    if (surface === 'sand') this.noiseBurst({ freq: 900, q: 0.5, type: 'lowpass', gain: g, attack: 0.01, release: 0.12, rate: 0.7, pan });
    else if (surface === 'rock') {
      this.noiseBurst({ freq: 2200, q: 1.2, gain: g * 0.8, attack: 0.002, release: 0.05, pan });
      this.noiseBurst({ freq: 400, q: 0.7, type: 'lowpass', gain: g * 0.6, attack: 0.002, release: 0.06, pan });
    } else if (surface === 'water') this.noiseBurst({ freq: 1200, q: 0.7, gain: g * 1.4, attack: 0.01, release: 0.2, pan });
    else {
      this.noiseBurst({ freq: 3000, q: 0.4, type: 'highpass', gain: g * 0.35, attack: 0.008, release: 0.1, rate: 0.9, pan });
      this.noiseBurst({ freq: 350, q: 0.7, type: 'lowpass', gain: g * 0.7, attack: 0.004, release: 0.07, pan });
    }
  }

  land(speed) {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 300, q: 0.7, type: 'lowpass', gain: 0.25 + speed * 0.03, attack: 0.003, release: 0.14 });
  }

  startAmbience() {
    const ctx = this.ctx;
    const loop = (freq, type, q) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.wind = loop(400, 'lowpass', 0.8);
    this.surf = loop(700, 'lowpass', 0.5);
    this.ambT = 0;
  }

  updateAmbience(dt, { altitude, coast, underwater }) {
    if (!this.ctx || !this.wind) return;
    this.ambT += dt;
    const t = this.ambT;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1);
    const windGain = (0.025 + gust * 0.035) * (1 + Math.min(altitude, 80) / 60);
    this.wind.g.gain.setTargetAtTime(underwater ? 0 : windGain, this.ctx.currentTime, 0.3);
    this.wind.f.frequency.setTargetAtTime(250 + gust * 500, this.ctx.currentTime, 0.3);
    const swell = 0.55 + 0.45 * Math.sin(t * 0.5) * Math.sin(t * 0.23 + 2);
    this.surf.g.gain.setTargetAtTime((underwater ? 0.12 : 0.1 * swell) * coast, this.ctx.currentTime, 0.4);
    this.surf.f.frequency.setTargetAtTime(underwater ? 250 : 500 + swell * 500, this.ctx.currentTime, 0.4);
  }
}
