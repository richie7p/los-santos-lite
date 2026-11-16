/** Fully procedural Web Audio: weapons, engines, sirens, ambience, UI and an in-car radio. */
import { clamp, rand } from '../core/math';

type ShotKind = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'rpg' | 'fist' | 'throw';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private engOsc: OscillatorNode[] = [];
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private sirenOsc!: OscillatorNode;
  private sirenGain!: GainNode;
  private sirenLfo!: OscillatorNode;
  private ambGain!: GainNode;
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private volume = 0.7;
  private radioOn = false;
  private station = 0;
  private nextBeat = 0;
  private beat = 0;
  private radioTimer: number | null = null;
  readonly stations = ['FM 88.1 霓虹夜行', 'FM 101.7 港口節拍', '關閉電台'];

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.32;
    this.music.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // engine
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.Q.value = 3;
    this.engFilter.connect(this.engGain).connect(this.sfx);
    for (const [type, mul, g] of [
      ['sawtooth', 1, 0.5],
      ['square', 0.5, 0.35],
      ['sawtooth', 2.01, 0.18],
    ] as [OscillatorType, number, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 50 * mul;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(this.engFilter);
      o.start();
      (o as OscillatorNode & { mul: number }).mul = mul;
      this.engOsc.push(o);
    }

    // skid loop
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    const skidSrc = this.loopNoise();
    const skidBp = ctx.createBiquadFilter();
    skidBp.type = 'bandpass';
    skidBp.frequency.value = 1800;
    skidBp.Q.value = 6;
    skidSrc.connect(skidBp).connect(this.skidGain).connect(this.sfx);

    // siren
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'square';
    this.sirenOsc.frequency.value = 800;
    this.sirenLfo = ctx.createOscillator();
    this.sirenLfo.frequency.value = 0.9;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    this.sirenLfo.connect(lfoGain).connect(this.sirenOsc.frequency);
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    const sirenLp = ctx.createBiquadFilter();
    sirenLp.type = 'lowpass';
    sirenLp.frequency.value = 2200;
    this.sirenOsc.connect(sirenLp).connect(this.sirenGain).connect(this.sfx);
    this.sirenOsc.start();
    this.sirenLfo.start();

    // city ambience + wind
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.05;
    const amb = this.loopNoise();
    const ambLp = ctx.createBiquadFilter();
    ambLp.type = 'lowpass';
    ambLp.frequency.value = 320;
    amb.connect(ambLp).connect(this.ambGain).connect(this.master);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const wind = this.loopNoise();
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = 500;
    windBp.Q.value = 0.6;
    wind.connect(windBp).connect(this.windGain).connect(this.master);
    // rain hiss
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    const rain = this.loopNoise();
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 1400;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 7000;
    rain.connect(rainHp).connect(rainLp).connect(this.rainGain).connect(this.master);
  }

  thunder() {
    if (!this.ctx) return;
    this.burst({ dur: 3.5, gain: 0.9, type: 'lowpass', freq: 380, freqEnd: 60, attack: 0.15 });
    this.burst({ dur: 0.6, gain: 0.35, type: 'lowpass', freq: 1200, freqEnd: 200, attack: 0.01 });
    this.tone(42, 2.5, 0.6, 'sine', 28);
  }

  private loopNoise() {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  dispose() {
    if (this.radioTimer) clearInterval(this.radioTimer);
    void this.ctx?.close();
    this.ctx = null;
  }

  private burst(opts: {
    dur: number;
    gain: number;
    type: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    attack?: number;
    delay?: number;
  }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5, opts.dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', freqEnd?: number, delay = 0, dest?: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** dist in metres from listener. */
  shot(kind: ShotKind, dist = 0) {
    if (!this.ctx) return;
    const att = clamp(1 - dist / 220, 0.03, 1);
    const far = dist > 40;
    switch (kind) {
      case 'fist':
        this.burst({ dur: 0.08, gain: 0.5 * att, type: 'lowpass', freq: 900 });
        this.tone(120, 0.1, 0.4 * att, 'sine', 50);
        break;
      case 'throw':
        this.burst({ dur: 0.18, gain: 0.25 * att, type: 'bandpass', freq: 900, freqEnd: 300 });
        break;
      case 'pistol':
        this.burst({ dur: 0.18, gain: 0.9 * att, type: far ? 'lowpass' : 'highpass', freq: far ? 1200 : 700, q: 0.7 });
        this.tone(160, 0.12, 0.6 * att, 'sine', 45);
        this.burst({ dur: 0.5, gain: 0.12 * att, type: 'lowpass', freq: 700, delay: 0.04 });
        break;
      case 'smg':
        this.burst({ dur: 0.1, gain: 0.7 * att, type: far ? 'lowpass' : 'bandpass', freq: far ? 1000 : 1700, q: 0.6 });
        this.tone(140, 0.08, 0.45 * att, 'sine', 50);
        break;
      case 'rifle':
        this.burst({ dur: 0.16, gain: 1.0 * att, type: far ? 'lowpass' : 'bandpass', freq: far ? 900 : 1300, q: 0.5 });
        this.tone(110, 0.14, 0.7 * att, 'sine', 38);
        this.burst({ dur: 0.6, gain: 0.15 * att, type: 'lowpass', freq: 600, delay: 0.05 });
        break;
      case 'shotgun':
        this.burst({ dur: 0.35, gain: 1.2 * att, type: 'lowpass', freq: far ? 700 : 2400, freqEnd: 300 });
        this.tone(80, 0.25, 0.9 * att, 'sine', 30);
        break;
      case 'sniper':
        this.burst({ dur: 0.3, gain: 1.3 * att, type: 'highpass', freq: 500 });
        this.tone(70, 0.4, 1.0 * att, 'sine', 25);
        this.burst({ dur: 1.4, gain: 0.25 * att, type: 'lowpass', freq: 500, delay: 0.08 });
        break;
      case 'rpg':
        this.burst({ dur: 0.9, gain: 0.8 * att, type: 'bandpass', freq: 600, freqEnd: 200, q: 0.4 });
        this.tone(90, 0.5, 0.6 * att, 'sawtooth', 40);
        break;
    }
  }

  explosion(dist = 0) {
    if (!this.ctx) return;
    const att = clamp(1 - dist / 400, 0.05, 1);
    this.burst({ dur: 2.2, gain: 1.6 * att, type: 'lowpass', freq: 2400, freqEnd: 90, attack: 0.01 });
    this.tone(55, 1.2, 1.4 * att, 'sine', 22);
    this.burst({ dur: 0.25, gain: 0.8 * att, type: 'highpass', freq: 2000 });
  }

  impact(kind: 'concrete' | 'metal' | 'flesh' | 'glass', dist = 0) {
    if (!this.ctx) return;
    const att = clamp(1 - dist / 60, 0, 1) * 0.6;
    if (att <= 0.01) return;
    if (kind === 'metal') this.tone(rand(1800, 2600), 0.08, 0.25 * att, 'triangle', 900);
    else if (kind === 'flesh') this.burst({ dur: 0.07, gain: 0.5 * att, type: 'lowpass', freq: 500 });
    else this.burst({ dur: 0.06, gain: 0.35 * att, type: 'bandpass', freq: 2500, q: 1.5 });
  }

  crash(intensity: number) {
    if (!this.ctx) return;
    const g = clamp(intensity / 25, 0.15, 1.2);
    this.burst({ dur: 0.5, gain: g, type: 'lowpass', freq: 1600, freqEnd: 200 });
    this.tone(70, 0.3, g * 0.7, 'sine', 35);
    for (let i = 0; i < 3; i++) this.tone(rand(1500, 3500), 0.12, 0.08 * g, 'triangle', 600, rand(0, 0.12));
  }

  hitmarker(kill = false) {
    if (!this.ctx) return;
    this.tone(kill ? 1400 : 2200, 0.05, 0.18, 'square', kill ? 700 : 1800);
    if (kill) this.tone(900, 0.12, 0.15, 'triangle', 500, 0.05);
  }

  reload() {
    if (!this.ctx) return;
    this.burst({ dur: 0.05, gain: 0.3, type: 'bandpass', freq: 3000, q: 3 });
    this.burst({ dur: 0.06, gain: 0.35, type: 'bandpass', freq: 2200, q: 3, delay: 0.35 });
  }

  empty() {
    if (!this.ctx) return;
    this.burst({ dur: 0.03, gain: 0.25, type: 'highpass', freq: 3000 });
  }

  pickup() {
    if (!this.ctx) return;
    this.tone(880, 0.1, 0.2, 'sine');
    this.tone(1320, 0.15, 0.2, 'sine', undefined, 0.07);
  }

  cash() {
    if (!this.ctx) return;
    [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.12, 0.15, 'triangle', undefined, i * 0.05));
  }

  ui(kind: 'click' | 'open' | 'error' | 'select' = 'click') {
    if (!this.ctx) return;
    if (kind === 'error') this.tone(180, 0.18, 0.2, 'square', 120);
    else if (kind === 'open') this.tone(520, 0.08, 0.12, 'triangle', 780);
    else if (kind === 'select') this.tone(1200, 0.04, 0.1, 'triangle');
    else this.tone(900, 0.04, 0.1, 'triangle');
  }

  jingle(kind: 'complete' | 'fail' | 'start' | 'checkpoint' | 'heat' | 'stunt') {
    if (!this.ctx) return;
    const seq: Record<string, number[]> = {
      complete: [523, 659, 784, 1046, 1318],
      fail: [392, 330, 262, 196],
      start: [392, 523, 659],
      checkpoint: [1046, 1568],
      heat: [880, 660, 880, 660],
      stunt: [659, 784, 988, 1318],
    };
    const notes = seq[kind];
    notes.forEach((f, i) => this.tone(f, kind === 'complete' ? 0.35 : 0.18, 0.16, kind === 'fail' ? 'sawtooth' : 'triangle', undefined, i * (kind === 'complete' ? 0.12 : 0.09)));
  }

  footstep(dist = 0) {
    if (!this.ctx || dist > 20) return;
    this.burst({ dur: 0.05, gain: 0.06 * (1 - dist / 20), type: 'lowpass', freq: 500 });
  }

  horn() {
    if (!this.ctx) return;
    this.tone(415, 0.4, 0.15, 'sawtooth');
    this.tone(523, 0.4, 0.12, 'sawtooth');
  }

  /** Called every frame. */
  update(p: { engine: number; load: number; inCar: boolean; skid: number; siren: number; wind: number; city: number; rain: number }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = p.engine;
    const base = 38 + rpm * 120;
    for (const o of this.engOsc) o.frequency.setTargetAtTime(base * (o as OscillatorNode & { mul: number }).mul, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(300 + rpm * 1400 + p.load * 600, t, 0.08);
    this.engGain.gain.setTargetAtTime(p.inCar ? 0.09 + p.load * 0.08 : 0, t, 0.1);
    this.skidGain.gain.setTargetAtTime(clamp(p.skid, 0, 1) * 0.22, t, 0.05);
    this.sirenGain.gain.setTargetAtTime(clamp(p.siren, 0, 1) * 0.07, t, 0.2);
    this.windGain.gain.setTargetAtTime(clamp(p.wind, 0, 1) * 0.18, t, 0.2);
    this.ambGain.gain.setTargetAtTime(0.03 + p.city * 0.05, t, 0.5);
    this.rainGain.gain.setTargetAtTime(clamp(p.rain, 0, 1) * (p.inCar ? 0.16 : 0.1), t, 0.5);
  }

  // ---------------------------------------------------------------- radio
  setRadio(on: boolean) {
    if (!this.ctx) return;
    if (on === this.radioOn) return;
    this.radioOn = on;
    if (on && this.station < 2) {
      this.nextBeat = this.ctx.currentTime + 0.1;
      if (!this.radioTimer) this.radioTimer = window.setInterval(() => this.scheduleRadio(), 50);
    }
    this.music.gain.setTargetAtTime(on && this.station < 2 ? 0.32 : 0, this.ctx.currentTime, 0.3);
  }

  cycleStation() {
    this.station = (this.station + 1) % 3;
    if (this.ctx) this.music.gain.setTargetAtTime(this.radioOn && this.station < 2 ? 0.32 : 0, this.ctx.currentTime, 0.2);
    if (this.radioOn && this.station < 2 && !this.radioTimer) this.radioTimer = window.setInterval(() => this.scheduleRadio(), 50);
    return this.stations[this.station];
  }

  get stationName() {
    return this.stations[this.station];
  }

  private scheduleRadio() {
    if (!this.ctx || !this.radioOn || this.station >= 2) return;
    const ctx = this.ctx;
    const bpm = this.station === 0 ? 100 : 122;
    const step = 60 / bpm / 4;
    // synthwave in A minor / house in F minor
    const prog = this.station === 0 ? [57, 53, 60, 55] : [53, 56, 51, 58];
    while (this.nextBeat < ctx.currentTime + 0.2) {
      const s = this.beat % 16;
      const bar = Math.floor(this.beat / 16) % 4;
      const root = prog[bar];
      const t = this.nextBeat;
      const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
      // kick
      if (s % 4 === 0) this.mTone(t, 150, 0.22, 0.9, 'sine', 40);
      // snare / clap
      if (s === 4 || s === 12) this.mNoise(t, 0.18, 0.35, 1800);
      // hats
      if (this.station === 1 ? s % 4 === 2 : s % 2 === 0) this.mNoise(t, 0.04, 0.12, 8000, 'highpass');
      // bass
      const bassPat = this.station === 0 ? [0, 0, 12, 0, 0, 12, 0, 7] : [0, -1, 0, 12, -1, 0, 10, -1];
      const bn = bassPat[s % 8];
      if (bn >= 0) this.mTone(t, midi(root - 24 + bn), step * 0.9, 0.28, 'sawtooth', undefined, 500);
      // arp / chords
      if (this.station === 0) {
        const arp = [0, 3, 7, 12, 7, 3, 10, 7];
        this.mTone(t, midi(root + arp[s % 8]), step * 0.8, 0.07, 'square', undefined, 2400);
      } else if (s === 0 || s === 6 || s === 10) {
        for (const iv of [0, 3, 7, 10]) this.mTone(t, midi(root + iv), step * 2, 0.06, 'sawtooth', undefined, 1600);
      }
      this.nextBeat += step;
      this.beat++;
    }
  }

  private mTone(t: number, f: number, dur: number, g: number, type: OscillatorType, fEnd?: number, lp?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(g, t + 0.005);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (lp) {
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = lp;
      node = o.connect(f2);
    }
    node.connect(gn).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private mNoise(t: number, dur: number, g: number, f: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(g, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(gn).connect(this.music);
    s.start(t, Math.random(), dur + 0.02);
  }
}
