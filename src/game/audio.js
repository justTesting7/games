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
    this.shots = [0, 1, 2, 3].map(() => this.renderGunshot(true));
    this.farShots = [0, 1].map(() => this.renderGunshot(false));
    const rifle = { blastT: 0.11, thumpF: 82, thumpT: 0.2, rumbleT: 0.9, len: 1.85, mix: { crack: 1.2, thump: 1.55, rumble: 0.58 } };
    this.rifleShots = [0, 1, 2].map(() => this.renderGunshot(false, rifle));
    this.boom = [0, 1].map(() => this.renderGunshot(false, { blastT: 0.16, thumpF: 70, thumpT: 0.35, rumbleT: 1.3, len: 3.2, mix: { crack: 0.6, blast: 1, thump: 1.6, rumble: 0.7 } }));
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
  gunshot(side, distance = 0, panDir = null, rifle = false) {
    if (!this.ctx) return;
    if (distance > 1) {
      setTimeout(() => this.gunshotNow(side, distance, panDir, rifle), (distance / 343) * 1000);
      return;
    }
    this.gunshotNow(side, 0, null, rifle);
  }

  // A pistol report is broadband noise, not a tone: a very short crack, a
  // blast that dies within ~80 ms, a low thump, and a bit of rumble, all
  // saturated together. Any pitched sweep makes it sound like a laser.
  // `o` scales the layers: a rifle has a longer, deeper blast and rumble.
  renderGunshot(click, o = {}) {
    const { blastT = 0.045, thumpF = 160, thumpT = 0.07, rumbleT = 0.22, len = 0.7, mix: mixO = {} } = o;
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * len);
    const out = new Float32Array(n);
    const parts = { crack: new Float32Array(n), blast: new Float32Array(n), thump: new Float32Array(n), rumble: new Float32Array(n) };
    const k = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / sr);
    let lpCrack = 0, lpBlast = 0, lpBlast2 = 0, lpT1 = 0, lpT2 = 0, lpR1 = 0, lpR2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const x = Math.random() * 2 - 1;
      lpCrack += k(1800) * (x - lpCrack);
      parts.crack[i] = (x - lpCrack) * Math.exp(-t / 0.0035);
      const fc = 900 + 5200 * Math.exp(-t / 0.012);
      lpBlast += k(fc) * (x - lpBlast);
      lpBlast2 += k(fc) * (lpBlast - lpBlast2);
      parts.blast[i] = lpBlast2 * (Math.exp(-t / blastT) + 0.25 * Math.exp(-t / (blastT * 2.7)));
      lpT1 += k(thumpF) * (x - lpT1);
      lpT2 += k(thumpF) * (lpT1 - lpT2);
      parts.thump[i] = lpT2 * Math.exp(-t / thumpT);
      lpR1 += k(450) * (x - lpR1);
      lpR2 += k(450) * (lpR1 - lpR2);
      parts.rumble[i] = lpR2 * Math.exp(-t / rumbleT) * Math.min(1, t / 0.01);
    }
    const norm = (a) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m || 1; };
    const mix = { crack: 0.75, blast: 1, thump: 1.1, rumble: 0.22, ...mixO };
    for (const key in parts) {
      const g = mix[key] / norm(parts[key]);
      const a = parts[key];
      for (let i = 0; i < n; i++) out[i] += a[i] * g;
    }
    if (click) {
      // The slide going back and slamming forward after the shot.
      for (const [at, gain] of [[0.038, 0.2], [0.07, 0.14]]) {
        let lp = 0;
        const i0 = Math.floor(sr * at);
        for (let i = i0; i < Math.min(n, i0 + sr * 0.02); i++) {
          const x = Math.random() * 2 - 1;
          lp += k(3000) * (x - lp);
          out[i] += (x - lp) * gain * Math.exp(-(i - i0) / sr / 0.003);
        }
      }
    }
    let peak = 0;
    for (let i = 0; i < n; i++) { out[i] = Math.tanh(out[i] * 1.8); peak = Math.max(peak, Math.abs(out[i])); }
    const b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (out[i] / peak) * 0.95;
    return b;
  }

  gunshotNow(side, distance, panDir, rifle) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const far = distance > 1;
    const att = far ? Math.min(1, (rifle ? 16 : 7) / distance) : 1;
    const pan = far ? Math.max(-0.9, Math.min(0.9, panDir * 0.9)) : rifle ? 0.05 : side ? -0.12 : 0.12;
    const set = rifle ? this.rifleShots : far ? this.farShots : this.shots;
    const src = ctx.createBufferSource();
    src.buffer = set[Math.floor(Math.random() * set.length)];
    src.playbackRate.value = 0.95 + Math.random() * 0.1;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = far ? Math.max(900, 9000 - distance * 90) : 16000;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = far ? 0.9 * att * Math.sqrt(att) : 1;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    const s = ctx.createGain();
    s.gain.value = far ? 0.9 * Math.sqrt(att) : 0.55;
    p.connect(s).connect(this.reverbSend);
    src.start(t);
  }

  headshot(distance) {
    if (!this.ctx) return;
    const att = Math.min(1, 14 / Math.max(distance, 1));
    const delay = distance / 343;
    setTimeout(() => {
      this.noiseBurst({ freq: 220, q: 0.55, type: 'lowpass', gain: 0.85 * att, attack: 0.001, release: 0.14, send: 0.2 });
      this.noiseBurst({ freq: 900, q: 1.2, gain: 0.35 * att, attack: 0.002, release: 0.22, send: 0.35 });
      this.tone(70 + Math.random() * 25, 0.06, 0.35 * att, 'sine');
      this.tone(140 + Math.random() * 40, 0.04, 0.18 * att, 'triangle');
    }, delay * 1000);
  }

  impact(surface, distance) {
    if (!this.ctx) return;
    const att = Math.min(1, 12 / Math.max(distance, 1));
    const delay = distance / 343;
    setTimeout(() => {
      if (surface === 'water') {
        this.noiseBurst({ freq: 1400, q: 0.6, gain: 0.25 * att, attack: 0.005, release: 0.25, send: 0.3 });
      } else if (surface === 'rock' || surface === 'metal' || surface === 'concrete' || surface === 'cover') {
        this.noiseBurst({ freq: 3500, q: 2, gain: 0.3 * att, attack: 0.001, release: 0.06, send: 0.4 });
        this.ricochet(att);
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
    if (!this.ctx) return;
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

  explosion(distance, panDir, underwater) {
    if (!this.ctx) return;
    setTimeout(() => {
      const ctx = this.ctx;
      const att = Math.min(1, 14 / Math.max(distance, 1));
      const src = ctx.createBufferSource();
      src.buffer = this.boom[Math.floor(Math.random() * this.boom.length)];
      src.playbackRate.value = (underwater ? 0.7 : 0.9) + Math.random() * 0.1;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = underwater ? 500 : Math.max(700, 12000 - distance * 120);
      const g = ctx.createGain();
      g.gain.value = 1.3 * att;
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, panDir * 0.8));
      src.connect(f).connect(g).connect(p).connect(this.master);
      const s = ctx.createGain();
      s.gain.value = 1.2 * Math.sqrt(att);
      p.connect(s).connect(this.reverbSend);
      src.start();
      if (underwater) this.noiseBurst({ freq: 1200, q: 0.5, gain: 0.5 * att, attack: 0.05, release: 1.2, send: 0.5 });
    }, (distance / 343) * 1000);
  }

  // Gun handling and grenade noises: short filtered clicks and scrapes.
  mech(kind, att = 1) {
    if (!this.ctx || att < 0.02) return;
    const click = (freq, gain, rel = 0.025, q = 4) => this.noiseBurst({ freq, q, gain: gain * att, attack: 0.001, release: rel, send: 0.1 });
    const scrape = (freq, gain, rel) => this.noiseBurst({ freq, q: 1.5, gain: gain * att, attack: 0.01, release: rel, send: 0.05 });
    switch (kind) {
      case 'reloadStart':
        this.noiseBurst({ freq: 220, q: 0.7, type: 'lowpass', gain: 0.28 * att, attack: 0.02, release: 0.28, send: 0.12 });
        scrape(480, 0.22, 0.22);
        click(1400, 0.16, 0.04);
        break;
      case 'boltBack':
        click(2100, 0.48); scrape(1300, 0.24, 0.12);
        this.tone(320 + Math.random() * 40, 0.05, 0.08 * att, 'triangle');
        break;
      case 'boltFwd':
        scrape(1100, 0.2, 0.09);
        setTimeout(() => { click(2600, 0.55, 0.045); this.noiseBurst({ freq: 180, q: 0.6, type: 'lowpass', gain: 0.28 * att, attack: 0.004, release: 0.14, send: 0.1 }); }, 50);
        break;
      case 'round':
        click(3600, 0.32, 0.03); click(1500, 0.22, 0.045);
        scrape(2200, 0.12, 0.05);
        this.tone(2400 + Math.random() * 400, 0.03, 0.05 * att, 'triangle');
        break;
      case 'magOut':
        click(1900, 0.4); scrape(700, 0.2, 0.14);
        this.noiseBurst({ freq: 160, q: 0.8, type: 'lowpass', gain: 0.22 * att, attack: 0.008, release: 0.16 });
        break;
      case 'magIn':
        click(1400, 0.48, 0.04); click(3200, 0.28, 0.03);
        this.noiseBurst({ freq: 240, q: 0.7, type: 'lowpass', gain: 0.2 * att, attack: 0.004, release: 0.1 });
        break;
      case 'slide':
        click(2800, 0.42);
        setTimeout(() => click(2200, 0.5, 0.035), 80);
        this.noiseBurst({ freq: 200, q: 0.6, type: 'lowpass', gain: 0.18 * att, attack: 0.004, release: 0.1 });
        break;
      case 'dry': click(5000, 0.25, 0.015, 6); break;
      case 'equip': scrape(700, 0.12, 0.12); click(2600, 0.12); break;
      case 'scope': click(2100, 0.1, 0.03); this.noiseBurst({ freq: 280, q: 0.7, type: 'lowpass', gain: 0.12 * att, attack: 0.02, release: 0.16, send: 0.08 }); break;
      case 'pin': click(3500, 0.15, 0.02); scrape(2400, 0.08, 0.06); break;
      case 'throw': this.noiseBurst({ freq: 500, q: 0.8, gain: 0.25 * att, attack: 0.04, release: 0.2 }); break;
      case 'bounce': this.noiseBurst({ freq: 600, q: 1.8, type: 'bandpass', gain: 0.5 * att, attack: 0.001, release: 0.06 }); click(2300, 0.15, 0.03); break;
      default: break;
    }
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
