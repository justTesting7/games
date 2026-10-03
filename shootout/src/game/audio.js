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
    // slap-back off the buildings: a delay each side (set from the walls around the
    // listener, see setSpace), fed back through a low-pass so repeats get duller
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0;
    this.echoes = [-0.7, 0.7].map((pan) => {
      const d = ctx.createDelay(1.5), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), p = ctx.createStereoPanner();
      d.delayTime.value = 0.2;
      fb.gain.value = 0.2;
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      p.pan.value = pan;
      this.echoSend.connect(d).connect(lp).connect(fb).connect(d);
      lp.connect(p).connect(this.master);
      return { d, fb };
    });

    this.noise = this.noiseBuffer(2);
    this.shots = [0, 1, 2, 3].map(() => this.renderGunshot());
    this.farShots = [0, 1].map(() => this.renderGunshot());
    const rifle = { blastT: 0.11, thumpF: 82, thumpT: 0.2, rumbleT: 0.9, len: 1.85, mix: { crack: 1.2, thump: 1.55, rumble: 0.58 } };
    this.rifleShots = [0, 1, 2].map(() => this.renderGunshot(rifle));
    this.boom = [0, 1].map(() => this.renderGunshot({ blastT: 0.16, thumpF: 70, thumpT: 0.35, rumbleT: 1.3, len: 3.2, mix: { crack: 0.6, blast: 1, thump: 1.6, rumble: 0.7 } }));
    this.startAmbience();
  }

  /**
   * The place the listener is in: enclosure 0 (open square) .. 1 (narrow street, under a
   * roof), and the distances to the walls on the left and right (m). Reverb swells in
   * closed-in streets; the echo comes back off the walls after the round trip.
   */
  setSpace({ enclosure = 0.3, left = 60, right = 60 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.reverbSend.gain.setTargetAtTime(0.35 + 0.45 * enclosure, t, 0.4);
    this.echoSend.gain.setTargetAtTime(Math.min(left, right) > 70 ? 0.05 : 0.18 + 0.4 * enclosure, t, 0.4);
    [left, right].forEach((dist, i) => {
      const e = this.echoes[i];
      e.d.delayTime.setTargetAtTime(Math.min(1.2, Math.max(0.035, (2 * dist) / 343)), t, 0.3);
      e.fb.gain.setTargetAtTime(0.12 + 0.3 * enclosure, t, 0.4);
    });
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

  /**
   * An engine voice (slot 0: the car you drive; 1: the nearest other car under power).
   * s = { on, speed, max, throttle, scooter, dist, pan }. RPM climbs through four gears
   * and drops at each shift; the low-pass opens with the throttle.
   */
  // A moped's engine: a 125 cc single, four-stroke, on a CVT. Its sound is a train of
  // exhaust pulses at the firing rate (rpm / 120: ~13 Hz at idle, ~70 Hz flat out), each one
  // a burst with many harmonics, shaped by the pipe's resonances, plus the rasp of the
  // intake and valve gear chopped at the same rate. The belt drive holds the revs nearly
  // constant once moving: they jump with the throttle, then rise slowly with the speed.
  mopedEngine(slot, s) {
    const ctx = this.ctx, now = ctx.currentTime;
    this.mopeds = this.mopeds || [];
    let e = this.mopeds[slot];
    if (!e) {
      // the pulse: harmonics falling off gently, fixed random phases (a real pulse, not a tone)
      const n = 48, re = new Float32Array(n), im = new Float32Array(n);
      let seed = 7;
      for (let k = 1; k < n; k++) {
        seed = (seed * 16807) % 2147483647;
        const ph = (seed / 2147483647) * Math.PI * 2, a = 1 / Math.pow(k, 0.85);
        re[k] = a * Math.cos(ph); im[k] = a * Math.sin(ph);
      }
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(ctx.createPeriodicWave(re, im));
      const drive = ctx.createWaveShaper();
      const curve = new Float32Array(512);
      for (let i = 0; i < 512; i++) { const x = i / 256 - 1; curve[i] = Math.tanh(x * 3.2) * 0.9; }
      drive.curve = curve;
      // rasp: noise opened and closed by a square wave at the firing rate
      const noise = ctx.createBufferSource();
      noise.buffer = this.noise; noise.loop = true;
      const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 2200; nbp.Q.value = 0.7;
      const ngate = ctx.createGain(); ngate.gain.value = 0;
      const am = ctx.createOscillator(); am.type = 'square';
      const amDepth = ctx.createGain(); amDepth.gain.value = 0.5;
      am.connect(amDepth).connect(ngate.gain);
      const nLevel = ctx.createGain(); nLevel.gain.value = 0.22;
      noise.connect(nbp).connect(ngate).connect(nLevel);
      // the exhaust: a body resonance and a pipe one, then a lowpass that opens with the throttle
      const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 160; body.Q.value = 1.1; body.gain.value = 9;
      const pipe = ctx.createBiquadFilter(); pipe.type = 'peaking'; pipe.frequency.value = 540; pipe.Q.value = 2.2; pipe.gain.value = 7;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner();
      osc.connect(drive).connect(body);
      nLevel.connect(body);
      body.connect(pipe).connect(lp).connect(hp).connect(g).connect(p).connect(this.master);
      // and a little of it into the room (the buildings throw it back)
      const send = ctx.createGain(); send.gain.value = 0.12;
      g.connect(send).connect(this.reverbSend);
      osc.start(); noise.start(); am.start();
      e = this.mopeds[slot] = { osc, am, lp, pipe, g, p, rpm: 1600, nLevel };
    }
    if (!s.on) { e.g.gain.setTargetAtTime(0, now, 0.2); return; }
    const v = Math.abs(s.speed), max = s.max || 24, thr = Math.max(0, s.throttle || 0);
    // the CVT: idle until the clutch takes, then revs set by throttle and a little by speed
    const target = v < 0.5 && thr < 0.05 ? 1600 : 4600 + 2600 * Math.min(1, v / max) + thr * 900;
    e.rpm += (target - e.rpm) * Math.min(1, (target > e.rpm ? 0.09 : 0.05));
    const wobble = 1 + (Math.random() - 0.5) * (e.rpm < 2200 ? 0.06 : 0.015); // an idle never quite steady
    const fire = (e.rpm / 120) * wobble;
    e.osc.frequency.setTargetAtTime(fire, now, 0.03);
    e.am.frequency.setTargetAtTime(fire, now, 0.03);
    e.lp.frequency.setTargetAtTime(600 + thr * 2600 + (e.rpm / 8000) * 1400, now, 0.06);
    e.pipe.frequency.setTargetAtTime(480 + (e.rpm / 8000) * 260, now, 0.1);
    e.nLevel.gain.setTargetAtTime(0.12 + thr * 0.25, now, 0.08);
    const att = s.dist > 1 ? Math.min(1, 7 / s.dist) : 1;
    const level = (0.05 + 0.08 * thr + 0.03 * Math.min(1, v / max)) * att;
    e.g.gain.setTargetAtTime(level, now, 0.06);
    e.p.pan.setTargetAtTime(s.pan || 0, now, 0.1);
  }

  engine(slot, s) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    // a moped has its own voice (and the car/scooter one in this slot falls silent, and back)
    if (s.moped) {
      this.engines?.[slot]?.g.gain.setTargetAtTime(0, now, 0.1);
      this.mopedEngine(slot, s);
      return;
    }
    if (this.mopeds?.[slot]) this.mopedEngine(slot, { on: false });
    this.engines = this.engines || [];
    let e = this.engines[slot];
    if (!e) {
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = 'sawtooth'; b.type = 'square';
      const shape = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
      shape.curve = curve;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2.5;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner();
      const mixB = ctx.createGain(); mixB.gain.value = 0.55;
      a.connect(shape); b.connect(mixB).connect(shape);
      shape.connect(f).connect(g).connect(p).connect(this.master);
      a.start(); b.start();
      e = this.engines[slot] = { a, b, f, g, p };
    }
    if (!s.on) { e.g.gain.setTargetAtTime(0, now, 0.15); return; }
    const v = Math.abs(s.speed), max = s.max || 24;
    let freq, cut;
    if (s.scooter) {
      freq = 180 + v * 38;
      cut = 1400 + v * 120;
      e.a.type = 'sine'; e.b.type = 'sine';
    } else {
      const gearSpan = max / 4;
      const gear = Math.min(3, Math.floor(v / gearSpan));
      const inGear = (v - gear * gearSpan) / gearSpan;
      const rpm = v < 0.5 ? 0.15 : 0.22 + 0.7 * inGear + gear * 0.04;
      freq = 30 + rpm * 100;
      cut = 280 + (s.throttle > 0 ? s.throttle : 0) * 1300 + rpm * 700;
      e.a.type = 'sawtooth'; e.b.type = 'square';
    }
    const att = s.dist > 1 ? Math.min(1, 6 / s.dist) : 1;
    e.a.frequency.setTargetAtTime(freq, now, 0.05);
    e.b.frequency.setTargetAtTime(freq * 0.5, now, 0.05);
    e.f.frequency.setTargetAtTime(cut, now, 0.08);
    const level = s.scooter ? 0.05 : 0.07 + 0.09 * Math.max(0, s.throttle) + 0.02 * Math.min(1, v / max);
    e.g.gain.setTargetAtTime(level * att, now, 0.08);
    e.p.pan.setTargetAtTime(s.pan || 0, now, 0.1);
  }

  // Tyres sliding on asphalt: a narrow, pitched hiss; k 0..1 by how hard.
  squeal(k = 1) {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 1650 + Math.random() * 450, q: 11, type: 'bandpass', gain: 0.22 * k, attack: 0.03, release: 0.2 });
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
  gunshot(side, distance = 0, panDir = null, rifle = false, occluded = false) {
    if (!this.ctx) return;
    if (distance > 1) {
      setTimeout(() => this.gunshotNow(side, distance, panDir, rifle, occluded), (distance / 343) * 1000);
      return;
    }
    this.gunshotNow(side, 0, null, rifle);
  }

  // A pistol report is broadband noise, not a tone: a very short crack, a
  // blast that dies within ~80 ms, a low thump, and a bit of rumble, all
  // saturated together. Any pitched sweep makes it sound like a laser.
  // `o` scales the layers: a rifle has a longer, deeper blast and rumble.
  renderGunshot(o = {}) {
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
    let peak = 0;
    for (let i = 0; i < n; i++) { out[i] = Math.tanh(out[i] * 1.8); peak = Math.max(peak, Math.abs(out[i])); }
    const b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (out[i] / peak) * 0.95;
    return b;
  }

  // occluded: heard through or around a building: dull, quieter, mostly reverb
  gunshotNow(side, distance, panDir, rifle, occluded = false) {
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
    f.frequency.value = far ? Math.max(900, 9000 - distance * 90) * (occluded ? 0.3 : 1) : 16000;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = (far ? 0.9 * att * Math.sqrt(att) : 1) * (occluded ? 0.45 : 1);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    const s = ctx.createGain();
    s.gain.value = far ? 0.9 * Math.sqrt(att) : 0.55;
    p.connect(s).connect(this.reverbSend);
    // and off the buildings around
    const e = ctx.createGain();
    e.gain.value = far ? 0.8 * Math.sqrt(att) : 0.5;
    p.connect(e).connect(this.echoSend);
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
      } else if (surface === 'glass') {
        this.noiseBurst({ freq: 5200, q: 2.4, gain: 0.42 * att, attack: 0.001, release: 0.12, send: 0.45 });
        this.noiseBurst({ freq: 1800, q: 0.7, type: 'highpass', gain: 0.22 * att, attack: 0.001, release: 0.18, send: 0.25 });
        this.tone(1400 + Math.random() * 500, 0.05, 0.08 * att, 'triangle');
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
      if (!underwater) { const e = ctx.createGain(); e.gain.value = 0.9 * Math.sqrt(att); p.connect(e).connect(this.echoSend); }
      src.start();
      if (underwater) this.noiseBurst({ freq: 1200, q: 0.5, gain: 0.5 * att, attack: 0.05, release: 1.2, send: 0.5 });
    }, (distance / 343) * 1000);
  }

  // A flock taking off: a clatter of wing-claps, quick and uneven, fading as they climb.
  flutter(att = 1) {
    if (!this.ctx || att < 0.03) return;
    for (let i = 0; i < 16; i++) {
      setTimeout(() => this.noiseBurst({ freq: 900 + Math.random() * 900, q: 0.9, gain: (0.28 + Math.random() * 0.2) * att * (1 - i / 20), attack: 0.003, release: 0.05 + Math.random() * 0.04, send: 0.15, pan: (Math.random() - 0.5) * 0.6 }), i * (35 + Math.random() * 45));
    }
  }

  // Thunder after a lightning flash: a crack for a near strike, then a long low rumble
  // that swells and dies away; arrives at the speed of sound.
  thunder(distance) {
    if (!this.ctx) return;
    setTimeout(() => {
      const ctx = this.ctx, t = ctx.currentTime;
      const near = Math.max(0, 1 - distance / 1200);
      const dur = 3.5 + Math.random() * 2.5;
      const src = ctx.createBufferSource();
      src.buffer = this.thunderNoise || (this.thunderNoise = this.noiseBuffer(7));
      src.playbackRate.value = 0.6 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 180 + near * 600;
      const g = ctx.createGain();
      // the rumble rolls: a few swells on a slow decay
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 + near * 0.6, t + 0.08 + (1 - near) * 0.5);
      let at = t + 0.4;
      while (at < t + dur - 0.6) {
        const k = Math.pow(1 - (at - t) / dur, 1.5);
        g.gain.linearRampToValueAtTime((0.25 + Math.random() * 0.6) * k * (0.6 + near * 0.5), at);
        at += 0.25 + Math.random() * 0.6;
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.master);
      const send = ctx.createGain();
      send.gain.value = 0.6;
      g.connect(send).connect(this.reverbSend);
      src.start(t);
      src.stop(t + dur + 0.1);
      if (near > 0.5) this.noiseBurst({ freq: 1800, q: 0.5, gain: 0.9 * near, attack: 0.002, release: 0.35, send: 0.5 });
    }, (distance / 343) * 1000);
  }

  // Gun handling and grenade noises: short filtered clicks and scrapes.
  // the knife going in: a dull, wet thud
  stab(att = 1) {
    if (!this.ctx || att < 0.02) return;
    this.noiseBurst({ freq: 170, q: 0.7, type: 'lowpass', gain: 0.6 * att, attack: 0.003, release: 0.12, send: 0.08 });
    this.noiseBurst({ freq: 750, q: 1.2, gain: 0.22 * att, attack: 0.002, release: 0.07 });
  }

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
      case 'casing': // brass on the ground: a bright ring, quieter on each bounce
        this.tone(4200 + Math.random() * 900, 0.06, 0.035 * att, 'sine');
        this.tone(6900 + Math.random() * 900, 0.04, 0.02 * att, 'sine');
        click(5200, 0.08, 0.012, 6);
        break;
      case 'swish': { // the blade through the air: a breathy sweep that rises and fades
        const f = this.noiseBurst({ freq: 900, q: 1.6, gain: 0.32 * att, attack: 0.03, release: 0.14, send: 0.04 });
        const t = this.ctx.currentTime;
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(3800, t + 0.12);
        break;
      }
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

  droneStart() {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 900, q: 0.8, type: 'bandpass', gain: 0.22, attack: 0.02, release: 0.18 });
    this.tone(180, 0.12, 0.08, 'square');
  }

  droneShotDown() {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 3200, q: 1.6, gain: 0.42, attack: 0.001, release: 0.07, send: 0.4 });
    this.noiseBurst({ freq: 170, q: 0.55, type: 'lowpass', gain: 0.58, attack: 0.002, release: 0.38, send: 0.22 });
    this.noiseBurst({ freq: 900, q: 2.2, gain: 0.22, attack: 0.001, release: 0.12, send: 0.25 });
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (this.droneBuzz) {
      this.droneBuzz.o.frequency.setTargetAtTime(26, t, 0.32);
      this.droneBuzz.f.frequency.setTargetAtTime(130, t, 0.38);
      this.droneBuzz.g.gain.setTargetAtTime(0.24, t, 0.04);
      this.droneBuzz.g.gain.setTargetAtTime(0.0001, t + 0.12, 0.65);
      this.droneBuzz.og.gain.setTargetAtTime(0.14, t, 0.03);
      this.droneBuzz.og.gain.setTargetAtTime(0.0001, t + 0.16, 0.5);
    }
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(360, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 1.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.45);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(280, t + 1.3);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.5);
    for (const at of [0.07, 0.2, 0.38, 0.62, 0.94, 1.22]) {
      setTimeout(() => {
        if (!this.ctx) return;
        this.noiseBurst({
          freq: 1400 + Math.random() * 2200, q: 1.8,
          gain: 0.1 + Math.random() * 0.08, attack: 0.001, release: 0.055, send: 0.18,
        });
      }, at * 1000);
    }
  }

  droneHum(gain) {
    if (!this.ctx) return;
    if (!this.droneBuzz) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 420;
      f.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.value = 0;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 92;
      const og = ctx.createGain();
      og.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      o.connect(og).connect(this.master);
      src.start();
      o.start();
      this.droneBuzz = { g, f, og, o };
    }
    const t = this.ctx.currentTime;
    this.droneBuzz.g.gain.setTargetAtTime(gain * 0.16, t, 0.08);
    this.droneBuzz.og.gain.setTargetAtTime(gain * 0.04, t, 0.08);
    this.droneBuzz.f.frequency.setTargetAtTime(360 + gain * 220, t, 0.12);
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

  // Rain, built the way it sounds rather than as a hiss: a soft wash (pink noise: the far
  // rain blurred together, swelling with the gusts); a bed of thousands of small drops, each
  // a short burst of noise (soft on wet ground, a tick on stone, a splat), so dense they
  // crackle, rendered once into two stereo loops of different lengths so the pattern never
  // seems to repeat; and the near drops one by one, placed live around the listener (now
  // and then a fat drip off an edge). From inside a car the roof drums and the street goes dull; under a roof
  // it all does.
  startRain() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const out = ctx.createGain();
    out.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 12000;
    tone.Q.value = 0.5;
    out.connect(tone).connect(this.master);
    const layer = (buffer, ...filters) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      let node = src;
      for (const f of filters) node = node.connect(f);
      node.connect(g).connect(out);
      src.start(0, Math.random() * buffer.duration);
      return { g, filters };
    };
    const filter = (type, freq, q = 0.7, gain = 0) => {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q; f.gain.value = gain;
      return f;
    };
    const wash = layer(this.pinkBuffer(6), filter('highpass', 180), filter('peaking', 1900, 0.8, 4), filter('lowpass', 7500));
    // three beds of different character, each drifting in level and tone on its own, so the
    // mix keeps changing: soft patter on wet ground, ticks on stone and metal, sparse splats
    const beds = [
      layer(this.dropBed(3.7, 900, [0.8, 0.12, 0.08]), filter('highpass', 300), filter('lowpass', 6000)),
      layer(this.dropBed(5.3, 500, [0.15, 0.8, 0.05]), filter('highpass', 900), filter('lowpass', 11000)),
      layer(this.dropBed(2.9, 120, [0.2, 0.2, 0.6]), filter('highpass', 250), filter('lowpass', 7000)),
    ].map((l) => ({ ...l, level: 1, tone: 1, next: 0 }));
    const roof = layer(this.roofBed(4.1), filter('lowpass', 1400));
    // single drops for the near ones, each played at its own pitch through its own filter
    const bank = Array.from({ length: 64 }, (_, i) => this.oneDrop([0, 0, 1, 1, 2, 2, 3][i % 7]));
    this.rain = { out, tone, wash, beds, roof, bank, acc: 0, t: 0, burst: 1, burstGoal: 1, burstNext: 0, drips: [] };
  }

  // Paul Kellet's pink noise filter, a channel each
  pinkBuffer(seconds) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      // fade the seam: the last 50 ms crossfade into the first
      const f = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
    }
    return b;
  }

  // One drop into L/R at `at` (wrapping round the buffer, so a loop has no seam). Rain has
  // no pitch: every drop is a burst of noise, how dull and how long by what it hits.
  // kind 0: a drop on a wet surface (soft, mid), 1: a tick on stone or metal (bright, a few
  // ms), 2: a splat (fuller, longer), 3: a fat drip off an edge (dull and heavy).
  static addDrop(L, R, at, sr, amp, pan, kind) {
    const n = L.length;
    const gl = amp * Math.cos((pan + 1) * Math.PI / 4), gr = amp * Math.sin((pan + 1) * Math.PI / 4);
    const [cut, dur] = [
      [900 + Math.random() * 1800, 0.004 + Math.random() * 0.008],
      [3000 + Math.random() * 5000, 0.0012 + Math.random() * 0.003],
      [1500 + Math.random() * 2500, 0.008 + Math.random() * 0.014],
      [350 + Math.random() * 500, 0.018 + Math.random() * 0.025],
    ][kind];
    const k = 1 - Math.exp((-2 * Math.PI * cut) / sr); // one-pole low-pass
    const len = Math.floor(dur * 4 * sr), att = 1 / (sr * 0.0004), fall = Math.exp(-1 / (dur * sr));
    const W = Audio.white || (Audio.white = Float32Array.from({ length: 65536 }, () => Math.random() * 2 - 1));
    let lp = 0, prev = 0, env = 1, w = (Math.random() * 65536) | 0;
    for (let i = 0; i < len; i++) {
      lp += k * (W[(w + i) & 65535] - lp);
      const hp = lp - prev * 0.85; // and no rumble below the impact
      prev = lp;
      const s = hp * env * (i < 1 / att ? i * att : 1);
      env *= fall;
      const j = at + i < n ? at + i : (at + i) % n;
      L[j] += s * gl; R[j] += s * gr;
    }
  }

  static normalise(b, rms) {
    let sum = 0, cnt = 0;
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i += 4) { sum += d[i] * d[i]; cnt++; } }
    const k = rms / Math.max(1e-6, Math.sqrt(sum / cnt));
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
    return b;
  }

  // Many drops a second all round: mostly faint, a few loud (the near ones in the mix), in
  // clumps as much as evenly (a gust, a branch shedding, a gutter overflowing). mix: the
  // shares of soft drops, ticks and splats.
  dropBed(seconds, perSecond, mix = [0.55, 0.35, 0.1]) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * seconds);
    const b = ctx.createBuffer(2, n, sr), L = b.getChannelData(0), R = b.getChannelData(1);
    const count = Math.floor(seconds * perSecond);
    let clump = 0, at0 = 0, spread = 0, pan0 = 0;
    for (let k = 0; k < count; k++) {
      let at, pan;
      if (clump > 0) { clump--; at = at0 + Math.floor((Math.random() - 0.5) * spread); pan = Math.max(-1, Math.min(1, pan0 + (Math.random() - 0.5) * 0.6)); }
      else {
        at = Math.floor(Math.random() * n); pan = Math.random() * 2 - 1;
        if (Math.random() < 0.02) { clump = 5 + Math.floor(Math.random() * 30); at0 = at; spread = sr * (0.03 + Math.random() * 0.25); pan0 = pan; }
      }
      const r = Math.random(), kind = r < mix[0] ? 0 : r < mix[0] + mix[1] ? 1 : 2;
      const amp = Math.min(1, 0.04 * Math.exp(Math.random() * 3.2) * (0.5 + Math.random()));
      Audio.addDrop(L, R, ((at % n) + n) % n, sr, amp, pan, kind);
    }
    return Audio.normalise(b, 0.22);
  }

  // Rain on a car roof: dull thumps of the sheet metal, close together
  roofBed(seconds) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * seconds);
    const b = ctx.createBuffer(2, n, sr), L = b.getChannelData(0), R = b.getChannelData(1);
    for (let k = 0; k < seconds * 260; k++) {
      Audio.addDrop(L, R, Math.floor(Math.random() * n), sr, 0.1 + 0.9 * Math.random() ** 3, Math.random() * 1.6 - 0.8, Math.random() < 0.7 ? 3 : 0);
    }
    return Audio.normalise(b, 0.25);
  }

  oneDrop(kind) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * (kind === 3 ? 0.2 : 0.07));
    const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    Audio.addDrop(d, new Float32Array(n), 0, sr, 1.41, 1, kind); // pan 1: everything in the first channel
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < n; i++) d[i] /= peak || 1;
    return b;
  }

  /** rain 0..1; inCar: in a closed car's seat; cover: under a roof. */
  updateRain(dt, rain, { underwater = false, inCar = false, cover = false } = {}) {
    if (!this.rain) {
      if (rain < 0.001 || underwater) return;
      this.startRain(); // built when it first rains (~0.1 s of synthesis)
    }
    const R = this.rain;
    const ctx = this.ctx, now = ctx.currentTime;
    R.t += dt;
    // the rain comes in waves: a heavier spell, a lull, at no fixed rhythm
    R.burstNext -= dt;
    if (R.burstNext <= 0) { R.burstGoal = 0.55 + Math.random() * 0.9; R.burstNext = 2 + Math.random() * 6; }
    R.burst += (R.burstGoal - R.burst) * Math.min(1, dt * 0.6);
    const flutter = 1 + 0.12 * Math.sin(R.t * 2.3) * Math.sin(R.t * 0.9 + 1);
    const on = underwater ? 0 : rain, heavy = R.burst * flutter;
    // the levels and tones move slowly: set them ten times a second, not every frame
    R.paramT = (R.paramT || 0) - dt;
    const mode = `${inCar}${cover}`;
    if (R.paramT <= 0 || mode !== R.mode) {
      R.paramT = 0.1;
      R.mode = mode;
      this.rainLevels(R, on, heavy, inCar, cover, now);
    }
    if (on < 0.02 || inCar || cover) return;
    this.rainDrops(R, dt, on, heavy, now);
  }

  rainLevels(R, on, heavy, inCar, cover, now) {
    R.out.gain.setTargetAtTime(on > 0.001 ? 1 : 0, now, 0.4);
    R.wash.g.gain.setTargetAtTime(on * 0.07 * (0.7 + 0.3 * heavy) * (inCar ? 0.6 : 1), now, 0.8);
    R.wash.filters[2].frequency.setTargetAtTime(5500 + 3000 * (heavy - 0.55), now, 1);
    for (const b of R.beds) {
      b.next -= 0.1;
      if (b.next <= 0) { b.level = 0.5 + Math.random() * 0.9; b.tone = 0.6 + Math.random() * 0.8; b.next = 1.5 + Math.random() * 5; }
      b.g.gain.setTargetAtTime(on * 0.1 * b.level * heavy * (inCar ? 0.35 : 1), now, 0.9);
      b.filters[1].frequency.setTargetAtTime(Math.min(16000, 7000 * b.tone), now, 1.2);
    }
    R.roof.g.gain.setTargetAtTime(inCar ? on * 0.16 * heavy : 0, now, 0.25);
    R.tone.frequency.setTargetAtTime(cover ? 900 : inCar ? 2600 : 12000, now, 0.3);
  }

  rainDrops(R, dt, on, heavy, now) {
    // the near drops, one by one, each its own: pitch, filter, loudness, place
    R.acc += dt * on * 16 * heavy;
    while (R.acc >= 1) {
      R.acc -= 1;
      const at = now + Math.random() * Math.max(dt, 0.016);
      const gain = Math.min(0.12, 0.018 * Math.exp(Math.random() * 2.2)) * Math.min(1, on * 1.5);
      this.rainDrop(R.bank[(Math.random() * R.bank.length) | 0], at, gain, Math.random() * 1.8 - 0.9, Math.exp((Math.random() - 0.5) * 1.1), 1500 + Math.random() ** 2 * 9000);
      if (Math.random() < 0.15) { // its splash, a moment after
        this.rainDrop(R.bank[(Math.random() * R.bank.length) | 0], at + 0.02 + Math.random() * 0.05, gain * 0.4, Math.random() * 1.8 - 0.9, 1.3 + Math.random() * 0.4, 6000);
      }
    }
    // drips: a few places nearby (a gutter, a balcony, a sign) dripping each at its own pace
    if (on > 0.15) {
      while (R.drips.length < 4) R.drips.push(this.newDrip(now));
      for (let i = 0; i < R.drips.length; i++) {
        const d = R.drips[i];
        if (now >= d.until) { R.drips[i] = this.newDrip(now); continue; }
        if (now < d.next) continue;
        d.next = now + d.period * (0.8 + Math.random() * 0.4);
        if (Math.random() < 0.85) this.rainDrop(d.buffer, now + Math.random() * 0.01, d.gain * (0.7 + Math.random() * 0.6) * on, d.pan, d.rate * (0.97 + Math.random() * 0.06), d.cut);
      }
    }
  }

  newDrip(now) {
    const R = this.rain;
    return {
      buffer: R.bank[[6, 0, 6, 4][(Math.random() * 4) | 0] + 7 * ((Math.random() * 9) | 0)], // mostly fat drips
      period: 0.35 + Math.random() ** 1.5 * 2.6,
      next: now + Math.random() * 2,
      until: now + 20 + Math.random() * 30,
      pan: Math.random() * 1.8 - 0.9,
      rate: Math.exp((Math.random() - 0.5) * 0.9),
      gain: 0.02 + Math.random() * 0.05,
      cut: 1200 + Math.random() * 5000,
    };
  }

  rainDrop(buffer, at, gain, pan, rate, cut) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.rain.out);
    src.start(at);
  }

  // Chrome throttles timers in a hidden tab unless it thinks audio is
  // playing. A sub-audible tone keeps the sim clock running for two-tab tests.
  holdFocus() {
    this.start();
    if (!this.ctx || this._hold) {
      this.ctx?.resume?.();
      return;
    }
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 18;
    const g = ctx.createGain();
    g.gain.value = 0.0008;
    o.connect(g).connect(ctx.destination);
    o.start();
    this._hold = { o, g };
  }

  updateAmbience(dt, { altitude, coast, underwater, rain = 0, inCar = false, cover = false }) {
    if (!this.ctx || !this.wind) return;
    this.updateRain(dt, rain, { underwater, inCar, cover });
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
